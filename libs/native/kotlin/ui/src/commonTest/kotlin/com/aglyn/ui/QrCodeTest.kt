package com.aglyn.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class QrCodeTest {
  private fun textOf(name: String): String = when (name) {
    "short" -> "a"
    "hello" -> "hello world"
    "url" -> "https://pay.example.com/c/abc123"
    "v10" -> "x".repeat(190)
    "v25" -> "abcdefghij".repeat(60)
    "v9" -> "b".repeat(230)
    "v10edge" -> "b".repeat(231)
    "v40" -> "z".repeat(2900)
    "stripe_long" ->
      "https://checkout.stripe.com/c/pay/cs_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V2w3X4y5Z6a7B8c9D0e1F2g3H4#" + "fidkdWxOYHwnPyd1blpxYHZxWjA0".repeat(30)
    else -> QR_GOLDEN.getValue(name).text
  }

  @Test
  fun everySymbolIsTheOneTheConsolesEncoderDraws() {
    for ((name, golden) in QR_GOLDEN) {
      val code = assertNotNull(QrCode.encode(textOf(name)), name)
      assertEquals(golden.size, code.size, "$name: size")
      var wrong = 0
      for (y in 0 until golden.size) for (x in 0 until golden.size) if (code.isDark(x, y) != golden.isDark(x, y)) wrong++
      assertEquals(0, wrong, "$name: modules that differ")
    }
  }

  @Test
  fun theVersionGrowsWithTheTextAndTheCountFieldWidensAtVersionTen() {
    assertEquals(1, QrCode.encode("a")!!.version)
    assertEquals(9, QrCode.encode("b".repeat(230))!!.version)
    assertEquals(10, QrCode.encode("b".repeat(231))!!.version, "one byte more needs the wider count field")
    assertEquals(40, QrCode.encode("z".repeat(2900))!!.version)
    assertEquals(177, QrCode.encode("z".repeat(2900))!!.size)
  }

  @Test
  fun aTextTooLongForAnyVersionIsNotDrawn() {
    assertNotNull(QrCode.encode("q".repeat(QrCode.MAX_BYTES)))
    assertNull(QrCode.encode("q".repeat(QrCode.MAX_BYTES + 1)))
    assertNull(QrCode.encode(""))
    assertFalse(qrCodeFits("q".repeat(QrCode.MAX_BYTES + 1)))
    assertTrue(qrCodeFits("https://pay.example.com/c/abc123"))
  }

  @Test
  fun theThreeFinderPatternsAndTheTimingLineAreWhereTheyBelong() {
    val code = QrCode.encode("hello world")!!
    val last = code.size - 7
    for ((x0, y0) in listOf(0 to 0, last to 0, 0 to last)) {
      for (i in 0 until 7) {
        assertTrue(code.isDark(x0 + i, y0) && code.isDark(x0 + i, y0 + 6) && code.isDark(x0, y0 + i) && code.isDark(x0 + 6, y0 + i))
      }
      assertFalse(code.isDark(x0 + 1, y0 + 1), "the finder's light ring")
      assertTrue(code.isDark(x0 + 3, y0 + 3), "and its dark core")
    }
    for (i in 8 until code.size - 8) assertEquals(i % 2 == 0, code.isDark(i, 6), "timing row at $i")
    assertFalse(code.isDark(-1, 0))
  }
}
