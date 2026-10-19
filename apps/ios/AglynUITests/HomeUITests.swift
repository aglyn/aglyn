// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// Launches "Aglyn" against the seeded emulator stack, reaches Home inside the seeded site, and finds an area through
/// the one box. Needs Config/Local.xcconfig's debug sign-in and a seeded stack.
final class HomeUITests: XCTestCase {
  func testSignsInAndFindsAnAreaThroughTheOneBox() throws {
    let app = XCUIApplication()
    app.launchArguments += ["-AglynAutoSignIn", "YES", "-AglynNoPushPrompt", "YES"]
    app.launch()
    XCTAssertTrue(
      app.descendants(matching: .any)["home-site-line"].waitForExistence(timeout: 30)
        || app.descendants(matching: .any)["home-workspace-line"].waitForExistence(timeout: 5),
      "Home never appeared")
    let search = app.buttons["titlebar-search"].exists ? app.buttons["titlebar-search"] : app.buttons["topbar-search"]
    XCTAssertTrue(search.waitForExistence(timeout: 10), "The search button is not there")
    search.tap()
    let field = app.textFields["onebox-field"]
    XCTAssertTrue(field.waitForExistence(timeout: 10), "The one box did not open")
    field.typeText("redirects")
    let row = app.buttons["onebox-screen:site.redirects"]
    XCTAssertTrue(row.waitForExistence(timeout: 10), "Redirects is not in the box's screens")
    row.tap()
    XCTAssertTrue(app.staticTexts["/fall"].waitForExistence(timeout: 15))
  }
}
