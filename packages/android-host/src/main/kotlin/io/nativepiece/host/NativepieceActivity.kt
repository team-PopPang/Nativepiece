package io.nativepiece.host

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity

/** RN 화면 하나를 전체 화면으로 보여 줘요. Fragment를 직접 붙이기 어려울 때 써요. */
open class NativepieceActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = FrameLayout(this).apply { id = CONTAINER_ID }
        setContentView(container)

        if (savedInstanceState == null) {
            val screen = intent.getStringExtra(EXTRA_SCREEN) ?: error("screen이 없어요.")
            val props = intent.getBundleExtra(EXTRA_PROPS) ?: Bundle()
            supportFragmentManager.beginTransaction()
                .replace(CONTAINER_ID, NativepieceFragment.newInstance(screen, props))
                .commit()
        }
    }

    companion object {
        private const val CONTAINER_ID = 0x4E50
        private const val EXTRA_SCREEN = "io.nativepiece.screen"
        private const val EXTRA_PROPS = "io.nativepiece.props"

        @JvmStatic
        @JvmOverloads
        fun createIntent(context: Context, screen: String, props: Bundle = Bundle()): Intent =
            Intent(context, NativepieceActivity::class.java)
                .putExtra(EXTRA_SCREEN, screen)
                .putExtra(EXTRA_PROPS, props)
    }
}
