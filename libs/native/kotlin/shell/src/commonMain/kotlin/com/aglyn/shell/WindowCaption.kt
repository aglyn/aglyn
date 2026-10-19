package com.aglyn.shell

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf

/*
 * A window that draws its own caption (Windows, Zach 2026-10-19, option A): the tab row stands in for the title bar, with
 * the window's minimize, maximize and close at its end. The platform's window procedure asks [captionHitTest] what each
 * point is, so the empty tab row drags the window (snap, shake, double-click maximize, Alt+Space's menu), the maximize
 * button offers Windows 11's Snap Layouts, and the edges resize, all as Windows' own title bar would.
 */

/** A rectangle in the window's client pixels. */
data class CaptionRect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
  fun contains(x: Float, y: Float): Boolean = x >= left && x < right && y >= top && y < bottom
}

/** Windows' hit-test answers (`WM_NCHITTEST`), by their documented values. */
object HitTest {
  const val CLIENT = 1
  const val CAPTION = 2
  const val MINBUTTON = 8
  const val MAXBUTTON = 9
  const val LEFT = 10
  const val RIGHT = 11
  const val TOP = 12
  const val TOPLEFT = 13
  const val TOPRIGHT = 14
  const val BOTTOM = 15
  const val BOTTOMLEFT = 16
  const val BOTTOMRIGHT = 17
  const val CLOSE = 20
}

/**
 * What a point of the window is, in client pixels: a resize edge within [border] of a side (never while maximized), the
 * maximize button (so Windows offers Snap Layouts on hover), the caption where the tab row is empty, and the app's own
 * content everywhere else, the tabs and the minimize and close buttons included (they take their clicks themselves).
 */
fun captionHitTest(x: Float, y: Float, width: Float, height: Float, border: Float, maximized: Boolean, drag: CaptionRect?, maximize: CaptionRect?): Int {
  if (!maximized) {
    val left = x < border
    val right = x >= width - border
    val top = y < border
    val bottom = y >= height - border
    when {
      top && left -> return HitTest.TOPLEFT
      top && right -> return HitTest.TOPRIGHT
      bottom && left -> return HitTest.BOTTOMLEFT
      bottom && right -> return HitTest.BOTTOMRIGHT
      left -> return HitTest.LEFT
      right -> return HitTest.RIGHT
      bottom -> return HitTest.BOTTOM
      // The top edge resizes, except over the caption buttons, which reach the window's top edge as Windows' own do.
      top && maximize?.let { x >= it.left && x < it.right } != true -> return HitTest.TOP
    }
  }
  if (maximize?.contains(x, y) == true) return HitTest.MAXBUTTON
  if (drag?.contains(x, y) == true) return HitTest.CAPTION
  return HitTest.CLIENT
}

/** The window's own caption: where its drag area and maximize button are, and the state its buttons draw. */
@Stable
class WindowCaption(
  /** The caption buttons the window draws at the tab row's end (minimize, maximize or restore, close). */
  val buttons: @Composable () -> Unit,
) {
  var maximized by mutableStateOf(false)
  /** Windows says the pointer is over (or pressing) maximize: the button is non-client for Snap Layouts. */
  var maximizeHovered by mutableStateOf(false)
  var maximizePressed by mutableStateOf(false)
  /** The tab row's empty stretch, which drags the window. Written by the tab row, read by the window procedure. */
  @kotlin.concurrent.Volatile var drag: CaptionRect? = null
  @kotlin.concurrent.Volatile var maximize: CaptionRect? = null
}

/** The window's own caption, on a window that draws one (Windows); null where the system draws it (macOS's traffic lights). */
val LocalWindowCaption = staticCompositionLocalOf<WindowCaption?> { null }
