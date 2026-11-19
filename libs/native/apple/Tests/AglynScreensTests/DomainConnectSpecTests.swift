// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynScreens

/// A domain's page on the workspace Domains page connects the name to a site, moves it to another, or disconnects it, as
/// the console's bought-domain panel does (gap sweep Domains row 3): `/api/registrar/connect` with the picked site and
/// `/api/registrar/disconnect`, only while the name is active.
final class DomainConnectSpecTests: XCTestCase {
  private static let domainSpecs = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("../../../../plugins/domains/src/ios/Sources/AglynDomainsPlugin/Resources/domains.screens.json")
    .standardizedFileURL

  private func block() throws -> BlockSpec {
    let spec = try XCTUnwrap(ScreenCatalog.parse(Data(contentsOf: Self.domainSpecs)).first { $0.id == "domains.domain" })
    return try XCTUnwrap(spec.blocks.first { $0.id == "connect" })
  }

  private func actions() throws -> [ActionSpec] { try block()["items"].array.compactMap(ActionSpec.init) }

  private func context(connected: Bool, status: String = "active") throws -> JSONValue {
    try XCTUnwrap(
      JSONValue.decode(
        Data(
          """
          {"org":{"id":"o1"},"params":{"domain":"bakery.example"},"form":{"siteId":"h2"},
           "data":{"ws":{"rows":[{"domain":"bakery.example","status":"\(status)","connected":\(connected),"hostId":"h1"}]},
                   "sites":{"items":[{"$id":"h1","displayName":"Bakery"},{"$id":"h2","displayName":"Catering"}]}}}
          """.utf8)))
  }

  private func shown(_ id: String, in context: JSONValue) throws -> Bool {
    let action = try XCTUnwrap(try actions().first { $0.id == id })
    return ScreenValues.condition(try block().when, in: context) && ScreenValues.condition(action.when, in: context)
  }

  func testANameOnNoSiteOffersConnectToEverySite() throws {
    let ctx = try context(connected: false)
    XCTAssertTrue(try shown("connect", in: ctx))
    XCTAssertFalse(try shown("move", in: ctx))
    XCTAssertFalse(try shown("disconnect", in: ctx))
    let connect = try XCTUnwrap(try actions().first { $0.id == "connect" })
    XCTAssertEqual(connect.prompt.first?.choices(in: ctx).map(\.value), ["h1", "h2"])
    XCTAssertEqual(connect.prompt.first?.choices(in: ctx).map(\.label), ["Bakery", "Catering"])
    XCTAssertEqual(connect.url, "/api/registrar/connect")
    XCTAssertEqual(
      ScreenValues.resolveBody(try XCTUnwrap(connect.body), in: ctx),
      ["orgId": "o1", "domain": "bakery.example", "siteId": "h2"])
    XCTAssertEqual(ScreenValues.render(try XCTUnwrap(connect.success), in: ctx), "bakery.example is connecting to Catering")
  }

  func testAConnectedNameMovesToAnotherSiteOrDisconnects() throws {
    let ctx = try context(connected: true)
    XCTAssertFalse(try shown("connect", in: ctx))
    XCTAssertTrue(try shown("move", in: ctx))
    XCTAssertTrue(try shown("disconnect", in: ctx))
    // The site it serves now is not offered.
    let move = try XCTUnwrap(try actions().first { $0.id == "move" })
    XCTAssertEqual(move.prompt.first?.choices(in: ctx).map(\.value), ["h2"])
    let disconnect = try XCTUnwrap(try actions().first { $0.id == "disconnect" })
    XCTAssertTrue(disconnect.destructive)
    XCTAssertEqual(disconnect.url, "/api/registrar/disconnect")
    XCTAssertEqual(
      ScreenValues.render(try XCTUnwrap(disconnect.confirmMessage), in: ctx),
      "Bakery goes back to its free address. bakery.example stays in your workspace, registered to you, and can be connected again at any time.")
    XCTAssertEqual(ScreenValues.resolveBody(try XCTUnwrap(disconnect.body), in: ctx), ["orgId": "o1", "domain": "bakery.example"])
  }

  func testNothingIsOfferedForANameThatIsNotActive() throws {
    for status in ["registering", "expired", "transferred-out"] {
      let ctx = try context(connected: false, status: status)
      XCTAssertFalse(try shown("connect", in: ctx), status)
      XCTAssertFalse(try shown("move", in: ctx), status)
    }
  }

  /// Who the name is registered to (Domains row 2): shown for an active or expired name, edited only while it is active.
  func testTheRegistrantContactIsShownAndEditedForTheNextRenewal() throws {
    let spec = try XCTUnwrap(ScreenCatalog.parse(Data(contentsOf: Self.domainSpecs)).first { $0.id == "domains.domain" })
    func block(_ id: String) throws -> BlockSpec { try XCTUnwrap(spec.blocks.first { $0.id == id }) }
    let text = """
      {"org":{"id":"o1"},"params":{"domain":"bakery.example"},
       "form":{"firstName":"Avery","lastName":"Lane","companyName":"","email":"owner@bakery.example","phone":"+15125550123",
               "address1":"1 Main St","address2":"","city":"Austin","state":"TX","zip":"78701","country":"US"},
       "data":{"ws":{"rows":[{"domain":"bakery.example","status":"active"}]},
               "contact":{"contact":{"firstName":"Avery","lastName":"Lane","email":"owner@bakery.example"},
                          "pendingSinceMs":1763337600000,"takesEffectAtMs":1792281600000,"autoRenew":true,
                          "verification":{"verified":false,"verifyByMs":1764547200000,"email":null}}}}
      """
    let ctx = try XCTUnwrap(JSONValue.decode(Data(text.utf8)))
    XCTAssertTrue(ScreenValues.condition(try block("contact").when, in: ctx))
    XCTAssertTrue(ScreenValues.condition(try block("contactPendingDated").when, in: ctx))
    XCTAssertFalse(ScreenValues.condition(try block("contactPending").when, in: ctx))
    XCTAssertTrue(ScreenValues.condition(try block("contactVerify").when, in: ctx))
    XCTAssertTrue(ScreenValues.condition(try block("contactEdit").when, in: ctx))
    let edit = try XCTUnwrap(try block("contactEdit")["items"].array.compactMap(ActionSpec.init).first)
    XCTAssertEqual(
      edit.prompt.map(\.key),
      ["firstName", "lastName", "companyName", "email", "phone", "address1", "address2", "city", "state", "zip", "country"])
    XCTAssertEqual(edit.url, "/api/registrar/contact")
    let body = ScreenValues.resolveBody(try XCTUnwrap(edit.body), in: ctx)
    XCTAssertEqual(body["contact"]?["firstName"], "Avery")
    XCTAssertEqual(body["contact"]?["country"], "US")
    // An expired name shows its contact but cannot be edited.
    let expired = try XCTUnwrap(JSONValue.decode(Data(text.replacingOccurrences(of: "\"active\"", with: "\"expired\"").utf8)))
    XCTAssertTrue(ScreenValues.condition(try block("contact").when, in: expired))
    XCTAssertFalse(ScreenValues.condition(try block("contactEdit").when, in: expired))
  }

  /// Part of Domains row 7: the Auto-renew switch, for an active name, and only for someone the route lets manage billing.
  func testAutoRenewSwitchesThroughItsRoute() throws {
    let spec = try XCTUnwrap(ScreenCatalog.parse(Data(contentsOf: Self.domainSpecs)).first { $0.id == "domains.domain" })
    let ctx = try XCTUnwrap(
      JSONValue.decode(
        Data(
          #"{"org":{"id":"o1"},"params":{"domain":"bakery.example"},"data":{"ws":{"billingPermission":false,"rows":[{"domain":"bakery.example","status":"active","autoRenew":true}]}}}"#
            .utf8)))
    let block = try XCTUnwrap(spec.blocks.first { $0.id == "autoRenew" })
    XCTAssertTrue(ScreenValues.condition(block.when, in: ctx))
    let toggle = try XCTUnwrap(block["toggle"])
    XCTAssertEqual(ScreenValues.render(try XCTUnwrap(toggle["value"]?.stringValue), in: ctx), "true")
    XCTAssertTrue(ScreenValues.condition(toggle["disabled"]?.stringValue, in: ctx))
    let off = try XCTUnwrap(toggle["off"].flatMap(ActionSpec.init))
    XCTAssertEqual(off.url, "/api/registrar/auto-renew")
    XCTAssertEqual(ScreenValues.resolveBody(try XCTUnwrap(off.body), in: ctx), ["orgId": "o1", "domain": "bakery.example", "autoRenew": false])
    XCTAssertEqual(off.success, "Auto-renew is off")
    XCTAssertFalse(ScreenValues.condition(try XCTUnwrap(spec.blocks.first { $0.id == "expired" }).when, in: ctx))
  }

  /// Store builds hide buying (`app.billing` false): the Auto-renew switch is there to turn auto-renew OFF while it is
  /// on, and is absent while it is off, since turning it on leads to later charges. A build that may buy shows it either way.
  func testAutoRenewCanOnlyBeTurnedOffWhereTheBuildMayNotBuy() throws {
    let spec = try XCTUnwrap(ScreenCatalog.parse(Data(contentsOf: Self.domainSpecs)).first { $0.id == "domains.domain" })
    let block = try XCTUnwrap(spec.blocks.first { $0.id == "autoRenew" })
    func ctx(billing: Bool, autoRenew: Bool, status: String = "active") throws -> JSONValue {
      try XCTUnwrap(
        JSONValue.decode(
          Data(
            """
            {"app":{"billing":\(billing)},"org":{"id":"o1"},"params":{"domain":"bakery.example"},
             "data":{"ws":{"billingPermission":true,"rows":[{"domain":"bakery.example","status":"\(status)","autoRenew":\(autoRenew)}]}}}
            """.utf8)))
    }
    XCTAssertTrue(ScreenValues.condition(block.when, in: try ctx(billing: true, autoRenew: false)))
    XCTAssertTrue(ScreenValues.condition(block.when, in: try ctx(billing: true, autoRenew: true)))
    XCTAssertTrue(ScreenValues.condition(block.when, in: try ctx(billing: false, autoRenew: true)))
    XCTAssertFalse(ScreenValues.condition(block.when, in: try ctx(billing: false, autoRenew: false)))
    XCTAssertFalse(ScreenValues.condition(block.when, in: try ctx(billing: true, autoRenew: true, status: "expired")))
    XCTAssertFalse(ScreenValues.condition(block.when, in: try ctx(billing: false, autoRenew: true, status: "expired")))
  }
}
