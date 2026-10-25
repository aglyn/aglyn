package com.aglyn.plugins.commerce.orders

import com.aglyn.contracts.posShiftsCsv
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreOrder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Aglyn app's Orders reports: the Apple app's `OrdersReportsTests`, case for case. */
class OrdersReportsTest {
  private val closed: Map<String, Any?> = mapOf(
    "hostId" to "h1", "registerId" to "r1", "status" to "closed", "openedBy" to "u1", "openedByName" to "Cashier One",
    "openedAtMs" to 1_792_929_600_000L, "openingFloatCents" to 15000L, "cashEvents" to emptyList<Any>(), "closedBy" to "u1",
    "closedAtMs" to 1_792_958_700_000L, "countedCashCents" to 20350L, "expectedCashCents" to 20550L, "varianceCents" to -200L,
    "netSalesCents" to 23110L,
    "report" to mapOf(
      "orderCount" to 11L, "grossSalesCents" to 24360L, "discountsCents" to 250L, "taxCents" to 1840L, "tipsCents" to 1260L,
      "salesByTender" to mapOf("card_present" to 15810L, "cash" to 7300L), "refundCount" to 0L, "refundsCents" to 0L,
      "refundsByTender" to emptyMap<String, Any>(), "netSalesCents" to 23110L, "openingFloatCents" to 15000L,
      "cashSalesCents" to 7300L, "paidInCents" to 0L, "paidOutCents" to 500L, "dropsCents" to 0L, "cashRefundsCents" to 0L,
      "expectedCashCents" to 20550L,
    ),
  )

  @Test
  fun aShiftDocumentReadsAsAHistoryRowAndAnUnreadableOneIsSkipped() {
    val row = shiftRowFrom(FirestoreDoc("s1", "hosts/h1/registers/r1/shifts/s1", closed), "Front counter")
    assertEquals("s1", row?.id)
    assertEquals("Front counter", row?.registerName)
    assertEquals(23110.0, row?.shift?.report?.netSalesCents)
    assertNull(shiftRowFrom(FirestoreDoc("bad", "hosts/h1/registers/r1/shifts/bad", mapOf("status" to "closed")), "Front counter"))
  }

  @Test
  fun theHistoryReadsOneRegistersNewestShifts() {
    val query = shiftHistoryQuery("h1", "r1")
    assertEquals("hosts/h1/registers/r1/shifts", query.collectionPath)
    assertEquals(listOf(FirestoreOrder("openedAtMs", descending = true)), query.orderBy)
    assertEquals(SHIFT_HISTORY_WINDOW, query.limit)
  }

  @Test
  fun theHistoryIsTheConsolesSpreadsheet() {
    val row = shiftRowFrom(FirestoreDoc("s1", "hosts/h1/registers/r1/shifts/s1", closed), "Front counter")!!
    val text = posShiftsCsv(listOf(row))
    assertTrue(text.startsWith("Shift,Register,Opened"))
    assertTrue(text.contains("s1,Front counter,2026-10-25T12:00:00.000Z,Cashier One"))
  }
}
