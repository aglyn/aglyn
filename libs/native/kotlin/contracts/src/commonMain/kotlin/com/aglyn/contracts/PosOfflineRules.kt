package com.aglyn.contracts

import kotlin.math.floor

/*
 * The offline register's own arithmetic (commerce-pos-offline.ts), ported once
 * and replayed against the console's answers in function-cases.generated.json.
 * The Apple kit's `PosOfflineRules.swift`.
 *
 * WHAT SELLS OFFLINE IS CASH, AND ONLY CASH (the console's rule, unchanged): a
 * card, a gift card, a room charge, store credit and a promotion code each need
 * the server. The register prices the basket from its cached catalog and the
 * store's own tax rate, exactly as the online till does for the same basket
 * with no promotion.
 */

private fun jsRound(value: Double): Double = floor(value + 0.5)

/** `wholeCents`: a positive whole number of cents, else 0. */
private fun wholeCents(value: Double): Double {
  if (!value.isFinite()) return 0.0
  val rounded = jsRound(value)
  return if (rounded > 0) rounded else 0.0
}

private val OFFLINE_SALE_KEY = Regex("^[A-Za-z0-9_-]{16,64}$")

/** A key the register minted: an id the order can take, and nothing else (`posOfflineSaleKeyIsValid`). */
fun posOfflineSaleKeyIsValid(key: String?): Boolean =
  key != null && OFFLINE_SALE_KEY.matches(key) && !(key.startsWith("__") && key.endsWith("__") && key.length >= 4)

/** Change for cash handed over, never negative (`posOfflineChangeCents`). */
fun posOfflineChangeCents(totalCents: Double, tenderedCents: Double): Long =
  maxOf(0.0, wholeCents(tenderedCents) - wholeCents(totalCents)).toLong()

/** Tax on [taxable] cents at [pct] percent (`computeTaxCents` for a price that does not include tax). */
private fun taxCents(taxable: Double, pct: Double): Double = if (!(pct > 0) || !(taxable > 0)) 0.0 else jsRound(taxable * pct / 100)

/** One basket line as the offline totals read it. */
data class PosOfflineTotalsLine(val unitAmountCents: Double, val quantity: Double)

/**
 * The totals of an offline sale: the cashier's discount on the goods, then the
 * store's in-person tax on what is left. `pricesIncludeTax` adds nothing, as at
 * the online till (`posOfflineSaleTotals`).
 */
fun posOfflineSaleTotals(lines: List<PosOfflineTotalsLine>, discountPct: Double, taxPct: Double?, pricesIncludeTax: Boolean): OrderTotals {
  val whole = lines.map { line ->
    val rounded = jsRound(if (line.quantity.isFinite()) line.quantity else 0.0)
    wholeCents(line.unitAmountCents) to maxOf(1.0, if (rounded == 0.0) 1.0 else rounded)
  }
  val items = whole.sumOf { (unit, quantity) -> wholeCents(unit * quantity) }
  val pct = if (discountPct.isFinite()) discountPct.coerceIn(0.0, 100.0) else 0.0
  val discount = minOf(items, jsRound(items * pct / 100))
  val tax = if ((taxPct ?: 0.0) > 0 && !pricesIncludeTax) taxCents(items - discount, taxPct ?: 0.0) else 0.0
  val appliedDiscount = minOf(wholeCents(discount), items)
  return OrderTotals(
    discountCents = appliedDiscount,
    feeCents = 0.0,
    itemsCents = items,
    shippingCents = 0.0,
    taxCents = wholeCents(tax),
    totalCents = items + wholeCents(tax) - appliedDiscount,
  )
}

/*
 * A CARD TAKEN OFFLINE ON THE APP'S OWN READER (AGL-4039): the console's
 * `posOfflineCardRefusal` and `posOfflineCardIntentMetadata`, replayed in
 * function-cases.generated.json. The Apple kit's `PosOfflineRules.swift`.
 */

/** `$1,234.56` for whole cents, as the console's rule words an amount. */
private fun offlineDollars(cents: Double): String {
  val value = cents.toLong()
  val whole = (value / 100).toString()
  val rest = value % 100
  val grouped = whole.reversed().chunked(3).joinToString(",").reversed()
  return "$" + grouped + "." + rest.toString().padStart(2, '0')
}

/** Why a card cannot be taken offline for [totalCents], in the cashier's words; null when it can. */
fun posOfflineCardRefusal(card: PosOfflineKitCard?, totalCents: Double, takenTodayCents: Double): String? {
  if (card == null) return "Card sales offline need the register to connect once first."
  if (!card.available) return card.unavailableReason?.takeIf { it.isNotEmpty() } ?: "Card sales offline are not turned on for this store."
  val total = wholeCents(totalCents)
  if (!(total > 0)) return "There is nothing to charge."
  val perSale = minOf(wholeCents(card.maxSaleCents), Contracts.posOfflineCardMaxSaleCentsLimit.toDouble())
  if (total > perSale) return "Offline, a card sale can be up to ${offlineDollars(perSale)}. Take cash, or charge it when you are back online."
  val today = wholeCents(takenTodayCents)
  val daily = wholeCents(card.maxDeviceDailyCents)
  if (daily > 0 && today + total > daily) {
    return "This device has taken ${offlineDollars(today)} in cards offline today, and its daily limit is ${offlineDollars(daily)}. Take cash, or wait for the connection."
  }
  return null
}

/** What the app writes on the PaymentIntent it creates for a card rung offline. */
fun posOfflineCardIntentMetadata(saleKey: String, hostId: String, orgId: String, registerId: String): Map<String, String> = mapOf(
  "kind" to Contracts.posOfflineCardIntentKind,
  "saleKey" to saleKey,
  "hostId" to hostId,
  "orgId" to orgId,
  "registerId" to registerId,
)
