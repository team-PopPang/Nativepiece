import SwiftUI
import {{name}}

/// 모듈이 `host.call(...)`로 요청하는 기능을 앱이 구현해요. 빠뜨리면 컴파일 오류가 나요.
final class AppBridge: {{name}}Host {
    func getAppInfo() async throws -> {{name}}.GetAppInfoResponse {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        return .init(appVersion: version, platform: .ios)
    }
}

@main
struct ExampleHostApp: App {
    private static let bridge = AppBridge()

    init() {
        Nativepiece.shared.onMetric { metric in
            print("[Nativepiece] \(metric)")
        }
        // 개발용 패키지(npm run build:ios:dev)를 쓸 때는 devServer: .localhost를 넘기면 Metro에 연결돼요.
        {{name}}.start(host: Self.bridge)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var showModule = ProcessInfo.processInfo.arguments.contains("-openModule")
    @State private var lastEvent = "-"

    var body: some View {
        NavigationStack {
            List {
                Button("RN 화면 열기") { showModule = true }
                LabeledContent("마지막 이벤트", value: lastEvent)
            }
            .navigationTitle("Example Host")
            .fullScreenCover(isPresented: $showModule) {
                NativepieceView({{name}}.Screen.home(.init(userName: "iOS")))
                    .onEvent({{name}}.Event.self) { event in
                        switch event {
                        case .buttonPressed(let payload):
                            lastEvent = "buttonPressed \(Int(payload.count))"
                            // 누를 때마다 테마를 바꿔서 호스트 → RN 메시지를 보여 줘요.
                            try? Nativepiece.shared.send({{name}}.Message.themeChanged(.init(dark: Int(payload.count) % 2 == 1)))
                        }
                    }
                    .onClose { showModule = false }
                    .ignoresSafeArea()
            }
        }
    }
}
