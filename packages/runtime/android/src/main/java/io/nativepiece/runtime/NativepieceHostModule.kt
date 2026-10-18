package io.nativepiece.runtime

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.CxxCallbackImpl
import com.facebook.react.bridge.ReactApplicationContext

class NativepieceHostModule(reactContext: ReactApplicationContext) : NativeNativepieceHostSpec(reactContext) {
    private val sink = NativepieceEventRouter.MessageSink { surfaceId, name, payloadJson ->
        emitOnHostMessage(
            Arguments.createMap().apply {
                if (surfaceId == null) putNull("surfaceId") else putString("surfaceId", surfaceId)
                putString("name", name)
                if (payloadJson == null) putNull("payloadJson") else putString("payloadJson", payloadJson)
            },
        )
    }

    // JS 이벤트 콜백이 연결되기 전에 emit하면 실패하므로, 연결된 뒤에 sink를 등록한다.
    override fun setEventEmitterCallback(eventEmitterCallback: CxxCallbackImpl) {
        super.setEventEmitterCallback(eventEmitterCallback)
        NativepieceEventRouter.setMessageSink(sink)
    }

    override fun emit(surfaceId: String, name: String, payloadJson: String?) {
        NativepieceEventRouter.dispatchEvent(surfaceId, name, payloadJson)
    }

    override fun invalidate() {
        NativepieceEventRouter.clearMessageSink(sink)
        super.invalidate()
    }

    companion object {
        const val NAME = NativeNativepieceHostSpec.NAME
    }
}
