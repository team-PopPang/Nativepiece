import Foundation

/// Metro 개발 서버 주소예요. `nativepiece build ios --dev`로 만든 개발용 패키지에서 써요.
public struct NativepieceDevServer: Sendable {
    /// 예: `localhost:8081`, `192.168.0.10:8081`
    public var host: String

    public init(host: String = "localhost:8081") {
        self.host = host
    }

    public static let localhost = NativepieceDevServer()

    /// Metro가 실행 중이면 번들 주소를, 아니면 nil을 돌려줘요. nil이면 앱에 들어 있는 번들을 써요.
    public func bundleURL(entry: String) -> URL? {
        guard isRunning() else {
            print("[Nativepiece] Metro(\(host))에 연결하지 못해서 앱에 들어 있는 번들을 써요. `npx nativepiece dev`로 Metro를 띄워 주세요.")
            return nil
        }
        var components = URLComponents()
        components.scheme = "http"
        components.percentEncodedHost = host.split(separator: ":").first.map(String.init)
        components.port = host.split(separator: ":").dropFirst().first.flatMap { Int($0) }
        components.path = "/\(entry).bundle"
        components.queryItems = [
            URLQueryItem(name: "platform", value: "ios"),
            URLQueryItem(name: "dev", value: "true"),
            URLQueryItem(name: "minify", value: "false"),
            URLQueryItem(name: "app", value: Bundle.main.bundleIdentifier),
        ]
        return components.url
    }

    // RN의 RCTBundleURLProvider처럼 /status 응답으로 Metro 실행 여부를 확인한다. 개발 중 앱 시작 시에만 한 번 호출된다.
    private func isRunning() -> Bool {
        guard let url = URL(string: "http://\(host)/status") else { return false }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 1)
        request.httpMethod = "GET"

        let semaphore = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var running = false
        URLSession.shared.dataTask(with: request) { data, _, _ in
            running = data.map { String(decoding: $0, as: UTF8.self) } == "packager-status:running"
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 1.5)
        return running
    }
}
