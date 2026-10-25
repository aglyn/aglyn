// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynWebView

/// The console web view opens the system browser only for a link a person clicked (AGL-4002): the console's
/// once-a-day editor-hint bounce had opened the person's browser beside the in-app Besigner.
@MainActor
final class ConsoleNavigationPolicyTests: XCTestCase {
  private let console = ["https://app.aglyn.com"]
  private let besignerOnly: @MainActor (String) -> Bool = { $0.hasPrefix("/auth/besigner") || $0.hasSuffix("/besigner") }

  private func decide(_ url: String, mainFrame: Bool = true, clicked: Bool = false) -> ConsoleNavigationPolicy.Decision {
    ConsoleNavigationPolicy.decide(
      URL(string: url), trustedOrigins: console, mainFrame: mainFrame, linkActivated: clicked, allowsPath: besignerOnly)
  }

  func testTheEditorHintBounceNeverOpensTheBrowser() {
    let bounce = "https://console.aglyn.app/api/edit-hint/set?sig=abc&return=https%3A%2F%2Fapp.aglyn.com%2Fauth%2Fbesigner"
    XCTAssertEqual(decide(bounce), .ignore(URL(string: bounce)!))
  }

  func testAScriptOrRedirectOffTheConsoleIsDropped() {
    XCTAssertEqual(decide("https://accounts.example.com/sso"), .ignore(URL(string: "https://accounts.example.com/sso")!))
    XCTAssertEqual(decide("mailto:help@example.com"), .ignore(URL(string: "mailto:help@example.com")!))
  }

  func testALinkThePersonClickedOffTheConsoleOpensTheSystemBrowser() {
    XCTAssertEqual(decide("https://docs.aglyn.com/besigner", clicked: true), .systemBrowser(URL(string: "https://docs.aglyn.com/besigner")!))
    XCTAssertEqual(decide("mailto:help@example.com", clicked: true), .systemBrowser(URL(string: "mailto:help@example.com")!))
  }

  func testTheBesignerAndItsEntryLoadInTheWebView() {
    XCTAssertEqual(decide("https://app.aglyn.com/auth/besigner?continue=%2Facme%2Fhosts%2Fshop%2Fscreens%2Fs1%2Fversions%2Fv1%2Fbesigner"), .allow)
    XCTAssertEqual(decide("https://app.aglyn.com/acme/hosts/shop/screens/s1/versions/v1/besigner"), .allow)
  }

  func testAnotherConsolePageGoesBackToTheApp() {
    XCTAssertEqual(decide("https://app.aglyn.com/acme/hosts/shop/forms", clicked: true), .handBack("/acme/hosts/shop/forms"))
  }

  func testAFrameInsideThePageLoadsWhatItLikes() {
    XCTAssertEqual(decide("https://shop.aglyn.app/", mainFrame: false), .allow)
    XCTAssertEqual(decide("about:blank"), .allow)
  }

  func testANewWindowKeepsConsolePagesAndSendsTheRestToTheBrowser() {
    XCTAssertEqual(ConsoleNavigationPolicy.decideNewWindow(URL(string: "https://app.aglyn.com/x"), trustedOrigins: console), .allow)
    XCTAssertEqual(
      ConsoleNavigationPolicy.decideNewWindow(URL(string: "https://shop.aglyn.app/"), trustedOrigins: console),
      .systemBrowser(URL(string: "https://shop.aglyn.app/")!))
    XCTAssertEqual(
      ConsoleNavigationPolicy.decideNewWindow(URL(string: "javascript:alert(1)"), trustedOrigins: console),
      .ignore(URL(string: "javascript:alert(1)")!))
  }
}
