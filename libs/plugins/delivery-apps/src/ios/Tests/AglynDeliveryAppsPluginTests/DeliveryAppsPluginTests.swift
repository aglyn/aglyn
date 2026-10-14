// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynDeliveryAppsPlugin

final class DeliveryAppsPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["delivery-apps.match", "delivery-apps.service", "delivery-apps.store"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "delivery-apps", contributes: declared, register: registerDeliveryAppsNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
