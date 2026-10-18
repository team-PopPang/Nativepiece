package io.nativepiece.runtime

import android.os.Handler
import android.os.Looper

/**
 * RN과 네이티브 호스트 사이에서 envelope(JSON 문자열)을 그대로 전달한다.
 * 라우팅과 해석은 호스트 SDK가 맡는다.
 */
object NativepieceChannel {
    /** 호스트 SDK와 RN이 주고받는 프로토콜 버전. JS의 PROTOCOL_VERSION과 같아야 한다. */
    const val PROTOCOL_VERSION = 1

    // 한쪽이 아직 준비되지 않았을 때 쌓아 두는 envelope 수의 상한이다.
    private const val MAX_PENDING_ENVELOPES = 200

    fun interface EnvelopeHandler {
        fun onEnvelope(envelopeJson: String)
    }

    private val lock = Any()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val pendingToHost = ArrayDeque<String>()
    private val pendingToJs = ArrayDeque<String>()
    private var hostHandler: EnvelopeHandler? = null
    private var jsSink: EnvelopeHandler? = null

    /** RN이 보낸 envelope을 받을 handler를 등록한다. 등록 전에 온 envelope은 등록할 때 전달한다. */
    @JvmStatic
    fun setHostHandler(handler: EnvelopeHandler?) {
        val flushed = synchronized(lock) {
            hostHandler = handler
            if (handler == null) return
            pendingToHost.toList().also { pendingToHost.clear() }
        }
        mainHandler.post { flushed.forEach(handler!!::onEnvelope) }
    }

    /** RN으로 envelope을 보낸다. JS 쪽이 준비되기 전에 보낸 envelope은 쌓아 뒀다가 전달한다. */
    @JvmStatic
    fun postToJs(envelopeJson: String) {
        val sink = synchronized(lock) {
            jsSink ?: run {
                enqueue(pendingToJs, envelopeJson)
                return
            }
        }
        sink.onEnvelope(envelopeJson)
    }

    internal fun receiveFromJs(envelopeJson: String) {
        val handler = synchronized(lock) {
            hostHandler ?: run {
                enqueue(pendingToHost, envelopeJson)
                return
            }
        }
        // 호스트 handler는 UI를 다루므로 메인 스레드에서 실행한다.
        mainHandler.post { handler.onEnvelope(envelopeJson) }
    }

    internal fun setJsSink(sink: EnvelopeHandler) {
        val flushed = synchronized(lock) {
            jsSink = sink
            pendingToJs.toList().also { pendingToJs.clear() }
        }
        flushed.forEach(sink::onEnvelope)
    }

    // 지금 등록된 sink가 이 sink일 때만 해제한다. 새로 만들어진 모듈의 sink를 지우지 않기 위해서다.
    internal fun clearJsSink(sink: EnvelopeHandler) {
        synchronized(lock) {
            if (jsSink === sink) jsSink = null
        }
    }

    private fun enqueue(queue: ArrayDeque<String>, envelopeJson: String) {
        queue.addLast(envelopeJson)
        if (queue.size > MAX_PENDING_ENVELOPES) queue.removeFirst()
    }
}
