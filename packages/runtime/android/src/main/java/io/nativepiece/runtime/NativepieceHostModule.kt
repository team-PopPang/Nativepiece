package io.nativepiece.runtime

import com.facebook.react.bridge.CxxCallbackImpl
import com.facebook.react.bridge.ReactApplicationContext

class NativepieceHostModule(reactContext: ReactApplicationContext) : NativeNativepieceHostSpec(reactContext) {
    private val sink = NativepieceChannel.EnvelopeHandler { envelopeJson -> emitOnEnvelope(envelopeJson) }

    // JS 이벤트 콜백이 연결되기 전에 emit하면 실패하므로, 연결된 뒤에 sink를 등록한다.
    override fun setEventEmitterCallback(eventEmitterCallback: CxxCallbackImpl) {
        super.setEventEmitterCallback(eventEmitterCallback)
        NativepieceChannel.setJsSink(sink)
    }

    override fun post(envelopeJson: String) {
        NativepieceChannel.receiveFromJs(envelopeJson)
    }

    override fun protocolVersion(): Double = NativepieceChannel.PROTOCOL_VERSION.toDouble()

    override fun invalidate() {
        NativepieceChannel.clearJsSink(sink)
        super.invalidate()
    }

    companion object {
        const val NAME = NativeNativepieceHostSpec.NAME
    }
}
