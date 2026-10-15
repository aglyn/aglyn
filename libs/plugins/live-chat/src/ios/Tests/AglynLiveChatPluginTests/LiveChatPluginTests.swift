// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynLiveChatPlugin

final class LiveChatPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["live-chat.settings"], widgets: ["live-chat.settings.card"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "live-chat", contributes: declared, register: registerLiveChatNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
