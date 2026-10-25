// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// Sidebar groups keep the state the person left them in (AGL-3996): no accordion.
final class SidebarGroupsTests: XCTestCase {
  func testOpeningAPlaceOpensOnlyItsOwnFoldedGroup() {
    var groups = AglynSidebarGroups()
    groups.toggle("site.website")
    groups.toggle("site.sell")
    // Opening Products (in Sell) leaves Website open.
    groups.reveal("site.sell")
    XCTAssertTrue(groups.isOpen("site.website"))
    XCTAssertTrue(groups.isOpen("site.sell"))
    // Opening a place in a folded group opens that group and nothing else.
    groups.reveal("site.customers")
    XCTAssertTrue(groups.isOpen("site.customers"))
    XCTAssertFalse(groups.isOpen("site.more"))
  }

  func testAFoldedGroupStaysFoldedUntilOneOfItsPlacesOpens() {
    var groups = AglynSidebarGroups()
    groups.toggle("site.sell")
    groups.toggle("site.sell")
    XCTAssertFalse(groups.isOpen("site.sell"))
    groups.reveal("site.website")
    XCTAssertFalse(groups.isOpen("site.sell"))
  }

  func testStarredIsOpenAtRestAndStaysFoldedOnceFolded() {
    var groups = AglynSidebarGroups()
    XCTAssertTrue(groups.isOpen("site.starred", openAtRest: true))
    groups.toggle("site.starred", openAtRest: true)
    XCTAssertFalse(groups.isOpen("site.starred", openAtRest: true))
    groups.toggle("site.more")
    XCTAssertTrue(groups.isOpen("site.more"))
  }

  func testTheStoredFormReadsBackAndKeepsAnEarlierFoldedStarred() {
    var groups = AglynSidebarGroups()
    groups.set("site.sell", open: true)
    groups.set("workspace.more", open: false)
    XCTAssertEqual(AglynSidebarGroups(stored: groups.stored), groups)
    let earlier = AglynSidebarGroups(stored: ["site.starred.folded", "site.website"])
    XCTAssertFalse(earlier.isOpen("site.starred", openAtRest: true))
    XCTAssertTrue(earlier.isOpen("site.website"))
  }
}
