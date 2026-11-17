// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// Replays the console's own answers for where a site is live (`siteLiveUrlForSlug`, function-cases.generated.json).
final class SiteLiveURLTests: XCTestCase {
  func testTheLiveURLIsTheConsoles() throws {
    let cases = try functionCases("siteLiveUrlForSlug")
    XCTAssertFalse(cases.isEmpty)
    for item in cases {
      let host = item.args[0] as? [String: Any]
      let answer: String? = host.flatMap { host in
        SiteLiveURL.forSlug(
          subdomain: host["subdomain"] as? String, cname: host["cname"] as? String, slug: item.args[1] as? String ?? "",
          consoleHostname: item.args[2] as? String)
      }
      XCTAssertEqual(answer, item.result as? String, "\(item.args)")
    }
  }

  func testLocalAndPreviewConsolesAreTheConsoles() throws {
    for item in try functionCases("isLocalConsole") {
      XCTAssertEqual(SiteLiveURL.isLocalConsole(item.args[0] as? String ?? ""), item.result as? Bool, "\(item.args)")
    }
    for item in try functionCases("isPreviewConsole") {
      XCTAssertEqual(SiteLiveURL.isPreviewConsole(item.args[0] as? String ?? ""), item.result as? Bool, "\(item.args)")
    }
  }

  /// Visit site from the console the app is configured with: the local stack opens the local tenant, never production.
  func testVisitSiteFollowsTheConfiguredConsole() {
    XCTAssertEqual(
      SiteLiveURL.home(subdomain: "juniper-street", cname: "juniperbakery.example", consoleOrigin: "http://localhost:4610")?
        .absoluteString,
      "http://localhost:4500/?tenantHost=juniper-street")
    XCTAssertEqual(
      SiteLiveURL.home(subdomain: "juniper-street", cname: nil, consoleOrigin: "http://10.0.2.2:4610/")?.absoluteString,
      "http://localhost:4500/?tenantHost=juniper-street")
    XCTAssertEqual(
      SiteLiveURL.home(subdomain: "juniper-street", cname: nil, consoleOrigin: "https://aglyn-console-git-x-aglyn.vercel.app")?
        .absoluteString,
      "https://aglyn-tenant-git-main-aglyn.vercel.app/?tenantHost=juniper-street")
    XCTAssertEqual(
      SiteLiveURL.home(subdomain: "juniper-street", cname: "juniperbakery.example", consoleOrigin: "https://app.aglyn.com")?
        .absoluteString,
      "https://juniperbakery.example/")
    XCTAssertEqual(
      SiteLiveURL.home(subdomain: "juniper-street", cname: nil, consoleOrigin: nil)?.absoluteString,
      "https://juniper-street.aglyn.app/")
    XCTAssertNil(SiteLiveURL.home(subdomain: nil, cname: "only-custom.example", consoleOrigin: "http://localhost:4610"))
    XCTAssertEqual(SiteLiveURL.consoleHostname("http://[::1]:4610"), "::1")
  }
}
