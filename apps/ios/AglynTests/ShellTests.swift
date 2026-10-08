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
    XCTAssertEqual(result.loaded, ["redirects"])
    XCTAssertNotNil(registry.screen("redirects.list"))
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
}
