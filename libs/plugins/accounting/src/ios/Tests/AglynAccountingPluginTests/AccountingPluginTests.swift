// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynAccountingPlugin

final class AccountingPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["accounting.activity", "accounting.attention", "accounting.books"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "accounting", contributes: declared, register: registerAccountingNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
