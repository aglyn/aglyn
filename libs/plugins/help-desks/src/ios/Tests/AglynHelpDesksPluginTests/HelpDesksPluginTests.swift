// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynHelpDesksPlugin

final class HelpDesksPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["help-desks.provider", "help-desks.service"], widgets: ["help-desks.service.card"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "help-desks", contributes: declared, register: registerHelpDesksNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
