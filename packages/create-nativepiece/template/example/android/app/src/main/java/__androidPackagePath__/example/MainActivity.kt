package {{androidPackage}}.example

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import {{androidPackage}}.{{name}}
import {{androidPackage}}.{{name}}Screen
import io.nativepiece.host.Nativepiece
import io.nativepiece.host.send

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val openOnLaunch = intent.getBooleanExtra("openModule", false)

        setContent {
            MaterialTheme {
                var showModule by remember { mutableStateOf(openOnLaunch) }
                var lastEvent by remember { mutableStateOf("-") }

                if (showModule) {
                    {{name}}Screen(
                        screen = {{name}}.Screen.Home({{name}}.HomeProps(userName = "Android")),
                        modifier = Modifier.fillMaxSize(),
                        onClose = { showModule = false },
                        onEvent = { event ->
                            when (event) {
                                is {{name}}.Event.ButtonPressed -> {
                                    val count = event.payload.count.toInt()
                                    lastEvent = "buttonPressed $count"
                                    // 누를 때마다 테마를 바꿔서 호스트 → RN 메시지를 보여 줘요.
                                    Nativepiece.send({{name}}.Message.ThemeChanged({{name}}.ThemeChangedMessage(dark = count % 2 == 1)))
                                }
                            }
                        },
                    )
                } else {
                    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Example Host", style = MaterialTheme.typography.headlineMedium)
                        Button(onClick = { showModule = true }) { Text("RN 화면 열기") }
                        Text("마지막 이벤트: $lastEvent")
                    }
                }
            }
        }
    }
}
