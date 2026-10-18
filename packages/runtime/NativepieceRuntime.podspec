require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NativepieceRuntime"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/team-PopPang/Nativepiece"
  s.license      = "UNLICENSED"
  s.authors      = "Nativepiece"
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/team-PopPang/Nativepiece.git", :tag => s.version.to_s }

  s.source_files = "ios/**/*.{h,m,mm}"
  # Swift 호스트 SDK가 import하는 헤더는 C++을 포함하지 않는 NPChannel.h 하나뿐이다.
  s.public_header_files = "ios/NPChannel.h"

  s.pod_target_xcconfig = { "DEFINES_MODULE" => "YES" }

  install_modules_dependencies(s)
end
