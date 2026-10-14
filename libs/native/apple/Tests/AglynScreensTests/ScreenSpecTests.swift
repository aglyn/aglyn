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
    // Every screen a spec opens or navigates to exists: a spec, or one a plugin draws by hand.
    let handWritten: Set<String> = ["commerce.orders", "commerce.order", "commerce.products", "commerce.product", "commerce.sales"]
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
          "optionsFrom": ["items": "data.accounts", "where": "item.classification == bank", "value": "{item.id}", "label": "{item.name}"],
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
