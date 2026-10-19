import Foundation

/// 런타임과 화면의 성능 지표예요. 시간 단위는 밀리초예요.
public enum NativepieceMetric: Sendable, CustomStringConvertible {
    /// `start()` 호출부터 JS 번들 평가가 끝날 때까지 걸린 시간이에요.
    case runtimeReady(durationMs: Double, prewarmed: Bool)

    /// 화면을 만든 순간부터 RN 루트 컴포넌트가 처음 그려질 때까지 걸린 시간이에요.
    /// `runtimeWasReady`가 true면 런타임이 이미 준비된 상태(warm)에서 연 화면이에요.
    case surfaceMounted(screen: String, durationMs: Double, runtimeWasReady: Bool)

    /// 화면을 만든 순간부터 RN이 `host.markReady()`를 부를 때까지 걸린 시간이에요.
    case surfaceReady(screen: String, durationMs: Double)

    public var description: String {
        switch self {
        case let .runtimeReady(duration, prewarmed):
            return "runtimeReady \(Self.format(duration))ms prewarmed=\(prewarmed)"
        case let .surfaceMounted(screen, duration, warm):
            return "surfaceMounted \(screen) \(Self.format(duration))ms \(warm ? "warm" : "cold")"
        case let .surfaceReady(screen, duration):
            return "surfaceReady \(screen) \(Self.format(duration))ms"
        }
    }

    private static func format(_ value: Double) -> String {
        String(format: "%.1f", value)
    }
}

/// 지표 계산에 필요한 시각을 기록해요.
@MainActor
final class MetricsTracker {
    static let shared = MetricsTracker()

    var handler: ((NativepieceMetric) -> Void)?

    private var startedAt: UInt64?
    private var prewarmed = false
    private var runtimeReadyAt: UInt64?
    private var surfaces: [String: (screen: String, createdAt: UInt64, runtimeWasReady: Bool)] = [:]

    private static func now() -> UInt64 {
        DispatchTime.now().uptimeNanoseconds
    }

    private static func milliseconds(since start: UInt64) -> Double {
        Double(now() - start) / 1_000_000
    }

    // prewarm하지 않으면 런타임은 첫 화면을 열 때 시작되므로, 그때부터 잰다.
    func runtimeStarted(prewarm: Bool) {
        guard startedAt == nil, prewarm else { return }
        startedAt = Self.now()
        prewarmed = true
    }

    func surfaceCreated(_ surfaceId: String, screen: String) {
        let now = Self.now()
        if startedAt == nil { startedAt = now }
        surfaces[surfaceId] = (screen, now, runtimeReadyAt != nil)
    }

    func surfaceRemoved(_ surfaceId: String) {
        surfaces[surfaceId] = nil
    }

    func lifecycle(_ name: String, surfaceId: String?) {
        switch name {
        case "runtimeReady":
            guard runtimeReadyAt == nil else { return }
            runtimeReadyAt = Self.now()
            if let startedAt {
                emit(.runtimeReady(durationMs: Self.milliseconds(since: startedAt), prewarmed: prewarmed))
            }
        case "surfaceMounted":
            guard let surfaceId, let surface = surfaces[surfaceId] else { return }
            emit(.surfaceMounted(
                screen: surface.screen,
                durationMs: Self.milliseconds(since: surface.createdAt),
                runtimeWasReady: surface.runtimeWasReady
            ))
        case "surfaceReady":
            guard let surfaceId, let surface = surfaces[surfaceId] else { return }
            emit(.surfaceReady(screen: surface.screen, durationMs: Self.milliseconds(since: surface.createdAt)))
        default:
            break
        }
    }

    private func emit(_ metric: NativepieceMetric) {
        handler?(metric)
    }
}

extension Nativepiece {
    /// 성능 지표를 받아요. 분석 도구로 보내거나 로그로 남길 때 써요.
    @MainActor
    public func onMetric(_ handler: @escaping (NativepieceMetric) -> Void) {
        MetricsTracker.shared.handler = handler
    }
}
