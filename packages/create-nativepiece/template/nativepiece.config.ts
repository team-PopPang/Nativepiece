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
});
