#!/usr/bin/env ruby
# frozen_string_literal: true

# React Native의 iOS prebuilt Core는 CocoaPods에서 VFS overlay와 헤더 검색
# 경로를 조합해 사용한다. SwiftPM binary target은 이 설정을 소비 앱까지
# 전달하지 않으므로, VFS와 prebuilt dependency 헤더를 React.framework의
# Headers 아래에 물리적으로 배치하고 import 경로를 React namespace로 통일한다.

require "fileutils"
require "pathname"
require "tmpdir"
require "yaml"

# 오류 메시지를 표준 오류로 출력하고 즉시 실패한다.
# 변환 결과가 불완전한 상태로 다음 패키징 단계로 넘어가는 것을 막는다.
def fail_with(message)
  warn "error: #{message}"
  exit 1
end

react_xcframework_path, dependencies_xcframework_path, hermes_headers_path, frameworks_dir, minimum_os_version = ARGV
if [react_xcframework_path, dependencies_xcframework_path, hermes_headers_path, frameworks_dir].any?(&:nil?)
  fail_with(
    "usage: #{File.basename($PROGRAM_NAME)} <React.xcframework> " \
    "<ReactNativeDependencies.xcframework> <hermes-headers-dir> <frameworks-dir> " \
    "[minimum-ios-version]"
  )
end

# React_RCTAppDelegate shim은 XCFramework를 직접 만들기 때문에 Info.plist도 직접 작성한다.
# App Store Connect가 embedded framework에 요구하는 MinimumOSVersion을 누락하지 않는다.
minimum_os_version ||= "17.0"
unless minimum_os_version.match?(/\A\d+(?:\.\d+){1,2}\z/)
  fail_with("invalid minimum iOS version: #{minimum_os_version}")
end

react_xcframework_path = File.expand_path(react_xcframework_path)
dependencies_xcframework_path = File.expand_path(dependencies_xcframework_path)
hermes_headers_path = File.expand_path(hermes_headers_path)
frameworks_dir = File.expand_path(frameworks_dir)

template_path = File.join(react_xcframework_path, "React-VFS-template.yaml")
react_headers_root = File.join(react_xcframework_path, "Headers")
dependencies_headers_root = File.join(dependencies_xcframework_path, "Headers")

fail_with("React XCFramework not found: #{react_xcframework_path}") unless Dir.exist?(react_xcframework_path)
fail_with("React VFS template not found: #{template_path}") unless File.file?(template_path)
fail_with("React shared headers not found: #{react_headers_root}") unless Dir.exist?(react_headers_root)
fail_with("React Native dependencies headers not found: #{dependencies_headers_root}") unless Dir.exist?(dependencies_headers_root)
fail_with("Hermes headers not found: #{hermes_headers_path}") unless Dir.exist?(hermes_headers_path)
fail_with("Swift Package frameworks directory not found: #{frameworks_dir}") unless Dir.exist?(frameworks_dir)

template = YAML.load_file(template_path)
headers_root = template.fetch("roots").find { |root| root["name"] == "${ROOT_PATH}/Headers" }
fail_with("React VFS template does not define the Headers root") unless headers_root

mappings = []
collect_mappings = lambda do |entry, logical_parent|
  name = entry.fetch("name")
  fail_with("unsafe VFS path: #{name}") if name.include?("..") || Pathname.new(name).absolute?

  logical_path = logical_parent.empty? ? name : File.join(logical_parent, name)
  case entry.fetch("type")
  when "directory"
    entry.fetch("contents", []).each { |child| collect_mappings.call(child, logical_path) }
  when "file"
    source_path = File.expand_path(
      entry.fetch("external-contents").sub("${ROOT_PATH}", react_xcframework_path)
    )
    unless source_path.start_with?("#{react_headers_root}/") && File.file?(source_path)
      fail_with("VFS source header is unavailable: #{source_path}")
    end

    mappings << [logical_path, source_path]
  else
    fail_with("unsupported VFS entry type: #{entry.fetch('type')}")
  end
end

headers_root.fetch("contents", []).each { |entry| collect_mappings.call(entry, "") }
fail_with("React VFS template did not contain header mappings") if mappings.empty?

# 헤더 파일 하나를 목적지에 복사한다.
# 동일한 파일은 유지하고, 다른 파일만 교체해 불필요한 쓰기를 줄인다.
def copy_file(source_path, destination_path)
  FileUtils.mkdir_p(File.dirname(destination_path))
  return if File.exist?(destination_path) && File.identical?(source_path, destination_path)

  FileUtils.rm_f(destination_path)
  FileUtils.cp(source_path, destination_path, preserve: true)
end

# 디렉터리의 모든 헤더·하위 디렉터리를 목적지에 병합 복사한다.
# React Native dependency와 Hermes 헤더를 React.framework 아래에 배치할 때 사용한다.
def copy_directory_contents(source_directory, destination_directory)
  FileUtils.mkdir_p(destination_directory)
  Dir.children(source_directory).each do |entry|
    FileUtils.cp_r(
      File.join(source_directory, entry),
      destination_directory,
      preserve: true
    )
  end
end

# React module map을 SwiftPM 소비에 맞게 보정한다.
# React를 system module로 표시하고, 별도 바이너리가 없는 React_RCTAppDelegate 선언은 제거한다.
def mark_react_module_as_system(react_framework_path)
  module_map_path = File.join(react_framework_path, "Modules", "module.modulemap")
  fail_with("React module map not found: #{module_map_path}") unless File.file?(module_map_path)

  content = File.read(module_map_path)
  content.sub!(/^framework module React \{/, "framework module React [system] {")

  # React-RCTAppDelegate is a submodule implemented by React.framework, not a
  # separate framework in the prebuilt React binary. Keep its public module in
  # a small static framework shim so SwiftPM can satisfy its auto-link option.
  content.gsub!(
    /\nframework module React_RCTAppDelegate \{\n\s*umbrella header "React_RCTAppDelegate\/React_RCTAppDelegate-umbrella\.h"\n\s*export \*\n\}\n*/,
    "\n"
  )
  File.chmod((File.stat(module_map_path).mode & 0o777) | 0o200, module_map_path)
  File.write(module_map_path, content)
end

# 외부 Xcode 도구를 실행하고 실패하면 즉시 변환을 중단한다.
# shim framework의 컴파일·정적 라이브러리 생성·XCFramework 생성에 사용한다.
def run_command!(*command)
  return if system(*command)

  fail_with("command failed: #{command.join(" ")}")
end

# shim framework가 Xcode에서 유효한 번들로 인식되도록 최소 Info.plist를 작성한다.
# 지원 플랫폼과 MinimumOSVersion은 Device, Simulator, Mac Catalyst slice별로 전달받는다.
def write_framework_info_plist(path, framework_name, supported_platform, minimum_os_version)
  File.write(path, <<~XML)
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>CFBundleDevelopmentRegion</key><string>en</string>
      <key>CFBundleExecutable</key><string>#{framework_name}</string>
      <key>CFBundleIdentifier</key><string>io.nativepiece.prebuilt.react-rct-app-delegate</string>
      <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
      <key>CFBundleName</key><string>#{framework_name}</string>
      <key>CFBundlePackageType</key><string>FMWK</string>
      <key>CFBundleShortVersionString</key><string>1.0</string>
      <key>CFBundleVersion</key><string>1</string>
      <key>CFBundleSupportedPlatforms</key><array><string>#{supported_platform}</string></array>
      <key>MinimumOSVersion</key><string>#{minimum_os_version}</string>
    </dict>
    </plist>
  XML
end

# 하나의 플랫폼 slice용 React_RCTAppDelegate 정적 framework를 만든다.
# 공개 헤더와 module map은 제공하고, 바이너리는 자동 링크만 만족하는 작은 정적 라이브러리로 만든다.
def build_static_framework(tmpdir, identifier, sdk, targets, supported_platform, headers_path, minimum_os_version)
  framework_name = "React_RCTAppDelegate"
  framework_path = File.join(tmpdir, identifier, "#{framework_name}.framework")
  headers_destination = File.join(framework_path, "Headers")
  FileUtils.mkdir_p(headers_destination)
  FileUtils.cp_r(File.join(headers_path, "."), headers_destination)
  FileUtils.mkdir_p(File.join(framework_path, "Modules"))
  File.write(
    File.join(framework_path, "Modules", "module.modulemap"),
    <<~MODULE_MAP
      framework module #{framework_name} {
        umbrella header "#{framework_name}-umbrella.h"
        export *
        module * { export * }
      }
    MODULE_MAP
  )
  write_framework_info_plist(
    File.join(framework_path, "Info.plist"),
    framework_name,
    supported_platform,
    minimum_os_version
  )

  source_path = File.join(tmpdir, "react_rct_app_delegate_linker_shim.c")
  library_paths = targets.map do |target|
    object_path = File.join(tmpdir, "#{identifier}-#{target.gsub(/[^A-Za-z0-9]/, "_")}.o")
    library_path = "#{object_path}.a"
    run_command!("xcrun", "--sdk", sdk, "clang", "-target", target, "-x", "c", "-c", source_path, "-o", object_path)
    run_command!("xcrun", "libtool", "-static", "-o", library_path, object_path)
    library_path
  end

  binary_path = File.join(framework_path, framework_name)
  if library_paths.one?
    FileUtils.cp(library_paths.first, binary_path, preserve: true)
  else
    run_command!("xcrun", "lipo", "-create", *library_paths, "-output", binary_path)
  end

  framework_path
end

# Device, Simulator, Mac Catalyst slice를 하나의 React_RCTAppDelegate XCFramework로 묶는다.
# 실제 구현은 React.framework에 남기고, 이 shim은 Swift의 모듈·링크 이름만 제공한다.
def create_react_rct_app_delegate_shim(frameworks_dir, headers_path, minimum_os_version)
  framework_name = "React_RCTAppDelegate"
  destination = File.join(frameworks_dir, "#{framework_name}.xcframework")
  FileUtils.rm_rf(destination)

  Dir.mktmpdir("nativepiece-react-rct-app-delegate-") do |tmpdir|
    source_path = File.join(tmpdir, "react_rct_app_delegate_linker_shim.c")
    File.write(source_path, "void nativepiece_react_rct_app_delegate_linker_shim(void) {}\n")

    frameworks = [
      build_static_framework(
        tmpdir,
        "ios-arm64",
        "iphoneos",
        ["arm64-apple-ios#{minimum_os_version}"],
        "iPhoneOS",
        headers_path,
        minimum_os_version
      ),
      build_static_framework(
        tmpdir,
        "ios-arm64_x86_64-simulator",
        "iphonesimulator",
        ["arm64-apple-ios#{minimum_os_version}-simulator", "x86_64-apple-ios#{minimum_os_version}-simulator"],
        "iPhoneSimulator",
        headers_path,
        minimum_os_version
      ),
      build_static_framework(
        tmpdir,
        "ios-arm64_x86_64-maccatalyst",
        "macosx",
        ["arm64-apple-ios#{minimum_os_version}-macabi", "x86_64-apple-ios#{minimum_os_version}-macabi"],
        "MacOSX",
        headers_path,
        minimum_os_version
      )
    ]

    run_command!(
      "xcodebuild",
      "-create-xcframework",
      *frameworks.flat_map { |framework| ["-framework", framework] },
      "-output",
      destination
    )
  end
end

react_framework_headers = Dir.glob(
  File.join(react_xcframework_path, "**", "React.framework", "Headers")
).select { |path| Dir.exist?(path) }
fail_with("React framework slices do not contain Headers directories") if react_framework_headers.empty?

copies = 0
react_framework_headers.each do |destination_headers|
  mappings.each do |logical_path, source_path|
    namespace, header_path = logical_path.split(File::SEPARATOR, 2)
    fail_with("VFS file mapping has no header path: #{logical_path}") if header_path.nil?

    destination_path = if namespace == "React"
      File.join(destination_headers, header_path)
    else
      File.join(destination_headers, logical_path)
    end
    copy_file(source_path, destination_path)
    copies += 1
  end

  Dir.children(dependencies_headers_root).each do |entry|
    source_directory = File.join(dependencies_headers_root, entry)
    next unless Dir.exist?(source_directory)

    copy_directory_contents(source_directory, File.join(destination_headers, entry))
  end
  copy_directory_contents(hermes_headers_path, File.join(destination_headers, "hermes"))

  mark_react_module_as_system(File.dirname(destination_headers))
end
mark_react_module_as_system(react_xcframework_path)

app_delegate_headers = File.join(react_framework_headers.first, "React_RCTAppDelegate")
fail_with("React RCTAppDelegate headers not found: #{app_delegate_headers}") unless Dir.exist?(app_delegate_headers)
create_react_rct_app_delegate_shim(
  frameworks_dir,
  app_delegate_headers,
  minimum_os_version
)

aliases = mappings.map { |logical_path, _| logical_path.split(File::SEPARATOR, 2).first }
aliases.concat(Dir.children(dependencies_headers_root).select do |entry|
  Dir.exist?(File.join(dependencies_headers_root, entry))
end)
aliases << "hermes"
aliases.uniq!
aliases.reject! { |name| name == "React" }
alias_pattern = aliases.sort_by { |name| -name.length }.map { |name| Regexp.escape(name) }.join("|")

rewritten_files = 0
Dir.glob(File.join(frameworks_dir, "**", "*.{h,hpp,hh,hxx}")) do |header_path|
  content = File.read(header_path)
  rewritten = content.gsub(/<((?:#{alias_pattern}))\/([^>]+)>/) do
    "<React/#{$1}/#{$2}>"
  end
  rewritten = rewritten.gsub(/(#\s*(?:include|import)\s*)"((?:#{alias_pattern})\/[^\"]+)"/) do
    "#{$1}<React/#{$2}>"
  end
  # Boost/Folly처럼 include 경로를 문자열 매크로로 선언하는 경우도 있다.
  rewritten = rewritten.gsub(/"((?:#{alias_pattern})\/[^\"]+)"/) do
    "\"React/#{$1}\""
  end

  next if rewritten == content

  File.chmod((File.stat(header_path).mode & 0o777) | 0o200, header_path)
  File.write(header_path, rewritten)
  rewritten_files += 1
end

puts "Materialized #{mappings.size} React VFS headers in #{react_framework_headers.size} framework slices (#{copies} copied)."
puts "Normalized external header imports in #{rewritten_files} packaged headers."
