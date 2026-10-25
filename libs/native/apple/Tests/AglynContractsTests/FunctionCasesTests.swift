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
      "apportionCents", "describeRestockCheck", "posPinProblem", "posCashVarianceCents", "expandVariantMatrix", "renameProductOptions",
      "currencyFractionDigits", "currencyMinorToMajor", "parseCurrencyInput", "customFieldCurrency",
      "planCardMeterOrder", "planCardContext", "planCardShows",
      "checkInItemLabel", "describeWristband", "checkInTimeLabel", "alreadyCheckedInLabel", "normalizeWristband", "normalizeProductCheckIn",
    ] {
      XCTAssertNotNil(functions[name], name)
    }
  }

  /// A CRM currency field's amounts (AGL-3971): USD's two decimals, JPY's none, BHD's three, as the console's `Intl`.
  func testCurrencyFieldAmountsUseEachCurrencysOwnDecimals() {
    for item in cases("currencyFractionDigits") {
      XCTAssertEqual(currencyFractionDigits(string(item.args[0]) ?? ""), int(item.result), item.label)
    }
    for item in cases("currencyMinorToMajor") {
      let minor = (item.args[0] as? NSNumber)?.doubleValue ?? 0
      XCTAssertEqual(
        currencyMinorToMajor(minor, string(item.args[1]) ?? ""), (item.result as? NSNumber)?.doubleValue ?? .nan,
        item.label)
    }
    for item in cases("parseCurrencyInput") {
      XCTAssertEqual(
        parseCurrencyInput(string(item.args[0]), string(item.args[1]) ?? ""), (item.result as? NSNumber)?.int64Value,
        item.label)
    }
    for item in cases("customFieldCurrency") {
      XCTAssertEqual(customFieldCurrency((item.args[0] as? [String: Any])?["currency"] as? String), string(item.result), item.label)
    }
    XCTAssertEqual(currencyInputText(125050, "usd"), "1250.50")
    XCTAssertEqual(currencyInputText(1500, "jpy"), "1500")
    XCTAssertEqual(currencyInputText(1250, "bhd"), "1.250")
    let us = Locale(identifier: "en_US")
    XCTAssertEqual(formatCurrencyFieldValue(125050, "usd", locale: us), "$1,250.50")
    XCTAssertEqual(formatCurrencyFieldValue(1500, "jpy", locale: us), "¥1,500")
    XCTAssertTrue(formatCurrencyFieldValue(1250, "bhd", locale: us).hasSuffix("1.250"))
  }

  /// The plan card's meters (AGL-3992): the context's meter leads, the rest fullest first, Sites last outside the Sites
  /// list, failed and uncapped meters left out, as the console's `plan-card-meters.ts`.
  func testThePlanCardOrdersItsMetersAsTheConsoleDoes() {
    func readings(_ value: Any) -> [PlanCardReading] {
      (value as? [[String: Any]] ?? []).map {
        PlanCardReading(
          meter: $0["meter"] as? String ?? "", used: ($0["used"] as? NSNumber)?.doubleValue,
          limit: ($0["limit"] as? NSNumber)?.doubleValue)
      }
    }
    for item in cases("planCardMeterOrder") {
      XCTAssertEqual(planCardMeterOrder(readings(item.args[0]), context: string(item.args[1])), item.result as? [String], item.label)
    }
    for item in cases("planCardContext") {
      XCTAssertEqual(planCardContext(string(item.args[0]), inSite: item.args[1] as? Bool ?? false), string(item.result), item.label)
    }
    for item in cases("planCardShows") {
      XCTAssertEqual(planCardShows(readings(item.args[0]), offersUpgrade: item.args[1] as? Bool ?? false), item.result as? Bool, item.label)
    }
  }

  func testTheRestockQuestionIsWordedAsTheConsoleWordsIt() throws {
    for item in cases("describeRestockCheck") {
      let data = try JSONSerialization.data(withJSONObject: item.args[0])
      let check = try JSONDecoder().decode(OrderRestockCheck.self, from: data)
      XCTAssertEqual(describeRestockCheck(check, order: try order(item.args[1])), item.result as? String, item.label)
    }
  }

  func testPinsAreJudgedAsTheConsoleJudgesThem() {
    for item in cases("posPinProblem") {
      XCTAssertEqual(posPinProblem(string(item.args[0])), item.result as? String, item.label)
    }
  }

  func testTheDrawerVarianceIsCountedMinusExpected() {
    for item in cases("posCashVarianceCents") {
      let counted = (item.args[0] as? NSNumber)?.doubleValue ?? 0
      let expected = (item.args[1] as? NSNumber)?.doubleValue ?? 0
      XCTAssertEqual(posCashVarianceCents(counted: counted, expected: expected), int(item.result), item.label)
    }
  }

  func testAnOfflineSaleIsPricedAndTaxedAsTheConsoleDoes() {
    for item in cases("posOfflineSaleTotals") {
      let input = item.args[0] as? [String: Any] ?? [:]
      let lines = (input["lines"] as? [[String: Any]] ?? []).map {
        PosOfflineTotalsLine(
          unitAmountCents: ($0["unitAmountCents"] as? NSNumber)?.doubleValue ?? 0, quantity: ($0["quantity"] as? NSNumber)?.doubleValue ?? 1)
      }
      let tax = input["tax"] as? [String: Any] ?? [:]
      let totals = posOfflineSaleTotals(
        lines: lines, discountPct: (input["discountPct"] as? NSNumber)?.doubleValue ?? 0,
        taxPct: (tax["pct"] as? NSNumber)?.doubleValue, pricesIncludeTax: tax["pricesIncludeTax"] as? Bool ?? false)
      let expected = item.result as? [String: Any] ?? [:]
      XCTAssertEqual(totals.itemsCents, (expected["itemsCents"] as? NSNumber)?.doubleValue, item.label)
      XCTAssertEqual(totals.discountCents, (expected["discountCents"] as? NSNumber)?.doubleValue, item.label)
      XCTAssertEqual(totals.taxCents, (expected["taxCents"] as? NSNumber)?.doubleValue, item.label)
      XCTAssertEqual(totals.totalCents, (expected["totalCents"] as? NSNumber)?.doubleValue, item.label)
      XCTAssertEqual(totals.shippingCents, (expected["shippingCents"] as? NSNumber)?.doubleValue, item.label)
      XCTAssertEqual(totals.feeCents, (expected["feeCents"] as? NSNumber)?.doubleValue, item.label)
    }
  }

  func testChangeIsNeverNegative() {
    for item in cases("posOfflineChangeCents") {
      let total = (item.args[0] as? NSNumber)?.doubleValue ?? 0
      let tendered = (item.args[1] as? NSNumber)?.doubleValue ?? 0
      XCTAssertEqual(posOfflineChangeCents(total: total, tendered: tendered), int(item.result), item.label)
    }
  }

  func testASaleKeyIsAnIdTheOrderCanTake() {
    for item in cases("posOfflineSaleKeyIsValid") {
      XCTAssertEqual(posOfflineSaleKeyIsValid(string(item.args[0])), item.result as? Bool, item.label)
    }
  }

  func testWhatACustomerTypesOnTheDisplayIsCheckedAsTheConsoleChecksIt() {
    for item in cases("posDisplayEmail") { XCTAssertEqual(posDisplayEmail(string(item.args[0])), item.result as? String, item.label) }
    for item in cases("posDisplayPhone") { XCTAssertEqual(posDisplayPhone(string(item.args[0])), item.result as? String, item.label) }
  }

  func testATipIsWholeCentsAndNoMoreThanThePayment() {
    for item in cases("posTipProblem") {
      let tip = (item.args[0] as? NSNumber)?.doubleValue ?? 0
      let amount = (item.args[1] as? NSNumber)?.doubleValue ?? 0
      XCTAssertEqual(posTipProblem(tipCents: tip, amountCents: amount), item.result as? String, item.label)
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

  /// Check-in at the window (AGL-4063): a person's line, a wristband, a time and the wristband rule, as the console says them.
  /// An unknown zone reads in UTC here, the zone the cases were made in (the device's on a register).
  func testCheckInLabelsReadAsTheConsoleWritesThem() {
    let utc = TimeZone(identifier: "UTC")!
    for item in cases("checkInItemLabel") {
      let row = item.args[0] as? [String: Any] ?? [:]
      XCTAssertEqual(
        checkInItemLabel(
          itemName: row["itemName"] as? String ?? "", variantLabel: row["variantLabel"] as? String, unitIndex: int(row["unitIndex"]),
          unitCount: int(row["unitCount"])), item.result as? String, item.label)
    }
    func band(_ value: Any?) -> CheckInWristband? {
      guard let object = value as? [String: Any] else { return nil }
      return CheckInWristband(color: object["color"] as? String, number: object["number"] as? String)
    }
    for item in cases("describeWristband") {
      XCTAssertEqual(describeWristband(band(item.args[0])), item.result as? String, item.label)
    }
    for item in cases("checkInTimeLabel") {
      let at = (item.args[0] as? NSNumber)?.doubleValue
      XCTAssertEqual(checkInTimeLabel(at, timeZone: string(item.args[1]) ?? "", fallback: utc), item.result as? String, item.label)
    }
    for item in cases("alreadyCheckedInLabel") {
      let row = item.args[0] as? [String: Any] ?? [:]
      XCTAssertEqual(
        alreadyCheckedInLabel(
          checkedInAtMs: (row["checkedInAtMs"] as? NSNumber)?.doubleValue, checkedInByName: row["checkedInByName"] as? String,
          timeZone: string(item.args[1]) ?? "", fallback: utc), item.result as? String, item.label)
    }
    for item in cases("normalizeWristband") {
      let want = item.result as? [String: Any] ?? [:]
      let expected: WristbandCheck =
        (want["ok"] as? Bool) == true ? .ok(band(want["wristband"])) : .refused(want["error"] as? String ?? "")
      // The route also refuses a value that is not an object; the register only ever sends the two fields.
      if let raw = item.args[0] as? String, !raw.isEmpty { continue }
      let object = item.args[0] as? [String: Any]
      XCTAssertEqual(normalizeWristband(number: object?["number"] as? String, color: object?["color"] as? String), expected, item.label)
    }
    for item in cases("normalizeProductCheckIn") {
      let want = item.result as? [String: Any]
      let got = normalizeProductCheckIn(item.args[0])
      XCTAssertEqual(got?.enabled, want?["enabled"] as? Bool, item.label)
      XCTAssertEqual(got?.headcount, (want?["headcount"] as? NSNumber)?.intValue, item.label)
    }
    XCTAssertEqual(checkInHeadcount(""), 1)
    XCTAssertEqual(checkInHeadcount("4"), 4)
    XCTAssertEqual(ContractValues.shared.checkInWristbandColors.first, "Red")
    XCTAssertEqual(ContractValues.shared.posCheckInRoute, "/api/commerce/pos-check-in")
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
