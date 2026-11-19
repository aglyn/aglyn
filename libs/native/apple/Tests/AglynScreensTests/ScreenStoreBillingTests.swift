// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore
@testable import AglynScreens

/// `app.billing` and `app.billingLink`: what a spec screen hides in a store build (the owner's decision of 2026-11-19).
/// Kotlin replays the same (ScreenStoreBillingTest).
@MainActor
final class ScreenStoreBillingTests: XCTestCase {
  override func tearDown() async throws {
    StoreBilling.set(buying: false, webBillingLink: false)
    try await super.tearDown()
  }

  private func app() -> JSONValue? { ScreenSession().context(nil, params: [:])["app"] }

  func testTheContextCarriesTheBuildsAnswers() {
    StoreBilling.set(buying: true, webBillingLink: false)
    XCTAssertEqual(app()?["billing"], true)
    XCTAssertEqual(app()?["billingLink"], false)
    StoreBilling.set(buying: false, webBillingLink: true)
    XCTAssertEqual(app()?["billing"], false)
    XCTAssertEqual(app()?["billingLink"], true)
  }

  func testABuyingConditionHoldsOnlyWhereTheBuildMayBuy() {
    let condition = "app.billing && org.can[billing.manage]"
    var context = ScreenSession(orgPermissions: ["billing.manage": true]).context(nil, params: [:])
    XCTAssertFalse(ScreenValues.condition(condition, in: context))  // unconfigured: a store build
    StoreBilling.set(buying: true, webBillingLink: false)
    context = ScreenSession(orgPermissions: ["billing.manage": true]).context(nil, params: [:])
    XCTAssertTrue(ScreenValues.condition(condition, in: context))
  }

  /// Every control in Billing that takes or starts a payment to Aglyn holds `app.billing`, on itself or its block.
  func testEveryBuyingControlInBillingNeedsTheBuild() throws {
    let buying: [String: Set<String>] = [
      "core.billing": ["portal", "card", "resume", "plans"],
      "core.billing.plans": ["switch", "monthly", "yearly"],
      "core.billing.invoices": ["pay"],
      "core.billing.settings": ["default", "addCard"],
      "core.billing.addons": ["set", "on", "blocks"],
      "core.billing.cancel.offers": ["downsell"],
    ]
    func needsTheBuild(_ when: String?) -> Bool {
      guard let when else { return false }
      return when.contains("app.billing") && !when.hasPrefix("!app.billing") && !when.contains("&& !app.billing")
    }
    for (id, ids) in buying {
      let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == id }, id)
      var found: Set<String> = []
      for block in spec.blocks {
        for key in ["items", "actions"] {
          for action in block[key].array where ids.contains(action["id"]?.stringValue ?? "") {
            if needsTheBuild(block.when) || needsTheBuild(action["when"]?.stringValue) { found.insert(action["id"]?.stringValue ?? "") }
          }
        }
      }
      XCTAssertEqual(found, ids, id)
      XCTAssertLessThanOrEqual(spec.blocks.filter { $0.type == "billingOnWeb" }.count, 1, id)
    }
    // Choose a plan is only buying: a store build cannot reach it by any route.
    XCTAssertEqual(CoreScreens.specs.first { $0.id == "core.billing.plans" }?.requires, "org.can[billing.manage] && app.billing")
  }
}
