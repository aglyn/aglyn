// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynFulfillmentNetworksPlugin

final class FulfillmentNetworksPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["fulfillment-networks.network", "fulfillment-networks.service"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "fulfillment-networks", contributes: declared, register: registerFulfillmentNetworksNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
