// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

/*
 * The register's own arithmetic (commerce-pos.ts). Money is printed by the
 * shared formatters in AglynContracts, which replay the console's answers,
 * so the till prints a figure exactly as the console does.
 */

/// JavaScript's `Math.round`: halves round up, toward positive infinity.
func jsRound(_ value: Double) -> Int {
  value.isFinite ? Int((value + 0.5).rounded(.down)) : 0
}

/// Whole cents in the store's currency, as the receipt prints them.
public func posMoney(_ cents: Int, currency: String?) -> String {
  formatReceiptMoney(cents, currency: currency ?? "usd")
}

/// A tip of `percent` on `baseCents`, to the cent (`posTipFromPercent`).
func posTipFromPercent(_ baseCents: Int, _ percent: Double) -> Int {
  guard baseCents > 0, percent.isFinite, percent > 0 else { return 0 }
  return jsRound(Double(baseCents) * percent / 100)
}

/// "$12.50" or "12.5" as whole cents; nil when it is not an amount.
func centsFromText(_ text: String?) -> Int? {
  let cleaned = (text ?? "").replacingOccurrences(of: "[$,\\s]", with: "", options: .regularExpression)
  guard cleaned.range(of: "^\\d+(\\.\\d{0,2})?$", options: .regularExpression) != nil else { return nil }
  let parts = cleaned.split(separator: ".", omittingEmptySubsequences: false)
  guard let whole = Int(parts[0]) else { return nil }
  let fraction = parts.count > 1 ? Int(String(parts[1]).padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0 : 0
  return whole * 100 + fraction
}

/// Cents as an amount field shows them: 1250 → "12.50".
func amountText(_ cents: Int) -> String {
  let magnitude = abs(cents)
  return (cents < 0 ? "-" : "") + "\(magnitude / 100)." + String(format: "%02d", magnitude % 100)
}
