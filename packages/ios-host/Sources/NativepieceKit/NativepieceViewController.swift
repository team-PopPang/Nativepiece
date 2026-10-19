import SwiftUI
import UIKit

/// RN 화면 하나를 보여 주는 view controller예요.
open class NativepieceViewController: UIViewController {
    /// RN 쪽 `NAVIGATION_EVENT.close`와 같은 값이에요.
    public static let closeEvent = "np.close"

    public let screen: String
    public let surfaceId = UUID().uuidString

    /// RN 화면이 닫기를 요청했을 때 실행해요. 지정하지 않으면 dismiss 또는 pop해요.
    public var onClose: (() -> Void)?

    private let properties: [String: Any]
    private var handlers: [String: (NativepiecePayload) -> Void] = [:]
    private var eventSetHandlers: [(String, NativepiecePayload) -> Void] = []

    public init(screen: String, properties: [String: Any] = [:]) {
        self.screen = screen
        self.properties = properties
        super.init(nibName: nil, bundle: nil)
    }

    public convenience init(screen: String, props: some Encodable) throws {
        self.init(screen: screen, properties: try JSONPayload.object(from: props))
    }

    public convenience init(_ screen: some NativepieceScreenRepresentable) throws {
        self.init(screen: screen.screenName, properties: try screen.screenProperties())
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        let surfaceId = surfaceId
        Task { @MainActor in
            Channel.shared.setEventHandler(nil, forSurface: surfaceId)
            MetricsTracker.shared.surfaceRemoved(surfaceId)
        }
    }

    override open func loadView() {
        Channel.shared.setEventHandler({ [weak self] name, payload in
            self?.handle(name: name, payload: payload)
        }, forSurface: surfaceId)

        MetricsTracker.shared.surfaceCreated(surfaceId, screen: screen)
        var initialProperties = properties
        initialProperties["__nativepiece"] = ["surfaceId": surfaceId]
        view = Nativepiece.shared.makeRootView(moduleName: screen, properties: initialProperties)
    }

    /// RN 화면이 보낸 이벤트를 받아요.
    public func on(_ name: String, perform handler: @escaping (NativepiecePayload) -> Void) {
        handlers[name] = handler
    }

    /// RN 화면이 보낸 이벤트를 타입으로 받아요. 디코딩에 실패한 이벤트는 무시해요.
    public func on<Payload: Decodable>(_ name: String, as type: Payload.Type, perform handler: @escaping (Payload) -> Void) {
        handlers[name] = { payload in
            guard let value = try? payload.decode(Payload.self) else {
                assertionFailure("[Nativepiece] \(name) 이벤트를 \(Payload.self)로 디코딩하지 못했어요: \(payload.json ?? "nil")")
                return
            }
            handler(value)
        }
    }

    /// 계약에서 생성한 이벤트 타입으로 받아요. 예: `controller.on(PopPangRN.Event.self) { event in ... }`
    public func on<Event: NativepieceEventRepresentable>(_ type: Event.Type, perform handler: @escaping (Event) -> Void) {
        eventSetHandlers.append { name, payload in
            do {
                if let event = try Event(name: name, payload: payload) { handler(event) }
            } catch {
                assertionFailure("[Nativepiece] \(name) 이벤트를 \(Event.self)로 디코딩하지 못했어요: \(error)")
            }
        }
    }

    /// 이 화면에만 메시지를 보내요.
    public func send(_ name: String, payload: (any Encodable)? = nil) throws {
        try Channel.shared.sendMessage(name, payload: payload, toSurface: surfaceId)
    }

    /// 계약에서 생성한 메시지 타입으로 이 화면에 보내요.
    public func send(_ message: some NativepieceMessageRepresentable) throws {
        try send(message.messageName, payload: message.messagePayload)
    }

    private func handle(name: String, payload: NativepiecePayload) {
        if name == Self.closeEvent {
            close()
            return
        }
        handlers[name]?(payload)
        eventSetHandlers.forEach { $0(name, payload) }
    }

    private func close() {
        if let onClose {
            onClose()
        } else if let navigationController, navigationController.viewControllers.first !== self {
            navigationController.popViewController(animated: true)
        } else {
            dismiss(animated: true)
        }
    }
}

/// SwiftUI에서 RN 화면을 보여 줘요.
public struct NativepieceView: UIViewControllerRepresentable {
    private let screen: String
    private let properties: [String: Any]
    private var eventHandlers: [String: (NativepiecePayload) -> Void] = [:]
    private var closeHandler: (() -> Void)?
    private var configure: [(NativepieceViewController) -> Void] = []

    public init(screen: String, properties: [String: Any] = [:]) {
        self.screen = screen
        self.properties = properties
    }

    public init(screen: String, props: some Encodable) throws {
        self.init(screen: screen, properties: try JSONPayload.object(from: props))
    }

    /// 계약에서 생성한 화면 타입으로 열어요. 예: `NativepieceView(PopPangRN.Screen.request(.init(userUuid: id)))`
    public init(_ screen: some NativepieceScreenRepresentable) {
        let properties: [String: Any]
        do {
            properties = try screen.screenProperties()
        } catch {
            assertionFailure("[Nativepiece] \(screen.screenName) 화면 props를 만들지 못했어요: \(error)")
            properties = [:]
        }
        self.init(screen: screen.screenName, properties: properties)
    }

    public func onEvent(_ name: String, perform handler: @escaping (NativepiecePayload) -> Void) -> Self {
        var copy = self
        copy.eventHandlers[name] = handler
        return copy
    }

    public func onEvent<Payload: Decodable>(_ name: String, as type: Payload.Type, perform handler: @escaping (Payload) -> Void) -> Self {
        onEvent(name) { payload in
            guard let value = try? payload.decode(Payload.self) else {
                assertionFailure("[Nativepiece] \(name) 이벤트를 \(Payload.self)로 디코딩하지 못했어요: \(payload.json ?? "nil")")
                return
            }
            handler(value)
        }
    }

    /// 계약에서 생성한 이벤트 타입으로 받아요. 예: `.onEvent(PopPangRN.Event.self) { event in ... }`
    public func onEvent<Event: NativepieceEventRepresentable>(_ type: Event.Type, perform handler: @escaping (Event) -> Void) -> Self {
        var copy = self
        copy.configure.append { $0.on(type, perform: handler) }
        return copy
    }

    /// RN 화면이 닫기를 요청했을 때 실행해요. SwiftUI에서는 dismiss를 직접 처리해야 해요.
    public func onClose(perform action: @escaping () -> Void) -> Self {
        var copy = self
        copy.closeHandler = action
        return copy
    }

    public func makeUIViewController(context: Context) -> NativepieceViewController {
        let controller = NativepieceViewController(screen: screen, properties: properties)
        apply(to: controller)
        // 타입 이벤트 처리기는 누적되므로 처음 만들 때 한 번만 등록한다.
        configure.forEach { $0(controller) }
        return controller
    }

    public func updateUIViewController(_ controller: NativepieceViewController, context: Context) {
        apply(to: controller)
    }

    private func apply(to controller: NativepieceViewController) {
        for (name, handler) in eventHandlers {
            controller.on(name, perform: handler)
        }
        controller.onClose = closeHandler
    }
}
