package com.aglyn.desktop

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyShortcut
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.ApplicationScope
import androidx.compose.ui.window.FrameWindowScope
import androidx.compose.ui.window.MenuBar
import androidx.compose.ui.window.MenuBarScope
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.WindowPlacement
import androidx.compose.ui.window.WindowPosition
import androidx.compose.ui.window.rememberWindowState
import com.aglyn.shell.ShellServices
import com.aglyn.ui.AglynTokens
import com.aglyn.ui.AuthTokens
import com.aglyn.ui.aglynMarkPainter
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.awt.Color

/** The platform's command key: ⌘ on macOS, Ctrl elsewhere. */
private val isMac = System.getProperty("os.name").orEmpty().startsWith("Mac")

fun shortcut(key: Key, shift: Boolean = false) =
  KeyShortcut(key, meta = isMac, ctrl = !isMac, shift = shift)

/** The workspace switcher's toggle: ⌃⌘ on macOS, Ctrl+Alt elsewhere. */
fun switcherShortcut(key: Key) =
  if (isMac) KeyShortcut(key, meta = true, ctrl = true) else KeyShortcut(key, ctrl = true, alt = true)

/** The first window's size during the launch intro (spec 53:1638), and the size it grows to once the app is ready. */
private val INTRO_SIZE = DpSize(960.dp, 640.dp)
private val WINDOW_SIZE = DpSize(1280.dp, 840.dp)

/**
 * One app window: the Aglyn mark as its icon, the window's own background in
 * the token background (so resizing never flashes white), a menu bar with
 * shortcuts, and the shell inside. It opens at the intro's 960 × 640, centered,
 * and grows to its working size as the intro hands over ([content]'s callback).
 */
@Composable
fun ApplicationScope.AglynWindow(
  title: String,
  services: ShellServices,
  menus: @Composable MenuBarScope.(signOut: () -> Unit) -> Unit,
  content: @Composable FrameWindowScope.(onIntroRevealed: () -> Unit) -> Unit,
) {
  val state = rememberWindowState(size = INTRO_SIZE, position = WindowPosition(Alignment.Center))
  Window(onCloseRequest = ::exitApplication, title = title, state = state, icon = aglynMarkPainter()) {
    val dark = isSystemInDarkTheme()
    LaunchedEffect(dark) {
      val background = (if (dark) AglynTokens.dark else AglynTokens.light).background
      window.background = Color(background.red, background.green, background.blue)
      window.contentPane.background = window.background
      // macOS: full-size content under a transparent, title-less title bar and no toolbar, so the traffic lights sit in
      // the app's own tab row and macOS gives the window its plain (smaller) corner radius. Windows keeps its own frame.
      window.rootPane.putClientProperty("apple.awt.fullWindowContent", true)
      window.rootPane.putClientProperty("apple.awt.transparentTitleBar", true)
      window.rootPane.putClientProperty("apple.awt.windowTitleVisible", false)
      window.rootPane.putClientProperty("apple.awt.windowAppearance", if (dark) "NSAppearanceNameDarkAqua" else "NSAppearanceNameAqua")
      window.minimumSize = java.awt.Dimension(420, 560)
    }
    val scope = rememberCoroutineScope()
    MenuBar { menus { scope.launch { services.signOut() } } }
    // The app's tab row stands in for the hidden title bar, so its double-click does what the title bar's would.
    val doubleClick: () -> Unit = {
      when (titleBarDoubleClickAction()) {
        TitleBarAction.MINIMIZE -> state.isMinimized = true
        TitleBarAction.NONE -> Unit
        TitleBarAction.ZOOM -> state.placement = if (state.placement == WindowPlacement.Maximized) WindowPlacement.Floating else WindowPlacement.Maximized
      }
    }
    androidx.compose.runtime.CompositionLocalProvider(com.aglyn.shell.LocalWindowDoubleClick provides doubleClick) {
      content {
        scope.launch {
          // Grow about the window's center over the destination's 220 ms.
          val from = state.size
          val start = state.position
          val steps = 12
          for (step in 1..steps) {
            val t = step / steps.toFloat()
            val eased = 1 - (1 - t) * (1 - t) * (1 - t)
            val size = DpSize(from.width + (WINDOW_SIZE.width - from.width) * eased, from.height + (WINDOW_SIZE.height - from.height) * eased)
            if (start is WindowPosition.Absolute) {
              state.position = WindowPosition(start.x - (size.width - from.width) / 2, start.y - (size.height - from.height) / 2)
            }
            state.size = size
            delay(AuthTokens.Intro.DESTINATION_MS.toLong() / steps)
          }
        }
      }
    }
  }
}

private enum class TitleBarAction { ZOOM, MINIMIZE, NONE }

/**
 * What a double-click on a title bar does here: on a Mac, System Settings › Desktop & Dock's choice (`AppleActionOnDoubleClick`:
 * Fill / Zoom, Minimize or Do Nothing); elsewhere it zooms (maximizes or restores), as Windows' title bars do.
 */
private fun titleBarDoubleClickAction(): TitleBarAction {
  if (!System.getProperty("os.name").orEmpty().startsWith("Mac")) return TitleBarAction.ZOOM
  val value = runCatching {
    val process = ProcessBuilder("defaults", "read", "-g", "AppleActionOnDoubleClick").redirectErrorStream(true).start()
    process.inputStream.bufferedReader().readText().trim().also { process.waitFor() }
  }.getOrDefault("")
  return when (value) {
    "Minimize" -> TitleBarAction.MINIMIZE
    "None", "Do Nothing" -> TitleBarAction.NONE
    else -> TitleBarAction.ZOOM
  }
}
