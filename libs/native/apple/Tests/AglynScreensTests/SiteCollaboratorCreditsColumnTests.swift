// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynScreens

/// A site's Collaborators carry the AI plugin's "AI credits (site, month)" column (the console's hostMembers column
/// `ai-collaborator-credits`, gap sweep Site home row 9): each collaborator's credits on the site this month, 0 for
/// someone with none, and a dash for an invited collaborator or a reader the usage route refuses, as the console's cell reads.
final class SiteCollaboratorCreditsColumnTests: XCTestCase {
  private static let aiSpecs = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("../../../../plugins/ai/src/ios/Sources/AglynAiPlugin/Resources/ai.screens.json").standardizedFileURL

  private func column() throws -> ScreenSpec {
    try XCTUnwrap(ScreenCatalog.parse(Data(contentsOf: Self.aiSpecs)).first { $0.id == "ai.collaboratorCreditsColumn" })
  }

  /// The collaborators list, read from a route here so the test needs no Firestore; the column is the real one.
  private func collaborators() throws -> ScreenSpec {
    try XCTUnwrap(
      ScreenSpec([
        "id": "core.x", "title": "X", "load": ["members": ["url": "/api/x/members"]],
        "blocks": [["type": "list", "items": "data.members.items", "columnsZone": "hostMembersColumn", "primary": "{item.email}"]],
      ]))
  }

  func testTheSiteListDrawsTheColumnZone() throws {
    let data = try Data(contentsOf: ScreenSpecTests.screensDir.appendingPathComponent("site.screens.json"))
    let users = try XCTUnwrap(ScreenCatalog.parse(data).first { $0.id == "core.site.users" })
    let list = try XCTUnwrap(users.blocks.first { $0.type == "list" && $0["title"]?.stringValue == "Collaborators" })
    XCTAssertEqual(list["columnsZone"]?.stringValue, "hostMembersColumn")
    XCTAssertEqual(try column().raw["zones"].array.compactMap(\.stringValue), ["hostMembersColumn"])
  }

  @MainActor
  func testEachCollaboratorReadsTheirCreditsOnTheSiteAndAnInvitedOneADash() async throws {
    ScreenCatalog.shared.add([try column()])
    let transport = RecordingTransport(responses: [
      (200, #"{"items":[{"uid":"u1","email":"a@x.test"},{"uid":"u2","email":"b@x.test"},{"email":"c@x.test","status":"invited"}]}"#),
      (200, #"{"month":"2026-11","rows":[],"hostCells":{"u1":1234,"u2":0}}"#),
    ])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let context = try XCTUnwrap(JSONValue.decode(Data(#"{"org":{"id":"o1"},"site":{"id":"h1"}}"#.utf8)))
    let model = ScreenModel(spec: try collaborators(), context: context, api: api)
    await model.load()
    // One read for the people with an account: the invited row has no uid to ask about.
    XCTAssertEqual(transport.requests.last?.url?.path, "/api/ai/usage")
    XCTAssertEqual(transport.requests.last?.url?.query, "orgId=o1&hostId=h1&view=prepared&uids=u1%2Cu2")
    let columns = ListColumns.columns(of: try XCTUnwrap(model.spec.blocks.first))
    let rows = ScreenValues.rows(ScreenValues.lookup("data.members.items", in: model.context))
    let lines = rows.map { ListColumns.line(columns, shown: ["aiSiteCredits"], in: ScreenContext.with(model.context, item: $0)) }
    // A dash is the cell's "nothing to say": the row line leaves it out, as it does every column's.
    XCTAssertEqual(lines, ["AI credits (site, month) 1,234", "AI credits (site, month) 0", ""])
    XCTAssertEqual(ScreenValues.render(try XCTUnwrap(columns.first).value, in: ScreenContext.with(model.context, item: rows[2])), "\u{2014}")
  }

  @MainActor
  func testAReaderTheRouteRefusesSeesADash() async throws {
    ScreenCatalog.shared.add([try column()])
    let transport = RecordingTransport(responses: [
      (200, #"{"items":[{"uid":"u1","email":"a@x.test"}]}"#), (403, #"{"error":"billing.view required"}"#),
    ])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let context = try XCTUnwrap(JSONValue.decode(Data(#"{"org":{"id":"o1"},"site":{"id":"h1"}}"#.utf8)))
    let model = ScreenModel(spec: try collaborators(), context: context, api: api)
    await model.load()
    let columns = ListColumns.columns(of: try XCTUnwrap(model.spec.blocks.first))
    let row = try XCTUnwrap(ScreenValues.rows(ScreenValues.lookup("data.members.items", in: model.context)).first)
    XCTAssertEqual(ScreenValues.render(try XCTUnwrap(columns.first).value, in: ScreenContext.with(model.context, item: row)), "\u{2014}")
    XCTAssertEqual(ListColumns.line(columns, shown: ["aiSiteCredits"], in: ScreenContext.with(model.context, item: row)), "")
  }
}
