package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.formatReceiptMoney
import kotlin.math.abs
import kotlin.math.floor

/*
 * The register's own arithmetic (commerce-pos.ts). Money is printed by the
 * shared formatters in the contracts module, which replay the console's
 * answers, so the till prints a figure exactly as the console does.
 */

/** JavaScript's `Math.round`: halves round up, toward positive infinity. */
fun jsRound(value: Double): Long = if (value.isNaN()) 0L else floor(value + 0.5).toLong()

/** Whole cents in the store's currency, as the receipt prints them. */
fun money(cents: Long, currency: String?): String = formatReceiptMoney(cents.toDouble(), currency ?: "usd")

/** A tip of [percent] on [baseCents], to the cent (`posTipFromPercent`). */
fun posTipFromPercent(baseCents: Long, percent: Double): Long {
  if (baseCents <= 0 || !percent.isFinite() || percent <= 0) return 0
  return jsRound(baseCents * percent / 100)
}

/** "$12.50" or "12.5" as whole cents; null when it is not an amount. */
fun centsFromText(text: String?): Long? {
  val cleaned = (text ?: "").replace(Regex("[$,\\s]"), "")
  if (!Regex("^\\d+(\\.\\d{0,2})?$").matches(cleaned)) return null
  val parts = cleaned.split('.')
  val whole = parts[0].toLongOrNull() ?: return null
  val fraction = parts.getOrNull(1)?.padEnd(2, '0')?.toLongOrNull() ?: 0
  return whole * 100 + fraction
}

/** Cents as an amount field shows them: 1250 → "12.50". */
fun amountText(cents: Long): String =
  (if (cents < 0) "-" else "") + "${abs(cents) / 100}.${(abs(cents) % 100).toString().padStart(2, '0')}"
