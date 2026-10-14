// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynHardware

/// The Kotlin kit's `HardwareTest` print-document cases, replayed.
final class PrintDocumentTests: XCTestCase {
  func testFoldsAccentsAndSpellsPunctuationInAscii() {
    XCTAssertEqual(toPrintable("Crème brûlée • “hot” – €3…"), "Creme brulee * \"hot\" - EUR3...")
    XCTAssertEqual(toPrintable("日本"), "??")
    XCTAssertEqual(toPrintable("a\u{00A0}b"), "a b")
    XCTAssertEqual(toPrintable("a 😀 b"), "a ? b", "a character outside the font is one question mark, whatever its width")
    XCTAssertEqual(toPrintable(nil), "")
  }

  func testWrapsOnWordsAndBreaksOnlyAnOverlongWord() {
    XCTAssertEqual(wrapText("one two three four", width: 9), ["one two", "three", "four"])
    XCTAssertEqual(wrapText("abcdefghijkl", width: 5), ["abcde", "fghij", "kl"])
    XCTAssertEqual(wrapText("   ", width: 5), [""])
  }

  func testPutsTheAmountFlushRight() {
    XCTAssertEqual(twoColumnLines("Latte", "$9.00", width: 20), ["Latte          $9.00"])
    let lines = twoColumnLines("A very long product name indeed", "$12.00", width: 20)
    XCTAssertTrue(lines.last?.hasSuffix("$12.00") == true)
    XCTAssertTrue(lines.allSatisfy { $0.count <= 20 })
  }

  func testReducesABarcodeToCode128SetB() {
    XCTAssertEqual(code128Printable(" #1042 "), "#1042")
    XCTAssertEqual(code128Printable(String(repeating: "x", count: 40)).count, 20)
  }

  func testRendersPlainTextWithAlignmentAndBrackets() {
    let text = renderText(
      PrintDocument(
        columns: 10,
        ops: [.text("Hi", align: .center), .text("R", align: .right), .feed(1), .barcode("42"), .drawer, .cut]))
    XCTAssertEqual(text, "    Hi\n         R\n\n   [42]\n")
  }

  func testADrawerKickPrintsNothingInPlainText() {
    XCTAssertEqual(renderText(drawerKickDocument()), "\n")
  }
}
