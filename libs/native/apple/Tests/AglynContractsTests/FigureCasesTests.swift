// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the console's answers for the order and product figures, the
/// fulfillment states and the dispute rule (the Kotlin kit replays the same).
final class FigureCasesTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let list = (Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]] ?? []
    XCTAssertFalse(list.isEmpty, "no cases for \(name)")
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  private func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
    try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]))
  }

  /// A stored order with its `$id` and `livemode`, as the figures read it.
  private func figure(_ value: Any) throws -> FigureOrder {
    var fields = value as? [String: Any] ?? [:]
    let id = fields.removeValue(forKey: "$id") as? String
    let livemode = fields.removeValue(forKey: "livemode") as? Bool
    return FigureOrder(id: id, livemode: livemode, order: try decode(HostOrder.self, fields))
  }

  func testLiftLegacyOrder() throws {
    for item in cases("liftLegacyOrder") {
      XCTAssertEqual(
        liftLegacyOrder(try decode(HostOrder.self, item.args[0])), try decode(HostOrder.self, item.result), "\(item.args)")
    }
  }

  func testOrderIsTestModeAndCountsAsSale() throws {
    for item in cases("orderIsTestMode") {
      let source = try figure(item.args[0])
      XCTAssertEqual(
        orderIsTestMode(source.order, docID: source.id, livemode: source.livemode), item.result as? Bool, "\(item.args)")
    }
    for item in cases("orderCountsAsSale") {
      XCTAssertEqual(orderCountsAsSale(try figure(item.args[0])), item.result as? Bool, "\(item.args)")
    }
  }

  func testOrderWindowFiguresAndProductSales() throws {
    for item in cases("orderWindowFigures") {
      let orders = try (item.args[0] as? [Any] ?? []).map(figure)
      let figures = orderWindowFigures(
        orders, startMs: (item.args[1] as! NSNumber).doubleValue, endMs: (item.args[2] as! NSNumber).doubleValue)
      let expected = item.result as! [String: Any]
      XCTAssertEqual(figures.orders, (expected["orders"] as! NSNumber).intValue)
      XCTAssertEqual(figures.revenueCents, (expected["revenueCents"] as! NSNumber).intValue)
      XCTAssertEqual(figures.averageCents, (expected["averageCents"] as! NSNumber).intValue)
    }
    for item in cases("productSales") {
      let sales = productSales(try (item.args[0] as? [Any] ?? []).map(figure))
      let expected = item.result as! [[String: Any]]
      XCTAssertEqual(sales.map(\.productID), expected.map { $0["productId"] as! String })
      XCTAssertEqual(sales.map(\.units), expected.map { ($0["units"] as! NSNumber).doubleValue })
      XCTAssertEqual(sales.map(\.cents), expected.map { ($0["cents"] as! NSNumber).doubleValue })
    }
  }

  func testFulfillmentStatesAndTheDisputeRule() throws {
    for item in cases("orderLineFulfillmentStates") {
      let states = orderLineFulfillmentStates(try decode(HostOrder.self, item.args[0]))
      let expected = item.result as! [[String: Any]]
      XCTAssertEqual(states.count, expected.count, "\(item.args)")
      for (state, want) in zip(states, expected) {
        XCTAssertEqual(state.lineItemID, (want["lineItemId"] as! NSNumber).intValue)
        XCTAssertEqual(state.quantity, (want["quantity"] as! NSNumber).intValue)
        XCTAssertEqual(state.fulfilledQuantity, (want["fulfilledQuantity"] as! NSNumber).intValue)
        XCTAssertEqual(state.remainingQuantity, (want["remainingQuantity"] as! NSNumber).intValue)
        XCTAssertEqual(state.requiresShipping, want["requiresShipping"] as? Bool)
      }
    }
    for item in cases("orderDisputeBlocksRefund") {
      XCTAssertEqual(
        orderDisputeBlocksRefund(try decode(HostOrder.self, item.args[0])), item.result as? Bool, "\(item.args)")
    }
  }

  func testProductFigures() throws {
    for item in cases("liftLegacyProduct") {
      XCTAssertEqual(
        liftLegacyProduct(try decode(HostProduct.self, item.args[0])), try decode(HostProduct.self, item.result),
        "\(item.args)")
    }
    for item in cases("productPriceRange") {
      let range = productPriceRange(try decode(HostProduct.self, item.args[0]))
      let expected = (item.result as! [NSNumber]).map(\.doubleValue)
      XCTAssertEqual([range.min, range.max], expected, "\(item.args)")
    }
    for item in cases("productInventory") {
      XCTAssertEqual(
        productInventory(try decode(HostProduct.self, item.args[0])), (item.result as? NSNumber)?.doubleValue,
        "\(item.args)")
    }
    for item in cases("isLowStock") {
      XCTAssertEqual(isLowStock(try decode(HostProduct.self, item.args[0])), item.result as? Bool, "\(item.args)")
    }
  }
}
