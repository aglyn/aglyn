// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynRedirectsPlugin

private final class NoWrites: RedirectsWriteAPI, @unchecked Sendable {
  func check(_ draft: RedirectDraft) async throws -> RedirectCheck { .refused("unused") }
  func create(_ fields: [String: Any]) async throws {}
  func update(_ id: String, _ fields: [String: Any]) async throws {}
  func setEnabled(_ id: String, _ enabled: Bool) async throws {}
  func delete(_ id: String) async throws {}
  func announce(_ source: String?) async {}
}

/// The Redirects page's Import, Export, plan readout and gate, and "Test a path", as the console's page has them.
@MainActor
final class RedirectsPageToolsTests: XCTestCase {
  func testImportOpensTheHubImportOnThisSitesRules() {
    XCTAssertEqual(coreDataImportScreen, "core.settings.data.import")
    XCTAssertEqual(redirectsImportParams(hostID: "h1"), ["resource": "redirects", "hostId": "h1"])
    XCTAssertEqual(redirectsImportParams(hostID: nil), ["resource": "redirects"])
  }

  func testExportCoversEveryRuleOfTheSite() {
    let request = redirectsExportRequest(hostID: "h1")
    XCTAssertEqual(request.resource, "redirects")
    XCTAssertEqual(request.title, "Export Redirects")
    XCTAssertEqual(request.hostID, "h1")
    XCTAssertEqual(request.scope, ["kind": "all"])
    XCTAssertFalse(request.hasFilter)
    XCTAssertNil(request.filter)
  }

  func testAddIsRefusedAtThePlansCapInThePagesWords() {
    XCTAssertEqual(redirectLimitRefusal(planReady: true, used: 25, limit: 25), "Redirect limit reached (25) — upgrade in Billing")
    XCTAssertEqual(redirectLimitRefusal(planReady: true, used: 0, limit: 0), "Redirect limit reached (0) — upgrade in Billing")
    XCTAssertNil(redirectLimitRefusal(planReady: true, used: 24, limit: 25))
    // Unlimited, an unknown plan, and an unread count (as none) let it through: the route counts again.
    XCTAssertNil(redirectLimitRefusal(planReady: true, used: 900, limit: nil))
    XCTAssertNil(redirectLimitRefusal(planReady: false, used: 25, limit: 25))
    XCTAssertNil(redirectLimitRefusal(planReady: true, used: nil, limit: 25))
  }

  func testTheEditorShowsTheRefusalInsteadOfTheForm() {
    let editor = RedirectsEditor(api: NoWrites(), uid: "u1")
    editor.add(limitRefusal: "Redirect limit reached (25) — upgrade in Billing")
    XCTAssertNil(editor.draft)
    XCTAssertEqual(editor.warning, "Redirect limit reached (25) — upgrade in Billing")
    editor.add()
    XCTAssertNotNil(editor.draft)
    XCTAssertNil(editor.warning)
  }

  func testTheTesterAsksTheRouteAndShowsItsLine() {
    XCTAssertEqual(redirectTestRoute, "/api/redirects/test")
    XCTAssertEqual(redirectTestBody(hostID: "h1", path: "/old-page"), ["hostId": "h1", "path": "/old-page"])
    XCTAssertEqual(redirectTestText(["path": "/old-page", "text": "→ /new-page (301)"]), "→ /new-page (301)")
    XCTAssertEqual(redirectTestText(["path": "/x", "match": nil, "text": "No rule matches"]), "No rule matches")
    XCTAssertNil(redirectTestText(nil))
  }
}
