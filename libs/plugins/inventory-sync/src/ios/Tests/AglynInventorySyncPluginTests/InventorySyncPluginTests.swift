// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynInventorySyncPlugin

final class InventorySyncPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["inventory-sync.service"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "inventory-sync", contributes: declared, register: registerInventorySyncNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
