// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the seller panel's cases in libs/native/contracts/function-cases.generated.json: the TypeScript's own answers.
final class SellerRulesTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // AglynContractsTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // apple
      .deletingLastPathComponent()  // native
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let entry = Self.functions[name] as! [String: Any]
    let list = entry["cases"] as! [[String: Any]]
    XCTAssertFalse(list.isEmpty, name)
    return list.map { (args: $0["args"] as! [Any], result: $0["result"] as Any) }
  }

  func testTheLedgerAddsUpAsTheConsoleAddsItUp() {
    for item in cases("summarizeSellerLedger") {
      let sales = (item.args[0] as? [Any])?.map { $0 as! [String: Any] }
      let totals = summarizeSellerLedger(sales)
      let expected = item.result as! [String: Any]
      func number(_ key: String) -> Double { (expected[key] as! NSNumber).doubleValue }
      XCTAssertEqual(
        [
          number("paidCount"), number("refundedCount"), number("sentToStripeCents"), number("buyersPaidCents"), number("salesTaxCents"),
          number("platformFeeCents"), number("returnedCents"),
        ],
        [
          Double(totals.paidCount), Double(totals.refundedCount), totals.sentToStripeCents, totals.buyersPaidCents, totals.salesTaxCents,
          totals.platformFeeCents, totals.returnedCents,
        ], "\(item.args)")
    }
  }

  func testPayoutsAreReadyBlockedUnverifiedOrUnknownAsTheConsoleSaysSo() {
    let all = cases("payoutReadiness")
    XCTAssertEqual(all.count, 144)
    for item in all {
      let input = item.args[0] as! [String: Any]
      let readiness = payoutReadiness(
        state: input["state"] as! String, chargesEnabled: input["chargesEnabled"], payoutsEnabled: input["payoutsEnabled"],
        accountLivemode: input["accountLivemode"])
      XCTAssertEqual(readiness.rawValue, item.result as? String, "\(item.args)")
    }
  }

  func testAHandleIsThreeToThirtyLowercaseLettersDigitsAndHyphens() {
    for good in ["abc", "studio-9", String(repeating: "a", count: 30), "9lives"] { XCTAssertTrue(isPublisherHandle(good), good) }
    for bad in ["ab", String(repeating: "a", count: 31), "-abc", "Studio", "has space", "under_score", ""] { XCTAssertFalse(isPublisherHandle(bad), bad) }
  }
}
