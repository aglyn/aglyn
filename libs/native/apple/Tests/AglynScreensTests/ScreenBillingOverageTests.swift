// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// The "Past your plan" screen over the console's own answers: each case in
/// `billing-estimate-cases.generated.json` is a month of usage, the quotas the entitlements route answers,
/// and what `estimateMonthlyUsageCost` and the overage helpers say it costs. The screen's arithmetic
/// must agree to the cent.
@MainActor
final class ScreenBillingOverageTests: XCTestCase {
  private static let contracts = ScreenSpecTests.screensDir.appendingPathComponent("../contracts").standardizedFileURL

  private func cases() throws -> JSONValue {
    let data = try Data(contentsOf: Self.contracts.appendingPathComponent("billing-estimate-cases.generated.json"))
    return try XCTUnwrap(JSONValue.decode(data))
  }

  private func screen() throws -> ScreenSpec {
    let text = try String(contentsOf: ScreenSpecTests.screensDir.appendingPathComponent("billing-overage.screens.json"), encoding: .utf8)
    let file = try XCTUnwrap(JSONValue.decode(Data(text.utf8)))
    return try XCTUnwrap(ScreenSpec(try XCTUnwrap(file["screens"].array.first)))
  }

  /// The screen with one month's data in it, as the loads would have filled it.
  private func seeded(_ data: JSONValue, month: String) throws -> ScreenModel {
    let spec = try screen()
    let model = ScreenModel(spec: spec, context: ["org": ["id": "o1"], "now": ["month": .string(month)]], api: nil)
    model.seed(data)
    return model
  }

  private func dollars(_ value: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.locale = Locale(identifier: "en_US")
    formatter.currencySymbol = "$"
    formatter.minimumFractionDigits = 2
    formatter.maximumFractionDigits = 2
    return formatter.string(from: NSNumber(value: (value * 100).rounded() / 100)) ?? ""
  }

  private func charge(_ value: Double) -> String { value > 0 && value < 0.005 ? "<$0.01" : dollars(value) }

  private func count(_ value: Double) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.locale = Locale(identifier: "en_US")
    formatter.maximumFractionDigits = 0
    return formatter.string(from: NSNumber(value: value)) ?? ""
  }

  private func estimateData(_ one: JSONValue) -> JSONValue {
    let month = one["month"]?.stringValue ?? ""
    let sites = one["sites"].array
    return [
      "ent": ["plan": one["plan"] ?? "free", "quotas": one["quotas"] ?? [:]],
      "org": ["subscription": ["status": "active"]],
      "collab": ["sites": .array(sites.indices.map { ["hostId": .string("h\($0)")] })],
      "siteTraffic": .array(sites.map { ["monthPageViews": $0["pageViews"] ?? 0] }),
      "usage": ["monthPageViews": 0],
      "hostMedia": .array(sites.map { ["bytes": $0["storageBytes"] ?? 0] }),
      "hostForms": .array(sites.map { [month: $0["forms"] ?? 0] }),
      "orgMedia": ["bytes": one["orgLibraryBytes"] ?? 0],
      "config": ["orgLibraryBilledFrom": one["libraryBilled"] == true ? "2026-01" : .null],
    ]
  }

  func testTheEstimateAgreesWithTheConsolesToTheCentForEveryPlanAndUsage() throws {
    let file = try cases()
    let estimates = file["estimates"].array
    XCTAssertGreaterThan(estimates.count, 20)
    for one in estimates {
      let name = one["name"]?.stringValue ?? ""
      let expect = try XCTUnwrap(one["expect"])
      let model = try seeded(estimateData(one), month: one["month"]?.stringValue ?? "")
      let context = model.context
      XCTAssertEqual(ScreenValues.lookup("is.billed", in: context), .bool(expect["billed"] == true), name)
      let estimate = model.spec.blocks.filter { $0.title?.hasPrefix("Estimated charges") == true && ScreenValues.condition($0.when, in: context) }
      if expect["billed"] != true {
        XCTAssertTrue(estimate.isEmpty, name)
        XCTAssertTrue(model.spec.blocks.contains { $0.type == "notice" && ScreenValues.condition($0.when, in: context) }, name)
        continue
      }
      // Exactly one spelling of the estimate: with the organization library's storage, or without it.
      XCTAssertEqual(estimate.count, 1, name)
      let rows = estimate[0]["rows"].array
      func value(_ label: String) -> String {
        ScreenValues.render(rows.first { $0["label"]?.stringValue == label }?["value"]?.stringValue ?? "", in: context)
      }
      XCTAssertEqual(value("Estimated"), dollars(Double(expect["billedCents"]?.numberValue ?? 0) / 100), name)
      XCTAssertTrue(value("Storage past the allowance").hasSuffix(charge(expect["storageUsd"]?.numberValue ?? 0)), "\(name): \(value("Storage past the allowance"))")
      XCTAssertTrue(value("Page views past the allowance").hasSuffix(charge(expect["pageViewsUsd"]?.numberValue ?? 0)), "\(name): \(value("Page views past the allowance"))")
      XCTAssertTrue(value("Form submissions past the allowance").hasSuffix(charge(expect["formsUsd"]?.numberValue ?? 0)), "\(name): \(value("Form submissions past the allowance"))")
    }
  }

  func testTheOverageCaptionsSayWhatTheConsoleSaysAndOnlyWhereThePlanCanBeCharged() throws {
    let file = try cases()
    for one in file["captions"].array {
      let name = one["name"]?.stringValue ?? ""
      let expect = try XCTUnwrap(one["expect"])
      let parts = one["records"]?["parts"]
      let data: JSONValue = [
        "ent": ["plan": one["plan"] ?? "free", "quotas": one["quotas"] ?? [:]],
        "org": ["subscription": ["status": "active"]],
        "contacts": ["count": parts?["contacts"] ?? 0], "companies": ["count": parts?["companies"] ?? 0], "deals": ["count": parts?["deals"] ?? 0],
        "api": ["count": one["apiRequests"] ?? 0],
        "emails": ["2026-10": one["emails"] ?? 0],
      ]
      let model = try seeded(data, month: "2026-10")
      let context = model.context
      let shown = model.spec.blocks.filter { $0.type == "notice" && $0["tone"]?.stringValue == "warning" && ScreenValues.condition($0.when, in: context) }
        .map { ScreenValues.render($0["text"]?.stringValue ?? "", in: context) }
      func plain(_ rate: Double) -> String { ScreenValues.text(.number(rate)) }
      var expected: [String] = []
      if let rate = expect["recordsRate"]?.numberValue, let over = expect["recordsOverage"]?.numberValue, over > 0 {
        expected.append(
          "Records overage: \(count(over)) over the included band at $\(plain(rate))/1,000 — ≈\(dollars(expect["recordsUsd"]?.numberValue ?? 0)) if your CRM ends the month at this size.")
      }
      if let rate = expect["apiRate"]?.numberValue, let over = expect["apiOverage"]?.numberValue, over > 0 {
        expected.append(
          "API overage: \(count(over)) requests over the included band at \(dollars(rate))/1,000 — ≈\(dollars(expect["apiUsd"]?.numberValue ?? 0)) on this month's invoice.")
      }
      if let rate = expect["emailRate"]?.numberValue, let over = expect["emailOverage"]?.numberValue, over > 0,
        let included = one["quotas"]?["emailSendsPerMonth"]?.numberValue, included > 0
      {
        expected.append(
          "\(count(over)) emails over your included \(count(included)) this month at \(dollars(rate))/1,000 — ≈\(dollars(expect["emailUsd"]?.numberValue ?? 0)) on this month's invoice. Transactional mail — receipts, invites, password resets — is never refused at the cap, so it is what takes an organization past the band."
        )
      }
      XCTAssertEqual(shown, expected, name)
    }
  }

  func testAStaffCompBillsNothingAndSoQuotesNothing() throws {
    let base: JSONValue = [
      "ent": ["plan": "business", "quotas": ["contactsPerHost": 10, "apiRequestsPerMonth": 10, "emailSendsPerMonth": 10, "hostLimit": 1]],
      "contacts": ["count": 100], "companies": ["count": 0], "deals": ["count": 0], "api": ["count": 100], "emails": ["2026-10": 100],
      "collab": ["sites": []], "siteTraffic": [],
    ]
    func warnings(org: JSONValue) throws -> Int {
      var data = base
      data = ScreenContext.with(data, "org", org)
      let model = try seeded(data, month: "2026-10")
      return model.spec.blocks.filter { $0.type == "notice" && $0["tone"]?.stringValue == "warning" && ScreenValues.condition($0.when, in: model.context) }.count
    }
    XCTAssertEqual(try warnings(org: ["subscription": ["status": "active"]]), 3)
    // A comp grants the plan with nothing for sale; a live subscription wins over it.
    XCTAssertEqual(try warnings(org: ["entitlements": ["planComp": ["plan": "business"]]]), 0)
    XCTAssertEqual(try warnings(org: ["entitlements": ["planComp": ["plan": "business"]], "subscription": ["status": "canceled"]]), 0)
    XCTAssertEqual(try warnings(org: ["entitlements": ["planComp": ["plan": "business"]], "subscription": ["status": "active"]]), 3)
    // The metered estimate follows the same rule.
    var comped = base
    comped = ScreenContext.with(comped, "org", ["entitlements": ["planComp": ["plan": "business"]]])
    comped = ScreenContext.with(comped, "collab", ["sites": [["hostId": "h0"]]])
    let model = try seeded(comped, month: "2026-10")
    XCTAssertEqual(ScreenValues.lookup("is.comp", in: model.context), true)
    XCTAssertEqual(ScreenValues.lookup("is.billed", in: model.context), false)
  }

  func testTheOrganizationLibraryIsBilledFromTheMonthTheConsolesSwitchNames() throws {
    func libraryBilled(from: JSONValue?, month: String) throws -> JSONValue? {
      var data: JSONValue = ["ent": ["plan": "pro", "quotas": [:]]]
      if let from { data = ScreenContext.with(data, "config", ["orgLibraryBilledFrom": from]) }
      return ScreenValues.lookup("is.libraryBilled", in: try seeded(data, month: month).context)
    }
    XCTAssertEqual(try libraryBilled(from: "2026-10", month: "2026-10"), true)
    XCTAssertEqual(try libraryBilled(from: "2026-09", month: "2026-10"), true)
    XCTAssertEqual(try libraryBilled(from: "2026-11", month: "2026-10"), false)
    // Anything that is not a month bills nothing; a route that did not answer includes the library (fails high).
    XCTAssertEqual(try libraryBilled(from: .null, month: "2026-10"), false)
    XCTAssertEqual(try libraryBilled(from: "true", month: "2026-10"), false)
    XCTAssertEqual(try libraryBilled(from: "1", month: "2026-10"), false)
    XCTAssertEqual(try libraryBilled(from: nil, month: "2026-10"), true)
  }
}
