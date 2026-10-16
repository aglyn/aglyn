// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the order dialog's rules and words (tracking links, Fulfill items, disputes, refunds, tax, payment risk)
/// from function-cases.generated.json; the Kotlin kit's OrderDialogRulesCasesTest replays the same cases.
final class OrderDialogRulesTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let list = ((Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]]) ?? []
    XCTAssertFalse(list.isEmpty, "no cases for \(name)")
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  /// A partial order as the TypeScript functions take it, its gaps filled as a stored order fills them.
  private func order(_ value: Any) throws -> HostOrder {
    var fields = value as? [String: Any] ?? [:]
    if fields["status"] == nil { fields["status"] = "paid" }
    if let totals = fields["totals"] as? [String: Any] {
      var filled: [String: Any] = ["discountCents": 0, "feeCents": 0, "itemsCents": 0, "shippingCents": 0, "taxCents": 0]
      filled.merge(totals) { _, given in given }
      fields["totals"] = filled
    }
    return try JSONDecoder().decode(HostOrder.self, from: JSONSerialization.data(withJSONObject: fields))
  }

  private func int(_ value: Any?) -> Int? { (value as? NSNumber)?.intValue }
  private func lines(_ value: Any) -> [(lineItemID: Int, quantity: Int)] {
    (value as? [[String: Any]] ?? []).map { (int($0["lineItemId"]) ?? 0, int($0["quantity"]) ?? 0) }
  }

  func testCarriersAndTrackingLinks() {
    for item in cases("carrierIdFor") { XCTAssertEqual(carrierIdFor(item.args[0] as? String), item.result as? String, "\(item.args)") }
    for item in cases("carrierLabelFor") { XCTAssertEqual(carrierLabelFor(item.args[0] as? String), item.result as? String, "\(item.args)") }
    for item in cases("trackingUrlFor") {
      XCTAssertEqual(trackingUrlFor(item.args[0] as? String, item.args[1] as? String), item.result as? String, "\(item.args)")
    }
    for item in cases("fulfillmentTrackingUrl") {
      let entry = item.args[0] as? [String: Any] ?? [:]
      XCTAssertEqual(
        fulfillmentTrackingUrl(
          carrier: entry["carrier"] as? String, trackingNumber: entry["trackingNumber"] as? String, trackingUrl: entry["trackingUrl"] as? String),
        item.result as? String, "\(item.args)")
    }
    for item in cases("fulfillmentCarrierChoice") {
      XCTAssertEqual(fulfillmentCarrierChoice(item.args[0] as? String), item.result as? String, "\(item.args)")
    }
    for item in cases("trackingStatusLabel") {
      XCTAssertEqual(trackingStatusLabel(item.args[0] as? String), item.result as? String, "\(item.args)")
    }
  }

  func testFulfillItems() throws {
    for item in cases("describeFulfillmentLines") {
      XCTAssertEqual(describeFulfillmentLines(try order(item.args[0]), lines(item.args[1])), item.result as? String)
    }
    for item in cases("orderFulfillmentsEditable") {
      let status = OrderStatus(rawValue: (item.args[0] as? [String: Any])?["status"] as? String ?? "")
      XCTAssertEqual(orderFulfillmentsEditable(status), item.result as? Bool, "\(item.args)")
    }
    for item in cases("fulfillItemsStartQuantities") {
      XCTAssertEqual(fulfillItemsStartQuantities(try order(item.args[0])), (item.result as? [NSNumber])?.map(\.intValue))
    }
    for item in cases("fulfillItemsSelection") {
      let picked = fulfillItemsSelection((item.args[0] as? [NSNumber] ?? []).map(\.doubleValue))
      let expected = lines(item.result)
      XCTAssertEqual(picked.map(\.lineItemID), expected.map(\.lineItemID), "\(item.args)")
      XCTAssertEqual(picked.map(\.quantity), expected.map(\.quantity), "\(item.args)")
    }
    for item in cases("fulfillItemsIsEverything") {
      XCTAssertEqual(fulfillItemsIsEverything(try order(item.args[0]), lines(item.args[1])), item.result as? Bool)
    }
  }

  func testShippingCost() {
    for item in cases("currencyMinorDigits") { XCTAssertEqual(currencyMinorDigits(item.args[0] as? String), int(item.result), "\(item.args)") }
    for item in cases("parseShippingCostInput") {
      let parsed = parseShippingCostInput(item.args[0] as? String ?? "", currency: item.args[1] as? String)
      let expected = item.result as? [String: Any] ?? [:]
      if let error = expected["error"] as? String {
        XCTAssertEqual(parsed, .error(error), "\(item.args)")
      } else {
        XCTAssertEqual(parsed, .cents(int(expected["cents"])), "\(item.args)")
      }
    }
  }

  func testDisputes() throws {
    for item in cases("describeOrderDispute") {
      let badge = describeOrderDispute(try order(item.args[0]), nowMs: (item.args[1] as? NSNumber)?.doubleValue ?? 0)
      guard let expected = item.result as? [String: Any] else {
        XCTAssertNil(badge, "\(item.args)")
        continue
      }
      XCTAssertEqual(badge?.tone, expected["tone"] as? String)
      XCTAssertEqual(badge?.label, expected["label"] as? String)
      XCTAssertEqual(badge?.detail, expected["detail"] as? String)
      XCTAssertEqual(badge?.evidenceDueByMs, (expected["evidenceDueByMs"] as? NSNumber)?.int64Value)
      XCTAssertEqual(badge?.evidenceDaysLeft, int(expected["evidenceDaysLeft"]))
    }
    for item in cases("orderHasOpenDispute") { XCTAssertEqual(orderHasOpenDispute(try order(item.args[0])), item.result as? Bool) }
    for item in cases("splitOrderReversal") {
      let split = splitOrderReversal(try order(item.args[0]))
      let expected = item.result as? [String: Any] ?? [:]
      XCTAssertEqual(split.refundedCents, int(expected["refundedCents"]))
      XCTAssertEqual(split.chargedBackCents, int(expected["chargedBackCents"]))
    }
    for item in cases("summariseOpenDisputes") {
      let orders = try (item.args[0] as? [Any] ?? []).map(order)
      let summary = summariseOpenDisputes(orders, nowMs: (item.args[1] as? NSNumber)?.doubleValue ?? 0)
      let expected = item.result as? [String: Any] ?? [:]
      XCTAssertEqual(summary.count, int(expected["count"]))
      XCTAssertEqual(summary.overdue, expected["overdue"] as? Bool)
      XCTAssertEqual(summary.soonestDaysLeft, int(expected["soonestDaysLeft"]))
      XCTAssertEqual(summary.soonestDueByMs, (expected["soonestDueByMs"] as? NSNumber)?.int64Value)
    }
  }

  func testRefunds() throws {
    for item in cases("orderLineRefundCents") {
      XCTAssertEqual(
        orderLineRefundCents(try order(item.args[0]), (item.args[1] as? [NSNumber] ?? []).map(\.intValue)), int(item.result), "\(item.args)")
    }
    for item in cases("orderLineRefunded") {
      XCTAssertEqual(orderLineRefunded(try order(item.args[0]), int(item.args[1]) ?? 0), item.result as? Bool)
    }
    for item in cases("orderRefundPrompt") {
      let prompt = orderRefundPrompt(try order(item.args[0]), lineItemIDs: (item.args.count > 1 ? item.args[1] as? [NSNumber] : nil)?.map(\.intValue) ?? [])
      let expected = item.result as? [String: Any] ?? [:]
      XCTAssertEqual(prompt.title, expected["title"] as? String)
      XCTAssertEqual(prompt.text, expected["text"] as? String)
    }
  }

  func testTaxAndPaymentRisk() throws {
    for item in cases("describeOrderTaxMode") { XCTAssertEqual(describeOrderTaxMode(item.args[0] as? String), item.result as? String) }
    for item in cases("describePaymentRisk") {
      let signals = ((item.args[0] as? [String: Any])?["signals"] as? [[String: Any]] ?? []).map {
        PaymentRiskSignal(
          atMs: ($0["atMs"] as? NSNumber)?.doubleValue ?? 0, detail: $0["detail"] as? String,
          kind: PaymentRiskSignalKind(rawValue: $0["kind"] as? String ?? "") ?? .unknown, outcome: $0["outcome"] as? String,
          stripeObjectId: $0["stripeObjectId"] as? String ?? "")
      }
      let risk = item.args[0] is NSNull ? nil : PaymentRisk(latestAtMs: 0, latestKind: signals.last?.kind ?? .unknown, signals: signals)
      let described = describePaymentRisk(risk)
      let expected = item.result as? [String: Any]
      XCTAssertEqual(described?.label, expected?["label"] as? String)
      XCTAssertEqual(described?.detail, expected?["detail"] as? String)
    }
  }
}
