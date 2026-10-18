// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

final class AppVersionTests: XCTestCase {
  func testTheStampedReleaseVersionWins() {
    XCTAssertEqual(
      AppVersion.resolve(["AGLYN_VERSION": "1.0.0-beta.266", "CFBundleShortVersionString": "1.0.0"]), "1.0.0-beta.266")
  }

  func testAnUnstampedBuildFallsBackToTheMarketingVersion() {
    XCTAssertEqual(AppVersion.resolve(["AGLYN_VERSION": "", "CFBundleShortVersionString": "1.0.0"]), "1.0.0")
    XCTAssertEqual(AppVersion.resolve(["AGLYN_VERSION": "$(AGLYN_VERSION)", "CFBundleShortVersionString": "1.0.0"]), "1.0.0")
    XCTAssertEqual(AppVersion.resolve([:]), "0")
  }
}
