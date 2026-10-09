// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import XCTest

@testable import AglynAiPlugin

final class AIPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares, and its links resolve.
  @MainActor
  func testRegistersItsDeclaredScreensAndLinks() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(
      screens: ["ai.credits", "ai.job", "ai.jobs", "ai.member", "ai.signals", "ai.staffOrg", "ai.staffUser"],
      quickActions: ["ai.open"],
      deepLinks: ["ai.job.link", "ai.jobs.link", "ai.signals.link"])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "ai", contributes: declared, register: registerAINative)], into: registry)
    XCTAssertEqual(result.failed, [])
    if case .screen(let screen, let params)? = registry.resolve("/acme/hosts/shop/ai-jobs/j1") {
      XCTAssertEqual(screen, "ai.job")
      XCTAssertEqual(params["jobId"], "j1")
    } else {
      XCTFail("an AI job link did not open the job")
    }
  }
}
