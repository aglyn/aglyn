package com.aglyn.shell

import com.aglyn.ui.svgPathOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SvgPathIconTest {
  @Test
  fun aMaterialDesignIconPathIsDrawnWithinItsTwentyFourUnitSquare() {
    // Material Design Icons "cart": lines, relative moves, curves and arcs.
    val cart = assertNotNull(svgPathOf("M17,18C15.89,18 15,18.89 15,20A2,2 0 0,0 17,22A2,2 0 0,0 19,20C19,18.89 18.1,18 17,18M1,2V4H3L6.6,11.59L5.24,14.04C5.09,14.32 5,14.65 5,15A2,2 0 0,0 7,17H19V15H7.42A0.25,0.25 0 0,1 7.17,14.75C7.17,14.7 7.18,14.66 7.2,14.63L8.1,13H15.55C16.3,13 16.96,12.58 17.3,11.97L20.88,5.5C20.95,5.34 21,5.17 21,5A1,1 0 0,0 20,4H5.21L4.27,2H1Z"))
    val bounds = cart.getBounds()
    assertTrue(bounds.left >= 0f && bounds.top >= 0f && bounds.right <= 24f && bounds.bottom <= 24f, bounds.toString())
    assertTrue(bounds.width > 15f && bounds.height > 15f, bounds.toString())
    assertEquals(false, cart.isEmpty)
  }

  @Test
  fun lowercaseCommandsAreRelative() {
    val square = assertNotNull(svgPathOf("M2 2h10v10H2z"))
    val bounds = square.getBounds()
    assertEquals(listOf(2f, 2f, 12f, 12f), listOf(bounds.left, bounds.top, bounds.right, bounds.bottom))
  }

  @Test
  fun nothingOrBlankIsNoShapeAndNonsenseDoesNotThrow() {
    assertNull(svgPathOf(null))
    assertNull(svgPathOf("   "))
    // A stored path this parser cannot read is no shape, never a crash.
    svgPathOf("not a path")
  }
}
