package io.nativepiece.host

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.OnBackPressedCallback
import androidx.fragment.app.Fragment
import com.facebook.react.interfaces.fabric.ReactSurface
import com.facebook.react.modules.core.DefaultHardwareBackBtnHandler
import java.util.UUID

/** RN 화면 하나를 보여 주는 Fragment예요. */
class NativepieceFragment : Fragment(), DefaultHardwareBackBtnHandler {
    private var surface: ReactSurface? = null
    private val handlers = mutableMapOf<String, (NativepiecePayload) -> Unit>()

    /** RN 화면이 닫기를 요청했을 때 실행해요. 지정하지 않으면 back stack을 pop하거나 Activity를 종료해요. */
    var onClose: (() -> Unit)? = null

    val screen: String
        get() = requireArguments().getString(ARG_SCREEN) ?: error("screen이 없어요.")

    // 화면 회전처럼 Fragment가 다시 만들어져도 같은 surfaceId를 유지한다.
    val surfaceId: String by lazy {
        requireArguments().getString(ARG_SURFACE_ID) ?: UUID.randomUUID().toString().also {
            requireArguments().putString(ARG_SURFACE_ID, it)
        }
    }

    private val backCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            Nativepiece.reactHost.onBackPressed()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requireActivity().onBackPressedDispatcher.addCallback(this, backCallback)
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        Channel.setEventHandler(surfaceId) { name, payload -> handle(name, payload) }

        val props = Bundle(requireArguments().getBundle(ARG_PROPS) ?: Bundle()).apply {
            putBundle(INTERNAL_PROP, Bundle().apply { putString("surfaceId", surfaceId) })
        }
        val surface = Nativepiece.reactHost.createSurface(requireContext(), screen, props)
        surface.start()
        this.surface = surface
        return surface.view ?: error("React surface view를 만들지 못했어요.")
    }

    override fun onResume() {
        super.onResume()
        Nativepiece.reactHost.onHostResume(requireActivity(), this)
    }

    override fun onPause() {
        super.onPause()
        Nativepiece.reactHost.onHostPause(requireActivity())
    }

    override fun onDestroyView() {
        surface?.stop()
        surface?.detach()
        surface = null
        Channel.setEventHandler(surfaceId, null)
        super.onDestroyView()
    }

    /** RN 화면이 보낸 이벤트를 받아요. */
    fun on(name: String, handler: (payload: NativepiecePayload) -> Unit) {
        handlers[name] = handler
    }

    /** 이 화면에만 메시지를 보내요. [payload]는 Map, List, 기본 타입, JSONObject 중 하나예요. */
    @JvmOverloads
    fun send(name: String, payload: Any? = null) {
        Channel.sendMessage(name, payload, surfaceId)
    }

    // RN이 뒤로 가기를 처리하지 않으면 시스템 기본 동작으로 넘긴다.
    override fun invokeDefaultOnBackPressed() {
        backCallback.isEnabled = false
        requireActivity().onBackPressedDispatcher.onBackPressed()
        backCallback.isEnabled = true
    }

    private fun handle(name: String, payload: NativepiecePayload) {
        if (name == CLOSE_EVENT) {
            close()
            return
        }
        handlers[name]?.invoke(payload)
    }

    private fun close() {
        onClose?.let { return it() }
        if (parentFragmentManager.backStackEntryCount > 0) {
            parentFragmentManager.popBackStack()
        } else {
            requireActivity().finish()
        }
    }

    companion object {
        /** RN 쪽 `NAVIGATION_EVENT.close`와 같은 값이에요. */
        const val CLOSE_EVENT = "np.close"

        private const val ARG_SCREEN = "io.nativepiece.screen"
        private const val ARG_PROPS = "io.nativepiece.props"
        private const val ARG_SURFACE_ID = "io.nativepiece.surfaceId"
        private const val INTERNAL_PROP = "__nativepiece"

        @JvmStatic
        @JvmOverloads
        fun newInstance(screen: String, props: Bundle = Bundle()): NativepieceFragment =
            NativepieceFragment().apply {
                arguments = Bundle().apply {
                    putString(ARG_SCREEN, screen)
                    putBundle(ARG_PROPS, props)
                }
            }
    }
}
