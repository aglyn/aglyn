package com.aglyn.contracts

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/*
 * The console's order and receipt formatters, ported once from
 * libs/plugins/commerce/src/lib/model/{commerce-orders,order-figures,
 * buyer-notifications,commerce-receipt}.ts. function-cases.generated.json
 * holds the answers the TypeScript gives, and the tests replay every one.
 */

/** `#1042`, else the last six of the document id, else `#—`. */
fun formatOrderNumber(order: HostOrder?, docId: String? = null): String {
  val number = order?.number
  if (number != null) return "#${number.toLong()}"
  return if (!docId.isNullOrEmpty()) "#${docId.takeLast(6).uppercase()}" else "#—"
}

/** The channel's label (`Online`, `POS`…), else the raw channel, else `Online`. */
fun orderChannelLabel(channel: String?): String =
  Contracts.orderChannelLabels[channel ?: "online"] ?: channel ?: "Online"

private val ORDER_TRANSITIONS: Map<OrderStatus, Set<OrderStatus>> = mapOf(
  OrderStatus.PENDING to setOf(OrderStatus.PAID, OrderStatus.CANCELLED),
  OrderStatus.PAID to setOf(OrderStatus.PARTIALLY_FULFILLED, OrderStatus.FULFILLED, OrderStatus.CANCELLED, OrderStatus.REFUNDED),
  OrderStatus.PARTIALLY_FULFILLED to setOf(OrderStatus.FULFILLED, OrderStatus.REFUNDED),
  OrderStatus.FULFILLED to setOf(OrderStatus.DELIVERED, OrderStatus.REFUNDED),
  OrderStatus.DELIVERED to setOf(OrderStatus.REFUNDED),
  OrderStatus.CANCELLED to setOf(OrderStatus.REFUNDED),
  OrderStatus.REFUNDED to emptySet(),
)

fun canTransitionOrder(from: OrderStatus, to: OrderStatus): Boolean = to in (ORDER_TRANSITIONS[from] ?: emptySet())

enum class OrderRefundState(val raw: String) { NONE("none"), PARTIAL("partial"), FULL("full") }

private fun HostOrder.grossCents(): Double = totals?.totalCents ?: amountCents ?: 0.0

fun orderRefundState(order: HostOrder): OrderRefundState {
  val refunded = max(0.0, order.refundedCents ?: 0.0)
  val total = order.grossCents()
  if (order.status == OrderStatus.REFUNDED) return OrderRefundState.FULL
  if (refunded <= 0) return OrderRefundState.NONE
  return if (total > 0 && refunded >= total) OrderRefundState.FULL else OrderRefundState.PARTIAL
}

private fun usd(cents: Double): String {
  val whole = (abs(cents)).roundToLong()
  val text = "${whole / 100}.${(whole % 100).toString().padStart(2, '0')}"
  return if (cents < 0) "-$text" else text
}

/**
 * What the order screen's restock card says about the open question: how many
 * units may need restocking after which door, and how far to trust the
 * number. The console's own sentence (`describeRestockCheck`).
 */
fun describeRestockCheck(restock: OrderRestockCheck, order: HostOrder): String {
  val named = restock.lines.isNotEmpty() && restock.lines.all { line ->
    line.lineIndex != null && order.refundedLineItemIds.orEmpty().contains(line.lineIndex)
  }
  val units = restock.units
  val count = if (units == units.toLong().toDouble()) units.toLong().toString() else units.toString()
  val door = if (restock.kind == OrderRestockCheckKind.CHARGEBACK) "chargeback" else "refund"
  return "$count ${if (units == 1.0) "unit" else "units"} may need restocking after this $door." +
    (if (restock.kind == OrderRestockCheckKind.CHARGEBACK) " The shopper kept the goods unless they actually came back." else "") +
    when {
      restock.fullyReversed -> ""
      named -> " Only part of the money came back: these are the lines withdrawn by this refund, so the units are theirs — only you know whether the goods came back."
      else -> " Only part of the money came back, so these units are an upper bound — only you know which goods returned."
    }
}

fun orderRefundSummary(order: HostOrder): String {
  val state = orderRefundState(order)
  if (state == OrderRefundState.NONE) return ""
  val refunded = max(0.0, order.refundedCents ?: 0.0)
  if (state == OrderRefundState.FULL) return "Refunded in full ($${usd(refunded)})"
  val revoked = order.refundedLineItemIds?.size ?: 0
  val lines = order.lineItems?.size ?: 0
  val scope = if (revoked > 0) {
    "$revoked of $lines line${if (lines == 1) "" else "s"} withdrawn"
  } else {
    "no lines withdrawn — refunded by amount"
  }
  return "Partially refunded ($${usd(refunded)} of $${usd(order.grossCents())}) — $scope"
}

/** The sale's revenue after refunds; a refunded register tip comes off at most once. */
fun orderNetCents(order: HostOrder): Double {
  val gross = order.grossCents()
  val refunded = order.refundedCents ?: 0.0
  val tip = order.totals?.tipCents ?: 0.0
  return gross - if (tip > 0) min(refunded, gross) else refunded
}

/** What the order took, less refunds. */
fun orderPaidCents(order: HostOrder): Double = order.grossCents() - (order.refundedCents ?: 0.0)

/**
 * Splits [totalCents] across [weights] in whole cents by largest remainder,
 * never handing out more than the weights add up to.
 */
fun apportionCents(weights: List<Double>, totalCents: Double): List<Long> {
  val safe = weights.map { max(0L, jsRound(it)) }
  val basis = safe.sum()
  val total = max(0L, jsRound(totalCents))
  if (safe.isEmpty() || basis <= 0 || total <= 0) return safe.map { 0L }
  val pot = min(total, basis)
  val exact = safe.map { it.toDouble() * pot / basis }
  val shares = exact.map { floor(it).toLong() }.toMutableList()
  var remainder = pot - shares.sum()
  val order = exact.mapIndexed { index, value -> index to value - floor(value) }
    .sortedWith(compareByDescending<Pair<Int, Double>> { it.second }.thenBy { it.first })
  for ((index, _) in order) {
    if (remainder <= 0) break
    shares[index] += 1
    remainder -= 1
  }
  return shares
}

/** JavaScript's Math.round: halves round up, toward positive infinity. */
private fun jsRound(value: Double): Long = if (value.isNaN()) 0L else floor(value + 0.5).toLong()

/** A currency's symbol and minor-unit digits, as en-US ICU prints them. */
private class CurrencyStyle(val symbol: String?, val digits: Int)

private val CURRENCY_SYMBOLS = mapOf(
  "USD" to "$", "EUR" to "€", "GBP" to "£", "JPY" to "¥", "CAD" to "CA$", "AUD" to "A$", "NZD" to "NZ$",
  "MXN" to "MX$", "BRL" to "R$", "INR" to "₹", "CNY" to "CN¥", "KRW" to "₩", "HKD" to "HK$", "ILS" to "₪",
  "TWD" to "NT$", "VND" to "₫", "PHP" to "₱", "XAF" to "FCFA", "XOF" to "F CFA", "XPF" to "CFPF",
)
private val ZERO_DIGIT = setOf(
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
)
private val THREE_DIGIT = setOf("BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND")
private val CODE = Regex("^[A-Z]{3}$")

private fun styleOf(code: String): CurrencyStyle? {
  if (!CODE.matches(code)) return null
  val digits = when (code) {
    in ZERO_DIGIT -> 0
    in THREE_DIGIT -> 3
    else -> 2
  }
  return CurrencyStyle(CURRENCY_SYMBOLS[code], digits)
}

/** `1,234,567.89`: grouped thousands and exactly [digits] decimals. */
private fun grouped(minorUnits: Long, digits: Int): String {
  val absolute = abs(minorUnits)
  var scale = 1L
  repeat(digits) { scale *= 10 }
  val whole = (absolute / scale).toString().reversed().chunked(3).joinToString(",").reversed()
  return if (digits == 0) whole else "$whole.${(absolute % scale).toString().padStart(digits, '0')}"
}

/** `$12.50`, `-€3.00`, `KWD 12.345` (a code with no symbol is followed by a no-break space). */
private fun currency(minorUnits: Long, code: String, digits: Int, symbol: String?): String {
  val prefix = symbol ?: "$code "
  return (if (minorUnits < 0) "-" else "") + prefix + grouped(minorUnits, digits)
}

/** An order amount in cents, as the buyer emails print it (en-US). */
fun formatOrderMoney(cents: Double, currency: String = "USD"): String {
  val code = currency.ifEmpty { "USD" }.uppercase()
  val style = styleOf(code) ?: return "$" + usd(if (cents.isNaN()) 0.0 else cents)
  val amount = if (cents.isNaN()) 0.0 else cents / 100
  // The amount is in hundredths whatever the currency, and prints at the currency's own digits.
  var scale = 1.0
  repeat(style.digits) { scale *= 10 }
  return currency(jsRound(amount * scale), code, style.digits, style.symbol)
}

/** A receipt amount: [cents] is in the currency's minor units, printed at its own digits. */
fun formatReceiptMoney(cents: Double, currency: String): String {
  val code = currency.ifEmpty { "usd" }.uppercase()
  val safe = if (cents.isFinite()) jsRound(cents) else 0L
  val style = styleOf(code) ?: return "${usd(safe.toDouble())} $code"
  return currency(safe, code, style.digits, style.symbol)
}

/** The receipt timestamp, e.g. `Oct 6, 2026, 3:04 PM`, in [timeZone] (UTC when absent or unknown). */
expect fun formatReceiptTime(atMs: Long, timeZone: String? = null): String
