package com.aglyn.contracts

import kotlin.math.roundToLong

/*
 * How the console reads a stored order before it counts or shows it, and the
 * sales figures it adds up, ported once from
 * libs/plugins/commerce/src/lib/model/{commerce-orders,order-figures}.ts and
 * libs/aglyn/src/lib/app-utils/stripe-deployment-mode.ts. The
 * liftLegacyOrder, orderIsTestMode, orderCountsAsSale, orderWindowFigures and
 * productSales cases in function-cases.generated.json are the TypeScript's
 * own answers, and the tests replay every one.
 */

/**
 * An order as the console reads it: a modern order (it has line items) is
 * `paid` unless it says otherwise; a pre-line-item order also gets a channel,
 * one line from its `productId`, and totals from its `amountCents`.
 */
fun liftLegacyOrder(raw: HostOrder): HostOrder {
  if (!raw.lineItems.isNullOrEmpty()) return raw.copy(status = raw.status ?: OrderStatus.PAID)
  val amount = raw.amountCents ?: 0.0
  return raw.copy(
    status = raw.status ?: OrderStatus.PAID,
    channel = raw.channel ?: OrderChannel.ONLINE,
    lineItems = raw.productId?.let { listOf(OrderLineItem(name = "Product", productId = it, quantity = 1.0, unitAmountCents = amount)) } ?: emptyList(),
    totals = raw.totals ?: OrderTotals(
      itemsCents = amount,
      shippingCents = 0.0,
      taxCents = 0.0,
      discountCents = 0.0,
      feeCents = raw.feeCents ?: 0.0,
      totalCents = amount,
    ),
  )
}

/** A Stripe id from test mode: `cs_test_…`, or another prefix with the `_test_` infix. */
fun stripeIdIsTestMode(id: String?): Boolean = Regex("^[a-z]+_test_").containsMatchIn(id?.trim().orEmpty())

/**
 * A test-mode order: Stripe's `livemode` when stored, else a test-mode
 * checkout session id, on the order or as its document id.
 */
fun orderIsTestMode(order: HostOrder, docId: String? = null, livemode: Boolean? = null): Boolean =
  livemode?.let { !it } ?: (stripeIdIsTestMode(order.checkoutSessionId) || stripeIdIsTestMode(docId))

/** One stored order as the figures read it: its document id, `livemode`, and the order itself, unlifted. */
data class FigureOrder(val id: String?, val livemode: Boolean?, val order: HostOrder) {
  val createdAtMs: Double? get() = order.createdAtMs
}

/** Money taken: not pending or cancelled, and not a test. */
fun orderCountsAsSale(source: FigureOrder): Boolean {
  val lifted = liftLegacyOrder(source.order)
  return lifted.status != OrderStatus.PENDING && lifted.status != OrderStatus.CANCELLED &&
    !orderIsTestMode(lifted, source.id, source.livemode)
}

data class OrderWindowFigures(val orders: Long, val revenueCents: Double, val averageCents: Double)

/** The sales in [startMs, endMs): how many, what they brought in, and the average, in whole cents. */
fun orderWindowFigures(orders: List<FigureOrder>, startMs: Double, endMs: Double): OrderWindowFigures {
  val counted = orders.filter { source ->
    val at = source.createdAtMs
    at != null && at.isFinite() && at >= startMs && at < endMs && orderCountsAsSale(source)
  }
  val revenue = counted.sumOf { orderPaidCents(liftLegacyOrder(it.order)) }
  val average = if (counted.isEmpty()) 0.0 else jsRound(revenue / counted.size).toDouble()
  return OrderWindowFigures(counted.size.toLong(), revenue, average)
}

data class ProductSales(val productId: String, val name: String, val units: Double, val cents: Double)

/** Units and money per product over the sales, most money first, then by name. Reads the stored lines, unlifted. */
fun productSales(orders: List<FigureOrder>): List<ProductSales> {
  val byProduct = linkedMapOf<String, ProductSales>()
  for (source in orders) {
    if (!orderCountsAsSale(source)) continue
    for (line in source.order.lineItems.orEmpty()) {
      if (line.productId.isEmpty()) continue
      val entry = byProduct[line.productId] ?: ProductSales(line.productId, line.name, 0.0, 0.0)
      byProduct[line.productId] = entry.copy(
        units = entry.units + (if (line.quantity.isFinite()) line.quantity else 0.0),
        cents = entry.cents + (if (line.unitAmountCents.isFinite() && line.quantity.isFinite()) line.unitAmountCents * line.quantity else 0.0),
      )
    }
  }
  return byProduct.values.sortedWith(compareByDescending<ProductSales> { it.cents }.thenComparator { a, b -> a.name.compareTo(b.name) })
}

/** JavaScript's Math.round: half rounds up, toward positive infinity. */
private fun jsRound(value: Double): Long = kotlin.math.floor(value + 0.5).roundToLong()
