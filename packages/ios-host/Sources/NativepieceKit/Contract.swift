import Foundation

/// 열 수 있는 RN 화면이에요. `nativepiece codegen`이 계약의 화면마다 만들어요.
public protocol NativepieceScreenRepresentable {
    var screenName: String { get }
    func screenProperties() throws -> [String: Any]
}

/// RN이 보내는 이벤트 묶음이에요. 모르는 이벤트 이름이면 nil을 돌려줘요.
public protocol NativepieceEventRepresentable {
    init?(name: String, payload: NativepiecePayload) throws
}

/// 호스트가 RN에 보내는 메시지예요.
public protocol NativepieceMessageRepresentable {
    var messageName: String { get }
    var messagePayload: (any Encodable)? { get }
}

/// 값이 없는 `call` 응답이에요. JSON null로 전달돼요.
public struct NativepieceNoValue: Codable, Sendable {
    public init() {}

    public init(from decoder: Decoder) throws {}

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encodeNil()
    }
}

public enum NativepieceJSON {
    /// 화면 props를 RN initialProperties로 쓸 수 있는 딕셔너리로 바꿔요.
    public static func object(from value: some Encodable) throws -> [String: Any] {
        try JSONPayload.object(from: value)
    }
}

extension Nativepiece {
    /// 모든 화면에 메시지를 보내요.
    @MainActor
    public func send(_ message: some NativepieceMessageRepresentable) throws {
        try send(message.messageName, payload: message.messagePayload)
    }
}
