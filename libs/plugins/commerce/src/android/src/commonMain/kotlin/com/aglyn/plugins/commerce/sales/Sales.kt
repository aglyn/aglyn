package com.aglyn.plugins.commerce.sales

import com.aglyn.contracts.FigureOrder
import com.aglyn.contracts.HostOrder
import com.aglyn.contracts.OrderStatus
import com.aglyn.contracts.OrderWindowFigures
import com.aglyn.contracts.ProductSales
import com.aglyn.contracts.liftLegacyOrder
import com.aglyn.contracts.localDayStarts
import com.aglyn.contracts.orderChannelLabel
import com.aglyn.contracts.orderCountsAsSale
import com.aglyn.contracts.orderPaidCents
import com.aglyn.contracts.orderWindowFigures
import com.aglyn.contracts.productSales
import com.aglyn.contracts.startOfLocalDay
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.decode
import com.aglyn.plugins.commerce.orders.ordersPath
import kotlin.math.roundToLong

/*
 * The store's sales in the Aglyn app: today, and the last 7 or 30 days
 * against the window before. Read from the site's orders over a window (the
 * console's own figures, ported in the contracts kit), as the console's sales
 * cards read them.
 */

/** The most orders a window reads; past it the oldest drop and the comparison is withheld. */
const val SALES_ORDER_CEILING = 500

private const val DAY_MS = 24L * 60 * 60 * 1000

/** A stored order as the figures take it. */
fun figureOrder(doc: FirestoreDoc): FigureOrder =
  FigureOrder(doc.id, doc.data["livemode"] as? Boolean, doc.decode(HostOrder.serializer()) ?: HostOrder())

/** Orders created since [sinceMs], newest first, a probe past the ceiling. */
fun ordersSinceQuery(hostId: String, sinceMs: Long) = FirestoreQuery(
  ordersPath(hostId),
  filters = listOf(FirestoreFilter("createdAtMs", FilterOp.GTE, sinceMs)),
  orderBy = listOf(FirestoreOrder("createdAtMs", descending = true)),
  limit = SALES_ORDER_CEILING + 1,
)

suspend fun ordersSince(firestore: FirestoreReader, hostId: String, sinceMs: Long): Pair<List<FigureOrder>, Boolean> {
  val docs = firestore.page(ordersSinceQuery(hostId, sinceMs)).docs
  return docs.take(SALES_ORDER_CEILING).map(::figureOrder) to (docs.size > SALES_ORDER_CEILING)
}

data class TodaySales(val figures: OrderWindowFigures, val toFulfill: Int, val capped: Boolean)

fun todaySales(orders: List<FigureOrder>, nowMs: Long, capped: Boolean, timeZone: String? = null): TodaySales {
  val start = startOfLocalDay(nowMs, timeZone)
  return TodaySales(
    figures = orderWindowFigures(orders, start.toDouble(), (nowMs + 1).toDouble()),
    toFulfill = orders.count { liftLegacyOrder(it.order).status in setOf(OrderStatus.PAID, OrderStatus.PARTIALLY_FULFILLED) },
    capped = capped,
  )
}

data class SalesDay(val startMs: Long, val orders: Int, val revenueCents: Double)
data class ChannelSales(val channel: String, val label: String, val revenueCents: Double)

data class SalesReport(
  val range: Int,
  val current: OrderWindowFigures,
  val previous: OrderWindowFigures,
  /** Percent change against the window before, to one decimal; null with no baseline or a capped read. */
  val revenueDeltaPct: Double?,
  val ordersDeltaPct: Double?,
  val days: List<SalesDay>,
  val channels: List<ChannelSales>,
  val topProducts: List<ProductSales>,
  val capped: Boolean,
)

private fun deltaPct(current: Double, previous: Double): Double? =
  if (previous == 0.0) null else kotlin.math.floor(((current - previous) / previous) * 1000 + 0.5).roundToLong() / 10.0

/** The report for the last [range] local days (today included) against the [range] days before. */
fun salesReport(orders: List<FigureOrder>, range: Int, nowMs: Long, capped: Boolean = false, timeZone: String? = null): SalesReport {
  val starts = localDayStarts(nowMs, range * 2, timeZone)
  val previousStart = starts.first()
  val windowStart = starts[range]
  val dayStarts = starts.drop(range)
  val current = orderWindowFigures(orders, windowStart.toDouble(), (nowMs + 1).toDouble())
  val previous = orderWindowFigures(orders, previousStart.toDouble(), windowStart.toDouble())
  val inWindow = orders.filter { (it.createdAtMs ?: -1.0) >= windowStart && orderCountsAsSale(it) }
  val days = dayStarts.mapIndexed { index, start ->
    val end = dayStarts.getOrNull(index + 1) ?: (nowMs + 1)
    val sales = inWindow.filter { (it.createdAtMs ?: -1.0) >= start && (it.createdAtMs ?: -1.0) < end }
    SalesDay(start, sales.size, sales.sumOf { orderPaidCents(liftLegacyOrder(it.order)) })
  }
  val channels = inWindow
    .groupBy { liftLegacyOrder(it.order).channel?.raw ?: "online" }
    .map { (channel, sales) -> ChannelSales(channel, orderChannelLabel(channel), sales.sumOf { orderPaidCents(liftLegacyOrder(it.order)) }) }
    .sortedByDescending { it.revenueCents }
  return SalesReport(
    range = range,
    current = current,
    previous = previous,
    revenueDeltaPct = if (capped) null else deltaPct(current.revenueCents, previous.revenueCents),
    ordersDeltaPct = if (capped) null else deltaPct(current.orders.toDouble(), previous.orders.toDouble()),
    days = days,
    channels = channels,
    topProducts = productSales(inWindow).take(5),
    capped = capped,
  )
}

/** How far back a [range]-day report reads: both windows, and a day of slack. */
fun reportSinceMs(nowMs: Long, range: Int, timeZone: String? = null): Long = startOfLocalDay(nowMs, timeZone) - (range * 2 + 1) * DAY_MS
