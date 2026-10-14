// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynShippingPlugin

final class ShippingPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["shipping.billing", "shipping.boxes", "shipping.carriers", "shipping.connectCarrier", "shipping.connectOwn", "shipping.labels", "shipping.order", "shipping.own", "shipping.returnLabel", "shipping.service", "shipping.services", "shipping.shipFrom", "shipping.spend"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "shipping", contributes: declared, register: registerShippingNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
