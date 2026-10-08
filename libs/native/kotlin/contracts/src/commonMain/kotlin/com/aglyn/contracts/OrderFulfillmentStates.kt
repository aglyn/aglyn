package com.aglyn.contracts

import kotlin.math.floor
import kotlin.math.min
import kotlin.math.roundToLong

/*
 * What an order has shipped and what is left, ported once from
 * libs/plugins/commerce/src/lib/model/order-fulfillment.ts. The
 * `orderLineFulfillmentStates` cases in function-cases.generated.json are the
 * TypeScript's own answers, and the tests replay every one.
 */

/** One order line's shipping state; [lineItemId] is its index in `lineItems`. */
data class OrderLineFulfillmentState(
  val lineItemId: Int,
  val quantity: Long,
  val fulfilledQuantity: Long,
  val remainingQuantity: Long,
  val requiresShipping: Boolean,
)

/** Digital goods and services are delivered by other means; an untyped line is physical. */
fun lineRequiresShipping(line: OrderLineItem): Boolean =
  line.productType != ProductType.DIGITAL && line.productType != ProductType.SERVICE

private fun wholeUnits(value: Double?): Long {
  val units = floor(value ?: 0.0)
  return if (units.isFinite() && units > 0) units.toLong() else 0L
}

/** A cancelled fulfillment ships nothing. */
fun fulfillmentIsActive(fulfillment: OrderFulfillment): Boolean = fulfillment.status != OrderFulfillmentStatus.CANCELLED

/** The units one fulfillment covers per line; a legacy one (no `lines`) covers each named line whole. */
fun fulfillmentLineQuantities(order: HostOrder, fulfillment: OrderFulfillment): List<Pair<Int, Long>> {
  val lines = order.lineItems ?: emptyList()
  val explicit = fulfillment.lines
  if (!explicit.isNullOrEmpty()) {
    return explicit
      .map { it.lineItemId.roundToLong() to wholeUnits(it.quantity) }
      .filter { (index, units) -> index >= 0 && index < lines.size && units > 0 }
      .map { (index, units) -> index.toInt() to units }
  }
  return fulfillment.lineItemIds
    .map { it.roundToLong() }
    .filter { it >= 0 && it < lines.size }
    .map { it.toInt() to wholeUnits(lines[it.toInt()].quantity) }
    .filter { (_, units) -> units > 0 }
}

/** Each line's units, shipped and left, over every active fulfillment. */
fun orderLineFulfillmentStates(order: HostOrder): List<OrderLineFulfillmentState> {
  val fulfilled = mutableMapOf<Int, Long>()
  for (fulfillment in order.fulfillments ?: emptyList()) {
    if (!fulfillmentIsActive(fulfillment)) continue
    for ((index, units) in fulfillmentLineQuantities(order, fulfillment)) fulfilled[index] = (fulfilled[index] ?: 0L) + units
  }
  return (order.lineItems ?: emptyList()).mapIndexed { index, line ->
    val quantity = wholeUnits(line.quantity)
    val done = min(quantity, fulfilled[index] ?: 0L)
    OrderLineFulfillmentState(index, quantity, done, quantity - done, lineRequiresShipping(line))
  }
}

/** The lines still to ship, with how many units of each. */
fun remainingFulfillmentLines(order: HostOrder): List<OrderLineFulfillmentState> =
  orderLineFulfillmentStates(order).filter { it.requiresShipping && it.remainingQuantity > 0 }

/*
 * Whether a dispute refuses a refund, ported from
 * libs/plugins/commerce/src/lib/model/commerce-dispute.ts
 * (`orderDisputeBlocksRefund`, replayed from function-cases.generated.json).
 */
private val SETTLED_DISPUTE_STATUSES = setOf("won", "lost", "warning_closed")
private val OPEN_INQUIRY_STATUSES = setOf("warning_needs_response", "warning_under_review")

/** A dispute Stripe has not decided yet. */
fun isOrderDisputeOpen(dispute: OrderDispute?): Boolean =
  dispute != null && dispute.outcome.isNullOrEmpty() && (dispute.closedAtMs ?: 0.0) == 0.0 && dispute.status !in SETTLED_DISPUTE_STATUSES

/** An open dispute refuses a refund, except an inquiry (a warning), which a refund may settle. */
fun orderDisputeBlocksRefund(order: HostOrder): Boolean =
  isOrderDisputeOpen(order.dispute) && order.dispute?.status !in OPEN_INQUIRY_STATUSES
