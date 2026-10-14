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

  func testTheBusinessProfileOwnerWriteReplaysTheConsolesAnswers() throws {
    let url = Self.screensDir.deletingLastPathComponent().appendingPathComponent("contracts/function-cases.generated.json")
    let file = try XCTUnwrap(JSONValue.decode(try Data(contentsOf: url)))
    let cases = file["functions"]?["businessProfileOwnerWrite"]?["cases"].array ?? []
    XCTAssertFalse(cases.isEmpty)
    for entry in cases {
      let args = entry["args"].array
      let current: JSONValue? = args.first == .null ? nil : args.first
      let got = BusinessProfile.ownerWrite(current: current, edited: args.last ?? .null)
      XCTAssertEqual(JSONValue.object(got), entry["result"], "\(args)")
    }
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
