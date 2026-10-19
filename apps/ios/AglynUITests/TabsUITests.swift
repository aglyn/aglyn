// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// Each tab keeps its own place (AGL-3945, P9): a list scrolled in one tab is where it was after another tab has been
/// in front. Runs against the seeded emulator stack with Config/Local.xcconfig's debug sign-in, on the Mac and iPad.
final class TabsUITests: XCTestCase {
  func testATabKeepsItsScrollWhileAnotherIsInFront() throws {
    let app = XCUIApplication()
    app.launchArguments += ["-AglynAutoSignIn", "YES", "-AglynNoPushPrompt", "YES", "-AglynAuthTransport", "rest"]
    #if os(macOS)
      // One window: a Mac otherwise restores every window the last run left open, each with its own title bar.
      app.launchArguments += ["-ApplePersistenceIgnoreState", "YES"]
    #endif
    app.launch()
    // A Mac restores every window it had open, and each asks once; keeping the pins in one answers them all.
    let keep = app.buttons["keep-pins-confirm"].firstMatch
    if keep.waitForExistence(timeout: 20) { keep.tap() }

    // Tab A: the seeded site's orders, scrolled down. The app opens in whichever workspace it last used, so go to the
    // seeded one and open its site the way a person does: Sites, then the site (it drills the sidebar in, P4).
    let any = app.descendants(matching: .any)
    let workspace = any["rail-org-mobile-demo-org"]
    XCTAssertTrue(workspace.waitForExistence(timeout: 20), "The seeded workspace is not on the rail")
    workspace.tap()
    let sites = any["sidebar-sites"]
    XCTAssertTrue(sites.waitForExistence(timeout: 10), "No Sites row in the workspace's sidebar")
    sites.tap()
    let site = any["site-mobile-demo-site"]
    XCTAssertTrue(site.waitForExistence(timeout: 20), "The seeded site is not in Sites")
    site.tap()
    let orders = any["sidebar-orders"]
    // Only the group holding the place in use is open at rest; Sell holds Orders.
    if !orders.waitForExistence(timeout: 8) { any["sidebar-group-sell"].tap() }
    XCTAssertTrue(orders.waitForExistence(timeout: 20), "No Orders row in the site's sidebar")
    orders.tap()
    let list = app.descendants(matching: .any)["orders-list"].firstMatch
    XCTAssertTrue(list.waitForExistence(timeout: 20), "The orders list did not load")
    #if os(macOS)
      list.scroll(byDeltaX: 0, deltaY: -600)
    #else
      list.swipeUp()
    #endif
    let rows = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'order-o-'"))
    let firstShown = rows.allElementsBoundByIndex.first { $0.isHittable }
    let shownID = try XCTUnwrap(firstShown?.identifier, "No order row is on screen after scrolling")

    // Tab B in front, then back to A.
    let newTab = app.descendants(matching: .any)["tab-new"]
    XCTAssertTrue(newTab.waitForExistence(timeout: 5))
    newTab.tap()
    XCTAssertTrue(app.descendants(matching: .any)["tab-1"].waitForExistence(timeout: 5), "No second tab opened")
    // Tab B goes to another workspace; tab A must not follow it, nor reload when it is in front again.
    let other = app.descendants(matching: .any)["rail-org-nav-aglyn-llc"]
    if other.waitForExistence(timeout: 5) { other.tap() }
    sleep(3)
    app.descendants(matching: .any)["tab-0"].tap()

    let again = app.descendants(matching: .any)[shownID]
    XCTAssertTrue(again.waitForExistence(timeout: 10) && again.isHittable, "Tab A lost its scroll: \(shownID) is not on screen")
  }
}
