package com.aglyn.plugins.commerce.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.CheckInDayTotals
import com.aglyn.contracts.CheckInRow
import com.aglyn.contracts.CheckInStatus
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.HostCheckInSource
import com.aglyn.contracts.STAY_CHECK_IN_MODE_LABELS
import com.aglyn.contracts.checkInDayKeyMillis
import com.aglyn.contracts.checkInDayKeyOfMillis
import com.aglyn.contracts.checkInDayLabel
import com.aglyn.contracts.checkInDayTotals
import com.aglyn.contracts.checkInItemLabel
import com.aglyn.contracts.checkInRainCheckIsOpen
import com.aglyn.contracts.checkInStatusLabel
import com.aglyn.contracts.describeWristband
import com.aglyn.contracts.formatLocalDay
import com.aglyn.contracts.rainCheckLabel
import com.aglyn.contracts.reservationGuests
import com.aglyn.contracts.reservationGuestsProblem
import com.aglyn.contracts.resourceGuestCeiling
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.nowMillis
import com.aglyn.hardware.PrintableDocument
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.rememberMemberPermissions
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.ChoiceRow
import com.aglyn.ui.DateField
import com.aglyn.ui.FormSheet
import com.aglyn.ui.LocalFileExporter
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.StatTile
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * TODAY'S CHECK-INS (AGL-4043), as the console's PosCheckInsCard has it on the Orders page: who is due at the window on
 * a day, who has checked in, the stays setting, and each pass's rain check. The route (`POS_CHECK_IN_ROUTE`) reads the day
 * (reconciling it first) and does every write; this pane only lists and asks. A row heads the orders list beside Day
 * report for a store with registers. The Apple kit's CheckIns.swift.
 */

const val ORDERS_CHECK_INS_ROW = "report.check-ins"
private const val CHECK_INS_TITLE = "Today's check-ins"
private const val MANAGE_POS = "managePos"

/** A day's list, as the route reads it. */
data class CheckInDayList(
  val dayKey: String,
  val timeZone: String,
  val totals: CheckInDayTotals,
  val rows: List<CheckInRow>,
  val truncated: Boolean,
  val stayCheckIn: String,
)

private fun JsonObject.text(key: String) = (this[key] as? JsonPrimitive)?.contentOrNull

fun checkInDayListFrom(element: JsonElement?): CheckInDayList? {
  val json = element as? JsonObject ?: return null
  val rows = (json["checkIns"] as? JsonArray ?: return null).mapNotNull(CheckInRow::from)
  val totals = json["totals"] as? JsonObject
  fun count(key: String) = (totals?.get(key) as? JsonPrimitive)?.doubleOrNull
  return CheckInDayList(
    dayKey = json.text("dayKey").orEmpty(),
    timeZone = json.text("timeZone") ?: "UTC",
    totals = if (totals != null) CheckInDayTotals(count("checkedIn") ?: 0.0, count("expected") ?: 0.0, count("rainChecks") ?: 0.0) else checkInDayTotals(rows.map { it.checkIn }),
    rows = rows,
    truncated = (json["truncated"] as? JsonPrimitive)?.booleanOrNull == true,
    stayCheckIn = json.text("stayCheckIn") ?: "resource",
  )
}

/** A check-in's time on the store's clock, "9:05 AM" (`checkInTimeLabel`). */
fun checkInTimeLabel(ms: Double?, timeZone: String): String =
  if (ms == null || ms == 0.0) "" else runCatching { formatLocalDay(ms.toLong(), "h:mm a", timeZone) }.getOrElse { formatLocalDay(ms.toLong(), "h:mm a") }

/** Today on the store's calendar. */
fun checkInTodayKey(timeZone: String): String = formatLocalDay(nowMillis(), "yyyy-MM-dd", timeZone)

private fun esc(text: String) = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

/** The day's list as the console prints it (`posCheckInsDocument`): markup the system print sheet lays out. */
fun checkInsPrintDocument(list: CheckInDayList): String {
  val rows = list.rows.joinToString("") { row ->
    val checkIn = row.checkIn
    val right = when {
      checkIn.status == CheckInStatus.CHECKED_IN -> listOf(checkInTimeLabel(checkIn.checkedInAtMs, list.timeZone), describeWristband(checkIn.wristband)).filter { it.isNotEmpty() }.joinToString(" ")
      checkInRainCheckIsOpen(checkIn) -> "Rain check"
      else -> "—"
    }
    "<p>${esc("${checkIn.customerName ?: checkIn.customerEmail ?: "Customer"} · ${checkInItemLabel(checkIn)}")} — ${esc(right)}</p>"
  }
  return "<h2>CHECK-INS</h2><p>${esc(list.dayKey)} · ${list.totals.checkedIn.toInt()} of ${list.totals.expected.toInt()} checked in</p><hr>$rows"
}

/** Today's check-ins, for the Orders detail pane. */
@Composable
fun CheckInsPane(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val exporter = LocalFileExporter.current
  val printer = context.peripherals.systemPrinter
  val canManagePos = rememberMemberPermissions(context).can(MANAGE_POS)
  var day by remember { mutableStateOf("") }
  var list by remember { mutableStateOf<CheckInDayList?>(null) }
  var loading by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var actionError by remember { mutableStateOf<String?>(null) }
  var savingStayMode by remember { mutableStateOf(false) }
  var rainCheckRow by remember { mutableStateOf<CheckInRow?>(null) }
  var guestsFor by remember { mutableStateOf<String?>(null) }
  var exportFailed by remember { mutableStateOf(false) }
  var reloads by remember { mutableStateOf(0) }

  LaunchedEffect(hostId, day, reloads, canManagePos) {
    if (!canManagePos) return@LaunchedEffect
    loading = true
    try {
      val answer = context.api.request(POS_CHECK_IN_PATH, ApiMethod.GET, query = buildMap { put("hostId", hostId); if (day.isNotEmpty()) put("day", day) })
      val read = checkInDayListFrom(answer)
      list = read
      error = if (read == null) "The check-ins could not be read." else null
    } catch (failure: Throwable) {
      if (failure is kotlinx.coroutines.CancellationException) throw failure
      error = ((failure as? ConsoleApiError)?.body as? JsonObject)?.text("error") ?: "The check-ins could not be read. Check the connection."
    } finally {
      loading = false
    }
  }
  fun reload() { reloads += 1 }

  fun post(fields: Map<String, Any?>, refused: String) {
    actionError = null
    scope.launch {
      try {
        context.api.request(POS_CHECK_IN_PATH, ApiMethod.POST, posCheckInBody(hostId, fields))
        reload()
      } catch (failure: Throwable) {
        if (failure is kotlinx.coroutines.CancellationException) throw failure
        actionError = ((failure as? ConsoleApiError)?.body as? JsonObject)?.text("error") ?: refused
      } finally {
        savingStayMode = false
      }
    }
  }

  val current = list
  val todayKey = current?.let { checkInTodayKey(it.timeZone) }.orEmpty()
  Column(
    Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("check-ins-pane"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      Text(CHECK_INS_TITLE, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
      TextButton(onClick = ::reload, enabled = canManagePos && !loading, modifier = Modifier.testTag("check-ins-refresh")) { Text("Refresh") }
      if (exporter != null) {
        TextButton(
          onClick = {
            val shown = current ?: return@TextButton
            scope.launch {
              exportFailed = false
              val csv = runCatching {
                context.api.download(POS_CHECK_IN_PATH, method = ApiMethod.GET, query = mapOf("hostId" to hostId, "day" to shown.dayKey, "format" to "csv"))
              }.getOrNull()
              exportFailed = csv == null || !exporter.export("check-ins-${shown.dayKey}.csv", "text/csv", csv.bytes)
            }
          },
          enabled = current != null,
          modifier = Modifier.testTag("check-ins-export"),
        ) { Text("Export CSV") }
      }
      if (printer != null) {
        TextButton(
          onClick = { current?.let { shown -> scope.launch { printer.printDocument(PrintableDocument.Html(checkInsPrintDocument(shown)), "Check-ins ${shown.dayKey}") } } },
          enabled = current != null,
          modifier = Modifier.testTag("check-ins-print"),
        ) { Text("Print") }
      }
    }
    if (!canManagePos) {
      NoticeBanner("Check-ins take the \"Use the point of sale\" permission, which site admins and editors hold by default.", StatusTone.INFO)
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
      DateField(
        "Day", day.ifEmpty { current?.dayKey.orEmpty() }, { day = it },
        toMillis = ::checkInDayKeyMillis, fromMillis = ::checkInDayKeyOfMillis,
        modifier = Modifier.widthIn(max = 260.dp).testTag("check-ins-day"), enabled = canManagePos,
      )
      TextButton(onClick = { day = "" }, enabled = canManagePos && day.isNotEmpty()) { Text("Today") }
    }
    Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
      Text("Stays at check-in", style = MaterialTheme.typography.titleSmall)
      ChoiceChipRow(
        STAY_CHECK_IN_MODE_LABELS.map { (mode, label) -> ChipOption(mode, label) },
        current?.stayCheckIn ?: "resource",
        { mode ->
          if (canManagePos && current != null && !savingStayMode && mode != current.stayCheckIn) {
            savingStayMode = true
            post(mapOf("action" to "stay_mode", "mode" to mode, "day" to day.ifEmpty { null }), "The setting could not be saved.")
          }
        },
        Modifier.testTag("check-ins-stay-mode"),
        wrap = true,
      )
      Text(
        "One per guest gives each guest of a stay their own check-in and wristband, by the stay’s guest count.",
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
    if (loading) Text("Reading who is due…", color = MaterialTheme.colorScheme.onSurfaceVariant)
    error?.let { NoticeBanner(it, StatusTone.WARNING) }
    if (current != null) {
      Text("${current.dayKey} · ${current.timeZone} · passes and stays that need check-in", color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (current.truncated) NoticeBanner("This day has more check-ins than one list reads; some are missing here.", StatusTone.WARNING)
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1.5f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
        val totals = current.totals
        StatTile("Expected", totals.expected.toInt().toString(), Modifier.widthIn(min = 120.dp))
        StatTile("Checked in", totals.checkedIn.toInt().toString(), Modifier.widthIn(min = 120.dp))
        StatTile("Still to come", (totals.expected - totals.checkedIn).toInt().toString(), Modifier.widthIn(min = 120.dp))
        if (totals.rainChecks > 0) StatTile("Rain checks", totals.rainChecks.toInt().toString(), Modifier.widthIn(min = 120.dp))
      }
      actionError?.let { NoticeBanner(it, StatusTone.WARNING) }
      if (exportFailed) NoticeBanner("The spreadsheet could not be made.", StatusTone.WARNING)
      if (current.rows.isEmpty()) {
        Text("Nobody is due to check in on this day", Modifier.testTag("check-ins-empty"), color = MaterialTheme.colorScheme.onSurfaceVariant)
      } else {
        Column(Modifier.fillMaxWidth().testTag("check-ins-rows")) {
          current.rows.forEachIndexed { index, row ->
            if (index > 0) HorizontalDivider()
            CheckInDayRow(
              row, current.timeZone, canManagePos, todayKey.isNotEmpty(),
              onGuests = { guestsFor = it },
              onRainCheck = { rainCheckRow = row },
              onUndoRainCheck = { post(mapOf("action" to "undo_rain_check", "id" to row.id), "The rain check could not be undone.") },
            )
          }
        }
      }
    }
  }

  rainCheckRow?.let { row ->
    RainCheckSheet(context, hostId, row, todayKey, onClose = { rainCheckRow = null }) {
      rainCheckRow = null
      reload()
    }
  }
  guestsFor?.let { reservationId ->
    ReservationGuestsSheet(context, hostId, reservationId, onClose = { guestsFor = null }) {
      guestsFor = null
      reload()
    }
  }
}

@Composable
private fun CheckInDayRow(
  row: CheckInRow,
  timeZone: String,
  canManagePos: Boolean,
  hasToday: Boolean,
  onGuests: (String) -> Unit,
  onRainCheck: () -> Unit,
  onUndoRainCheck: () -> Unit,
) {
  val checkIn = row.checkIn
  Column(Modifier.fillMaxWidth().padding(vertical = space(1.5f)).testTag("check-in-${row.id}"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      Text(checkIn.customerName?.ifEmpty { null } ?: checkIn.customerEmail.orEmpty(), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
      when {
        checkIn.status == CheckInStatus.CHECKED_IN -> StatusChip("Checked in", StatusTone.SUCCESS)
        checkInRainCheckIsOpen(checkIn) -> StatusChip("Rain check", StatusTone.INFO)
        else -> StatusChip("Expected")
      }
    }
    val order = checkIn.orderLabel ?: if (checkIn.source == HostCheckInSource.RESERVATION) "Stay" else ""
    Text(listOf(checkInItemLabel(checkIn), order).filter { it.isNotEmpty() }.joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
    val detail = listOf(
      rainCheckLabel(checkIn),
      checkInTimeLabel(checkIn.checkedInAtMs, timeZone).ifEmpty { null }?.let { at -> "Checked in at $at" + (checkIn.checkedInByName?.ifEmpty { null }?.let { " by $it" } ?: "") }.orEmpty(),
      describeWristband(checkIn.wristband),
    ).filter { it.isNotEmpty() }
    if (detail.isNotEmpty()) Text(detail.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val reservationId = checkIn.reservationId
    when {
      checkIn.source == HostCheckInSource.RESERVATION && reservationId != null ->
        TextButton(onClick = { onGuests(reservationId) }, enabled = canManagePos, modifier = Modifier.testTag("check-in-guests-${row.id}")) { Text("Guests") }
      checkIn.source != HostCheckInSource.ORDER || checkIn.status != CheckInStatus.EXPECTED -> Unit
      checkIn.rainCheck != null ->
        TextButton(onClick = onUndoRainCheck, enabled = canManagePos, modifier = Modifier.testTag("check-in-undo-rain-check-${row.id}")) { Text("Undo rain check") }
      else ->
        TextButton(onClick = onRainCheck, enabled = canManagePos && hasToday, modifier = Modifier.testTag("check-in-rain-check-${row.id}")) { Text("Rain check") }
    }
  }
}

/** Give a pass a rain check: open, or moved to a day (the console's PosRainCheckDialog). */
@Composable
fun RainCheckSheet(context: NativePluginContext, hostId: String, row: CheckInRow, todayKey: String, onClose: () -> Unit, onDone: () -> Unit) {
  val scope = rememberCoroutineScope()
  var kind by remember(row.id) { mutableStateOf("open") }
  var newDay by remember(row.id) { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val checkIn = row.checkIn
  val dayProblem = if (kind == "date" && newDay.isNotEmpty()) com.aglyn.contracts.rainCheckProblem(checkIn, "date", newDay, todayKey) else null
  FormSheet(
    title = "Rain check",
    busy = busy,
    error = error,
    onDismiss = onClose,
    onConfirm = {
      busy = true
      error = null
      scope.launch {
        try {
          context.api.request(POS_CHECK_IN_PATH, ApiMethod.POST, posCheckInBody(hostId, mapOf("action" to "rain_check", "id" to row.id, "kind" to kind, "day" to if (kind == "date") newDay else null)))
          onDone()
        } catch (failure: Throwable) {
          if (failure is kotlinx.coroutines.CancellationException) throw failure
          error = ((failure as? ConsoleApiError)?.body as? JsonObject)?.text("error") ?: "The rain check was not given."
        } finally {
          busy = false
        }
      }
    },
    confirmLabel = "Give rain check",
    confirmEnabled = !busy && !(kind == "date" && (newDay.isEmpty() || dayProblem != null)),
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f)), modifier = Modifier.testTag("rain-check-sheet")) {
      Text(
        "${checkIn.customerName?.ifEmpty { null } ?: checkIn.customerEmail ?: "Customer"} · ${checkInItemLabel(checkIn)} · ${checkInDayLabel(checkIn.dayKey)}",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      ChoiceRow("Open: good on any later day until it is used", kind == "open", { kind = "open" }, Modifier.testTag("rain-check-open"))
      ChoiceRow("Move it to a day", kind == "date", { kind = "date" }, Modifier.testTag("rain-check-date"))
      if (kind == "date") {
        DateField(
          "New day", newDay, { newDay = it }, toMillis = ::checkInDayKeyMillis, fromMillis = ::checkInDayKeyOfMillis,
          modifier = Modifier.fillMaxWidth().testTag("rain-check-day"), supporting = dayProblem,
        )
      }
    }
  }
}

/** How many guests a stay holds (the console's ReservationGuestsDialog): check-ins follow it under one per guest. */
@Composable
fun ReservationGuestsSheet(context: NativePluginContext, hostId: String, reservationId: String, onClose: () -> Unit, onDone: () -> Unit) {
  val scope = rememberCoroutineScope()
  var loaded by remember(reservationId) { mutableStateOf<Triple<Int, Double?, String>?>(null) }
  var typed by remember(reservationId) { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(reservationId) {
    val stay = runCatching { context.firestore.get("hosts/$hostId/reservations/$reservationId") }.getOrNull()?.data.orEmpty()
    val resourceId = stay["resourceId"] as? String
    val resource = resourceId?.let { runCatching { context.firestore.get("hosts/$hostId/resources/$it") }.getOrNull()?.data }
    val guests = reservationGuests((stay["guests"] as? Number)?.toDouble())
    val label = listOfNotNull(resource?.get("name") as? String, (stay["guestName"] as? String) ?: (stay["guestEmail"] as? String)).filter { it.isNotEmpty() }.joinToString(" · ")
    loaded = Triple(guests, (resource?.get("capacity") as? Number)?.toDouble(), label)
    typed = guests.toString()
  }
  val capacity = loaded?.second
  val ceiling = capacity?.let(::resourceGuestCeiling)
  val count = typed.trim().toDoubleOrNull()
  val problem = if (typed.isBlank()) "How many guests?" else reservationGuestsProblem(count, capacity)
  FormSheet(
    title = "Guests",
    busy = busy,
    error = error,
    onDismiss = onClose,
    onConfirm = {
      if (problem != null || count == null) return@FormSheet
      busy = true
      error = null
      scope.launch {
        try {
          context.api.request(
            Contracts.reservationGuestsRoute, ApiMethod.POST,
            JsonObject(mapOf("hostId" to JsonPrimitive(hostId), "reservationId" to JsonPrimitive(reservationId), "guests" to JsonPrimitive(count.toInt()))),
          )
          onDone()
        } catch (failure: Throwable) {
          if (failure is kotlinx.coroutines.CancellationException) throw failure
          error = ((failure as? ConsoleApiError)?.body as? JsonObject)?.text("error") ?: "The guests could not be changed. Try again."
        } finally {
          busy = false
        }
      }
    },
    confirmEnabled = !busy && loaded != null && problem == null,
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f)), modifier = Modifier.testTag("guests-sheet")) {
      loaded?.third?.ifEmpty { null }?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      OutlinedTextField(
        typed, { typed = it.filter(Char::isDigit) },
        label = { Text("Guests") }, enabled = loaded != null, singleLine = true, isError = typed.isNotEmpty() && problem != null,
        supportingText = { Text(if (typed.isNotEmpty() && problem != null) problem else if (ceiling != null && capacity != null) "Up to $ceiling, what this stay sleeps" else "At least 1") },
        modifier = Modifier.fillMaxWidth().testTag("guests-count"),
      )
      Text(
        "When the stay is checked in one guest at a time, today’s check-ins follow: an added guest gets their own, and a guest already checked in stays.",
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}

internal val POS_CHECK_IN_PATH: String get() = Contracts.posCheckInRoute

/** The route's POST body: the site and the fields, nulls left out. */
internal fun posCheckInBody(hostId: String, fields: Map<String, Any?>): JsonObject =
  JsonObject(
    (mapOf("hostId" to hostId) + fields).filterValues { it != null }.mapValues { (_, value) ->
      when (value) {
        is JsonElement -> value
        is Number -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        else -> JsonPrimitive(value.toString())
      }
    },
  )
