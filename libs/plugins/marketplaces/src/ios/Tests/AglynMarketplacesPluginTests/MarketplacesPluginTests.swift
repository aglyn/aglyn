// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynMarketplacesPlugin

final class MarketplacesPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["marketplaces.marketplace", "marketplaces.service"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "marketplaces", contributes: declared, register: registerMarketplacesNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
