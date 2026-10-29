// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import Foundation
import XCTest

@testable import AglynScreens

/// Publishing the site as a template (`libs/plugins/marketplace/src/android/screens/marketplace.screens.json`):
/// the zone it fills on Backup & restore, the publisher agreement every publish agrees to with its own box (AGL-4105), and
/// the routes it calls. Kotlin replays the same cases (MarketplacePublishTest).
@MainActor
final class MarketplacePublishTests: XCTestCase {
  private func spec(_ id: String) throws -> ScreenSpec {
    let url = ScreenSpecTests.screensDir.appendingPathComponent("../../plugins/marketplace/src/android/screens/marketplace.screens.json")
      .standardizedFileURL
    let file = try XCTUnwrap(JSONValue.decode(try Data(contentsOf: url)))
    return try XCTUnwrap(ScreenSpec(try XCTUnwrap(file["screens"].array.first { $0["id"]?.stringValue == id })))
  }

  private func api(_ transport: RecordingTransport) -> ConsoleAPIClient {
    ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
  }

  /// The screen's context as the loaded page has it: its constants, the profile document, the role, and the flags its
  /// `derive` list works out (the same loop the model runs after a load).
  private func shown(_ screen: ScreenSpec, profile: JSONValue?, manager: Bool = true, members: JSONValue? = nil) -> (JSONValue, [BlockSpec]) {
    var context: JSONValue = [
      "org": ["id": "o1", "manager": .bool(manager)], "site": ["id": "h1"],
      "data": ["profile": profile ?? .null, "members": members ?? .null],
    ]
    context = ScreenContext.with(context, "const", screen.raw["constants"] ?? [:])
    var flags: [String: JSONValue] = [:]
    for entry in screen.raw["derive"].array {
      let seen = ScreenContext.with(context, "is", .object(flags))
      flags[entry["name"]?.stringValue ?? ""] = .bool(ScreenValues.condition(entry["when"]?.stringValue, in: seen))
    }
    context = ScreenContext.with(context, "is", .object(flags))
    return (context, screen.blocks.filter { ScreenValues.condition($0.when, in: context) })
  }

  /// `scope` with the screen's constants under `const`, as the model's own context carries them.
  private func withConstants(_ scope: JSONValue, _ screen: ScreenSpec) -> JSONValue {
    ScreenContext.with(scope, "const", screen.raw["constants"] ?? [:])
  }

  /// The version in force, as the screens' constants carry it.
  private func agreementVersion(_ screen: ScreenSpec) -> JSONValue {
    ScreenValues.lookup("const.agreement.version", in: withConstants(["x": 1], screen)) ?? .null
  }

  private func texts(_ blocks: [BlockSpec], _ context: JSONValue) -> [String] {
    blocks.filter { $0.type == "notice" }.compactMap { $0["text"]?.stringValue.map { ScreenValues.render($0, in: context) } }
  }

  func testTheSiteTemplateIsAContributionToTheBackupScreensZone() throws {
    let contribution = try spec("marketplace.publishTemplate")
    XCTAssertEqual(contribution.zones, ["siteTemplate"])
    XCTAssertEqual(contribution.label, "Publish as template")
    let backup = try XCTUnwrap(CoreScreens.specs.first { $0.id == "core.site.backup" })
    XCTAssertEqual(backup.blocks.filter { $0.type == "zone" }.compactMap { $0["name"]?.stringValue }, ["siteTemplate"])
  }

  func testEveryPublishAsksForTheAgreementInABoxAboveItsButton() throws {
    for id in [
      "marketplace.publishTemplate", "marketplace.publishLayout", "marketplace.publishComponent", "marketplace.publishTheme",
      "marketplace.publishDatasetSchema", "marketplace.publishEmailTemplate", "marketplace.publishEmailStarter", "marketplace.publishPlugin",
    ] {
      let publish = try spec(id)
      let form = try XCTUnwrap(publish.blocks.first { $0.type == "form" })
      let fields = form["fields"].array.compactMap(FieldSpec.init)
      // The last field, nearest the button: one choice, which must be chosen before the form can send.
      let box = try XCTUnwrap(fields.last, id)
      XCTAssertEqual(box.key, "agreement", id)
      XCTAssertEqual(box.options.map { $0.label }, ["I agree to the Marketplace Publisher Agreement"], id)
      XCTAssertTrue(box.unmet(.array([]), in: [:]), id)
      XCTAssertFalse(box.unmet(["agreed"], in: [:]), id)
      // Whatever the organization agreed to before, every publish asks: no notice about its standing, and the agreement is
      // always a link away.
      for profile: JSONValue? in [nil, ["handle": "studio"], ["handle": "studio", "publisherAgreement": ["version": agreementVersion(publish)]]] {
        let (context, blocks) = shown(publish, profile: profile)
        XCTAssertEqual(texts(blocks, context).filter { $0.contains("terms") }, [], id)
        let links = blocks.filter { $0.type == "links" }.flatMap { $0["items"].array }.compactMap { $0["title"]?.stringValue }
        XCTAssertTrue(links.contains("Read the Marketplace Publisher Agreement"), id)
      }
    }
  }

  func testTheAgreementShowsWhatChangedSinceTheVersionLastAgreedToAndAsksForNothingItself() throws {
    let agreement = try spec("marketplace.publisherAgreement")
    let changes = try XCTUnwrap(agreement.blocks.first { $0.title?.hasPrefix("What changed") == true })
    func changed(since accepted: String) -> [String] {
      let (context, _) = shown(agreement, profile: ["handle": "s", "publisherAgreement": ["version": .string(accepted)]])
      return ScreenValues.scopes(items: changes["items"]?.stringValue ?? "", within: changes["within"]?.stringValue, filter: changes["filter"]?.stringValue, in: context)
        .map { ScreenValues.render(changes["secondary"]?.stringValue ?? "", in: $0) }
    }
    // Only the versions after the one last agreed to, each change under the version that made it.
    XCTAssertEqual(changed(since: "2026-08-18.1"), ["Version 2026-08-24.1"])
    XCTAssertEqual(changed(since: "2026-01-01.1").count, 5)
    XCTAssertEqual(changed(since: "2026-08-24.1"), [])

    // It says every save asks, and when the organization last agreed; there is nothing to accept here.
    let everySave =
      "Every save in the marketplace — your profile, a listing, its price or visibility, a new version, a component, template or layout — asks you to tick “I agree to the Marketplace Publisher Agreement” first. We record who agreed, to which version, and when."
    let (stale, staleBlocks) = shown(agreement, profile: ["handle": "s", "publisherAgreement": ["version": "2026-08-18.1"]])
    XCTAssertEqual(
      texts(staleBlocks, stale),
      [everySave, "Your organization last agreed to version 2026-08-18.1. Your next save agrees to version 2026-08-24.1."])
    let (never, neverBlocks) = shown(agreement, profile: ["handle": "s"])
    XCTAssertEqual(texts(neverBlocks, never), [everySave])
    XCTAssertFalse(agreement.blocks.contains { block in block["items"].array.contains { $0["url"] != nil } })
  }

  func testPublishingSendsTheListingTheRouteTakesAndTheAgreementItWasTickedFor() async throws {
    let publish = try spec("marketplace.publishTemplate")
    let form = try XCTUnwrap(publish.blocks.first { $0.type == "form" })
    let submit = try XCTUnwrap(form["submit"].flatMap(ActionSpec.init))
    let transport = RecordingTransport(responses: [(200, #"{"ok":true,"version":3}"#), (200, #"{"ok":true,"version":1}"#)])
    let model = ScreenModel(spec: publish, context: [:], api: api(transport))
    let paid = withConstants(
      ["site": ["id": "h1"], "form": ["name": "Studio", "description": "A portfolio", "category": "Portfolio", "price": 5, "agreement": ["agreed"]]],
      publish)
    let outcome = await model.run(submit, in: paid)
    XCTAssertEqual(outcome, .done(message: "Published v3 to the marketplace", response: ["ok": true, "version": 3]))
    XCTAssertEqual(transport.requests[0].url?.path, "/api/marketplace/publish-template")
    let body = try XCTUnwrap(transport.requests[0].httpBody.flatMap(JSONValue.decode))
    XCTAssertEqual(
      body,
      [
        "hostId": "h1", "displayName": "Studio", "description": "A portfolio", "category": "Portfolio", "priceUsd": 5,
        "agreement": ["version": agreementVersion(publish), "accepted": true],
      ])
    // A price left blank is not sent as a number: the route reads it as free. Unticked, the agreement says only its version,
    // which the route refuses.
    _ = await model.run(submit, in: withConstants(["site": ["id": "h1"], "form": ["name": "Free one"]], publish))
    let free = try XCTUnwrap(transport.requests[1].httpBody.flatMap(JSONValue.decode))
    XCTAssertEqual(free["displayName"], "Free one")
    XCTAssertNil(free["priceUsd"]?.numberValue)
    XCTAssertEqual(free["agreement"], ["version": agreementVersion(publish)])
    // The name is required; the price field states the floor.
    XCTAssertTrue(try XCTUnwrap(form["fields"].array.compactMap(FieldSpec.init).first { $0.key == "name" }).required)
    let price = try XCTUnwrap(form["fields"].array.compactMap(FieldSpec.init).first { $0.key == "price" })
    XCTAssertTrue(try XCTUnwrap(price.help).hasPrefix("0 for free, or $"))
  }

  func testEveryOtherKindPublishesWithWhatItIsAndTheListingTheRouteTakes() async throws {
    // Each kind: the screen, the route, and the fields that say which one it is.
    let kinds: [(String, String, [String: JSONValue])] = [
      ("marketplace.publishLayout", "/api/marketplace/publish-layout", ["hostId": "h1", "layoutId": "x1"]),
      ("marketplace.publishComponent", "/api/marketplace/publish", ["hostId": "h1", "componentId": "x1"]),
      ("marketplace.publishTheme", "/api/marketplace/publish-theme", ["hostId": "h1"]),
      ("marketplace.publishDatasetSchema", "/api/marketplace/publish-dataset-schema", ["orgId": "o1", "datasetId": "x1"]),
      ("marketplace.publishEmailTemplate", "/api/marketplace/publish-email-template", ["hostId": "h1", "templateKey": "x1"]),
      ("marketplace.publishEmailStarter", "/api/marketplace/publish-email-starter", ["hostId": "h1", "screenId": "x1"]),
    ]
    for (id, route, identity) in kinds {
      let publish = try spec(id)
      let form = try XCTUnwrap(publish.blocks.first { $0.type == "form" })
      let submit = try XCTUnwrap(form["submit"].flatMap(ActionSpec.init))
      let transport = RecordingTransport(responses: [(200, #"{"ok":true,"version":2}"#)])
      let model = ScreenModel(spec: publish, context: [:], api: api(transport))
      let context = withConstants(
        [
          "org": ["id": "o1"], "site": ["id": "h1"], "params": ["id": "x1"],
          "form": ["name": "Hero", "description": "A hero", "category": "Hero", "price": 0, "agreement": ["agreed"]],
        ], publish)
      let outcome = await model.run(submit, in: context)
      XCTAssertEqual(outcome, .done(message: "Published v2 to the marketplace", response: ["ok": true, "version": 2]), id)
      // A route refusal opens nothing any more: the agreement is the box in the form.
      XCTAssertNil(submit.gate, id)
      XCTAssertEqual(transport.requests[0].url?.path, route, id)
      let body = try XCTUnwrap(transport.requests[0].httpBody.flatMap(JSONValue.decode))
      var expected = identity
      expected["displayName"] = "Hero"
      expected["description"] = "A hero"
      expected["category"] = "Hero"
      expected["priceUsd"] = 0
      expected["agreement"] = ["version": agreementVersion(publish), "accepted": true]
      XCTAssertEqual(body, .object(expected), id)
      // The form opens with the name and description the thing already has, handed over as the screen's parameters.
      let fields = form["fields"].array.compactMap(FieldSpec.init)
      let params: JSONValue = ["params": ["name": "Hero band", "description": "The top of the page"]]
      XCTAssertEqual(
        ["name", "description"].map { key in ScreenValues.render(fields.first { $0.key == key }?.initial ?? "", in: params) },
        ["Hero band", "The top of the page"], id)
      XCTAssertTrue(try XCTUnwrap(fields.first { $0.key == "name" }).required, id)
    }
    XCTAssertEqual(try spec("marketplace.publishDatasetSchema").scope, "org")
    XCTAssertEqual(try spec("marketplace.publishLayout").scope, "site")
    XCTAssertTrue(try spec("marketplace.publishLayout").zones.isEmpty)
  }

  func testThePublishHubListsWhatThisSiteAndTheWorkspaceCanPublishAndOpensTheRightForm() throws {
    let hub = try spec("marketplace.publish")
    let context: JSONValue = [
      "site": ["id": "h1"], "org": ["id": "o1"],
      "data": [
        "components": ["items": [["$id": "c1", "displayName": "Hero", "description": "Top band"], ["$id": "c2", "displayName": "Gone", "deletedAt": 1]]],
        "layouts": ["items": [["$id": "l1", "displayName": "Main"]]],
        "emails": ["items": [["$id": "e1", "displayName": "Receipt", "versionId": "v1"], ["$id": "e2", "displayName": "Never saved"]]],
        "emailScreens": ["items": [["$id": "s1", "displayName": "Welcome", "versionId": "v1", "deletedAt": .null]]],
        "datasets": ["items": [["$id": "d1", "name": "Menu items"], ["$id": "d2", "displayName": "Staff"]]],
      ],
    ]
    func rows(_ title: String) throws -> [(name: String, screen: String, params: [String: String])] {
      let block = try XCTUnwrap(hub.blocks.first { $0.title == title })
      let open = try XCTUnwrap(block["open"])
      return ScreenValues.scopes(items: block["items"]?.stringValue ?? "", within: nil, filter: block["filter"]?.stringValue, in: context).map { scope in
        (
          ScreenValues.render(block["primary"]?.stringValue ?? "", in: scope), open["screen"]?.stringValue ?? "",
          renderParams(open["params"], in: scope)
        )
      }
    }
    let components = try rows("Components")
    XCTAssertEqual(components.map(\.name), ["Hero"])
    XCTAssertEqual(components.first?.screen, "marketplace.publishComponent")
    XCTAssertEqual(components.first?.params, ["id": "c1", "name": "Hero", "description": "Top band"])
    XCTAssertEqual(try rows("Layouts").map(\.name), ["Main"])
    // Only an email with a saved design can be published: a design that was opened and never saved has nothing to publish.
    XCTAssertEqual(try rows("Email templates").map(\.name), ["Receipt"])
    XCTAssertEqual(try rows("Emails").map(\.name), ["Welcome"])
    XCTAssertEqual(try rows("Emails").first?.screen, "marketplace.publishEmailStarter")
    // A dataset is named as the Data page names it.
    XCTAssertEqual(try rows("Dataset schemas").map(\.name), ["Menu items", "Staff"])
    let links = try XCTUnwrap(hub.blocks.first { $0.type == "links" && $0.when == nil })
    XCTAssertEqual(
      links["items"].array.compactMap { $0["screen"]?.stringValue }, ["marketplace.publishTemplate", "marketplace.publishTheme", "marketplace.publishPlugin"])
  }

  func testAPublishRefusedForTheAgreementSaysWhyInTheRoutesWords() async throws {
    let publish = try spec("marketplace.publishTemplate")
    let submit = try XCTUnwrap(publish.blocks.first { $0.type == "form" }?["submit"].flatMap(ActionSpec.init))
    let refusal = #"{"error":"Tick 'I agree to the Marketplace Publisher Agreement' to save","agreement":{"required":"2026-08-24.1","state":"missing"}}"#
    let transport = RecordingTransport(responses: [(428, refusal)])
    let model = ScreenModel(spec: publish, context: [:], api: api(transport))
    let outcome = await model.run(submit, in: withConstants(["site": ["id": "h1"], "form": ["name": "Studio"]], publish))
    XCTAssertEqual(outcome, .failed("Tick 'I agree to the Marketplace Publisher Agreement' to save"))
  }

  func testAPluginPublishesItsBundleBytesManifestListingAndEveryStatementThroughThePublishRoute() async throws {
    let publish = try spec("marketplace.publishPlugin")
    XCTAssertEqual(publish.scope, "org")
    let form = try XCTUnwrap(publish.blocks.first { $0.type == "form" })
    let fields = form["fields"].array.compactMap(FieldSpec.init)
    func field(_ key: String) throws -> FieldSpec { try XCTUnwrap(fields.first { $0.key == key }) }
    // The bundle travels as its bytes, base64, the way the console's `fileToBase64` sends it; the manifest is read as JSON.
    let bytes = Data([0x63, 0x6F, 0x6E, 0x73, 0x74, 0x00, 0xFF])
    XCTAssertEqual(fieldJSON(try field("bundle"), .file(name: "w.js", text: bytes.base64EncodedString())), .string("Y29uc3QA/w=="))
    XCTAssertEqual(
      fieldJSON(try field("manifest"), .file(name: "m.json", text: #"{"id":"acme-widget","name":"Widget","version":"1.0.0","entry":"index.js"}"#)),
      ["id": "acme-widget", "name": "Widget", "version": "1.0.0", "entry": "index.js"])
    // Every statement must be confirmed; each says what it means under its label.
    let first = try field("attested")
    XCTAssertTrue(first.unmet(.array(first.options.dropLast().map { .string($0.value) }), in: [:]))
    XCTAssertFalse(first.unmet(.array(first.options.map { .string($0.value) }), in: [:]))
    XCTAssertFalse(first.options.contains { $0.value == "changelog" }, "the changelog statement is an update's")
    XCTAssertEqual(try field("attestedUpdate").options.last?.value, "changelog")
    XCTAssertNotNil(first.detail(for: "repository", in: [:]))

    let attested: JSONValue = .array(first.options.map { .string($0.value) })
    let submit = try XCTUnwrap(form["submit"].flatMap(ActionSpec.init))
    let transport = RecordingTransport(responses: [(200, #"{"ok":true,"version":"1.0.0","listingId":"l9"}"#), (200, #"{"ok":true,"version":"1.0.0","listingId":"l9"}"#)])
    let model = ScreenModel(spec: publish, context: [:], api: api(transport))
    let base: [String: JSONValue] = [
      "bundle": "Y29uc3QA/w==", "manifest": ["id": "acme-widget", "name": "Widget"], "name": "", "description": "Counts down",
      "category": "", "readme": "", "changelog": "First", "repositoryUrl": "https://github.com/acme/widget", "license": "MIT",
      "visibility": "public", "price": 5, "attested": attested, "agreement": ["agreed"],
    ]
    let outcome = await model.run(submit, in: withConstants(["org": ["id": "o1"], "params": [:], "form": .object(base)], publish))
    XCTAssertEqual(outcome, .done(message: "Published v1.0.0 — it is queued for review", response: ["ok": true, "version": "1.0.0", "listingId": "l9"]))
    XCTAssertEqual(transport.requests[0].url?.path, "/api/marketplace/publish-plugin")
    let body = try XCTUnwrap(transport.requests[0].httpBody.flatMap(JSONValue.decode))
    // The listing name falls back to the manifest's; an empty README and category are left out, as the console leaves them.
    XCTAssertEqual(
      body,
      [
        "orgId": "o1", "bundle": "Y29uc3QA/w==", "manifest": ["id": "acme-widget", "name": "Widget"], "displayName": "Widget",
        "description": "Counts down", "changelog": "First", "priceUsd": 5, "visibility": "public", "attestation": attested,
        "license": "MIT", "repositoryUrl": "https://github.com/acme/widget",
        "agreement": ["version": agreementVersion(publish), "accepted": true],
      ])
    // A private plugin is free whatever the price field held.
    var privately = base
    privately["visibility"] = "private"
    _ = await model.run(submit, in: withConstants(["org": ["id": "o1"], "params": [:], "form": .object(privately)], publish))
    XCTAssertEqual(try XCTUnwrap(transport.requests[1].httpBody.flatMap(JSONValue.decode))["priceUsd"], 0)
    // Opens the listing it published.
    XCTAssertEqual(submit.navigate?.screen, "marketplace.listing")
    XCTAssertEqual(submit.navigate?.params, ["listing": "{response.listingId}"])
  }

  func testAPluginRefusedByTheVerifierSaysWhatItFoundAndTheAgreementLikeEveryPublish() async throws {
    let publish = try spec("marketplace.publishPlugin")
    let submit = try XCTUnwrap(publish.blocks.first { $0.type == "form" }?["submit"].flatMap(ActionSpec.init))
    let refusal = #"{"error":"Tick 'I agree to the Marketplace Publisher Agreement' to save","agreement":{"required":"2026-08-24.1","state":"missing"}}"#
    let problems = #"{"error":"Bundle rejected","problems":[{"level":"error","check":"network","message":"Calls an undeclared host"},{"level":"error","message":"Too large"}]}"#
    let transport = RecordingTransport(responses: [(428, refusal), (422, problems)])
    let model = ScreenModel(spec: publish, context: [:], api: api(transport))
    let scope = withConstants(["org": ["id": "o1"], "params": [:], "form": ["bundle": "eA==", "manifest": ["id": "w"], "name": "W"]], publish)
    let refused = await model.run(submit, in: scope)
    XCTAssertEqual(refused, .failed("Tick 'I agree to the Marketplace Publisher Agreement' to save"))
    let failed = await model.run(submit, in: scope)
    XCTAssertEqual(failed, .failed("Bundle rejected\nBundle failed verification\nnetwork: Calls an undeclared host\nToo large"))
  }

  func testANewVersionStartsFromTheListingAndSaysWhatInstallsToday() throws {
    let publish = try spec("marketplace.publishPlugin")
    func notices(_ listing: JSONValue, revocation: JSONValue = .null) -> [String] {
      var (context, _) = shown(publish, profile: ["handle": "studio", "publisherAgreement": ["version": publish.raw["constants"]?["agreement"]?["version"] ?? .null]])
      context = ScreenContext.with(context, "params", ["listing": "l1"])
      context = ScreenContext.with(context, "data", ["listing": listing, "revocation": revocation])
      var flags: [String: JSONValue] = [:]
      for entry in publish.raw["derive"].array {
        flags[entry["name"]?.stringValue ?? ""] = .bool(ScreenValues.condition(entry["when"]?.stringValue, in: ScreenContext.with(context, "is", .object(flags))))
      }
      context = ScreenContext.with(context, "is", .object(flags))
      return texts(publish.blocks.filter { ScreenValues.condition($0.when, in: context) }, context)
    }
    XCTAssertEqual(
      notices(["latestApprovedVersion": "2"]),
      [
        "v2 is what installs today. It keeps installing until a reviewer approves this one — nobody is upgraded onto unreviewed code, and nothing you publish here can change a version already installed."
      ])
    // A stopped version installs nowhere, and neither does a listing whose every version is stopped.
    let enters = ["This version enters review. Nothing installs until a reviewer approves it."]
    XCTAssertEqual(notices(["latestApprovedVersion": "2"], revocation: ["versions": ["2"]]), enters)
    XCTAssertEqual(notices(["latestApprovedVersion": "2"], revocation: ["versions": "all"]), enters)
    XCTAssertEqual(notices(["latestVersion": "1"]), enters)
    // Who can install it is the listing's, so a new version does not ask.
    let fields = publish.blocks.first { $0.type == "form" }?["fields"].array.compactMap(FieldSpec.init) ?? []
    XCTAssertEqual(fields.first { $0.key == "visibility" }?.when, "!params.listing")
    XCTAssertEqual(fields.first { $0.key == "name" }?.initial, "{data.listing.displayName}")
  }

  func testThePublishHubStatesWhatAglynKeepsOnThisPlan() throws {
    let hub = try spec("marketplace.publish")
    XCTAssertEqual(hub.raw["load"]?["fee"]?["takeRate"], "marketplace")
    func shownFee(_ pct: Double) -> [String] {
      let context: JSONValue = ["site": ["id": "h1"], "org": ["id": "o1"], "data": ["fee": ["pct": .number(pct), "paid": 20]]]
      return texts(hub.blocks.filter { ScreenValues.condition($0.when, in: context) }, context).filter { $0.contains("keeps") }
    }
    XCTAssertEqual(shownFee(30), ["Aglyn keeps 30% of each sale on your current plan. On a paid plan it is 20%."])
    XCTAssertEqual(shownFee(20), ["Aglyn keeps 20% of each sale. Payment processing fees are charged separately by Stripe."])
    XCTAssertEqual(shownFee(12), ["Aglyn keeps 12% of each sale. Payment processing fees are charged separately by Stripe."])
    // Nothing is said before the workspace has been read: the free rate would accuse a paying publisher of the higher cut.
    let unread: JSONValue = ["site": ["id": "h1"], "org": ["id": "o1"], "data": [:]]
    XCTAssertEqual(texts(hub.blocks.filter { ScreenValues.condition($0.when, in: unread) }, unread).filter { $0.contains("keeps") }, [])
  }

  func testEveryBlockOfEveryMarketplaceScreenHasItsOwnIdentity() throws {
    let url = ScreenSpecTests.screensDir.appendingPathComponent("../../plugins/marketplace/src/android/screens/marketplace.screens.json")
      .standardizedFileURL
    let file = try XCTUnwrap(JSONValue.decode(try Data(contentsOf: url)))
    for raw in file["screens"].array {
      let screen = try XCTUnwrap(ScreenSpec(raw))
      // Two untitled notices shown at once must be two views, not one drawn twice.
      XCTAssertEqual(Set(screen.blocks.map(\.id)).count, screen.blocks.count, screen.id)
    }
  }
}
