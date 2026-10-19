import { call, defineContract, event, message, screen } from '@team-poppang/nativepiece-runtime';

// 모듈과 호스트 앱이 주고받는 것을 정의해요. `npm run codegen`이 이 파일로 Swift·Kotlin 타입을 만들어요.
export default defineContract({
  screens: {
    home: screen<{ userName: string }>(),
  },
  events: {
    // RN → 호스트: 버튼을 누른 횟수를 알려요.
    buttonPressed: event<{ count: number }>(),
  },
  calls: {
    // RN → 호스트 → RN: 호스트 앱 정보를 물어봐요.
    getAppInfo: call<void, { appVersion: string; platform: 'ios' | 'android' }>(),
  },
  messages: {
    // 호스트 → RN: 테마가 바뀌었다고 알려요.
    themeChanged: message<{ dark: boolean }>(),
  },
});
