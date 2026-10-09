// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

final class StaffStandingTests: XCTestCase {
  private func token(_ claims: [String: Any]) -> String {
    let data = try! JSONSerialization.data(withJSONObject: claims)
    let payload = data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    return "eyJhbGciOiJub25lIn0.\(payload).sig"
  }

  func testOnlyAStaffClaimMakesStaff() {
    XCTAssertEqual(
      idTokenClaims(token(["staff": true, "staffRole": "super"])).flatMap(StaffStanding.from(claims:)),
      StaffStanding(role: "super"))
    XCTAssertEqual(StaffStanding.from(claims: ["staff": true]), StaffStanding(role: nil))
    XCTAssertNil(StaffStanding.from(claims: ["staff": "true", "staffRole": "super"]))
    XCTAssertNil(StaffStanding.from(claims: ["staffRole": "super"]))
    XCTAssertNil(idTokenClaims("not-a-token"))
  }

  func testTheRoleGateAnswersAsTheConsoleDoes() {
    XCTAssertEqual(
      resolveStaffRoleGate(nil, ["super"]), StaffRoleGate(ready: false, admitted: false, blocked: false, reason: nil))
    XCTAssertEqual(
      resolveStaffRoleGate("super", ["super"]), StaffRoleGate(ready: true, admitted: true, blocked: false, reason: nil))
    XCTAssertEqual(
      resolveStaffRoleGate("support", ["super", "billing"]).reason,
      "This action requires the super or billing staff role. Ask someone who holds it.")
  }

  func testEveryRecordedGateCaseReplays() throws {
    let cases = try functionCases("resolveStaffRoleGate")
    XCTAssertFalse(cases.isEmpty)
    for (index, item) in cases.enumerated() {
      let role = item.args[0] as? String
      let allowed = item.args[1] as? [String] ?? []
      let expected = item.result as? [String: Any] ?? [:]
      let gate = resolveStaffRoleGate(role, allowed)
      XCTAssertEqual(gate.ready, expected["ready"] as? Bool, "case \(index)")
      XCTAssertEqual(gate.admitted, expected["admitted"] as? Bool, "case \(index)")
      XCTAssertEqual(gate.blocked, expected["blocked"] as? Bool, "case \(index)")
      XCTAssertEqual(gate.reason, expected["reason"] as? String, "case \(index)")
    }
  }
}
