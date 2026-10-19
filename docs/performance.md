# 성능 측정 결과 (P2)

PopPang-RN을 Nativepiece로 빌드해서 RN 화면을 열 때까지 걸리는 시간을 쟀어요. 시뮬레이터와 에뮬레이터에서 잰 값이라 실기기와 절대값은 달라요. 조건 사이의 차이를 보는 용도로 써 주세요.

## 요약

- **재진입은 거의 공짜예요.** 런타임을 앱 전체가 함께 쓰기 때문에 두 번째로 열 때부터 iOS 약 4ms, Android 약 18ms예요.
- **Hermes 바이트코드가 첫 진입을 크게 줄여요.** prewarm 없이 처음 열 때 iOS는 122ms에서 19ms로, Android는 204ms에서 96ms로 줄었어요.
- **prewarm은 런타임 준비 시간을 첫 진입 전으로 옮겨요.** 다만 시뮬레이터처럼 빠른 환경에서는 바이트코드 번들 평가가 원래 짧아서 차이가 작아요. 저사양 실기기에서 다시 재야 해요.
- **예전 PopPang 방식은 매번 cold였어요.** 화면마다 런타임을 새로 만들고 일반 JS 번들을 썼기 때문에, 열 때마다 아래 "일반 JS, prewarm 없음, 첫 진입"에 가까운 비용(iOS 약 122ms)을 냈을 거예요.

## 측정 방법

- 대상 화면: PopPang `request` 화면(제보하기). 실제 화면 컴포넌트를 그대로 써요.
- 지표: 호스트 SDK의 `onMetric`으로 받은 값이에요.
  - `runtimeReady`: 런타임 시작부터 JS 번들 평가가 끝나 화면이 등록될 때까지. prewarm이면 `start()` 호출부터, 아니면 첫 화면을 만든 순간부터 재요.
  - `surfaceMounted`: 네이티브가 화면을 만든 순간부터 RN 루트 컴포넌트가 처음 그려질 때까지예요.
- 앱을 완전히 종료한 뒤 새로 실행하는 것을 5번 반복하고 중앙값을 냈어요. 실행할 때마다 화면을 3번 열고 닫아서, 첫 번째를 "첫 진입", 나머지를 "재진입"으로 봤어요.
- "준비된 뒤 열기"는 앱 시작 3초 뒤에, "바로 열기"는 앱 시작 직후에 화면을 열었어요.
- 호스트 앱은 Release로 빌드했어요.

| 항목 | iOS | Android |
|---|---|---|
| 기기 | iPhone 17e 시뮬레이터 (iOS 27.0) | Pixel 7 에뮬레이터 (Android 16, arm64) |
| 호스트 | Mac (Apple Silicon), Xcode 27.0 | 같은 Mac, emulator `-gpu swiftshader_indirect` |
| 화면 방식 | SwiftUI `NativepieceView` | `NativepieceFragment` |
| RN | 0.86.0, New Architecture, Hermes V1 | 같음 |

## 결과 (중앙값, ms)

### iOS

| 번들 | prewarm | 화면 여는 시점 | runtimeReady | 첫 진입 | 재진입 |
|---|---|---|---|---|---|
| Hermes 바이트코드 | 켬 | 준비된 뒤 | 160.8 | 11.1 (warm) | 3.9 |
| Hermes 바이트코드 | 끔 | 준비된 뒤 | 12.6 | 19.4 (cold) | 4.2 |
| Hermes 바이트코드 | 켬 | 바로 | 167.8 | 20.4 (cold/warm 섞임) | 3.2 |
| 일반 JS | 끔 | 준비된 뒤 | 81.6 | 122.4 (cold) | 4.5 |
| 일반 JS | 켬 | 준비된 뒤 | 170.9 | 62.3 (warm) | 4.3 |

### Android

| 번들 | prewarm | 화면 여는 시점 | runtimeReady | 첫 진입 | 재진입 |
|---|---|---|---|---|---|
| Hermes 바이트코드 | 켬 | 준비된 뒤 | 134.0 | 74.4 (warm) | 20.7 |
| Hermes 바이트코드 | 끔 | 준비된 뒤 | 72.2 | 95.5 (cold) | 18.0 |
| Hermes 바이트코드 | 켬 | 바로 | 121.7 | 73.1 (cold/warm 섞임) | 15.8 |
| 일반 JS | 끔 | 준비된 뒤 | 137.6 | 204.2 (cold) | 22.5 |
| 일반 JS | 켬 | 준비된 뒤 | 297.8 | 108.4 (warm) | 14.2 |

## 읽을 때 주의할 점

- prewarm을 켜면 `runtimeReady`가 오히려 길게 나와요. 앱 시작과 동시에 런타임을 띄워서 앱 자체의 시작 작업과 CPU를 나눠 쓰기 때문이에요. 사용자가 기다리는 시간은 "첫 진입" 열이에요.
- runtime이 준비된 뒤 열어도 첫 진입이 재진입보다 길어요(Android 74ms 대 21ms). 화면 컴포넌트를 처음 그릴 때 드는 초기화 비용이에요. 테크 스펙의 `prerender`(화면 미리 그리기)로 줄일 수 있는 부분이라 다음 단계 후보로 남겨요.
- "바로 열기"는 실행마다 런타임 준비가 끝났는지 여부가 달라서 cold와 warm이 섞여 있어요.

## 결과물 크기

PopPang-RN v1.0.0 GitHub Release에 올라간 결과물과, 같은 PopPang-RN 코드를 Nativepiece로 빌드한 결과물을 비교했어요. 압축은 기존과 같은 zip(`ditto -c -k`, `zip -r`) 기준이에요.

### 배포 파일 (zip)

| 결과물 | 기존 PopPang-RN | Nativepiece | 차이 |
|---|---|---|---|
| iOS 패키지 | 63.9MB (`poppang-rn-spm`) + 0.34MB (`poppang-rn-ios-bundle`) | 63.2MB (번들 포함 한 파일) | -1.1MB, 파일 2개 → 1개 |
| Android 저장소 | 730.7MB (`poppang-rn-android-maven`) + 0.35MB (`poppang-rn-android-bundle`) | 40.6MB (번들, Compose artifact 포함) | **-690MB (-94%)**, 파일 2개 → 1개 |
| **합계** | **795.3MB** | **103.8MB** | **-87%** |

### 압축을 푼 크기

| 결과물 | 기존 | Nativepiece |
|---|---|---|
| iOS Swift Package | 263MB | 267MB |
| Android Maven 저장소 | 706MB | 40MB |

### Android가 줄어든 이유

| 기존 저장소 구성 | 크기 | Nativepiece |
|---|---|---|
| `com/facebook` (react-android, hermes-android 미러링) | 632MB | 넣지 않아요. 호스트 앱이 Maven Central에서 받아요 |
| `androidx`, `org` 등 기타 미러링 | 13MB | 넣지 않아요. 호스트 앱이 Google·Maven Central에서 받아요 |
| `com/poppang` SDK AAR (debug 47.5MB + release 26.3MB) | 74MB | debug 25.4MB + release 14.4MB = 40MB. ABI를 4개(armeabi-v7a, arm64-v8a, x86, x86_64)에서 2개(arm64-v8a, x86_64)로 줄였어요 |
| 네이티브 모듈 AAR 5개 | 1.2MB | 1.2MB (+ nativepiece_runtime 9.5KB) |

- 32비트 기기(armeabi-v7a)를 지원해야 하면 `android.abis`에 추가하면 돼요. 그 경우 SDK AAR은 기존과 비슷한 크기가 돼요.
- 미러링을 없앤 대신 호스트 앱 빌드 환경에서 Maven Central에 접근할 수 있어야 해요. 사용자 앱(APK) 크기는 미러링 여부와 상관없이 같아요.

### iOS가 거의 그대로인 이유

iOS는 기존에도 prebuilt React Native(React.xcframework 113MB, ReactNativeDependencies 27MB, hermesvm 15MB)를 그대로 담는 구조라 바뀐 게 적어요. 늘어난 4MB는 아래와 같아요.

- `NativepieceRuntime.xcframework` 0.5MB와, 그 TurboModule spec 때문에 커진 `ReactCodegen` 1.6MB
- Swift Package 안에 들어간 JS 번들과 호스트 SDK 소스 2.2MB

### JS 번들

| | 기존 (일반 JS, minify) | Nativepiece (Hermes 바이트코드) |
|---|---|---|
| 크기 | 1.32MB | 1.50MB (+14%) |
| 첫 진입 (iOS, prewarm 없음) | 122.4ms | 19.4ms |

바이트코드는 일반 JS보다 조금 커요. 대신 실행할 때 파싱과 컴파일을 건너뛰어 첫 진입이 크게 빨라져요.

## 다음에 잴 것

- 실기기(iPhone, 중급 Android)에서 같은 조건으로 다시 재기
- `prerender` 구현 뒤 첫 진입 비교
- PopPang-iOS에 적용한 뒤(로드맵 마지막) 실제 앱에서 예전 방식과 직접 비교
- 사용자 앱 크기 증가분(App Store 앱 크기 보고서, Android App Bundle의 기기별 APK)
