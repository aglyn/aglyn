// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynAdConversionsPlugin

final class AdConversionsPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["ad-conversions.provider", "ad-conversions.service"], widgets: ["ad-conversions.service.card"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "ad-conversions", contributes: declared, register: registerAdConversionsNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
