package com.aglyn.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** A brand picture's art is drawn whole inside its badge, never cut by the badge's shape; the twin of Apple's BrandArtTests. */
class BrandArtTest {
  /** A [side]-pixel picture whose ink is the square from [from] up to [to] (exclusive), on a clear ground. */
  private fun square(side: Int, from: Int, to: Int) =
    brandArtOf(side, side) { x, y -> if (x in from until to && y in from until to) 1f else 0f }

  @Test
  fun aFaviconRunningToItsCornersShrinksToClearACircle() {
    // The logo kit's mark: 20 of 24 pixels of art, a 2-pixel clear margin, ink right into its corners.
    val art = square(24, 2, 22)
    assertFalse(art.opaqueCorners)
    // Its farthest ink is 10/24 out on both axes, 0.589 from the center; the circle allows 0.5 − 0.06.
    assertEquals(0.44f / 0.58926f, brandArtScale(art.ink, cornerFraction = 0.5f), 1e-3f)
  }

  @Test
  fun aRoundedSquareOnlyCostsTheCornersTheirArc() {
    val art = square(24, 2, 22)
    // The corner point lands on the inset arc: |k·(10/24, 10/24) − (0.25, 0.25)| = 0.19.
    assertEquals(0.92245f, brandArtScale(art.ink, cornerFraction = 0.25f), 1e-3f)
    // A square badge has no corner to clear, and art is never enlarged past its fit.
    assertEquals(1f, brandArtScale(art.ink, cornerFraction = 0f), 1e-6f)
  }

  @Test
  fun artThatAlreadyClearsTheShapeIsLeftAsSupplied() {
    // A logo uploaded with its own room around it: 20 of 32 pixels.
    val padded = square(32, 6, 26)
    assertEquals(1f, brandArtScale(padded.ink, cornerFraction = 0.25f), 1e-6f)
    assertTrue(brandArtScale(padded.ink, cornerFraction = 0.5f) > 0.99f)
  }

  @Test
  fun aWideMarkIsMeasuredAgainstItsLongerSide() {
    // A wordmark-shaped bar, full width, 4 of 40 pixels tall, in a 40 × 20 picture.
    val art = brandArtOf(40, 20) { _, y -> if (y in 8 until 12) 1f else 0f }
    // Its ends sit 0.5 out on x and 0.05 on y; the circle allows 0.44 along that line.
    assertEquals(0.44f / kotlin.math.hypot(0.5f, 0.05f), brandArtScale(art.ink, cornerFraction = 0.5f), 1e-3f)
  }

  @Test
  fun anOpaquePictureFillsAsItAlwaysHas() {
    assertTrue(brandArtOf(16, 16) { _, _ -> 1f }.opaqueCorners)
    // One clear corner is enough to read it as a mark, which is then drawn whole.
    assertFalse(brandArtOf(16, 16) { x, y -> if (x == 0 && y == 0) 0f else 1f }.opaqueCorners)
  }

  @Test
  fun aClearPictureHasNothingToFit() {
    val art = brandArtOf(16, 16) { _, _ -> 0f }
    assertEquals(0, art.ink.size)
    assertEquals(1f, brandArtScale(art.ink, cornerFraction = 0.5f), 1e-6f)
  }
}
