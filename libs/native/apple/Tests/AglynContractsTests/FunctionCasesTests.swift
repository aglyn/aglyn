// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays every case in libs/native/contracts/function-cases.generated.json:
/// the console's own answers from the TypeScript formatters and rules.
final class FunctionCasesTests: XCTestCase {
  private static let root: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // AglynContractsTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // apple
      .deletingLastPathComponent()  // native
      .appendingPathComponent("contracts/function-cases.generated.json")
    let data = try! Data(contentsOf: url)
    return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
  }()

  private struct Case {
    let args: [Any]
    let result: Any
    var label: String { "\(args) → \(result)" }
  }

  private func cases(_ name: String, file: StaticString = #filePath, line: UInt = #line) -> [Case] {
    let functions = Self.root["functions"] as! [String: Any]
    guard let entry = functions[name] as? [String: Any], let list = entry["cases"] as? [[String: Any]] else {
      XCTFail("no cases for \(name)", file: file, line: line)
      return []
    }
    XCTAssertFalse(list.isEmpty, "\(name) has no cases", file: file, line: line)
    return list.map { Case(args: $0["args"] as? [Any] ?? [], result: $0["result"] as Any) }
  }

  /// A partial order as the TypeScript functions take it. The generated
  /// HostOrder requires a status and every totals field, so the gaps are
  /// filled the way liftLegacyOrder and a stored order fill them.
  private func order(_ value: Any) throws -> HostOrder {
    var fields = value as? [String: Any] ?? [:]
    if fields["status"] == nil { fields["status"] = "paid" }
    if let totals = fields["totals"] as? [String: Any] {
      var filled: [String: Any] = [
        "discountCents": 0, "feeCents": 0, "itemsCents": 0, "shippingCents": 0, "taxCents": 0,
      ]
      filled.merge(totals) { _, given in given }
      fields["totals"] = filled
    }
    let data = try JSONSerialization.data(withJSONObject: fields)
    return try JSONDecoder().decode(HostOrder.self, from: data)
  }

  private func string(_ value: Any?) -> String? { value as? String }
  private func int(_ value: Any?) -> Int { (value as? NSNumber)?.intValue ?? 0 }

  func testEveryPortedFunctionHasConsoleCases() {
    XCTAssertEqual(Self.root["timeZone"] as? String, "UTC")
    let functions = Self.root["functions"] as! [String: Any]
    for name in [
      "formatOrderNumber", "formatOrderMoney", "formatReceiptMoney", "formatReceiptTime", "orderChannelLabel",
      "canTransitionOrder", "orderRefundState", "orderRefundSummary", "orderNetCents", "orderPaidCents",
      "apportionCents", "expandVariantMatrix", "renameProductOptions",
    ] {
      XCTAssertNotNil(functions[name], name)
    }
  }

  func testOrderNumbersReadAsTheConsoleWritesThem() throws {
    for item in cases("formatOrderNumber") {
      let docId = item.args.count > 1 ? string(item.args[1]) : nil
      XCTAssertEqual(formatOrderNumber(try order(item.args[0]), docId: docId), item.result as? String, item.label)
    }
  }

  func testOrderMoneyPrintsAsTheBuyerEmailsDo() {
    for item in cases("formatOrderMoney") {
      let cents = int(item.args[0])
      let money =
        item.args.count > 1 ? formatOrderMoney(cents, currency: string(item.args[1]) ?? "") : formatOrderMoney(cents)
      XCTAssertEqual(money, item.result as? String, item.label)
    }
  }

  func testReceiptMoneyPrintsAtEachCurrencysOwnDigits() {
    for item in cases("formatReceiptMoney") {
      XCTAssertEqual(
        formatReceiptMoney(int(item.args[0]), currency: string(item.args[1]) ?? ""), item.result as? String,
        item.label)
    }
  }

  func testReceiptTimeReadsInTheGivenZoneElseUTC() {
    for item in cases("formatReceiptTime") {
      let atMs = (item.args[0] as! NSNumber).int64Value
      let zone = item.args.count > 1 ? string(item.args[1]) : nil
      XCTAssertEqual(formatReceiptTime(atMs, timeZone: zone), item.result as? String, item.label)
    }
  }

  func testChannelLabelsComeFromTheGeneratedMap() {
    for item in cases("orderChannelLabel") {
      XCTAssertEqual(orderChannelLabel(string(item.args[0])), item.result as? String, item.label)
    }
  }

  func testEveryStatusPairTransitionsAsTheConsoleAllows() {
    let all = cases("canTransitionOrder")
    XCTAssertEqual(all.count, 49)
    for item in all {
      let from = OrderStatus(rawValue: item.args[0] as! String)!
      let to = OrderStatus(rawValue: item.args[1] as! String)!
      XCTAssertEqual(canTransitionOrder(from: from, to: to), item.result as? Bool, item.label)
    }
  }

  func testRefundStateAndSummaryMatchTheConsole() throws {
    for item in cases("orderRefundState") {
      XCTAssertEqual(orderRefundState(try order(item.args[0])).rawValue, item.result as? String, item.label)
    }
    for item in cases("orderRefundSummary") {
      XCTAssertEqual(orderRefundSummary(try order(item.args[0])), item.result as? String, item.label)
    }
  }

  func testNetAndPaidCentsTakeRefundsOff() throws {
    for item in cases("orderNetCents") {
      XCTAssertEqual(orderNetCents(try order(item.args[0])), int(item.result), item.label)
    }
    for item in cases("orderPaidCents") {
      XCTAssertEqual(orderPaidCents(try order(item.args[0])), int(item.result), item.label)
    }
  }

  func testApportionedCentsAddUpByLargestRemainder() {
    for item in cases("apportionCents") {
      let weights = (item.args[0] as! [Any]).map(int)
      let expected = (item.result as! [Any]).map(int)
      XCTAssertEqual(apportionCents(weights, totalCents: int(item.args[1])), expected, item.label)
    }
  }

  func testBundledContractValuesDecode() {
    XCTAssertEqual(ContractValues.shared.orderChannelLabels["online"], "Online")
    XCTAssertFalse(ContractValues.shared.orderListQuery.fields.isEmpty)
  }

  private func options(_ value: Any?) throws -> [ProductOption] {
    let data = try JSONSerialization.data(withJSONObject: value as? [Any] ?? [])
    return try JSONDecoder().decode([ProductOption].self, from: data)
  }

  private func variants(_ value: Any?) throws -> [ProductVariant] {
    let data = try JSONSerialization.data(withJSONObject: value as? [Any] ?? [])
    return try JSONDecoder().decode([ProductVariant].self, from: data)
  }

  func testTheVariantMatrixIsTheConsoles() throws {
    for item in cases("expandVariantMatrix") {
      let expected = item.result as! [[String: String]]
      let given = item.args[0] is NSNull ? nil : try options(item.args[0])
      XCTAssertEqual(expandVariantMatrix(given), expected, item.label)
    }
  }

  func testRenamingAnOptionIsTheConsoles() throws {
    for item in cases("renameProductOptions") {
      let product = item.args[0] as! [String: Any]
      let names = (item.args[1] as! [Any]).map { $0 as? String }
      let answer = renameProductOptions(
        options: try options(product["options"]), variants: try variants(product["variants"]), names: names)
      let expected = item.result as! [String: Any]
      XCTAssertEqual(answer.options, try options(expected["options"]), item.label)
      XCTAssertEqual(answer.variants, try variants(expected["variants"]), item.label)
    }
  }
}
