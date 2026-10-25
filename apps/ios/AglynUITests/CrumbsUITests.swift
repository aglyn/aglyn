// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// Every crumb but the last opens its level (AGL-4058): "Juniper Street Bakery › Website › Media" leads to the site's
/// Home and to Website's first row, and "Site settings › Setup › Business profile" to the settings root and to Setup's
/// first row. Runs against the seeded emulator stack with Config/Local.xcconfig's debug sign-in, on the Mac and iPad.
final class CrumbsUITests: XCTestCase {
  private var app: XCUIApplication!
  private var any: XCUIElementQuery { app.descendants(matching: .any) }

  override func setUp() {
    continueAfterFailure = false
    app = XCUIApplication()
    app.launchArguments += ["-AglynAutoSignIn", "YES", "-AglynNoPushPrompt", "YES", "-AglynAuthTransport", "rest"]
    #if os(macOS)
      app.launchArguments += ["-ApplePersistenceIgnoreState", "YES"]
    #endif
    app.launch()
    app.activate()
    let keep = app.buttons["keep-pins-confirm"].firstMatch
    if keep.waitForExistence(timeout: 20) { keep.tap() }
    // The seeded workspace's site, the way a person opens it: Sites, then the site.
    tap("rail-org-mobile-demo-org", timeout: 20)
    tap("sidebar-sites")
    tap("site-mobile-demo-site", timeout: 20)
  }

  private func tap(_ id: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
    let element = any[id].firstMatch
    XCTAssertTrue(element.waitForExistence(timeout: timeout), "No \(id)", file: file, line: line)
    element.tap()
  }

  private func crumbs() -> XCUIElement { any["breadcrumbs"].firstMatch }

  private func open(_ row: String, in group: String) {
    if !any["sidebar-\(row)"].firstMatch.waitForExistence(timeout: 5) { tap("sidebar-group-\(group)") }
    tap("sidebar-\(row)")
  }

  func testAnEverydayPlaceLinksTheSiteHomeAndItsGroup() {
    open("media", in: "website")
    XCTAssertTrue(crumbs().waitForExistence(timeout: 10))
    XCTAssertTrue(crumbs().staticTexts["Media"].exists, "Media is the place in use")

    // The group opens its first row.
    tap("crumb-1")
    XCTAssertTrue(crumbs().staticTexts["Pages"].waitForExistence(timeout: 10), "Website › opened Pages")

    // The scope opens its Home.
    open("media", in: "website")
    tap("crumb-0")
    XCTAssertTrue(app.staticTexts["Needs you"].waitForExistence(timeout: 10), "the site's name opened its Home")
  }

  func testASettingsPlaceLinksTheSettingsRootAndItsSection() {
    tap("sidebar-siteSettings")
    open("business", in: "setup")
    XCTAssertTrue(crumbs().waitForExistence(timeout: 10))
    XCTAssertTrue(crumbs().staticTexts["Business profile"].exists)

    tap("crumb-1")
    XCTAssertTrue(crumbs().staticTexts["Basic details"].waitForExistence(timeout: 10), "Setup › opened Basic details")

    open("business", in: "setup")
    tap("crumb-0")
    XCTAssertTrue(crumbs().staticTexts["Users"].waitForExistence(timeout: 10), "Site settings › opened its first row, Users")
  }
}
