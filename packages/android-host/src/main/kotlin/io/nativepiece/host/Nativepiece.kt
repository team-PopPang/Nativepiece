package io.nativepiece.host

import android.app.Application
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import io.nativepiece.runtime.NativepieceEventRouter
import org.json.JSONObject

/**
 * 앱 전체가 함께 쓰는 React Native 런타임이에요.
 *
 * 화면마다 런타임을 새로 만들지 않고, 프로세스에 하나만 만든 뒤 화면마다 surface만 만들어요.
 */
object Nativepiece {
    internal const val BUNDLE_ASSET_NAME = "main.android.bundle"

    private var host: ReactHost? = null

    internal val reactHost: ReactHost
        get() = host ?: error("Nativepiece.init(application)을 먼저 호출해 주세요.")

    /** 런타임을 만들어요. [prewarm]이 true면 화면을 열기 전에 JS 번들을 미리 불러와요. */
    @JvmStatic
    @JvmOverloads
    @Synchronized
    fun init(application: Application, prewarm: Boolean = true) {
        if (host != null) return

        SoLoader.init(application, OpenSourceMergedSoMapping)
        DefaultNewArchitectureEntryPoint.load()

        val reactHost = DefaultReactHost.getDefaultReactHost(
            context = application,
            packageList = NativepiecePackageList(application).packages,
            jsBundleAssetPath = BUNDLE_ASSET_NAME,
            useDevSupport = false,
        )
        host = reactHost
        if (prewarm) reactHost.start()
    }

    /** 모든 화면에 메시지를 보내요. [payload]는 JSON으로 바꿀 수 있는 값이어야 해요. */
    @JvmStatic
    @JvmOverloads
    fun send(name: String, payload: Map<String, Any?>? = null) {
        NativepieceEventRouter.sendMessage(name, payload?.let { JSONObject(it).toString() }, null)
    }
}
