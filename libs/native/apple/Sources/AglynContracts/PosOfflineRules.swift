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
