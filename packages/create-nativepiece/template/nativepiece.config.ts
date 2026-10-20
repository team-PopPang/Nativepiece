import { defineConfig } from '@team-poppang/nativepiece-cli';

export default defineConfig({
  // Swift 모듈 이름과 Kotlin 객체 이름으로 쓰여요.
  name: '{{name}}',
  entry: 'nativepiece.entry.ts',
  contract: 'nativepiece.contract.ts',
  ios: {
    deploymentTarget: '{{iosDeploymentTarget}}',
  },
  android: {
    group: '{{group}}',
    namespace: '{{androidPackage}}',
  },
  // npx nativepiece publish ios는 기본으로 이 레포(git origin)에 Swift Package를 배포해요.
  // iOS 결과물을 다른 레포에 두려면 아래 주석을 풀어요.
  // publish: {
  //   ios: { repo: 'my-org/my-module-ios' },
  //   android: { url: 'https://maven.pkg.github.com/my-org/my-module' },
  // },
});
