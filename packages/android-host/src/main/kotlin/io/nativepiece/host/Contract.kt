package io.nativepiece.host

import android.os.Bundle
import com.facebook.react.bridge.Arguments
import org.json.JSONArray
import org.json.JSONObject

/** 열 수 있는 RN 화면이에요. `nativepiece codegen`이 계약의 화면마다 만들어요. */
interface NativepieceScreenRepresentable {
    val screenName: String

    /** 화면 props예요. 값이 없으면 null이에요. */
    fun screenProps(): JSONObject?
}

/** 호스트가 RN에 보내는 메시지예요. */
interface NativepieceMessageRepresentable {
    val messageName: String
    fun messagePayload(): Any?
}

/** `call`에 타입으로 응답해요. */
class NativepieceTypedReply<T> internal constructor(
    private val reply: NativepieceReply,
    private val encode: (T) -> Any?,
) {
    fun resolve(value: T) = reply.resolve(encode(value))

    fun reject(code: String, message: String) = reply.reject(NativepieceCallError(code, message))

    companion object {
        /** 생성 코드에서만 써요. */
        @JvmStatic
        fun <T> wrap(reply: NativepieceReply, encode: (T) -> Any?): NativepieceTypedReply<T> =
            NativepieceTypedReply(reply, encode)
    }
}

object NativepieceJson {
    /** RN initialProps로 쓸 수 있는 Bundle로 바꿔요. */
    @JvmStatic
    fun toBundle(json: JSONObject?): Bundle =
        if (json == null) Bundle() else Arguments.toBundle(Arguments.makeNativeMap(toMap(json))) ?: Bundle()

    /** payload를 JSONArray 0번 칸에 넣어 생성 코드가 같은 방식으로 꺼내 쓰게 해요. */
    @JvmStatic
    fun box(payload: NativepiecePayload): JSONArray = JSONArray().put(payload.raw ?: JSONObject.NULL)

    private fun toMap(json: JSONObject): Map<String, Any?> =
        json.keys().asSequence().associateWith { key -> unwrap(json.get(key)) }

    private fun unwrap(value: Any?): Any? = when (value) {
        JSONObject.NULL -> null
        is JSONObject -> toMap(value)
        is JSONArray -> List(value.length()) { index -> unwrap(value.get(index)) }
        else -> value
    }
}

fun NativepieceFragment.send(message: NativepieceMessageRepresentable) =
    send(message.messageName, message.messagePayload())

fun Nativepiece.send(message: NativepieceMessageRepresentable) =
    Nativepiece.send(message.messageName, message.messagePayload())
