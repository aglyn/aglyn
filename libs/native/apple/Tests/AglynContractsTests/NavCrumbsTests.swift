// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Every crumb but the last opens its level (AGL-4058): the scope, the group, the place in use.
final class NavCrumbsTests: XCTestCase {
  private let plugins = ["forms", "commerce", "bookings", "inbox", "crm", "email", "marketing", "workflows", "redirects"]

  private func row(_ id: String, in list: ResolvedNavList) -> NativeNavRow {
    list.groups.flatMap(\.rows).first { $0.id == id }!
  }

  func testASettingsPlaceLinksTheSettingsRootAndItsSection() {
    let list = resolveNavList(.siteSettings, enabledPluginIds: plugins, hostAdmin: true)
    let crumbs = navCrumbs(
      for: row("business", in: list), in: list, owner: "Site settings", ownerOpens: navScopeRow(in: list))
    XCTAssertEqual(crumbs.map(\.label), ["Site settings", "Setup", "Business profile"])
    XCTAssertEqual(crumbs[0].opens?.id, list.groups.flatMap(\.rows).first?.id, "the settings root: its list's first row")
    XCTAssertEqual(crumbs[1].opens?.id, "details", "the section: Setup's first row")
    XCTAssertNil(crumbs[2].opens, "the place in use opens nothing")
  }

  func testAnEverydayPlaceLinksTheScopeHomeAndItsGroup() {
    let list = resolveNavList(.site, enabledPluginIds: plugins, hostAdmin: true)
    let crumbs = navCrumbs(
      for: row("orders", in: list), in: list, owner: "Juniper Street Bakery", ownerOpens: navScopeRow(in: list))
    XCTAssertEqual(crumbs.map(\.label), ["Juniper Street Bakery", "Sell", "Orders"])
    XCTAssertEqual(crumbs[0].opens?.screen, NativeNav.home)
    XCTAssertNil(crumbs[1].opens, "Sell's first row is Orders itself, the place in use")
    let products = navCrumbs(for: row("products", in: list), in: list, owner: "Juniper Street Bakery", ownerOpens: navScopeRow(in: list))
    XCTAssertEqual(products[1].opens?.id, "orders")
  }

  func testAGroupWithNoLabelHasNoLevel() {
    let list = resolveNavList(.site, enabledPluginIds: plugins, hostAdmin: true)
    let crumbs = navCrumbs(for: row("overview", in: list), in: list, owner: "Juniper Street Bakery", ownerOpens: navScopeRow(in: list))
    XCTAssertEqual(crumbs.map(\.label), ["Juniper Street Bakery", "Overview"])
  }
}
