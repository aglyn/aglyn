// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

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
}
