package com.aglyn.plugins.commerce.sales

import com.aglyn.contracts.FigureOrder
import com.aglyn.contracts.HostOrder
import com.aglyn.contracts.OrderChannel
import com.aglyn.contracts.OrderLineItem
import com.aglyn.contracts.OrderStatus
import com.aglyn.contracts.OrderTotals
import com.aglyn.contracts.localDayStarts
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val ZONE = "UTC"
private const val DAY = 86_400_000L
// 2026-10-07 15:00 UTC.
private const val NOW = 1_791_385_200_000L

private fun sale(id: String, atMs: Long, cents: Double, status: OrderStatus = OrderStatus.PAID, channel: OrderChannel = OrderChannel.ONLINE) =
  FigureOrder(
    id,
    true,
    HostOrder(
      status = status,
      channel = channel,
      createdAtMs = atMs.toDouble(),
      totals = OrderTotals(totalCents = cents),
      lineItems = listOf(OrderLineItem(name = "Mug", productId = "p1", quantity = 1.0, unitAmountCents = cents)),
    ),
  )

class SalesTest {
  private val today = localDayStarts(NOW, 1, ZONE).single()

  @Test
  fun aWeekAgainstTheWeekBeforeByDayAndChannel() {
    val orders = listOf(
      sale("a", today + 1_000, 1000.0),
      sale("b", today - DAY + 5, 500.0, channel = OrderChannel.POS),
      sale("c", today - 8 * DAY, 750.0),
      sale("d", today + 2_000, 999.0, status = OrderStatus.PENDING),
    )
    val report = salesReport(orders, 7, NOW, timeZone = ZONE)
    assertEquals(2L, report.current.orders)
    assertEquals(1500.0, report.current.revenueCents)
    assertEquals(750.0, report.previous.revenueCents)
    assertEquals(100.0, report.revenueDeltaPct)
    assertEquals(7, report.days.size)
    assertEquals(today, report.days.last().startMs)
    assertEquals(listOf(0.0, 0.0, 0.0, 0.0, 0.0, 500.0, 1000.0), report.days.map { it.revenueCents })
    assertEquals(listOf("Online" to 1000.0, "POS" to 500.0), report.channels.map { it.label to it.revenueCents })
    assertEquals(1500.0, report.topProducts.single().cents)
  }

  @Test
  fun aCappedReadMakesNoComparison() {
    val report = salesReport(listOf(sale("a", today + 1, 100.0)), 7, NOW, capped = true, timeZone = ZONE)
    assertNull(report.revenueDeltaPct)
    assertNull(report.ordersDeltaPct)
  }

  @Test
  fun todayCountsSalesAndWhatIsWaitingToShip() {
    val sales = todaySales(listOf(sale("a", today + 1, 100.0), sale("b", today - 1, 50.0, status = OrderStatus.FULFILLED)), NOW, capped = false, timeZone = ZONE)
    assertEquals(1L, sales.figures.orders)
    assertEquals(1, sales.toFulfill)
  }

  @Test
  fun theWindowIsReadNewestFirstWithAProbeRow() {
    val query = ordersSinceQuery("h1", 123L)
    assertEquals(FilterOp.GTE, query.filters.single().op)
    assertEquals(SALES_ORDER_CEILING + 1, query.limit)
    assertEquals(true, query.orderBy.single().descending)
  }

  private fun workspace(org: Map<String, Any?>?) = object : FirestoreReader {
    override suspend fun get(path: String): FirestoreDoc? = org?.takeIf { path == "orgs/o1" }?.let { FirestoreDoc("o1", path, it) }
    override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
    override fun observeDoc(path: String) = emptyFlow<Live<FirestoreDoc?>>()
    override fun observe(query: FirestoreQuery) = emptyFlow<Live<List<FirestoreDoc>>>()
  }

  @Test
  fun everyFigureWaitsForAPlanThatSellsCommerceAnalytics() = runTest {
    // The console shows these figures from Pro up; the app shows them to the same plans.
    val pro = salesAccess(workspace(mapOf("plan" to "pro")), "o1")
    assertTrue(pro.carried)
    val starter = salesAccess(workspace(mapOf("plan" to "starter")), "o1")
    assertFalse(starter.carried)
    assertEquals("Pro", starter.plan, "the plan an upsell names is the cheapest that includes it")
    assertFalse(salesAccess(workspace(null), "o1").carried, "a workspace that cannot be read gets no figures")
    val granted = salesAccess(workspace(mapOf("plan" to "starter", "entitlements" to mapOf("features" to mapOf("commerceAnalytics" to true)))), "o1")
    assertTrue(granted.carried, "a feature granted to the workspace itself counts, as it does in the console")
    assertTrue(salesLockedText(starter.plan).contains("included from Pro"))
  }
}
