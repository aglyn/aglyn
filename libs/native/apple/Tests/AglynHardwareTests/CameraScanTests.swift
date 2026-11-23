// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynHardware

final class CameraScanTests: XCTestCase {
  // The same cases as Android's CameraScanFilterTest.
  func testABarcodeInViewCountsOnceUntilItLeaves() {
    var filter = CameraScanFilter(repeatAfter: 1.0)
    XCTAssertEqual(filter.accept(" 012345678905 ", at: 0), "012345678905")
    XCTAssertNil(filter.accept("012345678905", at: 0.1))
    XCTAssertNil(filter.accept("012345678905", at: 0.9))
    // Still in view: each read pushes the window on.
    XCTAssertNil(filter.accept("012345678905", at: 1.8))
    XCTAssertEqual(filter.accept("012345678905", at: 3.0), "012345678905")
    XCTAssertEqual(filter.accept("SKU-1", at: 3.01), "SKU-1")
  }

  func testNoiseIsNotAScan() {
    var filter = CameraScanFilter()
    XCTAssertNil(filter.accept(nil, at: 0))
    XCTAssertNil(filter.accept("12", at: 0))
    XCTAssertNil(filter.accept(String(repeating: "x", count: 65), at: 0))
    XCTAssertNil(filter.accept("12\u{0}34", at: 0))
  }

  func testAResetCountsTheSameCodeAgain() {
    var filter = CameraScanFilter()
    XCTAssertEqual(filter.accept("4006381333931", at: 0), "4006381333931")
    filter.reset()
    XCTAssertEqual(filter.accept("4006381333931", at: 0.1), "4006381333931")
  }

  func testAScannerTypingIntoAFieldIsABurst() {
    var detector = HIDScanDetector()
    detector.feedEdit(from: "", to: "40063", at: 0)
    detector.feedEdit(from: "40063", to: "4006381333931", at: 0.01)
    XCTAssertEqual(detector.feed("\r", at: 0.02), "4006381333931")
  }

  func testAPersonTypingOrEditingIsNotABurst() {
    var slow = HIDScanDetector()
    for (index, length) in [1, 2, 3, 4, 5].enumerated() {
      slow.feedEdit(from: String("latte".prefix(length - 1)), to: String("latte".prefix(length)), at: Double(index) * 0.3)
    }
    XCTAssertNil(slow.feed("\r", at: 1.6))

    var edited = HIDScanDetector()
    edited.feedEdit(from: "", to: "4006381333931", at: 0)
    edited.feedEdit(from: "4006381333931", to: "400638133393", at: 0.01)
    XCTAssertNil(edited.feed("\r", at: 0.02))
  }
}
