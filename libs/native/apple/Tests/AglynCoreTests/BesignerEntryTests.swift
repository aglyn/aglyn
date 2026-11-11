// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

final class BesignerEntryTests: XCTestCase {
  private let editor = "/acme/hosts/shop/screens/s1/versions/v2/besigner"

  func testOpensTheBesignerThroughTheEntryPage() {
    XCTAssertEqual(
      BesignerEntry.url(origin: "https://app.aglyn.com/", besignerPath: editor)?.absoluteString,
      "https://app.aglyn.com/auth/besigner?continue=%2Facme%2Fhosts%2Fshop%2Fscreens%2Fs1%2Fversions%2Fv2%2Fbesigner")
    XCTAssertEqual(
      BesignerEntry.url(origin: "http://localhost:4200", besignerPath: "/acme/hosts/shop/theme?tab=a&b=1")?.absoluteString,
      "http://localhost:4200/auth/besigner?continue=%2Facme%2Fhosts%2Fshop%2Ftheme%3Ftab%3Da%26b%3D1")
  }

  func testRefusesAnEntryForAnythingButABesignerPage() {
    XCTAssertNil(BesignerEntry.url(origin: "https://app.aglyn.com", besignerPath: "/acme/hosts/shop/redirects"))
    XCTAssertNil(BesignerEntry.url(origin: "https://app.aglyn.com", besignerPath: "https://evil.example/besigner"))
  }

  func testStaysOnTheEntryPageAndOtherBesignerPages() {
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/auth/besigner?continue=%2Fx"), .stay)
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: editor + "?panel=layers"), .stay)
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/acme/hosts/shop/screens/s1/versions/v3/besigner"), .stay)
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/acme/hosts/shop/screens/s1/versions/v2/preview"), .stay)
  }

  func testTheEditorsBackArrowReturnsToTheApp() {
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/acme/hosts/shop/screens/s1/versions/v2/view"), .leave)
    // Another page's view is not the way back.
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/acme/hosts/shop/screens/s9/versions/v2/view"), .stay)
  }

  // AGL-4056: every editor's own back control returns to the screen the Besigner was opened from.
  func testEachEditorsBackControlReturnsToTheApp() {
    // A plugin document's goes to the document.
    XCTAssertEqual(
      BesignerEntry.exit(from: "/acme/hosts/shop/forms/f1/versions/v3/besigner", to: "/acme/hosts/shop/forms/f1"), .leave)
    // A layout's, a component's and a template's go to their lists.
    XCTAssertEqual(
      BesignerEntry.exit(from: "/acme/hosts/shop/layouts/l1/versions/v1/besigner", to: "/acme/hosts/shop/layouts"), .leave)
    XCTAssertEqual(
      BesignerEntry.exit(from: "/acme/hosts/shop/components/c1/versions/v1/besigner", to: "/acme/hosts/shop/components?x=1"),
      .leave)
    XCTAssertEqual(BesignerEntry.exit(from: "/acme/hosts/shop/templates/t1/besigner", to: "/acme/hosts/shop/templates"), .leave)
    // The staff console's email designs go to theirs.
    XCTAssertEqual(BesignerEntry.exit(from: "/admin/emails/welcome/versions/v1/besigner", to: "/admin/emails"), .leave)
    // The logo's workspace and site homes are not a way back: they open the app's Home.
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/acme/hosts/shop"), .open("/acme/hosts/shop"))
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/acme/hosts"), .open("/acme/hosts"))
    // Another document's page is not this editor's way back.
    XCTAssertEqual(
      BesignerEntry.exit(from: "/acme/hosts/shop/forms/f1/versions/v3/besigner", to: "/acme/hosts/shop/forms/f2"),
      .open("/acme/hosts/shop/forms/f2"))
  }

  func testTheBackScriptPressesTheControlTheConsoleNames() {
    // The console's `NATIVE_BESIGNER_BACK_CONTROL_ID` (libs/aglyn native-besigner-back.ts).
    XCTAssertEqual(BesignerEntry.backControlID, "aglyn-besigner-back")
    XCTAssertTrue(BesignerEntry.backScript.contains("getElementById('aglyn-besigner-back')"))
    XCTAssertTrue(BesignerEntry.backScript.contains(".click()"))
  }

  func testBackAfterASwitchReturnsToTheCurrentDocumentsPlace() {
    let opened = "/acme/hosts/shop/screens/s1/versions/v2/besigner"
    // Still the document it opened (another version included): back to the screen that opened it.
    XCTAssertNil(BesignerEntry.returnPath(opened: opened, current: opened, back: "/acme/hosts/shop/screens/s1/versions/v2/view"))
    XCTAssertNil(
      BesignerEntry.returnPath(
        opened: opened, current: "/acme/hosts/shop/screens/s1/versions/v3/besigner",
        back: "/acme/hosts/shop/screens/s1/versions/v3/view"))
    // Switched to another page: that page's view.
    XCTAssertEqual(
      BesignerEntry.returnPath(
        opened: opened, current: "/acme/hosts/shop/screens/s7/versions/v1/besigner",
        back: "/acme/hosts/shop/screens/s7/versions/v1/view"),
      "/acme/hosts/shop/screens/s7/versions/v1/view")
    // Switched to a layout: its list, as its own back control goes.
    XCTAssertEqual(
      BesignerEntry.returnPath(
        opened: opened, current: "/acme/hosts/shop/layouts/l1/versions/v1/besigner?panel=layers",
        back: "/acme/hosts/shop/layouts"),
      "/acme/hosts/shop/layouts")
  }

  func testAConsolePageOpensTheAppsOwnScreen() {
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/acme"), .open("/acme"))
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/acme/hosts/shop/media?tab=org"), .open("/acme/hosts/shop/media?tab=org"))
  }

  func testTheSignInWallMeansTheSessionEnded() {
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/signin?continue=%2Facme"), .sessionEnded)
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/verify-email"), .sessionEnded)
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/signup-later"), .open("/signup-later"))
  }

  // The console's apps/console and libs/aglyn `native-app-web-view` read exactly this shape (AGL-3894).
  func testTheUserAgentMarkerNamesTheAppItsVersionAndPlatform() {
    XCTAssertEqual(BesignerEntry.userAgentMarker(version: "1.4.0", platform: "ios"), "AglynApp/1.4.0 (ios)")
    XCTAssertEqual(BesignerEntry.userAgentMarker(version: "", platform: "macos"), "AglynApp/0 (macos)")
    XCTAssertEqual(BesignerEntry.userAgentMarker(version: "1.4 beta", platform: "ios"), "AglynApp/1.4beta (ios)")
  }

  func testTheMarkerFollowsWebKitsOwnApplicationName() {
    // iOS: WebKit's `Mobile/<build>` stays, so pages still read the view as a phone.
    XCTAssertEqual(
      BesignerEntry.applicationNameForUserAgent(base: "Mobile/15E148", version: "1.4.0", platform: "ios"),
      "Mobile/15E148 AglynApp/1.4.0 (ios)")
    // macOS: WebKit has none.
    XCTAssertEqual(
      BesignerEntry.applicationNameForUserAgent(base: nil, version: "1.4.0", platform: "macos"),
      "AglynApp/1.4.0 (macos)")
    // A configuration that already carries it is not marked twice.
    XCTAssertEqual(
      BesignerEntry.applicationNameForUserAgent(base: "Mobile/15E148 AglynApp/1.4.0 (ios)", version: "1.5.0", platform: "ios"),
      "Mobile/15E148 AglynApp/1.4.0 (ios)")
  }
}
