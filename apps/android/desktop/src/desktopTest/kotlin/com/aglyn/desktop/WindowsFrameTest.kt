package com.aglyn.desktop

import com.aglyn.shell.CaptionRect
import com.aglyn.shell.HitTest
import com.aglyn.shell.WindowCaption
import com.sun.jna.Native
import com.sun.jna.Pointer
import com.sun.jna.win32.StdCallLibrary
import java.awt.Frame
import javax.swing.SwingUtilities
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The Windows caption on a real window (runs on Windows only; CI's `native windows chrome` job): Windows itself is asked
 * what each point is (WM_NCHITTEST through the subclassed procedure), the way it asks when the pointer moves.
 */
class WindowsFrameTest {
  private val isWindows = System.getProperty("os.name").orEmpty().startsWith("Windows")

  @Suppress("FunctionName")
  private interface Messages : StdCallLibrary {
    fun SendMessageW(hwnd: Pointer, msg: Int, wParam: Pointer?, lParam: Pointer?): Pointer?
    fun ClientToScreen(hwnd: Pointer, point: WinPoint): Boolean
  }

  @Test
  fun lParamCarriesSignedScreenCoordinates() {
    assertEquals(10 to 20, lParamPoint((20L shl 16) or 10L))
    // A monitor left of or above the main one has negative coordinates.
    assertEquals(-5 to -7, lParamPoint(((-7L and 0xFFFF) shl 16) or (-5L and 0xFFFF)))
  }

  @Test
  fun windowsAsksTheCaptionWhatEachPointIs() {
    if (!isWindows) return
    val caption = WindowCaption {}
    val frame = Frame().apply { isUndecorated = true; setBounds(100, 100, 800, 600) }
    try {
      SwingUtilities.invokeAndWait { frame.isVisible = true }
      WindowsFrame.install(frame, caption)
      val hwnd = Native.getComponentPointer(frame)!!
      val user = Native.load("user32", Messages::class.java)
      fun ask(x: Int, y: Int): Int {
        val p = WinPoint().apply { this.x = x; this.y = y }
        user.ClientToScreen(hwnd, p)
        val lParam = ((p.y.toLong() and 0xFFFF) shl 16) or (p.x.toLong() and 0xFFFF)
        return Pointer.nativeValue(user.SendMessageW(hwnd, 0x0084, null, Pointer(lParam))).toInt()
      }
      caption.drag = CaptionRect(200f, 0f, 600f, 34f)
      caption.maximize = CaptionRect(650f, 0f, 696f, 34f)
      assertEquals(HitTest.CAPTION, ask(400, 17))
      assertEquals(HitTest.MAXBUTTON, ask(670, 17))
      assertEquals(HitTest.CLIENT, ask(400, 300))
      assertEquals(HitTest.LEFT, ask(1, 300))
    } finally {
      SwingUtilities.invokeAndWait { frame.dispose() }
    }
  }
}
