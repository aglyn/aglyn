package com.aglyn.shell

import kotlin.test.Test
import kotlin.test.assertEquals

class CaptionHitTestTest {
  // A 1200 × 800 window: the tab row's empty stretch from 400 to 1062, maximize at 1062–1108 along the top 34.
  private val drag = CaptionRect(400f, 0f, 1062f, 34f)
  private val maximize = CaptionRect(1108f - 46f, 0f, 1108f, 34f)

  private fun at(x: Float, y: Float, maximized: Boolean = false) = captionHitTest(x, y, 1200f, 800f, 6f, maximized, drag, maximize)

  @Test
  fun theEdgesAndCornersResize() {
    assertEquals(HitTest.TOPLEFT, at(2f, 2f))
    assertEquals(HitTest.TOPRIGHT, at(1198f, 2f))
    assertEquals(HitTest.BOTTOMLEFT, at(2f, 798f))
    assertEquals(HitTest.BOTTOMRIGHT, at(1198f, 798f))
    assertEquals(HitTest.LEFT, at(1f, 400f))
    assertEquals(HitTest.RIGHT, at(1199f, 400f))
    assertEquals(HitTest.BOTTOM, at(600f, 799f))
    assertEquals(HitTest.TOP, at(600f, 1f))
  }

  @Test
  fun maximizeIsTheSystemsButtonSoSnapLayoutsShow() {
    assertEquals(HitTest.MAXBUTTON, at(1080f, 17f))
    // Its top pixels are the button too, not a resize edge.
    assertEquals(HitTest.MAXBUTTON, at(1080f, 1f))
  }

  @Test
  fun theEmptyTabRowDragsAndTheRestIsTheApps() {
    assertEquals(HitTest.CAPTION, at(700f, 17f))
    // A tab, the + button, minimize and close take their own clicks.
    assertEquals(HitTest.CLIENT, at(200f, 17f))
    assertEquals(HitTest.CLIENT, at(1150f, 17f))
    assertEquals(HitTest.CLIENT, at(600f, 400f))
  }

  @Test
  fun aMaximizedWindowHasNoResizeEdges() {
    assertEquals(HitTest.CLIENT, at(1f, 400f, maximized = true))
    assertEquals(HitTest.CAPTION, at(700f, 1f, maximized = true))
    assertEquals(HitTest.MAXBUTTON, at(1080f, 1f, maximized = true))
  }
}
