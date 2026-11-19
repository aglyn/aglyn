// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynSite

final class StoreBillingGateTests: XCTestCase {
  func testAnUpgradeNoticeKeepsItsButtonOnlyWhereTheBuildMayBuy() {
    var opened = 0
    let debug = planUpgradeAction(buying: true) { opened += 1 }
    XCTAssertNotNil(debug)
    debug?()
    XCTAssertEqual(opened, 1)
    XCTAssertNil(planUpgradeAction(buying: false) { opened += 1 })
  }
}
