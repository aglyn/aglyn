// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynScreens
import XCTest

@testable import AglynMarketingPlugin

/// The staff pages' read-only cards (AGL-3380), drawn from the plugin's spec in the staff zones.
final class StaffScreensTests: XCTestCase {
  func testTheStaffScreensSitInTheStaffZones() {
    let specs = Dictionary(uniqueKeysWithValues: marketingScreenSpecs().map { ($0.id, $0) })
    XCTAssertEqual(specs["marketing.staffOrgEmail"]?.zones, ["staffOrg"])
    XCTAssertEqual(specs["marketing.staffOrgEmailSend"]?.zones, [])
  }
}
