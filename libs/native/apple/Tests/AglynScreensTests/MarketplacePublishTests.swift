// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import Foundation
import XCTest

@testable import AglynScreens

/// Publishing the site as a template (`libs/plugins/marketplace/src/android/screens/marketplace.screens.json`):
/// the zone it fills on Backup & restore, the agreement the publish needs accepted, and the two routes it calls.
/// Kotlin replays the same cases (MarketplacePublishTest).
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

  func testTheAgreementIsOfferedUntilTheOrganizationHasAcceptedTheCurrentVersion() throws {
    let publish = try spec("marketplace.publishTemplate")
    let version = ScreenValues.lookup("const.agreement.version", in: ScreenContext.with(["x": 1], "const", publish.raw["constants"] ?? [:]))
    let review = "Review the Marketplace Publisher Agreement"
    func offered(_ profile: JSONValue?) -> (notices: [String], review: Bool) {
      let (context, blocks) = shown(publish, profile: profile)
      let links = blocks.filter { $0.type == "links" }.flatMap { $0["items"].array }.compactMap { $0["title"]?.stringValue }
      return (texts(blocks, context).filter { $0.contains("terms") }, links.contains(review))
    }
    // No publisher profile yet: the publish is refused for the profile first, so the agreement is not asked for.
    XCTAssertEqual(offered(nil).notices, [])
    XCTAssertFalse(offered(nil).review)
    // A profile that never accepted.
    let never = offered(["handle": "studio"])
    XCTAssertEqual(never.notices, ["Your organization has not accepted these terms. They must be accepted before anything is published."])
    XCTAssertTrue(never.review)
    // One that accepted an earlier version.
    let old = offered(["handle": "studio", "publisherAgreement": ["version": "2026-08-18.1"]])
    XCTAssertEqual(
      old.notices,
      ["These terms have changed since your organization accepted version 2026-08-18.1. Publishing is paused until the current version is accepted."])
    XCTAssertTrue(old.review)
    // The current version needs nothing.
    let current = offered(["handle": "studio", "publisherAgreement": ["version": version ?? .null]])
    XCTAssertEqual(current.notices, [])
    XCTAssertFalse(current.review)
  }

  func testTheAgreementShowsWhatChangedSinceTheVersionAcceptedAndWhoMayAccept() throws {
    let agreement = try spec("marketplace.publisherAgreement")
    let changes = try XCTUnwrap(agreement.blocks.first { $0.title?.hasPrefix("What changed") == true })
    func changed(since accepted: String) -> [String] {
      let (context, _) = shown(agreement, profile: ["handle": "s", "publisherAgreement": ["version": .string(accepted)]])
      return ScreenValues.scopes(items: changes["items"]?.stringValue ?? "", within: changes["within"]?.stringValue, filter: changes["filter"]?.stringValue, in: context)
        .map { ScreenValues.render(changes["secondary"]?.stringValue ?? "", in: $0) }
    }
    // Only the versions after the one accepted, each change under the version that made it.
    XCTAssertEqual(changed(since: "2026-08-18.1"), ["Version 2026-08-24.1"])
    XCTAssertEqual(changed(since: "2026-01-01.1").count, 5)
    XCTAssertEqual(changed(since: "2026-08-24.1"), [])

    // An owner or admin is offered the accept, per what the standing is; anyone else is told who to ask.
    let stale: JSONValue = ["handle": "s", "publisherAgreement": ["version": "2026-08-18.1"]]
    let accept = try XCTUnwrap(agreement.blocks.first { $0["id"]?.stringValue == nil && $0.type == "actions" && $0.when == "is.canAccept" })
    let actions = accept["items"].array.compactMap(ActionSpec.init)
    let (manager, managerBlocks) = shown(agreement, profile: stale)
    XCTAssertEqual(actions.filter { ScreenValues.condition($0.when, in: manager) }.map(\.label), ["Accept the current version"])
    XCTAssertTrue(managerBlocks.contains { $0.type == "actions" && $0.when == "is.canAccept" })
    let (first, _) = shown(agreement, profile: ["handle": "s"])
    XCTAssertEqual(actions.filter { ScreenValues.condition($0.when, in: first) }.map(\.label), ["Accept on behalf of this organization"])
    let members: JSONValue = ["members": [["$id": "u1", "role": "owner", "displayName": "Dana", "email": "dana@example.test"], ["$id": "u2", "role": "viewer"]]]
    let (member, memberBlocks) = shown(agreement, profile: stale, manager: false, members: members)
    XCTAssertFalse(memberBlocks.contains { $0.when == "is.canAccept" })
    XCTAssertEqual(
      texts(memberBlocks, member).last, "Only an owner or admin of your organization can accept on its behalf. Ask one of them to accept it, then try again.")
    let who = try XCTUnwrap(memberBlocks.first { $0.title == "Who can accept" })
    XCTAssertEqual(
      ScreenValues.scopes(items: who["items"]?.stringValue ?? "", within: nil, filter: who["filter"]?.stringValue, in: member)
        .map { ScreenValues.render(who["primary"]?.stringValue ?? "", in: $0) },
      ["Dana"])
  }

  func testPublishingSendsTheListingTheRouteTakesAndAcceptingSendsTheVersionInForce() async throws {
    let publish = try spec("marketplace.publishTemplate")
    let form = try XCTUnwrap(publish.blocks.first { $0.type == "form" })
    let submit = try XCTUnwrap(form["submit"].flatMap(ActionSpec.init))
    let transport = RecordingTransport(responses: [(200, #"{"ok":true,"version":3}"#), (200, #"{"ok":true,"version":1}"#)])
    let model = ScreenModel(spec: publish, context: [:], api: api(transport))
    let paid: JSONValue = ["site": ["id": "h1"], "form": ["name": "Studio", "description": "A portfolio", "category": "Portfolio", "price": 5]]
    let outcome = await model.run(submit, in: paid)
    XCTAssertEqual(outcome, .done(message: "Published v3 to the marketplace", response: ["ok": true, "version": 3]))
    XCTAssertEqual(transport.requests[0].url?.path, "/api/marketplace/publish-template")
    let body = try XCTUnwrap(transport.requests[0].httpBody.flatMap(JSONValue.decode))
    XCTAssertEqual(body, ["hostId": "h1", "displayName": "Studio", "description": "A portfolio", "category": "Portfolio", "priceUsd": 5])
    // A price left blank is not sent as a number: the route reads it as free.
    _ = await model.run(submit, in: ["site": ["id": "h1"], "form": ["name": "Free one"]])
    let free = try XCTUnwrap(transport.requests[1].httpBody.flatMap(JSONValue.decode))
    XCTAssertEqual(free["displayName"], "Free one")
    XCTAssertNil(free["priceUsd"]?.numberValue)
    // The name is required; the price field states the floor.
    XCTAssertTrue(try XCTUnwrap(form["fields"].array.compactMap(FieldSpec.init).first { $0.key == "name" }).required)
    let price = try XCTUnwrap(form["fields"].array.compactMap(FieldSpec.init).first { $0.key == "price" })
    XCTAssertTrue(try XCTUnwrap(price.help).hasPrefix("0 for free, or $"))

    let agreement = try spec("marketplace.publisherAgreement")
    let block = try XCTUnwrap(agreement.blocks.first { $0.when == "is.canAccept" })
    let accept = try XCTUnwrap(block["items"].array.first.flatMap(ActionSpec.init))
    let accepting = RecordingTransport(responses: [(200, #"{"ok":true}"#)])
    let session = ScreenModel(spec: agreement, context: [:], api: api(accepting))
    let version = ScreenValues.lookup("const.agreement.version", in: ScreenContext.with(["x": 1], "const", agreement.raw["constants"] ?? [:]))
    _ = await session.run(accept, in: ScreenContext.with(["org": ["id": "o1"]], "const", agreement.raw["constants"] ?? [:]))
    XCTAssertEqual(accepting.requests[0].url?.path, "/api/marketplace/publisher-profile")
    let sent = try XCTUnwrap(accepting.requests[0].httpBody.flatMap(JSONValue.decode))
    XCTAssertEqual(sent, ["action": "accept-agreement", "orgId": "o1", "version": version ?? .null])
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
      let context: JSONValue = [
        "org": ["id": "o1"], "site": ["id": "h1"], "params": ["id": "x1"],
        "form": ["name": "Hero", "description": "A hero", "category": "Hero", "price": 0],
      ]
      let outcome = await model.run(submit, in: context)
      XCTAssertEqual(outcome, .done(message: "Published v2 to the marketplace", response: ["ok": true, "version": 2]), id)
      // Refused for the agreement, it opens the agreement and sends the same publish once it is accepted.
      XCTAssertEqual(submit.gate?["screen"]?.stringValue, "marketplace.publisherAgreement", id)
      XCTAssertEqual(transport.requests[0].url?.path, route, id)
      let body = try XCTUnwrap(transport.requests[0].httpBody.flatMap(JSONValue.decode))
      var expected = identity
      expected["displayName"] = "Hero"
      expected["description"] = "A hero"
      expected["category"] = "Hero"
      expected["priceUsd"] = 0
      XCTAssertEqual(body, .object(expected), id)
      // The form opens with the name and description the thing already has, handed over as the screen's parameters.
      let fields = form["fields"].array.compactMap(FieldSpec.init)
      let params: JSONValue = ["params": ["name": "Hero band", "description": "The top of the page"]]
      XCTAssertEqual(
        ["name", "description"].map { key in ScreenValues.render(fields.first { $0.key == key }?.initial ?? "", in: params) },
        ["Hero band", "The top of the page"], id)
      XCTAssertTrue(try XCTUnwrap(fields.first { $0.key == "name" }).required, id)
      // The agreement is asked for exactly as the site template asks.
      let (offered, blocks) = shown(publish, profile: ["handle": "studio"])
      XCTAssertEqual(
        texts(blocks, offered).filter { $0.contains("terms") },
        ["Your organization has not accepted these terms. They must be accepted before anything is published."], id)
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

  func testAPublishRefusedForTheAgreementOpensItAndAcceptingIsWhatSendsThePublishAgain() async throws {
    let publish = try spec("marketplace.publishTemplate")
    let submit = try XCTUnwrap(publish.blocks.first { $0.type == "form" }?["submit"].flatMap(ActionSpec.init))
    let refusal =
      #"{"error":"Accept the Marketplace Publisher Agreement before publishing.","agreement":{"required":"2026-08-24.1","accepted":null,"state":"none","orgId":"o1"}}"#
    let transport = RecordingTransport(responses: [(412, refusal), (412, #"{"error":"Set up your publisher profile first."}"#), (200, #"{"ok":true,"version":2}"#)])
    let model = ScreenModel(spec: publish, context: [:], api: api(transport))
    let scope: JSONValue = ["site": ["id": "h1"], "form": ["name": "Studio"]]
    // The route's structured refusal (not its prose) names the screen that settles it.
    let first = await model.run(submit, in: scope)
    XCTAssertEqual(
      first, .gated(screen: "marketplace.publisherAgreement", message: "Accept the Marketplace Publisher Agreement before publishing."))
    // Any other refusal is a failure, as it was.
    let second = await model.run(submit, in: scope)
    XCTAssertEqual(second, .failed("Set up your publisher profile first."))
    // Sent again after the agreement is accepted, it is the same request.
    _ = await model.run(submit, in: scope)
    XCTAssertEqual(transport.requests[0].httpBody, transport.requests[2].httpBody)

    let agreement = try spec("marketplace.publisherAgreement")
    let block = try XCTUnwrap(agreement.blocks.first { $0.when == "is.canAccept" })
    let accepts = block["items"].array.compactMap(ActionSpec.init)
    XCTAssertEqual(accepts.map(\.id), ["accept", "acceptCurrent"])
    XCTAssertTrue(accepts.allSatisfy(\.resume))
    XCTAssertTrue(accepts.allSatisfy(\.back))
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
      "visibility": "public", "price": 5, "attested": attested,
    ]
    let outcome = await model.run(submit, in: ["org": ["id": "o1"], "params": [:], "form": .object(base)])
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
      ])
    // A private plugin is free whatever the price field held.
    var privately = base
    privately["visibility"] = "private"
    _ = await model.run(submit, in: ["org": ["id": "o1"], "params": [:], "form": .object(privately)])
    XCTAssertEqual(try XCTUnwrap(transport.requests[1].httpBody.flatMap(JSONValue.decode))["priceUsd"], 0)
    // Opens the listing it published.
    XCTAssertEqual(submit.navigate?.screen, "marketplace.listing")
    XCTAssertEqual(submit.navigate?.params, ["listing": "{response.listingId}"])
  }

  func testAPluginRefusedByTheVerifierSaysWhatItFoundAndTheAgreementGatesItLikeEveryPublish() async throws {
    let publish = try spec("marketplace.publishPlugin")
    let submit = try XCTUnwrap(publish.blocks.first { $0.type == "form" }?["submit"].flatMap(ActionSpec.init))
    let refusal =
      #"{"error":"Accept the Marketplace Publisher Agreement before publishing.","agreement":{"required":"2026-08-24.1","accepted":null,"state":"none","orgId":"o1"}}"#
    let problems = #"{"error":"Bundle rejected","problems":[{"level":"error","check":"network","message":"Calls an undeclared host"},{"level":"error","message":"Too large"}]}"#
    let transport = RecordingTransport(responses: [(412, refusal), (422, problems)])
    let model = ScreenModel(spec: publish, context: [:], api: api(transport))
    let scope: JSONValue = ["org": ["id": "o1"], "params": [:], "form": ["bundle": "eA==", "manifest": ["id": "w"], "name": "W"]]
    let gated = await model.run(submit, in: scope)
    XCTAssertEqual(gated, .gated(screen: "marketplace.publisherAgreement", message: "Accept the Marketplace Publisher Agreement before publishing."))
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
