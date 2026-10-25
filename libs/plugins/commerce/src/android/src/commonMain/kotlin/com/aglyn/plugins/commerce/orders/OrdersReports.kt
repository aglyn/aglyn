package com.aglyn.plugins.commerce.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.PosShift
import com.aglyn.contracts.PosShiftCsvRow
import com.aglyn.contracts.PosShiftStatus
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.contracts.posShiftsCsv
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.plugins.commerce.pos.ConsolePosDayReportApi
import com.aglyn.plugins.commerce.pos.PosDayReportModel
import com.aglyn.plugins.commerce.pos.PosDayTotalsBody
import com.aglyn.plugins.commerce.pos.PosRegister
import com.aglyn.plugins.commerce.pos.ShiftReportView
import com.aglyn.plugins.commerce.pos.money
import com.aglyn.plugins.commerce.pos.posRegisterFrom
import com.aglyn.plugins.commerce.pos.registersQuery
import com.aglyn.plugins.commerce.pos.sortRegisters
import com.aglyn.plugins.commerce.products.storedProductJson
import com.aglyn.ui.LocalFileExporter
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch

/*
 * THE REGISTER'S REPORTS IN ORDERS (AGL-4062): the console's Day report and
 * Shift history cards, for a store with registers. Two rows head the orders
 * list; Day report shows every register's day (the register's own Day totals
 * body), Shift history a register's newest shifts, each opening its frozen
 * Z report, with the history as a spreadsheet. The Apple kit's
 * `OrdersReports.swift`.
 */

/** The list row ids the two reports take beside the orders' own. */
const val ORDERS_DAY_REPORT_ROW = "report.day"
const val ORDERS_SHIFT_HISTORY_ROW = "report.shifts"

/** The newest shifts one register reads at a time, as the console's history card pages them. */
const val SHIFT_HISTORY_WINDOW = 50

/** One register's shifts, newest first. */
fun shiftHistoryQuery(hostId: String, registerId: String) =
  FirestoreQuery("hosts/$hostId/registers/$registerId/shifts", orderBy = listOf(FirestoreOrder("openedAtMs", descending = true)), limit = SHIFT_HISTORY_WINDOW)

/** A shift document as the history reads it; null for one that does not decode. */
fun shiftRowFrom(doc: FirestoreDoc, registerName: String): PosShiftCsvRow? {
  val shift = runCatching { ContractJsonFormat.decodeFromJsonElement(PosShift.serializer(), storedProductJson(doc.data)) }.getOrNull() ?: return null
  return PosShiftCsvRow(doc.id, registerName, shift)
}

/** The site's registers, read once per screen: with any, the reports head the orders list. */
@Composable
fun rememberOrdersRegisters(context: NativePluginContext): List<PosRegister> {
  val hostId = context.hostId
  val flow: Flow<Live<List<FirestoreDoc>>> = remember(hostId, context.firestore) { hostId?.let { context.firestore.observe(registersQuery(it)) } ?: emptyFlow() }
  val live by flow.collectAsState(Live.Loading)
  return (live as? Live.Ready)?.value?.map(::posRegisterFrom)?.let(::sortRegisters).orEmpty()
}

/** The store's currency, as its site document names it (the register reads it the same way). */
@Composable
fun rememberStoreCurrency(context: NativePluginContext): String {
  var currency by remember(context.hostId) { mutableStateOf("usd") }
  androidx.compose.runtime.LaunchedEffect(context.hostId) {
    val hostId = context.hostId ?: return@LaunchedEffect
    (runCatching { context.firestore.get("hosts/$hostId") }.getOrNull()?.data?.get("currency") as? String)?.ifEmpty { null }?.let { currency = it.lowercase() }
  }
  return currency
}

/** Day report: every register's day, as the register's Day totals show it. */
@Composable
fun OrdersDayReportPane(context: NativePluginContext, currency: String) {
  val model = remember(context.hostId) { PosDayReportModel(ConsolePosDayReportApi(context.api, context.hostId ?: "")) }
  Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("orders-day-report-pane")) {
    Text("Day report", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(bottom = space(1.5f)))
    PosDayTotalsBody(model, currency, notSynced = null)
  }
}

/** Shift history: pick a register, read its shifts, open one's Z report, share them all as a spreadsheet. */
@Composable
fun ShiftHistoryPane(context: NativePluginContext, registers: List<PosRegister>, currency: String) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val exporter = LocalFileExporter.current
  var registerId by remember { mutableStateOf<String?>(null) }
  var open by remember { mutableStateOf<PosShiftCsvRow?>(null) }
  var exportFailed by remember { mutableStateOf(false) }
  val register = registers.firstOrNull { it.id == registerId } ?: registers.firstOrNull()
  val flow: Flow<Live<List<FirestoreDoc>>> = remember(hostId, register?.id, context.firestore) {
    register?.let { context.firestore.observe(shiftHistoryQuery(hostId, it.id)) } ?: emptyFlow()
  }
  val live by flow.collectAsState(Live.Loading)
  val rows = (live as? Live.Ready)?.value?.mapNotNull { shiftRowFrom(it, register?.name ?: "Register") }
  fun m(cents: Double?) = cents?.let { money(it.toLong(), currency) } ?: "—"

  Column(
    Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("shift-history"),
    verticalArrangement = Arrangement.spacedBy(space(1.5f)),
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text("Shift history", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
      if (!rows.isNullOrEmpty() && exporter != null && register != null) {
        val slug = register.name.lowercase().replace(Regex("[^a-z0-9]+"), "-")
        OutlinedButton(
          onClick = { scope.launch { exportFailed = !exporter.export("shifts-$slug.csv", "text/csv", posShiftsCsv(rows).encodeToByteArray()) } },
          modifier = Modifier.testTag("shift-history-share"),
        ) { Text("Share CSV") }
      }
    }
    if (registers.size > 1) {
      SelectField("Register", registers.map { SelectOption(it.id, it.name) }, register?.id, { registerId = it }, Modifier.testTag("shift-history-register"))
    }
    if (exportFailed) NoticeBanner("The spreadsheet could not be saved. Try again.", StatusTone.ERROR)
    when {
      live is Live.Failed -> NoticeBanner("The shifts could not be read. Check the connection and try again.", StatusTone.ERROR)
      rows == null -> Text("Reading the shifts…", color = MaterialTheme.colorScheme.onSurfaceVariant)
      rows.isEmpty() -> Text("No shifts on this register yet.", Modifier.testTag("shift-history-empty"), color = MaterialTheme.colorScheme.onSurfaceVariant)
      else -> SectionCard("Shifts", Modifier.fillMaxWidth()) {
        rows.forEach { row -> ShiftHistoryRow(row, ::m) { open = row } }
      }
    }
  }

  open?.let { row ->
    AlertDialog(
      onDismissRequest = { open = null },
      title = { Text(if (row.shift.report == null) "Shift" else "Z report") },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(space(1f)), modifier = Modifier.testTag("shift-z-report")) {
          Text("${row.registerName ?: "Register"} · ${row.shift.openedByName ?: "Shift"}", style = MaterialTheme.typography.bodyMedium)
          val report = row.shift.report
          if (report != null) ShiftReportView(report, row.shift, currency)
          else Text("This shift is still open. Its Z report is made when it closes; the register's X report shows it so far.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      },
      confirmButton = { TextButton(onClick = { open = null }) { Text("Done") } },
    )
  }
}

@Composable
private fun ShiftHistoryRow(row: PosShiftCsvRow, money: (Double?) -> String, onClick: () -> Unit) {
  val shift = row.shift
  val opened = formatReceiptTime(shift.openedAtMs.toLong(), null)
  val closed = if (shift.status == PosShiftStatus.OPEN) "Open" else shift.closedAtMs?.let { formatReceiptTime(it.toLong(), null) } ?: "—"
  com.aglyn.ui.ScaffoldListRow(
    title = shift.openedByName ?: "Shift",
    detail = "$opened – $closed",
    kind = com.aglyn.ui.ScaffoldRowKind.ORDER,
    leading = { com.aglyn.ui.ScaffoldRowTile("schedule") },
    figure = money(shift.netSalesCents ?: shift.report?.netSalesCents),
    status = {
      val variance = shift.varianceCents
      when {
        variance != null -> StatusChip(
          if (variance == 0.0) "Balanced" else "${if (variance < 0) "Short" else "Over"} ${money(kotlin.math.abs(variance))}",
          if (variance == 0.0) StatusTone.SUCCESS else StatusTone.WARNING,
        )
        shift.status == PosShiftStatus.OPEN -> StatusChip("Open", StatusTone.SUCCESS)
      }
    },
    onClick = onClick,
    modifier = Modifier.testTag("shift-${row.id}"),
  )
}
