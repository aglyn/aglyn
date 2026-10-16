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

  func testAConsolePageOpensTheAppsOwnScreen() {
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/acme"), .open("/acme"))
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/acme/hosts/shop/media?tab=org"), .open("/acme/hosts/shop/media?tab=org"))
  }

  func testTheSignInWallMeansTheSessionEnded() {
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/signin?continue=%2Facme"), .sessionEnded)
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/verify-email"), .sessionEnded)
    XCTAssertEqual(BesignerEntry.exit(from: editor, to: "/signup-later"), .open("/signup-later"))
  }
}
