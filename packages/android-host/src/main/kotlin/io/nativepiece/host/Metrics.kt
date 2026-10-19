package io.nativepiece.host

import android.os.SystemClock

/** 런타임과 화면의 성능 지표예요. 시간 단위는 밀리초예요. */
sealed class NativepieceMetric {
    /** `init()` 호출부터 JS 번들 평가가 끝날 때까지 걸린 시간이에요. */
    data class RuntimeReady(val durationMs: Double, val prewarmed: Boolean) : NativepieceMetric()

    /**
     * 화면을 만든 순간부터 RN 루트 컴포넌트가 처음 그려질 때까지 걸린 시간이에요.
     * [runtimeWasReady]가 true면 런타임이 이미 준비된 상태(warm)에서 연 화면이에요.
     */
    data class SurfaceMounted(val screen: String, val durationMs: Double, val runtimeWasReady: Boolean) : NativepieceMetric()

    /** 화면을 만든 순간부터 RN이 `host.markReady()`를 부를 때까지 걸린 시간이에요. */
    data class SurfaceReady(val screen: String, val durationMs: Double) : NativepieceMetric()
}

fun interface NativepieceMetricHandler {
    fun onMetric(metric: NativepieceMetric)
}

/** 지표 계산에 필요한 시각을 기록해요. 모든 메서드는 메인 스레드에서 불려요. */
internal object MetricsTracker {
    private data class Surface(val screen: String, val createdAt: Long, val runtimeWasReady: Boolean)

    var handler: NativepieceMetricHandler? = null

    private var startedAt: Long? = null
    private var prewarmed = false
    private var runtimeReadyAt: Long? = null
    private val surfaces = mutableMapOf<String, Surface>()

    private fun now() = SystemClock.elapsedRealtimeNanos()

    private fun millisecondsSince(start: Long) = (now() - start) / 1_000_000.0

    // prewarm하지 않으면 런타임은 첫 화면을 열 때 시작되므로, 그때부터 잰다.
    fun runtimeStarted(prewarm: Boolean) {
        if (startedAt != null || !prewarm) return
        startedAt = now()
        prewarmed = true
    }

    fun surfaceCreated(surfaceId: String, screen: String) {
        val now = now()
        if (startedAt == null) startedAt = now
        surfaces[surfaceId] = Surface(screen, now, runtimeReadyAt != null)
    }

    fun surfaceRemoved(surfaceId: String) {
        surfaces.remove(surfaceId)
    }

    fun lifecycle(name: String, surfaceId: String?) {
        when (name) {
            "runtimeReady" -> {
                if (runtimeReadyAt != null) return
                runtimeReadyAt = now()
                startedAt?.let { emit(NativepieceMetric.RuntimeReady(millisecondsSince(it), prewarmed)) }
            }
            "surfaceMounted" -> {
                val surface = surfaceId?.let(surfaces::get) ?: return
                emit(NativepieceMetric.SurfaceMounted(surface.screen, millisecondsSince(surface.createdAt), surface.runtimeWasReady))
            }
            "surfaceReady" -> {
                val surface = surfaceId?.let(surfaces::get) ?: return
                emit(NativepieceMetric.SurfaceReady(surface.screen, millisecondsSince(surface.createdAt)))
            }
        }
    }

    private fun emit(metric: NativepieceMetric) {
        handler?.onMetric(metric)
    }
}
