package io.nativepiece.host

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.view.View
import com.facebook.react.interfaces.fabric.ReactSurface
import com.facebook.react.modules.core.DefaultHardwareBackBtnHandler
import java.util.UUID

/**
 * RN 화면 하나의 surface예요. Fragment와 Compose가 이 클래스로 화면을 만들어요.
 *
 * [start]로 화면을 그리고, 다 쓰면 [destroy]를 호출해요.
 */
class NativepieceSurface @JvmOverloads constructor(
    context: Context,
    val screen: String,
    props: Bundle = Bundle(),
    val surfaceId: String = UUID.randomUUID().toString(),
) {
    private val handlers = mutableMapOf<String, (NativepiecePayload) -> Unit>()
    private val anyEventHandlers = mutableListOf<(String, NativepiecePayload) -> Unit>()
    private val surface: ReactSurface

    /** RN 화면이 닫기를 요청했을 때 실행해요. */
    var onClose: (() -> Unit)? = null

    val view: View
        get() = surface.view ?: error("React surface view를 만들지 못했어요.")

    init {
        Channel.setEventHandler(surfaceId) { name, payload -> handle(name, payload) }
        val initialProps = Bundle(props).apply {
            putBundle(INTERNAL_PROP, Bundle().apply { putString("surfaceId", surfaceId) })
        }
        surface = Nativepiece.reactHost.createSurface(context, screen, initialProps)
    }

    fun start() {
        surface.start()
    }

    /** 화면을 멈추고 이벤트 handler를 해제해요. 다시 쓸 수 없어요. */
    fun destroy() {
        surface.stop()
        surface.detach()
        Channel.setEventHandler(surfaceId, null)
    }

    /** 화면을 가진 Activity가 앞으로 나왔을 때 호출해요. */
    fun onHostResume(activity: Activity, backHandler: DefaultHardwareBackBtnHandler) {
        Nativepiece.reactHost.onHostResume(activity, backHandler)
    }

    fun onHostPause(activity: Activity) {
        Nativepiece.reactHost.onHostPause(activity)
    }

    /** 뒤로 가기를 RN에 넘겨요. RN이 처리하지 않으면 backHandler가 불려요. */
    fun onBackPressed() {
        Nativepiece.reactHost.onBackPressed()
    }

    /** RN 화면이 보낸 이벤트를 받아요. */
    fun on(name: String, handler: (payload: NativepiecePayload) -> Unit) {
        handlers[name] = handler
    }

    /** 모든 이벤트를 받아요. 생성된 타입 이벤트 API가 이 함수를 써요. */
    fun onAnyEvent(handler: (name: String, payload: NativepiecePayload) -> Unit) {
        anyEventHandlers += handler
    }

    /** 이 화면에만 메시지를 보내요. [payload]는 Map, List, 기본 타입, JSONObject 중 하나예요. */
    @JvmOverloads
    fun send(name: String, payload: Any? = null) {
        Channel.sendMessage(name, payload, surfaceId)
    }

    fun send(message: NativepieceMessageRepresentable) = send(message.messageName, message.messagePayload())

    private fun handle(name: String, payload: NativepiecePayload) {
        if (name == CLOSE_EVENT) {
            onClose?.invoke()
            return
        }
        handlers[name]?.invoke(payload)
        anyEventHandlers.forEach { it(name, payload) }
    }

    companion object {
        /** RN 쪽 `NAVIGATION_EVENT.close`와 같은 값이에요. */
        const val CLOSE_EVENT = "np.close"

        private const val INTERNAL_PROP = "__nativepiece"
    }
}
