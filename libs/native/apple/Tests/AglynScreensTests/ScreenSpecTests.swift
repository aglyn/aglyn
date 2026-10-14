// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import Foundation
import XCTest

@testable import AglynScreens

/// The spec grammar replayed from libs/native/screens/template-cases.json
/// (the Kotlin renderer replays the same file), and every spec file checked.
final class ScreenSpecTests: XCTestCase {
  static let screensDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().appendingPathComponent("../../../screens").standardizedFileURL

  /// Every spec file in the repo: core's and each plugin's native spec.
  static var specFiles: [URL] {
    let core = (try? FileManager.default.contentsOfDirectory(at: screensDir, includingPropertiesForKeys: nil)) ?? []
    let plugins = screensDir.appendingPathComponent("../../plugins").standardizedFileURL
    let pluginDirs = (try? FileManager.default.contentsOfDirectory(at: plugins, includingPropertiesForKeys: nil)) ?? []
    let pluginSpecs = pluginDirs.flatMap { dir -> [URL] in
      let folder = dir.appendingPathComponent("src/android/screens")
      return (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
    }
    return (core + pluginSpecs).filter { $0.lastPathComponent.hasSuffix(".screens.json") }
  }

  func cases() throws -> JSONValue {
    let data = try Data(contentsOf: Self.screensDir.appendingPathComponent("template-cases.json"))
    return try XCTUnwrap(JSONValue.decode(data))
  }

  override func setUp() {
    ScreenValues.timeZone = TimeZone(identifier: "UTC")!
  }

  func testTemplateCases() throws {
    let file = try cases()
    let context = try XCTUnwrap(file["context"])
    for item in file["render"].array {
      XCTAssertEqual(
        ScreenValues.render(item["template"]?.stringValue ?? "", in: context), item["expect"]?.stringValue,
        item["template"]?.stringValue ?? "")
    }
    for item in file["url"].array {
      XCTAssertEqual(ScreenValues.renderURL(item["template"]?.stringValue ?? "", in: context), item["expect"]?.stringValue)
    }
    for item in file["resolve"].array {
      XCTAssertEqual(ScreenValues.resolve(item["template"]?.stringValue ?? "", in: context), item["expect"] ?? .null)
    }
    for item in file["body"].array {
      XCTAssertEqual(ScreenValues.resolveBody(item["body"] ?? .null, in: context), item["expect"])
    }
    for item in file["condition"].array {
      XCTAssertEqual(
        ScreenValues.condition(item["when"]?.stringValue, in: context), item["expect"] == .bool(true),
        item["when"]?.stringValue ?? "")
    }
  }

  func testEverySpecParsesAndPointsAtRealScreens() throws {
    let files = Self.specFiles
    XCTAssertFalse(files.isEmpty)
    var ids = Set<String>()
    var specs: [ScreenSpec] = []
    for url in files {
      let data = try Data(contentsOf: url)
      let json = try XCTUnwrap(JSONValue.decode(data), "\(url.lastPathComponent) is not JSON")
      let parsed = ScreenCatalog.parse(data)
      XCTAssertEqual(parsed.count, json["screens"].array.count, "\(url.lastPathComponent): a screen lacks id or title")
      for spec in parsed {
        XCTAssertTrue(ids.insert(spec.id).inserted, "duplicate screen id \(spec.id)")
        XCTAssertTrue(["org", "site", "account", "staff"].contains(spec.scope), "\(spec.id): scope \(spec.scope)")
        for link in spec.links { XCTAssertTrue(link.hasPrefix("/"), "\(spec.id): link \(link)") }
        let known = Set(["fields", "meters", "list", "form", "actions", "links", "notice", "zone", "image", "html"])
        for block in spec.blocks { XCTAssertTrue(known.contains(block.type), "\(spec.id): block \(block.type)") }
      }
      specs += parsed
    }
    // Every screen a spec opens or navigates to exists.
    for spec in specs {
      for target in Self.targets(spec.raw) {
        XCTAssertTrue(ids.contains(target), "\(spec.id) opens \(target), which no spec declares")
      }
    }
  }

  func testCoreRegistersAsAPluginNamedCore() throws {
    let registry = MainActor.assumeIsolated { NativePluginRegistry() }
    let result = MainActor.assumeIsolated { NativePluginLoader.load([CoreScreens.manifestEntry], into: registry) }
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(result.loaded, ["core"])
    MainActor.assumeIsolated {
      XCTAssertNotNil(registry.screen("core.team"))
      if case .screen(let screen, let params)? = registry.resolve("/acme/team/u9") {
        XCTAssertEqual(screen, "core.team.member")
        XCTAssertEqual(params["uid"], "u9")
      } else {
        XCTFail("/acme/team/u9 did not open the member")
      }
    }
  }

  func testTokenClaims() {
    let payload = Data(#"{"staff":true,"staffRole":"super","auth_time":1}"#.utf8).base64EncodedString()
      .replacingOccurrences(of: "=", with: "").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
    let claims = TokenClaims(idToken: "h.\(payload).s")
    XCTAssertTrue(claims.isStaff)
    XCTAssertTrue(claims.isSuper)
    XCTAssertEqual(TokenClaims(idToken: "x").staffRole, nil)
    let support = Data(#"{"staff":true}"#.utf8).base64EncodedString().replacingOccurrences(of: "=", with: "")
    XCTAssertEqual(TokenClaims(idToken: "h.\(support).s").staffRole, "support")
  }

  @MainActor
  func testRunPostsTheResolvedBodyAndFallsBackOn404() async throws {
    let transport = RecordingTransport(responses: [(404, #"{"error":"No account"}"#), (200, #"{"ok":true}"#)])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let spec = try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"]))
    let model = ScreenModel(spec: spec, context: ["org": ["id": "o1"], "form": ["email": "a@b.c"]], api: api)
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Add", "url": "/api/orgs/members", "body": ["orgId": "{org.id}", "email": "{form.email}"],
        "else": ["label": "Invite", "url": "/api/orgs/invites", "body": ["orgId": "{org.id}", "action": "create"]],
      ]))
    let outcome = await model.run(action, in: model.context)
    XCTAssertEqual(outcome, .done(message: nil, response: ["ok": true]))
    let sent = transport.requests
    XCTAssertEqual(sent.map { $0.url?.path }, ["/api/orgs/members", "/api/orgs/invites"])
    XCTAssertEqual(JSONValue.decode(sent[0].httpBody ?? Data()), ["orgId": "o1", "email": "a@b.c"])
  }

  /// An action's `headers` go out with the request, and `{attempt}` holds one key while the same
  /// request is sent again and takes a new one when the body changes (enterprise billing).
  @MainActor
  func testHeadersCarryAnAttemptKeyThatFollowsTheRequest() async throws {
    let transport = RecordingTransport(responses: [(503, "{}"), (200, "{}"), (200, "{}")])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: ["form": ["amount": "900"]], api: api)
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Provision", "url": "/api/admin/enterprise-billing", "body": ["amountMonthlyUsd": "{form.amount}"],
        "headers": ["Idempotency-Key": "{attempt}", "X-Staff": "yes"],
      ]))
    _ = await model.run(action, in: model.context)
    _ = await model.run(action, in: ["form": ["amount": "1200"]])
    let keys = transport.requests.map { $0.value(forHTTPHeaderField: "Idempotency-Key") }
    XCTAssertEqual(keys.count, 3)
    XCTAssertNotNil(keys[0])
    // The 503 was retried with the very same key, because a keyed write is safe to repeat.
    XCTAssertEqual(keys[0], keys[1])
    XCTAssertNotEqual(keys[1], keys[2])
    XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: "X-Staff"), "yes")
    _ = await model.run(action, in: model.context)
    XCTAssertEqual(transport.requests.last?.value(forHTTPHeaderField: "Idempotency-Key"), keys[0])
  }

  /// A route that wants its key in the body (the AI credit give-back) writes `{attempt}` there: the same press
  /// sends the same key, and a different reason is a different act with its own.
  @MainActor
  func testAttemptKeyFillsABodyToo() async throws {
    let transport = RecordingTransport(responses: [(200, "{}"), (200, "{}"), (200, "{}")])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api)
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Give back", "url": "/api/ai/admin/credits",
        "body": ["reason": "{form.reason}", "idempotencyKey": "{attempt}"],
      ]))
    _ = await model.run(action, in: ["form": ["reason": "planner fault"]])
    _ = await model.run(action, in: ["form": ["reason": "second look"]])
    _ = await model.run(action, in: ["form": ["reason": "planner fault"]])
    let keys = transport.requests.map { JSONValue.decode($0.httpBody ?? Data())?["idempotencyKey"]?.stringValue }
    XCTAssertEqual(keys.count, 3)
    XCTAssertEqual(keys[0]?.count, 36)
    XCTAssertNotEqual(keys[0], keys[1])
    XCTAssertEqual(keys[0], keys[2])
  }

  /// A paged job sends the cursor back until the route is done, adds the pages up, and reports lines.
  @MainActor
  func testLoopAddsPagesUpAndReportsLines() async throws {
    let transport = RecordingTransport(responses: [
      (200, #"{"planned":2,"drift":{"byCollection":{"a":1}},"nextCursor":"c1"}"#),
      (200, #"{"planned":3,"drift":{"byCollection":{"a":2,"b":1}},"nextCursor":null,"done":true}"#),
    ])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api)
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Scan", "url": "/api/admin/backfill-scope", "body": ["dryRun": true], "success": "Scanned",
        "loop": ["cursor": "nextCursor", "until": "done"],
        "report": [
          ["text": "{response.planned} planned"], ["text": "none", "when": "response.missing"],
          ["each": "response.drift.byCollection", "text": "{item.key}: {item.value}"],
        ],
      ]))
    let outcome = await model.run(action, in: model.context)
    XCTAssertEqual(outcome, .done(message: "Scanned\n5 planned\na: 3\nb: 1", response: outcome.response))
    XCTAssertEqual(outcome.response?["pages"], 2)
    XCTAssertEqual(outcome.response?["bounded"], false)
    XCTAssertEqual(JSONValue.decode(transport.requests[1].httpBody ?? Data()), ["dryRun": true, "cursor": "c1"])
  }

  /// A `when` on a repeated report line is read for each row: the give-back names the meters that moved credits
  /// and says nothing of the one that did not, and a repeat it already made says only that.
  @MainActor
  func testReportWhenIsReadForEachRow() async throws {
    let rows = #"{"duplicate":false,"lines":[{"meter":"workspace","credits":40},{"meter":"account","credits":0}]}"#
    let transport = RecordingTransport(responses: [(200, rows), (200, #"{"duplicate":true,"lines":[{"meter":"workspace","credits":40}]}"#)])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api)
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Give back", "url": "/api/ai/admin/credits", "body": ["action": "give"],
        "report": [
          ["text": "Already given back.", "when": "response.duplicate"],
          ["each": "response.lines", "when": "item.credits && !response.duplicate", "text": "Returned {item.credits:number} credits to the {item.meter}."],
        ],
      ]))
    guard case .done(let first, _) = await model.run(action, in: model.context) else { return XCTFail("expected done") }
    XCTAssertEqual(first, "Returned 40 credits to the workspace.")
    guard case .done(let message, _) = await model.run(action, in: model.context) else { return XCTFail("expected done") }
    XCTAssertEqual(message, "Already given back.")
  }

  /// The console's "Actions taken in this session": a lock or lift that reached the server leaves its lines, newest
  /// first (the lines of one act with the last listed on top), each verified or not, at most 25 of them.
  @MainActor
  func testActionsKeepASessionLog() async throws {
    let answer = #"{"confirmed":true,"logLines":[{"text":"Locked org o1","confirmed":true},{"text":"Billing cancel NOT confirmed","confirmed":false}]}"#
    let transport = RecordingTransport(responses: Array(repeating: (200, answer), count: 14) + [(500, #"{"error":"no"}"#)])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api)
    XCTAssertEqual(ScreenValues.lookup("session.log", in: model.context).array.count, 0)
    let lock = try XCTUnwrap(
      ActionSpec([
        "label": "Lock", "url": "/api/admin/lockdown", "log": [["each": "response.logLines", "text": "{item.text}", "confirmed": "item.confirmed"]],
      ]))
    _ = await model.run(lock, in: model.context)
    let first = ScreenValues.lookup("session.log", in: model.context).array
    // The last line of the act is on top, as the console prepends them.
    XCTAssertEqual(first.map { ScreenValues.text($0["text"] ?? .null) }, ["Billing cancel NOT confirmed", "Locked org o1"])
    XCTAssertEqual(first.map { $0["confirmed"] }, [.bool(false), .bool(true)])
    XCTAssertNotNil(first.first?["at"]?.numberValue)
    for _ in 0..<13 { _ = await model.run(lock, in: model.context) }
    XCTAssertEqual(model.journal.count, ScreenModel.journalLimit)
    // A refusal leaves nothing in the log: a click that did not reach the server is a line that never appears.
    _ = await model.run(lock, in: model.context)
    XCTAssertEqual(model.journal.count, ScreenModel.journalLimit)
    XCTAssertEqual(ScreenValues.text(model.journal.first?["text"] ?? .null), "Billing cancel NOT confirmed")
  }

  /// The abuse and counter-notice pages keep the console's "Changes made in this session", in its words: the report and the
  /// status, and for a counter-notice what happened to the site's clock.
  @MainActor
  func testAbuseDecisionsLeaveTheConsolesSessionLines() async throws {
    let transport = RecordingTransport(responses: [
      (200, #"{"confirmed":true}"#),
      (200, #"{"confirmed":true,"scheduling":"scheduled","counterNotice":{"restoreAtMs":1760000000000}}"#),
      (200, #"{"confirmed":false,"scheduling":"notSuspended"}"#),
      (200, #"{"confirmed":true,"scheduling":"noClock"}"#),
    ])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    func action(_ screen: String, _ id: String) throws -> ActionSpec {
      let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == screen })
      let actions = spec.blocks.filter { $0.type == "actions" }.flatMap { $0["items"].array.compactMap(ActionSpec.init) }
      return try XCTUnwrap(actions.first { $0.id == id })
    }

    let reportSpec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.staff.abuseReport" })
    let report = ScreenModel(
      spec: reportSpec, context: ["params": ["reportId": "r1"], "data": ["report": ["report": ["reference": "AR-1"]]]], api: api)
    _ = await report.run(try action("core.staff.abuseReport", "actioned"), in: report.context)
    XCTAssertEqual(report.journal.map { ScreenValues.text($0["text"] ?? .null) }, ["AR-1 → actioned"])
    XCTAssertEqual(report.journal.first?["confirmed"], .bool(true))

    let noticeSpec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.staff.counterNotice" })
    let notice = ScreenModel(
      spec: noticeSpec,
      context: ["params": ["noticeId": "n1"], "data": ["notice": ["counterNotices": [["id": "n1", "reference": "CN-7"]]]]], api: api)
    _ = await notice.run(try action("core.staff.counterNotice", "forwarded"), in: notice.context)
    let scheduled = ScreenValues.text(notice.journal.first?["text"] ?? .null)
    XCTAssertTrue(scheduled.hasPrefix("CN-7 → forwarded — restoration scheduled for "), scheduled)
    XCTAssertGreaterThan(scheduled.count, "CN-7 → forwarded — restoration scheduled for ".count)
    _ = await notice.run(try action("core.staff.counterNotice", "withdrawn"), in: notice.context)
    XCTAssertEqual(
      ScreenValues.text(notice.journal.first?["text"] ?? .null), "CN-7 → withdrawn — the site was NOT suspended, so nothing was scheduled")
    XCTAssertEqual(notice.journal.first?["confirmed"], .bool(false))
    // No clock to set says nothing more than the step.
    _ = await notice.run(try action("core.staff.counterNotice", "rejected"), in: notice.context)
    XCTAssertEqual(ScreenValues.text(notice.journal.first?["text"] ?? .null), "CN-7 → rejected")
    XCTAssertEqual(notice.journal.count, 3)
  }

  /// A guarded run waits for a preview that was read: the preview arms a key, a failed preview takes it back, and the
  /// run spends it (the console's maintenance cards).
  @MainActor
  func testAPreviewArmsTheRunAndTheRunSpendsIt() async throws {
    let transport = RecordingTransport(responses: [(200, "{}"), (500, #"{"error":"down"}"#), (200, "{}"), (200, "{}")])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api)
    let preview = try XCTUnwrap(ActionSpec(["label": "Preview", "method": "GET", "url": "/api/admin/audit-archive", "arm": "auditArchive"]))
    let run = try XCTUnwrap(ActionSpec(["label": "Run", "url": "/api/admin/audit-archive", "disarm": "auditArchive"]))
    func armed() -> Bool { ScreenValues.condition("session.armed.auditArchive", in: model.context) }
    XCTAssertFalse(armed())
    _ = await model.run(preview, in: model.context)
    XCTAssertTrue(armed())
    // The next preview fails: nothing was read, so the run is locked again.
    _ = await model.run(preview, in: model.context)
    XCTAssertFalse(armed())
    _ = await model.run(preview, in: model.context)
    XCTAssertTrue(armed())
    _ = await model.run(run, in: model.context)
    XCTAssertFalse(armed())
  }

  /// A country field offers the platform's own region list in the person's language, by name.
  func testCountryFieldOffersThePlatformsRegions() throws {
    let choices = ScreenRegions.choices(locale: Locale(identifier: "en_US"))
    let codes = choices.map(\.value)
    for known in ["US", "CA", "GB", "DE", "JP", "AU", "MX"] { XCTAssertTrue(codes.contains(known), known) }
    XCTAssertEqual(choices.first { $0.value == "US" }?.label, "United States")
    XCTAssertFalse(codes.contains("ZZ"))
    XCTAssertFalse(codes.contains("EU"))
    XCTAssertGreaterThan(choices.count, 200)
    // By name in the locale's order, and each code once.
    let labels = choices.map(\.label)
    XCTAssertEqual(
      labels, labels.sorted { $0.compare($1, options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US")) == .orderedAscending })
    XCTAssertEqual(Set(codes).count, codes.count)
    let field = try XCTUnwrap(FieldSpec(["key": "country", "label": "Country", "kind": "country", "options": [["value": "", "label": "Choose a country"]]]))
    XCTAssertEqual(field.choices(in: [:]).first?.label, "Choose a country")
    XCTAssertTrue(field.choices(in: [:]).contains { $0.value == "US" })
  }

  private func orgsListSpec() throws -> ScreenSpec {
    try XCTUnwrap(
      ScreenSpec([
        "id": "core.x", "title": "X",
        "load": ["orgs": ["url": "/api/admin/orgs?pageSize=50", "sortParam": "sort", "sortDefault": "createdAt:desc"]],
        "blocks": [
          [
            "type": "list", "load": "orgs", "items": "data.orgs.orgs", "columnsZone": "testOrgsListColumn",
            "columns": [
              ["id": "name", "label": "Organization", "always": true, "sort": ["route": "nameLower"]],
              ["id": "plan", "label": "Plan", "value": "{item.plan:title}", "sort": ["page": "item.plan"]],
              ["id": "limit", "label": "Site limit", "value": "{item.limit}", "sort": ["page": "item.rank", "type": "number", "first": "desc"]],
              ["id": "created", "label": "Created", "value": "{item.created}", "sort": ["route": "createdAt", "first": "desc"]],
              ["id": "owner", "label": "Owner", "value": "{item.owner}", "show": false],
            ],
          ]
        ],
      ]))
  }

  /// A list's route columns ask the route in their order over every row, and the route's own default order goes
  /// when nothing was asked (the Workspaces list's header sorts).
  @MainActor
  func testARouteColumnAsksTheRouteAgainInThatOrder() async throws {
    let transport = RecordingTransport(responses: [(200, #"{"orgs":[]}"#), (200, #"{"orgs":[]}"#), (200, #"{"orgs":[]}"#)])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let model = ScreenModel(spec: try orgsListSpec(), context: [:], api: api)
    await model.load()
    XCTAssertEqual(transport.requests.last?.url?.query, "pageSize=50&sort=createdAt%3Adesc")
    await model.ask(ListOrder(column: "name", descending: true), of: "orgs", routed: true)
    XCTAssertEqual(transport.requests.last?.url?.query, "pageSize=50&sort=nameLower%3Adesc")
    // A page column asks nothing of the route.
    let before = transport.requests.count
    await model.ask(ListOrder(column: "plan", descending: false), of: "orgs", routed: false)
    XCTAssertEqual(transport.requests.count, before)
    // The default order comes back with no choice.
    await model.ask(nil, of: "orgs", routed: true)
    XCTAssertEqual(transport.requests.last?.url?.query, "pageSize=50&sort=createdAt%3Adesc")
  }

  /// A tap on a header asks for the column's first order, the second for the other, the third for the default again.
  @MainActor
  func testTappingAColumnCyclesItsOrder() throws {
    let block = try XCTUnwrap(try orgsListSpec().blocks.first)
    let columns = ListColumns.columns(of: block)
    let created = try XCTUnwrap(columns.first { $0.id == "created" })
    let plan = try XCTUnwrap(columns.first { $0.id == "plan" })
    var order = ListColumns.next(after: nil, tapping: created)
    XCTAssertEqual(order, ListOrder(column: "created", descending: true))
    order = ListColumns.next(after: order, tapping: created)
    XCTAssertEqual(order, ListOrder(column: "created", descending: false))
    XCTAssertNil(ListColumns.next(after: order, tapping: created))
    // Another column starts from its own first order.
    XCTAssertEqual(ListColumns.next(after: order, tapping: plan), ListOrder(column: "plan", descending: false))
    XCTAssertEqual(ListColumns.routeValue(ListOrder(column: "created", descending: true), columns: columns), "createdAt:desc")
    XCTAssertNil(ListColumns.routeValue(ListOrder(column: "plan", descending: false), columns: columns))
  }

  /// A page column orders the rows on the screen: numbers as numbers, text without regard to case, dates as moments; a row
  /// without the value goes last whichever way it is read, and equal rows keep the order they came in.
  @MainActor
  func testPageColumnsOrderRowsAndPutMissingLast() throws {
    let block = try XCTUnwrap(try orgsListSpec().blocks.first)
    let columns = ListColumns.columns(of: block)
    let rows: [JSONValue] = [
      ["id": "a", "plan": "pro", "rank": 10], ["id": "b", "plan": "Free", "rank": 9], ["id": "c", "plan": nil, "rank": nil],
      ["id": "d", "plan": "business", "rank": 100], ["id": "e", "plan": "pro", "rank": 10],
    ]
    func ids(_ column: String, descending: Bool) -> [String] {
      let chosen = columns.first { $0.id == column }!
      return ListColumns.sorted(rows, by: chosen, descending: descending, in: [:]).map { ScreenValues.text($0["id"] ?? .null) }
    }
    XCTAssertEqual(ids("plan", descending: false), ["d", "b", "a", "e", "c"])
    XCTAssertEqual(ids("plan", descending: true), ["a", "e", "b", "d", "c"])
    // 100 is more than 9: a number, not text.
    XCTAssertEqual(ids("limit", descending: false), ["b", "a", "e", "d", "c"])
    XCTAssertEqual(ids("limit", descending: true), ["d", "a", "e", "b", "c"])
  }

  /// A row shows the columns the person picked as one line, without the ones it has nothing for.
  @MainActor
  func testAListLineHoldsThePickedColumnsWithValues() throws {
    let block = try XCTUnwrap(try orgsListSpec().blocks.first)
    let columns = ListColumns.columns(of: block)
    let model = ScreenModel(spec: try orgsListSpec(), context: [:], api: nil)
    let defaults = model.shownColumns(of: "orgs", in: columns)
    // The shared catalog may hold a plugin column from another test, so this names what must be there, not all of it.
    XCTAssertTrue(defaults.isSuperset(of: ["name", "plan", "limit", "created"]))
    XCTAssertFalse(defaults.contains("owner"))
    let scope: JSONValue = ["item": ["plan": "pro", "limit": "5", "created": "", "owner": "u1"]]
    // The owner column is off by default, the empty Created is skipped, and the row's own name is not repeated.
    XCTAssertEqual(ListColumns.line(columns, shown: ["name", "plan", "limit", "created"], in: scope), "Plan Pro \u{00b7} Site limit 5")
    model.shown["orgs"] = ["plan", "limit", "created", "owner"]
    XCTAssertEqual(ListColumns.line(columns, shown: model.shownColumns(of: "orgs", in: columns), in: scope), "Plan Pro \u{00b7} Site limit 5 \u{00b7} Owner u1")
  }

  /// A column a plugin contributes to a list is read for the rows on the screen, in batches, and its answers join under
  /// `column.<id>` for its cells and its sort (the AI plugin's spend on the Workspaces list).
  @MainActor
  func testAPluginColumnIsReadForTheRowsOnScreenInBatches() async throws {
    ScreenCatalog.shared.add([
      try XCTUnwrap(
        ScreenSpec([
          "id": "test.spendColumn", "title": "Spend", "scope": "staff", "zones": ["testOrgsListColumn"],
          "column": [
            "id": "spend", "label": "Spend", "value": "{column.spend.cells[@item.id]|'\u{2014}'}",
            "sort": ["page": "column.spend.sort[@item.id]", "type": "number", "first": "desc"],
            "load": ["url": "/api/x/spend?orgIds={ids}", "ids": "{item.id}", "max": 2],
          ],
        ]))
    ])
    let transport = RecordingTransport(responses: [
      (200, #"{"orgs":[{"id":"o1"},{"id":"o2"},{"id":"o3"}]}"#),
      (200, #"{"cells":{"o1":"$1.0000","o2":"$0.5000"},"sort":{"o1":1,"o2":0.5}}"#),
      (200, #"{"cells":{"o3":"\u2014"},"sort":{"o3":null}}"#),
    ])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let model = ScreenModel(spec: try orgsListSpec(), context: [:], api: api)
    await model.load()
    // One read of the list, then the column's two batches of two ids and one.
    XCTAssertEqual(transport.requests.compactMap { $0.url?.query }.suffix(2), ["orgIds=o1%2Co2", "orgIds=o3"])
    XCTAssertEqual(ScreenValues.lookup("column.spend.cells.o2", in: model.context), "$0.5000")
    XCTAssertEqual(ScreenValues.lookup("column.spend.sort.o1", in: model.context), 1)
    let block = try XCTUnwrap(model.spec.blocks.first)
    let columns = ListColumns.columns(of: block)
    XCTAssertEqual(columns.last?.id, "spend")
    let spend = try XCTUnwrap(columns.last)
    let rows = ScreenValues.rows(ScreenValues.lookup("data.orgs.orgs", in: model.context))
    // Dearest first, the unmeasured last in both directions.
    let down = ListColumns.sorted(rows, by: spend, descending: true, in: model.context).map { ScreenValues.text($0["id"] ?? .null) }
    let up = ListColumns.sorted(rows, by: spend, descending: false, in: model.context).map { ScreenValues.text($0["id"] ?? .null) }
    XCTAssertEqual(down, ["o1", "o2", "o3"])
    XCTAssertEqual(up, ["o2", "o1", "o3"])
    XCTAssertEqual(ListColumns.line(columns, shown: ["spend"], in: ScreenContext.with(model.context, item: rows[0])), "Spend $1.0000")
  }

  /// The staff routes mint a custom token for a support session; the action names where in the answer it and its identity
  /// pool are, and an answer without a token opens nothing.
  func testAnImpersonateActionReadsTheTokenAndPoolFromTheAnswer() throws {
    let action = try XCTUnwrap(
      ActionSpec(["label": "Sign in as this customer", "url": "/api/admin/impersonate", "impersonate": ["token": "token", "tenantId": "tenantId"]]))
    let spec = try XCTUnwrap(action.impersonate)
    let answered = spec.resolve(in: ["token": "custom-token", "tenantId": "tenant-9"])
    XCTAssertEqual(answered?.token, "custom-token")
    XCTAssertEqual(answered?.tenantId, "tenant-9")
    // An account in the project's own pool has no tenant.
    let plain = spec.resolve(in: ["token": "custom-token", "tenantId": .null])
    XCTAssertEqual(plain?.token, "custom-token")
    XCTAssertNil(plain?.tenantId)
    XCTAssertNil(spec.resolve(in: ["tenantId": "tenant-9"]))
    XCTAssertNil(spec.resolve(in: ["token": ""]))
    XCTAssertNil(spec.resolve(in: nil))
    XCTAssertNil(ActionSpec(["label": "Plain", "url": "/x"])?.impersonate)
  }

  /// Person and Workspace both offer the sign-in the console does, asking the reason the route insists on.
  @MainActor
  func testThePersonAndWorkspaceScreensOfferASupportSession() async throws {
    func offered(_ id: String) throws -> ActionSpec {
      let screen = try XCTUnwrap(CoreScreens.specs.first { $0.id == id })
      let actions = screen.blocks.filter { $0.type == "actions" }.flatMap { $0["items"].array.compactMap(ActionSpec.init) }
      return try XCTUnwrap(actions.first { $0.impersonate != nil })
    }
    let person = try offered("core.staff.user")
    let workspace = try offered("core.staff.org")
    for (action, uid) in [(person, "{params.uid}"), (workspace, "{data.detail.org.ownerUid}")] {
      XCTAssertEqual(action.url, "/api/admin/impersonate")
      let reason = try XCTUnwrap(action.prompt.first { $0.key == "reason" })
      XCTAssertTrue(reason.required)
      XCTAssertEqual(action.body?["uid"]?.stringValue, uid)
      XCTAssertEqual(action.body?["reason"]?.stringValue, "{form.reason}")
      XCTAssertFalse(action.reason, "the reason is asked once, by the prompt")
    }

    let transport = RecordingTransport(responses: [(200, #"{"token":"custom-token","tenantId":null}"#)])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let screen = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.staff.user" })
    let model = ScreenModel(spec: screen, context: ["params": ["uid": "u1"]], api: api)
    // The route's own minimum is the one the prompt tells the person about.
    let min = try XCTUnwrap(model.context["const"]?["impersonation"]?["minReason"]).numberValue
    XCTAssertGreaterThan(min ?? 0, 1)
    XCTAssertEqual(
      ScreenValues.render(person.prompt[0].help ?? "", in: model.context),
      "At least \(Int(min ?? 0)) characters. Write what you are reproducing, or the ticket it serves.")
    let outcome = await model.run(person, in: ["params": ["uid": "u1"], "form": ["reason": "ticket 481: billing page"]])
    guard case .done(_, let response) = outcome else { return XCTFail("expected done, got \(outcome)") }
    XCTAssertEqual(transport.requests.map { $0.url?.path }, ["/api/admin/impersonate"])
    XCTAssertEqual(JSONValue.decode(transport.requests[0].httpBody ?? Data()), ["uid": "u1", "reason": "ticket 481: billing page"])
    let resolved = try XCTUnwrap(person.impersonate?.resolve(in: response))
    XCTAssertEqual(resolved.token, "custom-token")
    XCTAssertNil(resolved.tenantId)
  }

  /// A probe that answers 503 is reporting: its body is the answer.
  @MainActor
  func testLoadAcceptsTheStatusAProbeReportsWith() async throws {
    let transport = RecordingTransport(responses: Array(repeating: (503, #"{"status":"degraded","checks":{"a":{"ok":false}}}"#), count: 3))
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let spec = try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X", "load": ["probe": ["url": "/api/health/crons", "accept": [503]]]]))
    let model = ScreenModel(spec: spec, context: ["data": [:]], api: api)
    await model.load()
    XCTAssertEqual(model.phase, .ready)
    XCTAssertEqual(ScreenValues.lookup("data.probe.status", in: model.context), "degraded")
  }

  /// A staff list load names its filters; a clause with nothing to filter on is left out.
  @MainActor
  func testLoadFiltersGoInTheQueryOnlyWhenFilled() throws {
    let spec = try XCTUnwrap(
      ScreenSpec([
        "id": "core.x", "title": "X",
        "load": ["rows": ["url": "/api/x?pageSize=50", "filters": [
          ["field": "status", "op": "equals", "value": "{params.status}"], ["field": "category", "value": "{params.category}"],
        ]]],
      ]))
    let model = ScreenModel(spec: spec, context: ["params": ["status": "open", "category": ""]], api: nil)
    let load = try XCTUnwrap(spec.loads.first)
    XCTAssertEqual(
      model.url(for: load), "/api/x?pageSize=50&filters=%5B%7B%22field%22%3A%22status%22%2C%22op%22%3A%22equals%22%2C%22value%22%3A%22open%22%7D%5D")
    let bare = ScreenModel(spec: spec, context: ["params": [:]], api: nil)
    XCTAssertEqual(bare.url(for: load), "/api/x?pageSize=50")
  }

  /// A `late` load reads what the others found, and a query can ask for the server's count of what it matches.
  @MainActor
  func testALateLoadReadsTheAnswersOfTheOthersAndACountIsAskedOfTheServer() async throws {
    let reader = CountingReader()
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: RecordingTransport(responses: []))
    let spec = try XCTUnwrap(
      ScreenSpec([
        "id": "core.x", "title": "X",
        "load": [
          "host": ["doc": "hosts/{params.hostId}"],
          "media": ["late": true, "query": ["collection": "orgs/{data.host.orgId}/media", "count": true]],
          "members": ["late": true, "query": ["collection": "orgs/{data.host.orgId}/members", "where": [["role", "==", "owner"]], "count": true]],
          // A late load's own condition reads the answers too: this one is for a site with no workspace.
          "orphan": ["late": true, "when": "!data.host.orgId", "query": ["collection": "hosts/{params.hostId}/media", "count": true]],
        ],
      ]))
    let model = ScreenModel(spec: spec, context: ["params": ["hostId": "h1"], "data": [:]], api: api, reader: reader)
    await model.load()
    XCTAssertEqual(model.phase, .ready)
    XCTAssertEqual(ScreenValues.lookup("data.media.count", in: model.context), 42)
    XCTAssertEqual(ScreenValues.lookup("data.host.orgId", in: model.context), "o9")
    XCTAssertEqual(reader.counted.sorted(), ["orgs/o9/media", "orgs/o9/members"])
    XCTAssertEqual(reader.equalities, ["role"])
  }

  /// A refusal says what the route says, then its `failure` lines over the route's answer.
  @MainActor
  func testARefusalIsExplainedFromTheRoutesAnswer() async throws {
    let transport = RecordingTransport(responses: [
      (409, #"{"error":"This person owns workspaces","blockers":[{"orgName":"Acme","otherMembers":2},{"orgName":"Beta","otherMembers":0}]}"#)
    ])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api)
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Erase", "url": "/api/admin/users/manage",
        "failure": [["each": "response.blockers", "text": "{item.orgName}: {item.otherMembers} other members"], ["text": "none", "when": "response.shared"]],
      ]))
    let outcome = await model.run(action, in: model.context)
    XCTAssertEqual(outcome, .failed("This person owns workspaces\nAcme: 2 other members\nBeta: 0 other members"))
  }

  /// An action can hand text to the device as a file: the name is a template, the text a path over the context.
  func testAnActionCanHandTextToTheDeviceAsAFile() throws {
    let action = try XCTUnwrap(
      ActionSpec(["label": "Export", "url": "/api/x", "file": ["name": "{data.view.filename}", "type": "text/csv", "from": "response.csv"]]))
    let file = try XCTUnwrap(action.file)
    XCTAssertEqual(file.type, "text/csv")
    let made = file.contents(in: ["data": ["view": ["filename": "US-TX-2026-Q3.csv"]], "response": ["csv": "a,b\n1,2"]])
    XCTAssertEqual(made?.name, "US-TX-2026-Q3.csv")
    XCTAssertEqual(made?.text, "a,b\n1,2")
    XCTAssertNil(file.contents(in: ["response": ["csv": ""]]))
    XCTAssertNil(try XCTUnwrap(ActionSpec(["label": "Go", "url": "/api/x"])).file)
  }

  /// A field can fill itself with a random value from an alphabet; `pairs` prints a map's keys as they are.
  func testAGeneratedValueIsTheLengthAskedFromTheAlphabet() {
    let alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    let first = ScreenValues.generated(length: 20, alphabet: alphabet)
    XCTAssertEqual(first.count, 20)
    XCTAssertTrue(first.allSatisfy { alphabet.contains($0) })
    XCTAssertNotEqual(first, ScreenValues.generated(length: 20, alphabet: alphabet))
    XCTAssertEqual(ScreenValues.generated(length: 5, alphabet: ""), "")
    XCTAssertEqual(ScreenValues.render("{h:pairs}", in: ["h": ["Ab1xY": "editor", "z9": "viewer"]]), "Ab1xY: editor, z9: viewer")
    // A spec names the console's own length and alphabet as constants.
    let field = FieldSpec(["key": "password", "kind": "text", "generate": ["length": "{const.n}", "alphabet": "{const.a}"]])
    let made = field?.generatedValue(in: ["const": ["n": 12, "a": "ab"]])
    XCTAssertEqual(made?.count, 12)
    XCTAssertTrue(made?.allSatisfy { "ab".contains($0) } ?? false)
    XCTAssertNil(FieldSpec(["key": "name"])?.generatedValue(in: [:]))
  }

  /// A GET action can carry the same staff list `filters` a load does, so an export covers what the list shows.
  @MainActor
  func testAnActionCarriesFiltersLikeALoad() async throws {
    let transport = RecordingTransport(responses: [(200, #"{"csv":"a"}"#)])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: ["params": ["scope": "org", "from": ""]], api: api)
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Export", "method": "GET", "url": "/api/admin/audit-log?view=csv",
        "filters": [["field": "scope", "op": "equals", "value": "{params.scope}"], ["field": "at", "op": "onOrAfter", "value": "{params.from}"]],
      ]))
    _ = await model.run(action, in: model.context)
    XCTAssertTrue((transport.requests[0].url?.absoluteString ?? "").contains("view=csv&filters="))
    XCTAssertTrue((transport.requests[0].url?.absoluteString ?? "").contains("filters="))
    XCTAssertFalse((transport.requests[0].url?.absoluteString ?? "").contains("onOrAfter"))
  }

  /// A prompt field with `each` is one field per row of a list, and `$collect` gathers what was typed.
  func testAPromptFieldCanRepeatForEveryRowOfAList() throws {
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Test", "url": "/api/x",
        "prompt": [
          ["key": "to", "kind": "email"],
          ["each": "const.tokens", "key": "token.{item.name}", "label": "{item.name}", "help": "{item.description}", "initial": "{item.sample}"],
        ],
        "body": ["to": "{form.to}", "mergeValues": ["$collect": ["prefix": "token."]]],
      ]))
    let scope: JSONValue = [
      "const": ["tokens": [["name": "org.name", "description": "The workspace", "sample": "Acme {x}"], ["name": "link", "description": "", "sample": ""]]]
    ]
    let inputs = action.inputs(in: scope)
    XCTAssertEqual(inputs.map(\.key), ["to", "token.org.name", "token.link"])
    XCTAssertEqual(inputs[1].label, "org.name")
    XCTAssertEqual(inputs[1].help, "The workspace")
    // A brace in a sample is text, not a template.
    XCTAssertEqual(ScreenValues.render(inputs[1].initial ?? "", in: [:]), "Acme {x}")
    let sent = ScreenValues.resolveBody(
      action.body ?? .null, in: ["form": ["to": "a@b.c", "token.org.name": "Acme", "token.link": ""]])
    XCTAssertEqual(sent, ["to": "a@b.c", "mergeValues": ["org.name": "Acme"]])
    XCTAssertEqual(try XCTUnwrap(ActionSpec(["label": "Go", "url": "/api/x", "reason": true])).inputs(in: [:]).map(\.key), ["reason"])
  }

  /// A list can be ordered by a field of its rows: numbers as numbers, anything else as text, rows without it last.
  func testSortOrdersByAFieldWithNumbersAsNumbersAndKeepsTiesInOrder() {
    let rows: [JSONValue] = [["key": "a", "value": 9], ["key": "b", "value": 10], ["key": "c"], ["key": "d", "value": 10], ["key": "E", "value": 2]]
    func keys(_ sort: String) -> [String] { ScreenValues.sorted(rows, by: sort).map { ScreenValues.text($0["key"]) } }
    XCTAssertEqual(keys("value desc"), ["b", "d", "a", "E", "c"])
    XCTAssertEqual(keys("value"), ["E", "a", "b", "d", "c"])
    XCTAssertEqual(keys("key"), ["a", "b", "c", "d", "E"])
    XCTAssertEqual(keys(""), ["a", "b", "c", "d", "E"])
  }

  /// A list can walk down into the lists inside its rows; each row found knows the row it came from.
  func testFlattenWalksDownAndKeepsTheParent() {
    let sources: [JSONValue] = [
      ["id": "s1", "tables": [["heading": "By plugin", "rows": [["name": "A"], ["name": "B"]]], ["heading": "By shop", "rows": [["name": "C"]]]]],
      ["id": "s2", "tables": [["heading": "Other", "rows": []]]],
    ]
    let rows = ScreenValues.flatten(sources, through: "tables.rows")
    XCTAssertEqual(rows.map { ScreenValues.text($0["name"]) }, ["A", "B", "C"])
    XCTAssertEqual(ScreenValues.text(ScreenValues.lookup("item.$parent.heading", in: ScreenContext.with([:], item: rows[2]))), "By shop")
    XCTAssertEqual(ScreenValues.text(ScreenValues.lookup("item.$parent.$parent.id", in: ScreenContext.with([:], item: rows[0]))), "s1")
    XCTAssertEqual(ScreenValues.flatten(sources, through: "tables").count, 3)
  }

  @MainActor
  func testAnActionCanShowTheRoutesAnswerInsteadOfItsSuccessMessage() throws {
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Report", "url": "/api/issue-reports", "success": "Filed",
        "instead": ["when": "response.deflected", "title": "Already answered", "text": "{response.sections.0.title}: {response.sections.0.text}"],
      ]))
    let instead = try XCTUnwrap(action.instead)
    let answered: JSONValue = ["response": ["deflected": true, "sections": [["title": "Domains", "text": "Point a CNAME."]]]]
    XCTAssertTrue(ScreenValues.condition(instead["when"]?.stringValue, in: answered))
    XCTAssertEqual(ScreenValues.render(instead["text"]?.stringValue ?? "", in: answered), "Domains: Point a CNAME.")
    XCTAssertFalse(ScreenValues.condition(instead["when"]?.stringValue, in: ["response": ["ok": true]]))
  }

  @MainActor
  func testTheReportFormShowsOnlyTheFieldsOfItsKind() throws {
    let support = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.support" })
    let block = try XCTUnwrap(support.blocks.first { $0.title == "Report an issue" })
    let action = try XCTUnwrap(block["items"].array.first.flatMap(ActionSpec.init))
    func asked(_ kind: String) -> [String] {
      let form: JSONValue = ["form": ["kind": .string(kind)]]
      return action.prompt.filter { ScreenValues.condition($0.when, in: form) }.map(\.key)
    }
    XCTAssertEqual(asked("bug"), ["kind", "summary", "steps", "expected", "actual", "frequency", "contactConsent"])
    XCTAssertEqual(asked("idea"), ["kind", "summary", "problem", "workaround", "proposal", "contactConsent"])
    XCTAssertEqual(asked("question"), ["kind", "summary", "question", "tried", "skipDeflection", "contactConsent"])
  }

  @MainActor
  func testTheAddOnConfirmationReadsThePreviewAndBankAnswersReplaceTheSuccessMessage() throws {
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.billing.addons" })
    let list = try XCTUnwrap(spec.blocks.first { $0.type == "list" })
    let set = try XCTUnwrap(list["actions"].array.first.flatMap(ActionSpec.init))
    XCTAssertNotNil(set.check)
    XCTAssertTrue(set.asksConfirmation)
    let base: JSONValue = [
      "data": ["addons": ["interval": "month", "catalog": ["hosts": ["unitUsd": 5]]]],
      "item": ["kind": "hosts", "label": "Extra sites"],
    ]
    let now = ScreenContext.with(
      ScreenContext.with(base, "form", ["quantity": 3]), "preview",
      ["chargedNowCents": 1250, "currency": "usd", "taxCents": 100, "taxComplete": true])
    XCTAssertEqual(
      set.confirmText(in: now),
      "Extra sites: 3? $12.50 will be charged to your card now, prorated for the rest of this period, including tax. Ongoing: 3 at $5.00/mo each.")
    let later = ScreenContext.with(
      ScreenContext.with(base, "form", ["quantity": 0]), "preview",
      ["defersToPeriodEnd": true, "effectiveAt": "2026-11-01T00:00:00Z", "currency": "usd"])
    XCTAssertEqual(
      set.confirmText(in: later),
      "Extra sites: 0? Nothing is charged and nothing is refunded. You keep this capacity for the rest of the period you have paid for, and it ends on Nov 1, 2026. From then: nothing, this add-on is removed.")
    // The bank asking for confirmation opens the invoice; a decline says so; success shows the message.
    let bank = ScreenContext.with(base, "response", ["paymentPending": true, "requiresAction": true, "hostedInvoiceUrl": "https://invoice.test/i"])
    XCTAssertEqual(set.insteadEntry(in: bank)?["open"]?.stringValue, "hostedInvoiceUrl")
    let declined = ScreenContext.with(base, "response", ["paymentPending": true, "declined": true])
    XCTAssertEqual(set.insteadEntry(in: declined)?["title"]?.stringValue, "Card declined")
    XCTAssertNil(set.insteadEntry(in: ScreenContext.with(base, "response", ["ok": true, "quantities": ["hosts": 3]])))
  }

  @MainActor
  func testReauthAnswerAsksForThePassword() async throws {
    let transport = RecordingTransport(responses: [(403, #"{"error":"reauth-required","message":"Confirm it is you"}"#)])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api)
    let outcome = await model.run(try XCTUnwrap(ActionSpec(["label": "Close", "url": "/api/account/close"])), in: [:])
    guard case .needsReauth = outcome else { return XCTFail("expected a reauth, got \(outcome)") }
  }

  @MainActor
  func testLoadsPageThroughCursors() async throws {
    let transport = RecordingTransport(responses: [
      (200, #"{"rows":[{"$id":"a"}],"nextCursor":"a"}"#), (200, #"{"rows":[{"$id":"b"}],"nextCursor":null}"#),
    ])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let spec = try XCTUnwrap(
      ScreenSpec([
        "id": "core.x", "title": "X",
        "load": ["list": ["url": "/api/x?orgId={org.id}", "cursor": "nextCursor", "items": "rows"]],
      ]))
    let model = ScreenModel(spec: spec, context: ["org": ["id": "o 1"], "data": [:]], api: api)
    await model.load()
    XCTAssertEqual(model.phase, .ready)
    XCTAssertEqual(model.cursors["list"], "a")
    await model.loadMore("list")
    XCTAssertEqual(ScreenValues.lookup("data.list.rows", in: model.context).array.count, 2)
    XCTAssertNil(model.cursors["list"])
    XCTAssertEqual(transport.requests.last?.url?.query, "orgId=o%201&cursor=a")
  }

  static func targets(_ json: JSONValue) -> [String] {
    switch json {
    case .object(let record):
      var found: [String] = []
      for (key, value) in record {
        if key == "screen", let id = value.stringValue { found.append(id) }
        found += targets(value)
      }
      return found
    case .array(let items): return items.flatMap(targets)
    default: return []
    }
  }
}

/// A reader that holds one site document and counts whatever it is asked to (loads run in parallel, so it locks).
final class CountingReader: FirestoreReader, @unchecked Sendable {
  private let lock = NSLock()
  private var countedPaths: [String] = []
  private var equalityFields: [String] = []
  var counted: [String] { lock.withLock { countedPaths } }
  var equalities: [String] { lock.withLock { equalityFields } }

  @MainActor
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
    onChange(.success([]))
    return NoListener()
  }

  @MainActor
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
    onChange(.success(FirestoreDocument(id: path.last ?? "", data: ["orgId": "o9"])))
    return NoListener()
  }

  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}

  func count(_ query: FirestoreQuery) async throws -> Int? {
    lock.withLock {
      countedPaths.append(query.path)
      equalityFields += query.equals.map(\.field)
    }
    return 42
  }
}

final class RecordingTransport: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var queue: [(Int, String)]
  private(set) var requests: [URLRequest] = []

  init(responses: [(Int, String)]) { self.queue = responses }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    lock.lock()
    requests.append(request)
    let (status, body) = queue.isEmpty ? (200, "{}") : queue.removeFirst()
    lock.unlock()
    let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    return (Data(body.utf8), response)
  }
}

extension ActionOutcome {
  var response: JSONValue? {
    if case .done(_, let response) = self { return response }
    return nil
  }
}
