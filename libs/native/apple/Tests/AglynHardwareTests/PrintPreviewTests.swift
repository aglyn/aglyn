// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynHardware

/// The receipt preview lays a double-size line over half the columns, so drawn at twice the size it spans the paper.
final class PrintPreviewTests: XCTestCase {
  func testADoubleSizeLineSpansHalfTheColumnsAndKeepsItsAmountRight() {
    let document = PrintDocument(
      columns: 40, ops: [.text("Subtotal"), .text("TOTAL         $15.39", bold: true, size: 2), .feed(1), .barcode("1042")])
    let lines = renderPreviewLines(document)
    XCTAssertEqual(lines.map(\.double), [false, true, false, false])
    XCTAssertEqual(lines[1].text, "TOTAL         $15.39")
    XCTAssertTrue(lines[1].bold)
    XCTAssertLessThanOrEqual(lines[1].text.count, 20)
    XCTAssertEqual(lines[2].text, "")
    XCTAssertEqual(lines[3].text.trimmingCharacters(in: .whitespaces), "[1042]")
  }
}
