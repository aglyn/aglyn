// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynLoyaltyPlugin

final class LoyaltyPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["loyalty.rewards", "loyalty.connection", "loyalty.members", "loyalty.member", "loyalty.order"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "loyalty", contributes: declared, register: registerLoyaltyNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }

  /// The specs the package bundles are exactly the screens the plugin declares, and they draw in the zones Commerce hosts.
  func testItsSpecsAreTheFiveItDeclaresAndTheZonesCommerceHosts() {
    let specs = ScreenCatalog.load(from: .module)
    XCTAssertEqual(
      specs.map(\.id).sorted(),
      ["loyalty.connection", "loyalty.member", "loyalty.members", "loyalty.order", "loyalty.rewards"])
    XCTAssertEqual(Set(specs.flatMap(\.zones)), ["commercePromotions", "orderDetail"])
    XCTAssertEqual(specs.first { $0.id == "loyalty.order" }?.zones, ["orderDetail"])
  }
}
