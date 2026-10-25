// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynPluginHost
import AglynPluginManifest
import AglynScreens
import XCTest

@testable import Aglyn

@MainActor
final class ShellTests: XCTestCase {
  func testTheManifestLoadsEveryPlugin() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(NativePluginManifest.entries, into: registry)
    XCTAssertEqual(result.failed, [])
    // Every plugin the generated manifest names loads, whichever lands next.
    XCTAssertEqual(result.loaded.sorted(), NativePluginManifest.entries.map(\.id).sorted())
    XCTAssertNotNil(registry.screen("redirects.list"))
  }

  func testTheRegistersOrdersZoneHoldsTheDeliveryQueueForThePosAppOnly() {
    let registry = NativePluginRegistry()
    _ = NativePluginLoader.load(NativePluginManifest.entries, into: registry)
    // The commerce plugin hosts the zone and the delivery-apps plugin fills it; neither names the other.
    XCTAssertEqual(registry.widgets(for: .pos, slot: "posOrders").map(\.id), ["delivery-apps.pos-orders"])
    XCTAssertTrue(registry.widgets(for: .aglyn, slot: "posOrders").isEmpty)
    XCTAssertFalse(registry.widgets(for: .pos).contains { $0.id == "delivery-apps.pos-orders" }, "and it is never a Home card")
  }

  func testThePlatformEntriesLoadBeforeThePlugins() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(AppModel.platformEntries + NativePluginManifest.entries, into: registry)
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(result.loaded.first, "site")
    XCTAssertNotNil(registry.screen("site.pages"))
    XCTAssertEqual(registry.resolve("/acme/hosts/shop/screens"), .screen("site.pages", ["orgSlug": "acme", "hostSlug": "shop"]))
  }

  /// The in-app Besigner's own Assist edits the canvas; the title bar's ✦ steps aside while it shows (AGL-4057).
  func testTheBesignerOnScreenHidesTheAppsAILauncher() {
    let navigation = ShellNavigation()
    navigation.select(.plugin("forms.list"))
    XCTAssertFalse(navigation.besignerOnScreen)
    navigation.push(.besigner("/acme/hosts/shop/forms/contact/versions/v1/besigner"))
    XCTAssertTrue(navigation.besignerOnScreen)
    navigation.push(.screen("forms.detail", ["formId": "contact"]))
    XCTAssertFalse(navigation.besignerOnScreen, "a screen the editor opened natively sits on top")
    navigation.paths[navigation.section] = []
    XCTAssertFalse(navigation.besignerOnScreen)
  }

  func testANavigationPushLandsOnTheSelectedSection() {
    let navigation = ShellNavigation()
    navigation.section = .notifications
    navigation.push(.screen("redirects.list", [:]))
    XCTAssertEqual(navigation.paths[.notifications], [.screen("redirects.list", [:])])
    navigation.select(.notifications)
    XCTAssertEqual(navigation.paths[.notifications], [])
  }

  /// Opening a site, or going back to the whole workspace, starts every screen at its root: the workspace's search
  /// results pushed on its Home never show under the site's Home (P4).
  func testOpeningAScopeStartsItsScreensAtTheirRoots() {
    let navigation = ShellNavigation()
    navigation.enterWorkspace()
    navigation.push(.searchResults("ord"))
    navigation.select(.plugin("site.sites"))
    navigation.enterSite()
    XCTAssertEqual(navigation.section, .home)
    XCTAssertEqual(navigation.paths[.home] ?? [], [])
    navigation.push(.screen("commerce.order", ["orderId": "o-1"]))
    navigation.enterWorkspace()
    XCTAssertEqual(navigation.paths[.home] ?? [], [])
  }

  /// A workspace picked in the switcher from a pushed settings screen is open at once, from its Home: the phone's
  /// sites step only narrows it, and closing the sheet there must not leave the old workspace's screen in front.
  func testPickingAWorkspaceLeavesSettingsForItsHome() {
    let navigation = ShellNavigation()
    navigation.enter(.workspaceSettings, first: .plugin("core.team"))
    navigation.push(.screen("core.team.member", ["uid": "u-1"]))
    openPickedWorkspace("org-2", in: nil, navigation: navigation)
    XCTAssertEqual(navigation.mode, .main)
    XCTAssertEqual(navigation.section, .home)
    XCTAssertTrue(navigation.paths.values.allSatisfy(\.isEmpty))
  }

  /// Decision 5: a white-label workspace's brand color is the accent while you are in it (switch-off-able), never a
  /// picked or logo-derived color, never a brand color the workspace is not white-label for; your own accent wins.
  func testOnlyAWhiteLabelBrandBecomesTheAccent() {
    let theme = ContractValues.shared.defaultAppTheme
    var mine = theme
    mine.accent = "#E040FB"
    let brand = resolveWorkspaceColor(picked: nil, brandColor: "#0F7B6C", logoColor: nil, useWorkspaceBrand: true)
    let brandOff = resolveWorkspaceColor(picked: nil, brandColor: "#0F7B6C", logoColor: nil, useWorkspaceBrand: false)
    let picked = resolveWorkspaceColor(picked: "#FF6D00", brandColor: "#0F7B6C", logoColor: nil, useWorkspaceBrand: true)
    let logo = resolveWorkspaceColor(picked: nil, brandColor: nil, logoColor: "#123456", useWorkspaceBrand: true)
    XCTAssertEqual(ThemeApplier.accent(theme, workspace: brand, whiteLabel: true), "#0F7B6C")
    XCTAssertNil(ThemeApplier.accent(theme, workspace: brand, whiteLabel: false))
    XCTAssertNil(ThemeApplier.accent(theme, workspace: brandOff, whiteLabel: true))
    XCTAssertNil(ThemeApplier.accent(theme, workspace: picked, whiteLabel: true))
    XCTAssertNil(ThemeApplier.accent(theme, workspace: logo, whiteLabel: true))
    XCTAssertEqual(ThemeApplier.accent(mine, workspace: brand, whiteLabel: true), "#E040FB")
  }

  /// Firebase Auth's app-delegate proxy hands the APNs device token only to a delegate class that implements the
  /// callback itself, and SwiftUI's forwards it to `PushAppDelegate`: with the proxy on, the token never reaches `PushCenter`.
  /// The built app's own Info.plist, from its bundle. Both apps' source plists are checked by the SwiftPM
  /// `AppConfigTests`: a hosted app test that read them from the checkout under ~/Documents raised the system's
  /// Documents-folder prompt on the Mac and hung the run.
  func testBothAppsKeepFirebasesAppDelegateProxyOff() {
    XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "FirebaseAppDelegateProxyEnabled") as? Bool, false)
  }

  /// Every row the nav manifest lists opens a screen this app has (AGL-3945): a row with none would be a dead end.
  func testEveryManifestRowOpensAScreenTheAppHas() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(
      [CoreScreens.manifestEntry] + AppModel.platformEntries + NativePluginManifest.entries, into: registry)
    XCTAssertEqual(result.failed, [])
    for list in NativeNav.manifest.lists {
      for row in list.groups.flatMap(\.rows) where !row.screen.hasPrefix("shell.") {
        XCTAssertNotNil(registry.screen(row.screen), "\(list.id.rawValue).\(row.id) opens \(row.screen), which is not registered")
        for section in row.sections ?? [] {
          XCTAssertNotNil(registry.screen(section.screen), "\(row.id) section \(section.id) opens \(section.screen)")
        }
      }
    }
  }

  /// On a phone, every section of every sectioned row is one chip from the row (AGL-3993): the Menu pushes the area with
  /// its chips, and each chip swaps it in place, so Components, Layouts, Templates and Content are all at depth 1.
  func testEverySectionedRowReachesEachSectionFromThePhoneMenu() {
    var checked = 0
    for list in NativeNav.manifest.lists {
      for row in list.groups.flatMap(\.rows) where (row.sections?.count ?? 0) > 1 {
        let navigation = ShellNavigation()
        navigation.select(.more)
        navigation.pushArea(ShellSection.opening(row.screen, row.params))
        XCTAssertEqual(navigation.paths[.more], [.area(row.screen, row.params ?? [:])], "\(list.id.rawValue).\(row.id)")
        for section in row.sections ?? [] {
          navigation.swapArea(ShellSection.opening(section.screen, section.params))
          XCTAssertEqual(
            navigation.paths[.more], [.area(section.screen, section.params ?? [:])],
            "\(list.id.rawValue).\(row.id) section \(section.id) is not one chip from its row")
          checked += 1
        }
        XCTAssertEqual(navigation.section, .more, "a chip never leaves Menu")
      }
    }
    // Pages' five (Components, Layouts, Templates, Content), Orders', Products' and Inbox's, at the least.
    XCTAssertGreaterThanOrEqual(checked, 14)
  }

  /// A section a phone has no tab for opens in Menu as an area with its chips, never as its bare screen (AGL-3993).
  func testASectionWithNoTabOpensInMenuAsAnArea() {
    let navigation = ShellNavigation()
    navigation.openInMenu(.plugin("site.content"))
    XCTAssertEqual(navigation.section, .more)
    XCTAssertEqual(navigation.paths[.more], [.area("site.content", [:])])
    navigation.openInMenu(.place("site.setup", ["section": "seo"]))
    XCTAssertEqual(navigation.paths[.more]?.last, .area("site.setup", ["section": "seo"]))
    navigation.openInMenu(.analytics)
    XCTAssertEqual(navigation.paths[.more]?.last, .analytics)
  }

  /// From a tab's root (a phone's Orders tab), a chip pushes its section once; the tab's own section returns to the root.
  func testAChipOnATabsRootPushesItsSectionOnceAndComesBack() {
    let navigation = ShellNavigation()
    navigation.select(.plugin("commerce.orders"))
    navigation.swapArea(.plugin("commerce.returns"))
    XCTAssertEqual(navigation.paths[.plugin("commerce.orders")], [.area("commerce.returns", [:])])
    navigation.swapArea(.plugin("commerce.reservations"))
    XCTAssertEqual(navigation.paths[.plugin("commerce.orders")], [.area("commerce.reservations", [:])])
    navigation.swapArea(.plugin("commerce.orders"))
    XCTAssertEqual(navigation.paths[.plugin("commerce.orders")], [])
    XCTAssertEqual(navigation.section, .plugin("commerce.orders"))
  }

  /// Back and Forward walk the sections opened, and a new place drops what was ahead.
  func testHistoryGoesBackAndForward() {
    let navigation = ShellNavigation()
    navigation.select(.plugin("commerce.orders"))
    navigation.select(.plugin("site.pages"))
    navigation.goBack()
    XCTAssertEqual(navigation.section, .plugin("commerce.orders"))
    navigation.goForward()
    XCTAssertEqual(navigation.section, .plugin("site.pages"))
    navigation.goBack()
    navigation.select(.analytics)
    XCTAssertFalse(navigation.canGoForward)
  }
}
