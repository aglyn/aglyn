// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynPluginManifest
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

  func testANavigationPushLandsOnTheSelectedSection() {
    let navigation = ShellNavigation()
    navigation.section = .notifications
    navigation.push(.screen("redirects.list", [:]))
    XCTAssertEqual(navigation.paths[.notifications], [.screen("redirects.list", [:])])
    navigation.select(.notifications)
    XCTAssertEqual(navigation.paths[.notifications], [])
  }

  /// Firebase Auth's app-delegate proxy hands the APNs device token only to a delegate class that implements the
  /// callback itself, and SwiftUI's forwards it to `PushAppDelegate`: with the proxy on, the token never reaches `PushCenter`.
  func testBothAppsKeepFirebasesAppDelegateProxyOff() throws {
    XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "FirebaseAppDelegateProxyEnabled") as? Bool, false)
    let config = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("Config")
    for name in ["Aglyn-Info.plist", "AglynPOS-Info.plist"] {
      let data = try Data(contentsOf: config.appendingPathComponent(name))
      let plist = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
      XCTAssertEqual(plist["FirebaseAppDelegateProxyEnabled"] as? Bool, false, name)
    }
  }
}
