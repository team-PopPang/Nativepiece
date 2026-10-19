# Nativepiece

React Native 앱을 모듈로 만들어 Swift(iOS)와 Kotlin(Android) 네이티브 앱에서 의존성 하나로 쓰게 해 주는 도구예요.

- iOS: Swift Package 하나 (XCFramework, 호스트 SDK, Hermes 바이트코드 번들 포함)
- Android: Maven 의존성 하나 (SDK AAR, 네이티브 모듈 AAR, Compose용 artifact)
- 앱과 RN이 주고받는 것을 TS 계약 파일로 정의하면, Swift·Kotlin 타입이 생성돼요.

자세한 설계는 [테크 스펙](docs/tech-spec.md)을 봐 주세요.

## 시작하기

### 새 모듈 앱 만들기

```bash
npx create-nativepiece my-module --group com.example
cd my-module
npm run build:ios       # .nativepiece/output/ios/MyModule
npm run build:android   # .nativepiece/output/android/maven
```

만들어진 프로젝트에는 SwiftUI(`example/ios`)와 Jetpack Compose(`example/android`) 예제 호스트 앱이 들어 있어요.

### 기존 RN 앱을 모듈로 만들기

```bash
cd my-rn-app
npx nativepiece init     # 설정, 계약, 진입점 파일을 만들어요. ios/, android/, 앱 소스는 건드리지 않아요
npx nativepiece doctor
npx nativepiece build ios
```

## 계약

```ts
// nativepiece.contract.ts
export default defineContract({
  screens:  { request: screen<{ userUuid: string }>() },
  events:   { requestSubmitted: event<{ requestId: string }>() },   // RN → 앱
  calls:    { getAccessToken: call<void, { token: string }>() },   // RN → 앱 → RN
  messages: { userChanged: message<{ userUuid: string }>() },       // 앱 → RN
});
```

```swift
// iOS
final class AppBridge: MyModuleHost {
    func getAccessToken() async throws -> MyModule.GetAccessTokenResponse { .init(token: token) }
}
MyModule.start(host: AppBridge())

NativepieceView(MyModule.Screen.request(.init(userUuid: id)))
    .onEvent(MyModule.Event.self) { event in ... }
```

```kotlin
// Android
MyModule.start(application, AppBridge())

MyModuleScreen(
    screen = MyModule.Screen.Request(MyModule.RequestProps(userUuid = id)),
    onEvent = { event -> ... },
)
```

## 명령

| 명령 | 하는 일 |
|---|---|
| `create-nativepiece <dir>` | 새 모듈 앱을 만들어요 |
| `nativepiece init` | 기존 RN 앱에 Nativepiece 설정을 추가해요 |
| `nativepiece doctor` | 프로젝트, 계약, 개발 환경을 점검해요 |
| `nativepiece codegen` | 계약에서 Swift·Kotlin 코드를 만들어요 (`.nativepiece/codegen`) |
| `nativepiece build ios [--dev]` | Swift Package를 만들어요. `--dev`는 Metro와 Fast Refresh를 쓰는 개발용이에요 |
| `nativepiece build android` | Maven 저장소를 만들어요 |
| `nativepiece dev` | Metro 개발 서버를 띄워요 |
| `nativepiece publish ios [--repo owner/name] [--dry-run]` | Swift Package를 배포 레포에 올려요. 바이너리는 GitHub Release에 올라가요 |

## iOS 배포

```bash
npx nativepiece build ios
npx nativepiece publish ios --repo my-org/my-module-ios
```

- 배포 레포에는 원격용 `Package.swift`와 소스가 커밋되고 버전 태그(`config.version`)가 붙어요. XCFramework는 그 태그의 GitHub Release에 zip으로 올라가요.
- 앱에서는 `.package(url: "https://github.com/my-org/my-module-ios", exact: "1.0.0")`로 추가해요.
- 같은 버전은 덮어쓰지 않아요. 배포할 때마다 `package.json`의 version을 올려요.
- 배포 레포가 비공개면 Xcode가 바이너리를 받을 수 있게 앱 개발자 PC와 CI의 `~/.netrc`에 읽기 토큰을 넣어야 해요. git clone 인증도 같은 파일로 할 수 있어요.

```
machine api.github.com
  login x-access-token
  password <GitHub 토큰>
machine github.com
  login x-access-token
  password <GitHub 토큰>
```

## 요구 사항

- React Native 0.84 이상 (New Architecture, Hermes)
- Node 22.11 이상
- iOS 빌드: Xcode, CocoaPods
- Android 빌드: JDK 17, Android SDK

## 패키지

| 경로 | 패키지 |
|---|---|
| `packages/cli` | `@nativepiece/cli` |
| `packages/runtime` | `@nativepiece/runtime` (JS API와 TurboModule) |
| `packages/create-nativepiece` | `create-nativepiece` (템플릿 포함) |
| `packages/ios-host` | Swift 호스트 SDK (`NativepieceKit`). 결과물 Swift Package에 소스로 들어가요 |
| `packages/android-host` | Kotlin 호스트 SDK. 결과물 SDK AAR에 들어가요 |
| `packages/android-compose` | Compose 호스트 SDK. `<artifactId>-compose`에 들어가요 |
