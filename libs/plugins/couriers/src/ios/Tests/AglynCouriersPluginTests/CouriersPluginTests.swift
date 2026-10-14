// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynCouriersPlugin

final class CouriersPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["couriers.order", "couriers.service"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "couriers", contributes: declared, register: registerCouriersNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
