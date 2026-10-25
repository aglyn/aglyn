package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.PosDayReport
import com.aglyn.contracts.posDayRangeLabel
import com.aglyn.contracts.posDayReportCsv
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.ui.Load
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject

/*
 * DAY TOTALS: every register, shift and cashier of one site over a day or an
 * event, from `GET /api/commerce/pos-day-report`. The console's day-report
 * card, on the device: Aglyn POS opens it from the register sheet, and the
 * Aglyn app from Orders. The figures are the server's (the same calculator as
 * the X and Z reports); the device only reads, lays out and exports them. The
 * Apple kit's `PosDayReport.swift`, line for line.
 */

/** The day report route, as the signed-in member. */
interface PosDayReportApi {
  /** [from] and [to] are `yyyy-MM-dd`; null asks for today in the store's own time zone. */
  suspend fun report(from: String?, to: String?): PosDayReport
}

class ConsolePosDayReportApi(private val api: ConsoleApiClient, private val hostId: String) : PosDayReportApi {
  override suspend fun report(from: String?, to: String?): PosDayReport {
    val answer = api.request(Contracts.posDayReportRoute, query = mapOf("hostId" to hostId, "from" to from, "to" to to))
    val report = (answer as? JsonObject)?.get("report")
    return report?.let { runCatching { ContractJsonFormat.decodeFromJsonElement(PosDayReport.serializer(), it) }.getOrNull() }
      ?: throw ConsoleApiError("The day totals could not be read.", 502, null)
  }
}

/** A register with no connection to the console: the day report needs one. */
object OfflinePosDayReport : PosDayReportApi {
  override suspend fun report(from: String?, to: String?): PosDayReport =
    throw ConsoleApiError("The day totals could not be read. Check the connection.", 0, null)
}

/** One row of the report as the screen, and the printed report, read it. */
data class PosDayRow(val label: String, val value: String, val strong: Boolean = false)

data class PosDaySection(val title: String, val rows: List<PosDayRow>)

/** The report's rows as the console lays them out (`posDayReportSections`). */
fun posDayReportSections(report: PosDayReport, money: (Long) -> String): List<PosDaySection> {
  val t = report.totals
  val c = report.cash
  fun m(cents: Double) = money(cents.toLong())
  val sections = mutableListOf(
    PosDaySection(
      "Sales",
      listOf(
        PosDayRow("Orders", t.orderCount.toLong().toString()),
        PosDayRow("Gross sales", m(t.grossSalesCents)),
        PosDayRow("Discounts", m(t.discountsCents)),
        PosDayRow("Tax", m(t.taxCents)),
        PosDayRow("Tips", m(t.tipsCents)),
        PosDayRow("Refunds (${t.refundCount.toLong()})", m(-t.refundsCents)),
        PosDayRow("Net sales", m(t.netSalesCents), strong = true),
      ),
    ),
    PosDaySection(
      "By tender",
      if (report.byTender.isEmpty()) listOf(PosDayRow("No sales", "")) else report.byTender.map { PosDayRow(it.label, m(it.netCents)) },
    ),
  )
  if (report.byRegister.isNotEmpty()) sections += PosDaySection("By register", report.byRegister.map { PosDayRow(it.name, m(it.netSalesCents)) })
  if (report.byCashier.isNotEmpty()) sections += PosDaySection("By cashier", report.byCashier.map { PosDayRow(it.name, m(it.netSalesCents)) })
  val drawers = mutableListOf(
    PosDayRow("Starting cash", m(c.openingFloatCents)),
    PosDayRow("Cash sales", m(c.cashSalesCents)),
    PosDayRow("Paid in", m(c.paidInCents)),
    PosDayRow("Paid out", m(-c.paidOutCents)),
    PosDayRow("Safe drops", m(-c.dropsCents)),
    PosDayRow("Cash refunds", m(-c.cashRefundsCents)),
    PosDayRow("Expected (${c.closedShiftCount.toLong()} closed)", m(c.expectedCashCents)),
    PosDayRow("Counted", m(c.countedCashCents)),
    PosDayRow(if (c.varianceCents < 0) "Short" else if (c.varianceCents > 0) "Over" else "Balanced", m(c.varianceCents), strong = true),
  )
  if (c.openShiftCount > 0) drawers += PosDayRow("Still open (${c.openShiftCount.toLong()})", m(c.openExpectedCashCents))
  sections += PosDaySection("Cash drawers", drawers)
  return sections
}

/** The device's own sales the report cannot include yet: rung offline and not synced. */
data class PosDayNotSynced(val cashCount: Int, val cashCents: Long, val cardCount: Int, val cardCents: Long) {
  val isEmpty: Boolean get() = cashCount == 0 && cardCount == 0

  companion object {
    fun of(queue: List<PosOfflineQueued>): PosDayNotSynced {
      val (cards, cash) = queue.partition { it.isCard }
      return PosDayNotSynced(cash.size, cash.sumOf { it.totalCents }, cards.size, cards.sumOf { it.totalCents })
    }
  }
}

/** The day totals screen's state: the days asked for, the report, and the report as a spreadsheet. */
class PosDayReportModel(private val api: PosDayReportApi) {
  /** The days asked for (`yyyy-MM-dd`); null is today in the store's own time zone. */
  var range by mutableStateOf<Pair<String, String>?>(null)
    private set
  var state by mutableStateOf<Load<PosDayReport>>(Load.Loading)
    private set
  private var generation = 0

  /** The days, as the range picker words them (the report's own once it has answered). */
  val label: String
    get() {
      (state as? Load.Ready)?.value?.let { return posDayRangeLabel(it.from, it.to) }
      return range?.let { posDayRangeLabel(it.first, it.second) } ?: "Today"
    }

  suspend fun today() {
    range = null
    load()
  }

  /** Picks days (`yyyy-MM-dd`); a range given backwards is read forwards, and the server bounds it to a month. */
  suspend fun pick(from: String, to: String) {
    range = if (from <= to) from to to else to to from
    load()
  }

  suspend fun load() {
    val mine = ++generation
    state = Load.Loading
    try {
      val report = api.report(range?.first, range?.second)
      if (mine == generation) state = Load.Ready(report)
    } catch (cancel: CancellationException) {
      throw cancel
    } catch (error: Throwable) {
      if (mine == generation) {
        val status = (error as? ConsoleApiError)?.status ?: 0
        state = Load.Failed(
          if (status == 0) "The day totals could not be read. Check the connection."
          else (error as? ConsoleApiError)?.message ?: "The day totals could not be read.",
        )
      }
    }
  }

  /** The report as a spreadsheet to share, named for its days; null until it has answered. */
  fun csv(): Pair<String, ByteArray>? {
    val report = (state as? Load.Ready)?.value ?: return null
    val name = "day-totals-${report.from}${if (report.from == report.to) "" else "-to-${report.to}"}.csv"
    return name to posDayReportCsv(report).encodeToByteArray()
  }
}
