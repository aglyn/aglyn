// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// Admin › Error pages' Maintenance mode switch (the console's ErrorScreensCard): the site document's `maintenance`, true
/// while it is on and deleted when it is turned off, written as the console writes it, with the site-wide republish.
final class SiteMaintenanceSpecTests: XCTestCase {
  @MainActor
  func testTheSwitchWritesMaintenanceOnAndDeletesItOff() async throws {
    final class Recorder: FirestoreWriter, @unchecked Sendable {
      var calls: [(path: [String], fields: [String: Any])] = []
      func merge(_ path: [String], _ fields: [String: Any]) async throws { calls.append((path, fields)) }
    }
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.site.errorPages" })
    let block = try XCTUnwrap(spec.blocks.first { $0.id == "maintenance" })
    XCTAssertEqual(block.when, "site.can[site.manage]")
    let submit = try XCTUnwrap(block["submit"].flatMap(ActionSpec.init))
    XCTAssertTrue(submit.siteWide, "the console's host-document write republishes the site")
    let field = try XCTUnwrap(block["fields"].array.compactMap(FieldSpec.init).first)
    XCTAssertEqual(field.kind, "toggle")
    XCTAssertEqual(field.label, "Maintenance mode — show visitors the 503 page at every address")
    XCTAssertEqual(ScreenValues.render(field.initial ?? "", in: ["data": ["site": ["maintenance": true]]]), "true")
    XCTAssertNotEqual(ScreenValues.render(field.initial ?? "", in: ["data": ["site": [:]]]), "true")

    let writer = Recorder()
    let model = ScreenModel(spec: spec, context: ["site": ["id": "h1"]], api: nil, writer: writer)
    _ = await model.run(submit, in: ["site": ["id": "h1"], "form": ["maintenance": true]])
    _ = await model.run(submit, in: ["site": ["id": "h1"], "form": ["maintenance": false]])
    XCTAssertEqual(writer.calls.map(\.path), [["hosts", "h1"], ["hosts", "h1"]])
    XCTAssertEqual(writer.calls.first?.fields["maintenance"] as? Bool, true)
    XCTAssertEqual(writer.calls.last?.fields["maintenance"] as? FirestoreSentinel, .delete)
  }

  func testVisitSiteEntersAsTheTeamInPreviewOrMaintenance() {
    XCTAssertTrue(SiteVisit.entersAsTeam(["maintenance": true]))
    XCTAssertTrue(SiteVisit.entersAsTeam(["preview": true]))
    XCTAssertFalse(SiteVisit.entersAsTeam(["preview": "yes"]))
    XCTAssertFalse(SiteVisit.entersAsTeam(["maintenance": false]))
    XCTAssertFalse(SiteVisit.entersAsTeam(nil))
  }

  /// Admin › Security lists the approved image hosts too (the console's first card), and every add and remove republishes
  /// the site, as the console's host-document writes of those CSP lists do.
  func testSecurityListsImageHostsAndEveryChangeRepublishes() throws {
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.site.security" })
    let lists = spec.blocks.filter { $0.type == "list" }
    XCTAssertEqual(lists.first?.title, "Image hosts")
    XCTAssertEqual(lists.first?["items"]?.stringValue, "data.site.approvedImageHosts")
    let removes = lists.flatMap { $0["actions"].array.compactMap(ActionSpec.init) }
    let adds = spec.blocks.filter { $0.type == "actions" }.flatMap { $0["items"].array.compactMap(ActionSpec.init) }
    XCTAssertEqual(adds.first?.id, "addImage")
    XCTAssertEqual(removes.count, 6)
    XCTAssertEqual(adds.count, 6)
    XCTAssertTrue((removes + adds).allSatisfy(\.siteWide))
  }
}
