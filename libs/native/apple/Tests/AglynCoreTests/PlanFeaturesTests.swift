// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// Replays libs/native/contracts/derived-values.generated.json: the console's own
/// `checkEntitlement` answers for workspaces with overrides, comps and dead subscriptions.
final class PlanFeaturesTests: XCTestCase {
  func testPlanFeaturesAreTheConsoles() throws {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/derived-values.generated.json")
    let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let cases = try XCTUnwrap(root["cases"] as? [[String: Any]])
    XCTAssertFalse(cases.isEmpty)
    for (index, item) in cases.enumerated() {
      let org = item["org"] as? [String: Any]
      let feature = item["feature"] as! String
      XCTAssertEqual(planFeatureCarried(org, feature), item["result"] as? Bool, "case \(index): \(feature) \(org ?? [:])")
    }
  }

  func testReleaseFlagsAreTheConsoles() throws {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/derived-values.generated.json")
    let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let cases = try XCTUnwrap(root["flagCases"] as? [[String: Any]])
    XCTAssertFalse(cases.isEmpty)
    for (index, item) in cases.enumerated() {
      let raw = item["value"] as! [String: Any]
      let value = ReleaseFlagValue(
        enabled: raw["enabled"] as? Bool ?? false, rolloutPercent: (raw["rolloutPercent"] as? NSNumber)?.intValue ?? 0,
        plans: raw["plans"] as? [String] ?? [])
      let got = isReleaseFlagOn(
        item["flag"] as! String, value: value, orgID: item["orgId"] as? String, plan: item["plan"] as? String,
        overrides: item["overrides"] as? [String: Any])
      XCTAssertEqual(got, item["result"] as? Bool, "case \(index)")
    }
  }
}
