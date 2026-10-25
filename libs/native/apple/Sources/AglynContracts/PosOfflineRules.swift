// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * The offline register's own arithmetic (commerce-pos-offline.ts), ported once
 * and replayed against the console's answers in function-cases.generated.json.
 * The Kotlin kit's `PosOfflineRules.kt`.
 *
 * WHAT SELLS OFFLINE IS CASH, AND ONLY CASH (the console's rule, unchanged): a
 * card, a gift card, a room charge, store credit and a promotion code each need
 * the server. The register prices the basket from its cached catalog and the
 * store's own tax rate, exactly as the online till does for the same basket
 * with no promotion.
 */

private func jsRounded(_ value: Double) -> Double { (value + 0.5).rounded(.down) }

/// `wholeCents`: a positive whole number of cents, else 0.
private func wholeCents(_ value: Double) -> Double {
  guard value.isFinite else { return 0 }
  let rounded = jsRounded(value)
  return rounded > 0 ? rounded : 0
}

/// A key the register minted: an id the order can take, and nothing else (`posOfflineSaleKeyIsValid`).
public func posOfflineSaleKeyIsValid(_ key: String?) -> Bool {
  guard let key, key.range(of: "^[A-Za-z0-9_-]{16,64}$", options: .regularExpression) != nil else { return false }
  return !(key.hasPrefix("__") && key.hasSuffix("__") && key.count >= 4)
}

/// Change for cash handed over, never negative (`posOfflineChangeCents`).
public func posOfflineChangeCents(total: Double, tendered: Double) -> Int {
  Int(max(0, wholeCents(tendered) - wholeCents(total)))
}

/// Tax on `taxable` cents at `pct` percent (`computeTaxCents` for a price that does not include tax).
private func taxCents(_ taxable: Double, pct: Double) -> Double {
  guard pct > 0, taxable > 0 else { return 0 }
  return jsRounded(taxable * pct / 100)
}

/// One basket line as the offline totals read it.
public struct PosOfflineTotalsLine: Sendable {
  public let unitAmountCents: Double
  public let quantity: Double
  public init(unitAmountCents: Double, quantity: Double) {
    self.unitAmountCents = unitAmountCents
    self.quantity = quantity
  }
}

/// The totals of an offline sale: the cashier's discount on the goods, then the
/// store's in-person tax on what is left. `pricesIncludeTax` adds nothing, as at
/// the online till (`posOfflineSaleTotals`).
public func posOfflineSaleTotals(
  lines: [PosOfflineTotalsLine], discountPct: Double, taxPct: Double?, pricesIncludeTax: Bool
) -> OrderTotals {
  let whole = lines.map { line -> (unit: Double, quantity: Double) in
    let rounded = jsRounded(line.quantity.isFinite ? line.quantity : 0)
    return (wholeCents(line.unitAmountCents), max(1, rounded == 0 ? 1 : rounded))
  }
  let items = whole.reduce(0.0) { $0 + wholeCents($1.unit * $1.quantity) }
  let pct = discountPct.isFinite ? min(100, max(0, discountPct)) : 0
  let discount = min(items, jsRounded(items * pct / 100))
  let tax = (taxPct ?? 0) > 0 && !pricesIncludeTax ? taxCents(items - discount, pct: taxPct ?? 0) : 0
  let appliedDiscount = min(wholeCents(discount), items)
  return OrderTotals(
    discountCents: appliedDiscount, feeCents: 0, itemsCents: items, shippingCents: 0, taxCents: wholeCents(tax),
    totalCents: items + wholeCents(tax) - appliedDiscount)
}

/*
 * A CARD TAKEN OFFLINE ON THE APP'S OWN READER (AGL-4039): the console's
 * `posOfflineCardRefusal` and `posOfflineCardIntentMetadata`, replayed in
 * function-cases.generated.json.
 */

/// `$1,234.56` for whole cents, as the console's rule words an amount.
private func offlineDollars(_ cents: Double) -> String {
  let value = Int(cents)
  let whole = value / 100
  let rest = value % 100
  var digits = String(whole)
  var grouped = ""
  while digits.count > 3 {
    grouped = "," + digits.suffix(3) + grouped
    digits = String(digits.dropLast(3))
  }
  return "$" + digits + grouped + "." + (rest < 10 ? "0" : "") + String(rest)
}

/// Why a card cannot be taken offline for `totalCents`, in the cashier's words; nil when it can.
public func posOfflineCardRefusal(card: PosOfflineKitCard?, totalCents: Double, takenTodayCents: Double) -> String? {
  guard let card else { return "Card sales offline need the register to connect once first." }
  guard card.available else {
    let reason = card.unavailableReason ?? ""
    return reason.isEmpty ? "Card sales offline are not turned on for this store." : reason
  }
  let total: Double = wholeCents(totalCents)
  guard total > 0 else { return "There is nothing to charge." }
  let storeCeiling: Double = wholeCents(card.maxSaleCents)
  let perSale = min(storeCeiling, Double(ContractValues.shared.posOfflineCardMaxSaleCentsLimit))
  if total > perSale {
    return "Offline, a card sale can be up to \(offlineDollars(perSale)). Take cash, or charge it when you are back online."
  }
  let today: Double = wholeCents(takenTodayCents)
  let daily: Double = wholeCents(card.maxDeviceDailyCents)
  if daily > 0, today + total > daily {
    return
      "This device has taken \(offlineDollars(today)) in cards offline today, and its daily limit is \(offlineDollars(daily)). Take cash, or wait for the connection."
  }
  return nil
}

/// What the app writes on the PaymentIntent it creates for a card rung offline.
public func posOfflineCardIntentMetadata(saleKey: String, hostID: String, orgID: String, registerID: String) -> [String: String] {
  [
    "kind": ContractValues.shared.posOfflineCardIntentKind, "saleKey": saleKey, "hostId": hostID, "orgId": orgID,
    "registerId": registerID,
  ]
}
