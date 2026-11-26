// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// "Create your first site" (`createFirstSiteWorkspace`): the workspace is named for the account, and a name whose address
/// is taken tries once more under a suffixed one.
final class FirstSiteWorkspaceTests: XCTestCase {
  func testTheWorkspaceIsNamedForTheAccount() {
    XCTAssertEqual(FirstSiteWorkspace.name(displayName: " Hannah Reyes ", email: "h@example.test"), "Hannah Reyes")
    XCTAssertEqual(FirstSiteWorkspace.name(displayName: "  ", email: "hannah@example.test"), "hannah")
    XCTAssertEqual(FirstSiteWorkspace.name(displayName: nil, email: nil), "workspace")
    XCTAssertEqual(FirstSiteWorkspace.name(displayName: String(repeating: "a", count: 90), email: nil).count, 80)
  }

  func testATakenAddressGetsAShortSuffix() {
    XCTAssertEqual(FirstSiteWorkspace.fallbackSlug("Hannah Reyes") { 0 }, "hannah-reyes-0000")
    XCTAssertEqual(FirstSiteWorkspace.fallbackSlug("!!") { 0.9999999 }, "workspace-zzzz")
  }
}
