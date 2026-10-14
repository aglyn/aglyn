// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import Foundation
import XCTest

@testable import AglynScreens

/// The workspace settings screens that decide what to show from what a route answered: the API key scopes, a hold's
/// owner actions, and the single sign-on steps. The words are held to the console's by
/// apps/console/specs/native-workspace-settings-match-the-console.spec.ts.
final class ScreenWorkspaceSettingsTests: XCTestCase {
  @MainActor private func spec(_ id: String) throws -> ScreenSpec { try XCTUnwrap(CoreScreens.specs.first { $0.id == id }) }

  private func actions(_ spec: ScreenSpec, block title: String) throws -> [ActionSpec] {
    let block = try XCTUnwrap(spec.blocks.first { $0.title == title || ($0.id == title) })
    return block["items"].array.compactMap(ActionSpec.init)
  }

  private func shown(_ list: [ActionSpec], in scope: JSONValue) -> [String] {
    list.filter { ScreenValues.condition($0.when, in: scope) }.map(\.id)
  }

  @MainActor
  func testCreatingAnAPIKeySendsTheScopesThatWereTicked() async throws {
    let transport = RecordingTransport(responses: [(200, #"{"token":"k"}"#)])
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: transport)
    let apiKeys = try spec("core.settings.apiKeys")
    let create = try XCTUnwrap(apiKeys.raw["actions"].array.compactMap(ActionSpec.init).first { $0.id == "create" })
    // Every scope the console offers is a switch, and the first is on for a new key as it is in the console.
    XCTAssertEqual(create.prompt.filter { $0.kind == "toggle" }.count, 17)
    XCTAssertEqual(create.prompt.filter { $0.initial == "true" }.map(\.key), ["datasetsRead"])
    let model = ScreenModel(spec: apiKeys, context: ["org": ["id": "o1"]], api: api)
    let scope: JSONValue = [
      "org": ["id": "o1"],
      "form": ["name": "Warehouse", "datasetsRead": true, "ordersWrite": true, "mediaRead": true, "crmWrite": true],
    ]
    _ = await model.run(create, in: scope)
    let body = try XCTUnwrap(JSONValue.decode(transport.requests[0].httpBody ?? Data()))
    XCTAssertEqual(body["action"], "create")
    XCTAssertEqual(body["scopes"], ["crm:write", "datasets:read", "media:read", "orders:write"])
  }

  @MainActor
  func testAHoldsOwnerActionsAreTheOnesItsNoticeNames() throws {
    let detail = try spec("core.settings.holds.notice")
    let next = try actions(detail, block: "Next")
    let notice: JSONValue = [
      "noticeId": "n1", "status": "held", "reviewable": true,
      "reviewRequests": [["mine": false], ["mine": true]],
      "actions": [
        ["id": "update-payment-method", "label": "Update payment method", "href": "/acme/billing/settings"],
        ["id": "view-details", "label": "View details", "href": "/acme/hosts/shop/orders/o9"],
        ["id": "request-review", "label": "Request a review", "href": "/acme/settings/holds?notice=n1"],
      ],
    ]
    let scope: JSONValue = ["data": ["notices": ["notices": [notice, ["noticeId": "n2", "actions": []]]]], "params": ["noticeId": "n1"]]
    XCTAssertEqual(shown(next, in: scope), ["review", "view-details", "update-payment-method", "why"])
    let billing = try XCTUnwrap(next.first { $0.id == "update-payment-method" })
    XCTAssertEqual(ScreenValues.render(try XCTUnwrap(billing.route), in: scope), "/acme/billing/settings")
    // A notice that is not reviewable offers no review, and one that names no action offers none.
    let quiet: JSONValue = ["data": ["notices": ["notices": [["noticeId": "n1", "reviewable": false, "actions": []]]]], "params": ["noticeId": "n1"]]
    XCTAssertEqual(shown(next, in: quiet), ["why"])
    // The notice says a review was asked for only once someone on this workspace asked.
    let asked = try XCTUnwrap(detail.blocks.first { $0.type == "notice" && $0.when?.contains("reviewRequests") == true })
    XCTAssertTrue(ScreenValues.condition(asked.when, in: scope))
    XCTAssertFalse(ScreenValues.condition(asked.when, in: quiet))
  }

  @MainActor
  func testTheSingleSignOnStepsFollowTheDomains() throws {
    let sso = try spec("core.settings.sso")
    func scope(status: String, claims: [JSONValue], tenant: Bool = true) -> JSONValue {
      [
        "data": [
          "ent": ["features": ["ssoEnabled": true]],
          "sso": ["sso": ["status": .string(status), "tenantId": tenant ? JSONValue.string("t1") : JSONValue.null], "claims": .array(claims)],
        ]
      ]
    }
    func claim(verified: Bool, attested: Bool, publishable: Bool) -> JSONValue {
      ["domain": "acme.com", "verified": .bool(verified), "attested": .bool(attested), "publishable": .bool(publishable)]
    }
    func notices(_ scope: JSONValue) -> [String] {
      sso.blocks.filter { $0.type == "notice" && ScreenValues.condition($0.when, in: scope) }
        .compactMap { $0["text"]?.stringValue }.map { String($0.prefix(40)) }
    }
    let steps = try XCTUnwrap(sso.blocks.last { $0.type == "actions" && ($0["items"].array.contains { $0["id"]?.stringValue == "activate" }) })
    let turn = steps["items"].array.compactMap(ActionSpec.init)

    // Nothing verified yet: the step says so, and nothing can be turned on.
    let waiting = scope(status: "configuring", claims: [claim(verified: false, attested: false, publishable: false)])
    XCTAssertTrue(notices(waiting).contains { $0.hasPrefix("Verify at least one domain") })
    XCTAssertEqual(shown(turn, in: waiting), [])

    // A verified domain can be turned on, and the step says nothing more.
    let ready = scope(status: "configuring", claims: [claim(verified: true, attested: false, publishable: true)])
    XCTAssertFalse(notices(ready).contains { $0.hasPrefix("Verify at least one domain") || $0.hasPrefix("Single sign-on cannot") })
    XCTAssertEqual(shown(turn, in: ready), ["activate"])

    // On, with only the proof we made for the customer: turning it off cannot be undone here, and the warning says so.
    let attested = scope(status: "active", claims: [claim(verified: false, attested: true, publishable: false)])
    XCTAssertTrue(notices(attested).contains { $0.hasPrefix("Single sign-on is on, but none") })
    XCTAssertEqual(shown(turn, in: attested), ["disable"])
    let disable = try XCTUnwrap(turn.first { $0.id == "disable" })
    XCTAssertTrue(try XCTUnwrap(disable.confirmText(in: attested)).contains("You will not be able to turn it back on"))
    XCTAssertTrue(try XCTUnwrap(disable.confirmText(in: scope(status: "active", claims: [claim(verified: true, attested: false, publishable: true)]))).contains("can turn it back on"))

    // Off, with only that proof: it cannot be turned on until DNS proves a domain.
    let off = scope(status: "disabled", claims: [claim(verified: false, attested: true, publishable: false)])
    XCTAssertTrue(notices(off).contains { $0.hasPrefix("Single sign-on cannot") })
    XCTAssertEqual(shown(turn, in: off), [])
  }

  @MainActor
  func testEnforcingNeedsAWayInThatSurvivesTheProvider() throws {
    let enforcement = try spec("core.settings.sso.enforcement")
    let buttons = try XCTUnwrap(enforcement.blocks.first { $0.type == "actions" })["items"].array.compactMap(ActionSpec.init)
    func scope(enforced: Bool = false, saved: [String] = [], outside: [JSONValue] = [], rehearsed: Bool = true) -> JSONValue {
      let stash: JSONValue = rehearsed ? ["ssoPreview": ["scanned": 3, "changed": 2, "lockout": ["ownersOutsidePool": .array(outside)]]] : [:]
      return [
        "data": [
          "ent": ["features": ["ssoEnabled": true]],
          "sso": ["sso": ["status": "active", "enforced": .bool(enforced), "breakGlassUids": .array(saved.map(JSONValue.string))]],
          "rows": [["uid": "u1", "label": "a@acme.com", "eligible": true, "designated": false]],
        ],
        "stash": stash,
      ]
    }
    // No owner outside the pool and nobody designated: enforcing is not offered (the console disables the button).
    XCTAssertEqual(shown(buttons, in: scope()), ["rehearse", "breakGlass"])
    // Either one is enough.
    XCTAssertEqual(shown(buttons, in: scope(saved: ["u1"])), ["rehearse", "breakGlass", "enforce"])
    XCTAssertEqual(shown(buttons, in: scope(outside: [["uid": "o1", "email": "o@acme.com"]])), ["rehearse", "breakGlass", "enforce"])
    // Once enforced it can be stopped and not enforced again.
    XCTAssertEqual(shown(buttons, in: scope(enforced: true, saved: ["u1"])), ["rehearse", "breakGlass", "stop"])
    // Nothing rehearsed: the screen asks for a rehearsal first.
    let ask = try XCTUnwrap(enforcement.blocks.first { $0.type == "notice" && $0["text"]?.stringValue?.hasPrefix("Nothing rehearsed yet") == true })
    XCTAssertTrue(ScreenValues.condition(ask.when, in: scope(rehearsed: false)))
    XCTAssertFalse(ScreenValues.condition(ask.when, in: scope()))
    // The break-glass choice offers only the accounts that hold a way in other than the provider.
    let save = try XCTUnwrap(buttons.first { $0.id == "breakGlass" })
    let choice = try XCTUnwrap(save.prompt.first)
    let rows: JSONValue = [
      "data": ["rows": [["uid": "u1", "label": "a", "eligible": true], ["uid": "u2", "label": "b", "eligible": false]]]
    ]
    XCTAssertEqual(choice.choices(in: rows).map(\.value), ["u1"])
  }
}
