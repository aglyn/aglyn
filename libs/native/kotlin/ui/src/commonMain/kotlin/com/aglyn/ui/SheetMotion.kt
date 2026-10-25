package com.aglyn.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import kotlinx.coroutines.launch

/** Whether the platform moves a dialog's window in by itself (Android's window animation); the desktop shows it at once. */
internal expect val dialogWindowsAnimate: Boolean

/** How a sheet or dialog arrives where the platform does not move it (AGL-4013). */
enum class SheetEntrance {
  /** A sheet or panel rises [ShellMotion.SHEET_RISE] into place and fades in on the drill's spring (about 250 ms). */
  RISE,

  /** A dialog that asks one question grows from 96% and fades in, in the cross-fade's 150 ms. */
  GROW,
}

/**
 * Moves a sheet or dialog in when it opens, on the desktop, where Compose shows a dialog's window at once; on Android the
 * window's own animation already moves it, so this does nothing there. Reduce Motion keeps only the fade, same duration.
 */
@Composable
fun Modifier.sheetEntrance(kind: SheetEntrance): Modifier {
  if (dialogWindowsAnimate) return this
  val reduce = reduceMotion()
  val rise = with(LocalDensity.current) { ShellMotion.SHEET_RISE.toPx() }
  val progress = remember { Animatable(0f) }
  val alpha = remember { Animatable(0f) }
  LaunchedEffect(Unit) {
    val fadeMs = if (kind == SheetEntrance.RISE) ShellMotion.DRILL_MS else ShellMotion.CROSS_FADE_MS
    launch { alpha.animateTo(1f, tween(fadeMs)) }
    if (reduce) progress.snapTo(1f)
    else if (kind == SheetEntrance.RISE) progress.animateTo(1f, ShellMotion.drill())
    else progress.animateTo(1f, tween(ShellMotion.CROSS_FADE_MS))
  }
  return graphicsLayer {
    this.alpha = alpha.value
    val p = progress.value
    when (kind) {
      SheetEntrance.RISE -> translationY = (1f - p) * rise
      SheetEntrance.GROW -> {
        val scale = 0.96f + 0.04f * p
        scaleX = scale
        scaleY = scale
      }
    }
  }
}
