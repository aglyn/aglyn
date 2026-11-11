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
    XCTAssertEqual(DeepLinks.resolve("/acme/hosts/shop/besigner", routes: routes), .unavailable("/acme/hosts/shop/besigner"))
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
    // The same answers the Kotlin kit's BesignerPaths gives.
    for path in [
      "/acme/hosts/shop/theme",
      "/acme/hosts/shop/templates/t1/preview",
      "/acme/hosts/shop/emails/welcome/versions/v1/besigner",
      "/acme/hosts/shop/screens/s1/versions/v1",
      "/acme/hosts/shop/screens/s1/versions/v1/besigner?tab=2#x",
      "/acme/hosts/shop/layouts/l1/versions/v2/besigner",
      "/admin/emails/welcome/versions/v1/besigner",
      "/admin/sites/h1/preview/screens/s1",
    ] {
      XCTAssertTrue(DeepLinks.isBesignerPath(path), path)
    }
    for path in [
      "/acme/hosts/shop/besigner", "/acme/hosts/shop/media", "/acme/hosts/shop/products/orders",
      "/acme/screens/s1/versions/v1/besigner", "/acme/hosts/shop/screens/../media/versions/v/besigner",
      "//evil.example/acme/hosts/shop/theme", "besigner", "",
    ] {
      XCTAssertFalse(DeepLinks.isBesignerPath(path), path)
    }
  }

  /// The console's `normalizeNotificationLink` cases: host notifications are stored as `/{hostDocId}/…`.
  func testANotificationLinkOpensWhereTheConsoleOpensIt() {
    let follow = { (link: String?) in
      DeepLinks.notificationLink(link, orgSlug: "acme", hostID: "h1", hostSubdomain: "shop")
    }
    XCTAssertEqual(follow("/h1/products/orders?order=o1"), "/acme/hosts/shop/products/orders?order=o1")
    XCTAssertEqual(follow("/h1/bookings"), "/acme/hosts/shop/bookings")
    XCTAssertEqual(follow("/h1?tab=2"), "/acme/hosts/shop?tab=2")
    XCTAssertEqual(follow("/h1"), "/acme/hosts/shop")
    XCTAssertEqual(follow("/h10/bookings"), "/h10/bookings")
    XCTAssertEqual(follow("/org/billing"), "/acme/billing")
    XCTAssertEqual(follow("/hosts"), "/acme/hosts")
    XCTAssertEqual(follow("/acme/crm/leads"), "/acme/crm/leads")
    XCTAssertEqual(follow("https://example.com/x"), "https://example.com/x")
    XCTAssertNil(follow(nil))
    XCTAssertEqual(DeepLinks.notificationLink("/h1/bookings", orgSlug: "acme", hostID: "h1", hostSubdomain: nil), "/h1/bookings")
  }

  /// An AI job notice that built nothing of its own opens the job (AGL-3911): `/{hostId}?aiJob={jobId}` and its
  /// followed form both read as a root with a query; a deeper path or a bare root does not.
  func testARootLinkWithAQueryReadsItsQuery() {
    XCTAssertEqual(DeepLinks.rootQuery("/h1?aiJob=j%201")?["aiJob"], "j 1")
    XCTAssertEqual(DeepLinks.rootQuery("/acme/hosts/shop?aiJob=j1#top")?["aiJob"], "j1")
    XCTAssertEqual(DeepLinks.rootQuery("https://app.aglyn.com/acme?aiJob=j1")?["aiJob"], "j1")
    XCTAssertNil(DeepLinks.rootQuery("/acme/hosts/shop/bookings?aiJob=j1"))
    XCTAssertNil(DeepLinks.rootQuery("/acme/hosts/shop"))
    XCTAssertNil(DeepLinks.rootQuery("/admin?aiJob=j1"))
  }

  /// The routes the apps register for the links the server writes, as their registrations name them (commerce,
  /// marketplace, CRM, AI, the site platform and core spec screens), so every stored link shape is run through the
  /// resolver here (AGL-4215). The plugins' own tests run the same links through the real registrations.
  private let consoleRoutes: [Route] = [
    Route(path: "/products/orders", screen: "commerce.orders"),
    Route(path: "/products", screen: "commerce.products"),
    Route(path: "/products/orders?order=:orderId", screen: "commerce.order"),
    Route(path: "/products/orders?quote=:quote", screen: "commerce.quote"),
    Route(path: "/products/returns", screen: "commerce.returns"),
    Route(path: "/products/returns?return=:returnId", screen: "commerce.return"),
    Route(path: "/products/shipping", screen: "commerce.shipping"),
    Route(path: "/products/notifications", screen: "commerce.notifications"),
    Route(path: "/marketplace", screen: "marketplace.browse"),
    Route(path: "/marketplace/browse", screen: "marketplace.browse"),
    Route(path: "/marketplace/installed", screen: "marketplace.installed"),
    Route(path: "/marketplace/licences", screen: "marketplace.licenses"),
    Route(path: "/marketplace/:section(profile|listings|payouts|sales)", screen: "marketplace.sell"),
    Route(path: "/marketplace/:listingId(!upload)", screen: "marketplace.listing"),
    Route(path: "/crm", screen: "crm.contacts"),
    Route(path: "/crm/leads", screen: "crm.leads"),
    Route(path: "/crm/leads/:lead", screen: "crm.lead"),
    Route(path: "/ai-jobs", screen: "ai.jobs"),
    Route(path: "/ai-jobs/:jobId", screen: "ai.job"),
    Route(path: "/hosts", screen: "site.sites"),
    Route(path: "/screens", screen: "site.pages"),
    Route(path: "/screens/list", screen: "site.pages"),
    Route(path: "/screens/:screenId", screen: "site.pages"),
    Route(path: "/screens/:screenId/versions/:versionId/view", screen: "site.pages"),
    Route(path: "/settings/sso", screen: "core.settings.sso"),
    Route(path: "/admin/orgs", screen: "core.staff.orgs"),
    Route(path: "/admin/orgs/:orgId", screen: "core.staff.org"),
  ]

  func testEveryStoredLinkShapeOpensThePageItNames() {
    let site = ["orgSlug": "acme", "hostSlug": "shop"]
    let cases: [(link: String, expected: LinkTarget, line: UInt)] = [
      // The console's own order address (the Orders card, order notices) opens that order, not the list.
      ("/acme/hosts/shop/products/orders?order=o1", .screen("commerce.order", site.merging(["order": "o1", "orderId": "o1"]) { $1 }), #line),
      ("/acme/hosts/shop/products/orders?quote=q1", .screen("commerce.quote", site.merging(["quote": "q1"]) { $1 }), #line),
      // An empty value is no order to open: the list.
      ("/acme/hosts/shop/products/orders?order=", .screen("commerce.orders", site.merging(["order": ""]) { $1 }), #line),
      ("/acme/hosts/shop/products/orders?filter=open", .screen("commerce.orders", site.merging(["filter": "open"]) { $1 }), #line),
      ("/acme/hosts/shop/products/returns?return=r%201", .screen("commerce.return", site.merging(["return": "r 1", "returnId": "r 1"]) { $1 }), #line),
      ("/acme/hosts/shop/products/returns", .screen("commerce.returns", site), #line),
      ("/acme/hosts/shop/products/shipping", .screen("commerce.shipping", site), #line),
      ("/acme/hosts/shop/products/notifications", .screen("commerce.notifications", site), #line),
      // No native screen: still a gap, never a listing or an order.
      ("/acme/hosts/shop/products/subscriptions?subscription=s1", .unavailable("/acme/hosts/shop/products/subscriptions?subscription=s1"), #line),
      ("/acme/hosts/shop/products/pos", .unavailable("/acme/hosts/shop/products/pos"), #line),
      // The marketplace hub's sections win over a listing's `/marketplace/{id}`.
      ("/acme/marketplace/payouts", .screen("marketplace.sell", ["orgSlug": "acme", "section": "payouts"]), #line),
      ("/acme/marketplace/listings", .screen("marketplace.sell", ["orgSlug": "acme", "section": "listings"]), #line),
      ("/acme/marketplace/licences", .screen("marketplace.licenses", ["orgSlug": "acme"]), #line),
      ("/acme/marketplace/browse", .screen("marketplace.browse", ["orgSlug": "acme"]), #line),
      ("/acme/marketplace/upload", .unavailable("/acme/marketplace/upload"), #line),
      ("/acme/marketplace/l1", .screen("marketplace.listing", ["orgSlug": "acme", "listingId": "l1"]), #line),
      // A workspace's own address and its Sites.
      ("/acme", .unavailable("/acme"), #line),
      ("/acme/hosts", .screen("site.sites", ["orgSlug": "acme"]), #line),
      ("/acme/settings/sso", .screen("core.settings.sso", ["orgSlug": "acme"]), #line),
      // A staff link's `#fragment` names a spot on the page, never part of its id.
      ("/admin/orgs/org-1#site-care", .screen("core.staff.org", ["orgId": "org-1"]), #line),
      ("/admin/orgs#top", .screen("core.staff.orgs", [:]), #line),
      ("/admin/hardware-orders", .unavailable("/admin/hardware-orders"), #line),
      ("/acme/hosts/shop/analytics", .unavailable("/acme/hosts/shop/analytics"), #line),
      ("/acme/crm/leads/l1", .screen("crm.lead", ["orgSlug": "acme", "lead": "l1"]), #line),
      ("/acme/crm/leads", .screen("crm.leads", ["orgSlug": "acme"]), #line),
      ("/acme/hosts/shop/ai-jobs/j1", .screen("ai.job", site.merging(["jobId": "j1"]) { $1 }), #line),
      ("/acme/hosts/shop/screens/s1", .screen("site.pages", site.merging(["screenId": "s1"]) { $1 }), #line),
      ("/acme/hosts/shop/screens/list", .screen("site.pages", site), #line),
    ]
    for (link, expected, line) in cases {
      XCTAssertEqual(DeepLinks.resolve(link, routes: consoleRoutes), expected, link, line: line)
    }
  }

  /// A notice stored with a site's id, about a site in a workspace not on screen: the row's own ids stand in for the
  /// slugs, so the link still names that site (the store matches by id) instead of reading the id as a workspace.
  func testANoticeAboutAnotherWorkspacesSiteStillNamesThatSite() {
    let link = DeepLinks.notificationLink("/h9/products/orders?order=o1", orgSlug: "org-beta", hostID: "h9", hostSubdomain: "h9")
    XCTAssertEqual(link, "/org-beta/hosts/h9/products/orders?order=o1")
    XCTAssertEqual(
      DeepLinks.resolve(link ?? "", routes: consoleRoutes),
      .screen("commerce.order", ["orgSlug": "org-beta", "hostSlug": "h9", "order": "o1", "orderId": "o1"]))
    // A workspace notice: `/org/…` is the workspace's own page.
    XCTAssertEqual(
      DeepLinks.resolve(DeepLinks.notificationLink("/org/settings/sso", orgSlug: "acme", hostID: nil, hostSubdomain: nil) ?? "", routes: consoleRoutes),
      .screen("core.settings.sso", ["orgSlug": "acme"]))
    XCTAssertEqual(
      DeepLinks.resolve(DeepLinks.notificationLink("/org/marketplace/payouts", orgSlug: "acme", hostID: nil, hostSubdomain: nil) ?? "", routes: consoleRoutes),
      .screen("marketplace.sell", ["orgSlug": "acme", "section": "payouts"]))
    XCTAssertEqual(DeepLinks.notificationLink("/hosts", orgSlug: "acme", hostID: nil, hostSubdomain: nil), "/acme/hosts")
  }

  func testAParamNamesTheValuesItTakesOrRefuses() {
    XCTAssertEqual(DeepLinks.matchPathPattern("/m/:section(a|b)", "/m/a"), ["section": "a"])
    XCTAssertNil(DeepLinks.matchPathPattern("/m/:section(a|b)", "/m/c"))
    XCTAssertEqual(DeepLinks.matchPathPattern("/m/:id(!upload)", "/m/x1"), ["id": "x1"])
    XCTAssertNil(DeepLinks.matchPathPattern("/m/:id(!upload)", "/m/upload"))
  }

  func testAFragmentIsNeverPartOfAPathOrAQuery() {
    XCTAssertEqual(DeepLinks.withoutFragment("/a/b?c=1#d"), "/a/b?c=1")
    XCTAssertEqual(
      DeepLinks.resolve("/acme/hosts/shop/products/orders?order=o1#items", routes: consoleRoutes),
      .screen("commerce.order", ["orgSlug": "acme", "hostSlug": "shop", "order": "o1", "orderId": "o1"]))
  }
}
