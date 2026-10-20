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

## 배포하기

이 레포 하나에서 RN 개발부터 iOS Swift Package 배포까지 해요. `nativepiece publish ios`는 이 레포(git `origin`)에 배포해요.

```bash
# package.json의 version을 올리고 커밋·푸시한 뒤 main에서 실행해요
npm run build:ios
npx nativepiece publish ios --dry-run   # 바뀔 파일만 확인해요
npx nativepiece publish ios
```

- 레포 루트에 `Package.swift`가, `swift-package/`에 Swift 소스와 JS 번들이 생겨서 커밋돼요. 다른 파일은 바꾸지 않아요. 직접 고치지 마세요.
- 버전 태그(`package.json`의 version)와 GitHub Release가 생기고, XCFramework는 Release에 올라가요.
- 커밋하지 않은 변경이 있거나 main이 아니면 배포하지 않아요.

iOS 앱에서는 Xcode의 **File → Add Package Dependencies**에 이 레포 URL을 넣고 `{{name}}` 제품을 추가해요.

```swift
.package(url: "https://github.com/<owner>/<이 레포>", exact: "<버전>")
```

레포가 비공개라면 Xcode가 git과 바이너리를 받을 수 있게 `~/.netrc`에 읽기 토큰을 넣어요.

```
machine github.com
  login x-access-token
  password <GitHub 토큰>
machine api.github.com
  login x-access-token
  password <GitHub 토큰>
```

Android는 `nativepiece.config.ts`에 `publish.android.url`을 넣고 `npm run build:android && npx nativepiece publish android`로 Maven 저장소에 올려요.
