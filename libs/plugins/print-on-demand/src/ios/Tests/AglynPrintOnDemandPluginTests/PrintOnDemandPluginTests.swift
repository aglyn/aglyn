// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynPrintOnDemandPlugin

final class PrintOnDemandPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["print-on-demand.catalog", "print-on-demand.connection", "print-on-demand.imported", "print-on-demand.orders", "print-on-demand.service"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "print-on-demand", contributes: declared, register: registerPrintOnDemandNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
