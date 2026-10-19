package {{androidPackage}}.example

import android.app.Application
import android.util.Log
import {{androidPackage}}.{{name}}
import io.nativepiece.host.Nativepiece
import io.nativepiece.host.NativepieceTypedReply

/** 모듈이 `host.call(...)`로 요청하는 기능을 앱이 구현해요. 빠뜨리면 컴파일 오류가 나요. */
class AppBridge(private val application: Application) : {{name}}.Host {
    override fun getAppInfo(reply: NativepieceTypedReply<{{name}}.GetAppInfoResponse>) {
        val version = application.packageManager.getPackageInfo(application.packageName, 0).versionName ?: "0"
        reply.resolve({{name}}.GetAppInfoResponse(appVersion = version, platform = {{name}}.GetAppInfoResponsePlatform.ANDROID))
    }
}

class ExampleApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Nativepiece.onMetric { metric -> Log.i("Nativepiece", metric.toString()) }
        // devServer = true면 디버그 빌드에서 Metro(npm start)에 연결해요. Metro가 없으면 앱에 든 번들을 써요.
        {{name}}.start(this, AppBridge(this), devServer = true)
    }
}
