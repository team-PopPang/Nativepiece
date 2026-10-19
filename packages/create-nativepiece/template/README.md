# {{name}}

[Nativepiece](https://github.com/team-PopPang/Nativepiece)로 만든 React Native 모듈이에요. iOS 앱에는 Swift Package로, Android 앱에는 Maven 의존성으로 넣어요.

## 구조

| 경로 | 내용 |
|---|---|
| `nativepiece.contract.ts` | 호스트 앱과 주고받는 계약 (화면, 이벤트, 호출, 메시지) |
| `nativepiece.entry.ts` | 계약의 화면에 컴포넌트를 연결하는 진입점 |
| `src/screens/` | RN 화면 |
| `example/ios/` | SwiftUI 예제 호스트 앱 |
| `example/android/` | Jetpack Compose 예제 호스트 앱 |

## 빌드하고 예제 앱 실행하기

```bash
npm run doctor          # 개발 환경 점검
npm run build:ios       # .nativepiece/output/ios/{{name}} (Swift Package)
npm run build:android   # .nativepiece/output/android/maven (Maven 저장소)
```

- iOS: `example/ios/ExampleHost.xcodeproj`를 Xcode로 열고 실행해요.
- Android: `example/android`를 Android Studio로 열고 실행해요.

## 개발 모드 (Metro, Fast Refresh)

```bash
npm start               # Metro 실행
```

- iOS: `npm run build:ios:dev`로 개발용 패키지를 만들고, 예제 프로젝트의 패키지 경로를 `.nativepiece/output/ios-dev/{{name}}`로 바꾼 뒤 `{{name}}.start(host:devServer: .localhost)`로 시작해요.
- Android: 예제 앱은 debug 빌드에서 Metro에 자동으로 연결돼요. Metro가 없으면 앱에 든 번들을 써요.

## 계약을 바꿨을 때

`nativepiece.contract.ts`를 바꾸면 다시 빌드해요. 빌드할 때 Swift·Kotlin 타입이 새로 만들어져요. 생성 결과만 보려면 `npm run codegen`을 실행해요(`.nativepiece/codegen/`).
