import Foundation
import UIKit
internal import NativepieceRuntime
internal import React
internal import React_RCTAppDelegate
internal import ReactAppDependencyProvider

private final class NativepieceFactoryDelegate: RCTDefaultReactNativeFactoryDelegate {
    var bundleURLProvider: () -> URL? = { nil }

    override func sourceURL(for bridge: RCTBridge) -> URL? {
        bundleURL()
    }

    override func bundleURL() -> URL? {
        bundleURLProvider()
    }
}

/// 앱 전체가 함께 쓰는 React Native 런타임이에요.
///
/// 화면마다 런타임을 새로 만들지 않고, 프로세스에 하나만 만든 뒤 화면마다 surface만 만들어요.
public final class Nativepiece {
    public static let shared = Nativepiece()

    /// 앱에 들어 있는 번들 대신 쓸 번들 주소예요. 개발 중 Metro 서버를 쓸 때 지정해요.
    public var bundleURLOverride: URL?

    private var embeddedBundleURL: URL?
    private var factory: RCTReactNativeFactory?
    private var factoryDelegate: NativepieceFactoryDelegate?

    private init() {}

    /// 모듈 패키지가 호출해요. 앱에 들어 있는 JS 번들 위치를 등록해요.
    public func configure(embeddedBundleURL: URL?) {
        self.embeddedBundleURL = embeddedBundleURL
    }

    /// 런타임을 만들어요. `prewarm`이 true면 화면을 열기 전에 JS 번들을 미리 불러와요.
    @MainActor
    public func start(prewarm: Bool = true) {
        let factory = makeFactoryIfNeeded()
        guard prewarm else { return }
        initializeReactHost(of: factory)
    }

    /// 화면 없이 React host를 만들고 번들을 불러와요.
    ///
    /// release 빌드의 React에서는 `RCTDevMenuConfiguration.defaultConfiguration`이 nil을 돌려주는데,
    /// Swift는 이 인자를 non-null로 보기 때문에 직접 호출하면 크래시가 나요.
    /// RN 내부와 같은 값(nil 포함)을 넘기기 위해 Objective-C 메서드 구현을 직접 호출해요.
    @MainActor
    private func initializeReactHost(of factory: RCTReactNativeFactory) {
        typealias Initialize = @convention(c) (AnyObject, Selector, NSDictionary?, AnyObject, AnyObject?) -> Void
        let rootViewFactory = factory.rootViewFactory
        let selector = NSSelectorFromString("initializeReactHostWithLaunchOptions:bundleConfiguration:devMenuConfiguration:")
        guard rootViewFactory.responds(to: selector) else { return }
        let implementation = unsafeBitCast(rootViewFactory.method(for: selector), to: Initialize.self)
        implementation(rootViewFactory, selector, nil, factory.bundleConfiguration, factory.devMenuConfiguration)
    }

    /// 모든 화면에 메시지를 보내요.
    public func send(_ name: String, payload: (any Encodable)? = nil) throws {
        NPEventRouter.sendMessage(name, payloadJson: try JSONPayload.encode(payload), toSurface: nil)
    }

    @MainActor
    func makeRootView(moduleName: String, properties: [String: Any]) -> UIView {
        makeFactoryIfNeeded().rootViewFactory.view(withModuleName: moduleName, initialProperties: properties)
    }

    @MainActor
    private func makeFactoryIfNeeded() -> RCTReactNativeFactory {
        if let factory { return factory }

        let delegate = NativepieceFactoryDelegate()
        delegate.dependencyProvider = RCTAppDependencyProvider()
        delegate.bundleURLProvider = { [weak self] in
            guard let self else { return nil }
            if let override = self.bundleURLOverride { return override }
            guard let url = self.embeddedBundleURL else {
                assertionFailure("JS 번들 위치가 없어요. 모듈 패키지의 start()를 먼저 호출해 주세요.")
                return nil
            }
            return url
        }

        let factory = RCTReactNativeFactory(delegate: delegate)
        factoryDelegate = delegate
        self.factory = factory
        return factory
    }
}

enum JSONPayload {
    static func encode(_ payload: (any Encodable)?) throws -> String? {
        guard let payload else { return nil }
        let data = try JSONEncoder().encode(payload)
        return String(decoding: data, as: UTF8.self)
    }

    static func decode<T: Decodable>(_ type: T.Type, from json: String?) throws -> T {
        try JSONDecoder().decode(T.self, from: Data((json ?? "null").utf8))
    }

    static func object(from payload: some Encodable) throws -> [String: Any] {
        let data = try JSONEncoder().encode(payload)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NativepieceError.propsMustBeObject
        }
        return object
    }
}

public enum NativepieceError: Error {
    case propsMustBeObject
}
