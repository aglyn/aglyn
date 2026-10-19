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
import com.aglyn.pluginhost.NativeApp
import com.aglyn.ui.FacetsBackground
import com.aglyn.ui.LaunchIntro
import com.aglyn.ui.LaunchMark
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.frame

/**
 * The window's first layer (AGL-3934): the Facets ground behind every signed-out screen (so it holds still as they change) and,
 * where [playIntro] is set (the desktop's first window), the launch intro over it until the app is [ready]. Android plays its
 * own splash screen instead, kept up until the auth state is known. [content] gets the reveal to apply: a sign-in screen's card
 * rises in, the signed-in shell fades in whole.
 */
@Composable
internal fun LaunchHost(
  services: ShellServices,
  ready: Boolean,
  backdrop: Boolean,
  playIntro: Boolean,
  onRevealed: () -> Unit = {},
  content: @Composable (AuthReveal) -> Unit,
) {
  val intro = remember { if (playIntro) LaunchIntro.create() else LaunchIntro.skipped() }
  val isReady by rememberUpdatedState(ready)
  LaunchedEffect(intro) {
    intro.run(reduceMotion = false) { isReady }
    onRevealed()
  }
  val frame = intro.frame()
  val brand = services.config.brandName
  Box(Modifier.fillMaxSize()) {
    if (backdrop || !intro.finished) FacetsBackground(Modifier.fillMaxSize(), frame.settle, frame.light)
    if (ready) {
      val reveal = AuthReveal(frame.rise, frame.reveal)
      CompositionLocalProvider(LocalAuthReveal provides reveal) { content(reveal) }
    }
    if (!intro.finished) {
      LaunchMark(
        intro, if (services.app == NativeApp.POS) "$brand POS" else brand, currentWidthClass() == WidthClass.COMPACT,
        Modifier.fillMaxSize().safeDrawingPadding(),
      )
    }
  }
}
