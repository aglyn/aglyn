// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynUI

/// Plain web pages open in the in-app browser screen; a provider's sign-in step keeps the secure browser, and mail,
/// phone and app links go to the system (AGL-3893, AGL-3935).
final class BrowserScreenTests: XCTestCase {
  private func url(_ string: String) throws -> URL { try XCTUnwrap(URL(string: string)) }

  func testOnlyWebPagesOpenInTheBrowserScreen() throws {
    XCTAssertEqual(AglynWebPage.destination(try url("https://juniper-street.aglyn.app/")), .inApp)
    XCTAssertEqual(AglynWebPage.destination(try url("HTTP://example.test/preview")), .inApp)
    XCTAssertEqual(AglynWebPage.destination(try url("https://docs.aglyn.com/whats-new")), .inApp)
    XCTAssertEqual(AglynWebPage.destination(try url("https://aglyn.com/legal/terms")), .inApp)
    XCTAssertEqual(AglynWebPage.destination(try url("http://localhost:4380/acme/preview")), .inApp)
    XCTAssertEqual(AglynWebPage.destination(try url("mailto:dana@example.test")), .system)
    XCTAssertEqual(AglynWebPage.destination(try url("tel:+15555550100")), .system)
    XCTAssertEqual(AglynWebPage.destination(try url("aglyn://orders")), .system)
    XCTAssertEqual(AglynWebPage.destination(try url("https://")), .system)
  }

  func testAProvidersSignInOrAccountStepKeepsTheSecureBrowser() throws {
    XCTAssertEqual(AglynWebPage.destination(try url("https://accounts.google.com/o/oauth2/v2/auth?client_id=x")), .secure)
    XCTAssertEqual(AglynWebPage.destination(try url("https://connect.stripe.com/setup/s/abc")), .secure)
    XCTAssertEqual(AglynWebPage.destination(try url("https://STRIPE.com/")), .secure)
    // A look-alike host is just a web page.
    XCTAssertEqual(AglynWebPage.destination(try url("https://notstripe.com/")), .inApp)
  }

  func testThePageItsLinksKeepAreEveryWebPage() throws {
    XCTAssertTrue(AglynWebPage.isWebPage(try url("https://accounts.google.com/")))
    XCTAssertFalse(AglynWebPage.isWebPage(try url("mailto:dana@example.test")))
  }

  func testTheAddressIsTheHostAndPathWithoutTheScheme() throws {
    XCTAssertEqual(AglynWebPage.address(try url("https://juniper-street.aglyn.app/")), "juniper-street.aglyn.app")
    XCTAssertEqual(AglynWebPage.address(try url("https://www.example.com/menu/?x=1#top")), "example.com/menu")
    XCTAssertEqual(AglynWebPage.address(try url("http://localhost:4380/acme/preview")), "localhost:4380/acme/preview")
    XCTAssertEqual(AglynWebPage.address(try url("https://docs.aglyn.com/whats-new")), "docs.aglyn.com/whats-new")
  }

  func testTheTitleIsThePagesOwnOrItsHostUntilItHasOne() throws {
    let page = try url("https://www.juniper-street.aglyn.app/menu")
    XCTAssertEqual(AglynWebPage.title("  Juniper Street — Menu \n", url: page), "Juniper Street — Menu")
    XCTAssertEqual(AglynWebPage.title("", url: page), "juniper-street.aglyn.app")
    XCTAssertEqual(AglynWebPage.title("   ", url: page), "juniper-street.aglyn.app")
  }

  func testAPlainClickPushesThePage() {
    // Outside a ⌘-click there is no event asking for a tab.
    MainActor.assumeIsolated { XCTAssertEqual(AglynBrowserDisposition.current, .push) }
  }
}
