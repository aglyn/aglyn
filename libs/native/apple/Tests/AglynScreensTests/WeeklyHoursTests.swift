// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// The weekly hours text replayed from libs/native/screens/weekly-hours-cases.json, which the console's own conversion
/// produced (the Kotlin renderer replays the same file).
final class WeeklyHoursTests: XCTestCase {
  private func cases() throws -> JSONValue {
    let data = try Data(contentsOf: ScreenSpecTests.screensDir.appendingPathComponent("weekly-hours-cases.json"))
    return try XCTUnwrap(JSONValue.decode(data))
  }

  private func week(_ json: JSONValue) -> [[HoursInterval]] {
    (json.arrayValue ?? []).map { day in
      (day.arrayValue ?? []).map { pair in
        let ends = pair.arrayValue ?? []
        return HoursInterval(start: Int(ScreenValues.number(ends[0]) ?? -1), end: Int(ScreenValues.number(ends[1]) ?? -1))
      }
    }
  }

  func testEveryTextReadsAsTheConsolesWeekAndWritesBackTheConsolesLines() throws {
    for item in try cases()["cases"].array {
      let text = item["text"]?.stringValue ?? ""
      let read = WeeklyHours.fromText(text)
      XCTAssertEqual(read.week, week(try XCTUnwrap(item["week"])), "week of: \(text)")
      XCTAssertEqual(read.unread, (item["unread"]?.arrayValue ?? []).map { Int(ScreenValues.number($0) ?? -1) }, "unread lines of: \(text)")
      XCTAssertEqual(WeeklyHours.toText(read.week), item["canonical"]?.stringValue, "lines of: \(text)")
    }
  }

  func testAClockReadsAs24HoursAndForAMenu() throws {
    for item in try cases()["clocks"].array {
      let minutes = Int(ScreenValues.number(item["minutes"]) ?? -1)
      XCTAssertEqual(WeeklyHours.clock(minutes), item["clock"]?.stringValue)
      XCTAssertEqual(WeeklyHours.label(minutes), item["label"]?.stringValue)
    }
    XCTAssertEqual(WeeklyHours.times.count, 97)
    XCTAssertEqual(WeeklyHours.times.last, WeeklyHours.lastMinute)
  }
}
