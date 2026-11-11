// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import XCTest

@testable import AglynCore

private struct Route: DeepLinkRoute {
  let path: String
  let screen: String
}

/// Every way into a place lands where a link to it does (AGL-4059): a link, a universal and an `aglyn://` link, a
/// notification, a push, a search row, a Starred and a Recent item and a screens-and-settings match each give the same
/// path, the levels navigating there by hand passes, against the real nav manifest. The cases are shared with the Kotlin
/// kit (`libs/native/contracts/nav-path-cases.json`).
final class NavPathTests: XCTestCase {
  private static let fixture: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .appendingPathComponent("../../../contracts/nav-path-cases.json").standardizedFileURL
    let data = (try? Data(contentsOf: url)) ?? Data()
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
  }()

  private var routes: [Route] {
    (Self.fixture["routes"] as? [[String: String]] ?? []).map { Route(path: $0["path"] ?? "", screen: $0["screen"] ?? "") }
  }

  private var lists: NavPathLists {
    let staffRows = (Self.fixture["staff"] as? [String] ?? []).map { id in
      NativeNavRow(
        console: NativeNavConsoleRef(id: id, surface: .nativeOnly), icon: NativeNavIcon(android: "", apple: ""), id: id,
        label: id, screen: id)
    }
    let staff = ResolvedNavList(groups: [NativeNavGroup(foldable: false, id: "staff", rows: staffRows)], id: .unknown)
    return NavPaths.lists(staff: staff, has: { _ in true })
  }

  func testTheFixtureLoads() {
    XCTAssertFalse(routes.isEmpty)
    XCTAssertGreaterThan((Self.fixture["cases"] as? [Any])?.count ?? 0, 10)
  }

  func testEveryEntryPointLandsWhereALinkWould() throws {
    let cases = Self.fixture["cases"] as? [[String: Any]] ?? []
    var entries = 0
    for item in cases {
      let name = item["name"] as? String ?? "?"
      let expected = try XCTUnwrap(Self.path(item["expect"] as? [String: Any]), name)
      // A starred setting selects its own row in its mode, not the starred row (AGL-4059 iPad drive).
      XCTAssertEqual(
        expected.keepsStarredRow, (item["expect"] as? [String: Any])?["starredRowStays"] as? Bool, "\(name): the starred row stays")
      for entry in item["entries"] as? [[String: Any]] ?? [] {
        let via = entry["via"] as? String ?? "?"
        XCTAssertEqual(open(entry)?.unscoped, expected, "\(name), via \(via)")
        if let scope = scope(of: entry) { XCTAssertEqual(scope, item["scope"] as? String, "\(name), via \(via): its scope") }
        entries += 1
      }
    }
    XCTAssertGreaterThan(entries, 50)
  }

  /// A link that names a workspace and site opens on them; one that names none opens where the window stands.
  func testALinkNamesTheWorkspaceAndSiteItOpensOn() {
    let routes = routes
    let lists = lists
    let site = NavPaths.link("https://console.example.com/acme/hosts/shop/products/orders?order=o1", routes: routes, lists: lists, inSite: false)
    XCTAssertEqual(site?.scope.orgSlug, "acme")
    XCTAssertEqual(site?.scope.hostSlug, "shop")
    let workspace = NavPaths.link("/acme/crm/leads/l1", routes: routes, lists: lists, inSite: true)
    XCTAssertEqual(workspace?.scope.orgSlug, "acme")
    XCTAssertNil(workspace?.scope.hostSlug)
    XCTAssertNil(NavPaths.link("/manage/notifications", routes: routes, lists: lists, inSite: true)?.scope.orgSlug)
    XCTAssertEqual(NavPaths.link("/manage/notifications", routes: routes, lists: lists, inSite: true)?.path, NavPath(area: .shell(.notifications)))
    XCTAssertNil(NavPaths.link("javascript:alert(1)", routes: routes, lists: lists, inSite: true))
  }

  /// A screen the build lacks is no area: the place opens over Home with the levels on the way to it.
  func testAPlaceWithNoRowOpensOverHomeWithItsLevels() {
    let lists = NavPaths.lists(has: { !$0.hasPrefix("commerce.") })
    let path = NavPaths.link("/acme/hosts/shop/products/orders?order=o1", routes: routes, lists: lists, inSite: true)?.path
    XCTAssertEqual(
      path?.unscoped,
      NavPath(
        area: .shell(.home),
        pushed: [
          .screen("commerce.products", [:]), .screen("commerce.orders", [:]),
          .screen("commerce.order", ["order": "o1", "orderId": "o1"]),
        ]))
  }

  func testAConsoleAddressIsTheRouteThatTakesTheMostOfThePlace() {
    let routes = routes
    XCTAssertEqual(NavPaths.consoleAddress(screen: "site.pages", params: [:], routes: routes), "/screens")
    XCTAssertEqual(NavPaths.consoleAddress(screen: "site.pages", params: ["screenId": "s 1"], routes: routes), "/screens/s%201")
    XCTAssertEqual(NavPaths.consoleAddress(screen: "commerce.order", params: ["orderId": "o1"], routes: routes), "/products/orders?order=o1")
    XCTAssertEqual(NavPaths.consoleAddress(screen: "marketplace.sell", params: ["section": "payouts"], routes: routes), "/marketplace/payouts")
    XCTAssertNil(NavPaths.consoleAddress(screen: "marketplace.sell", params: ["section": "upload"], routes: routes))
    XCTAssertNil(NavPaths.consoleAddress(screen: "commerce.order", params: [:], routes: routes))
    XCTAssertEqual(NavPaths.searchRowID("workspace.marketplace.payouts"), "marketplace")
    XCTAssertEqual(NavPaths.searchRowID("siteSettings.seo"), "seo")
    XCTAssertNil(NavPaths.searchRowID("seo"))
  }

  // MARK: Replaying an entry

  /// Where an entry opens: `site`, `workspace` (the whole workspace, leaving a site on screen) or `unchanged`; nil for a
  /// search row (the scope in use).
  private func scope(of entry: [String: Any]) -> String? {
    func name(_ scope: DeepLinks.Scope?) -> String {
      guard let scope, scope.orgSlug != nil else { return "unchanged" }
      return scope.hostSlug == nil ? "workspace" : "site"
    }
    let link = entry["link"] as? String
    switch entry["via"] as? String {
    case "link", "universal", "aglyn", "search":
      return name(link.flatMap { NavPaths.link($0, routes: routes, lists: lists, inSite: true)?.scope })
    case "notification", "push":
      let stored = DeepLinks.notificationLink(
        link, orgSlug: entry["orgSlug"] as? String, hostID: entry["hostId"] as? String,
        hostSubdomain: entry["hostSubdomain"] as? String)
      return name(stored.flatMap { NavPaths.link($0, routes: routes, lists: lists, inSite: true)?.scope })
    case "starred", "recent":
      return ((entry["item"] as? [String: Any])?["hostId"] as? String) == nil ? "workspace" : "site"
    default:
      return nil
    }
  }

  private func open(_ entry: [String: Any]) -> NavPath? {
    let routes = routes
    let lists = lists
    let link = entry["link"] as? String
    switch entry["via"] as? String {
    case "link", "universal", "aglyn", "search":
      return link.flatMap { NavPaths.link($0, routes: routes, lists: lists, inSite: false)?.path }
    case "notification", "push":
      let stored = DeepLinks.notificationLink(
        link, orgSlug: entry["orgSlug"] as? String, hostID: entry["hostId"] as? String,
        hostSubdomain: entry["hostSubdomain"] as? String)
      return stored.flatMap { NavPaths.link($0, routes: routes, lists: lists, inSite: false)?.path }
    case "starred", "recent":
      guard let item = entry["item"], let data = try? JSONSerialization.data(withJSONObject: item),
        let ref = try? JSONDecoder().decode(AccountItemRef.self, from: data)
      else { return nil }
      return NavPaths.place(ref, routes: routes, lists: lists)
    case "searchScreen":
      return NavPaths.place(
        screen: entry["screen"] as? String ?? "", params: entry["params"] as? [String: String] ?? [:],
        rowID: (entry["rowId"] as? String).flatMap(NavPaths.searchRowID), inSite: entry["inSite"] as? Bool ?? false,
        routes: routes, lists: lists)
    default:
      return nil
    }
  }

  private static func path(_ json: [String: Any]?) -> NavPath? {
    guard let json, let mode = NavPathMode(rawValue: json["mode"] as? String ?? ""), let area = json["area"] as? [String: Any]
    else { return nil }
    let navArea: NavArea
    if let shell = area["shell"] as? String {
      guard let page = NavShellPage(rawValue: shell) else { return nil }
      navArea = .shell(page)
    } else {
      navArea = .row(
        id: area["row"] as? String ?? "", screen: area["screen"] as? String ?? "", params: area["params"] as? [String: String] ?? [:])
    }
    let pushed: [NavStep] = (json["pushed"] as? [[String: Any]] ?? []).compactMap { step in
      if let screen = step["screen"] as? String { return .screen(screen, step["params"] as? [String: String] ?? [:]) }
      if let path = step["besigner"] as? String { return .besigner(path) }
      if let path = step["unavailable"] as? String { return .unavailable(path) }
      return nil
    }
    return NavPath(mode: mode, area: navArea, pushed: pushed)
  }
}
