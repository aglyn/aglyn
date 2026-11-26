// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// The platform lockdown's notice in the console's `PlatformLockdownGate` words.
final class PlatformLockdownTests: XCTestCase {
  func testAnOpenOrUnreadAnswerHoldsNobody() {
    XCTAssertNil(PlatformLockdownNotice(nil, brand: "Aglyn"))
    XCTAssertNil(PlatformLockdownNotice(["locked": false], brand: "Aglyn"))
  }

  func testALockWithNothingSaidUsesTheConsolesWords() throws {
    let notice = try XCTUnwrap(PlatformLockdownNotice(["locked": true, "title": " ", "message": ""], brand: "Aglyn"))
    XCTAssertEqual(notice.title, "Temporarily unavailable")
    XCTAssertEqual(notice.message, "Aglyn is temporarily unavailable. Please check back shortly.")
    XCTAssertNil(notice.until)
    XCTAssertNil(notice.contact)
  }

  func testALockSaysItsOwnWordsItsEndAndWhoToAsk() throws {
    let notice = try XCTUnwrap(
      PlatformLockdownNotice(
        ["locked": true, "title": "Down for maintenance", "message": "Back soon.", "contact": "help@example.test",
         "untilMs": .number(1_794_000_000_000)],
        brand: "Aglyn", locale: Locale(identifier: "en_US"), timeZone: TimeZone(identifier: "UTC")!))
    XCTAssertEqual(notice.title, "Down for maintenance")
    XCTAssertEqual(notice.message, "Back soon.")
    XCTAssertEqual(notice.contact, "help@example.test")
    XCTAssertTrue(notice.until?.hasPrefix("Expected back by ") == true)
    XCTAssertTrue(notice.until?.hasSuffix(".") == true)
  }
}
