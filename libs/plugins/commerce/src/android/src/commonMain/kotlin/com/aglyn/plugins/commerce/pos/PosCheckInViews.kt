package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.CheckInRow
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.checkInItemLabel
import com.aglyn.pluginhost.LocalSlotParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.PanelSheet
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/*
 * CHECK-IN AT THE WINDOW (AGL-4063): the register's check-in sheet and the `posCheckIn` zone. The console's `PosCheckInDialog`,
 * in its words; the Apple app's `PosCheckInViews.swift`.
 */

/** The register's own plugin context, for the zones it draws inside its panels (the customer panel's check-in zone). */
val LocalPosPluginContext = staticCompositionLocalOf<NativePluginContext?> { null }

/** The zone other plugins draw in for one customer on one day: a status the customer needs, or a button for its own flow. */
const val COMMERCE_POS_CHECK_IN_SLOT = "posCheckIn"

@Composable
fun PosCheckInZone(params: Map<String, String>) {
  val context = LocalPosPluginContext.current ?: return
  val widgets = context.slotWidgets(COMMERCE_POS_CHECK_IN_SLOT)
  if (widgets.isEmpty()) return
  CompositionLocalProvider(LocalSlotParams provides params) {
    Column(Modifier.fillMaxWidth().testTag("pos-check-in-zone-${params["placement"].orEmpty()}"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
      for (widget in widgets) key(widget.id) { widget.content(context) }
    }
  }
}

/**
 * Check-in at the window: find the customer, see what their passes, camping and stays cover today, and check each person in
 * with an optional wristband number and color. Opens on one customer when the register's customer panel names them.
 */
@Composable
fun PosCheckInDialog(model: PosCheckInModel, hostId: String, initial: PosCheckInTarget? = null, onDismiss: () -> Unit) {
  val scope = rememberCoroutineScope()
  LaunchedEffect(initial) { if (initial != null && !initial.isEmpty) model.open(initial) }
  val customer = model.customer
  PanelSheet(
    title = model.title,
    onDismiss = onDismiss,
    modifier = Modifier.testTag("pos-check-in"),
    closeLabel = "Done",
    action = {
      if (customer != null) TextButton(onClick = model::backToSearch, modifier = Modifier.testTag("pos-check-in-back")) { Text("Back to search") }
      val waiting = model.waiting
      if (customer != null && waiting.size > 1) {
        Button(onClick = { scope.launch { model.checkIn(waiting) } }, enabled = !model.busy, modifier = Modifier.testTag("pos-check-in-all")) {
          Text("Check in all ${waiting.size}")
        }
      }
    },
  ) {
    if (customer != null) {
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        customer.email?.takeIf { it.isNotEmpty() }?.let {
          Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.align(Alignment.CenterVertically))
        }
        StatusChip(
          "${model.checkedInCount} of ${model.rows.size} checked in",
          if (model.rows.isNotEmpty() && model.waiting.isEmpty()) StatusTone.SUCCESS else StatusTone.NEUTRAL,
        )
      }
      model.day?.let { day ->
        PosCheckInZone(posCheckInZoneParams(hostId, customer.contactId, customer.email, day.dayKey, customer.name, model.rows.size, "check-in-customer"))
      }
      model.rows.forEachIndexed { index, row ->
        if (index > 0) HorizontalDivider()
        key(row.id) { CheckInRowView(model, row) }
      }
    } else {
      OutlinedTextField(
        value = model.text,
        onValueChange = model::type,
        label = { Text("Find a customer") },
        placeholder = { Text("Name, email, phone or order number") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("pos-check-in-search"),
      )
      when {
        model.customers.isNotEmpty() -> model.customers.forEach { one ->
          key(one.customerKey) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
              Column(
                Modifier.fillMaxWidth().heightIn(min = 48.dp)
                  .clickable { scope.launch { model.open(PosCheckInTarget(customerKey = one.customerKey)) } }
                  .testTag("pos-check-in-customer-${one.customerKey.orEmpty()}"),
              ) {
                Text(listOfNotNull(one.name, one.email).firstOrNull { it.isNotEmpty() } ?: "Customer", style = MaterialTheme.typography.bodyLarge)
                Text(checkInCustomerLine(one), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
              model.day?.let { day ->
                PosCheckInZone(posCheckInZoneParams(hostId, one.contactId, one.email, day.dayKey, one.name, one.unitsDue?.toInt() ?: 0, "check-in-row"))
              }
            }
          }
        }
        model.searched -> Text(
          "Nobody with that name, email, phone or order number has anything to check in today.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        else -> Text(
          "Passes, camping and stays bought online or at the register show up here on the day they are for.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
    if (model.notice.isNotEmpty()) NoticeBanner(model.notice, StatusTone.INFO)
    if (model.error.isNotEmpty()) NoticeBanner(model.error, StatusTone.WARNING)
  }
}

@Composable
private fun CheckInRowView(model: PosCheckInModel, row: CheckInRow) {
  val scope = rememberCoroutineScope()
  Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Column {
      Text(checkInItemLabel(row.record), style = MaterialTheme.typography.bodyLarge)
      model.detail(row).takeIf { it.isNotEmpty() }?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    if (row.checkedIn) {
      TextButton(onClick = { scope.launch { model.undo(row) } }, enabled = !model.busy, modifier = Modifier.testTag("pos-check-in-undo-${row.id}")) { Text("Undo") }
    } else {
      val draft = model.drafts[row.id] ?: PosWristbandDraft()
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(
          value = draft.number,
          onValueChange = { model.drafts[row.id] = draft.copy(number = it.take(Contracts.checkInWristbandMax.toInt())) },
          label = { Text("Wristband number") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
          modifier = Modifier.widthIn(min = 160.dp, max = 240.dp).testTag("pos-check-in-band-${row.id}"),
        )
        SelectField(
          label = "Color",
          options = Contracts.checkInWristbandColors.map { SelectOption(it, it) },
          selected = draft.color.ifEmpty { null },
          onSelect = { model.drafts[row.id] = draft.copy(color = it.orEmpty()) },
          noneLabel = "None",
          modifier = Modifier.widthIn(min = 160.dp, max = 220.dp).testTag("pos-check-in-color-${row.id}"),
        )
        Button(
          onClick = { scope.launch { model.checkIn(listOf(row)) } },
          enabled = !model.busy,
          modifier = Modifier.heightIn(min = 56.dp).align(Alignment.CenterVertically).testTag("pos-check-in-${row.id}"),
        ) { Text("Check in") }
      }
    }
  }
}

/**
 * What the attached customer has to check in today, as the console's customer panel shows it: "Check in (2)" while anyone waits,
 * and the `posCheckIn` zone on a day they have anything due.
 */
@Composable
internal fun AttachedCustomerCheckIn(model: RegisterModel, customer: PosCustomer) {
  val due = model.checkInDue
  var open by remember { mutableStateOf<PosCheckInModel?>(null) }
  val scope = rememberCoroutineScope()
  LaunchedEffect(customer) { due.load(customer) }
  Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
    if (due.waiting > 0) {
      OutlinedButton(onClick = { open = model.makeCheckIn() }, modifier = Modifier.testTag("pos-customer-check-in")) { Text("Check in (${due.waiting})") }
    }
  }
  due.dayKey?.let { dayKey ->
    PosCheckInZone(
      posCheckInZoneParams(model.hostId, customer.id.takeIf { customer.kind == "contact" }, customer.email, dayKey, customer.name, due.total, "register-customer"),
    )
  }
  open?.let { sheet ->
    PosCheckInDialog(sheet, model.hostId, checkInTarget(customer)) {
      open = null
      scope.launch { due.load(customer) }
    }
  }
}
