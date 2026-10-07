// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import XCTest

@testable import AglynRedirectsPlugin

@MainActor
final class RedirectsTests: XCTestCase {
  func testRegistersTheDeclaredIDsAndOpensTheConsolePageNatively() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(
      [
        NativePluginManifestEntry(
          id: "redirects",
          contributes: [
            "screens": ["redirects.list"], "widgets": ["redirects.summary"], "quickActions": ["redirects.open"],
            "deepLinks": ["redirects.page"],
          ], register: registerRedirectsNative)
      ], into: registry)
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(registry.screen("redirects.list")?.requiresSite, true)
    XCTAssertEqual(registry.quickActions(for: .aglyn).map(\.id), ["redirects.open"])
    XCTAssertEqual(
      registry.resolve("https://app.aglyn.com/acme/hosts/shop/redirects"),
      .screen("redirects.list", ["orgSlug": "acme", "hostSlug": "shop"]))
  }

  func testOrdersByPriorityThenSourceAndDropsSoftDeletedRules() {
    let row = { (id: String, source: String, priority: Double?, deleted: Bool) in
      RedirectRow(id: id, rule: HostRedirect(destination: "/x", priority: priority, source: source, statusCode: 301), deleted: deleted)
    }
    XCTAssertEqual(
      HostRedirects.inEvaluationOrder([
        row("a", "/b", nil, false), row("b", "/a", nil, false), row("c", "/z", 1, false), row("d", "/c", 1, true),
      ]).map(\.id), ["c", "b", "a"])
  }
}
