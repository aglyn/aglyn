// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynScreens
import XCTest

@testable import AglynWorkflowsPlugin

/// The staff pages' read-only cards (AGL-3379), drawn from the plugin's spec in the staff zones.
final class StaffScreensTests: XCTestCase {
  func testTheStaffScreensSitInTheStaffZones() {
    let specs = Dictionary(uniqueKeysWithValues: workflowsScreenSpecs().map { ($0.id, $0) })
    XCTAssertEqual(specs["workflows.staffSiteAutomations"]?.zones, ["staffSite"])
    XCTAssertEqual(specs["workflows.staffOrgAutomations"]?.zones, ["staffOrg"])
    XCTAssertEqual(specs["workflows.staffAutomation"]?.zones, [])
  }
}
