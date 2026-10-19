package io.nativepiece.host

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.OnBackPressedCallback
import androidx.fragment.app.Fragment
import com.facebook.react.modules.core.DefaultHardwareBackBtnHandler
import java.util.UUID

/** RN 화면 하나를 보여 주는 Fragment예요. */
class NativepieceFragment : Fragment(), DefaultHardwareBackBtnHandler {
    private var surface: NativepieceSurface? = null
    private val pendingSetup = mutableListOf<(NativepieceSurface) -> Unit>()

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
            surface?.onBackPressed()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requireActivity().onBackPressedDispatcher.addCallback(this, backCallback)
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val surface = NativepieceSurface(
            requireContext(),
            screen,
            requireArguments().getBundle(ARG_PROPS) ?: Bundle(),
            surfaceId,
        )
        surface.onClose = { close() }
        pendingSetup.forEach { it(surface) }
        surface.start()
        this.surface = surface
        return surface.view
    }

    override fun onResume() {
        super.onResume()
        surface?.onHostResume(requireActivity(), this)
    }

    override fun onPause() {
        super.onPause()
        surface?.onHostPause(requireActivity())
    }

    override fun onDestroyView() {
        surface?.destroy()
        surface = null
        super.onDestroyView()
    }

    /** RN 화면이 보낸 이벤트를 받아요. */
    fun on(name: String, handler: (payload: NativepiecePayload) -> Unit) = configure { it.on(name, handler) }

    /** 모든 이벤트를 받아요. 생성된 `on<모듈>Event` 확장 함수가 이 API를 써요. */
    fun onAnyEvent(handler: (name: String, payload: NativepiecePayload) -> Unit) = configure { it.onAnyEvent(handler) }

    /** 이 화면에만 메시지를 보내요. [payload]는 Map, List, 기본 타입, JSONObject 중 하나예요. */
    @JvmOverloads
    fun send(name: String, payload: Any? = null) {
        Channel.sendMessage(name, payload, surfaceId)
    }

    // view가 다시 만들어져도 handler가 유지되도록 등록 내용을 기억한다.
    private fun configure(setup: (NativepieceSurface) -> Unit) {
        pendingSetup += setup
        surface?.let(setup)
    }

    // RN이 뒤로 가기를 처리하지 않으면 시스템 기본 동작으로 넘긴다.
    override fun invokeDefaultOnBackPressed() {
        backCallback.isEnabled = false
        requireActivity().onBackPressedDispatcher.onBackPressed()
        backCallback.isEnabled = true
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
        const val CLOSE_EVENT = NativepieceSurface.CLOSE_EVENT

        private const val ARG_SCREEN = "io.nativepiece.screen"
        private const val ARG_PROPS = "io.nativepiece.props"
        private const val ARG_SURFACE_ID = "io.nativepiece.surfaceId"

        @JvmStatic
        fun newInstance(screen: NativepieceScreenRepresentable): NativepieceFragment =
            newInstance(screen.screenName, NativepieceJson.toBundle(screen.screenProps()))

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
