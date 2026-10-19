package com.aglyn.contracts

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.pow

/*
 * A CRM CURRENCY FIELD'S AMOUNTS (AGL-3971), the console's `contact-custom-fields.ts` (AGL-3756); the Apple apps'
 * CurrencyAmounts.swift.
 *
 * A currency field stores a whole number of its currency's minor unit, and the currency is the field's, never the
 * value's. The minor unit is the currency's own: two decimals for USD, none for JPY, KRW or VND, three for BHD, KWD or
 * OMR, as the console's `Intl` reads them (NATIVE_CURRENCY_FRACTION_DIGITS carries every code that is not two). The
 * replayed cases in function-cases.generated.json hold each function to the console's answers.
 */

/** How many decimals a currency's minor unit has: 2 for USD, 0 for JPY, 3 for BHD (`currencyFractionDigits`). */
fun currencyFractionDigits(code: String): Int = Contracts.nativeCurrencyFractionDigits[code.lowercase()]?.toInt() ?: 2

/** A stored amount as the major-unit number a person reads: 1250.5 for 125050 cents, 1500 for ¥1,500. */
fun currencyMinorToMajor(minor: Double, code: String): Double = minor / 10.0.pow(currencyFractionDigits(code))

/**
 * A typed amount ("$1,250.50", "1250.5", "-40") as the minor units it stores, rounded to the currency's unit, or null
 * when it is not one number; symbols, codes, spaces and thousands separators are dropped (`parseCurrencyInput`).
 */
fun parseCurrencyInput(input: String?, code: String): Long? {
  val cleaned = input.orEmpty().filter { it in "0123456789.-" }
  if (cleaned.isEmpty() || cleaned == "-" || cleaned == "." || !Regex("""^-?[0-9]*\.?[0-9]*$""").matches(cleaned)) return null
  val value = cleaned.toDoubleOrNull()?.takeIf { it.isFinite() } ?: return null
  // JavaScript's Math.round: halves round up, toward positive infinity.
  return floor(value * 10.0.pow(currencyFractionDigits(code)) + 0.5).toLong()
}

/** A currency field's code, lowercase, or the default when it names none (`customFieldCurrency`). */
fun customFieldCurrency(code: String?): String {
  val trimmed = code.orEmpty().trim().lowercase()
  return if (Regex("^[a-z]{3}$").matches(trimmed)) trimmed else Contracts.nativeCrmFieldDefaultCurrency
}

/** A stored amount as the text its box shows: major units with the currency's decimals, "1250.50", "1500", "1.250". */
fun currencyInputText(minor: Double, code: String): String {
  val digits = currencyFractionDigits(code)
  val units = floor(abs(minor) + 0.5).toLong()
  val scale = 10.0.pow(digits).toLong()
  val sign = if (minor < 0 && units != 0L) "-" else ""
  val whole = units / scale
  return if (digits == 0) "$sign$whole" else "$sign$whole.${(units % scale).toString().padStart(digits, '0')}"
}

/** A stored amount as money in the reader's locale, "$1,250.50", "¥1,500", "BHD 1.250" (`formatCurrencyFieldValue`). */
expect fun formatCurrencyFieldValue(minor: Double, code: String): String
