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
    for item in file["dollars"].array {
      XCTAssertEqual(
        ScreenValues.dollarsToCents(item["typed"]?.stringValue ?? ""), item["cents"]?.numberValue.map { Int($0) },
        item["typed"]?.stringValue ?? "")
    }
  }

  func testDeleteSiteConfirmIgnoresSurroundingSpacesAsTheConsoleDoes() throws {
    let data = try Data(contentsOf: Self.screensDir.appendingPathComponent("site.screens.json"))
    let spec = try XCTUnwrap(ScreenCatalog.parse(data).first { $0.id == "core.site.delete" })
    let actions = try XCTUnwrap(spec.blocks.first { $0.type == "actions" })
    let delete = try XCTUnwrap(actions["items"].array.compactMap(ActionSpec.init).first { $0.id == "delete" })
    let typed = try XCTUnwrap(delete.prompt.first { $0.key == "typed" })
    let context = try XCTUnwrap(JSONValue.decode(Data(#"{"site":{"id":"h1","name":"Delete test Mac"}}"#.utf8)))
    // The console compares `confirmText.trim()`: a keyboard's prediction ending the name with a space still confirms.
    XCTAssertFalse(typed.mismatches("Delete test Mac", in: context))
    XCTAssertFalse(typed.mismatches("Delete test Mac ", in: context))
    XCTAssertFalse(typed.mismatches(" Delete test Mac\n", in: context))
    XCTAssertTrue(typed.mismatches("Delete test Ma", in: context))
    XCTAssertTrue(typed.mismatches("delete test mac", in: context))
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
    // Every screen a spec opens or navigates to exists: a spec, or one a plugin draws by hand.
    let handWritten: Set<String> = ["commerce.orders", "commerce.order", "commerce.products", "commerce.product", "commerce.sales", "marketplace.listing"]
    for spec in specs {
      for target in Self.targets(spec.raw) {
        XCTAssertTrue(ids.contains(target) || handWritten.contains(target), "\(spec.id) opens \(target), which no spec declares")
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

  /// "Populate from" on a system email test: workspaces, sites and people are searched by the words typed, and picking
  /// one fills the merge tokens the template takes (and the recipient, for a person with an address).
  @MainActor
  func testThePopulateFromPickerSearchesAndFillsTheTokens() async throws {
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.staff.emails" })
    let list = try XCTUnwrap(spec.blocks.first { $0.type == "list" })
    let test = try XCTUnwrap(list["actions"].array.compactMap(ActionSpec.init).first { $0.id == "test" })
    // A template that takes the workspace's name and the person's email, with the staff member as the default recipient.
    let scope: JSONValue = [
      "user": ["email": "ops@example.test"], "item": ["key": "welcome"],
      "const": ["tokens": ["welcome": [["name": "org.name", "sample": "Acme"], ["name": "user.email", "sample": "a@b.co"]]]],
    ]
    let inputs = test.inputs(in: scope)
    XCTAssertEqual(inputs.map(\.key), ["populate", "to", "token.org.name", "token.user.email"])
    let picker = try XCTUnwrap(inputs.first)
    XCTAssertEqual(picker.kind, "lookup")
    XCTAssertEqual(picker.groups.map(\.label), ["Workspaces", "Sites", "People"])
    let keys = Set(inputs.map(\.key))

    let org = try XCTUnwrap(picker.groups.first { $0.id == "org" })
    XCTAssertEqual(org.request(words: "  "), "/api/admin/orgs?pageSize=10")
    XCTAssertEqual(org.request(words: "Acme & Sons"), "/api/admin/orgs?pageSize=10&search=Acme%20%26%20Sons")
    // Only the fields the form has are filled: the template takes no org.id.
    let filled = org.fills(for: ["name": "Acme Co", "$id": "o1"], in: scope, among: keys)
    XCTAssertEqual(filled.map(\.key), ["token.org.name"])
    XCTAssertEqual(filled.map(\.value), ["Acme Co"])

    let person = try XCTUnwrap(picker.groups.first { $0.id == "user" })
    let row: JSONValue = ["uid": "u1", "email": "dana@example.test", "displayName": "Dana"]
    XCTAssertEqual(person.heading(for: row, in: scope), "dana@example.test")
    XCTAssertEqual(person.detail(for: row, in: scope), "Dana")
    let byPerson = person.fills(for: row, in: scope, among: keys)
    XCTAssertEqual(Dictionary(uniqueKeysWithValues: byPerson.map { ($0.key, $0.value) }), ["token.user.email": "dana@example.test", "to": "dana@example.test"])
    // A person with no address sets the token blank and leaves the recipient alone.
    let noAddress = person.fills(for: ["uid": "u2", "displayName": "No Mail"], in: scope, among: keys)
    XCTAssertEqual(noAddress.map(\.key), ["token.user.email"])
    XCTAssertEqual(noAddress.map(\.value), [""])
    XCTAssertEqual(person.heading(for: ["uid": "u2", "displayName": "No Mail"], in: scope), "No Mail")

    let transport = RecordingTransport(responses: [(200, #"{"orgs":[{"$id":"o1","name":"Acme Co"},{"$id":"o2","name":"Acme Two"}]}"#)])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let model = ScreenModel(spec: spec, context: [:], api: api)
    let rows = try await model.lookup(org, words: "acme")
    XCTAssertEqual(rows.map { ScreenValues.text($0["name"] ?? .null) }, ["Acme Co", "Acme Two"])
    XCTAssertEqual(transport.requests.first?.url?.path, "/api/admin/orgs")
    XCTAssertEqual(transport.requests.first?.url?.query, "pageSize=10&search=acme")
  }

  /// A collection read straight from Firestore shows its first rows; one that came back full offers "Load more", which reads it
  /// again with a larger limit (the load's `more`, else its own limit again) until the end, so a big site can be gone through to
  /// its last page. The window stays grown across a reload, as the commerce lists' does (FirestoreLoadsTests).
  @MainActor
  func testAFullFirestoreQueryOffersMoreRows() async throws {
    let reader = RowsReader(total: 6)
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: RecordingTransport(responses: []))
    let spec = try XCTUnwrap(
      ScreenSpec([
        "id": "core.x", "title": "X",
        "load": ["rows": ["query": ["collection": "hosts/h1/screens", "limit": 3], "more": 2]],
      ]))
    let model = ScreenModel(spec: spec, context: [:], api: api, reader: reader)
    await model.load()
    XCTAssertEqual(ScreenValues.lookup("data.rows.items", in: model.context).array.count, 3)
    XCTAssertEqual(model.cursors["rows"], "3")
    await model.loadMore("rows")
    XCTAssertEqual(ScreenValues.lookup("data.rows.items", in: model.context).array.count, 5)
    XCTAssertEqual(model.cursors["rows"], "5")
    await model.loadMore("rows")
    // The last read came back short: that was everything, and the button goes.
    XCTAssertEqual(ScreenValues.lookup("data.rows.items", in: model.context).array.count, 6)
    XCTAssertNil(model.cursors["rows"])
    XCTAssertEqual(reader.limits, [3, 5, 7])
    // A load without `more` grows by its own limit.
    let plain = try XCTUnwrap(ScreenSpec(["id": "core.y", "title": "Y", "load": ["rows": ["query": ["collection": "c", "limit": 3]]]]))
    let plainReader = RowsReader(total: 6)
    let fixed = ScreenModel(spec: plain, context: [:], api: api, reader: plainReader)
    await fixed.load()
    XCTAssertEqual(fixed.cursors["rows"], "3")
    await fixed.loadMore("rows")
    XCTAssertEqual(plainReader.limits, [3, 6])
    // A reload keeps the grown window.
    await model.load()
    XCTAssertEqual(ScreenValues.lookup("data.rows.items", in: model.context).array.count, 6)
    XCTAssertNil(model.cursors["rows"])
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
          "media": ["late": true, "query": ["collection": "orgs/{data.host.orgId}/media", "aggregate": ["count": true]]],
          "members": ["late": true, "query": ["collection": "orgs/{data.host.orgId}/members", "where": [["role", "==", "owner"]], "aggregate": ["count": true]]],
          // A late load's own condition reads the answers too: this one is for a site with no workspace.
          "orphan": ["late": true, "when": "!data.host.orgId", "query": ["collection": "hosts/{params.hostId}/media", "aggregate": ["count": true]]],
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

  func testTheTokenSaysHowTheAccountSignsIn() {
    func token(_ claims: String) -> TokenClaims {
      let payload = Data(claims.utf8).base64EncodedString().replacingOccurrences(of: "=", with: "")
        .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      return TokenClaims(idToken: "h.\(payload).s")
    }
    let both = token(#"{"email_verified":true,"firebase":{"identities":{"google.com":["1"],"email":["a@b.c"]},"sign_in_provider":"password"}}"#)
    XCTAssertEqual(both.signInMethods, ["password", "google.com"])
    XCTAssertTrue(both.emailVerified)
    XCTAssertEqual(token("{}").signInMethods, [])
    XCTAssertFalse(token("{}").emailVerified)
    let session = ScreenSession(email: "a@b.c", claims: both)
    let context = session.context(nil, params: [:])
    XCTAssertEqual(ScreenValues.lookup("user.providers", in: context), ["password", "google.com"])
    XCTAssertEqual(ScreenValues.render("{user.emailVerified:yesno}", in: context), "Yes")
  }

  func testNowNamesTheMonthlyAndDailyKeysInUTC() {
    let before = ScreenValues.clock
    defer { ScreenValues.clock = before }
    ScreenValues.clock = { Date(timeIntervalSince1970: 1_791_385_440) }  // 2026-10-07T15:04:00Z
    let now = ScreenValues.nowObject()
    XCTAssertEqual(now["year"], "2026")
    XCTAssertEqual(now["month"], "2026-10")
    XCTAssertEqual(now["day"], "2026-10-07")
    XCTAssertEqual(now["prevMonth"], "2026-09")
    XCTAssertEqual(now["quarter"], "2026-Q4")
    XCTAssertEqual(now["ms"], .number(1_791_385_440_000))
    let context: JSONValue = ["now": now, "data": ["counter": ["2026-10": 4, "2026-09": 9]]]
    XCTAssertEqual(ScreenValues.render("{data.counter[@now.month]}", in: context), "4")
  }

  @MainActor
  func testACountLoadAnswersTheServersCountAndFallsBackToTheRows() async throws {
    final class Counting: FirestoreReader, @unchecked Sendable {
      @MainActor func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
        onChange(.success([]))
        return Handle()
      }
      @MainActor func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
        onChange(.success(nil))
        return Handle()
      }
      func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
      func deleteDocument(_ path: [String]) async throws {}
      func count(_ query: FirestoreQuery) async throws -> Int? { query.collection == ["hosts", "h1", "layouts"] ? 7 : nil }
      final class Handle: FirestoreListening { func remove() {} }
    }
    let context: JSONValue = ["site": ["id": "h1"]]
    let counted = try await FirestoreLoads.query(Counting(), ["collection": "hosts/{site.id}/layouts", "aggregate": ["count": true, "rows": 1000]], in: context)
    XCTAssertEqual(counted["count"], 7)
    let rows = try await FirestoreLoads.query(Counting(), ["collection": "hosts/{site.id}/forms", "aggregate": ["count": true, "rows": 1000]], in: context)
    XCTAssertEqual(rows["count"], 0)
  }

  func testAWhereValueMayBeADate() {
    XCTAssertEqual(FirestoreLoads.plainValue(["$date": "2026-10-07T15:04:00Z"]) as? Date, Date(timeIntervalSince1970: 1_791_385_440))
    XCTAssertEqual(FirestoreLoads.plainValue(.number(3)) as? Int64, 3)
    XCTAssertEqual(FirestoreLoads.plainValue(.string("button")) as? String, "button")
  }

  @MainActor
  func testAPerRowLoadRunsOncePerRowAndItsListSums() async throws {
    let transport = RoutedTransport([
      ("/api/sites", #"{"sites":[{"id":"a"},{"id":"b"},{"id":"c"}]}"#),
      ("hostId=a", #"{"bandwidthGb":1.5}"#), ("hostId=b", #"{"bandwidthGb":2}"#),
    ])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let spec = try XCTUnwrap(
      ScreenSpec([
        "id": "core.x", "title": "X",
        "load": ["sites": "/api/sites", "traffic": ["url": "/api/usage?hostId={item.id}", "each": "data.sites.sites", "optional": true]],
      ]))
    let model = ScreenModel(spec: spec, context: [:], api: api)
    await model.load()
    XCTAssertEqual(model.data["traffic"].array.count, 3)
    // Site c answered nothing useful; a and b add up, and the missing one is left out, not read as zero.
    XCTAssertEqual(ScreenValues.render("{data.traffic.*.bandwidthGb + 1}", in: model.context), "4.5")
    XCTAssertEqual(ScreenValues.render("{now.prevMonth}", in: model.context).count, 7)
  }

  func testChoicesFromDataLeaveOutWhatTheFilterRefuses() throws {
    let field = try XCTUnwrap(
      FieldSpec([
        "key": "screen", "kind": "select",
        "options": [["value": "", "label": "Built-in form"]],
        "optionsFrom": ["items": "data.screens", "value": "{item.$id}", "label": "{item.displayName|item.$id}", "filter": "!item.deletedAt && item.kind != group"],
      ]))
    let context: JSONValue = [
      "data": ["screens": [
        ["$id": "home", "displayName": "Home"], ["$id": "old", "displayName": "Old", "deletedAt": 5],
        ["$id": "folder", "displayName": "Folder", "kind": "group"], ["$id": "login"],
      ]]
    ]
    XCTAssertEqual(field.choices(in: context).map(\.value), ["", "home", "login"])
    XCTAssertEqual(field.choices(in: context).map(\.label), ["Built-in form", "Home", "login"])
    XCTAssertTrue(try XCTUnwrap(ActionSpec(["label": "Set", "siteWide": true, "write": ["doc": "hosts/h"]])).siteWide)
  }

  func testARouteActionNamesAConsolePathToFollowLikeANotificationsLink() throws {
    let action = try XCTUnwrap(ActionSpec(["label": "Update payment method", "route": "{item.href}"]))
    XCTAssertEqual(action.route, "{item.href}")
    XCTAssertNil(action.url)
    let scope: JSONValue = ["item": ["href": "/acme/billing/settings"]]
    XCTAssertEqual(ScreenValues.render(try XCTUnwrap(action.route), in: scope), "/acme/billing/settings")
    XCTAssertNil(try XCTUnwrap(ActionSpec(["label": "Go", "url": "/api/x"])).route)
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

  /// An `export` action asks nothing of a route: it names the transfer resource, and its title, file name and filter are templates.
  func testAnExportActionNamesTheResourceAndMakesNoRequestOfItsOwn() throws {
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Export",
        "export": ["resource": "forms.submissions", "title": "Export {item.name}", "fileStem": "{item.slug}", "filter": ["formId": "{item.id}"]],
      ]))
    let export = try XCTUnwrap(action.export)
    XCTAssertEqual(export["resource"]?.stringValue, "forms.submissions")
    XCTAssertNil(action.url)
    XCTAssertFalse(action.reload, "an export has nothing to reload")
    let scope: JSONValue = ["item": ["id": "f1", "name": "Contact", "slug": "contact"]]
    XCTAssertEqual(ScreenValues.render(export["title"]?.stringValue ?? "", in: scope), "Export Contact")
    XCTAssertEqual(ScreenValues.resolveBody(try XCTUnwrap(export["filter"]), in: scope), ["formId": "f1"])
  }

  /// `{press}` is one key per tap: its own retry shares it, and a second tap of the very same request gets another.
  @MainActor
  func testAPressKeyIsNewForEachTapAndSharedByItsRetries() async throws {
    let transport = RecordingTransport(responses: [(503, "{}"), (200, "{}"), (200, "{}")])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport, sleep: { _ in })
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: ["form": ["points": "50"]], api: api)
    let action = try XCTUnwrap(
      ActionSpec([
        "label": "Adjust", "url": "/api/loyalty/member", "body": ["points": "{form.points}"],
        "headers": ["Idempotency-Key": "{press}"],
      ]))
    _ = await model.run(action, in: model.context)
    _ = await model.run(action, in: model.context)
    let keys = transport.requests.map { $0.value(forHTTPHeaderField: "Idempotency-Key") }
    XCTAssertEqual(keys.count, 3)
    XCTAssertNotNil(keys[0])
    XCTAssertEqual(keys[0], keys[1])
    XCTAssertNotEqual(keys[1], keys[2])
  }

  func testAMultiselectHoldsTheChosenIdsAndReadsThemBack() throws {
    let field = try XCTUnwrap(
      FieldSpec([
        "key": "models", "kind": "multiselect", "initial": "{data.row.models}",
        "optionsFrom": ["items": "data.models", "value": "{item.id}", "label": "{item.label}"],
      ]))
    let context: JSONValue = ["data": ["row": ["models": ["a", "c"]], "models": [["id": "a", "label": "A"], ["id": "b", "label": "B"]]]]
    XCTAssertEqual(field.choices(in: context).map(\.value), ["a", "b"])
    let start = initialValue(field, in: context)
    XCTAssertEqual(start, .text("a\nc"))
    XCTAssertEqual(fieldJSON(field, start), ["a", "c"])
    XCTAssertEqual(fieldJSON(field, .text("")), .null)
    XCTAssertEqual(fieldJSON(field, nil), .null)
  }

  @MainActor
  func testADownloadActionHandsBackTheFileUnderTheNameTheRouteGives() async throws {
    struct FileTransport: HTTPTransport {
      func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let named = request.url?.path.hasSuffix("/named") == true
        let response = HTTPURLResponse(
          url: request.url!, statusCode: 200, httpVersion: nil,
          headerFields: named ? ["Content-Disposition": #"attachment; filename="export-2026.json""#, "Content-Type": "application/json"] : [:])!
        return (Data(#"{"a":1}"#.utf8), response)
      }
    }
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: FileTransport())
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api)
    let named = try XCTUnwrap(ActionSpec(["label": "Export", "method": "GET", "url": "/api/x/named", "download": "fallback.json", "success": "Ready"]))
    guard case .file(let file, let name, let message) = await model.run(named, in: [:]) else { return XCTFail("expected a file") }
    XCTAssertEqual(name, "export-2026.json")
    XCTAssertEqual(message, "Ready")
    XCTAssertEqual(String(data: file.data, encoding: .utf8), #"{"a":1}"#)
    let unnamed = try XCTUnwrap(ActionSpec(["label": "Export", "method": "GET", "url": "/api/x/other", "download": "fallback.json"]))
    guard case .file(_, let fallback, _) = await model.run(unnamed, in: [:]) else { return XCTFail("expected a file") }
    XCTAssertEqual(fallback, "fallback.json")
  }

  @MainActor
  func testAFileFieldSendsTheParsedFileAndAnActionKeepsWhatItLearnedForTheNextScreen() async throws {
    let file = try XCTUnwrap(FieldSpec(["key": "package", "kind": "file", "parse": "json"]))
    XCTAssertEqual(fieldJSON(file, .text(#"{"manifest":{"items":[]}}"#)), ["manifest": ["items": []]])
    XCTAssertEqual(fieldJSON(file, .text("not json")), .null)
    XCTAssertEqual(fieldJSON(file, .text("")), .null)
    let transport = RecordingTransport(responses: [(200, #"{"plan":{"items":[{"key":"page/a","comparison":"differs","proposed":"skip","needsChoice":true,"choices":["replace","keepBoth","merge","skip"]}]}}"#)])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.site.import" })
    let form = try XCTUnwrap(spec.blocks.first { $0.id == "package" })
    let plan = try XCTUnwrap(form["submit"].flatMap(ActionSpec.init))
    let model = ScreenModel(spec: spec, context: [:], api: api)
    ScreenStash.clear()
    let scope: JSONValue = ["site": ["id": "h1"], "form": ["package": ["manifest": ["items": []]]]]
    _ = await model.run(plan, in: scope)
    XCTAssertEqual(ScreenStash.values["package"], ["manifest": ["items": []]])
    XCTAssertEqual(ScreenValues.lookup("plan.plan.items.0.key", in: .object(ScreenStash.values)), "page/a")
    // A changed item waits for a choice: it is not decided, and it is the one thing left to decide.
    XCTAssertEqual(ScreenStash.values["decisions"], [:])
    XCTAssertEqual(ScreenStash.values["undecided"], ["page/a": "page/a"])
    // The review screen picks a decision for an item and keeps it for the apply.
    let review = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.site.import.review" })
    let list = try XCTUnwrap(review.blocks.last { $0.type == "list" })
    let choose = try XCTUnwrap(list["actions"].array.first.flatMap(ActionSpec.init))
    let row: JSONValue = ["key": "page/a", "choices": ["replace", "keepBoth", "merge", "skip"]]
    let picking = ScreenContext.with(ScreenContext.with(["stash": .object(ScreenStash.values)], item: row), "form", ["decision": "skip"])
    _ = await ScreenModel(spec: review, context: [:], api: api).run(choose, in: picking)
    XCTAssertEqual(ScreenStash.values["overrides"], ["page/a": "skip"])
    XCTAssertEqual(ScreenStash.values["decisions"], ["page/a": "skip"])
    XCTAssertEqual(ScreenStash.values["undecided"], [:])
    let options = try XCTUnwrap(choose.prompt.first).choices(in: picking).map(\.value)
    XCTAssertEqual(options, ["replace", "keepBoth", "merge", "skip"])  // merge is chosen key by key on the item
    ScreenStash.clear()
  }

  @MainActor
  func testTheProfileListsSignInMethodsAndOnlyOffersToDisconnectOneWhileAnotherRemains() async throws {
    final class Unlinked: @unchecked Sendable { var providers: [String] = [] }
    let unlinked = Unlinked()
    let account = AccountOperations(unlinkProvider: { unlinked.providers.append($0) })
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.account.profile" })
    let list = try XCTUnwrap(spec.blocks.first { $0.title == "Sign-in methods" })
    let unlink = try XCTUnwrap(list["actions"].array.first.flatMap(ActionSpec.init))
    func scope(_ providers: [String], item: String) -> JSONValue {
      ScreenContext.with(["user": ["providers": .array(providers.map(JSONValue.string))]], item: .string(item))
    }
    XCTAssertTrue(ScreenValues.condition(unlink.when, in: scope(["password", "google.com"], item: "google.com")))
    XCTAssertFalse(ScreenValues.condition(unlink.when, in: scope(["password", "google.com"], item: "password")))
    XCTAssertFalse(ScreenValues.condition(unlink.when, in: scope(["google.com"], item: "google.com")))
    let model = ScreenModel(spec: spec, context: [:], api: nil, account: account)
    // The screen's own constants (the provider names) come with the model's context.
    let shown = ScreenContext.with(
      ScreenContext.with(model.context, item: "google.com"), "user", ["providers": ["password", "google.com"]])
    let outcome = await model.run(unlink, in: shown)
    XCTAssertEqual(outcome, .done(message: "Google disconnected", response: nil))
    XCTAssertEqual(unlinked.providers, ["google.com"])
  }

  @MainActor
  func testSavingTheBusinessProfileWritesFieldsSourcesAndWhoSavedIt() async throws {
    final class Recorder: FirestoreWriter, @unchecked Sendable {
      var path: [String] = []
      var fields: [String: Any] = [:]
      func merge(_ path: [String], _ fields: [String: Any]) async throws { self.path = path; self.fields = fields }
    }
    let writer = Recorder()
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.settings.profile" })
    let form = try XCTUnwrap(spec.blocks.first { $0.id == "businessProfile" })
    let submit = try XCTUnwrap(form["submit"].flatMap(ActionSpec.init))
    let model = ScreenModel(spec: spec, context: [:], api: nil, writer: writer)
    let scope: JSONValue = [
      "org": ["id": "o1"], "user": ["uid": "u1"],
      "data": ["business": ["whatYouDo": "Grooming", "tone": "plain", "sources": ["whatYouDo": "start", "tone": "ai"]]],
      "form": ["whatYouDo": "Grooming", "services": ["Bath", "bath", "Groom"], "serviceArea": "", "audience": "", "tone": "premium", "toneNotes": ""],
    ]
    let outcome = await model.run(submit, in: scope)
    XCTAssertEqual(outcome, .done(message: "Saved", response: nil))
    XCTAssertEqual(writer.path, ["orgs", "o1", "businessProfile", "defaults"])
    XCTAssertEqual(writer.fields["services"] as? [String], ["Bath", "Groom"])
    XCTAssertEqual(writer.fields["tone"] as? String, "premium")
    XCTAssertEqual(writer.fields["updatedBy"] as? String, "u1")
    let sources = try XCTUnwrap(writer.fields["sources"] as? [String: Any])
    XCTAssertEqual(sources["whatYouDo"] as? String, "start")  // untouched keeps its source
    XCTAssertEqual(sources["tone"] as? String, "owner")  // changed becomes the owner's
    XCTAssertEqual(sources["services"] as? String, "owner")
    XCTAssertTrue(sources["audience"] is FirestoreSentinel)  // no source: the key is removed
  }

  @MainActor
  func testASitePluginScreenWritesOnlyTheFieldsTheSiteOverrides() throws {
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.sitePluginSettings.ai" })
    XCTAssertEqual(spec.zones, ["sitePluginSettings"])
    XCTAssertEqual(spec.requires, "org.manager && params.pluginId == ai")
    let form = try XCTUnwrap(spec.blocks.first { $0.type == "form" })
    let submit = try XCTUnwrap(form["submit"].flatMap(ActionSpec.init))
    let fields = try XCTUnwrap(submit.write?["fields"])
    let scope: JSONValue = [
      "user": ["uid": "u1"],
      "form": ["ov_provider": true, "provider": "anthropic", "ov_chatModel": false, "chatModel": "platform"],
    ]
    let written = ScreenValues.resolveBody(fields, in: scope)
    XCTAssertEqual(written["provider"], "anthropic")
    XCTAssertEqual(written["chatModel"], ["$delete": true])
    XCTAssertEqual(written["updatedBy"], "u1")
    // A field the site holds starts overridden, even when the stored value is false or 0.
    let start: JSONValue = ["data": ["site": ["provider": "anthropic"], "org": [:]]]
    let toggle = try XCTUnwrap(form["fields"].array.compactMap(FieldSpec.init).first { $0.key == "ov_provider" })
    XCTAssertEqual(initialValue(toggle, in: start), .flag(true))
    let other = try XCTUnwrap(form["fields"].array.compactMap(FieldSpec.init).first { $0.key == "ov_chatModel" })
    XCTAssertEqual(initialValue(other, in: start), .flag(false))
  }

  @MainActor
  func testTheForumOffersTheRoutesCategoriesAndFiltersByThem() throws {
    let forum = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.support.forum" })
    let list = try XCTUnwrap(forum.blocks.first { $0.type == "list" })
    XCTAssertEqual(list["chips"]?["field"], "category")
    let context: JSONValue = ["data": ["forum": ["categories": ["General", "Building"]]]]
    XCTAssertEqual(ScreenValues.lookup(list["chips"]?["from"]?.stringValue ?? "", in: context).array.map { ScreenValues.text($0) }, ["General", "Building"])
    let create = try XCTUnwrap(forum.raw["actions"].array.first.flatMap(ActionSpec.init))
    XCTAssertEqual(create.prompt.first?.choices(in: context).map(\.value), ["General", "Building"])
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

  /// The Aglyn AI row is the console's tier picker (AGL-4008): every tier with its price and credits, the held one marked,
  /// an unconfigured one shown and not pickable with its reason, "No tier"; the console's confirm wording for a move.
  @MainActor
  func testTheAiTierPickerOffersTheConsoleTiersAndQuotesAMove() throws {
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.billing.addons" })
    let list = try XCTUnwrap(spec.blocks.first { $0.type == "list" })
    let actions = list["actions"].array.compactMap(ActionSpec.init)
    let tier = try XCTUnwrap(actions.first { $0.id == "tier" })
    let turnOn = try XCTUnwrap(actions.first { $0.id == "on" })
    let tiers: JSONValue = [
      ["id": "spark", "label": "Spark", "credits": 4000, "unitUsd": 9, "configured": true],
      ["id": "plus", "label": "Plus", "credits": 19000, "unitUsd": 39, "configured": true],
      ["id": "studio", "label": "Studio", "credits": 99000, "unitUsd": 199, "configured": false],
    ]
    let base: JSONValue = [
      "org": ["id": "o1", "manager": true],
      "data": ["addons": [
        "hasSubscription": true, "plan": "pro", "interval": "month", "aiTier": "plus", "aiTiers": tiers,
        "quantities": ["aiAddon": 1], "catalog": ["aiAddon": ["unitUsd": 39, "configured": true, "upgradeRequired": false]],
      ]],
      "item": ["kind": "aiAddon", "label": "Aglyn AI", "toggle": true],
    ]
    // The picker replaces the switch on a plan that sells tiers.
    XCTAssertTrue(ScreenValues.condition(tier.when, in: base))
    XCTAssertFalse(ScreenValues.condition(turnOn.when, in: base))
    XCTAssertEqual(ScreenValues.render(tier.label, in: base), "Aglyn AI tier")
    let field = try XCTUnwrap(tier.prompt.first)
    XCTAssertEqual(field.kind, "choice")
    let rows = field.choiceRows(in: base)
    XCTAssertEqual(rows.map(\.value), ["none", "spark", "plus", "studio"])
    XCTAssertEqual(rows.map(\.label), ["No tier", "Spark — $9/mo", "Plus — $39/mo", "Studio — $199/mo"])
    XCTAssertEqual(rows[0].detail, "Your plan's included credits only")
    XCTAssertEqual(rows[1].detail, "+4,000 credits a month")
    XCTAssertEqual(rows[2].badge, FieldChoiceBadge(text: "Current", tone: "info"))
    XCTAssertNil(rows[0].badge)
    XCTAssertEqual(rows[3].enabled, false)
    XCTAssertEqual(rows[3].detail, "+99,000 credits a month (not configured yet)")
    // Applying the tier already held changes nothing, so it is not offered.
    XCTAssertEqual(ScreenValues.render(try XCTUnwrap(field.initial), in: base), "plus")
    XCTAssertTrue(field.unmet("plus", in: base))
    XCTAssertFalse(field.unmet("spark", in: base))
    // A tier is one line at quantity 1 with its id; "No tier" removes the line and names no tier.
    let check = try XCTUnwrap(tier.check?.action.body)
    XCTAssertEqual(
      ScreenValues.resolveBody(check, in: ScreenContext.with(base, "form", ["tier": "spark"])),
      ["orgId": "o1", "action": "preview", "kind": "aiAddon", "quantity": 1, "tier": "spark"])
    XCTAssertEqual(
      ScreenValues.resolveBody(try XCTUnwrap(tier.body), in: ScreenContext.with(base, "form", ["tier": "none"])),
      ["orgId": "o1", "action": "set", "kind": "aiAddon", "quantity": 0])
    // Down a tier waits for the period end; up is charged now; none removes it.
    let down = ScreenContext.with(
      ScreenContext.with(base, "form", ["tier": "spark"]), "preview",
      ["defersToPeriodEnd": true, "effectiveAt": "2026-11-01T00:00:00Z", "currency": "usd"])
    XCTAssertEqual(
      tier.confirmText(in: down),
      "Aglyn AI Spark? Nothing is charged and nothing is refunded. You keep Plus for the rest of the period you have paid for, and Spark starts on Nov 1, 2026. From then: $9/mo, adding 4,000 AI credits a month on top of your plan's.")
    let none = ScreenContext.with(
      ScreenContext.with(base, "form", ["tier": "none"]), "preview",
      ["defersToPeriodEnd": true, "effectiveAt": "2026-11-01T00:00:00Z", "currency": "usd"])
    XCTAssertEqual(
      tier.confirmText(in: none),
      "Aglyn AI: 0? Nothing is charged and nothing is refunded. You keep this capacity for the rest of the period you have paid for, and it ends on Nov 1, 2026. From then: nothing, this add-on is removed.")
    var fresh = base
    fresh = ScreenContext.with(fresh, "data", ["addons": [
      "hasSubscription": true, "plan": "pro", "interval": "year", "aiTiers": tiers,
      "catalog": ["aiAddon": ["unitUsd": 9, "configured": true, "upgradeRequired": false]],
    ]])
    let up = ScreenContext.with(
      ScreenContext.with(fresh, "form", ["tier": "plus"]), "preview",
      ["chargedNowCents": 3900, "currency": "usd", "taxComplete": true])
    XCTAssertEqual(
      tier.confirmText(in: up),
      "Aglyn AI Plus? $39.00 will be charged to your card now, prorated for the rest of this period. Ongoing: $39/mo (billed yearly with your plan), adding 19,000 AI credits a month on top of your plan's.")
    XCTAssertEqual(field.choiceRows(in: fresh)[0].badge, FieldChoiceBadge(text: "Current", tone: "neutral"))
    // What it says once applied: a move that waits names the day, as the console's snackbar does.
    let moved = ScreenModel.message(
      for: tier, response: ["ok": true, "pendingAddonChange": ["effectiveAt": "2026-11-01T00:00:00Z"]],
      in: ScreenContext.with(base, "form", ["tier": "spark"]))
    XCTAssertEqual(moved, "Aglyn AI moves to Spark on Nov 1, 2026.")
    XCTAssertEqual(
      ScreenModel.message(for: tier, response: ["ok": true], in: ScreenContext.with(base, "form", ["tier": "spark"])),
      "Aglyn AI updated")
  }

  @MainActor
  func testThePlanChangeQuotesWhatTheConsoleQuotes() throws {
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.billing.plans" })
    let list = try XCTUnwrap(spec.blocks.first { $0.type == "list" })
    let actions = list["actions"].array.compactMap(ActionSpec.init)
    let switchPlan = try XCTUnwrap(actions.first { $0.id == "switch" })
    XCTAssertNotNil(switchPlan.check)
    var base: JSONValue = [
      "item": ["id": "business", "label": "Business"],
      "const": spec.raw["constants"] ?? .null,
      "data": [
        "org": ["plan": "pro", "subscription": ["status": "active"]],
        "billing": ["subscription": [:]],
        "collab": ["sites": [["hostId": "a"], ["hostId": "b"]]],
        "seats": ["managerSeats": 2], "datasets": ["count": 1],
      ],
    ]
    func quote(_ preview: JSONValue, data: JSONValue? = nil) -> String {
      var scope = ScreenContext.with(base, "preview", preview)
      if let data { scope = ScreenContext.with(scope, "data", data) }
      return switchPlan.confirmText(in: scope) ?? ""
    }
    // Charged now, tax included.
    XCTAssertEqual(
      quote(["downgrade": false, "chargesNow": true, "prorationCents": 1000, "chargedNowCents": 1100, "prorationTaxCents": 100, "taxComplete": true, "currency": "usd", "periodEnd": "2026-11-01T00:00:00Z"]),
      "Switch to Business? You'll be charged $11.00 USD now for the rest of this period, and your plan changes as soon as the payment goes through. That includes $1.00 USD tax.")
    // A credit, with tax the address cannot decide yet.
    XCTAssertEqual(
      quote(["downgrade": false, "prorationCents": -250, "taxComplete": false, "currency": "usd", "periodEnd": "2026-11-01T00:00:00Z"]),
      "Switch to Business? Unused time credits $2.50 USD back on your next invoice on Nov 1, 2026. Tax is calculated once we have your billing address. This total does not include it yet.")
    // A move down waits for the period end.
    XCTAssertEqual(
      quote(["downgrade": true, "periodEnd": "2026-11-01T00:00:00Z"]),
      "Move down to Business? Nothing is charged today, and nothing changes yet. You keep Pro — and everything you've already paid for — until Nov 1, 2026, when this organization moves to Business. You can keep your current plan any time before then.")
    // The AI tier is dropped where the target sells none, and over-limit counts are named.
    var data = base["data"] ?? .null
    data = ScreenContext.with(data, "org", ["plan": "pro", "subscription": ["status": "active"], "seatAddons": ["aiAddon": 1]])
    data = ScreenContext.with(data, "seats", ["managerSeats": 7])
    base = ScreenContext.with(base, "item", ["id": "free", "label": "Free"])
    let text = quote(["downgrade": true, "periodEnd": "2026-11-01T00:00:00Z", "droppedAddons": ["aiAddon"]], data: data)
    XCTAssertTrue(text.contains("Your Aglyn AI tier is not sold on Free, so it is removed"))
    XCTAssertTrue(text.contains("over the Free plan on: 2 sites (Free includes 1)"))
    XCTAssertTrue(text.contains("7 team members (Free includes 1)"))
    XCTAssertTrue(text.contains("Nothing is deleted and these keep working"))
    // Only a different plan is offered, and only to a workspace with a live subscription.
    let scope = ScreenContext.with(base, "item", ["id": "pro"])
    XCTAssertFalse(ScreenValues.condition(switchPlan.when, in: scope))
    XCTAssertTrue(ScreenValues.condition(switchPlan.when, in: ScreenContext.with(scope, "item", ["id": "business"]).withManager()))
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
  func testAccountActionsChangeThePasswordAndNameThroughTheSession() async throws {
    final class Calls: @unchecked Sendable { var passwords: [[String]] = []; var names: [String] = [] }
    let calls = Calls()
    let account = AccountOperations(
      changePassword: { calls.passwords.append([$0, $1]) }, updateDisplayName: { calls.names.append($0) },
      message: { _ in "nope" })
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: RecordingTransport(responses: []))
    let model = ScreenModel(spec: try XCTUnwrap(ScreenSpec(["id": "core.x", "title": "X"])), context: [:], api: api, account: account)
    let change = try XCTUnwrap(
      ActionSpec([
        "label": "Change", "account": "changePassword",
        "body": ["current": "{form.current}", "new": "{form.password}", "confirm": "{form.confirm}"], "success": "Done",
      ]))
    let short: JSONValue = ["form": ["current": "old", "password": "short", "confirm": "short"]]
    do { let outcome = await model.run(change, in: short); XCTAssertEqual(outcome, .failed("Use at least 12 characters.")) }
    let mismatch: JSONValue = ["form": ["current": "old", "password": "a-long-enough-one", "confirm": "different-long-one"]]
    do { let outcome = await model.run(change, in: mismatch); XCTAssertEqual(outcome, .failed("The two new passwords do not match.")) }
    XCTAssertTrue(calls.passwords.isEmpty)
    let good: JSONValue = ["form": ["current": "old", "password": "a-long-enough-one", "confirm": "a-long-enough-one"]]
    do { let outcome = await model.run(change, in: good); XCTAssertEqual(outcome, .done(message: "Done", response: nil)) }
    XCTAssertEqual(calls.passwords, [["old", "a-long-enough-one"]])
    let name = try XCTUnwrap(ActionSpec(["label": "Name", "account": "updateDisplayName", "body": ["name": "{form.first} {form.last}"]]))
    _ = await model.run(name, in: ["form": ["first": "Ada", "last": "Lovelace"]])
    XCTAssertEqual(calls.names, ["Ada Lovelace"])
  }

  @MainActor
  func testWriteTurnsSentinelObjectsIntoFirestoreSentinels() throws {
    let plain = FirestoreLoads.plain(["a": ["$serverTimestamp": true], "b": ["$delete": true], "c": ["d": "x"]])
    let record = try XCTUnwrap(plain as? [String: Any])
    XCTAssertEqual(record["a"] as? FirestoreSentinel, .serverTimestamp)
    XCTAssertEqual(record["b"] as? FirestoreSentinel, .delete)
    XCTAssertEqual((record["c"] as? [String: Any])?["d"] as? String, "x")
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

  @MainActor
  func testAPostLoadPagesByPuttingItsCursorInTheBody() async throws {
    let transport = RecordingTransport(responses: [
      (200, #"{"jobs":[{"id":"a"}],"next":1791385440000}"#), (200, #"{"jobs":[{"id":"b"}],"next":null}"#),
    ])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let spec = try XCTUnwrap(
      ScreenSpec([
        "id": "core.x", "title": "X",
        "load": ["jobs": ["url": "/api/transfer/jobs", "method": "POST", "body": ["orgId": "{org.id}", "limit": 25], "cursor": "next", "cursorParam": "after", "items": "jobs"]],
      ]))
    let model = ScreenModel(spec: spec, context: ["org": ["id": "o1"], "data": [:]], api: api)
    await model.load()
    // A number cursor (a job's createdAt) pages as text, and goes back as the number it was.
    XCTAssertEqual(model.cursors["jobs"], "1791385440000")
    await model.loadMore("jobs")
    XCTAssertEqual(ScreenValues.lookup("data.jobs.jobs", in: model.context).array.count, 2)
    XCTAssertNil(model.cursors["jobs"])
    let sent = try XCTUnwrap(transport.requests.last?.httpBody.flatMap(JSONValue.decode))
    XCTAssertEqual(sent, ["orgId": "o1", "limit": 25, "after": 1791385440000])
    XCTAssertEqual(transport.requests.last?.url?.path, "/api/transfer/jobs")
    XCTAssertNil(transport.requests.last?.url?.query)
  }

  func testAListAndAnOptionSourceCanWalkTheListsInsideTheRows() throws {
    let context: JSONValue = [
      "params": [:],
      "data": ["resources": [
        ["key": "outreach.sequences", "label": "Sequences", "items": [["key": "outreach.sequences/a", "name": "Welcome"], ["key": "outreach.sequences/b", "id": "b"]]],
        ["key": "marketing.campaigns", "label": "Campaigns", "items": [["key": "marketing.campaigns/c", "name": "Launch"]]],
        ["key": "crm.email-templates", "label": "Email templates", "items": []],
      ]],
    ]
    let field = try XCTUnwrap(
      FieldSpec([
        "key": "items", "kind": "multiselect",
        "initial": "{data.resources[key=params.resource].items.*.key|data.resources.*.items.*.key}",
        "optionsFrom": ["items": "data.resources", "within": "items", "value": "{item.key}", "label": "{parent.label}: {item.name|item.id}"],
      ]))
    XCTAssertEqual(
      field.choices(in: context).map { "\($0.value)=\($0.label)" },
      ["outreach.sequences/a=Sequences: Welcome", "outreach.sequences/b=Sequences: b", "marketing.campaigns/c=Campaigns: Launch"])
    // Everything is picked until a resource is named, then only its items.
    XCTAssertEqual(initialValue(field, in: context), .text("outreach.sequences/a\noutreach.sequences/b\nmarketing.campaigns/c"))
    XCTAssertEqual(initialValue(field, in: ScreenContext.with(context, "params", ["resource": "marketing.campaigns"])), .text("marketing.campaigns/c"))
    let rows = ScreenValues.scopes(items: "data.resources", within: "items", filter: "item.name", in: context)
    XCTAssertEqual(rows.count, 2)
    XCTAssertEqual(ScreenValues.render("{parent.label}", in: rows[1]), "Campaigns")
  }

  func testAMultiselectThatCoversAllIsUnfinishedUntilEveryChoiceIsChosen() throws {
    let field = try XCTUnwrap(
      FieldSpec([
        "key": "ack", "kind": "multiselect", "coversAll": true,
        "optionsFrom": ["items": "data.warnings", "value": "{item}", "label": "{item}"],
      ]))
    let context: JSONValue = ["data": ["warnings": ["replace", "failed"]]]
    XCTAssertTrue(field.unmet(.null, in: context))
    XCTAssertTrue(field.unmet(["replace"], in: context))
    XCTAssertFalse(field.unmet(["failed", "replace"], in: context))
    XCTAssertFalse(field.unmet(.null, in: ["data": ["warnings": []]]))
  }

  @MainActor
  func testAnActionCanSaveTheValueAtAPathOfTheRoutesAnswerAsTheFile() async throws {
    let answer = #"{"ok":true,"fileName":"aglyn-package-2026.json","package":{"name":"a/b","manifest":{"items":[]}}}"#
    let transport = RecordingTransport(responses: [(200, answer)])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let spec = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.settings.data.packageExport" })
    let actions = try XCTUnwrap(spec.blocks.first { $0.type == "actions" })
    let export = try XCTUnwrap(actions["items"].array.first.flatMap(ActionSpec.init))
    XCTAssertEqual(export.downloadAt, "package")
    let scope: JSONValue = ["org": ["id": "o1"], "form": ["items": ["outreach.sequences/a"], "dependencies": true]]
    guard case .file(let file, let name, _) = await ScreenModel(spec: spec, context: [:], api: api).run(export, in: scope) else {
      return XCTFail("expected a file")
    }
    XCTAssertEqual(name, "aglyn-package-2026.json")
    // The file is the package alone, indented, with no escaped slashes, and it reads back as it was.
    let text = try XCTUnwrap(String(data: file.data, encoding: .utf8))
    XCTAssertTrue(text.contains("\n  "))
    XCTAssertTrue(text.contains("\"a/b\""))
    XCTAssertEqual(JSONValue.decode(file.data), ["name": "a/b", "manifest": ["items": []]])
    let sent = try XCTUnwrap(transport.requests.last?.httpBody.flatMap(JSONValue.decode))
    XCTAssertEqual(sent, ["orgId": "o1", "action": "export", "items": ["outreach.sequences/a"], "dependencies": true])
  }

  @MainActor
  func testThePackageReviewPlansAgainOnEveryChoiceAndAsksForEveryAcknowledgement() async throws {
    let plan = #"{"job":{"id":"j1"},"items":[],"references":[],"summary":{"create":1},"blocking":[],"acknowledgementsRequired":["replace","failed"],"resources":{}}"#
    let transport = RecordingTransport(responses: [(200, plan), (200, plan)])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let review = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.settings.data.packageReview" })
    let model = ScreenModel(spec: review, context: [:], api: api)
    let items = try XCTUnwrap(review.blocks.first { $0.type == "list" && $0.title == "Items" })
    let chooseItem = try XCTUnwrap(items["actions"].array.first.flatMap(ActionSpec.init))
    ScreenStash.clear()
    ScreenStash.set(["plan": ["job": ["id": "j1"]], "decisions": ["page/x": "skip"], "dependencyChoices": ["mailbox/m": ["action": "dropReference"]]])
    let row: JSONValue = ["key": "outreach.sequences/a", "decision": "create", "decisions": ["create", "replace", "skip"]]
    let picking = ScreenContext.with(
      ScreenContext.with(["org": ["id": "o1"], "stash": .object(ScreenStash.values)], item: row), "form", ["decision": "replace"])
    XCTAssertTrue(ScreenValues.condition(chooseItem.when, in: picking))
    XCTAssertFalse(ScreenValues.condition(chooseItem.when, in: ScreenContext.with(picking, "item", ["decisions": ["create"]])))
    _ = await model.run(chooseItem, in: picking)
    // The new choice joins the earlier ones, and the other kind of choice is sent along unchanged.
    let sent = try XCTUnwrap(transport.requests.last?.httpBody.flatMap(JSONValue.decode))
    XCTAssertEqual(
      sent,
      [
        "orgId": "o1", "action": "plan", "jobId": "j1",
        "decisions": ["page/x": "skip", "outreach.sequences/a": "replace"],
        "dependencyChoices": ["mailbox/m": ["action": "dropReference"]],
      ])
    XCTAssertEqual(ScreenStash.values["decisions"], ["page/x": "skip", "outreach.sequences/a": "replace"])
    XCTAssertEqual(ScreenValues.lookup("summary.create", in: ScreenStash.values["plan"] ?? .null), 1)

    // A reference mapped to one of yours carries that one; a leave-out carries no id.
    let references = try XCTUnwrap(review.blocks.first { $0.type == "list" && $0.title == "Things this workspace does not have" })
    let chooseReference = try XCTUnwrap(references["actions"].array.first.flatMap(ActionSpec.init))
    let reference: JSONValue = ["key": "mailbox/m2", "choices": ["import", "mapTo", "skipItem"], "targets": []]
    let mapping = ScreenContext.with(
      ScreenContext.with(["org": ["id": "o1"], "stash": .object(ScreenStash.values)], item: reference), "form", ["action": "skipItem"])
    XCTAssertEqual(try XCTUnwrap(chooseReference.prompt.first).choices(in: mapping).map(\.value), ["import", "skipItem"])  // nothing of yours to map to
    _ = await model.run(chooseReference, in: mapping)
    let second = try XCTUnwrap(transport.requests.last?.httpBody.flatMap(JSONValue.decode))
    XCTAssertEqual(second["dependencyChoices"], ["mailbox/m": ["action": "dropReference"], "mailbox/m2": ["action": "skipItem"]])

    // Import asks for every acknowledgement the plan requires, and for none when it requires none.
    let actions = try XCTUnwrap(review.blocks.last { $0.type == "actions" })
    let apply = try XCTUnwrap(actions["items"].array.first.flatMap(ActionSpec.init))
    let ack = try XCTUnwrap(apply.prompt.first)
    let waiting: JSONValue = ["stash": .object(ScreenStash.values)]
    XCTAssertEqual(ack.choices(in: waiting).map(\.value), ["replace", "failed"])
    XCTAssertTrue(ack.unmet(["replace"], in: waiting))
    XCTAssertFalse(ack.unmet(["replace", "failed"], in: waiting))
    let applyNow = try XCTUnwrap(actions["items"].array.last.flatMap(ActionSpec.init))
    XCTAssertEqual(applyNow.id, "applyNow")
    func offered(_ plan: JSONValue) -> [String] {
      [apply, applyNow].filter { ScreenValues.condition($0.when, in: ["stash": ["plan": plan]]) }.map(\.id)
    }
    XCTAssertEqual(offered(["acknowledgementsRequired": ["replace"], "blocking": []]), ["apply"])
    XCTAssertEqual(offered(["acknowledgementsRequired": [], "blocking": []]), ["applyNow"])
    XCTAssertEqual(offered(["acknowledgementsRequired": ["replace"], "blocking": ["Choose what happens to 1 item."]]), [])
    XCTAssertEqual(offered(["acknowledgementsRequired": [], "blocking": ["Choose what happens to 1 item."]]), [])
    ScreenStash.clear()
  }

  @MainActor
  func testTheRulesListShowsOnlyTheResourcesTheFileHolds() throws {
    let review = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.settings.data.packageReview" })
    let rules = try XCTUnwrap(review.blocks.first { $0.type == "list" && $0.title == "Rules every import keeps" })
    let context: JSONValue = [
      "stash": ["plan": [
        "items": [["kind": "outreach.sequences"], ["kind": "outreach.sequences"]],
        "resources": [
          "outreach.sequences": ["label": "Sequences", "rules": [["label": "Imported as a draft", "reason": "A sequence never sends from a file."]]],
          "marketing.campaigns": ["label": "Campaigns", "rules": [["label": "Imported as a draft", "reason": "x"]]],
          "crm.email-templates": ["label": "Email templates", "rules": []],
        ],
      ]]
    ]
    let found = ScreenValues.scopes(items: "stash.plan.resources", within: nil, filter: rules["filter"]?.stringValue, in: context)
    XCTAssertEqual(found.map { ScreenValues.render("{item.value.label}", in: $0) }, ["Sequences"])
    XCTAssertEqual(ScreenValues.render(rules["secondary"]?.stringValue ?? "", in: found[0]), "Imported as a draft")
  }

  @MainActor
  func testTheHubPagesItsHistoryAndOffersTheConsolesRowActions() throws {
    let hub = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.settings.data" })
    let jobs = try XCTUnwrap(hub.loads.first { $0.key == "jobs" })
    XCTAssertEqual(jobs.method, .post)
    XCTAssertEqual(jobs.cursor, "next")
    XCTAssertEqual(jobs.cursorParam, "after")
    let history = try XCTUnwrap(hub.blocks.first { $0.title == "History" })
    XCTAssertEqual(history["load"]?.stringValue, "jobs")
    let actions = history["actions"].array.compactMap(ActionSpec.init)
    let job: JSONValue = ["id": "j9", "kind": "package", "resultFile": true, "undo": ["available": true]]
    let scope = ScreenContext.with(["org": ["id": "o1"]], item: job)
    XCTAssertEqual(actions.filter { ScreenValues.condition($0.when, in: scope) }.map(\.id), ["results", "undo"])
    // A records import opens in the wizard (its results and its undo), until it is undone.
    let records = ScreenContext.with(scope, "item", ["id": "j9", "kind": "records", "status": "applied", "resultFile": false, "undo": ["available": true]])
    XCTAssertEqual(actions.filter { ScreenValues.condition($0.when, in: records) }.map(\.id), ["open"])
    let undone = ScreenContext.with(scope, "item", ["id": "j9", "kind": "records", "status": "undone", "resultFile": true])
    XCTAssertEqual(actions.filter { ScreenValues.condition($0.when, in: undone) }.map(\.id), ["results"])
    XCTAssertEqual(ScreenValues.render(try XCTUnwrap(actions.first?.download), in: scope), "import-j9-results.csv")
  }

  @MainActor
  func testTheRecordsListShowsWhatThePluginsAndThePlanAllowAndExportsThroughTheSheet() throws {
    let records = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.settings.data.records" })
    let consts = try XCTUnwrap(records.raw["constants"])
    func context(crm: Bool, running: [String]) -> JSONValue {
      [
        "org": ["id": "o1", "manager": true], "const": consts,
        "data": [
          "sw": ["rows": .array(running.map { ["id": .string($0), "on": true] })],
          "ent": ["features": ["crm": .bool(crm)]],
          "datasets": ["items": [["$id": "d1", "name": "Pets"]]],
        ],
      ]
    }
    let crmList = try XCTUnwrap(records.blocks.first { $0.title == "CRM" })
    let on = context(crm: false, running: ["crm"])
    XCTAssertTrue(ScreenValues.condition(crmList.when, in: on))
    // On a plan without the CRM only the exports that stay free are listed.
    let free = ScreenValues.scopes(items: crmList["items"]?.stringValue ?? "", filter: crmList["filter"]?.stringValue, in: on)
    XCTAssertEqual(free.map { ScreenValues.render("{item.key}", in: $0) }, ["crm.contacts", "crm.leads"])
    let paid = ScreenValues.scopes(items: crmList["items"]?.stringValue ?? "", filter: crmList["filter"]?.stringValue, in: context(crm: true, running: ["crm"]))
    XCTAssertTrue(paid.count > free.count)
    XCTAssertFalse(ScreenValues.condition(crmList.when, in: context(crm: true, running: [])))
    let note = try XCTUnwrap(records.blocks.first { $0.type == "notice" && $0.when?.contains("!data.ent.features.crm") == true })
    XCTAssertTrue(ScreenValues.condition(note.when, in: on))
    XCTAssertFalse(ScreenValues.condition(note.when, in: context(crm: true, running: ["crm"])))

    // A row's Export opens the platform sheet on its resource, for the whole workspace.
    let export = try XCTUnwrap(crmList["actions"].array.first.flatMap(ActionSpec.init))
    let request = try XCTUnwrap(export.exportRequest(in: free[0]))
    XCTAssertEqual(request.resource, "crm.contacts")
    XCTAssertEqual(request.title, "Export Contacts")
    XCTAssertNil(request.hostID)
    XCTAssertEqual(request.scope, ["kind": "all"])
    XCTAssertEqual(request.fileStem, "crm-contacts")
    XCTAssertTrue(ScreenValues.condition(export.when, in: free[0]))

    // A dataset is exported on its own, under the key that names it.
    let datasets = try XCTUnwrap(records.blocks.first { $0.title == "Dataset records" })
    let dataset = try XCTUnwrap(ScreenValues.scopes(items: "data.datasets.items", in: on).first)
    let one = try XCTUnwrap(datasets["actions"].array.first.flatMap(ActionSpec.init).flatMap { $0.exportRequest(in: dataset) })
    XCTAssertEqual(one.resource, "data.dataset:d1")
    XCTAssertEqual(one.title, "Export Pets")
    XCTAssertEqual(one.fileStem, "data-dataset-d1")

    // A site's resources name the site.
    let site = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.site.data" })
    let redirects = try XCTUnwrap(site.blocks.first { $0.title == "Redirects" })
    let siteContext = ScreenContext.with(["site": ["id": "h1"], "const": site.raw["constants"] ?? .null], item: ["key": "redirects", "label": "Redirects"])
    let inSite = try XCTUnwrap(redirects["actions"].array.first.flatMap(ActionSpec.init).flatMap { $0.exportRequest(in: siteContext) })
    XCTAssertEqual(inSite.hostID, "h1")
    XCTAssertEqual(inSite.resource, "redirects")
    XCTAssertNil(ActionSpec(["label": "Go", "url": "/api/x"])?.exportRequest(in: [:]))
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

  /// A form or prompt that lists the service's own fields from the data (a carrier's credentials).
  func testFieldsFromDataBecomeFields() throws {
    let context: JSONValue = [
      "data": ["fields": [
        ["key": "account_number", "label": "Account number", "secret": false],
        ["key": "password", "label": "Password", "helper": "Kept sealed.", "secret": true, "required": true],
        ["key": "is_test", "label": "Test account", "checkbox": true],
        ["key": "unit", "label": "Unit", "options": [["value": "kg", "label": "Kilograms"], ["value": "lb", "label": "Pounds"]]],
      ]]
    ]
    let entry: JSONValue = [
      "fieldsFrom": [
        "items": "data.fields", "key": "{item.key}", "label": "{item.label}", "help": "{item.helper}",
        "required": "required", "options": "options", "kinds": ["secret": "password", "checkbox": "yesno"],
      ]
    ]
    let fields = FieldSpec.parseAll([entry], in: context)
    XCTAssertEqual(fields.map(\.key), ["account_number", "password", "is_test", "unit"])
    XCTAssertEqual(fields.map(\.kind), ["text", "password", "select", "select"])
    XCTAssertEqual(fields.map(\.required), [false, true, false, false])
    XCTAssertEqual(fields[1].help, "Kept sealed.")
    XCTAssertEqual(fields[2].options.map(\.value), ["", "true"])
    XCTAssertEqual(fields[3].options.map(\.label), ["Kilograms", "Pounds"])
    XCTAssertEqual(fields[3].initial, "kg")
  }

  /// `where` keeps only the rows a condition holds for; a row's field of every row projects with `*`.
  func testOptionsCanBeFilteredAndRowsProjected() throws {
    let context: JSONValue = [
      "data": ["accounts": [
        ["id": "a1", "name": "Sales", "classification": "income"],
        ["id": "a2", "name": "Main bank", "classification": "bank"],
      ]]
    ]
    let field = try XCTUnwrap(
      FieldSpec(
        [
          "key": "clearing", "kind": "select",
          "optionsFrom": ["items": "data.accounts", "filter": "item.classification == bank", "value": "{item.id}", "label": "{item.name}"],
        ]))
    XCTAssertEqual(field.choices(in: context).map(\.value), ["a2"])
    XCTAssertEqual(ScreenValues.render("{data.accounts.*.name}", in: context), "Sales, Main bank")
  }

  /// A plugin's package bundles every spec file it has: a file left out of `resources` compiles and tests green, and
  /// its screens are simply missing from the app.
  func testEveryPluginSpecFileIsBundledByItsPackage() throws {
    let plugins = Self.screensDir.appendingPathComponent("../../plugins").standardizedFileURL
    let dirs = try FileManager.default.contentsOfDirectory(at: plugins, includingPropertiesForKeys: nil)
    var checked = 0
    for dir in dirs {
      let package = dir.appendingPathComponent("src/ios/Package.swift")
      guard let manifest = try? String(contentsOf: package, encoding: .utf8) else { continue }
      let sources = dir.appendingPathComponent("src/ios/Sources")
      for target in (try? FileManager.default.contentsOfDirectory(at: sources, includingPropertiesForKeys: nil)) ?? [] {
        let resources = target.appendingPathComponent("Resources")
        for file in (try? FileManager.default.contentsOfDirectory(at: resources, includingPropertiesForKeys: nil)) ?? []
        where file.lastPathComponent.hasSuffix(".screens.json") {
          checked += 1
          XCTAssertTrue(manifest.contains("\"Resources/\(file.lastPathComponent)\""), "\(package.path) does not bundle \(file.lastPathComponent)")
        }
      }
    }
    XCTAssertGreaterThan(checked, 20)
  }

  /// A report picks one of the last twelve months, newest first, each ending where the next begins.
  func testTheLastTwelveMonthsRunNewestFirstWithoutGaps() throws {
    let now = ScreenSession.now(Date(timeIntervalSince1970: 1_792_000_000))
    let months = ScreenValues.lookup("months", in: now).array
    XCTAssertEqual(months.count, 12)
    XCTAssertEqual(months[0]["label"]?.stringValue, "October 2026")
    XCTAssertEqual(months[0]["from"]?.stringValue, "2026-10-01T00:00:00.000Z")
    XCTAssertEqual(months[0]["to"]?.stringValue, "2026-11-01T00:00:00.000Z")
    XCTAssertEqual(months[11]["from"]?.stringValue, "2025-11-01T00:00:00.000Z")
    for index in 1..<12 { XCTAssertEqual(months[index]["to"]?.stringValue, months[index - 1]["from"]?.stringValue) }
  }

  /// A map offers one choice per entry, by value (the site's screens by id); a whole-number field rounds; a pattern holds a typed value.
  func testChoicesFromAMapAndFieldsThatHoldWhatIsTyped() throws {
    let context: JSONValue = ["data": ["screens": ["s1": "shop", "s2": "/", "s3": "about"]]]
    let pick = try XCTUnwrap(
      FieldSpec(["key": "pdp", "kind": "select", "optionsFrom": ["items": "data.screens", "value": "{item.$id}", "label": "{item.$value:slashed}"]]))
    XCTAssertEqual(pick.choices(in: context).map(\.value), ["s2", "s3", "s1"])
    XCTAssertEqual(pick.choices(in: context).map(\.label), ["/", "/about", "/shop"])
    let count = try XCTUnwrap(FieldSpec(["key": "n", "kind": "number", "integer": true]))
    XCTAssertEqual(fieldJSON(count, .text("2.6")), .number(3))
    let url = try XCTUnwrap(FieldSpec(["key": "u", "kind": "url", "pattern": "^https://"]))
    XCTAssertTrue(url.unmet(.string("http://a.test"), in: [:]))
    XCTAssertFalse(url.unmet(.string("https://a.test"), in: [:]))
    XCTAssertFalse(url.unmet(.string(""), in: [:]), "an empty value is left to `required`")
  }
}

/// A reader that holds a collection of numbered rows and answers each query with as many as its limit allows.
final class RowsReader: FirestoreReader, @unchecked Sendable {
  private let lock = NSLock()
  private var seenLimits: [Int] = []
  let total: Int
  var limits: [Int] { lock.withLock { seenLimits } }
  init(total: Int) { self.total = total }

  @MainActor
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
    let limit = query.limit ?? total
    lock.withLock { seenLimits.append(limit) }
    onChange(.success((0..<min(limit, total)).map { FirestoreDocument(id: "r\($0)", data: ["n": $0]) }))
    return NoListener()
  }

  @MainActor
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
    onChange(.success(nil))
    return NoListener()
  }

  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}
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

/// Answers by what the request's URL contains, so loads that run in parallel get the right body.
final class RoutedTransport: HTTPTransport, @unchecked Sendable {
  private let routes: [(String, String)]
  init(_ routes: [(String, String)]) { self.routes = routes }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let url = request.url?.absoluteString ?? ""
    let body = routes.first { url.contains($0.0) }?.1 ?? "{}"
    let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    return (Data(body.utf8), response)
  }
}

extension JSONValue {
  /// A copy whose org is a manager, as `org.manager` reads.
  fileprivate func withManager() -> JSONValue { ScreenContext.with(self, "org", ["manager": true]) }
}
