import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// CocoaPods가 Pods 타깃을 붙일 수 있는 최소한의 빈 iOS 앱 프로젝트를 만든다.
// xcodeproj gem은 CocoaPods 설치 방식에 따라 일반 ruby에서 불러올 수 없어서 직접 작성한다.
export async function writeEmptyAppProject(projectPath: string, targetName: string, deploymentTarget: string): Promise<void> {
  const settings = (configuration: 'Debug' | 'Release') => `
				ALWAYS_SEARCH_USER_PATHS = NO;
				CLANG_ENABLE_MODULES = YES;
				CODE_SIGNING_ALLOWED = NO;
				GENERATE_INFOPLIST_FILE = YES;
				IPHONEOS_DEPLOYMENT_TARGET = ${deploymentTarget};
				PRODUCT_BUNDLE_IDENTIFIER = io.nativepiece.prebuild;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SDKROOT = iphoneos;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";${configuration === 'Debug' ? '\n				ONLY_ACTIVE_ARCH = YES;' : ''}`;

  const pbxproj = `// !$*UTF8*$!
{
	archiveVersion = 1;
	classes = {
	};
	objectVersion = 56;
	objects = {

/* Begin PBXFileReference section */
		4E5000000000000000000001 /* ${targetName}.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = ${targetName}.app; sourceTree = BUILT_PRODUCTS_DIR; };
/* End PBXFileReference section */

/* Begin PBXFrameworksBuildPhase section */
		4E5000000000000000000002 /* Frameworks */ = {
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXFrameworksBuildPhase section */

/* Begin PBXGroup section */
		4E5000000000000000000003 = {
			isa = PBXGroup;
			children = (
				4E5000000000000000000004 /* Products */,
			);
			sourceTree = "<group>";
		};
		4E5000000000000000000004 /* Products */ = {
			isa = PBXGroup;
			children = (
				4E5000000000000000000001 /* ${targetName}.app */,
			);
			name = Products;
			sourceTree = "<group>";
		};
/* End PBXGroup section */

/* Begin PBXNativeTarget section */
		4E5000000000000000000005 /* ${targetName} */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = 4E5000000000000000000008 /* Build configuration list for PBXNativeTarget "${targetName}" */;
			buildPhases = (
				4E5000000000000000000006 /* Sources */,
				4E5000000000000000000002 /* Frameworks */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = ${targetName};
			productName = ${targetName};
			productReference = 4E5000000000000000000001 /* ${targetName}.app */;
			productType = "com.apple.product-type.application";
		};
/* End PBXNativeTarget section */

/* Begin PBXProject section */
		4E5000000000000000000007 /* Project object */ = {
			isa = PBXProject;
			buildConfigurationList = 4E5000000000000000000011 /* Build configuration list for PBXProject "${targetName}" */;
			compatibilityVersion = "Xcode 14.0";
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (
				en,
				Base,
			);
			mainGroup = 4E5000000000000000000003;
			productRefGroup = 4E5000000000000000000004 /* Products */;
			projectDirPath = "";
			projectRoot = "";
			targets = (
				4E5000000000000000000005 /* ${targetName} */,
			);
		};
/* End PBXProject section */

/* Begin PBXSourcesBuildPhase section */
		4E5000000000000000000006 /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXSourcesBuildPhase section */

/* Begin XCBuildConfiguration section */
		4E5000000000000000000009 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {${settings('Debug')}
			};
			name = Debug;
		};
		4E5000000000000000000010 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {${settings('Release')}
			};
			name = Release;
		};
		4E5000000000000000000012 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {${settings('Debug')}
			};
			name = Debug;
		};
		4E5000000000000000000013 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {${settings('Release')}
			};
			name = Release;
		};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		4E5000000000000000000008 /* Build configuration list for PBXNativeTarget "${targetName}" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				4E5000000000000000000009 /* Debug */,
				4E5000000000000000000010 /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
		4E5000000000000000000011 /* Build configuration list for PBXProject "${targetName}" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				4E5000000000000000000012 /* Debug */,
				4E5000000000000000000013 /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		};
/* End XCConfigurationList section */
	};
	rootObject = 4E5000000000000000000007 /* Project object */;
}
`;

  await mkdir(projectPath, { recursive: true });
  await writeFile(path.join(projectPath, 'project.pbxproj'), pbxproj);
}
