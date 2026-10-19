package com.aglyn.shell

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.runtime.setValue
import com.aglyn.pluginhost.NativeApp
import com.aglyn.ui.FacetsBackground
import com.aglyn.ui.LaunchIntro
import com.aglyn.ui.LaunchMark
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.frame

/**
 * The window's first layer (AGL-3934): the Facets ground behind every signed-out screen (so it holds still as they change) and,
 * where [playIntro] is set, the launch intro over it until the app is [ready]. The desktop's first window plays it from a
 * centered lockup. Android's first launch plays it on from the platform splash (P14): frame 1 is the splash's plain ground and
 * [launchMark] mark, centered on the whole window, and the motion waits for [mayStart] (the splash gone). [content] gets the
 * reveal to apply: a sign-in screen's card rises in, the signed-in shell fades in whole.
 */
@Composable
internal fun LaunchHost(
  services: ShellServices,
  ready: Boolean,
  backdrop: Boolean,
  playIntro: Boolean,
  onRevealed: () -> Unit = {},
  launchMark: androidx.compose.ui.unit.Dp? = null,
  mayStart: () -> Boolean = { true },
  content: @Composable (AuthReveal) -> Unit,
) {
  val intro = remember { if (playIntro) LaunchIntro.create() else LaunchIntro.skipped() }
  // The destination counts as ready once it has been laid out under the lockup, not when the auth state is known: its
  // first composition can take a while, and the lockup holds over it until then rather than leave a bare ground (P14).
  var placed by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
  val isReady by rememberUpdatedState(ready && (placed || intro.finished))
  val reduce = com.aglyn.ui.reduceMotion()
  LaunchedEffect(intro) {
    intro.run(reduceMotion = reduce, isReady = { isReady }, mayStart = mayStart)
    onRevealed()
  }
  val frame = intro.frame()
  val brand = services.config.brandName
  Box(Modifier.fillMaxSize()) {
    if (backdrop || !intro.finished) FacetsBackground(Modifier.fillMaxSize(), frame.settle, frame.light, flatStart = launchMark != null && !intro.finished)
    // The destination composes once the wordmark has wiped in (or with no intro), so its first composition never holds up
    // the splash's hand-over or the wipe (P14).
    if (ready && (intro.wiped || intro.finished)) {
      val reveal = AuthReveal(frame.rise, frame.reveal)
      Box(Modifier.fillMaxSize().onGloballyPositioned { if (!placed) placed = true }) {
        CompositionLocalProvider(LocalAuthReveal provides reveal) { content(reveal) }
      }
    }
    if (!intro.finished) {
      LaunchMark(
        intro, if (services.app == NativeApp.POS) "$brand POS" else brand, currentWidthClass() == WidthClass.COMPACT,
        // The splash centers its mark on the whole window, system bars included.
        if (launchMark != null) Modifier.fillMaxSize() else Modifier.fillMaxSize().safeDrawingPadding(),
        launchMark = launchMark,
      )
    }
  }
}
