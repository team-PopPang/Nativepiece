package io.nativepiece.runtime

import android.os.Handler
import android.os.Looper

// RN 화면과 네이티브 호스트 사이의 메시지를 surfaceId 단위로 연결한다.
object NativepieceEventRouter {
    fun interface EventHandler {
        fun onEvent(name: String, payloadJson: String?)
    }

    internal fun interface MessageSink {
        fun send(surfaceId: String?, name: String, payloadJson: String?)
    }

    private data class PendingMessage(val surfaceId: String?, val name: String, val payloadJson: String?)

    private val lock = Any()
    private val handlers = mutableMapOf<String, EventHandler>()
    private val pendingMessages = mutableListOf<PendingMessage>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var messageSink: MessageSink? = null

    // surfaceId 화면이 보낸 이벤트를 받을 handler를 등록한다. null이면 등록을 해제한다.
    @JvmStatic
    fun setHandler(surfaceId: String, handler: EventHandler?) {
        synchronized(lock) {
            if (handler == null) handlers.remove(surfaceId) else handlers[surfaceId] = handler
        }
    }

    // 앱이 RN으로 메시지를 보낸다. surfaceId가 null이면 모든 화면에 보낸다.
    @JvmStatic
    fun sendMessage(name: String, payloadJson: String?, surfaceId: String? = null) {
        val sink = synchronized(lock) {
            messageSink ?: run {
                pendingMessages += PendingMessage(surfaceId, name, payloadJson)
                return
            }
        }
        sink.send(surfaceId, name, payloadJson)
    }

    internal fun dispatchEvent(surfaceId: String, name: String, payloadJson: String?) {
        mainHandler.post {
            val handler = synchronized(lock) { handlers[surfaceId] }
            handler?.onEvent(name, payloadJson)
        }
    }

    // TurboModule이 만들어지면 sink를 등록하고, 그 전에 쌓인 메시지를 내보낸다.
    internal fun setMessageSink(sink: MessageSink?) {
        val flushed = synchronized(lock) {
            messageSink = sink
            if (sink == null) return
            pendingMessages.toList().also { pendingMessages.clear() }
        }
        flushed.forEach { sink!!.send(it.surfaceId, it.name, it.payloadJson) }
    }

    internal fun clearMessageSink(sink: MessageSink) {
        synchronized(lock) {
            if (messageSink === sink) messageSink = null
        }
    }
}
