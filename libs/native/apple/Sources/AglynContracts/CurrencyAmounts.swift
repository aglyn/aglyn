// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * A CRM CURRENCY FIELD'S AMOUNTS (AGL-3971), the console's `contact-custom-fields.ts` (AGL-3756).
 *
 * A currency field stores a whole number of its currency's minor unit, and the currency is the field's, never the
 * value's. The minor unit is the currency's own: two decimals for USD, none for JPY, KRW or VND, three for BHD, KWD or
 * OMR, as the console's `Intl` reads them (`NATIVE_CURRENCY_FRACTION_DIGITS` carries every code that is not two). The
 * replayed cases in function-cases.generated.json hold each function to the console's answers.
 */

/// How many decimals a currency's minor unit has: 2 for USD, 0 for JPY, 3 for BHD (`currencyFractionDigits`).
public func currencyFractionDigits(_ code: String) -> Int {
  ContractValues.shared.nativeCurrencyFractionDigits[code.lowercased()].map { Int($0) } ?? 2
}

/// A stored amount as the major-unit number a person reads: `1250.5` for 125050 cents, `1500` for ¥1,500
/// (`currencyMinorToMajor`).
public func currencyMinorToMajor(_ minor: Double, _ code: String) -> Double {
  minor / pow(10, Double(currencyFractionDigits(code)))
}

/// A typed amount ("$1,250.50", "1250.5", "-40") as the minor units it stores, rounded to the currency's unit, or nil
/// when it is not one number; symbols, codes, spaces and thousands separators are dropped (`parseCurrencyInput`).
public func parseCurrencyInput(_ input: String?, _ code: String) -> Int64? {
  let cleaned = String((input ?? "").filter { "0123456789.-".contains($0) })
  guard !cleaned.isEmpty, cleaned != "-", cleaned != ".",
    cleaned.range(of: #"^-?[0-9]*\.?[0-9]*$"#, options: .regularExpression) != nil,
    let value = Double(cleaned), value.isFinite
  else { return nil }
  // JavaScript's Math.round: halves round up, toward positive infinity.
  return Int64((value * pow(10, Double(currencyFractionDigits(code))) + 0.5).rounded(.down))
}

/// A currency field's code, lowercase, or the default when it names none (`customFieldCurrency`).
public func customFieldCurrency(_ code: String?) -> String {
  let trimmed = (code ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  return trimmed.range(of: "^[a-z]{3}$", options: .regularExpression) != nil
    ? trimmed : ContractValues.shared.nativeCrmFieldDefaultCurrency
}

/// A stored amount as the text its box shows: major units with the currency's decimals, "1250.50", "1500", "1.250"
/// (the console's `currencyInputText`).
public func currencyInputText(_ minor: Double, _ code: String) -> String {
  String(format: "%.\(currencyFractionDigits(code))f", locale: Locale(identifier: "en_US_POSIX"), currencyMinorToMajor(minor, code))
}

/// A stored amount as money in the reader's locale, "$1,250.50", "¥1,500", "BHD 1.250" (`formatCurrencyFieldValue`).
public func formatCurrencyFieldValue(_ minor: Double, _ code: String, locale: Locale = .current) -> String {
  let digits = currencyFractionDigits(code)
  return currencyMinorToMajor(minor, code).formatted(
    .currency(code: code.uppercased()).precision(.fractionLength(digits)).locale(locale))
}
