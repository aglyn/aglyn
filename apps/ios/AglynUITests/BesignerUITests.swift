// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// Opens a seeded page in the Besigner from the app, signed in, and leaves it
/// again (AGL-3850). Needs Config/Local.xcconfig's debug sign-in, the seeded
/// emulator stack (tools/scripts/seed-native-emulator.mjs), the console on
/// this Mac, and a signed simulator build (`CODE_SIGN_IDENTITY=-`; unsigned,
/// Firebase cannot use the keychain and the sign-in fails). The canvas is web
/// content, whose accessibility tree is too slow to query, so steps inside it
/// tap by position (iPhone 16 points) and wait.
final class BesignerUITests: XCTestCase {
  private let page = "aglyn://juniper-street/hosts/juniper-street/screens/page-about/versions/page-about-v1/besigner"

  private func shot(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func tap(_ app: XCUIApplication, _ x: Double, _ y: Double) {
    app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y)).tap()
  }

  private func openBesigner(_ app: XCUIApplication) {
    app.launchArguments += ["-AglynAutoSignIn", "YES"]
    app.launch()
    #if os(iOS)
      // The push permission prompt the first launch raises.
      let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
      let dontAllow = springboard.buttons["Don’t Allow"]
      if dontAllow.waitForExistence(timeout: 20) { dontAllow.tap() }
    #endif
    XCTAssertTrue(app.descendants(matching: .any)["home-site-line"].waitForExistence(timeout: 60), "Home never appeared")
    shot("0-home")
    app.open(URL(string: page)!)
    #if os(iOS)
      let open = springboard.buttons["Open"]
      if open.waitForExistence(timeout: 5) { open.tap() }
    #endif
    XCTAssertTrue(app.buttons["besigner-done"].waitForExistence(timeout: 30), "The Besigner screen never appeared")
    // The editor loads in the web view; its canvas is slow to query, so wait and look.
    sleep(90)
    shot("1-besigner-open")
  }

  func testDoneReturnsToTheApp() throws {
    let app = XCUIApplication()
    openBesigner(app)
    app.buttons["besigner-done"].tap()
    XCTAssertTrue(app.descendants(matching: .any)["home-site-line"].waitForExistence(timeout: 30), "Done did not return to Home")
    shot("2-back-home")
  }

  /// Inside the app the Besigner leaves its browser-only chrome out (AGL-3894): no
  /// back arrow of its own (Done is the way out), no web "Enable notifications"
  /// prompt, and the screen names itself instead of wearing the page's title,
  /// which carried an unread count and the brand into the Mac window title.
  func testTheBesignerShowsNoBrowserChromeInTheApp() throws {
    let app = XCUIApplication()
    openBesigner(app)
    let web = app.webViews.firstMatch
    XCTAssertTrue(web.exists, "The Besigner web view is not there")
    // The control that proves the editor itself loaded: its save button, under whichever state it is in.
    let save = web.buttons.matching(NSPredicate(format: "label IN %@", ["Save draft", "Publish", "Up to date", "Save"]))
    XCTAssertTrue(save.firstMatch.waitForExistence(timeout: 60), "The editor never loaded")
    XCTAssertFalse(web.links["back"].exists || web.buttons["back"].exists, "The web back arrow is drawn in the app")
    XCTAssertFalse(web.staticTexts["Enable notifications"].exists, "The web notifications prompt shows in the app")
    #if os(macOS)
      XCTAssertEqual(app.windows.firstMatch.title, "Besigner")
    #else
      XCTAssertTrue(app.navigationBars["Besigner"].exists, "The screen is not titled Besigner")
    #endif
    shot("2-no-browser-chrome")
  }
}
