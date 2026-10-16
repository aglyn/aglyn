// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynSalesChannelsPlugin

final class SalesChannelsPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["sales-channels.channel", "sales-channels.diagnostics", "sales-channels.diagnosticsChannel", "sales-channels.service"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "sales-channels", contributes: declared, register: registerSalesChannelsNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
