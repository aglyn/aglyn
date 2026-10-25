package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.PosDayCash
import com.aglyn.contracts.PosDayRegisterRow
import com.aglyn.contracts.PosDayReport
import com.aglyn.contracts.PosDayTenderRow
import com.aglyn.contracts.PosDayTotals
import com.aglyn.contracts.PosTenderMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.ui.Load
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Day totals on the register: the Apple app's `PosDayReport` tests, case for case. */
class PosDayReportTest {
  private fun report(from: String = "2026-10-25", to: String = "2026-10-25") = PosDayReport(
    byCashier = emptyList(),
    byRegister = listOf(
      PosDayRegisterRow(
        discountsCents = 0.0, grossSalesCents = 19_840.0, name = "Front counter", netSalesCents = 19_840.0, orderCount = 9.0,
        refundCount = 0.0, refundsCents = 0.0, registerId = "r1", salesByTender = emptyMap(), taxCents = 0.0, tipsCents = 0.0,
      ),
    ),
    byTender = listOf(PosDayTenderRow(label = "Card", method = PosTenderMethod.CARD_PRESENT, netCents = 18_915.0, refundsCents = 0.0, salesCents = 18_915.0)),
    cash = PosDayCash(
      cashRefundsCents = 0.0, cashSalesCents = 8_525.0, closedShiftCount = 1.0, countedCashCents = 22_325.0, dropsCents = 0.0,
      expectedCashCents = 22_325.0, openExpectedCashCents = 7_600.0, openingFloatCents = 15_000.0, openShiftCount = 1.0,
      paidInCents = 0.0, paidOutCents = 1_200.0, varianceCents = 0.0,
    ),
    currency = "usd", days = 1.0, endMs = 0.0, from = from, generatedAtMs = 0.0, hostId = "h1", shifts = emptyList(),
    startMs = 0.0, storeName = "Juniper Street Bakery", timeZone = "America/Chicago", to = to,
    totals = PosDayTotals(
      discountsCents = 460.0, grossSalesCents = 28_640.0, netSalesCents = 27_440.0, orderCount = 14.0, refundCount = 1.0,
      refundsCents = 1_200.0, salesByTender = emptyMap(), taxCents = 2_183.0, tipsCents = 1_820.0,
    ),
  )

  private class FakeDayApi : PosDayReportApi {
    val asked = mutableListOf<Pair<String?, String?>>()
    var fails: Throwable? = null
    override suspend fun report(from: String?, to: String?): PosDayReport {
      asked += from to to
      fails?.let { throw it }
      return if (from == null) PosDayReportTest().report() else PosDayReportTest().report(from, to ?: from)
    }
  }

  private val money = { cents: Long -> money(cents, "usd") }

  @Test
  fun theSectionsReadTheWayTheConsolesCardDoes() {
    val sections = posDayReportSections(report(), money)
    assertEquals(listOf("Sales", "By tender", "By register", "Cash drawers"), sections.map { it.title })
    assertEquals(PosDayRow("Net sales", money(27_440), strong = true), sections[0].rows.last())
    assertEquals(PosDayRow("Refunds (1)", money(-1_200)), sections[0].rows[5])
    assertEquals(PosDayRow("Balanced", money(0), strong = true), sections[3].rows[8])
    assertEquals(PosDayRow("Still open (1)", money(7_600)), sections[3].rows.last())
  }

  @Test
  fun theRegistersOwnUnsyncedSalesAreCountedByTender() {
    assertTrue(PosDayNotSynced.of(emptyList()).isEmpty)
  }

  @Test
  fun todayThenPickedDaysReadForwards() = runTest {
    val api = FakeDayApi()
    val model = PosDayReportModel(api)
    model.today()
    assertEquals("2026-10-25", model.label)
    model.pick("2026-10-27", "2026-10-24")
    assertEquals(listOf(null to null, "2026-10-24" to "2026-10-27"), api.asked)
    assertEquals("2026-10-24 to 2026-10-27", model.label)
    assertEquals("day-totals-2026-10-24-to-2026-10-27.csv", model.csv()?.first)
  }

  @Test
  fun aLostConnectionSaysSoAndKeepsNoSpreadsheet() = runTest {
    val api = FakeDayApi().apply { fails = ConsoleApiError("offline", 0, null) }
    val model = PosDayReportModel(api)
    model.load()
    assertIs<Load.Failed>(model.state)
    assertEquals("The day totals could not be read. Check the connection.", (model.state as Load.Failed).message)
    assertNull(model.csv())
    api.fails = ConsoleApiError("Only managers can read day totals.", 403, null)
    model.load()
    assertEquals("Only managers can read day totals.", (model.state as Load.Failed).message)
  }

  @Test
  fun aPickedDayIsTheCalendarDayItNames() {
    assertEquals("1970-01-01", utcDayKey(0))
    assertEquals("2026-10-25", utcDayKey(1_792_886_400_000))
    assertEquals("2024-02-29", utcDayKey(1_709_164_800_000))
    assertEquals("1969-12-31", utcDayKey(-1))
  }
}
