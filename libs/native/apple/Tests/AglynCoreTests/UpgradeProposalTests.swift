// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// Replays derived-values.generated.json's `proposalCases`: the console's `standingUpgradeProposal` and
/// `upgradeProposalSummary` answers for stored proposals (add-ons, aliases, tiers, cadence, codes, live subscriptions).
final class UpgradeProposalTests: XCTestCase {
  func testTheProposedPlanReadsAsTheConsoleReadsIt() throws {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/derived-values.generated.json")
    let root = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let cases = try XCTUnwrap(root["proposalCases"] as? [[String: Any]])
    XCTAssertFalse(cases.isEmpty)
    for (index, item) in cases.enumerated() {
      let org = item["org"] as? [String: Any]
      let standing = UpgradeProposal.standing(org)
      XCTAssertEqual(standing?.plan, item["plan"] as? String, "case \(index): \(org ?? [:])")
      XCTAssertEqual(standing?.summary, item["summary"] as? String, "case \(index): \(org ?? [:])")
      XCTAssertEqual(standing?.bundled ?? false, item["bundled"] as? Bool, "case \(index): \(org ?? [:])")
    }
  }

  func testTheCardsWords() {
    let proposal = UpgradeProposal.standing(["upgradeProposal": ["plan": "pro", "interval": "year"]])
    XCTAssertEqual(proposal?.headline(orgName: "Acme Builders", productName: "Aglyn"), "Acme Builders's Aglyn team proposed the Pro plan")
    XCTAssertEqual(proposal?.headline(orgName: nil, productName: "Aglyn"), "Your Aglyn team proposed the Pro plan")
    XCTAssertTrue(proposal?.body.contains("whole bundle is") == true)
    XCTAssertEqual(proposal?.destination(orgSlug: "acme"), "/acme/billing?plan=pro&interval=year")
  }
}
