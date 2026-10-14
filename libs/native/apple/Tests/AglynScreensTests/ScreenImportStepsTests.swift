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
    let steps = try plugin("commerce/src/ios/Sources/AglynCommercePlugin/Resources/commerce-import.screens.json")
      + plugin("email/src/ios/Sources/AglynEmailPlugin/Resources/email-import.screens.json")
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
