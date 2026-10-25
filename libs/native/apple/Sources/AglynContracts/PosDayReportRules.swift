// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * DAY AND EVENT TOTALS (AGL-4037), the console's commerce-pos-day-report.ts:
 * the range label, the amounts and the spreadsheet, replayed against the
 * console's own answers in function-cases.generated.json. The Kotlin kit's
 * `PosDayReportRules.kt`.
 */

/// Minor units as a spreadsheet number in the store's currency: `12.34`, `1200` for yen (`posDayAmount`).
public func posDayAmount(_ cents: Double?, currency: String) -> String {
  guard let cents else { return "" }
  let digits = currencyMinorDigits(currency)
  let rounded = (cents + 0.5).rounded(.down)
  var scale = 1.0
  for _ in 0..<digits { scale *= 10 }
  return String(format: "%.\(digits)f", rounded / scale)
}

/// The range as a reader says it: `2026-10-24` or `2026-10-24 to 2026-10-26` (`posDayRangeLabel`).
public func posDayRangeLabel(from: String, to: String) -> String { from == to ? from : "\(from) to \(to)" }

/// Whether the range had nothing to report: no sale, no return, no shift (`posDayReportIsEmpty`).
public func posDayReportIsEmpty(_ report: PosDayReport) -> Bool {
  report.totals.orderCount == 0 && report.totals.refundCount == 0 && report.shifts.isEmpty
}

/// One spreadsheet cell, quoted when it needs to be and never read as a formula (`posCsvCell`).
public func posCsvCell(_ value: String) -> String {
  var cell = value
  if let first = cell.first, "=+-@\t\r".contains(first),
    cell.range(of: "^-?\\d+(\\.\\d+)?$", options: .regularExpression) == nil
  {
    cell = "'" + cell
  }
  return cell.contains(where: { $0 == "," || $0 == "\"" || $0 == "\r" || $0 == "\n" })
    ? "\"" + cell.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : cell
}

private func isoInstant(_ ms: Double?) -> String {
  guard let ms, ms != 0 else { return "" }
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.string(from: Date(timeIntervalSince1970: ms / 1000))
}

private func count(_ value: Double) -> String { String(Int(value)) }

/// The report as one spreadsheet, block by block, as the console exports it (`posDayReportCsv`).
public func posDayReportCsv(_ report: PosDayReport) -> String {
  let money = { (cents: Double?) in posDayAmount(cents, currency: report.currency) }
  func salesRow(_ section: String, _ name: String, orders: Double, gross: Double, discounts: Double, tax: Double, tips: Double, refunds: Double, refunded: Double, net: Double) -> [String] {
    [section, name, count(orders), money(gross), money(discounts), money(tax), money(tips), count(refunds), money(refunded), money(net)]
  }
  let t = report.totals
  var heading: [[String]] = [
    ["Report", "Day totals"], ["Days", posDayRangeLabel(from: report.from, to: report.to)], ["Time zone", report.timeZone],
    ["Currency", report.currency.uppercased()],
  ]
  if report.truncated == true { heading.append(["Note", "More activity than one report reads; the figures are partial."]) }
  var sales: [[String]] = [
    ["Section", "Name", "Orders", "Gross sales", "Discounts", "Tax", "Tips", "Refunds", "Refunded", "Net sales"],
    salesRow(
      "Total", "Every register", orders: t.orderCount, gross: t.grossSalesCents, discounts: t.discountsCents, tax: t.taxCents,
      tips: t.tipsCents, refunds: t.refundCount, refunded: t.refundsCents, net: t.netSalesCents),
  ]
  for row in report.byRegister {
    sales.append(
      salesRow(
        "Register", row.name, orders: row.orderCount, gross: row.grossSalesCents, discounts: row.discountsCents, tax: row.taxCents,
        tips: row.tipsCents, refunds: row.refundCount, refunded: row.refundsCents, net: row.netSalesCents))
  }
  for row in report.byCashier {
    sales.append(
      salesRow(
        "Cashier", row.name, orders: row.orderCount, gross: row.grossSalesCents, discounts: row.discountsCents, tax: row.taxCents,
        tips: row.tipsCents, refunds: row.refundCount, refunded: row.refundsCents, net: row.netSalesCents))
  }
  let tenders: [[String]] =
    [["Tender", "Sales", "Refunds", "Net"]]
    + report.byTender.map { [$0.label, money($0.salesCents), money($0.refundsCents), money($0.netCents)] }
  let shifts: [[String]] =
    [[
      "Shift", "Register", "Status", "Opened", "Opened by", "Closed", "Closed by", "Starting cash", "Net sales", "Expected cash",
      "Counted cash", "Variance",
    ]]
    + report.shifts.map {
      [
        $0.shiftId, $0.registerName, $0.status == .open ? "Open" : "Closed", isoInstant($0.openedAtMs), $0.openedByName,
        isoInstant($0.closedAtMs), $0.closedByName ?? "", money($0.openingFloatCents), money($0.netSalesCents),
        money($0.expectedCashCents), money($0.countedCashCents), money($0.varianceCents),
      ]
    }
  let c = report.cash
  let drawers: [[String]] = [
    ["Cash drawers", "Amount"], ["Starting cash", money(c.openingFloatCents)], ["Cash sales", money(c.cashSalesCents)],
    ["Paid in", money(c.paidInCents)], ["Paid out", money(c.paidOutCents)], ["Safe drops", money(c.dropsCents)],
    ["Cash refunds", money(c.cashRefundsCents)], ["Expected in closed drawers", money(c.expectedCashCents)],
    ["Counted in closed drawers", money(c.countedCashCents)], ["Variance", money(c.varianceCents)],
    ["Expected in open drawers", money(c.openExpectedCashCents)],
  ]
  return [heading, sales, tenders, shifts, drawers]
    .map { rows in rows.map { $0.map(posCsvCell).joined(separator: ",") }.joined(separator: "\r\n") }
    .joined(separator: "\r\n\r\n")
}

/// One shift of the history as the spreadsheet reads it: the shift, its id and its register's name.
public struct PosShiftCsvRow: Equatable, Sendable {
  public let id: String
  public let registerName: String?
  public let shift: PosShift

  public init(id: String, registerName: String?, shift: PosShift) {
    self.id = id
    self.registerName = registerName
    self.shift = shift
  }
}

/// Minor units as dollars with two decimals, rounded half up as the console's `Math.round` rounds; empty for none.
private func shiftDollars(_ cents: Double?) -> String {
  guard let cents else { return "" }
  return String(format: "%.2f", (cents + 0.5).rounded(.down) / 100)
}

/// The shift history as a spreadsheet: one row per shift, money in dollars (`posShiftsCsv`).
public func posShiftsCsv(_ rows: [PosShiftCsvRow], memberName: (String) -> String = { $0 }) -> String {
  let header = [
    "Shift", "Register", "Opened", "Opened by", "Closed", "Closed by", "Orders", "Gross sales", "Refunds", "Net sales",
    "Discounts", "Tax", "Tips", "Cash sales", "Card sales", "Gift card sales", "Room charges", "Opening float", "Paid in",
    "Paid out", "Safe drops", "Cash refunds", "Expected cash", "Counted cash", "Variance",
  ]
  let lines: [[String]] = rows.map { row in
    let shift = row.shift
    let report = shift.report
    let tender = { (key: String) in report?.salesByTender[key] ?? 0 }
    let card: Double? = report.map { _ in tender("card_present") + tender("card_keyed") + tender("card_link") }
    return [
      row.id,
      row.registerName ?? shift.registerId,
      isoInstant(shift.openedAtMs),
      shift.openedByName ?? memberName(shift.openedBy),
      isoInstant(shift.closedAtMs),
      shift.closedBy.map { shift.closedByName ?? memberName($0) } ?? "",
      report.map { count($0.orderCount) } ?? "",
      shiftDollars(report?.grossSalesCents),
      shiftDollars(report?.refundsCents),
      shiftDollars(report?.netSalesCents),
      shiftDollars(report?.discountsCents),
      shiftDollars(report?.taxCents),
      shiftDollars(report?.tipsCents),
      shiftDollars(report?.cashSalesCents),
      shiftDollars(card),
      shiftDollars(report.map { _ in tender("gift_card") }),
      shiftDollars(report.map { _ in tender("folio") }),
      shiftDollars(shift.openingFloatCents),
      shiftDollars(report?.paidInCents),
      shiftDollars(report?.paidOutCents),
      shiftDollars(report?.dropsCents),
      shiftDollars(report?.cashRefundsCents),
      shiftDollars(shift.expectedCashCents ?? report?.expectedCashCents),
      shiftDollars(shift.countedCashCents),
      shiftDollars(shift.varianceCents),
    ]
  }
  return ([header] + lines).map { $0.map(posCsvCell).joined(separator: ",") }.joined(separator: "\r\n")
}
