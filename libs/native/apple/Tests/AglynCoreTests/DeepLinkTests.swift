// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

private struct Route: DeepLinkRoute {
  let path: String
  let screen: String
}

final class DeepLinkTests: XCTestCase {
  private let routes = [Route(path: "/redirects", screen: "r.list"), Route(path: "/redirects/:id", screen: "r.detail")]

  func testOpensASitePageNativelyWithTheScopeAsParams() {
    XCTAssertEqual(
      DeepLinks.resolve("https://app.aglyn.com/acme/hosts/shop/redirects/r%201?tab=x", routes: routes),
      .screen("r.detail", ["tab": "x", "orgSlug": "acme", "hostSlug": "shop", "id": "r 1"]))
    XCTAssertEqual(
      DeepLinks.resolve("aglyn://acme/hosts/shop/redirects", routes: routes),
      .screen("r.list", ["orgSlug": "acme", "hostSlug": "shop"]))
    XCTAssertEqual(
      DeepLinks.resolve("https://app.aglyn.com/acme/hosts/shop/redirects", routes: routes),
      .screen("r.list", ["orgSlug": "acme", "hostSlug": "shop"]))
  }

  func testOpensEveryOtherConsolePathInTheWebViewAndRefusesWhatIsNotAConsoleLink() {
    XCTAssertEqual(DeepLinks.resolve("/acme/hosts/shop/besigner", routes: routes), .besigner("/acme/hosts/shop/besigner"))
    XCTAssertEqual(
      DeepLinks.resolve("/acme/hosts/shop/screens/s1/versions/v1/besigner?x=1", routes: routes),
      .besigner("/acme/hosts/shop/screens/s1/versions/v1/besigner?x=1"))
    // A console page with no native screen is a gap, never a web page.
    XCTAssertEqual(DeepLinks.resolve("/acme/hosts/shop/media", routes: routes), .unavailable("/acme/hosts/shop/media"))
    XCTAssertNil(DeepLinks.resolve("//evil.example/x", routes: routes))
    XCTAssertNil(DeepLinks.resolve("javascript:alert(1)", routes: routes))
    XCTAssertNil(DeepLinks.consolePath(of: ""))
  }

  func testTreatsTheConsoleTopLevelSectionsAsUnscoped() {
    XCTAssertEqual(DeepLinks.splitConsoleScope("/billing/plans"), .init(rest: "/billing/plans"))
    XCTAssertEqual(DeepLinks.splitConsoleScope("/acme/crm"), .init(orgSlug: "acme", rest: "/crm"))
  }

  func testAMalformedEscapeDoesNotMatch() {
    XCTAssertNil(DeepLinks.matchPathPattern("/redirects/:id", "/redirects/%E0%A4%A"))
  }

  func testAQueryParamNeverOverridesAPathParam() {
    XCTAssertEqual(
      DeepLinks.resolve("/acme/hosts/shop/redirects/a?id=b&orgSlug=z", routes: routes),
      .screen("r.detail", ["id": "a", "orgSlug": "acme", "hostSlug": "shop"]))
  }

  func testOnlyBesignerPathsAreBesigner() {
    XCTAssertTrue(DeepLinks.isBesignerPath("/acme/hosts/shop/layouts/l1/versions/v2/besigner"))
    XCTAssertTrue(DeepLinks.isBesignerPath("/admin/emails/welcome/versions/v1/besigner?tab=2"))
    XCTAssertFalse(DeepLinks.isBesignerPath("/acme/hosts/shop/besigner-help"))
    XCTAssertFalse(DeepLinks.isBesignerPath("/acme/hosts/shop/media"))
    XCTAssertFalse(DeepLinks.isBesignerPath("/besigner/../media"))
    XCTAssertFalse(DeepLinks.isBesignerPath("//evil.example/besigner"))
    XCTAssertFalse(DeepLinks.isBesignerPath("besigner"))
  }
}
