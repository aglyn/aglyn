// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynOutreachPlugin

private func functionCases(_ name: String) throws -> [(args: [Any], result: Any)] {
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { url.deleteLastPathComponent() }
  url.appendPathComponent("native/contracts/function-cases.generated.json")
  let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
  let function = (root?["functions"] as? [String: Any])?[name] as? [String: Any]
  let cases = try XCTUnwrap(function?["cases"] as? [[String: Any]], "no cases for \(name)")
  return cases.map { ($0["args"] as? [Any] ?? [], $0["result"] ?? NSNull()) }
}

final class OutreachTests: XCTestCase {
  /// The errors the editor holds a save on are the console's, path for path; warnings stay the route's.
  func testSequenceErrorsAreTheConsoles() throws {
    for (index, item) in try functionCases("validateOutreachSequence").enumerated() {
      let sequence = item.args[0] as! [String: Any]
      let steps = (sequence["steps"] as? [[String: Any]] ?? []).map(SequenceStep.init)
      let got = validateSequence(name: sequence["name"] as? String ?? "", mailboxID: sequence["mailboxId"] as? String ?? "", steps: steps)
      let want = (item.result as? [[String: Any]] ?? []).filter { $0["severity"] as? String == "error" }
      XCTAssertEqual(got.map(\.code), want.compactMap { $0["code"] as? String }, "case \(index)")
      XCTAssertEqual(got.map(\.path), want.compactMap { $0["path"] as? String }, "case \(index)")
      XCTAssertEqual(got.map(\.message), want.compactMap { $0["message"] as? String }, "case \(index)")
    }
  }

  func testPermissionFollowsRoleCustomRoleAndOverride() {
    XCTAssertTrue(outreachPermitted(member: ["role": "owner"], role: nil))
    XCTAssertTrue(outreachPermitted(member: ["role": "admin"], role: nil))
    XCTAssertFalse(outreachPermitted(member: ["role": "editor"], role: nil))
    XCTAssertFalse(outreachPermitted(member: nil, role: nil))
    XCTAssertTrue(outreachPermitted(member: ["role": "editor", "roleId": "r"], role: ["permissions": ["outreach.use": true]]))
    XCTAssertFalse(outreachPermitted(member: ["role": "admin", "roleId": "r"], role: ["permissions": ["outreach.use": false]]))
    XCTAssertFalse(outreachPermitted(member: ["role": "admin", "permissions": ["outreach.use": false]], role: nil))
  }

  /// A sequence's Results read as the console's `outreachSequenceReport` reads them, figure for figure and caveat for caveat.
  func testSequenceReportIsTheConsoles() throws {
    let num = { (value: Any?) -> Double? in (value as? NSNumber)?.doubleValue }
    for (index, item) in try functionCases("outreachSequenceReport").enumerated() {
      let got = outreachSequenceReport(
        item.args[0] as? [String: Any], trackClicks: item.args[1] as? Bool == true,
        countOpens: item.args.count > 2 ? item.args[2] as? Bool == true : false)
      let want = item.result as! [String: Any]
      XCTAssertEqual(got.sent, num(want["sent"]), "case \(index)")
      XCTAssertEqual(got.people, num(want["people"]), "case \(index)")
      XCTAssertEqual(got.clicks, num(want["clicks"]), "case \(index)")
      XCTAssertEqual(got.uniqueClicks, num(want["uniqueClicks"]), "case \(index)")
      XCTAssertEqual(got.machineClicks, num(want["machineClicks"]), "case \(index)")
      XCTAssertEqual(got.lastClickAtMs, num(want["lastClickAtMs"]), "case \(index)")
      XCTAssertEqual(got.clickTracked, want["clickTracked"] as? Bool, "case \(index)")
      XCTAssertEqual(got.openTracked, want["openTracked"] as? Bool, "case \(index)")
      XCTAssertEqual(got.openPeople, num(want["openPeople"]), "case \(index)")
      XCTAssertEqual(got.opens, num(want["opens"]), "case \(index)")
      XCTAssertEqual(got.uniqueOpens, num(want["uniqueOpens"]), "case \(index)")
      XCTAssertEqual(got.machineOpens, num(want["machineOpens"]), "case \(index)")
      XCTAssertEqual(got.proxyOpens, num(want["proxyOpens"]), "case \(index)")
      XCTAssertEqual(got.lastOpenAtMs, num(want["lastOpenAtMs"]), "case \(index)")
      XCTAssertEqual(got.opensUnmeasured, want["opensUnmeasured"] as? Bool, "case \(index)")
      let rates = want["rates"] as? [String: Any] ?? [:]
      for (rate, wanted) in [(got.clickRate, rates["click"]), (got.openRate, rates["open"])] {
        let object = wanted as? [String: Any]
        XCTAssertEqual(rate?.numerator, num(object?["numerator"]), "case \(index)")
        XCTAssertEqual(rate?.denominator, num(object?["denominator"]), "case \(index)")
        XCTAssertEqual(rate?.denominatorLabel, object?["denominatorLabel"] as? String, "case \(index)")
        XCTAssertEqual(rate?.value ?? -1, num(object?["value"]) ?? -1, accuracy: 1e-12, "case \(index)")
      }
      let caveats = want["caveats"] as? [[String: Any]] ?? []
      XCTAssertEqual(got.caveats.map(\.id), caveats.compactMap { $0["id"] as? String }, "case \(index)")
      XCTAssertEqual(got.caveats.map(\.message), caveats.compactMap { $0["message"] as? String }, "case \(index)")
    }
  }

  /// The links followed are the campaign report's own table (the core's `sendLinkReport`).
  func testSequenceLinkReportIsTheConsoles() throws {
    for (index, item) in try functionCases("outreachSequenceLinkReport").enumerated() {
      let got = sendLinkReport(item.args.first as? [String: Any])
      let want = item.result as! [String: Any]
      XCTAssertEqual(got.rows.map(\.url), (want["rows"] as? [[String: Any]] ?? []).compactMap { $0["url"] as? String }, "case \(index)")
      XCTAssertEqual(got.rows.map(\.clicks), (want["rows"] as? [[String: Any]] ?? []).compactMap { ($0["clicks"] as? NSNumber)?.intValue }, "case \(index)")
      XCTAssertEqual(got.overflowClicks, (want["overflowClicks"] as? NSNumber)?.intValue, "case \(index)")
      XCTAssertEqual(got.truncated, want["truncated"] as? Bool, "case \(index)")
    }
    XCTAssertEqual(formatOutreachTime(nil, timeZone: nil), "—")
  }
}
