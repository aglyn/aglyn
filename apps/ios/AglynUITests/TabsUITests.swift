// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// Each tab keeps its own place (AGL-3945, P9): a list scrolled in one tab is where it was after another tab has been
/// in front. Runs against the seeded emulator stack with Config/Local.xcconfig's debug sign-in, on the Mac and iPad.
final class TabsUITests: XCTestCase {
  func testATabKeepsItsScrollWhileAnotherIsInFront() throws {
    let app = XCUIApplication()
    app.launchArguments += ["-AglynAutoSignIn", "YES", "-AglynNoPushPrompt", "YES", "-AglynAuthTransport", "rest"]
    app.launch()
    let keep = app.buttons["keep-pins-confirm"]
    if keep.waitForExistence(timeout: 20) { keep.tap() }

    // Tab A: the seeded site's orders, scrolled down.
    let picker = app.descendants(matching: .any)["sidebar-site-picker"]
    if !picker.waitForExistence(timeout: 10) {
      app.buttons["titlebar-search"].tap()
      app.typeText("Juniper Street Bakery\n")
    }
    let orders = app.descendants(matching: .any)["sidebar-starred-orders"]
    XCTAssertTrue(orders.waitForExistence(timeout: 20), "The starred Orders row is not in the site's sidebar")
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
    app.descendants(matching: .any)["tab-0"].tap()

    let again = app.descendants(matching: .any)[shownID]
    XCTAssertTrue(again.waitForExistence(timeout: 10) && again.isHittable, "Tab A lost its scroll: \(shownID) is not on screen")
  }
}
