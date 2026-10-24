package com.aglyn.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A brand picture's art is drawn whole inside its badge, never cut by the badge's shape; the twin of Apple's BrandArtTests. */
class BrandArtTest {
  /** A [side]-pixel picture whose ink is the square from [from] up to [to] (exclusive), on a clear ground. */
  private fun square(side: Int, from: Int, to: Int) =
    brandArtOf(side, side) { x, y -> if (x in from until to && y in from until to) 1f else 0f }

  /** A round seal whose circle touches all four edges of a [side]-pixel picture, on a clear ground. */
  private fun disc(side: Int): BrandArt {
    val r = side / 2f
    return brandArtOf(side, side) { x, y -> if (kotlin.math.hypot(x + 0.5f - r, y + 0.5f - r) <= r) 1f else 0f }
  }

  @Test
  fun artIsMeasuredByItsInkNotItsCanvas() {
    // The kit's 2-pixel clear margin is canvas, not art: the box is the 20-pixel square, and its corners are ink.
    val art = square(24, 2, 22)
    assertEquals(2f / 24, art.left, 1e-6f)
    assertEquals(22f / 24, art.right, 1e-6f)
    assertTrue(art.opaqueCorners, "solid to the corners of its box: a tile, which fills")
    // Its farthest ink is the box's corner, 0.707 of its side from the center; the circle allows 0.5 − 0.06.
    assertEquals(0.44f / 0.70711f, brandArtScale(art.ink, cornerFraction = 0.5f), 1e-3f)
  }

  @Test
  fun aRoundedSquareOnlyCostsTheCornersTheirArc() {
    // A square mark with one clear pixel at each corner of its box, so it reads as a mark rather than a tile.
    val art = brandArtOf(24, 24) { x, y ->
      val corner = (x == 2 || x == 21) && (y == 2 || y == 21)
      if (x in 2 until 22 && y in 2 until 22 && !corner) 1f else 0f
    }
    assertFalse(art.opaqueCorners)
    // A square badge has no corner to clear: only the margin is kept. A rounded one costs the corners their arc too.
    assertEquals(0.88f, brandArtScale(art.ink, cornerFraction = 0f), 1e-3f)
    assertEquals(0.806f, brandArtScale(art.ink, cornerFraction = 0.25f), 1e-3f)
    assertNull(brandBadgeScale(art, 0.25f), "a square mark is not a badge: it keeps its room")
  }

  @Test
  fun offCenterInkIsCenteredByItsInk() {
    // A client logo with off-center ink: a 512-pixel canvas whose mark runs x 0–433 and y 43–468, read at 128.
    val art = brandArtOf(128, 128) { x, y -> if (x in 0 until 108 && y in 11 until 117) 1f else 0f }
    assertEquals(0f, art.left, 1e-6f)
    assertEquals(108f / 128, art.right, 1e-6f)
    assertEquals(11f / 128, art.top, 1e-6f)
    // Measured from its own center, the ink reaches exactly as far left as right.
    val xs = art.ink.filterIndexed { i, _ -> i % 2 == 0 }
    assertEquals(0.5f, xs.max(), 1e-6f)
    assertEquals(0.5f, xs.min(), 1e-6f)
  }

  @Test
  fun aRoundBadgeIsDrawnEdgeToEdge() {
    // A round seal touching all four edges: clear corners, so not opaque, but it already fits a rounded square whole.
    val art = disc(96)
    assertFalse(art.opaqueCorners)
    assertEquals(1f, brandBadgeScale(art, 0.25f) ?: 0f, 0.02f)
    // On the rail it takes the whole tile, with no plate under it (Figma Type=Picture).
    val layout = BrandFit.Tile(32f, 0.25f, 22f).layout(art)
    assertFalse(layout.fill)
    assertFalse(layout.plate)
    assertEquals(32f, layout.inkSide, 0.7f)
  }

  @Test
  fun aMarkSitsOnThePlateInTheSlot() {
    // A state-outline-like mark with ink in its box's top-left corner, so it is a mark, not a badge.
    val art = brandArtOf(64, 64) { x, y -> if (x in 0 until 54 && y in 5 until 58 && (y < 30 || x > 10)) 1f else 0f }
    assertNull(brandBadgeScale(art, 0.25f))
    assertEquals(BrandLayout(fill = false, inkSide = 22f, plate = true), BrandFit.Tile(32f, 0.25f, 22f).layout(art))
    // A photo covers the tile: its shorter side spans it.
    val photo = brandArtOf(40, 20) { _, _ -> 1f }
    assertEquals(BrandLayout(fill = true, inkSide = 64f, plate = false), BrandFit.Tile(32f, 0.25f, 22f).layout(photo))
  }

  @Test
  fun aWideMarkIsMeasuredAgainstItsLongerSide() {
    // A wordmark-shaped bar, full width, 4 of 40 pixels tall, in a 40 × 20 picture: its box is 40 × 4.
    val art = brandArtOf(40, 20) { _, y -> if (y in 8 until 12) 1f else 0f }
    assertEquals(10f, art.aspect, 1e-6f)
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
    assertNull(brandBadgeScale(art, 0.5f))
  }

  @Test
  fun aReductionAveragesEveryPixelItCovers() {
    // A 4 × 4 checker of opaque black and white halves to mid grey: every output pixel covers two of each.
    val checker = IntArray(16) { i -> if ((i % 4 + i / 4) % 2 == 0) 0xFF000000.toInt() else 0xFFFFFFFF.toInt() }
    val half = areaAverage(checker, 4, 0, 0, 4, 4, 2, 2)
    for (c in half) {
      assertEquals(255, c ushr 24)
      assertEquals(128f, ((c shr 16) and 0xFF).toFloat(), 1f)
    }
    // A clear pixel's color never bleeds into the art: red beside clear green stays red, at half the opacity.
    val edge = intArrayOf(0xFFFF0000.toInt(), 0x0000FF00)
    val one = areaAverage(edge, 2, 0, 0, 2, 1, 1, 1).single()
    assertEquals(128f, (one ushr 24).toFloat(), 1f)
    assertEquals(0xFF0000, one and 0xFFFFFF)
    // A box cut from the middle reads only its own pixels.
    val strip = IntArray(9) { i -> if (i == 4) 0xFF0000FF.toInt() else 0 }
    assertEquals(0xFF0000FF.toInt(), areaAverage(strip, 3, 1, 1, 1, 1, 1, 1).single())
  }

  @Test
  fun aThirdReductionSpreadsEachSourcePixelOverTheOutputsItFalls() {
    // 3 pixels into 2: the middle one is split half and half, so a lone opaque middle pixel gives two at a third.
    val row = intArrayOf(0, 0xFFFFFFFF.toInt(), 0)
    val out = areaAverage(row, 3, 0, 0, 3, 1, 2, 1)
    for (c in out) assertEquals(85f, (c ushr 24).toFloat(), 1f)
  }
}
