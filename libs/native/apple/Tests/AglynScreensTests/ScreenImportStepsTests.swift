// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import Foundation
import XCTest

@testable import AglynScreens

/// The steps a plugin adds to the import wizard (the gift card total, the email list's permission), drawn in the review's
/// `transferStep` zone and answered by asking the plan again with the answer added under `extras`, as the console's
/// wizard sends it. Kotlin replays the same cases (ScreenImportStepsTest).
@MainActor
final class ScreenImportStepsTests: XCTestCase {
  override func setUp() async throws { ScreenStash.clear() }

  override func tearDown() async throws { ScreenStash.clear() }

  private static var plugins: URL {
    ScreenSpecTests.screensDir.appendingPathComponent("../../plugins").standardizedFileURL
  }

  private func plugin(_ path: String) throws -> [ScreenSpec] {
    let url = Self.plugins.appendingPathComponent(path)
    let file = try XCTUnwrap(JSONValue.decode(try Data(contentsOf: url)))
    return file["screens"].array.compactMap(ScreenSpec.init)
  }

  private func api(_ transport: HTTPTransport) -> ConsoleAPIClient {
    ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
  }

  private func sent(_ transport: RecordingTransport, _ at: Int) throws -> JSONValue {
    try XCTUnwrap(transport.requests[at].httpBody.flatMap(JSONValue.decode))
  }

  private func action(_ screen: ScreenSpec, _ id: String) throws -> ActionSpec {
    for block in screen.blocks {
      for key in ["items", "actions"] {
        for raw in block[key].array where raw["id"]?.stringValue == id { return try XCTUnwrap(ActionSpec(raw)) }
      }
    }
    return try XCTUnwrap(nil as ActionSpec?, "no action \(id)")
  }

  /// The plan the review asked for, as the rules step keeps it for a plugin's step to ask again.
  private let planBody: JSONValue = [
    "orgId": "o1", "jobId": "j1", "mapping": ["0": "email"],
    "policy": ["record": ["onMatch": "update"], "fieldDefault": ["mode": "fillBlanks"]],
  ]

  func testTheReviewDrawsTheStepsOfThePluginThisImportBelongsTo() throws {
    let steps = try (plugin("commerce/src/ios/Sources/AglynCommercePlugin/Resources/commerce-import.screens.json")
      + plugin("email/src/ios/Sources/AglynEmailPlugin/Resources/email-import.screens.json")).filter { !$0.zones.isEmpty }
    XCTAssertEqual(steps.map(\.zones), [["transferStep"], ["transferStep"], ["transferStep"]])
    let review = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.settings.data.import.review" })
    let zone = try XCTUnwrap(review.blocks.first { $0.type == "zone" })
    XCTAssertEqual(zone["name"], "transferStep")
    // The zone hands each step the resource, the site and the job; each shows for its own resource only.
    XCTAssertEqual(Set(zone["params"].objectEntries.map(\.key)), ["resource", "hostId", "jobId"])
    func offered(_ resource: String) -> [String] {
      steps.filter { ScreenValues.condition($0.requires, in: ["stash": ["importResource": .string(resource)]]) }.map(\.id)
    }
    XCTAssertEqual(offered("commerce.gift-cards"), ["commerce.import.giftCards"])
    XCTAssertEqual(offered("email.list-members:abc123"), ["email.import.existing", "email.import.consent"])
    XCTAssertEqual(offered("data.dataset:xyz"), [])
    XCTAssertEqual(offered("crm.contacts"), [])
  }

  func testAProductImportCanAskForAiCopyOfTheProductsItCreatesAndTheJobStartsOnceTheyLand() async throws {
    let step = try XCTUnwrap(
      plugin("ai/src/ios/Sources/AglynAiPlugin/Resources/ai.screens.json").first { $0.id == "ai.import.productCopy" })
    // The step belongs to a products import, in the zone the review draws; only a manager sees it.
    XCTAssertEqual(step.zones, ["transferStep"])
    func offered(_ resource: String, manager: Bool = true) -> Bool {
      ScreenValues.condition(step.requires, in: ["stash": ["importResource": .string(resource)], "org": ["manager": .bool(manager)]])
    }
    XCTAssertTrue(offered("commerce.products"))
    XCTAssertFalse(offered("commerce.gift-cards"))
    XCTAssertFalse(offered("commerce.products", manager: false))
    // The option is offered only where the AI feature is the workspace's (the jobs route answers), as the console's is.
    let transport = RecordingTransport(responses: [(200, #"{"jobs":[]}"#), (404, #"{"error":"Not found"}"#)])
    ScreenStash.set(["importPlan": ["summary": ["create": 80]]])
    let model = ScreenModel(spec: step, context: ["org": ["id": "o1"]], api: api(transport))
    await model.load()
    XCTAssertEqual(transport.requests[0].url?.path, "/api/ai/jobs")
    XCTAssertEqual(transport.requests[0].url?.query, "orgId=o1&limit=20")
    let shown = step.blocks.filter { ScreenValues.condition($0.when, in: model.context) }
    XCTAssertEqual(shown.map(\.type), ["notice", "form", "notice"])
    XCTAssertEqual(
      ScreenValues.render(try XCTUnwrap(shown.last?["text"]?.stringValue), in: model.context), "Copy is written for the first 50 of the 80 products.")
    let hidden = ScreenModel(spec: step, context: ["org": ["id": "o1"]], api: api(transport))
    await hidden.load()
    XCTAssertEqual(step.blocks.filter { ScreenValues.condition($0.when, in: hidden.context) }.map(\.type), ["notice"])

    // Saving the choice keeps it for this import only.
    ScreenStash.clear()
    let form = try XCTUnwrap(step.blocks.first { $0.id == "copy" })
    let save = try XCTUnwrap(form["submit"].flatMap(ActionSpec.init))
    ScreenStash.set(["importJob": "j1"])
    _ = await model.run(save, in: ScreenContext.with(ScreenContext.with(model.context, "stash", .object(ScreenStash.values)), "form", ["write": true]))
    XCTAssertEqual(ScreenStash.values["importAiCopy"], true)
    XCTAssertEqual(ScreenStash.values["importAiCopyFor"], "j1")

    // Applying the import runs the hook once it is done: the created ids are read from its results and the console's
    // copy job is started for them (the first 50, one brief, the ids as `inputs`).
    ScreenCatalog.shared.add([step])
    let review = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.settings.data.import.review" })
    let apply = try action(review, "applyNow")
    XCTAssertEqual(apply.afterZone?["zone"], "transferStep")
    let results = #"{"rows":[{"outcome":"created","recordId":"p1"},{"outcome":"updated","recordId":"p9"},{"outcome":"created","recordId":"p2"},{"outcome":"created","recordId":"p1"}]}"#
    let run = RecordingTransport(responses: [(200, #"{"done":true,"progress":{"done":4}}"#), (200, results), (200, #"{"job":{"id":"a1"}}"#)])
    let applying = ScreenModel(spec: review, context: ["org": ["id": "o1"]], api: api(run))
    ScreenStash.set(["importResource": "commerce.products", "importHost": "h1"])
    let outcome = await applying.run(apply, in: ["org": ["id": "o1", "manager": true], "stash": .object(ScreenStash.values)])
    XCTAssertEqual(outcome, .done(message: nil, response: ["done": true, "progress": ["done": 4]]))
    XCTAssertEqual(run.requests.map { $0.url?.path }, ["/api/transfer/apply", "/api/transfer/status", "/api/ai/jobs"])
    XCTAssertEqual(try sent(run, 1), ["orgId": "o1", "jobId": "j1", "include": "results"])
    XCTAssertEqual(
      try sent(run, 2),
      ["orgId": "o1", "hostId": "h1", "kind": "products", "brief": "Write storefront copy for 2 products",
        "inputs": ["target": "bulk", "productIds": "p1,p2"]])
    XCTAssertEqual(
      ScreenStash.values["importAfter"],
      "AI is writing descriptions, search listings and tags for the new products. You review them on the products page before any is saved.")

    // An import that did not ask, or asked for another import, starts nothing.
    ScreenStash.set(["importAiCopy": .null, "importAfter": .null])
    let quiet = RecordingTransport(responses: [(200, #"{"done":true}"#)])
    _ = await ScreenModel(spec: review, context: [:], api: api(quiet)).run(apply, in: ["org": ["id": "o1", "manager": true], "stash": .object(ScreenStash.values)])
    XCTAssertEqual(quiet.requests.count, 1)
    XCTAssertNil(ScreenStash.values["importAfter"])
    // The done screen says what the hooks said.
    let done = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.settings.data.import.done" })
    XCTAssertTrue(done.blocks.contains { $0.when == "stash.importAfter" })
  }

  func testAnAudienceImportsAndExportsItsMembersAndResumesAnImportItLeft() async throws {
    let transfer = try XCTUnwrap(
      plugin("email/src/ios/Sources/AglynEmailPlugin/Resources/email-import.screens.json").first { $0.id == "email.list.transfer" })
    let jobs = #"""
      {"unfinished":[
        {"jobId":"j1","resource":"email.list-members:abc","fileName":"spring.csv","label":"Members","status":"analyzed","updatedAt":1791385440000},
        {"jobId":"j2","resource":"email.list-members:other","fileName":"other.csv","label":"Members","status":"draft","updatedAt":1791385440000}]}
      """#
    let transport = RecordingTransport(responses: [(200, jobs)])
    let model = ScreenModel(
      spec: transfer, context: ["org": ["id": "o1", "manager": true], "site": ["id": "h1"],
        "params": ["list": "abc", "name": "Spring sale", "resource": "email.list-members:abc"]], api: api(transport))
    await model.load()
    XCTAssertEqual(try sent(transport, 0), ["orgId": "o1", "unfinished": true])
    // Import runs the records wizard on this list, titled as the console titles it.
    let scope = model.context
    let start = try action(transfer, "import")
    let navigate = try XCTUnwrap(start.navigate)
    XCTAssertEqual(navigate.screen, "core.settings.data.import")
    XCTAssertEqual(
      navigate.params.mapValues { ScreenValues.render($0, in: scope) },
      ["resource": "email.list-members:abc", "hostId": "h1", "title": "Import into Spring sale"])
    // Export opens the shared export sheet on the same list.
    let export = try XCTUnwrap(action(transfer, "export").exportRequest(in: scope))
    XCTAssertEqual([export.resource, export.title, export.hostID], ["email.list-members:abc", "Export Spring sale", "h1"])
    // Only this list's unfinished imports are offered to resume.
    let list = try XCTUnwrap(transfer.blocks.first { $0.title == "Resume import" })
    let rows = ScreenValues.scopes(items: list["items"]?.stringValue ?? "", within: nil, filter: list["filter"]?.stringValue, in: scope)
    XCTAssertEqual(rows.map { ScreenValues.render(list["primary"]?.stringValue ?? "", in: $0) }, ["spring.csv"])
    // The audience's own menu opens this screen; the wizard's title is a parameter.
    let wizard = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.settings.data.import" })
    XCTAssertEqual(ScreenValues.render(wizard.title, in: ["params": ["title": "Import into Spring sale"]]), "Import into Spring sale")
    XCTAssertEqual(ScreenValues.render(wizard.title, in: ["params": [:]]), "Import records")
  }

  func testTheRulesStepKeepsThePlanItAskedForSoAStepCanAskAgain() async throws {
    let rules = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.settings.data.import.rules" })
    let form = try XCTUnwrap(rules.blocks.first { $0.id == "policy" })
    let submit = try XCTUnwrap(form["submit"].flatMap(ActionSpec.init))
    let transport = RecordingTransport(responses: [(200, #"{"summary":{"create":2}}"#)])
    let model = ScreenModel(spec: rules, context: [:], api: api(transport))
    ScreenStash.set(["importJob": "j1", "importMapping": ["0": "email"], "importExtras": ["email-existing": ["updateContacts": false]]])
    let scope: JSONValue = [
      "org": ["id": "o1"], "stash": .object(ScreenStash.values),
      "form": ["onMatch": "update", "onNew": "create", "onAmbiguous": "ask", "mode": "fillBlanks", "blank": "leave"],
    ]
    _ = await model.run(submit, in: scope)
    let body = try sent(transport, 0)
    // What a plugin's earlier answers were is part of the plan, and the same body is what the step asks again with.
    XCTAssertEqual(body["extras"], ["email-existing": ["updateContacts": false]])
    XCTAssertEqual(ScreenStash.values["importPlanBody"], body)
    XCTAssertEqual(ScreenStash.values["importPlan"]?["summary"]?["create"], 2)
  }

  func testTheGiftCardTotalIsTypedBackAndSentWithThePlanAgain() async throws {
    let step = try XCTUnwrap(
      plugin("commerce/src/ios/Sources/AglynCommercePlugin/Resources/commerce-import.screens.json").first)
    ScreenStash.set(["importPlanBody": planBody, "importPlan": ["summary": ["create": 2]]])
    let rows = #"{"rows":{"rows":[{"giftCard":{"code":"AAA","amountCents":2500,"totalCents":6000,"recipientEmail":"a@example.test"}},{"giftCard":{"code":"BBB","amountCents":3500,"totalCents":6000}}],"next":null}}"#
    let transport = RecordingTransport(responses: [(200, rows), (200, #"{"summary":{"create":2},"acknowledgementsRequired":[]}"#)])
    let model = ScreenModel(
      spec: step, context: ["org": ["id": "o1"], "params": ["jobId": "j1"], "stash": .object(ScreenStash.values)], api: api(transport))
    await model.load()
    XCTAssertEqual(
      try sent(transport, 0), ["orgId": "o1", "jobId": "j1", "action": "rows", "limit": 200, "verdicts": ["create"]])
    XCTAssertEqual(transport.requests[0].url?.path, "/api/transfer/plan")
    // The form is offered once every card is loaded, and only the exact total passes.
    let confirm = try XCTUnwrap(step.blocks.first { $0.id == "confirm" })
    XCTAssertTrue(ScreenValues.condition(confirm.when, in: model.context))
    let typed = try XCTUnwrap(confirm["fields"].array.compactMap(FieldSpec.init).first { $0.key == "typed" })
    XCTAssertFalse(typed.unmet("$60.00", in: model.context))
    XCTAssertTrue(typed.unmet("$59.00", in: model.context))
    XCTAssertTrue(typed.unmet("", in: model.context))
    // A total is read as dollars, as the console reads it: the sign and the cents are optional.
    for accepted in ["60", "$60", "60.00", "$60.00", " 60 ", "60 USD", "usd 60"] {
      XCTAssertFalse(typed.unmet(.string(accepted), in: model.context), accepted)
    }
    for refused in ["59.99", "sixty", "$60.001", "-60"] {
      XCTAssertTrue(typed.unmet(.string(refused), in: model.context), refused)
    }
    XCTAssertTrue(typed.mismatches("59", in: model.context))
    XCTAssertFalse(typed.mismatches("60", in: model.context))
    XCTAssertEqual(ScreenValues.render(try XCTUnwrap(typed.mismatch), in: model.context), "That is not the total. These cards add up to $60.00.")
    // Confirming asks the same plan again with the answer under the step's id, and keeps it for the steps after.
    let submit = try XCTUnwrap(confirm["submit"].flatMap(ActionSpec.init))
    var scope = ScreenContext.with(model.context, "form", ["typed": "$60.00", "email": true])
    scope = ScreenContext.with(scope, "stash", .object(ScreenStash.values))
    let outcome = await model.run(submit, in: scope)
    XCTAssertEqual(outcome, .done(message: "Confirmed", response: ["summary": ["create": 2], "acknowledgementsRequired": []]))
    let body = try sent(transport, 1)
    XCTAssertEqual(body["jobId"], "j1")
    XCTAssertEqual(body["mapping"], ["0": "email"])
    XCTAssertEqual(body["extras"], ["gift-card-total": ["typed": "$60.00", "totalCents": 6000, "email": true]])
    XCTAssertEqual(ScreenStash.values["importExtras"], body["extras"])
    XCTAssertEqual(ScreenStash.values["importPlanBody"], body)
  }

  func testTheListImportSendsItsAnswersUnderTheConsolesKeysAndKeepsEachOther() async throws {
    let steps = try plugin("email/src/ios/Sources/AglynEmailPlugin/Resources/email-import.screens.json")
    let existing = try XCTUnwrap(steps.first { $0.id == "email.import.existing" })
    let consent = try XCTUnwrap(steps.first { $0.id == "email.import.consent" })
    ScreenStash.set(["importPlanBody": planBody])
    let transport = RecordingTransport(responses: [
      (200, #"{"summary":{"create":1}}"#), (200, #"{"summary":{"create":1}}"#),
      (200, #"{"listName":"News","screening":{"roleAccounts":2,"roleAccountSamples":["info@x.test","sales@x.test"],"purchaseTellColumns":[],"declaresBasis":false,"sample":{"size":3,"of":3,"optedIn":1,"needAttestation":2,"refused":0}}}"#),
      (200, #"{"summary":{"create":1}}"#),
    ])
    // The people already held: the toggle says whether the file may change their details.
    let model = ScreenModel(spec: existing, context: [:], api: api(transport))
    let form = try XCTUnwrap(existing.blocks.first { $0.id == "existing" })
    _ = await model.run(try XCTUnwrap(form["submit"].flatMap(ActionSpec.init)), in: ["stash": .object(ScreenStash.values), "form": ["update": true]])
    XCTAssertEqual(try sent(transport, 0)["extras"], ["email-existing": ["updateContacts": true]])
    // The statement of permission, both ways; the earlier answer rides along.
    let asking = ScreenModel(spec: consent, context: [:], api: api(transport))
    let only = try action(consent, "only")
    _ = await asking.run(only, in: ["stash": .object(ScreenStash.values)])
    XCTAssertEqual(
      try sent(transport, 1)["extras"], ["email-existing": ["updateContacts": true], "email-consent": ["attest": false]])
    let attest = try action(consent, "attest")
    XCTAssertTrue(attest.asksConfirmation)
    XCTAssertEqual(
      attest.confirmText(in: [:]),
      "I have these people\u{2019}s permission to send them marketing email, and I can produce the record of it if asked. This statement is stored against my account, with today\u{2019}s date, on every address it admits.")
    // What the file holds is read for this list and job, from the resource key's instance.
    let reading = ScreenModel(
      spec: consent, context: ["params": ["resource": "email.list-members:abc123", "hostId": "h1", "jobId": "j1"], "stash": .object(ScreenStash.values)],
      api: api(transport))
    await reading.load()
    XCTAssertEqual(transport.requests[2].url?.path, "/api/email/list-import-screening")
    XCTAssertEqual(try sent(transport, 2), ["hostId": "h1", "listId": "abc123", "jobId": "j1"])
    let warned = consent.blocks.filter { $0.type == "notice" && ScreenValues.condition($0.when, in: reading.context) }
      .compactMap { $0["text"]?.stringValue.map { ScreenValues.render($0, in: reading.context) } }
    XCTAssertTrue(warned.contains { $0.hasPrefix("2 shared mailboxes. Addresses like info@x.test, sales@x.test") })
    XCTAssertTrue(warned.contains { $0.contains("1 already have an opt-in on record, 2 have no opt-in on record") })
    _ = await asking.run(attest, in: ["stash": .object(ScreenStash.values)])
    XCTAssertEqual(try sent(transport, 3)["extras"]?["email-consent"], ["attest": true])
  }
}
