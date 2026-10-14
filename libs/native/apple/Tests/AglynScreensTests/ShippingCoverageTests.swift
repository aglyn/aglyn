// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// What a store's shipping settings cover, replayed from libs/native/screens/shipping-coverage-cases.json, which the console's
/// own resolver produced (the Kotlin renderer replays the same file).
final class ShippingCoverageTests: XCTestCase {
  private func cases() throws -> [JSONValue] {
    let data = try Data(contentsOf: ScreenSpecTests.screensDir.appendingPathComponent("shipping-coverage-cases.json"))
    return try XCTUnwrap(JSONValue.decode(data))["cases"].array
  }

  private func options(_ list: [ShippingCoverage.Option]) -> JSONValue {
    .array(
      list.map {
        .object(["rateId": .string($0.rateID), "name": .string($0.name), "amountCents": .number($0.amountCents)])
      })
  }

  func testEveryStoresCoverageReadsAsTheConsolesDoes() throws {
    let all = try cases()
    XCTAssertGreaterThan(all.count, 20)
    for item in all {
      let name = item["name"]?.stringValue ?? ""
      let settings = item["settings"].flatMap { $0 == .null ? nil : $0 }
      XCTAssertEqual(ShippingCoverage.summary(settings), item["coverage"], "coverage of: \(name)")
    }
  }

  func testEveryDestinationsOptionsAreTheOnesTheConsoleOffers() throws {
    for item in try cases() {
      let name = item["name"]?.stringValue ?? ""
      let settings = item["settings"].flatMap { $0 == .null ? nil : $0 }
      for scenario in item["options"].array {
        let cart = (
          subtotalCents: ScreenValues.number(scenario["cart"]?["subtotalCents"]) ?? 0,
          totalGrams: ScreenValues.number(scenario["cart"]?["totalGrams"]) ?? 0
        )
        for country in ShippingCoverage.countries {
          XCTAssertEqual(
            options(ShippingCoverage.checkoutOptions(settings, [country], cart)), scenario["byCountry"]?[country],
            "\(country) of: \(name), cart \(cart)")
        }
        XCTAssertEqual(
          options(ShippingCoverage.checkoutOptions(settings, ShippingCoverage.countries, cart)), scenario["union"],
          "every destination of: \(name), cart \(cart)")
      }
    }
  }

  @MainActor
  func testADerivedLoadReadsTheSettingsItNamesFromTheOtherLoads() {
    let load = LoadSpec(key: "coverage", .object(["derive": "shippingCoverage", "from": "store.shipping"]))
    let data: JSONValue = [
      "store": ["shipping": ["zones": [["id": "z1", "name": "US", "countries": ["US"]]], "rates": [["id": "r1", "zoneId": "z1", "name": "Standard", "kind": "flat", "amountCents": 500]]]]
    ]
    let answer = ScreenModel.derived(load, from: data)
    XCTAssertEqual(answer["servedNames"]?.stringValue, "United States")
    XCTAssertEqual(answer["unservedCount"], .number(5))
    XCTAssertEqual(ScreenModel.derived(load, from: ["store": [:]])["shipsNowhere"], .bool(true))
  }

  func testTheShippingScreenReadsOnlyWhatTheSummaryAnswers() throws {
    let file = ScreenSpecTests.screensDir.appendingPathComponent("../../plugins/commerce/src/android/screens/commerce-store2.screens.json")
      .standardizedFileURL
    let spec = try XCTUnwrap(JSONValue.decode(Data(contentsOf: file)))
    let shipping = try XCTUnwrap(spec["screens"].array.first { $0["id"]?.stringValue == "commerce.shipping" })
    XCTAssertEqual(shipping["load"]?["coverage"]?["derive"]?.stringValue, "shippingCoverage")
    XCTAssertEqual(shipping["load"]?["coverage"]?["from"]?.stringValue, "store.shipping")
    let text = String(data: try JSONEncoder().encode(shipping), encoding: .utf8) ?? ""
    let used = Set(
      try NSRegularExpression(pattern: #"data\.coverage\.([A-Za-z]+)"#).matches(in: text, range: NSRange(text.startIndex..., in: text))
        .compactMap { Range($0.range(at: 1), in: text).map { String(text[$0]) } })
    XCTAssertTrue(used.isSuperset(of: ["headline", "detail", "note", "asks", "hasRestOfWorldZone"]))
    guard case .object(let summary) = ShippingCoverage.summary(nil) else { return XCTFail("the summary is an object") }
    let answered = Set(summary.keys)
    XCTAssertTrue(used.isSubset(of: answered), "\(used.subtracting(answered))")
  }
}
