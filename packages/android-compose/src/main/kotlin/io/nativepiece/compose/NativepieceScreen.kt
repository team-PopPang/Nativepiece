package io.nativepiece.compose

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.facebook.react.modules.core.DefaultHardwareBackBtnHandler
import io.nativepiece.host.NativepieceJson
import io.nativepiece.host.NativepiecePayload
import io.nativepiece.host.NativepieceScreenRepresentable
import io.nativepiece.host.NativepieceSurface

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/**
 * RN 화면 하나를 Compose 안에 보여 줘요.
 *
 * [screen]이 바뀌면 화면을 새로 만들어요. [onSurface]로 surface를 받아 메시지를 보낼 수 있어요.
 */
@Composable
fun NativepieceScreen(
    screen: NativepieceScreenRepresentable,
    modifier: Modifier = Modifier,
    onClose: () -> Unit = {},
    onEvent: (name: String, payload: NativepiecePayload) -> Unit = { _, _ -> },
    onSurface: (NativepieceSurface) -> Unit = {},
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnClose by rememberUpdatedState(onClose)
    val currentOnEvent by rememberUpdatedState(onEvent)

    val surface = remember(screen) {
        NativepieceSurface(context, screen.screenName, NativepieceJson.toBundle(screen.screenProps())).apply {
            this.onClose = { currentOnClose() }
            onAnyEvent { name, payload -> currentOnEvent(name, payload) }
            start()
        }
    }

    DisposableEffect(surface, lifecycleOwner) {
        val activity = context.findActivity()
        // RN이 뒤로 가기를 처리하지 않으면 닫기로 넘긴다.
        val backHandler = DefaultHardwareBackBtnHandler { currentOnClose() }
        val observer = LifecycleEventObserver { _, event ->
            if (activity == null) return@LifecycleEventObserver
            when (event) {
                Lifecycle.Event.ON_RESUME -> surface.onHostResume(activity, backHandler)
                Lifecycle.Event.ON_PAUSE -> surface.onHostPause(activity)
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onSurface(surface)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            surface.destroy()
        }
    }

    BackHandler { surface.onBackPressed() }

    AndroidView(factory = { surface.view }, modifier = modifier)
}
