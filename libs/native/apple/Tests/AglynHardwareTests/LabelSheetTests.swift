// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import CoreGraphics
import XCTest

@testable import AglynHardware

/// The label page laid out as the console's CSS lays it out; the Kotlin kit's `LabelSheetTest` checks the same numbers.
final class LabelSheetTests: XCTestCase {
  private let size = CGSize(width: 2.25 * 72, height: 1.25 * 72)

  func testStacksTheNameOptionsPriceThenBarsFillingTheRest() {
    let layout = layoutLabel(size: size, nameLines: 1, hasDetail: true, hasPrice: true, hasBars: true)
    XCTAssertEqual(layout.name.minX, 5.76, accuracy: 0.001)
    XCTAssertEqual(layout.name.minY, 4.32, accuracy: 0.001)
    XCTAssertEqual(layout.name.width, 162 - 11.52, accuracy: 0.001)
    XCTAssertEqual(layout.name.height, 9.9, accuracy: 0.001)
    XCTAssertEqual(layout.detail!.minY, 14.22, accuracy: 0.001)
    XCTAssertEqual(layout.price!.minY, 14.22 + 7.7, accuracy: 0.001)
    let bars = layout.bars!
    XCTAssertEqual(bars.minY, 14.22 + 7.7 + 13.2, accuracy: 0.001)
    // The digits sit under the bars and end at the bottom padding.
    XCTAssertEqual(layout.code!.minY, bars.maxY, accuracy: 0.001)
    XCTAssertEqual(layout.code!.maxY, 90 - 4.32, accuracy: 0.001)
  }

  func testTheNameTakesAtMostTwoLinesAndTheBarsNeverLessThanAThirdOfAnInch() {
    let tall = layoutLabel(size: size, nameLines: 5, hasDetail: false, hasPrice: false, hasBars: true)
    XCTAssertEqual(tall.name.height, 19.8, accuracy: 0.001)
    XCTAssertNil(tall.detail)
    XCTAssertNil(tall.price)
    let small = layoutLabel(size: CGSize(width: 144, height: 36), nameLines: 2, hasDetail: true, hasPrice: true, hasBars: true)
    XCTAssertEqual(small.bars!.height, 21.6, accuracy: 0.001, "the page clips what overflows, as the console's overflow: hidden")
  }

  func testALabelWithNoBarcodeHasNoBarsOrDigits() {
    let layout = layoutLabel(size: size, nameLines: 1, hasDetail: false, hasPrice: true, hasBars: false)
    XCTAssertNil(layout.bars)
    XCTAssertNil(layout.code)
  }

  func testDrawsOneRectPerRunOfBarsInsideTheQuietZone() {
    // 4 modules + 20 quiet = 24 units across 240pt: 10pt a module.
    let rects = barRects("1101", in: CGRect(x: 0, y: 5, width: 240, height: 30))
    XCTAssertEqual(rects, [CGRect(x: 100, y: 5, width: 20, height: 30), CGRect(x: 130, y: 5, width: 10, height: 30)])
    XCTAssertEqual(barRects("", in: CGRect(x: 0, y: 0, width: 100, height: 10)), [])
    XCTAssertEqual(barRects("000", in: CGRect(x: 0, y: 0, width: 100, height: 10)), [])
  }
}
