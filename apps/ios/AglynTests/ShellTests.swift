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

  func testANavigationPushLandsOnTheSelectedSection() {
    let navigation = ShellNavigation()
    navigation.section = .notifications
    navigation.push(.screen("redirects.list", [:]))
    XCTAssertEqual(navigation.paths[.notifications], [.screen("redirects.list", [:])])
    navigation.select(.notifications)
    XCTAssertEqual(navigation.paths[.notifications], [])
  }
}
