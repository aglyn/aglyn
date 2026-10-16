package com.aglyn.hardware

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The label page laid out as the console's CSS lays it out; the Apple kit's `LabelSheetTests` checks the same numbers. */
class LabelSheetTest {
  private fun near(expected: Double, actual: Double?, message: String = "") =
    assertTrue(actual != null && abs(expected - actual) < 0.001, "$message expected $expected, got $actual")

  @Test
  fun stacksTheNameOptionsPriceThenBarsFillingTheRest() {
    val layout = layoutLabel(162.0, 90.0, nameLines = 1, hasDetail = true, hasPrice = true, hasBars = true)
    near(5.76, layout.name.x)
    near(4.32, layout.name.y)
    near(162 - 11.52, layout.name.width)
    near(9.9, layout.name.height)
    near(14.22, layout.detail?.y)
    near(14.22 + 7.7, layout.price?.y)
    near(14.22 + 7.7 + 13.2, layout.bars?.y)
    near(layout.bars!!.bottom, layout.code?.y, "the digits sit under the bars")
    near(90 - 4.32, layout.code?.bottom, "and end at the bottom padding")
  }

  @Test
  fun theNameTakesAtMostTwoLinesAndTheBarsNeverLessThanAThirdOfAnInch() {
    val tall = layoutLabel(162.0, 90.0, nameLines = 5, hasDetail = false, hasPrice = false, hasBars = true)
    near(19.8, tall.name.height)
    assertNull(tall.detail)
    assertNull(tall.price)
    near(21.6, layoutLabel(144.0, 36.0, 2, hasDetail = true, hasPrice = true, hasBars = true).bars?.height)
  }

  @Test
  fun aLabelWithNoBarcodeHasNoBarsOrDigits() {
    val layout = layoutLabel(162.0, 90.0, 1, hasDetail = false, hasPrice = true, hasBars = false)
    assertNull(layout.bars)
    assertNull(layout.code)
  }

  @Test
  fun drawsOneRectPerRunOfBarsInsideTheQuietZone() {
    // 4 modules + 20 quiet = 24 units across 240pt: 10pt a module.
    assertEquals(listOf(LabelRect(100.0, 5.0, 20.0, 30.0), LabelRect(130.0, 5.0, 10.0, 30.0)), barRects("1101", LabelRect(0.0, 5.0, 240.0, 30.0)))
    assertEquals(emptyList(), barRects("", LabelRect(0.0, 0.0, 100.0, 10.0)))
    assertEquals(emptyList(), barRects("000", LabelRect(0.0, 0.0, 100.0, 10.0)))
  }

  @Test
  fun wrapsTheNameOnWordsAndCutsTheDetailWithAnEllipsis() {
    val fits = { text: String -> text.length <= 8 }
    assertEquals(listOf("Latte", "mug with", "handle"), wrapToWidth("Latte mug with handle", fits))
    assertEquals(listOf("Abcdefgh", "ijk"), wrapToWidth("Abcdefghijk", fits))
    assertEquals("Small /…", ellipsize("Small / Blue", fits))
    assertEquals("Blue", ellipsize("Blue", fits))
  }

  @Test
  fun drawsTheLabelsPartsWhereTheLayoutPutsThem() {
    val drawn = mutableListOf<String>()
    val canvas = object : LabelCanvas {
      override fun measure(text: String, size: Double, bold: Boolean) = text.length * size * 0.5
      override fun text(text: String, x: Double, baseline: Double, size: Double, bold: Boolean) { drawn += "$text@$size${if (bold) "b" else ""}" }
      override fun fill(rect: LabelRect) { drawn += "bar" }
    }
    drawLabel(PrintLabel("Mug", "Blue", "$12.50", "101", "4006"), 162.0, 90.0, 0.0, 0.0, canvas)
    assertEquals(listOf("Mug@9.0b", "Blue@7.0", "$12.50@11.0b", "bar", "bar", "4006@7.0"), drawn)
  }

  @Test
  fun aPdfIsKnownByItsHeader() {
    assertTrue(isPdf("%PDF-1.7".encodeToByteArray()))
    assertEquals(false, isPdf(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47)))
    assertEquals(false, isPdf(ByteArray(0)))
  }
}
