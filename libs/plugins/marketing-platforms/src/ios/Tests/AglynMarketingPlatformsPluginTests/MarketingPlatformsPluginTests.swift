// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynMarketingPlatformsPlugin

final class MarketingPlatformsPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["marketing-platforms.platform", "marketing-platforms.service"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "marketing-platforms", contributes: declared, register: registerMarketingPlatformsNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
