// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// The check-in day helpers replay the console's recorded cases; the row labels hold commerce-check-in.spec.ts's answers.
final class CheckInRulesTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let list = (Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]] ?? []
    XCTAssertFalse(list.isEmpty, "\(name) has no cases")
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  private func plain(_ value: Any) -> Any? { value is NSNull ? nil : value }

  func testDayHelpersAsTheConsole() {
    for item in cases("checkInDayLabel") { XCTAssertEqual(checkInDayLabel(plain(item.args[0]) as? String), item.result as? String, "\(item.args)") }
    for item in cases("isCheckInDayKey") { XCTAssertEqual(isCheckInDayKey(plain(item.args[0])), item.result as? Bool, "\(item.args)") }
    for item in cases("addCheckInDays") {
      XCTAssertEqual(addCheckInDays(item.args[0] as! String, (item.args[1] as! NSNumber).doubleValue), item.result as? String, "\(item.args)")
    }
    for item in cases("checkInUseDayProblem") {
      XCTAssertEqual(checkInUseDayProblem(plain(item.args[0]), todayKey: item.args[1] as! String), plain(item.result) as? String, "\(item.args)")
    }
  }

  private func pass(
    status: CheckInStatus = .expected, rainCheck: CheckInRainCheck? = nil, rainCheckOpen: Bool? = nil, variantLabel: String? = nil,
    unitIndex: Double = 0, unitCount: Double = 1, source: HostCheckInSource = .order, dayKey: String = "2027-01-15"
  ) -> HostCheckIn {
    HostCheckIn(
      channel: .pos, createdAtMs: 1, customerKey: "k", dayKey: dayKey, itemName: "Day pass", rainCheck: rainCheck,
      rainCheckOpen: rainCheckOpen, searchTokens: [], source: source, status: status, unitCount: unitCount, unitIndex: unitIndex,
      updatedAtMs: 1, variantLabel: variantLabel)
  }

  func testRowLabelsAsTheConsoleSpec() {
    XCTAssertEqual(checkInItemLabel(pass(variantLabel: "Adult", unitIndex: 1, unitCount: 3)), "Day pass · Adult (2 of 3)")
    XCTAssertEqual(checkInItemLabel(pass()), "Day pass")
    XCTAssertEqual(describeWristband(CheckInWristband(color: "Blue", number: "214")), "Blue #214")
    XCTAssertEqual(describeWristband(nil), "")
    let rainCheck = CheckInRainCheck(atMs: 1, byName: "Cal", byUid: "cashier", fromDayKey: "2027-01-15", kind: .open)
    XCTAssertEqual(rainCheckLabel(pass(rainCheck: rainCheck, rainCheckOpen: true)), "Rain check from Fri, Jan 15: good on any later day")
    var used = rainCheck
    used.claimedDayKey = "2027-01-17"
    XCTAssertEqual(rainCheckLabel(pass(rainCheck: used)), "Rain check from Fri, Jan 15, used Sun, Jan 17")
    var moved = rainCheck
    moved.kind = .date
    moved.toDayKey = "2027-01-16"
    XCTAssertEqual(rainCheckLabel(pass(rainCheck: moved)), "Rain check: moved from Fri, Jan 15 to Sat, Jan 16")
    XCTAssertEqual(rainCheckLabel(pass()), "")
    XCTAssertEqual(checkInStatusLabel(pass(rainCheckOpen: true)), "Rain check")
    XCTAssertEqual(checkInStatusLabel(pass(status: .checkedIn)), "Checked in")
    XCTAssertEqual(
      checkInDayTotals([pass(rainCheckOpen: true), pass(), pass(status: .checkedIn)]),
      CheckInDayTotals(checkedIn: 1, expected: 2, rainChecks: 1))
    XCTAssertNil(rainCheckProblem(pass(dayKey: "2027-01-14"), kind: "date", dayKey: "2027-01-15", todayKey: "2027-01-15"))
    XCTAssertTrue(rainCheckProblem(pass(dayKey: "2027-01-10"), kind: "date", dayKey: "2027-01-12", todayKey: "2027-01-15")?.contains("passed") == true)
    XCTAssertEqual(rainCheckProblem(pass(), kind: "date", dayKey: "2027-01-15", todayKey: "2027-01-15"), "Choose a day after the one the pass is on.")
    XCTAssertEqual(alreadyCheckedInLabel(timeLabel: "9:05 AM", byName: "Sam"), "Already checked in at 9:05 AM by Sam")
  }
}
