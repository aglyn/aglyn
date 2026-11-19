// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynScreens

/// A day key is a calendar day, not a moment: it reads the same in every time zone (the console's `formatDayKey`).
final class CalendarDayFormatTests: XCTestCase {
  func testADayKeyIsTheSameDayWhereverTheDeviceIs() {
    let before = ScreenValues.timeZone
    defer { ScreenValues.timeZone = before }
    ScreenValues.timeZone = TimeZone(identifier: "America/Chicago")!
    XCTAssertEqual(ScreenValues.render("{item.day:date}", in: ["item": ["day": "2027-11-15"]]), "Nov 15, 2027")
    XCTAssertEqual(ScreenValues.render("{item.at:date}", in: ["item": ["at": 1_826_301_600_000]]), "Nov 15, 2027")
    XCTAssertNil(ScreenValues.calendarDayText("2027-13-01"))
  }
}
