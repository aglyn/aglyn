// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore
@testable import AglynScreens

/// `app.billing` and `app.billingLink`: what a spec screen hides in a store build (the owner's decision of 2026-11-19).
/// Kotlin replays the same (ScreenStoreBillingTest).
final class ScreenStoreBillingTests: XCTestCase {
  override func tearDown() {
    StoreBilling.set(buying: false, webBillingLink: false)
    super.tearDown()
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
}
