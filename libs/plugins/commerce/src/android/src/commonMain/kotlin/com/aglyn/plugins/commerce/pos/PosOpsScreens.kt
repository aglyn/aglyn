package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.PosCashEventType
import com.aglyn.contracts.PosShift
import com.aglyn.contracts.PosShiftReport
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AmountRow
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

/*
 * THE REGISTER'S OPERATIONS (AGL-3609): who is ringing, the shift and the
 * drawer. The console draws a strip above the basket; here one "Register"
 * sheet holds the same controls at a tablet-sized touch, and a locked
 * register covers the till with the PIN pad.
 */

/** The Register sheet: the cashier, and the shift with its drawer. */
@Composable
fun RegisterOpsDialog(model: RegisterModel, onDismiss: () -> Unit) {
  val cashier = model.cashier
  val shift = model.shift
  var switching by remember { mutableStateOf(false) }
  AlertDialog(
    onDismissRequest = onDismiss,
    modifier = Modifier.testTag("pos-ops"),
    title = { Text("Register") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
        shift.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = { shift.notice = null }) { Text("Dismiss") } }) }
        SectionCard("Cashier") {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            Text(
              cashier.cashier?.name ?: "You",
              Modifier.weight(1f).testTag("pos-cashier-name"),
              style = MaterialTheme.typography.titleMedium,
            )
            if (cashier.cashier != null) TextButton(onClick = cashier::signOut) { Text("Sign out") }
          }
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            OutlinedButton(onClick = { switching = true }, enabled = model.register != null, modifier = Modifier.testTag("pos-switch-cashier")) { Text("Switch cashier") }
            OutlinedButton(onClick = { cashier.lock(); onDismiss() }, enabled = model.register != null, modifier = Modifier.testTag("pos-lock")) { Text("Lock") }
          }
        }
        SectionCard("Shift") { ShiftControls(model) }
        StaffPinsSection(model)
      }
    },
    confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
  )
  if (switching) {
    PinPadDialog(model, purpose = "cashier", title = "Switch cashier", prompt = null, dismissible = true, onDismiss = { switching = false }) {
      cashier.switchTo(it)
      switching = false
    }
  }
  ShiftDialogs(model)
}

/** Staff PINs: set, change or remove your own, and a workspace admin's reset of anyone's. */
@Composable
private fun StaffPinsSection(model: RegisterModel) {
  val scope = rememberCoroutineScope()
  val pins = remember(model) { PosStaffPinsModel(model.opsApi, scope) }
  LaunchedEffect(pins) { pins.load() }
  SectionCard("Staff PINs") {
    pins.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = { pins.notice = null }) { Text("Dismiss") } }) }
    val status = pins.status
    when {
      pins.refusal != null -> Text(
        if (pins.refusal == "Not permitted") "Only members who can use the register have a PIN." else pins.refusal.orEmpty(),
        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      status == null -> Text("Reading your PIN…", color = MaterialTheme.colorScheme.onSurfaceVariant)
      else -> {
        Text(
          if (status.hasPin) "Your PIN switches you in at a shared register. Five wrong tries lock it for 15 minutes."
          else "Set a 4–6 digit PIN to switch in at a shared register without signing anyone out.",
          style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          OutlinedButton(onClick = { pins.startEdit(null) }, modifier = Modifier.testTag("pin-set-mine")) { Text(if (status.hasPin) "Change my PIN" else "Set my PIN") }
          if (status.hasPin) TextButton(onClick = { pins.remove(null) }, enabled = !pins.busy) { Text("Remove my PIN") }
        }
        if (pins.roster.isNotEmpty()) {
          Text("Staff with a PIN", style = MaterialTheme.typography.labelLarge)
          pins.roster.forEach { member ->
            Row(verticalAlignment = Alignment.CenterVertically) {
              Text(member.name, Modifier.weight(1f), maxLines = 1)
              TextButton(onClick = { pins.startEdit(member) }) { Text("Reset") }
              TextButton(onClick = { pins.remove(member) }, enabled = !pins.busy) { Text("Remove") }
            }
          }
        }
      }
    }
  }
  if (pins.dialogOpen) {
    var pin by rememberSaveable { mutableStateOf("") }
    var again by rememberSaveable { mutableStateOf("") }
    ActionDialog(
      title = pins.editing?.let { "Reset ${it.name}'s PIN" } ?: "Your register PIN",
      icon = "lock",
      confirmLabel = "Save PIN",
      busy = pins.busy,
      error = pins.error,
      onDismiss = pins::closeDialog,
      onConfirm = { pins.save(pin, again) },
    ) {
      OutlinedTextField(
        pin, { pin = it.filter(Char::isDigit).take(6) }, label = { Text("PIN") }, singleLine = true,
        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth().testTag("pin-new"),
      )
      OutlinedTextField(
        again, { again = it.filter(Char::isDigit).take(6) }, label = { Text("PIN again") }, singleLine = true,
        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth().testTag("pin-again"),
      )
    }
  }
}

@Composable
private fun ShiftControls(model: RegisterModel) {
  val shift = model.shift
  val open = shift.shift
  if (!shift.loaded) {
    Text("Reading the shift…", color = MaterialTheme.colorScheme.onSurfaceVariant)
    return
  }
  if (open != null) {
    StatusChip("Shift open since ${formatReceiptTime(open.shift.openedAtMs.toLong(), model.timeZone).substringAfterLast(", ")}", StatusTone.SUCCESS, Modifier.testTag("pos-shift-status"))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedButton(onClick = { shift.open(ShiftDialog.CASH) }, modifier = Modifier.testTag("pos-shift-cash")) { Text("Cash in/out") }
      OutlinedButton(onClick = { shift.open(ShiftDialog.REPORT) }, modifier = Modifier.testTag("pos-shift-report")) { Text("X report") }
      OutlinedButton(onClick = { shift.open(ShiftDialog.CLOSE) }, modifier = Modifier.testTag("pos-shift-close")) { Text("Close shift") }
    }
  } else {
    StatusChip("No shift open", StatusTone.NEUTRAL, Modifier.testTag("pos-shift-status"))
    if (model.context?.ops?.requireOpenShift == true) {
      Text("This site asks for an open shift before a sale.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Button(onClick = { shift.open(ShiftDialog.OPEN) }, enabled = model.register != null, modifier = Modifier.testTag("pos-shift-open")) { Text("Open shift") }
  }
}

@Composable
private fun ShiftDialogs(model: RegisterModel) {
  val shift = model.shift
  val currency = model.currency
  when (shift.dialog) {
    null -> Unit
    ShiftDialog.OPEN -> {
      var amount by rememberSaveable { mutableStateOf("") }
      ActionDialog(
        title = "Open a shift",
        body = "Count the cash in the drawer before the first sale. Every sale and cash movement until you close is counted against it.",
        icon = "payments",
        confirmLabel = "Open shift",
        busy = shift.busy,
        error = shift.error,
        onDismiss = shift::dismiss,
        onConfirm = { shift.submitOpen(amount) },
      ) {
        OutlinedTextField(
          amount, { amount = it }, label = { Text("Starting cash") }, prefix = { Text("$") }, placeholder = { Text("150.00") },
          singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth().testTag("shift-float"),
        )
      }
    }
    ShiftDialog.CASH -> {
      var type by rememberSaveable { mutableStateOf(PosCashEventType.PAID_OUT.raw) }
      var amount by rememberSaveable { mutableStateOf("") }
      var reason by rememberSaveable { mutableStateOf("") }
      val cashType = POS_CASH_TYPES.first { it.raw == type }
      ActionDialog(
        title = "Cash in or out",
        icon = "payments",
        confirmLabel = "Record",
        busy = shift.busy,
        error = shift.error,
        onDismiss = shift::dismiss,
        onConfirm = { shift.submitCash(cashType, amount, reason) },
      ) {
        ChoiceChipRow(
          options = POS_CASH_TYPES.map { ChipOption(it.raw, Contracts.posCashEventLabels[it.raw] ?: it.raw) },
          selected = type,
          onSelect = { type = it },
          wrap = true,
        )
        Text(
          when (cashType) {
            PosCashEventType.PAID_IN -> "Cash added to the drawer."
            PosCashEventType.PAID_OUT -> "Cash taken for an expense."
            else -> "Cash moved to the safe."
          },
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedTextField(
          amount, { amount = it }, label = { Text("Amount") }, prefix = { Text("$") }, singleLine = true,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth().testTag("shift-cash-amount"),
        )
        OutlinedTextField(
          reason, { reason = it }, label = { Text(if (cashType == PosCashEventType.DROP) "Note (optional)" else "Reason") },
          placeholder = { if (cashType == PosCashEventType.PAID_OUT) Text("Milk for the coffee bar") }, singleLine = true,
          modifier = Modifier.fillMaxWidth().testTag("shift-cash-reason"),
        )
      }
    }
    ShiftDialog.REPORT -> AlertDialog(
      onDismissRequest = shift::dismiss,
      title = { Text("X report") },
      text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          shift.error?.let { NoticeBanner(it, StatusTone.WARNING) }
          shift.report?.let { ShiftReportView(it, null, currency) } ?: if (shift.error == null) Text("Reading the shift…") else Unit
        }
      },
      confirmButton = { TextButton(onClick = shift::dismiss) { Text("Done") } },
      dismissButton = { TextButton(onClick = { shift.print(shift.shift?.id) }, enabled = shift.report != null && !shift.busy) { Text("Print") } },
    )
    ShiftDialog.CLOSE -> {
      val frozen = shift.closed
      if (frozen != null) {
        AlertDialog(
          onDismissRequest = shift::dismiss,
          title = { Text("Z report") },
          text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1f))) {
              frozen.report?.let { ShiftReportView(it, frozen.shift.shift, currency) }
            }
          },
          confirmButton = { Button(onClick = shift::dismiss) { Text("Done") } },
          dismissButton = { TextButton(onClick = { shift.print(frozen.shift.id) }, enabled = !shift.busy) { Text("Print") } },
        )
      } else {
        var counted by rememberSaveable { mutableStateOf("") }
        var note by rememberSaveable { mutableStateOf("") }
        val countedCents = centsFromText(counted)
        val expected = shift.report?.expectedCashCents
        ActionDialog(
          title = "Close the shift",
          body = "Count the drawer, then enter what is in it.",
          icon = "lock",
          confirmLabel = "Close shift",
          busy = shift.busy,
          error = shift.error,
          onDismiss = shift::dismiss,
          onConfirm = { shift.submitClose(counted, note) },
        ) {
          OutlinedTextField(
            counted, { counted = it }, label = { Text("Cash counted") }, prefix = { Text("$") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth().testTag("shift-counted"),
          )
          if (expected != null && countedCents != null) {
            val variance = shiftVarianceCents(countedCents, expected)
            NoticeBanner(
              "Expected ${money(expected.toLong(), currency)} · " + when {
                variance == 0L -> "balanced"
                variance < 0 -> "short ${money(-variance, currency)}"
                else -> "over ${money(variance, currency)}"
              },
              if (variance == 0L) StatusTone.SUCCESS else StatusTone.INFO,
              Modifier.testTag("shift-variance"),
            )
          }
          OutlinedTextField(note, { note = it }, label = { Text("Note (optional)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
        }
      }
    }
  }
}

/** The X or Z report: sales by tender, refunds, and the drawer from float to expected cash. */
@Composable
fun ShiftReportView(report: PosShiftReport, shift: PosShift?, currency: String) {
  fun m(cents: Double) = money(cents.toLong(), currency)
  Column(verticalArrangement = Arrangement.spacedBy(space(0.5f)), modifier = Modifier.testTag("shift-report-view")) {
    AmountRow("Sales (${report.orderCount.toLong()})", m(report.grossSalesCents))
    if (report.discountsCents > 0) AmountRow("Discounts", m(report.discountsCents), muted = true)
    if (report.taxCents > 0) AmountRow("Tax", m(report.taxCents), muted = true)
    if (report.tipsCents > 0) AmountRow("Tips", m(report.tipsCents), muted = true)
    report.salesByTender.entries.sortedBy { it.key }.forEach { (method, cents) ->
      AmountRow(Contracts.posTenderLabels[method] ?: method, m(cents), muted = true)
    }
    AmountRow("Refunds (${report.refundCount.toLong()})", "−" + m(report.refundsCents))
    AmountRow("Net sales", m(report.netSalesCents), emphasized = true)
    HorizontalDivider(Modifier.padding(vertical = space(0.5f)))
    AmountRow("Opening float", m(report.openingFloatCents), muted = true)
    AmountRow("Cash sales", m(report.cashSalesCents), muted = true)
    if (report.paidInCents > 0) AmountRow("Paid in", m(report.paidInCents), muted = true)
    if (report.paidOutCents > 0) AmountRow("Paid out", "−" + m(report.paidOutCents), muted = true)
    if (report.dropsCents > 0) AmountRow("Safe drops", "−" + m(report.dropsCents), muted = true)
    if (report.cashRefundsCents > 0) AmountRow("Cash refunds", "−" + m(report.cashRefundsCents), muted = true)
    AmountRow("Expected cash", m(report.expectedCashCents), emphasized = true)
    if (shift?.countedCashCents != null) {
      AmountRow("Counted", m(shift.countedCashCents!!), muted = true)
      val variance = (shift.varianceCents ?: 0.0)
      AmountRow(
        if (variance == 0.0) "Balanced" else if (variance < 0) "Short" else "Over",
        if (variance == 0.0) m(0.0) else m(kotlin.math.abs(variance)),
        emphasized = true,
      )
    }
    if (report.truncated == true) {
      Text("This shift has more sales than a report reads; the figures are partial.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

/** The PIN pad: pick your name, tap your PIN. Every key a full-size touch target. */
@Composable
fun PinPadDialog(
  model: RegisterModel,
  purpose: String,
  title: String,
  prompt: String?,
  dismissible: Boolean,
  onDismiss: () -> Unit,
  onVerified: (PosStaffAssertion) -> Unit,
) {
  val register = model.register
  val scope = rememberCoroutineScope()
  val pad = remember(register?.id, purpose) { PosPinPadModel(model.opsApi, scope, register?.id.orEmpty(), purpose, onVerified) }
  LaunchedEffect(pad) { pad.load() }
  // A lock nobody can open is no lock: with no PINs on the site, the pad can always close.
  val canClose = dismissible || pad.nobodyHasAPin
  AlertDialog(
    onDismissRequest = { if (canClose) onDismiss() },
    modifier = Modifier.testTag("pos-pin-pad"),
    title = { Text(title) },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
        prompt?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (pad.nobodyHasAPin) {
          NoticeBanner("Nobody has a register PIN on this site yet. Set yours from the Register sheet, under Staff PINs.", StatusTone.INFO)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          (pad.members ?: emptyList()).forEach { member ->
            val on = member.uid == pad.memberUid
            if (on) Button(onClick = { pad.pick(member.uid) }) { Text(member.name) } else OutlinedButton(onClick = { pad.pick(member.uid) }) { Text(member.name) }
          }
        }
        Text(
          "•".repeat(pad.pin.length).ifEmpty { " " },
          Modifier.fillMaxWidth().testTag("pos-pin-dots"),
          style = MaterialTheme.typography.headlineMedium,
          textAlign = TextAlign.Center,
        )
        pad.error?.let { NoticeBanner(it, StatusTone.WARNING) }
        listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("clear", "0", "back")).forEach { row ->
          Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            row.forEach { key ->
              OutlinedButton(
                onClick = { pad.press(key) },
                enabled = !pad.busy && pad.memberUid.isNotEmpty(),
                modifier = Modifier.weight(1f).heightIn(min = 56.dp).testTag("pin-$key"),
              ) { Text(if (key == "back") "⌫" else if (key == "clear") "Clear" else key) }
            }
          }
        }
      }
    },
    confirmButton = { Button(onClick = pad::submit, enabled = pad.canSubmit, modifier = Modifier.testTag("pin-submit")) { Text(if (purpose == "manager") "Approve" else "Continue") } },
    dismissButton = if (canClose) ({ TextButton(onClick = onDismiss) { Text("Cancel") } }) else null,
  )
}

/** Covers the till while the register is locked, until a PIN opens it. */
@Composable
fun LockedRegister(model: RegisterModel) {
  Surface(Modifier.fillMaxSize().testTag("pos-locked"), color = MaterialTheme.colorScheme.background) {
    Box(contentAlignment = Alignment.Center) {
      Text("Register locked", style = MaterialTheme.typography.headlineSmall)
    }
  }
  PinPadDialog(
    model,
    purpose = "cashier",
    title = "Register locked",
    prompt = "Enter your PIN to use the register.",
    dismissible = false,
    onDismiss = model.cashier::unlock,
    onVerified = model.cashier::switchTo,
  )
}
