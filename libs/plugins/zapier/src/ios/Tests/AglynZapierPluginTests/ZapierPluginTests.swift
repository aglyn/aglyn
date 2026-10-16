// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynZapierPlugin

final class ZapierPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["zapier.connections"], widgets: ["zapier.connections.card"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "zapier", contributes: declared, register: registerZapierNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
