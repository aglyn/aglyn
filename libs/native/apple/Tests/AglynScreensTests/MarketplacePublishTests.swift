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
}
