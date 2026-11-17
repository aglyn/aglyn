// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynScreens
import XCTest

@testable import AglynDomainsPlugin

final class DomainsPluginTests: XCTestCase {
  /// Registers exactly what the plugin declares.
  @MainActor
  func testRegistersItsDeclaredScreens() {
    let registry = NativePluginRegistry()
    let declared = NativeContributionDeclaration(screens: ["domains.list", "domains.domain"], widgets: [], deepLinks: ["domains.list.link", "domains.domain.link"])
    let result = NativePluginLoader.load(
      [NativePluginManifestEntry(id: "domains", contributes: declared, register: registerDomainsNative)], into: registry)
    XCTAssertEqual(result.failed, [])
  }

  /// A row's status reads as the console's `domainStatus` does: one label for each status, the first that holds.
  func testEachRowShowsTheConsolesStatusLabel() throws {
    let spec = try XCTUnwrap(domainsScreenSpecs().first { $0.id == "domains.list" })
    let list = try XCTUnwrap(spec.blocks.first { $0.id == "domains" })
    let badges = list["badges"]?.arrayValue ?? []
    func label(_ row: JSONValue) -> [String] {
      badges.filter { ScreenValues.condition($0["when"]?.stringValue, in: ["item": row]) }.compactMap { $0["text"]?.stringValue }
    }
    XCTAssertEqual(label(["status": "registering", "origin": "transfer-in"]), ["Starting transfer"])
    XCTAssertEqual(label(["status": "charging", "origin": "purchase"]), ["Registering"])
    XCTAssertEqual(label(["status": "transferring-in"]), ["Moving here"])
    XCTAssertEqual(label(["status": "expired"]), ["Expired"])
    XCTAssertEqual(label(["status": "declined"]), ["Not completed"])
    XCTAssertEqual(label(["status": "active", "renewalFailing": true]), ["Renewal failing"])
    XCTAssertEqual(label(["status": "active", "renewalFailing": false, "verifyByMs": 1_800_000_000_000]), ["Confirm email"])
    XCTAssertEqual(label(["status": "active", "renewalFailing": false, "verifyByMs": .null]), ["Active"])
  }
}
