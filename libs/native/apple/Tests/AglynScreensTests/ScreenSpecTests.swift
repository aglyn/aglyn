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
        let known = Set(["fields", "meters", "list", "form", "actions", "links", "notice", "zone"])
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
    let counted = try await FirestoreLoads.query(Counting(), ["collection": "hosts/{site.id}/layouts", "count": true], in: context)
    XCTAssertEqual(counted["count"], 7)
    let rows = try await FirestoreLoads.query(Counting(), ["collection": "hosts/{site.id}/forms", "count": true], in: context)
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
    // The AI add-on is dropped where the target does not sell it, and over-limit counts are named.
    var data = base["data"] ?? .null
    data = ScreenContext.with(data, "org", ["plan": "pro", "subscription": ["status": "active"], "seatAddons": ["aiAddon": 1]])
    data = ScreenContext.with(data, "seats", ["managerSeats": 7])
    base = ScreenContext.with(base, "item", ["id": "free", "label": "Free"])
    let text = quote(["downgrade": true, "periodEnd": "2026-11-01T00:00:00Z", "droppedAddons": ["aiAddon"]], data: data)
    XCTAssertTrue(text.contains("Your Aglyn AI add-on is not sold on Free, so it is removed"))
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
