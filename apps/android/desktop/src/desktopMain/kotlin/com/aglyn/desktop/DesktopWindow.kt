package com.aglyn.desktop

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyShortcut
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.ApplicationScope
import androidx.compose.ui.window.FrameWindowScope
import androidx.compose.ui.window.MenuBar
import androidx.compose.ui.window.MenuBarScope
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.rememberWindowState
import com.aglyn.shell.ShellServices
import com.aglyn.ui.AglynTokens
import com.aglyn.ui.aglynMarkPainter
import kotlinx.coroutines.launch
import java.awt.Color

/** The platform's command key: ⌘ on macOS, Ctrl elsewhere. */
private val isMac = System.getProperty("os.name").orEmpty().startsWith("Mac")

fun shortcut(key: Key, shift: Boolean = false) =
  KeyShortcut(key, meta = isMac, ctrl = !isMac, shift = shift)

/**
 * One app window: the Aglyn mark as its icon, the window's own background in
 * the token background (so resizing never flashes white), a menu bar with
 * shortcuts, and the shell inside.
 */
@Composable
fun ApplicationScope.AglynWindow(
  title: String,
  services: ShellServices,
  menus: @Composable MenuBarScope.(signOut: () -> Unit) -> Unit,
  content: @Composable FrameWindowScope.() -> Unit,
) {
  val state = rememberWindowState(size = DpSize(1280.dp, 840.dp), position = WindowPosition.PlatformDefault)
  Window(onCloseRequest = ::exitApplication, title = title, state = state, icon = aglynMarkPainter()) {
    val dark = isSystemInDarkTheme()
    LaunchedEffect(dark) {
      val background = (if (dark) AglynTokens.dark else AglynTokens.light).background
      window.background = Color(background.red, background.green, background.blue)
      window.contentPane.background = window.background
      // macOS: the content runs under a transparent title bar in the app's own color.
      window.rootPane.putClientProperty("apple.awt.transparentTitleBar", true)
      window.rootPane.putClientProperty("apple.awt.windowAppearance", if (dark) "NSAppearanceNameDarkAqua" else "NSAppearanceNameAqua")
      window.minimumSize = java.awt.Dimension(420, 560)
    }
    val scope = rememberCoroutineScope()
    MenuBar { menus { scope.launch { services.signOut() } } }
    content()
  }
}
