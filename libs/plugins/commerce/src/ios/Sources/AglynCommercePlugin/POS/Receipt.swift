// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynHardware
import Foundation

/*
 * THE RECEIPT, ON THIS DEVICE. The Kotlin app's `Receipt.kt`, line for line.
 *
 * The same receipt the console prints and emails (`commerce-receipt.ts`,
 * `print-document.ts`): read from the order as stored, laid out once in
 * columns, then shown on screen as text or handed to the system's print dialog.
 */

private let receiptMethodLabels: [String: String] = [
  "cash": "Cash", "card_present": "Card", "card_keyed": "Card", "card_link": "Card", "gift_card": "Gift card",
  "folio": "Charged to room",
]

/// A stored amount as whole cents, or zero when it is absent, not a number or not above zero.
private func wholeCentsAboveZero(_ value: Any?) -> Int {
  guard let number = (value as? NSNumber)?.doubleValue, number.isFinite else { return 0 }
  return max(0, jsRound(number))
}

private func isAbsent(_ value: Any?) -> Bool { value == nil || value is NSNull }

struct ReceiptTenders: Equatable {
  let tenders: [ReceiptTender]
  let changeCents: Int
  let tipCents: Int
}

/// The tenders an order was paid with: the register's ledger when it has one (`receiptTendersFromOrder`).
func receiptTendersFromOrder(_ order: [String: Any]) -> ReceiptTenders {
  let payments = (order["payments"] as? [Any])?.compactMap { $0 as? [String: Any] } ?? []
  if !payments.isEmpty {
    var change = 0
    var tip = 0
    let tenders = payments.filter { $0["status"] as? String == "succeeded" }.map { payment -> ReceiptTender in
      change += wholeCentsAboveZero(payment["changeCents"])
      tip += wholeCentsAboveZero(payment["tipCents"])
      let brand = (payment["cardBrand"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      let last4 = (payment["last4"] as? String).flatMap { $0.isEmpty ? nil : "**** \($0)" }
      let card = [brand, last4].compactMap { $0 }.joined(separator: " ")
      let label = card.isEmpty ? (receiptMethodLabels[payment["method"] as? String ?? ""] ?? "Payment") : card
      let tendered = wholeCentsAboveZero(payment["cashTenderedCents"])
      let amount = tendered > 0 ? tendered : wholeCentsAboveZero(payment["amountCents"]) + wholeCentsAboveZero(payment["tipCents"])
      return ReceiptTender(amountCents: Double(amount), label: label)
    }
    return ReceiptTenders(tenders: tenders, changeCents: change, tipCents: tip)
  }
  let totalCents = wholeCentsAboveZero((order["totals"] as? [String: Any])?["totalCents"])
  let changeCents = wholeCentsAboveZero(order["changeCents"])
  if totalCents == 0 { return ReceiptTenders(tenders: [], changeCents: 0, tipCents: 0) }
  let isCash = order["channel"] as? String == "pos" && isAbsent(order["checkoutSessionId"]) && isAbsent(order["paymentIntentId"])
  let label = !isAbsent(order["reservationId"]) ? "Charged to room" : (isCash ? "Cash" : "Card")
  return ReceiptTenders(
    tenders: [ReceiptTender(amountCents: Double(totalCents + (isCash ? changeCents : 0)), label: label)],
    changeCents: isCash ? changeCents : 0, tipCents: 0)
}

struct ReceiptContext: Equatable {
  var storeName: String
  var storeLines: [String] = []
  var registerName: String?
  var cashierName: String?
  var timeZone: String?
  var currency: String?
  var footer: String?
}

/// The receipt an order prints, from the order as stored (`receiptDataFromOrder`).
func receiptDataFromOrder(orderID: String, order: [String: Any], context: ReceiptContext, nowMs: Int64) -> ReceiptData {
  let lines = ((order["lineItems"] as? [Any]) ?? []).compactMap { $0 as? [String: Any] }.map { line -> ReceiptLine in
    let quantity = max(1, (line["quantity"] as? NSNumber).map { jsRound($0.doubleValue) } ?? 1)
    let unit = (line["unitAmountCents"] as? NSNumber).map { jsRound($0.doubleValue) } ?? 0
    return ReceiptLine(
      detail: (line["variantLabel"] as? String).flatMap { $0.isEmpty ? nil : $0 }, name: line["name"] as? String ?? "Item",
      quantity: Double(quantity), totalCents: Double(unit * quantity), unitCents: Double(unit))
  }
  let totals = order["totals"] as? [String: Any] ?? [:]
  let subtotal = (totals["itemsCents"] as? NSNumber)?.doubleValue ?? lines.reduce(0.0) { $0 + $1.totalCents }
  let paid = receiptTendersFromOrder(order)
  let storedTip = wholeCentsAboveZero(totals["tipCents"])
  let tip = storedTip > 0 ? storedTip : paid.tipCents
  let number = (order["number"] as? NSNumber).map { String($0.int64Value) } ?? String(orderID.prefix(8)).uppercased()
  func nonZero(_ key: String) -> Double? { (totals[key] as? NSNumber)?.doubleValue.nonZero }
  let created = (order["createdAtMs"] as? NSNumber)?.doubleValue
  return ReceiptData(
    barcode: number, cashierName: context.cashierName, changeCents: paid.changeCents > 0 ? Double(paid.changeCents) : nil,
    createdAtMs: created.flatMap { $0 > 0 ? $0 : nil } ?? Double(nowMs), currency: order["currency"] as? String ?? context.currency ?? "usd",
    discountCents: nonZero("discountCents"), footer: context.footer, lines: lines, orderId: orderID, orderNumber: number,
    refundedCents: wholeCentsAboveZero(order["refundedCents"]) > 0 ? Double(wholeCentsAboveZero(order["refundedCents"])) : nil,
    registerName: context.registerName, shippingCents: nonZero("shippingCents"),
    storeLines: context.storeLines.isEmpty ? nil : context.storeLines, storeName: context.storeName, subtotalCents: subtotal,
    taxCents: nonZero("taxCents"), tenders: paid.tenders.isEmpty ? nil : paid.tenders, timeZone: context.timeZone,
    tipCents: tip > 0 ? Double(tip) : nil, totalCents: (totals["totalCents"] as? NSNumber)?.doubleValue ?? subtotal)
}

private extension Double {
  var nonZero: Double? { self != 0 ? self : nil }
}

struct ReceiptLayoutOptions: Equatable {
  var columns: Int
  /// Print the logo stored in the printer.
  var logo = false
  /// Kick the cash drawer as the receipt starts printing.
  var openDrawer = false
  /// A gift receipt: the items and the barcode a recipient returns with, and no price, total or tender.
  var gift = false
}

/// The customer receipt, laid out to the paper (`layoutReceipt`).
func layoutReceipt(_ receipt: ReceiptData, _ options: ReceiptLayoutOptions) -> PrintDocument {
  let columns = options.columns
  let money = { (cents: Double) in formatReceiptMoney(jsRound(cents), currency: receipt.currency) }
  var ops: [PrintOp] = []
  func line(_ left: String, _ right: String, bold: Bool = false) {
    for text in twoColumnLines(left, right, width: columns) { ops.append(.text(text, bold: bold)) }
  }
  let rule = PrintOp.text(String(repeating: "-", count: columns))
  // The drawer first: the cashier makes change while the receipt prints.
  if options.openDrawer { ops.append(.drawer) }
  if options.logo { ops.append(.logo) }
  if let banner = receipt.banner, !banner.isEmpty {
    ops.append(.text(String(toPrintable(banner).prefix(columns / 2)), align: .center, bold: true, size: 2))
  }
  for text in wrapText(receipt.storeName, width: columns / 2) { ops.append(.text(text, align: .center, bold: true, size: 2)) }
  for storeLine in receipt.storeLines ?? [] {
    for text in wrapText(storeLine, width: columns) { ops.append(.text(text, align: .center)) }
  }
  ops.append(.feed(1))
  line("Order #\(receipt.orderNumber)", formatReceiptTime(Int64(receipt.createdAtMs), timeZone: receipt.timeZone))
  let who = [receipt.registerName, receipt.cashierName].compactMap { $0.flatMap { $0.isEmpty ? nil : $0 } }.joined(separator: " - ")
  if !who.isEmpty { for text in wrapText(who, width: columns) { ops.append(.text(text)) } }
  ops.append(rule)
  for item in receipt.lines {
    let quantity = Int(item.quantity)
    if options.gift {
      for text in wrapText("\(quantity) x \(item.name)", width: columns) { ops.append(.text(text)) }
    } else {
      line(quantity > 1 ? "\(quantity) x \(item.name)" : item.name, money(item.totalCents))
    }
    if let detail = item.detail, !detail.isEmpty {
      for text in wrapText(detail, width: columns - 2) { ops.append(.text("  \(text)")) }
    }
    if quantity > 1, !options.gift { ops.append(.text(String(toPrintable("  @ \(money(item.unitCents)) each").prefix(columns)))) }
  }
  ops.append(rule)
  if !options.gift {
    line("Subtotal", money(receipt.subtotalCents))
    if let discount = receipt.discountCents, discount != 0 { line("Discount", "-\(money(discount))") }
    if let shipping = receipt.shippingCents, shipping != 0 { line("Shipping", money(shipping)) }
    if let tax = receipt.taxCents, tax != 0 { line("Tax", money(tax)) }
    if let tip = receipt.tipCents, tip != 0 { line("Tip", money(tip)) }
    for text in twoColumnLines("TOTAL", money(receipt.totalCents), width: columns / 2) { ops.append(.text(text, bold: true, size: 2)) }
    let change = receipt.changeCents.flatMap { $0 != 0 ? $0 : nil }
    if !(receipt.tenders ?? []).isEmpty || change != nil { ops.append(.feed(1)) }
    for tender in receipt.tenders ?? [] { line(tender.label, money(tender.amountCents)) }
    if let change { line("Change", money(change), bold: true) }
    if let refunded = receipt.refundedCents, refunded != 0 { line("Refunded", "-\(money(refunded))") }
  }
  let barcode = code128Printable(receipt.barcode ?? receipt.orderNumber)
  if !barcode.isEmpty {
    ops.append(.feed(1))
    ops.append(.barcode(barcode))
  }
  if let footer = receipt.footer, !footer.isEmpty {
    ops.append(.feed(1))
    for text in wrapText(footer, width: columns) { ops.append(.text(text, align: .center)) }
  }
  ops.append(.feed(2))
  ops.append(.cut)
  return PrintDocument(columns: columns, ops: ops)
}
