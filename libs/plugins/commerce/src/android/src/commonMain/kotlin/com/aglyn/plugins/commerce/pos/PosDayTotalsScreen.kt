package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.PosDayReport
import com.aglyn.contracts.PosDayShiftRowStatus
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.contracts.posDayReportIsEmpty
import com.aglyn.ui.AmountRow
import com.aglyn.ui.LocalFileExporter
import com.aglyn.ui.Load
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.PanelSheet
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/*
 * DAY TOTALS, as a panel: the console's day-report card at a touch size. A day
 * (today by default) or a run of days up to a month; the sales, tenders,
 * registers, cashiers, drawers and shifts; the report as a spreadsheet through
 * the system's file save; and, on a register, the sales this device rang
 * offline that the report cannot include until they sync. The Apple kit's
 * `PosDayTotalsView.swift`.
 */

/** `yyyy-MM-dd` of a date picker's day (it speaks UTC midnights). */
fun utcDayKey(utcMs: Long): String {
  // Days since 1970-01-01 to a civil date (Howard Hinnant's days-to-civil), so no clock or zone is involved.
  val z = utcMs.floorDiv(86_400_000L) + 719_468
  val era = z.floorDiv(146_097L)
  val doe = z - era * 146_097
  val yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
  val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  val mp = (5 * doy + 2) / 153
  val day = doy - (153 * mp + 2) / 5 + 1
  val month = if (mp < 10) mp + 3 else mp - 9
  val year = yoe + era * 400 + if (month <= 2) 1 else 0
  return "${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}"
}

@Composable
fun PosDayTotalsPanel(
  model: PosDayReportModel,
  currency: String,
  /** This register's own unsynced sales (Aglyn POS); null in the Aglyn app. */
  notSynced: PosDayNotSynced?,
  onDismiss: () -> Unit,
) {
  PanelSheet(title = "Day totals", onDismiss = onDismiss, modifier = Modifier.testTag("day-totals"), subtitle = model.label) {
    PosDayTotalsBody(model, currency, notSynced)
  }
}

/**
 * The day report's body: the days with Today, Pick days and Share CSV, this register's unsynced sales, then the
 * sections. The register's panel and the Aglyn app's Orders pane both show it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PosDayTotalsBody(model: PosDayReportModel, currency: String, notSynced: PosDayNotSynced?) {
  val scope = rememberCoroutineScope()
  val exporter = LocalFileExporter.current
  var picking by remember { mutableStateOf(false) }
  var exportFailed by remember { mutableStateOf(false) }
  val reportCurrency = (model.state as? Load.Ready)?.value?.currency ?: currency
  fun m(cents: Long) = money(cents, reportCurrency)
  LaunchedEffect(model) { if (model.state is Load.Loading) model.load() }

  Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    SectionCard(model.label, Modifier.fillMaxWidth()) {
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedButton(onClick = { scope.launch { model.today() } }, modifier = Modifier.testTag("day-totals-today")) { Text("Today") }
        OutlinedButton(onClick = { picking = true }, modifier = Modifier.testTag("day-totals-pick")) { Text("Pick days") }
        val csv = model.csv()
        if (csv != null && exporter != null) {
          OutlinedButton(
            onClick = { scope.launch { exportFailed = !exporter.export(csv.first, "text/csv", csv.second) } },
            modifier = Modifier.testTag("day-totals-share"),
          ) { Text("Share CSV") }
        }
      }
    }
    if (exportFailed) NoticeBanner("The spreadsheet could not be saved. Try again.", StatusTone.ERROR)
    if (notSynced != null && !notSynced.isEmpty) {
      SectionCard("On this register, not synced yet", Modifier.fillMaxWidth().testTag("day-totals-not-synced")) {
        if (notSynced.cashCount > 0) AmountRow("Cash (${notSynced.cashCount})", m(notSynced.cashCents))
        if (notSynced.cardCount > 0) AmountRow("Cards to charge (${notSynced.cardCount})", m(notSynced.cardCents))
        Text(
          "Added to the totals when the register is back online.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
    when (val state = model.state) {
      is Load.Loading -> Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator()
        Text("Adding up every register…", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      is Load.Failed -> NoticeBanner(state.message, StatusTone.ERROR, action = { TextButton(onClick = { scope.launch { model.load() } }) { Text("Try again") } })
      is Load.Ready -> DayReportSections(state.value, ::m)
    }
  }

  if (picking) {
    val range = rememberDateRangePickerState()
    DatePickerDialog(
      onDismissRequest = { picking = false },
      confirmButton = {
        TextButton(
          onClick = {
            val start = range.selectedStartDateMillis
            picking = false
            if (start != null) scope.launch { model.pick(utcDayKey(start), utcDayKey(range.selectedEndDateMillis ?: start)) }
          },
          modifier = Modifier.testTag("day-totals-pick-done"),
        ) { Text("Show") }
      },
      dismissButton = { TextButton(onClick = { picking = false }) { Text("Cancel") } },
    ) { DateRangePicker(range) }
  }
}

@Composable
private fun DayReportSections(report: PosDayReport, money: (Long) -> String) {
  if (report.truncated == true) {
    NoticeBanner("These days had more activity than one report reads; the figures are partial. Choose fewer days.", StatusTone.WARNING)
  }
  if (posDayReportIsEmpty(report)) {
    Text(
      "No register sales, returns or shifts on these days.",
      Modifier.testTag("day-totals-empty"),
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    return
  }
  posDayReportSections(report, money).forEach { section ->
    SectionCard(section.title, Modifier.fillMaxWidth()) {
      section.rows.forEach { AmountRow(it.label, it.value, emphasized = it.strong) }
    }
  }
  if (report.shifts.isNotEmpty()) {
    SectionCard("Shifts", Modifier.fillMaxWidth()) {
      report.shifts.forEach { shift ->
        Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          AmountRow(shift.registerName, money(shift.netSalesCents.toLong()))
          Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
            val opened = formatReceiptTime(shift.openedAtMs.toLong(), report.timeZone)
            val closed = shift.closedAtMs?.let { formatReceiptTime(it.toLong(), report.timeZone) }
            Text(
              "$opened – ${if (shift.status == PosDayShiftRowStatus.OPEN) "Open" else closed ?: "—"}",
              Modifier.weight(1f),
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val variance = shift.varianceCents
            if (variance != null) {
              StatusChip(money(variance.toLong()), if (variance == 0.0) StatusTone.SUCCESS else StatusTone.WARNING)
            } else if (shift.status == PosDayShiftRowStatus.OPEN) {
              StatusChip("Open", StatusTone.SUCCESS)
            }
          }
        }
      }
    }
  }
}
