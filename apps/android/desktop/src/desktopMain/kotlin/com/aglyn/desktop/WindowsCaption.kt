package com.aglyn.desktop

import androidx.compose.foundation.background
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aglyn.shell.CaptionRect
import com.aglyn.shell.HitTest
import com.aglyn.shell.WindowCaption
import com.aglyn.shell.captionHitTest
import com.sun.jna.Native
import com.sun.jna.Pointer
import com.sun.jna.Structure
import com.sun.jna.win32.StdCallLibrary
import java.awt.Window

/*
 * Windows draws no title bar for us (Zach 2026-10-19, option A): the window is undecorated to AWT, and its window
 * procedure, subclassed through JNA, gives Windows back everything its own title bar did. WM_NCCALCSIZE makes the whole
 * window client area (the frame's thickness kept off-screen when maximized); WM_NCHITTEST answers [captionHitTest], so the
 * empty tab row is the caption (drag, Aero snap and shake, double-click maximize, Alt+Space), the edges resize, and our
 * maximize button is HTMAXBUTTON, which is what makes Windows 11 offer Snap Layouts on hover.
 */

/** Segoe's caption glyphs (Windows 11's Segoe Fluent Icons, else Windows 10's Segoe MDL2 Assets): the same code points. */
private object CaptionGlyph {
  const val MINIMIZE = ""
  const val MAXIMIZE = ""
  const val RESTORE = ""
  const val CLOSE = ""
}

private val captionFont: FontFamily by lazy {
  val face = listOf("Segoe Fluent Icons", "Segoe MDL2 Assets").firstNotNullOfOrNull { name ->
    runCatching { org.jetbrains.skia.FontMgr.default.matchFamilyStyle(name, org.jetbrains.skia.FontStyle.NORMAL) }.getOrNull()
  }
  if (face == null) FontFamily.Default else FontFamily(androidx.compose.ui.text.platform.Typeface(face))
}

/** Windows' close red, hover and pressed (Windows 11's caption buttons). */
private val CloseHover = Color(0xFFC42B1C)
private val ClosePressed = Color(0xFFC42B1C).copy(alpha = 0.9f)

/**
 * Minimize, maximize (restore down while maximized) and close at the tab row's end, 46 wide, as Windows draws them:
 * a light wash on hover and press, close red. Each is a button to screen readers with Windows' own names.
 */
@Composable
internal fun WindowsCaptionButtons(caption: WindowCaption, onMinimize: () -> Unit, onToggleMaximize: () -> Unit, onClose: () -> Unit) {
  Row(Modifier.fillMaxHeight()) {
    CaptionButton(CaptionGlyph.MINIMIZE, "Minimize", "window-minimize", onClick = onMinimize)
    CaptionButton(
      if (caption.maximized) CaptionGlyph.RESTORE else CaptionGlyph.MAXIMIZE,
      if (caption.maximized) "Restore Down" else "Maximize",
      "window-maximize",
      hovered = caption.maximizeHovered,
      pressed = caption.maximizePressed,
      modifier = Modifier.onGloballyPositioned { c ->
        val at = c.positionInWindow()
        caption.maximize = CaptionRect(at.x, at.y, at.x + c.size.width, at.y + c.size.height)
      },
      onClick = onToggleMaximize,
    )
    CaptionButton(CaptionGlyph.CLOSE, "Close", "window-close", close = true, onClick = onClose)
  }
}

@Composable
private fun CaptionButton(
  glyph: String,
  label: String,
  tag: String,
  close: Boolean = false,
  hovered: Boolean = false,
  pressed: Boolean = false,
  modifier: Modifier = Modifier,
  onClick: () -> Unit,
) {
  val interaction = remember { MutableInteractionSource() }
  val hover by interaction.collectIsHoveredAsState()
  val press by interaction.collectIsPressedAsState()
  val isHovered = hover || hovered
  val isPressed = press || pressed
  val ink = MaterialTheme.colorScheme.onSurface
  val background = when {
    close && isPressed -> ClosePressed
    close && isHovered -> CloseHover
    isPressed -> ink.copy(alpha = 0.12f)
    isHovered -> ink.copy(alpha = 0.06f)
    else -> Color.Transparent
  }
  Box(
    modifier.width(46.dp).fillMaxHeight().background(background)
      .hoverable(interaction)
      .clickable(interactionSource = interaction, indication = null, onClick = onClick)
      .testTag(tag)
      .semantics { role = Role.Button; contentDescription = label },
    contentAlignment = Alignment.Center,
  ) {
    Text(glyph, fontFamily = captionFont, fontSize = 10.sp, color = if (close && (isHovered || isPressed)) Color.White else ink)
  }
}

@Structure.FieldOrder("x", "y")
internal class WinPoint : Structure() {
  @JvmField var x: Int = 0
  @JvmField var y: Int = 0
}

@Structure.FieldOrder("left", "top", "right", "bottom")
internal class WinRect : Structure() {
  @JvmField var left: Int = 0
  @JvmField var top: Int = 0
  @JvmField var right: Int = 0
  @JvmField var bottom: Int = 0
}

private interface WndProc : StdCallLibrary.StdCallCallback {
  fun callback(hwnd: Pointer, msg: Int, wParam: Pointer?, lParam: Pointer?): Pointer?
}

@Suppress("FunctionName")
private interface CaptionUser32 : StdCallLibrary {
  fun GetWindowLongPtrW(hwnd: Pointer, index: Int): Pointer?
  fun SetWindowLongPtrW(hwnd: Pointer, index: Int, value: Pointer?): Pointer?
  fun SetWindowLongPtrW(hwnd: Pointer, index: Int, value: WndProc): Pointer?
  fun CallWindowProcW(previous: Pointer?, hwnd: Pointer, msg: Int, wParam: Pointer?, lParam: Pointer?): Pointer?
  fun ScreenToClient(hwnd: Pointer, point: WinPoint): Boolean
  fun GetClientRect(hwnd: Pointer, rect: WinRect): Boolean
  fun SetWindowPos(hwnd: Pointer, after: Pointer?, x: Int, y: Int, cx: Int, cy: Int, flags: Int): Boolean
  fun GetSystemMetricsForDpi(index: Int, dpi: Int): Int
  fun GetDpiForWindow(hwnd: Pointer): Int
  fun IsZoomed(hwnd: Pointer): Boolean
  fun ShowWindow(hwnd: Pointer, command: Int): Boolean
}

private object Win {
  const val GWL_STYLE = -16
  const val GWLP_WNDPROC = -4
  const val WS_POPUP = 0x80000000L
  const val WS_CAPTION = 0x00C00000L
  const val WS_SYSMENU = 0x00080000L
  const val WS_THICKFRAME = 0x00040000L
  const val WS_MINIMIZEBOX = 0x00020000L
  const val WS_MAXIMIZEBOX = 0x00010000L
  const val SWP_FRAMECHANGED = 0x0020
  const val SWP_NOMOVE = 0x0002
  const val SWP_NOSIZE = 0x0001
  const val SWP_NOZORDER = 0x0004
  const val SWP_NOACTIVATE = 0x0010
  const val WM_NCCALCSIZE = 0x0083
  const val WM_NCHITTEST = 0x0084
  const val WM_NCMOUSEMOVE = 0x00A0
  const val WM_NCLBUTTONDOWN = 0x00A1
  const val WM_NCLBUTTONUP = 0x00A2
  const val WM_NCMOUSELEAVE = 0x02A2
  const val WM_MOUSEMOVE = 0x0200
  const val SM_CXSIZEFRAME = 32
  const val SM_CYSIZEFRAME = 33
  const val SM_CXPADDEDBORDER = 92
  const val SW_MAXIMIZE = 3
  const val SW_RESTORE = 9
}

/** The x and y a mouse message carries in its LPARAM: signed 16-bit screen coordinates. */
internal fun lParamPoint(lParam: Long): Pair<Int, Int> = (lParam and 0xFFFF).toShort().toInt() to ((lParam shr 16) and 0xFFFF).toShort().toInt()

/** Installs the caption on [window] (Windows only); the subclassed procedure lives as long as the window. */
internal object WindowsFrame {
  private val user32: CaptionUser32? by lazy { runCatching { Native.load("user32", CaptionUser32::class.java) }.getOrNull() }
  /** Each window's procedure, held so the callback is never collected while Windows can call it. */
  private val procedures = mutableMapOf<Window, WndProc>()

  fun install(window: Window, caption: WindowCaption) {
    val user = user32 ?: return
    if (window in procedures) return
    val hwnd = Native.getComponentPointer(window) ?: return
    // The frame Windows draws comes back as styles (snap, the system menu, the minimize/maximize animations, the shadow);
    // WM_NCCALCSIZE below keeps it from drawing anything.
    val style = Pointer.nativeValue(user.GetWindowLongPtrW(hwnd, Win.GWL_STYLE))
    val next = (style and Win.WS_POPUP.inv()) or Win.WS_CAPTION or Win.WS_SYSMENU or Win.WS_THICKFRAME or Win.WS_MINIMIZEBOX or Win.WS_MAXIMIZEBOX
    user.SetWindowLongPtrW(hwnd, Win.GWL_STYLE, Pointer(next))
    val previous = user.GetWindowLongPtrW(hwnd, Win.GWLP_WNDPROC)
    val procedure = object : WndProc {
      override fun callback(hwnd: Pointer, msg: Int, wParam: Pointer?, lParam: Pointer?): Pointer? {
        val w = wParam?.let { Pointer.nativeValue(it) } ?: 0L
        when (msg) {
          Win.WM_NCCALCSIZE -> if (w != 0L && lParam != null) {
            // The whole window is client; maximized, Windows places it a frame's thickness past the screen, so pull in.
            if (user.IsZoomed(hwnd)) {
              val dpi = user.GetDpiForWindow(hwnd).takeIf { it > 0 } ?: 96
              val padded = user.GetSystemMetricsForDpi(Win.SM_CXPADDEDBORDER, dpi)
              val fx = user.GetSystemMetricsForDpi(Win.SM_CXSIZEFRAME, dpi) + padded
              val fy = user.GetSystemMetricsForDpi(Win.SM_CYSIZEFRAME, dpi) + padded
              lParam.setInt(0, lParam.getInt(0) + fx)
              lParam.setInt(4, lParam.getInt(4) + fy)
              lParam.setInt(8, lParam.getInt(8) - fx)
              lParam.setInt(12, lParam.getInt(12) - fy)
            }
            caption.maximized = user.IsZoomed(hwnd)
            return null
          }
          Win.WM_NCHITTEST -> {
            val (sx, sy) = lParamPoint(lParam?.let { Pointer.nativeValue(it) } ?: 0L)
            val point = WinPoint().apply { x = sx; y = sy }
            user.ScreenToClient(hwnd, point)
            val client = WinRect()
            user.GetClientRect(hwnd, client)
            val dpi = user.GetDpiForWindow(hwnd).takeIf { it > 0 } ?: 96
            val border = (user.GetSystemMetricsForDpi(Win.SM_CXSIZEFRAME, dpi) + user.GetSystemMetricsForDpi(Win.SM_CXPADDEDBORDER, dpi)).toFloat()
            val answer = captionHitTest(
              point.x.toFloat(), point.y.toFloat(), (client.right - client.left).toFloat(), (client.bottom - client.top).toFloat(),
              border, user.IsZoomed(hwnd), caption.drag, caption.maximize,
            )
            return Pointer(answer.toLong())
          }
          Win.WM_NCMOUSEMOVE -> caption.maximizeHovered = w == HitTest.MAXBUTTON.toLong()
          Win.WM_NCMOUSELEAVE, Win.WM_MOUSEMOVE -> { caption.maximizeHovered = false; caption.maximizePressed = false }
          Win.WM_NCLBUTTONDOWN -> if (w == HitTest.MAXBUTTON.toLong()) {
            caption.maximizePressed = true
            return null
          }
          Win.WM_NCLBUTTONUP -> if (w == HitTest.MAXBUTTON.toLong()) {
            val was = caption.maximizePressed
            caption.maximizePressed = false
            if (was) user.ShowWindow(hwnd, if (user.IsZoomed(hwnd)) Win.SW_RESTORE else Win.SW_MAXIMIZE)
            return null
          }
        }
        return user.CallWindowProcW(previous, hwnd, msg, wParam, lParam)
      }
    }
    procedures[window] = procedure
    user.SetWindowLongPtrW(hwnd, Win.GWLP_WNDPROC, procedure)
    user.SetWindowPos(hwnd, null, 0, 0, 0, 0, Win.SWP_FRAMECHANGED or Win.SWP_NOMOVE or Win.SWP_NOSIZE or Win.SWP_NOZORDER or Win.SWP_NOACTIVATE)
    window.addWindowListener(object : java.awt.event.WindowAdapter() {
      override fun windowClosed(e: java.awt.event.WindowEvent?) { procedures.remove(window) }
    })
  }
}
