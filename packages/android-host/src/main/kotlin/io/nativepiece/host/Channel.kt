package io.nativepiece.host

import io.nativepiece.runtime.NativepieceChannel
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/** `call` 처리 중 RN으로 돌려줄 오류예요. `code`는 JS의 `NativepieceCallError.code`로 전달돼요. */
class NativepieceCallError(val code: String, override val message: String) : Exception(message)

/** RN이 보낸 JSON payload예요. */
class NativepiecePayload internal constructor(private val value: Any?) {
    internal val raw: Any?
        get() = value

    /** JSON 문자열로 받아요. payload가 없으면 null이에요. */
    val json: String?
        get() = value?.let { if (it == JSONObject.NULL) null else JSONObject.wrap(it).toString() }

    fun asJSONObject(): JSONObject = value as? JSONObject ?: JSONObject()

    fun asJSONArray(): JSONArray = value as? JSONArray ?: JSONArray()

    fun asString(): String? = value as? String
}

/** `call`에 응답해요. 둘 중 하나를 한 번만 호출해야 해요. */
class NativepieceReply internal constructor(private val id: String) {
    private var replied = false

    /** [value]는 Map, List, String, Number, Boolean, JSONObject, JSONArray 또는 null이에요. */
    fun resolve(value: Any? = null) = once {
        Channel.post(envelope("result").put("id", id).put("ok", true).put("payload", toJson(value)))
    }

    fun reject(error: NativepieceCallError) = once {
        Channel.post(
            envelope("result").put("id", id).put("ok", false)
                .put("error", JSONObject().put("code", error.code).put("message", error.message)),
        )
    }

    private fun once(block: () -> Unit) {
        check(!replied) { "call에는 한 번만 응답할 수 있어요." }
        replied = true
        block()
    }
}

fun interface NativepieceCallHandler {
    fun handle(payload: NativepiecePayload, reply: NativepieceReply)
}

internal fun envelope(kind: String): JSONObject =
    JSONObject().put("v", NativepieceChannel.PROTOCOL_VERSION).put("kind", kind)

internal fun toJson(value: Any?): Any = if (value == null) JSONObject.NULL else JSONObject.wrap(value) ?: JSONObject.NULL

/** RN과 호스트 사이의 envelope을 해석하고 라우팅해요. 모든 메서드는 메인 스레드에서 불려요. */
internal object Channel {
    private val surfaceHandlers = mutableMapOf<String, (String, NativepiecePayload) -> Unit>()
    private val callHandlers = mutableMapOf<String, NativepieceCallHandler>()

    fun install() {
        NativepieceChannel.setHostHandler { json -> receive(json) }
    }

    fun setEventHandler(surfaceId: String, handler: ((String, NativepiecePayload) -> Unit)?) {
        if (handler == null) surfaceHandlers.remove(surfaceId) else surfaceHandlers[surfaceId] = handler
    }

    fun setCallHandler(name: String, handler: NativepieceCallHandler?) {
        if (handler == null) callHandlers.remove(name) else callHandlers[name] = handler
    }

    fun sendMessage(name: String, payload: Any?, surfaceId: String?) {
        post(
            envelope("message")
                .put("surfaceId", surfaceId ?: JSONObject.NULL)
                .put("name", name)
                .put("payload", toJson(payload)),
        )
    }

    fun post(envelope: JSONObject) {
        NativepieceChannel.postToJs(envelope.toString())
    }

    private fun receive(json: String) {
        val envelope = runCatching { JSONTokener(json).nextValue() as JSONObject }.getOrNull() ?: return
        val version = envelope.optInt("v", NativepieceChannel.PROTOCOL_VERSION)
        check(version == NativepieceChannel.PROTOCOL_VERSION) {
            "[Nativepiece] 프로토콜 버전이 달라요 (JS $version, native ${NativepieceChannel.PROTOCOL_VERSION})"
        }

        val name = envelope.optString("name")
        val payload = NativepiecePayload(envelope.opt("payload"))
        val surfaceId = envelope.optString("surfaceId")

        when (envelope.optString("kind")) {
            "event" -> surfaceHandlers[surfaceId]?.invoke(name, payload)
            "call" -> {
                val reply = NativepieceReply(envelope.optString("id"))
                val handler = callHandlers[name]
                    ?: return reply.reject(NativepieceCallError("unhandled", "호스트에 $name 처리기가 없어요."))
                try {
                    handler.handle(payload, reply)
                } catch (error: NativepieceCallError) {
                    reply.reject(error)
                } catch (error: Exception) {
                    reply.reject(NativepieceCallError("failed", error.toString()))
                }
            }
        }
    }
}
