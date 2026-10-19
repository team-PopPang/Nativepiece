package io.nativepiece.host

import android.app.Application
import android.content.pm.ApplicationInfo
import android.security.NetworkSecurityPolicy
import android.util.Log
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

/**
 * 앱 전체가 함께 쓰는 React Native 런타임이에요.
 *
 * 화면마다 런타임을 새로 만들지 않고, 프로세스에 하나만 만든 뒤 화면마다 surface만 만들어요.
 */
object Nativepiece {
    internal const val BUNDLE_ASSET_NAME = "main.android.bundle"
    private const val TAG = "Nativepiece"

    private var host: ReactHost? = null

    internal val reactHost: ReactHost
        get() = host ?: error("Nativepiece.init(application)을 먼저 호출해 주세요.")

    /**
     * 런타임을 만들어요. [prewarm]이 true면 화면을 열기 전에 JS 번들을 미리 불러와요.
     *
     * [devServerEntry]를 넘기면 디버그 빌드에서 Metro 개발 서버의 번들을 써요(Fast Refresh, 개발 메뉴 포함).
     * Metro에 연결할 수 없으면 앱에 들어 있는 번들로 돌아가요. 릴리스 빌드에서는 무시해요.
     */
    @JvmStatic
    @JvmOverloads
    @Synchronized
    fun init(application: Application, prewarm: Boolean = true, devServerEntry: String? = null) {
        if (host != null) return

        val debuggable = application.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        val useDevServer = devServerEntry != null && debuggable
        if (useDevServer && !NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted("10.0.2.2")) {
            // Metro는 http라서 평문 통신이 막혀 있으면 연결 확인이 조용히 실패하고 앱 안의 번들을 쓴다.
            Log.w(
                TAG,
                "평문 HTTP가 막혀 있어서 Metro에 연결할 수 없어요. 앱의 src/debug/AndroidManifest.xml에 " +
                    "<application android:usesCleartextTraffic=\"true\" />를 추가해 주세요.",
            )
        }

        Channel.install()
        MetricsTracker.runtimeStarted(prewarm)
        SoLoader.init(application, OpenSourceMergedSoMapping)
        DefaultNewArchitectureEntryPoint.load()

        val reactHost = DefaultReactHost.getDefaultReactHost(
            context = application,
            packageList = NativepiecePackageList(application).packages,
            jsMainModulePath = devServerEntry ?: "index",
            jsBundleAssetPath = BUNDLE_ASSET_NAME,
            useDevSupport = useDevServer,
        )
        host = reactHost
        if (prewarm) reactHost.start()
    }

    /** 모든 화면에 메시지를 보내요. [payload]는 Map, List, 기본 타입, JSONObject 중 하나예요. */
    @JvmStatic
    @JvmOverloads
    fun send(name: String, payload: Any? = null) {
        Channel.sendMessage(name, payload, null)
    }

    /** RN의 `host.call(name, ...)` 요청을 처리해요. [NativepieceReply]로 응답해요. */
    @JvmStatic
    fun handle(name: String, handler: NativepieceCallHandler) {
        Channel.setCallHandler(name, handler)
    }

    /** 성능 지표를 받아요. 분석 도구로 보내거나 로그로 남길 때 써요. */
    @JvmStatic
    fun onMetric(handler: NativepieceMetricHandler?) {
        MetricsTracker.handler = handler
    }

    /** 등록한 `call` 처리기를 지워요. */
    @JvmStatic
    fun removeHandler(name: String) {
        Channel.setCallHandler(name, null)
    }
}
