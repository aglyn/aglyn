// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

/// The hardware shop (AGL-4038): its words and rules replay the console's own, from `functionCases` in
/// libs/native/contracts/function-cases.generated.json (the Kotlin plugin replays the same file).
final class PosHardwareShopTests: XCTestCase {
  private func cases(_ name: String) throws -> [JSONValue] {
    var url = URL(fileURLWithPath: #filePath)
    for _ in 0..<7 { url.deleteLastPathComponent() }
    let file = url.appendingPathComponent("native/contracts/function-cases.generated.json")
    let all = try XCTUnwrap(JSONValue.decode(Data(contentsOf: file)))
    return try XCTUnwrap(Optional(arr(all["functions"]?[name]?["cases"])))
  }

  /// The plugin's own JSONValue readers shadow AglynCore's here, so the cases read values by pattern.
  private func num(_ value: JSONValue?) -> Double? {
    if case .number(let number)? = value { return number }
    return nil
  }
  private func arr(_ value: JSONValue?) -> [JSONValue] {
    if case .array(let values)? = value { return values }
    return []
  }
  private func arg(_ item: JSONValue) -> JSONValue { arr(item["args"]).first ?? .null }

  private func lines(_ json: JSONValue) -> [PosHardwareOrderLine] {
    let rows: [JSONValue] = arr(json)
    return rows.map { row in
      let count: Double = num(row["quantity"]) ?? 0
      return PosHardwareOrderLine(name: row["name"]?.stringValue ?? "", quantity: Int(count))
    }
  }

  func testMoneyAndThePlanPromptAreTheConsoles() throws {
    for item in try cases("formatPosHardwareCents") {
      let cents = Int(num(arg(item)) ?? 0)
      XCTAssertEqual(formatPosHardwareCents(cents), item["result"]?.stringValue, "\(cents)")
    }
    let prompts = try cases("posPlanPrompt")
    XCTAssertEqual(prompts.count, 3)
    for item in prompts {
      let arrived = arr(arg(item)["arrived"]).compactMap(\.stringValue)
      XCTAssertEqual(posHardwarePlanPrompt(arrived: arrived), item["result"]?.stringValue)
    }
  }

  func testAReturnIsOfferedWhereTheConsoleOffersOne() throws {
    let all = try cases("posHardwareReturnOffered")
    XCTAssertGreaterThan(all.count, 10)
    for item in all {
      let order = arg(item)
      let offered = posHardwareReturnOffered(
        status: order["status"]?.stringValue ?? "", source: order["source"]?.stringValue,
        asked: order["returnRequest"] != nil)
      XCTAssertEqual(offered, item["result"]?.boolValue, "\(order)")
    }
  }

  func testArrivedOrdersItemsAndNotesAreTheConsoles() throws {
    for item in try cases("posHardwareArrivedNumbers") {
      let rows: [JSONValue] = arr(arg(item))
      let orders: [(number: String, status: String, source: String?)] = rows.map { row in
        (number: row["number"]?.stringValue ?? "", status: row["status"]?.stringValue ?? "", source: row["source"]?.stringValue)
      }
      XCTAssertEqual(posHardwareArrivedNumbers(orders), arr(item["result"]).compactMap(\.stringValue))
    }
    for item in try cases("posHardwareOrderItems") {
      XCTAssertEqual(posHardwareOrderItems(lines(arg(item))), item["result"]?.stringValue)
    }
    for item in try cases("posHardwareWaitingItems") {
      XCTAssertEqual(posHardwareWaitingItems(lines(arg(item))), item["result"]?.stringValue)
    }
    for item in try cases("posHardwareWaitingNote") {
      let input = arg(item)
      XCTAssertEqual(
        posHardwareWaitingNote(
          storeName: input["storeName"]?.stringValue ?? "", serialsTaken: Int(num(input["serialsTaken"]) ?? 0),
          hasLocation: input["hasLocation"]?.boolValue == true),
        item["result"]?.stringValue)
    }
    for item in try cases("posHardwareReturnTitle") {
      XCTAssertEqual(posHardwareReturnTitle(arg(item).stringValue ?? ""), item["result"]?.stringValue)
    }
    for item in try cases("posHardwareReturnReasonReady") {
      XCTAssertEqual(posHardwareReturnReasonReady(arg(item).stringValue ?? ""), item["result"]?.boolValue)
    }
  }

  func testTheBasketAndCheckOutAreTheConsoles() throws {
    for item in try cases("posHardwareBasket") {
      let input = arg(item)
      let offerRows: [JSONValue] = arr(input["offers"])
      let offers: [(sku: String, unitCents: Int)] = offerRows.map { offer in
        let cents: Double = num(offer["unitCents"]) ?? 0
        return (sku: offer["sku"]?.stringValue ?? "", unitCents: Int(cents))
      }
      var quantities: [String: Int] = [:]
      if let given = input["quantities"], case .object(let record) = given {
        for (sku, value) in record {
          let count: Double = num(value) ?? 0
          quantities[sku] = Int(count)
        }
      }
      let basket = posHardwareBasket(
        offers: offers, quantities: quantities, shippingCents: num(input["shippingCents"]).map { Int($0) },
        automaticTax: input["automaticTax"]?.boolValue == true)
      let result = try XCTUnwrap(item["result"])
      XCTAssertEqual(basket.lines.map(\.sku), arr(result["lines"]).compactMap { $0["sku"]?.stringValue })
      XCTAssertEqual(
        basket.lines.map(\.quantity), arr(result["lines"]).map { Int(self.num($0["quantity"]) ?? 0) })
      XCTAssertEqual(basket.itemsCents, Int(num(result["itemsCents"]) ?? -1))
      XCTAssertEqual(basket.totalCents, Int(num(result["totalCents"]) ?? -1))
      XCTAssertEqual(basket.totalLabel, result["totalLabel"]?.stringValue)
    }
    let states = try cases("posHardwareCheckoutState")
    XCTAssertEqual(states.count, 32)
    for item in states {
      let input = arg(item)
      let state = posHardwareCheckoutState(
        canBuy: input["canBuy"]?.boolValue == true, termsAccepted: input["termsAccepted"]?.boolValue == true,
        businessUse: input["businessUse"]?.boolValue == true, hasLines: input["hasLines"]?.boolValue == true,
        hasShipping: input["hasShipping"]?.boolValue == true)
      XCTAssertEqual(state.blockedReason, item["result"]?["blockedReason"]?.stringValue, "\(input)")
      XCTAssertEqual(state.enabled, item["result"]?["enabled"]?.boolValue, "\(input)")
    }
  }

  func testTheRouteAnswersAreRead() {
    let catalog = PosHardwareCatalogAnswer(
      .object([
        "available": true,
        "offers": .array([.object(["sku": "stripe-reader-m2", "name": "Pocket reader (M2)", "use": "Pairs", "unitCents": 10010])]),
        "shipping": .array([.object(["method": "standard", "label": "Standard shipping", "cents": 1500])]),
        "automaticTax": false,
      ]))
    XCTAssertTrue(catalog.available)
    XCTAssertEqual(catalog.offers.first?.unitCents, 10010)
    XCTAssertEqual(catalog.shipping.first?.label, "Standard shipping")
    XCTAssertEqual(PosHardwareCatalogAnswer(.object(["available": false])), .closed)

    let order = PosHardwareOrderRow(
      .object([
        "id": "hw_1", "number": "HW-1", "status": "delivered", "totalCents": 11510,
        "lines": .array([.object(["name": "Pocket reader (M2)", "quantity": 1])]),
        "returnRequest": .object(["state": "requested"]),
        "tracking": .object(["number": "1Z", "url": "https://example.test/t"]),
      ]))
    XCTAssertEqual(order?.statusLabel, "Delivered")
    XCTAssertEqual(order?.returnLabel, "Return requested")
    XCTAssertEqual(order?.returnOffered, false)
    XCTAssertEqual(order?.trackingURL?.absoluteString, "https://example.test/t")
  }
}
