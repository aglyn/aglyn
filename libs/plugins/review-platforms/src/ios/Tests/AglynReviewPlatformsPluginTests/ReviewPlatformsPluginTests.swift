// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynReviewPlatformsPlugin

final class ReviewPlatformsPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["review-platforms.service"], deepLinks: [])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "review-platforms", contributes: declared, register: registerReviewPlatformsNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }
}
