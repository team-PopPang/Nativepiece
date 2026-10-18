package io.nativepiece.runtime

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class NativepieceRuntimePackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == NativepieceHostModule.NAME) NativepieceHostModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            NativepieceHostModule.NAME to ReactModuleInfo(
                NativepieceHostModule.NAME,
                NativepieceHostModule::class.java.name,
                false,
                false,
                false,
                true,
            ),
        )
    }
}
