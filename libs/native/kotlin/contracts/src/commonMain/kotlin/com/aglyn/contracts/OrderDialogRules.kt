package com.aglyn.contracts

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.pow

/*
 * THE ORDER DIALOG'S RULES AND WORDS (AGL-3841): tracking links, the Fulfill
 * items panel, the shipments list, disputes, payment risk, the refund question
 * and the tax line, from the console's pure modules (`tracking-url.ts`,
 * `order-fulfillment.ts`, `commerce-dispute.ts`, `commerce-orders.ts`,
 * `commerce-tax-decision.ts`, `payment-risk.ts`). Ported once; the Apple kit's
 * OrderDialogRules.swift is the same port, and both replay the console's answers
 * from function-cases.generated.json.
 */

private class TrackingCarrier(val id: String, val label: String, val aliases: List<String>, val url: (String) -> String)

/** `TRACKING_CARRIERS`: the carriers with a public tracker, in the console's order. */
private val TRACKING_CARRIERS = listOf(
  TrackingCarrier("usps", "USPS", listOf("usps", "unitedstatespostalservice", "uspostalservice", "postalservice")) {
    "https://tools.usps.com/go/TrackConfirmAction?tLabels=$it"
  },
  TrackingCarrier("ups", "UPS", listOf("ups", "unitedparcelservice")) { "https://www.ups.com/track?tracknum=$it" },
  TrackingCarrier("fedex", "FedEx", listOf("fedex", "federalexpress")) { "https://www.fedex.com/fedextrack/?trknbr=$it" },
  TrackingCarrier("dhl", "DHL", listOf("dhl", "dhlexpress", "dhlecommerce")) { "https://www.dhl.com/global-en/home/tracking.html?tracking-id=$it" },
  TrackingCarrier("canada-post", "Canada Post", listOf("canadapost", "postescanada", "canpost")) {
    "https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=$it"
  },
  TrackingCarrier("royal-mail", "Royal Mail", listOf("royalmail", "parcelforce")) { "https://www.royalmail.com/track-your-item#/tracking-results/$it" },
  TrackingCarrier("australia-post", "Australia Post", listOf("australiapost", "auspost", "startrack")) { "https://auspost.com.au/mypost/track/details/$it" },
)

/** Longest alias first, so "uspostalservice" is tried before "ups"; ties keep the table's order (a stable sort). */
private val ALIASES_BY_LENGTH = TRACKING_CARRIERS.flatMap { entry -> entry.aliases.map { it to entry.id } }.sortedByDescending { it.first.length }

private fun squash(value: String) = value.lowercase().filter { it in 'a'..'z' || it in '0'..'9' }

/** The carrier a typed name means (`carrierIdFor`): an alias, else the longest alias the name starts with. */
fun carrierIdFor(carrier: String?): String? {
  val squashed = squash(carrier.orEmpty())
  if (squashed.isEmpty()) return null
  TRACKING_CARRIERS.firstOrNull { squashed in it.aliases }?.let { return it.id }
  return ALIASES_BY_LENGTH.firstOrNull { squashed.startsWith(it.first) }?.second
}

/** How a carrier names itself, or what was typed (`carrierLabelFor`). */
fun carrierLabelFor(carrier: String?): String {
  val id = carrierIdFor(carrier)
  return TRACKING_CARRIERS.firstOrNull { it.id == id }?.label ?: carrier.orEmpty().trim()
}

/** JavaScript's `encodeURIComponent`: UTF-8, every byte but `A–Z a–z 0–9 - _ . ! ~ * ' ( )` as `%XX`. */
fun encodeURIComponent(value: String): String {
  val out = StringBuilder()
  for (byte in value.encodeToByteArray()) {
    val char = (byte.toInt() and 0xff).toChar()
    if (char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || char in "-_.!~*'()") out.append(char)
    else out.append('%').append((byte.toInt() and 0xff).toString(16).uppercase().padStart(2, '0'))
  }
  return out.toString()
}

/** The carrier's public tracking link for a number (`trackingUrlFor`), whitespace taken out, or null. */
fun trackingUrlFor(carrier: String?, trackingNumber: String?): String? {
  val number = trackingNumber.orEmpty().filterNot { it.isWhitespace() }
  if (number.isEmpty()) return null
  val id = carrierIdFor(carrier)
  return TRACKING_CARRIERS.firstOrNull { it.id == id }?.url?.invoke(encodeURIComponent(number))
}

private val HTTPS_LINK = Regex("^https://\\S+$", RegexOption.IGNORE_CASE)

/** A shipment's tracking link (`fulfillmentTrackingUrl`): the stored https link, else the carrier's. */
fun fulfillmentTrackingUrl(carrier: String?, trackingNumber: String?, trackingUrl: String?): String? {
  val stored = trackingUrl.orEmpty().trim()
  if (HTTPS_LINK.matches(stored)) return stored
  return trackingUrlFor(carrier, trackingNumber)
}

/** The carrier select's value for a typed carrier (`fulfillmentCarrierChoice`): empty, a named carrier, or Other. */
fun fulfillmentCarrierChoice(carrier: String?): String {
  if (carrier.isNullOrEmpty()) return ""
  val label = carrierLabelFor(carrier)
  val values = Contracts
  return if (label in values.fulfillmentCarrierChoices) label else values.fulfillmentOtherCarrier
}

/** Whether the order's shipments may still be edited or cancelled (`orderFulfillmentsEditable`). */
fun orderFulfillmentsEditable(status: OrderStatus?): Boolean =
  status == OrderStatus.PAID || status == OrderStatus.PARTIALLY_FULFILLED || status == OrderStatus.FULFILLED

/** One line of a shipment: which order line, and how many of its units. */
data class FulfillmentLine(val lineItemId: Int, val quantity: Long)

/** "2× Mug, 1× Shirt" (`describeFulfillmentLines`). */
fun describeFulfillmentLines(order: HostOrder, lines: List<FulfillmentLine>): String =
  lines.joinToString(", ") { "${it.quantity}× ${order.lineItems?.getOrNull(it.lineItemId)?.name ?: "line ${it.lineItemId}"}" }

/** The lines one shipment covers, for the shipments list. */
fun fulfillmentLines(order: HostOrder, fulfillment: OrderFulfillment): List<FulfillmentLine> =
  fulfillmentLineQuantities(order, fulfillment).map { FulfillmentLine(it.first, it.second) }

private val TRACKING_STATUS_LABELS = mapOf(
  "pre_transit" to "Label created",
  "in_transit" to "In transit",
  "out_for_delivery" to "Out for delivery",
  "delivered" to "Delivered",
  "exception" to "Delivery problem",
  "returned" to "Returned to sender",
)

/** The words for a shipment's tracking status (`trackingStatusLabel`). */
fun trackingStatusLabel(status: String?): String = if (status.isNullOrEmpty()) "" else TRACKING_STATUS_LABELS[status] ?: status

/** Fulfill items' starting count for each line (`fulfillItemsStartQuantities`). */
fun fulfillItemsStartQuantities(order: HostOrder): List<Long> {
  val states = orderLineFulfillmentStates(order)
  val physicalLeft = states.any { it.requiresShipping && it.remainingQuantity > 0 }
  return states.map { if (physicalLeft) (if (it.requiresShipping) it.remainingQuantity else 0L) else it.remainingQuantity }
}

/** The units picked, by line index (`fulfillItemsSelection`). */
fun fulfillItemsSelection(quantities: List<Double>): List<FulfillmentLine> =
  quantities.mapIndexedNotNull { index, quantity ->
    val whole = if (quantity.isFinite()) maxOf(0L, floor(quantity).toLong()) else 0L
    if (whole > 0) FulfillmentLine(index, whole) else null
  }

/** Whether the picked units are everything still to ship (`fulfillItemsIsEverything`). */
fun fulfillItemsIsEverything(order: HostOrder, selection: List<FulfillmentLine>): Boolean {
  val remaining = remainingFulfillmentLines(order)
  return remaining.isNotEmpty() && remaining.size == selection.size &&
    remaining.zip(selection).all { (left, picked) -> left.lineItemId == picked.lineItemId && left.remainingQuantity == picked.quantity }
}

/** How many minor units a currency has (`currencyMinorDigits`): 2 for USD, 0 for JPY, 2 for a code it does not know. */
fun currencyMinorDigits(currency: String?): Int = currencyDigits(currency.orEmpty().ifEmpty { "USD" }.uppercase()) ?: 2

/** What was typed in Shipping cost, read in the store's currency (`parseShippingCostInput`). */
sealed interface ShippingCostInput {
  /** Whole minor units; null when the field was left empty (not known, which is not 0). */
  data class Cents(val cents: Long?) : ShippingCostInput

  data class Error(val message: String) : ShippingCostInput
}

fun parseShippingCostInput(input: String, currency: String?): ShippingCostInput {
  val digits = currencyMinorDigits(currency)
  val trimmed = input.trim()
  if (trimmed.isEmpty()) return ShippingCostInput.Cents(null)
  val cleaned = trimmed.dropWhile { it !in '0'..'9' && it != '.' && it != '-' }.replace(",", "")
  if (cleaned.startsWith("-")) return ShippingCostInput.Error("Shipping cost cannot be negative")
  val pattern = if (digits > 0) Regex("^[0-9]*(\\.[0-9]{0,$digits})?$") else Regex("^[0-9]+$")
  if (cleaned.isEmpty() || cleaned == "." || !pattern.matches(cleaned)) {
    return ShippingCostInput.Error(if (digits > 0) "Enter an amount like 8.45" else "Enter a whole amount, like 850")
  }
  val parts = cleaned.split(".")
  val whole = parts[0].ifEmpty { "0" }.toDouble()
  val fraction = parts.getOrElse(1) { "" }.padEnd(digits, '0').ifEmpty { "0" }.toDouble()
  val cents = whole * 10.0.pow(digits) + fraction
  if (cents > Contracts.shippingCostMaxCents.toDouble()) return ShippingCostInput.Error("Shipping cost is too large")
  return ShippingCostInput.Cents(cents.toLong())
}

/** Whether the order has a dispute still running (`orderHasOpenDispute`). */
fun orderHasOpenDispute(order: HostOrder): Boolean = isOrderDisputeOpen(order.dispute)

/** The dispute chip (`describeOrderDispute`): its tone, label and sentence, and while open the evidence deadline. */
data class OrderDisputeBadge(
  /** `open`, `lost`, `won` or `settled`. */
  val tone: String,
  val label: String,
  val detail: String,
  val evidenceDueByMs: Long? = null,
  val evidenceDaysLeft: Long? = null,
)

private fun isoDay(ms: Double): String {
  val days = floor(ms / 86_400_000).toLong()
  // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm), in UTC as `toISOString` is.
  val z = days + 719_468
  val era = (if (z >= 0) z else z - 146_096) / 146_097
  val doe = z - era * 146_097
  val yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365
  val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  val mp = (5 * doy + 2) / 153
  val day = doy - (153 * mp + 2) / 5 + 1
  val month = if (mp < 10) mp + 3 else mp - 9
  val year = yoe + era * 400 + if (month <= 2) 1 else 0
  return "${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}"
}

private fun twoPlaces(cents: Double): String {
  val whole = roundJs(cents)
  val negative = whole < 0
  val abs = kotlin.math.abs(whole)
  return (if (negative) "-" else "") + "${abs / 100}." + (abs % 100).toString().padStart(2, '0')
}

/** JavaScript's `Math.round`: halves toward positive infinity. */
private fun roundJs(value: Double): Long = if (value.isNaN()) 0L else floor(value + 0.5).toLong()

private fun disputeUsd(cents: Double) = "$" + twoPlaces(maxOf(0.0, cents))

private fun humanReason(reason: String?) = reason.orEmpty().replace('_', ' ').trim()

private fun daysLeft(dueByMs: Double, nowMs: Double): Long = ceil((dueByMs - nowMs) / 86_400_000).toLong()

fun describeOrderDispute(order: HostOrder, nowMs: Double): OrderDisputeBadge? {
  val dispute = order.dispute ?: return null
  val reason = humanReason(dispute.reason)
  val because = if (reason.isEmpty()) "" else " ($reason)"
  if (isOrderDisputeOpen(dispute)) {
    val dueBy = dispute.evidenceDueByMs ?: 0.0
    val left = if (dueBy > 0) daysLeft(dueBy, nowMs) else null
    val detail = "${disputeUsd(dispute.amountCents)} disputed$because, opened ${isoDay(dispute.openedAtMs)}. " +
      if (dueBy > 0) {
        "Evidence is due to Stripe by ${isoDay(dueBy)}" +
          if (left != null && left >= 0) " — $left day${if (left == 1L) "" else "s"} left." else " — that deadline has passed."
      } else {
        "Respond in the Stripe dashboard while the case is open."
      }
    return OrderDisputeBadge("open", "Chargeback open", detail, if (dueBy > 0) dueBy.toLong() else null, left)
  }
  val outcome = dispute.outcome ?: dispute.status
  val closed = dispute.closedAtMs?.takeIf { it != 0.0 }?.let { " on ${isoDay(it)}" } ?: ""
  if (outcome == "lost") {
    val reversed = dispute.reversedCents ?: 0.0
    return OrderDisputeBadge(
      "lost",
      "Charged back",
      "Dispute lost$closed. ${disputeUsd(reversed)} was taken back$because" +
        if (reversed < dispute.amountCents) " (of ${disputeUsd(dispute.amountCents)} disputed — the rest was already refunded)." else ".",
    )
  }
  if (outcome == "won") return OrderDisputeBadge("won", "Dispute won", "Dispute won$closed$because — no money was reversed.")
  return OrderDisputeBadge(
    "settled",
    "Dispute closed",
    "Dispute closed$closed$because" + (if (outcome.isEmpty()) "" else " as ${humanReason(outcome)}") + " — no money was reversed.",
  )
}

/** The open disputes across orders (`summariseOpenDisputes`), for the orders list's warning. */
data class OpenDisputeSummary(val count: Int, val soonestDueByMs: Long? = null, val soonestDaysLeft: Long? = null, val overdue: Boolean = false)

fun summariseOpenDisputes(orders: List<HostOrder>, nowMs: Double): OpenDisputeSummary {
  var count = 0
  var soonest: Double? = null
  for (order in orders) {
    if (!orderHasOpenDispute(order)) continue
    count += 1
    val dueBy = order.dispute?.evidenceDueByMs ?: 0.0
    if (dueBy > 0 && (soonest == null || dueBy < soonest)) soonest = dueBy
  }
  val due = soonest ?: return OpenDisputeSummary(count)
  return OpenDisputeSummary(count, due.toLong(), daysLeft(due, nowMs), due < nowMs)
}

/** What the merchant refunded and what a lost chargeback took (`splitOrderReversal`). */
data class OrderReversalSplit(val refundedCents: Long, val chargedBackCents: Long)

fun splitOrderReversal(order: HostOrder): OrderReversalSplit {
  val total = maxOf(0L, roundJs(order.refundedCents ?: 0.0))
  val chargedBack = minOf(total, maxOf(0L, roundJs(order.dispute?.reversedCents ?: 0.0)))
  return OrderReversalSplit(total - chargedBack, chargedBack)
}

/** Whether a line's goods were taken back (`orderLineRefunded`). */
fun orderLineRefunded(order: HostOrder, lineIndex: Int): Boolean = order.refundedLineItemIds.orEmpty().any { it.toInt() == lineIndex && it == it.toInt().toDouble() }

/** What refunding these lines returns (`orderLineRefundCents`): each line's share of the discount taken off its value. */
fun orderLineRefundCents(order: HostOrder, lineIndexes: List<Int>): Long {
  val lines = order.lineItems.orEmpty()
  val gross = lines.map { maxOf(0L, roundJs(it.unitAmountCents) * maxOf(1L, roundJs(it.quantity))) }
  val shares = apportionCents(gross.map { it.toDouble() }, maxOf(0L, roundJs(order.totals?.discountCents ?: 0.0)).toDouble())
  var cents = 0L
  for (index in lineIndexes.toSet()) if (index >= 0 && index < lines.size) cents += gross[index] - shares[index]
  return maxOf(0L, cents)
}

private fun dialogUsd(cents: Double) = "$" + twoPlaces(cents)

/** The order dialog's refund question (`orderRefundPrompt`): the whole order or the named lines. */
data class RefundPrompt(val title: String, val text: String)

fun orderRefundPrompt(order: HostOrder, lineItemIds: List<Int> = emptyList()): RefundPrompt {
  val lines = order.lineItems.orEmpty()
  val scoped = lineItemIds.isNotEmpty()
  var text = if (scoped) {
    val names = lineItemIds.joinToString(", ") { lines.getOrNull(it)?.name ?: "line $it" }
    "Refunds ${dialogUsd(orderLineRefundCents(order, lineItemIds).toDouble())} for $names through Stripe, and withdraws that line's " +
      "downloads, license keys and gated content. A license key already sent to the buyer is retired, not returned to your pool " +
      "— they still hold the string, so reissuing it would give two people one working key."
  } else {
    "Refunds ${dialogUsd((order.totals?.totalCents ?: order.amountCents ?: 0.0) - (order.refundedCents ?: 0.0))} to the buyer through Stripe."
  }
  if (orderHasOpenDispute(order) && !orderDisputeBlocksRefund(order)) {
    text += " An inquiry is open on this charge — a full refund resolves it before it can become a chargeback."
  }
  return RefundPrompt(if (scoped) "Refund this line?" else "Refund this order?", text)
}

/** How the order's tax was calculated (`describeOrderTaxMode`); an absent mode is "not recorded", never "no tax". */
fun describeOrderTaxMode(mode: String?): String = when (mode) {
  "stripe-automatic" -> "Calculated automatically by Stripe Tax at checkout, from the shopper’s address."
  "manual" -> "Calculated from this store’s own configured tax rate."
  "none" -> "No sales tax was calculated on this order."
  else -> "How this tax was calculated was not recorded on this order."
}

private val PAYMENT_RISK_LABELS = mapOf("early-fraud-warning" to "Fraud warning", "radar-review" to "Held for review", "dispute" to "Chargeback")
private val PAYMENT_RISK_ADVICE = mapOf(
  "early-fraud-warning" to "The card issuer reported this payment as possibly fraudulent. It is not a chargeback yet; refunding it in Stripe now usually prevents one. Hold anything not yet shipped or delivered until you are sure.",
  "radar-review" to "Stripe Radar is holding this payment for review. Approve or refund it in Stripe; it stays held until you do.",
  "dispute" to "The cardholder disputed this payment. Respond in Stripe with your evidence before the deadline, or accept it.",
)

/** The payment-risk chip for the latest signal (`describePaymentRisk`), always saying nothing was refunded. */
data class PaymentRiskChip(val label: String, val detail: String)

fun describePaymentRisk(risk: PaymentRisk?): PaymentRiskChip? {
  val latest = risk?.signals?.lastOrNull() ?: return null
  val kind = latest.kind.raw
  val outcome = latest.outcome?.let { " (${it.replace('_', ' ')})" } ?: ""
  val why = latest.detail?.let { " Stripe says: ${it.replace('_', ' ')}." } ?: ""
  return PaymentRiskChip("${PAYMENT_RISK_LABELS[kind] ?: kind}$outcome", "${PAYMENT_RISK_ADVICE[kind].orEmpty()}$why ${Contracts.nothingMoved}")
}
