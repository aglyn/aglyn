// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// What a store's shipping settings cover, replayed from `functionCases` in libs/native/contracts/function-cases.generated.json,
/// which the console's own functions produced (the Kotlin renderer replays the same file).
final class ShippingCoverageTests: XCTestCase {
  private func cases(_ name: String) throws -> [JSONValue] {
    let file = ScreenSpecTests.screensDir.appendingPathComponent("../contracts/function-cases.generated.json").standardizedFileURL
    let all = try XCTUnwrap(JSONValue.decode(Data(contentsOf: file)))
    return try XCTUnwrap(all["functions"]?[name]?["cases"]).array
  }

  private func settings(_ args: JSONValue) -> JSONValue? { args.array.first.flatMap { $0 == .null ? nil : $0 } }

  private func options(_ list: [ShippingCoverage.Option]) -> JSONValue {
    .array(
      list.map {
        .object(["rateId": .string($0.rateID), "name": .string($0.name), "amountCents": .number($0.amountCents)])
      })
  }

  private func coverage(_ json: JSONValue?) -> ShippingCoverage.Coverage {
    func list(_ key: String) -> [String] { (json?[key]?.arrayValue ?? []).compactMap(\.stringValue) }
    return ShippingCoverage.Coverage(
      served: list("served"), unserved: list("unserved"), shipsNowhere: json?["shipsNowhere"] == .bool(true),
      asksDestination: json?["asksDestination"] == .bool(true), offersLocalPickup: json?["offersLocalPickup"] == .bool(true),
      hasRestOfWorldZone: json?["hasRestOfWorldZone"] == .bool(true))
  }

  func testEveryStoresCoverageReadsAsTheConsolesDoes() throws {
    let all = try cases("summarizeShippingCoverage")
    XCTAssertGreaterThan(all.count, 20)
    for item in all {
      XCTAssertEqual(ShippingCoverage.summarize(settings(try XCTUnwrap(item["args"]))), coverage(item["result"]), "\(item["args"] ?? .null)")
    }
  }

  func testTheWordsAreTheConsolesWords() throws {
    let all = try cases("describeShippingCoverage")
    XCTAssertGreaterThan(all.count, 6)
    for item in all {
      let said = ShippingCoverage.words(coverage(item["args"]?.array.first))
      let expected = item["result"]
      XCTAssertEqual(said.headline, expected?["headline"]?.stringValue)
      XCTAssertEqual(said.detail, expected?["detail"]?.stringValue)
      XCTAssertEqual(said.note, expected?["note"]?.stringValue)
      XCTAssertEqual(said.asks, expected?["asks"]?.stringValue)
    }
  }

  func testEveryDestinationsOptionsAreTheOnesTheConsoleOffers() throws {
    let all = try cases("resolveCheckoutShippingOptions")
    XCTAssertGreaterThan(all.count, 300)
    for item in all {
      let args = try XCTUnwrap(item["args"]).array
      let cart = (
        subtotalCents: ScreenValues.number(args[2]["subtotalCents"]) ?? 0, totalGrams: ScreenValues.number(args[2]["totalGrams"]) ?? 0
      )
      let destinations = args[1].array.compactMap(\.stringValue)
      XCTAssertEqual(
        options(ShippingCoverage.checkoutOptions(args[0] == .null ? nil : args[0], destinations, cart)), item["result"], "\(args)")
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
