// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the weekly hours cases in function-cases.generated.json.
final class WeeklyHoursTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let list = ((Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]]) ?? []
    XCTAssertFalse(list.isEmpty, "no cases for \(name)")
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  private func week(_ value: Any) -> WeeklyHours {
    (value as? [[[String: Any]]] ?? []).map { day in
      day.map { WeeklyHoursInterval(start: ($0["start"] as? NSNumber)?.intValue ?? 0, end: ($0["end"] as? NSNumber)?.intValue ?? 0) }
    }
  }

  func testReadsHoursText() {
    for item in cases("weeklyHoursFromText") {
      // Only a string is hours text; anything else (null, a number) reads as an empty week.
      let parsed = weeklyHoursFromText(item.args[0] as? String)
      let expected = item.result as? [String: Any] ?? [:]
      XCTAssertEqual(parsed.hours, week(expected["hours"] as Any), "\(item.args)")
      XCTAssertEqual(parsed.unreadLines, (expected["unreadLines"] as? [NSNumber])?.map(\.intValue), "\(item.args)")
    }
  }

  func testWritesHoursText() {
    for item in cases("weeklyHoursToText") { XCTAssertEqual(weeklyHoursToText(week(item.args[0])), item.result as? String, "\(item.args)") }
  }

  func testClockText() {
    for item in cases("formatClockMinutes") { XCTAssertEqual(formatClockMinutes((item.args[0] as? NSNumber)?.intValue ?? 0), item.result as? String, "\(item.args)") }
    for item in cases("clockLabel") { XCTAssertEqual(clockLabel((item.args[0] as? NSNumber)?.intValue ?? 0), item.result as? String, "\(item.args)") }
  }
}
