// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// Launches "Aglyn" against the seeded emulator stack and reaches Home.
/// Needs Config/Local.xcconfig's debug sign-in and a seeded stack.
final class HomeUITests: XCTestCase {
  func testSignsInAndReachesHome() throws {
    let app = XCUIApplication()
    app.launchArguments += ["-AglynAutoSignIn", "YES"]
    app.launch()
    let quickAction = app.buttons["quick-action-redirects.open"]
    XCTAssertTrue(quickAction.waitForExistence(timeout: 30), "Home's Redirects quick action never appeared")
    quickAction.tap()
    XCTAssertTrue(app.staticTexts["/fall"].waitForExistence(timeout: 15))
  }
}
