import Foundation
internal import NativepieceRuntime

/// RN과 주고받는 envelope 형식의 버전이에요. JS의 `PROTOCOL_VERSION`과 같아야 해요.
public let nativepieceProtocolVersion = 1

/// `call` 처리 중 RN으로 돌려줄 오류예요. `code`는 JS의 `NativepieceCallError.code`로 전달돼요.
public struct NativepieceCallError: Error {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

/// RN이 보낸 JSON payload예요. 원하는 타입으로 디코딩해서 써요.
public struct NativepiecePayload {
    let data: Data?

    public func decode<T: Decodable>(_ type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: data ?? Data("null".utf8))
    }

    /// 디코딩 없이 JSON 문자열로 받아요.
    public var json: String? {
        data.map { String(decoding: $0, as: UTF8.self) }
    }
}

/// RN과 호스트 사이의 envelope을 해석하고 라우팅해요.
@MainActor
final class Channel {
    static let shared = Channel()

    typealias EventHandler = (String, NativepiecePayload) -> Void
    typealias CallHandler = (NativepiecePayload, String) async throws -> (any Encodable)?

    private var surfaceHandlers: [String: EventHandler] = [:]
    private var callHandlers: [String: CallHandler] = [:]

    private init() {
        NPChannel.setHostHandler { json in
            MainActor.assumeIsolated {
                Channel.shared.receive(json)
            }
        }
    }

    func setEventHandler(_ handler: EventHandler?, forSurface surfaceId: String) {
        surfaceHandlers[surfaceId] = handler
    }

    func setCallHandler(_ handler: CallHandler?, for name: String) {
        callHandlers[name] = handler
    }

    func sendMessage(_ name: String, payload: (any Encodable)?, toSurface surfaceId: String?) throws {
        var envelope: [String: Any] = [
            "v": nativepieceProtocolVersion,
            "kind": "message",
            "surfaceId": surfaceId ?? NSNull(),
            "name": name,
        ]
        if let payload {
            envelope["payload"] = try JSONSerialization.jsonObject(
                with: try JSONEncoder().encode(payload),
                options: .fragmentsAllowed
            )
        }
        try post(envelope)
    }

    private func receive(_ json: String) {
        guard
            let object = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
            let kind = object["kind"] as? String,
            let name = object["name"] as? String
        else {
            assertionFailure("[Nativepiece] 잘못된 envelope을 받았어요: \(json)")
            return
        }
        if let version = object["v"] as? Int, version != nativepieceProtocolVersion {
            assertionFailure("[Nativepiece] 프로토콜 버전이 달라요 (JS \(version), native \(nativepieceProtocolVersion))")
        }

        let payload = NativepiecePayload(data: object["payload"].flatMap {
            try? JSONSerialization.data(withJSONObject: $0, options: .fragmentsAllowed)
        })
        let surfaceId = object["surfaceId"] as? String ?? ""

        switch kind {
        case "event":
            surfaceHandlers[surfaceId]?(name, payload)
        case "call":
            guard let id = object["id"] as? String else { return }
            handleCall(id: id, name: name, payload: payload, surfaceId: surfaceId)
        default:
            break
        }
    }

    private func handleCall(id: String, name: String, payload: NativepiecePayload, surfaceId: String) {
        guard let handler = callHandlers[name] else {
            postResult(id: id, error: NativepieceCallError(code: "unhandled", message: "호스트에 \(name) 처리기가 없어요."))
            return
        }
        Task { @MainActor in
            do {
                let result = try await handler(payload, surfaceId)
                try postResult(id: id, value: result)
            } catch let error as NativepieceCallError {
                postResult(id: id, error: error)
            } catch {
                postResult(id: id, error: NativepieceCallError(code: "failed", message: String(describing: error)))
            }
        }
    }

    private func postResult(id: String, value: (any Encodable)?) throws {
        var envelope: [String: Any] = ["v": nativepieceProtocolVersion, "kind": "result", "id": id, "ok": true]
        if let value {
            envelope["payload"] = try JSONSerialization.jsonObject(
                with: try JSONEncoder().encode(value),
                options: .fragmentsAllowed
            )
        }
        try post(envelope)
    }

    private func postResult(id: String, error: NativepieceCallError) {
        try? post([
            "v": nativepieceProtocolVersion,
            "kind": "result",
            "id": id,
            "ok": false,
            "error": ["code": error.code, "message": error.message],
        ])
    }

    private func post(_ envelope: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: envelope)
        NPChannel.post(toJS: String(decoding: data, as: UTF8.self))
    }
}
