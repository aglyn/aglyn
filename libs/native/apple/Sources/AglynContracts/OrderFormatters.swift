// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The console's order and receipt formatters and rules, ported once from
// libs/plugins/commerce/src/lib/model/{commerce-orders,order-figures,
// buyer-notifications,commerce-receipt}.ts. function-cases.generated.json
// holds the answers the TypeScript gives, and the tests replay every one.
// Amounts are whole cents (a currency's minor units for receipts).

/// `#1042`, else the last six of the document id upper-cased, else `#—`.
public func formatOrderNumber(_ order: HostOrder?, docId: String? = nil) -> String {
  if let number = order?.number { return "#\(jsNumberText(number))" }
  if let docId, !docId.isEmpty { return "#\(String(docId.suffix(6)).uppercased())" }
  return "#—"
}

/// The channel's label (`Online`, `POS`…), else the raw channel, else `Online`.
public func orderChannelLabel(_ channel: String?) -> String {
  ContractValues.shared.orderChannelLabels[channel ?? "online"] ?? channel ?? "Online"
}

private let orderTransitions: [OrderStatus: Set<OrderStatus>] = [
  .pending: [.paid, .cancelled],
  .paid: [.partiallyFulfilled, .fulfilled, .cancelled, .refunded],
  .partiallyFulfilled: [.fulfilled, .refunded],
  .fulfilled: [.delivered, .refunded],
  .delivered: [.refunded],
  .cancelled: [.refunded],
  .refunded: [],
]

/// Whether an order may move from one status to another.
public func canTransitionOrder(from: OrderStatus, to: OrderStatus) -> Bool {
  orderTransitions[from]?.contains(to) ?? false
}

/// How much of an order has been handed back.
public enum OrderRefundState: String, Sendable, CaseIterable {
  case none
  case partial
  case full
}

/// The order's charged total in cents: `totals.totalCents`, else the legacy `amountCents`.
private func grossCents(_ order: HostOrder) -> Int {
  wholeCents(order.totals?.totalCents ?? order.amountCents ?? 0)
}

public func orderRefundState(_ order: HostOrder) -> OrderRefundState {
  let refunded = max(0, wholeCents(order.refundedCents ?? 0))
  let total = grossCents(order)
  if order.status == .refunded { return .full }
  if refunded <= 0 { return .none }
  return total > 0 && refunded >= total ? .full : .partial
}

/// `12345` → `123.45`, the plain amount the refund line prints after its `$`.
private func usd(_ cents: Int) -> String {
  let digits = grouped(abs(cents), digits: 2, separator: "")
  return cents < 0 ? "-\(digits)" : digits
}

/// The line under an order's total that says what was refunded, or `""` when nothing was.
public func orderRefundSummary(_ order: HostOrder) -> String {
  let state = orderRefundState(order)
  if state == .none { return "" }
  let refunded = max(0, wholeCents(order.refundedCents ?? 0))
  if state == .full { return "Refunded in full ($\(usd(refunded)))" }
  let revoked = order.refundedLineItemIds?.count ?? 0
  let lines = order.lineItems?.count ?? 0
  let scope =
    revoked > 0
    ? "\(revoked) of \(lines) line\(lines == 1 ? "" : "s") withdrawn"
    : "no lines withdrawn — refunded by amount"
  return "Partially refunded ($\(usd(refunded)) of $\(usd(grossCents(order)))) — \(scope)"
}

/// The sale's revenue after refunds; a refunded register tip comes off at most once.
public func orderNetCents(_ order: HostOrder) -> Int {
  let gross = grossCents(order)
  let refunded = wholeCents(order.refundedCents ?? 0)
  let tip = wholeCents(order.totals?.tipCents ?? 0)
  return gross - (tip > 0 ? min(refunded, gross) : refunded)
}

/// What the order took, less refunds.
public func orderPaidCents(_ order: HostOrder) -> Int {
  grossCents(order) - wholeCents(order.refundedCents ?? 0)
}

/// Splits `totalCents` across `weights` in whole cents by largest remainder,
/// never handing out more than the weights add up to.
public func apportionCents(_ weights: [Int], totalCents: Int) -> [Int] {
  let safe = weights.map { max(0, $0) }
  let basis = safe.reduce(0, +)
  let total = max(0, totalCents)
  if safe.isEmpty || basis <= 0 || total <= 0 { return safe.map { _ in 0 } }
  let pot = min(total, basis)
  // Each share is weight × pot / basis: its whole part, and a remainder over
  // the common denominator `basis` that ranks who gets the leftover cents.
  var shares = safe.map { $0 * pot / basis }
  let remainders = safe.map { $0 * pot % basis }
  var leftover = pot - shares.reduce(0, +)
  let ranked = remainders.indices.sorted { a, b in
    remainders[a] != remainders[b] ? remainders[a] > remainders[b] : a < b
  }
  for index in ranked {
    if leftover <= 0 { break }
    shares[index] += 1
    leftover -= 1
  }
  return shares
}

// MARK: - Money

/// A currency's symbol and minor-unit digits, as en-US ICU prints them.
private struct CurrencyStyle {
  let symbol: String?
  let digits: Int
}

private let currencySymbols: [String: String] = [
  "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥", "CAD": "CA$", "AUD": "A$", "NZD": "NZ$",
  "MXN": "MX$", "BRL": "R$", "INR": "₹", "CNY": "CN¥", "KRW": "₩", "HKD": "HK$", "ILS": "₪",
  "TWD": "NT$", "VND": "₫", "PHP": "₱", "XAF": "FCFA", "XOF": "F\u{202F}CFA", "XPF": "CFPF",
]
private let zeroDigitCurrencies: Set<String> = [
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV",
  "XAF", "XOF", "XPF",
]
private let threeDigitCurrencies: Set<String> = ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]

/// The style of a well-formed three-letter code; nil for anything else, which Intl refuses.
private func currencyStyle(_ code: String) -> CurrencyStyle? {
  guard code.count == 3, code.unicodeScalars.allSatisfy({ ("A"..."Z").contains($0) }) else { return nil }
  let digits = zeroDigitCurrencies.contains(code) ? 0 : threeDigitCurrencies.contains(code) ? 3 : 2
  return CurrencyStyle(symbol: currencySymbols[code], digits: digits)
}

/// `1,234,567.89`: a non-negative amount in minor units, grouped, at exactly `digits` decimals.
private func grouped(_ minorUnits: Int, digits: Int, separator: String = ",") -> String {
  var scale = 1
  for _ in 0..<digits { scale *= 10 }
  var whole = String(minorUnits / scale)
  if !separator.isEmpty {
    var groups: [Substring] = []
    while whole.count > 3 {
      groups.insert(whole.suffix(3), at: 0)
      whole.removeLast(3)
    }
    groups.insert(Substring(whole), at: 0)
    whole = groups.joined(separator: separator)
  }
  if digits == 0 { return whole }
  let fraction = String(minorUnits % scale)
  return whole + "." + String(repeating: "0", count: digits - fraction.count) + fraction
}

/// `$12.50`, `-€3.00`, `KWD 12.345`: a prefix that ends in a letter (a bare
/// code, `FCFA`) is followed by a no-break space, as ICU spaces it.
private func currencyText(_ minorUnits: Int, code: String, style: CurrencyStyle) -> String {
  let symbol = style.symbol ?? code
  let spaced = symbol.last.map { $0.isLetter } ?? false
  let prefix = spaced ? symbol + "\u{00A0}" : symbol
  return (minorUnits < 0 ? "-" : "") + prefix + grouped(abs(minorUnits), digits: style.digits)
}

/// An order amount in cents, as the buyer emails print it (en-US). The
/// amount is in hundredths whatever the currency, shown at the currency's
/// own digits (halves round away from zero).
public func formatOrderMoney(_ cents: Int, currency: String = "USD") -> String {
  let code = (currency.isEmpty ? "USD" : currency).uppercased()
  guard let style = currencyStyle(code) else { return "$\(usd(cents))" }
  let minor: Int
  if style.digits >= 2 {
    var scale = 1
    for _ in 0..<(style.digits - 2) { scale *= 10 }
    minor = cents * scale
  } else {
    let divisor = style.digits == 1 ? 10 : 100
    let rounded = (abs(cents) + divisor / 2) / divisor
    minor = cents < 0 ? -rounded : rounded
  }
  return currencyText(minor, code: code, style: style)
}

/// A receipt amount: `cents` is in the currency's minor units, printed at its own digits.
public func formatReceiptMoney(_ cents: Int, currency: String) -> String {
  let code = (currency.isEmpty ? "usd" : currency).uppercased()
  guard let style = currencyStyle(code) else { return "\(usd(cents)) \(code)" }
  return currencyText(cents, code: code, style: style)
}

// MARK: - Time

/// The receipt timestamp, e.g. `Oct 6, 2026, 3:04 PM`, in `timeZone` (UTC when absent or unknown).
public func formatReceiptTime(_ atMs: Int64, timeZone: String? = nil) -> String {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.calendar = Calendar(identifier: .gregorian)
  formatter.dateFormat = "MMM d, yyyy, h:mm a"
  formatter.timeZone =
    timeZone.flatMap { $0.isEmpty ? nil : TimeZone(identifier: $0) } ?? TimeZone(identifier: "UTC")
  return formatter.string(from: Date(timeIntervalSince1970: Double(atMs) / 1000))
}

// MARK: - Numbers

/// JavaScript's `Math.round` to whole cents: halves round toward positive infinity.
func wholeCents(_ value: Double) -> Int {
  value.isFinite ? Int((value + 0.5).rounded(.down)) : 0
}

/// A number as JavaScript's template literal prints it: whole numbers without a fraction.
func jsNumberText(_ value: Double) -> String {
  if value.isFinite, value == value.rounded(), abs(value) < 9_007_199_254_740_992 {
    return String(Int64(value))
  }
  return String(value)
}
