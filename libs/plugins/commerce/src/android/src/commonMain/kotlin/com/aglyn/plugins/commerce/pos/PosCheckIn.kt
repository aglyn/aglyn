package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.CheckInCustomer
import com.aglyn.contracts.CheckInRainCheckKind
import com.aglyn.contracts.CheckInRow
import com.aglyn.contracts.CheckInStatus
import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.HostCheckInSource
import com.aglyn.contracts.alreadyCheckedInLabel
import com.aglyn.contracts.checkInItemLabel
import com.aglyn.contracts.checkInRainCheckIsOpen
import com.aglyn.contracts.describeWristband
import com.aglyn.contracts.rainCheckLabel
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.SlotWidgets
import com.aglyn.plugins.commerce.orders.RainCheckSheet
import com.aglyn.plugins.commerce.orders.ReservationGuestsSheet
import com.aglyn.plugins.commerce.orders.checkInTimeLabel
import com.aglyn.plugins.commerce.orders.checkInTodayKey
import com.aglyn.plugins.commerce.orders.posCheckInBody
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.PanelSheet
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/*
 * CHECK-IN AT THE WINDOW (AGL-4043), as the console's PosCheckInDialog has it at the register: find the customer by
 * name, email, phone or order number, see what their passes, camping and stays cover today, and check each person in
 * with an optional wristband number and color. One already checked in says when and by whom, with an undo. The register
 * and its cashier ride every write, so a PIN's cashier is who checked them in. The route (`POS_CHECK_IN_ROUTE`) does
 * the work. The Apple kit's PosCheckIn.swift.
 */

/** The register's check-in zone (`POS_CHECK_IN_ZONE`): another plugin's status or flow for one customer on one day. */
const val POS_CHECK_IN_ZONE = "posCheckIn"

/** What the zone hands a widget, as the console's `PosCheckInZone` does. */
private fun checkInZoneProps(
  context: NativePluginContext, hostId: String, customer: CheckInCustomer, dayKey: String, unitsDue: Int, placement: String,
): Map<String, String> = buildMap {
  put("hostId", hostId)
  context.orgId?.let { put("orgId", it) }
  customer.contactId?.ifEmpty { null }?.let { put("contactId", it) }
  customer.email?.ifEmpty { null }?.let { put("email", it.lowercase()) }
  put("dayKey", dayKey)
  customer.name?.ifEmpty { null }?.let { put("name", it) }
  put("unitsDue", unitsDue.toString())
  put("placement", placement)
}

/** How long typing pauses before the register asks. */
private const val SEARCH_DEBOUNCE_MS = 250L

/** The customer to open on, as the register's customer panel names them. */
data class PosCheckInTarget(val customerKey: String? = null, val email: String? = null, val contactId: String? = null) {
  val isEmpty: Boolean get() = customerKey.isNullOrEmpty() && email.isNullOrEmpty() && contactId.isNullOrEmpty()
}

private data class WristbandDraft(val number: String = "", val color: String = "")

private fun JsonElement?.field(key: String): JsonElement? = (this as? JsonObject)?.get(key)
private fun JsonElement?.text(key: String): String? = (field(key) as? JsonPrimitive)?.contentOrNull

private fun customerOf(element: JsonElement?): CheckInCustomer? =
  (element as? JsonObject)?.let { runCatching { ContractJsonFormat.decodeFromJsonElement(CheckInCustomer.serializer(), it) }.getOrNull() }

private fun rowsOf(element: JsonElement?): List<CheckInRow> = (element as? JsonArray)?.mapNotNull(CheckInRow::from).orEmpty()

private fun refusalOf(failure: Throwable, fallback: String): String =
  ((failure as? ConsoleApiError)?.body as? JsonObject)?.let { (it["error"] as? JsonPrimitive)?.contentOrNull } ?: fallback

/** The check-in panel at the register; [initial] opens straight on one customer rather than on the search. */
@Composable
fun PosCheckInPanel(
  context: NativePluginContext,
  hostId: String,
  registerId: String?,
  cashierAssertion: () -> String?,
  initial: PosCheckInTarget? = null,
  onDismiss: () -> Unit,
) {
  val scope = rememberCoroutineScope()
  var text by remember { mutableStateOf("") }
  var customers by remember { mutableStateOf<List<CheckInCustomer>>(emptyList()) }
  var searched by remember { mutableStateOf(false) }
  var dayKey by remember { mutableStateOf("") }
  var timeZone by remember { mutableStateOf("UTC") }
  var customer by remember { mutableStateOf<CheckInCustomer?>(null) }
  var rows by remember { mutableStateOf<List<CheckInRow>>(emptyList()) }
  val drafts = remember { mutableStateMapOf<String, WristbandDraft>() }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var notice by remember { mutableStateOf<String?>(null) }
  var rainCheckRow by remember { mutableStateOf<CheckInRow?>(null) }
  var guestsFor by remember { mutableStateOf<String?>(null) }

  /** The register and its cashier, on every write. */
  fun staffFields(): Map<String, Any?> = mapOf("registerId" to registerId, "cashierAssertion" to cashierAssertion())

  suspend fun post(fields: Map<String, Any?>, idempotencyKey: String? = null): JsonElement? =
    context.api.request(Contracts.posCheckInRoute, ApiMethod.POST, posCheckInBody(hostId, fields), idempotencyKey = idempotencyKey)

  fun readDay(answer: JsonElement?) {
    answer.text("dayKey")?.let { dayKey = it }
    answer.text("timeZone")?.let { timeZone = it }
  }

  fun openCustomer(target: PosCheckInTarget) {
    busy = true
    error = null
    notice = null
    scope.launch {
      try {
        val answer = post(mapOf("action" to "customer", "customerKey" to target.customerKey, "email" to target.email, "contactId" to target.contactId))
        readDay(answer)
        customer = customerOf(answer.field("customer"))
        rows = rowsOf(answer.field("checkIns"))
        drafts.clear()
        if (rows.isEmpty()) notice = "Nothing to check in today for this customer."
      } catch (failure: Throwable) {
        if (failure is kotlinx.coroutines.CancellationException) throw failure
        error = refusalOf(failure, "That customer could not be opened.")
      } finally {
        busy = false
      }
    }
  }

  LaunchedEffect(Unit) { initial?.takeUnless { it.isEmpty }?.let(::openCustomer) }

  LaunchedEffect(text) {
    val typed = text.trim()
    if (typed.length < 2) {
      customers = emptyList()
      searched = false
      return@LaunchedEffect
    }
    delay(SEARCH_DEBOUNCE_MS)
    try {
      val answer = post(mapOf("action" to "search", "text" to typed))
      error = null
      readDay(answer)
      customers = (answer.field("customers") as? JsonArray)?.mapNotNull(::customerOf).orEmpty()
      searched = true
    } catch (failure: Throwable) {
      if (failure is kotlinx.coroutines.CancellationException) throw failure
      error = refusalOf(failure, "The search did not run.")
    }
  }

  fun merge(changed: List<CheckInRow>) {
    val byId = changed.associateBy { it.id }
    rows = rows.map { byId[it.id] ?: it }
  }

  fun checkIn(targets: List<CheckInRow>) {
    if (targets.isEmpty()) return
    busy = true
    error = null
    notice = null
    scope.launch {
      try {
        val entries = JsonArray(
          targets.map { row ->
            val draft = drafts[row.id]
            val fields = buildMap<String, JsonElement> {
              put("id", JsonPrimitive(row.id))
              if (draft != null && (draft.number.isNotBlank() || draft.color.isNotEmpty())) {
                put("wristband", JsonObject(mapOf("number" to JsonPrimitive(draft.number.trim()), "color" to JsonPrimitive(draft.color))))
              }
            }
            JsonObject(fields)
          },
        )
        // The window's day: an open rain check checked in is used on it.
        val answer = post(mapOf("action" to "check_in", "checkIns" to entries, "day" to dayKey.ifEmpty { null }) + staffFields(), newAttemptKey())
        val already = rowsOf(answer.field("alreadyCheckedIn"))
        merge(rowsOf(answer.field("checkedIn")) + already)
        already.firstOrNull()?.let { notice = alreadyCheckedInLabel(checkInTimeLabel(it.checkIn.checkedInAtMs, timeZone), it.checkIn.checkedInByName) }
      } catch (failure: Throwable) {
        if (failure is kotlinx.coroutines.CancellationException) throw failure
        error = refusalOf(failure, "They could not be checked in.")
      } finally {
        busy = false
      }
    }
  }

  fun undo(row: CheckInRow, action: String, refused: String) {
    busy = true
    error = null
    notice = null
    scope.launch {
      try {
        val changed = CheckInRow.from(post(mapOf("action" to action, "id" to row.id) + staffFields()).field("checkIn"))
        if (changed == null) error = refused else merge(listOf(changed))
      } catch (failure: Throwable) {
        if (failure is kotlinx.coroutines.CancellationException) throw failure
        error = refusalOf(failure, refused)
      } finally {
        busy = false
      }
    }
  }

  /** A pass a dated rain check moved off the window's day: not to check in today. */
  fun movedAway(row: CheckInRow) =
    row.checkIn.status == CheckInStatus.EXPECTED && row.checkIn.rainCheck?.kind == CheckInRainCheckKind.DATE && row.checkIn.dayKey != dayKey
  // "Check in all" leaves rain checks alone: an open one is used one at a time.
  val waiting = rows.filter { it.checkIn.status == CheckInStatus.EXPECTED && !movedAway(it) && !checkInRainCheckIsOpen(it.checkIn) }
  val todayKey = if (dayKey.isNotEmpty()) checkInTodayKey(timeZone) else ""
  val shown = customer

  PanelSheet(
    title = shown?.let { it.name?.ifEmpty { null } ?: it.email ?: "Customer" } ?: "Check in",
    onDismiss = onDismiss,
    modifier = Modifier.testTag("pos-check-in"),
    closeLabel = "Done",
    action = if (shown != null && waiting.size > 1) {
      { Button(onClick = { checkIn(waiting) }, enabled = !busy, modifier = Modifier.testTag("pos-check-in-all")) { Text("Check in all ${waiting.size}") } }
    } else {
      null
    },
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(2f))) {
      if (shown != null) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          shown.email?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
          StatusChip(
            "${rows.count { it.checkIn.status == CheckInStatus.CHECKED_IN }} of ${rows.size} checked in",
            if (rows.isNotEmpty() && waiting.isEmpty()) StatusTone.SUCCESS else StatusTone.NEUTRAL,
          )
          if (dayKey.isNotEmpty()) {
            SlotWidgets(context, POS_CHECK_IN_ZONE, props = checkInZoneProps(context, hostId, shown, dayKey, rows.size, "check-in-customer"))
          }
          TextButton(
            onClick = { customer = null; rows = emptyList(); notice = null },
            modifier = Modifier.testTag("pos-check-in-back"),
          ) { Text("Back to search") }
        }
        Column(Modifier.fillMaxWidth()) {
          rows.forEachIndexed { index, row ->
            if (index > 0) HorizontalDivider()
            PosCheckInRow(
              row, timeZone, busy, movedAway(row), todayKey.isNotEmpty(), drafts[row.id] ?: WristbandDraft(),
              onDraft = { drafts[row.id] = it },
              onCheckIn = { checkIn(listOf(row)) },
              onUndo = { undo(row, "undo", "The check-in could not be undone.") },
              onUndoRainCheck = { undo(row, "undo_rain_check", "The rain check could not be undone.") },
              onRainCheck = { rainCheckRow = row },
              onGuests = { guestsFor = it },
            )
          }
        }
      } else {
        OutlinedTextField(
          text, { text = it },
          label = { Text("Find a customer") },
          placeholder = { Text("Name, email, phone or order number") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth().testTag("pos-check-in-search"),
        )
        when {
          customers.isNotEmpty() -> Column(Modifier.fillMaxWidth()) {
            customers.forEachIndexed { index, one ->
              if (index > 0) HorizontalDivider()
              Column(
                Modifier.fillMaxWidth().clickable { openCustomer(PosCheckInTarget(customerKey = one.customerKey)) }
                  .padding(vertical = space(1.5f)).testTag("pos-check-in-customer-${one.customerKey}"),
              ) {
                Text(one.name?.ifEmpty { null } ?: one.email ?: "Customer", style = MaterialTheme.typography.titleSmall)
                Text(
                  listOfNotNull(
                    "${one.unitsCheckedIn.toInt()} of ${one.unitsDue.toInt()} checked in",
                    one.items.joinToString(", ").ifEmpty { null },
                    one.email, one.phone,
                  ).joinToString(" · "),
                  style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (dayKey.isNotEmpty()) {
                  SlotWidgets(context, POS_CHECK_IN_ZONE, props = checkInZoneProps(context, hostId, one, dayKey, one.unitsDue.toInt(), "check-in-row"))
                }
              }
            }
          }
          searched -> Text("Nobody with that name, email, phone or order number has anything to check in today.", color = MaterialTheme.colorScheme.onSurfaceVariant)
          else -> Text("Passes, camping and stays bought online or at the register show up here on the day they are for.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      notice?.let { NoticeBanner(it, StatusTone.INFO) }
      error?.let { NoticeBanner(it, StatusTone.WARNING) }
    }
  }

  rainCheckRow?.let { row ->
    RainCheckSheet(context, hostId, row, todayKey, onClose = { rainCheckRow = null }, extraFields = staffFields()) {
      rainCheckRow = null
      shown?.let { openCustomer(PosCheckInTarget(customerKey = it.customerKey)) }
    }
  }
  guestsFor?.let { reservationId ->
    ReservationGuestsSheet(context, hostId, reservationId, onClose = { guestsFor = null }) {
      guestsFor = null
      // The stay's check-ins may have changed: read the customer again.
      shown?.let { openCustomer(PosCheckInTarget(customerKey = it.customerKey)) }
    }
  }
}

@Composable
private fun PosCheckInRow(
  row: CheckInRow,
  timeZone: String,
  busy: Boolean,
  movedAway: Boolean,
  hasToday: Boolean,
  draft: WristbandDraft,
  onDraft: (WristbandDraft) -> Unit,
  onCheckIn: () -> Unit,
  onUndo: () -> Unit,
  onUndoRainCheck: () -> Unit,
  onRainCheck: () -> Unit,
  onGuests: (String) -> Unit,
) {
  val checkIn = row.checkIn
  val stay = checkIn.reservationId?.takeIf { checkIn.source == HostCheckInSource.RESERVATION }
  Column(Modifier.fillMaxWidth().padding(vertical = space(1.5f)).testTag("pos-check-in-row-${row.id}"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text(checkInItemLabel(checkIn), style = MaterialTheme.typography.titleSmall)
    val first = if (checkIn.status == CheckInStatus.CHECKED_IN) {
      listOf(
        "Checked in at ${checkInTimeLabel(checkIn.checkedInAtMs, timeZone)}" + (checkIn.checkedInByName?.ifEmpty { null }?.let { " by $it" } ?: ""),
        describeWristband(checkIn.wristband),
      ).filter { it.isNotEmpty() }.joinToString(" · ")
    } else {
      checkIn.orderLabel ?: if (checkIn.source == HostCheckInSource.RESERVATION) "Stay" else ""
    }
    val secondary = listOf(first, rainCheckLabel(checkIn)).filter { it.isNotEmpty() }.joinToString(" · ")
    if (secondary.isNotEmpty()) Text(secondary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    when {
      checkIn.status == CheckInStatus.CHECKED_IN -> Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        TextButton(onClick = onUndo, enabled = !busy, modifier = Modifier.testTag("pos-check-in-undo-${row.id}")) { Text("Undo") }
        stay?.let { TextButton(onClick = { onGuests(it) }, enabled = !busy) { Text("Guests") } }
      }
      movedAway -> TextButton(onClick = onUndoRainCheck, enabled = !busy) { Text("Undo rain check") }
      else -> FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(
          draft.number, { onDraft(draft.copy(number = it.take(Contracts.checkInWristbandMax.toInt()))) },
          label = { Text("Wristband number") }, singleLine = true,
          modifier = Modifier.widthIn(min = 160.dp, max = 220.dp).testTag("pos-check-in-wristband-${row.id}"),
        )
        SelectField(
          "Color", Contracts.checkInWristbandColors.map { SelectOption(it, it) }, draft.color.ifEmpty { null },
          { onDraft(draft.copy(color = it.orEmpty())) },
          modifier = Modifier.widthIn(min = 140.dp, max = 200.dp).testTag("pos-check-in-color-${row.id}"), noneLabel = "None",
        )
        Button(onClick = onCheckIn, enabled = !busy, modifier = Modifier.align(Alignment.CenterVertically).testTag("pos-check-in-one-${row.id}")) { Text("Check in") }
        stay?.let { TextButton(onClick = { onGuests(it) }, enabled = !busy, modifier = Modifier.align(Alignment.CenterVertically)) { Text("Guests") } }
        if (checkIn.source == HostCheckInSource.ORDER) {
          if (checkIn.rainCheck != null) {
            TextButton(onClick = onUndoRainCheck, enabled = !busy, modifier = Modifier.align(Alignment.CenterVertically)) { Text("Undo rain check") }
          } else {
            TextButton(onClick = onRainCheck, enabled = !busy && hasToday, modifier = Modifier.align(Alignment.CenterVertically).testTag("pos-check-in-rain-check-${row.id}")) { Text("Rain check") }
          }
        }
      }
    }
  }
}
