package com.aglyn.hardware

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun hex(bytes: ByteArray) = bytes.joinToString(" ") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

class PrintDocumentTest {
  @Test
  fun foldsAccentsAndSpellsPunctuationInAscii() {
    assertEquals("Creme brulee * \"hot\" - EUR3...", toPrintable("Crème brûlée • “hot” – €3…"))
    assertEquals("??", toPrintable("日本"))
    assertEquals("a b", toPrintable("a b"))
  }

  @Test
  fun wrapsOnWordsAndBreaksOnlyAnOverlongWord() {
    assertEquals(listOf("one two", "three", "four"), wrapText("one two three four", 9))
    assertEquals(listOf("abcde", "fghij", "kl"), wrapText("abcdefghijkl", 5))
    assertEquals(listOf(""), wrapText("   ", 5))
  }

  @Test
  fun putsTheAmountFlushRight() {
    assertEquals(listOf("Latte          $9.00"), twoColumnLines("Latte", "$9.00", 20))
    val lines = twoColumnLines("A very long product name indeed", "$12.00", 20)
    assertTrue(lines.last().endsWith("$12.00"))
    assertTrue(lines.all { it.length <= 20 })
  }

  @Test
  fun reducesABarcodeToCode128SetB() {
    assertEquals("#1042", code128Printable(" #1042 "))
    assertEquals(20, code128Printable("x".repeat(40)).length)
  }

  @Test
  fun rendersPlainTextWithAlignmentAndBrackets() {
    val text = renderText(
      PrintDocument(
        10,
        listOf(
          PrintOp.Text("Hi", PrintAlign.CENTER),
          PrintOp.Text("R", PrintAlign.RIGHT),
          PrintOp.Feed(1),
          PrintOp.Barcode("42"),
          PrintOp.Drawer,
          PrintOp.Cut,
        ),
      ),
    )
    assertEquals("    Hi\n         R\n\n   [42]\n", text)
  }
}

class EscPosEncoderTest {
  @Test
  fun resetsThenSelectsPc437() {
    val out = EscPosEncoder().encode(PrintDocument(32, emptyList()))
    assertEquals("1b 40 1b 74 00", hex(out))
  }

  @Test
  fun encodesPlainLeftTextAsAsciiAndALineFeed() {
    val out = EscPosEncoder().encode(PrintDocument(32, listOf(PrintOp.Text("Café"))))
    assertEquals("1b 40 1b 74 00 43 61 66 65 0a", hex(out))
  }

  @Test
  fun setsAndResetsAlignmentBoldAndSizeAroundALine() {
    val out = EscPosEncoder().encode(PrintDocument(32, listOf(PrintOp.Text("TOTAL", PrintAlign.CENTER, bold = true, size = 2))))
    assertEquals(
      "1b 40 1b 74 00 " +
        "1b 61 01 1b 45 01 1d 21 11 " +
        "54 4f 54 41 4c 0a " +
        "1d 21 00 1b 45 00 1b 61 00",
      hex(out),
    )
  }

  @Test
  fun keepsADoubleSizeLineToHalfThePaper() {
    val out = EscPosEncoder().encode(PrintDocument(8, listOf(PrintOp.Text("ABCDEFGH", size = 2))))
    // Four characters, then the line feed.
    assertEquals("41 42 43 44 0a", hex(out.copyOfRange(8, 13)))
  }

  @Test
  fun feedsCutsAndClampsTheFeed() {
    val out = EscPosEncoder().encode(PrintDocument(32, listOf(PrintOp.Feed(2), PrintOp.Feed(40), PrintOp.Cut)))
    assertEquals("1b 40 1b 74 00 1b 64 02 1b 64 0a 1d 56 42 00", hex(out))
  }

  @Test
  fun kicksTheDrawerWithEscP() {
    assertContentEquals(bytes(0x1b, 0x40, 0x1b, 0x74, 0x00, 0x1b, 0x70, 0x00, 0x19, 0xfa), EscPosEncoder.drawerKickBytes())
    assertEquals("1b 70 01 19 fa", hex(EscPosEncoder(drawerPin = 1).encode(drawerKickDocument()).copyOfRange(5, 10)))
  }

  @Test
  fun printsCode128SetBCentered() {
    val out = EscPosEncoder().encode(PrintDocument(32, listOf(PrintOp.Barcode("#1042"))))
    assertEquals(
      "1b 40 1b 74 00 " +
        "1b 61 01 1d 68 40 1d 77 02 1d 48 02 " +
        "1d 6b 49 07 7b 42 23 31 30 34 32 0a " +
        "1b 61 00",
      hex(out),
    )
  }

  @Test
  fun printsTheStoredLogoOnlyWhenOneIsConfigured() {
    assertEquals("1b 40 1b 74 00", hex(EscPosEncoder().encode(PrintDocument(32, listOf(PrintOp.Logo)))))
    assertEquals(
      "1b 40 1b 74 00 1b 61 01 1c 70 01 00 1b 61 00",
      hex(EscPosEncoder(logoImage = 1).encode(PrintDocument(32, listOf(PrintOp.Logo)))),
    )
  }
}

class HidBurstDetectorTest {
  private fun burst(detector: HidBurstDetector, code: String, startMs: Long, gapMs: Long): Long {
    var at = startMs
    for (char in code) {
      detector.onCharacter(char, at)
      at += gapMs
    }
    return at
  }

  @Test
  fun readsAFastBurstEndedByEnterAsAScan() {
    val detector = HidBurstDetector()
    val end = burst(detector, "0012345678905", 1_000, 8)
    assertEquals("0012345678905", detector.onTerminator(end))
    assertEquals("", detector.pending)
  }

  @Test
  fun neverReadsTypingAsAScan() {
    val detector = HidBurstDetector()
    val end = burst(detector, "latte", 1_000, 140)
    assertNull(detector.onTerminator(end))
  }

  @Test
  fun startsOverWhenAKeyComesSlowly() {
    val detector = HidBurstDetector()
    detector.onCharacter('x', 0)
    val end = burst(detector, "LAT-S", 500, 10)
    assertEquals("LAT-S", detector.onTerminator(end))
  }

  @Test
  fun refusesAShortBurstAndALateTerminator() {
    val detector = HidBurstDetector()
    var end = burst(detector, "ab", 0, 5)
    assertNull(detector.onTerminator(end))
    end = burst(detector, "ABCDEF", 1_000, 5)
    assertNull(detector.onTerminator(end + 500))
  }

  @Test
  fun flushesABurstWithNoTerminatorOnceItGoesQuiet() {
    val detector = HidBurstDetector()
    val end = burst(detector, "MUG-SG", 0, 6)
    assertNull(detector.flush(end - 6 + 10))
    assertEquals("MUG-SG", detector.flush(end + 100))
    assertNull(detector.flush(end + 200))
  }
}

class CardCollectorTest {
  @Test
  fun acceptsOnlyASecretThatNamesItsOwnIntent() {
    assertNull(collectRequestProblem("pi_123456789", "pi_123456789_secret_abcdefghij"))
    assertEquals("The payment to collect is missing.", collectRequestProblem("nope", "pi_123456789_secret_abcdefghij"))
    assertEquals("The payment to collect is missing.", collectRequestProblem("pi_123456789", null))
    assertEquals(
      "The payment to collect does not match its secret.",
      collectRequestProblem("pi_123456789", "pi_987654321_secret_abcdefghij"),
    )
    assertEquals("The payment to collect does not match its secret.", collectRequestProblem("pi_123456789", "garbage"))
  }

  @Test
  fun theSdkStubIsUnavailableAndNeverCollects() = runTest {
    val reader = StripeTerminalSdkCollector()
    assertIs<CardCollectorState.Unavailable>(reader.state.value)
    val outcome = reader.collect(CardCollectRequest("pi_123456789", "pi_123456789_secret_abcdefghij", 1000))
    assertIs<CardCollectOutcome.Failed>(outcome)
  }

  @Test
  fun theSimulatedReaderValidatesThenCollectsTheAmount() = runTest {
    val reader = SimulatedCardCollector(delayMs = 0)
    val request = CardCollectRequest("pi_123456789", "pi_123456789_secret_abcdefghij", 1150)
    assertEquals("Connect the card reader first.", (reader.collect(request) as CardCollectOutcome.Failed).message)
    reader.connect("h1") { error("no token needed") }
    assertEquals(CardCollectOutcome.Collected("pi_123456789", 1150), reader.collect(request))
    val forged = reader.collect(request.copy(clientSecret = "pi_999999999_secret_abcdefghij"))
    assertEquals("The payment to collect does not match its secret.", (forged as CardCollectOutcome.Failed).message)
  }

  @Test
  fun readsTheRoutesSetupCodes() {
    assertEquals(CardReaderSetupCode.LOCATION_REQUIRED, CardReaderSetupCode.of("location-required"))
    assertNull(CardReaderSetupCode.of("other"))
  }
}
