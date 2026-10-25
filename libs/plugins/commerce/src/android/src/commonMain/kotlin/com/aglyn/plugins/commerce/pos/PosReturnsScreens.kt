package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.ui.AmountRow
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space

/*
 * THE RETURN DIALOG (AGL-3609): the console register's Return dialog at a
 * tablet-sized touch. Find the sale, pick what came back, say why, and the
 * refund goes to the payments the sale was made with. The Apple app's
 * `PosReturnsScreens.swift`.
 */

private fun RegisterModel.fmt(cents: Long): String = money(cents, currency)

@Composable
fun PosReturnDialog(model: RegisterModel, onDismiss: () -> Unit) {
  val returns = model.returns
  val close = {
    returns.reset()
    onDismiss()
  }
  val finished = returns.result
  val order = returns.order
  AlertDialog(
    onDismissRequest = { if (!returns.busy) close() },
    modifier = Modifier.testTag("pos-return-dialog"),
    title = { Text(if (finished != null) "Return refunded" else if (order != null) "Return from ${order.label}" else "Return") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
        returns.error?.let { NoticeBanner(it, StatusTone.WARNING) }
        when {
          finished != null -> ReturnDone(model, finished)
          order != null -> ReturnPicker(model, order)
          else -> ReturnLookup(model)
        }
      }
    },
    confirmButton = {
      when {
        finished != null -> Button(onClick = close, modifier = Modifier.testTag("return-done")) { Text("Done") }
        order != null -> Button(onClick = { returns.submit() }, enabled = returns.canSubmit, modifier = Modifier.testTag("return-refund")) {
          Text("Refund ${model.fmt(returns.refundCents)}")
        }
        else -> Button(onClick = returns::find, enabled = !returns.busy && returns.text.isNotBlank(), modifier = Modifier.testTag("return-find")) { Text("Find order") }
      }
    },
    dismissButton = {
      when {
        finished != null -> Unit
        order != null -> TextButton(onClick = returns::back, enabled = !returns.busy) { Text("Back") }
        else -> TextButton(onClick = close) { Text("Cancel") }
      }
    },
  )
  returns.managerPrompt?.let { prompt ->
    PinPadDialog(model, purpose = "manager", title = "Manager approval", prompt = prompt, dismissible = true, onDismiss = returns::cancelApproval, onVerified = returns::approve)
  }
}

@Composable
private fun ReturnLookup(model: RegisterModel) {
  val returns = model.returns
  OutlinedTextField(
    returns.text, { returns.text = it }, label = { Text("Order number, receipt barcode or customer email") }, singleLine = true,
    modifier = Modifier.fillMaxWidth().testTag("return-text"),
  )
  Text(
    "Scan the receipt's barcode with a scanner, or type the number printed on it.",
    style = MaterialTheme.typography.bodySmall,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
  )
  val found = returns.orders ?: return
  if (found.isEmpty()) {
    Text("No order matches. Check the number on the receipt.", style = MaterialTheme.typography.bodyMedium)
  } else if (found.size > 1) {
    found.forEach { candidate ->
      OutlinedButton(onClick = { returns.choose(candidate) }, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth()) {
          Text("${candidate.label} · ${model.fmt(candidate.totalCents)}", style = MaterialTheme.typography.titleSmall)
          Text("${formatReceiptTime(candidate.createdAtMs.toLong(), model.timeZone)} · ${candidate.status}", style = MaterialTheme.typography.bodySmall)
        }
      }
    }
  }
}

@Composable
private fun ReturnPicker(model: RegisterModel, order: PosReturnOrder) {
  val returns = model.returns
  Text(
    listOfNotNull(order.customerName, order.customerEmail, formatReceiptTime(order.createdAtMs.toLong(), model.timeZone)).filter { it.isNotBlank() }.joinToString(" · "),
    style = MaterialTheme.typography.bodyMedium,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
  )
  if (!order.returnable) NoticeBanner("This order is ${order.status} and cannot be returned.", StatusTone.WARNING)
  order.lines.forEach { line ->
    val quantity = returns.quantity(line)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      Column(Modifier.weight(1f)) {
        Text(line.name + (line.variantLabel?.let { " ($it)" } ?: ""), style = MaterialTheme.typography.bodyLarge)
        Text(
          if (line.left > 0) "${line.left} of ${line.quantity} can be returned" else if (line.held > 0) "In an online return" else "Already returned",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      OutlinedButton(onClick = { returns.step(line, -1) }, enabled = quantity > 0, modifier = Modifier.testTag("return-less-${line.index}")) { Text("−") }
      Text("$quantity", style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("return-qty-${line.index}"))
      OutlinedButton(onClick = { returns.step(line, 1) }, enabled = quantity < line.left && order.returnable, modifier = Modifier.testTag("return-more-${line.index}")) { Text("+") }
    }
  }
  Row(verticalAlignment = Alignment.CenterVertically) {
    Checkbox(checked = returns.restock, onCheckedChange = { returns.restock = it })
    Text("Put the items back in stock at this register's location", style = MaterialTheme.typography.bodyMedium)
  }
  Text("Reason", style = MaterialTheme.typography.labelLarge)
  ChoiceChipRow(
    options = Contracts.returnReasons.map { ChipOption(it.raw, Contracts.returnReasonLabels[it.raw] ?: it.raw) },
    selected = returns.reasonCode,
    onSelect = { returns.reasonCode = it },
    wrap = true,
  )
  OutlinedTextField(returns.note, { returns.note = it }, label = { Text("Note (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
  Row(verticalAlignment = Alignment.CenterVertically) {
    Text("Refund ${model.fmt(returns.refundCents)}", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
    if (order.tenders.size > 1) {
      Text("Split by hand", style = MaterialTheme.typography.bodySmall)
      Switch(checked = returns.splitByHand, onCheckedChange = { returns.splitByHand = it })
    }
  }
  order.tenders.forEach { tender ->
    if (returns.splitByHand) {
      OutlinedTextField(
        returns.split[tender.id].orEmpty(), { returns.split = returns.split + (tender.id to it) },
        label = { Text("${tender.label} (up to ${model.fmt(tender.refundableCents)})") }, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth(),
      )
    } else {
      Text(
        "${tender.label}: paid ${model.fmt(tender.amountCents)}, ${model.fmt(tender.refundableCents)} refundable",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
  if (!returns.splitByHand && order.tenders.size > 1) {
    Text(
      "Cards are refunded first, then gift cards and room charges; cash comes out of the drawer last.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}

@Composable
private fun ReturnDone(model: RegisterModel, result: PosReturnResult) {
  if (result.cashOutCents > 0) {
    NoticeBanner("Give the customer ${model.fmt(result.cashOutCents)} from the drawer.", StatusTone.INFO, Modifier.testTag("return-cash-out"))
  }
  result.tenders.forEach { tender ->
    AmountRow(tender.label, if (tender.failed) "Failed — ${tender.error.orEmpty()}" else model.fmt(tender.amountCents))
  }
  AmountRow("Total", model.fmt(result.refundedCents), emphasized = true)
  if (result.partial) {
    NoticeBanner("${model.fmt(result.outstandingCents)} could not go back to the card. Pay it another way and note it on the order.", StatusTone.WARNING)
  }
  if (result.restockedUnits > 0) {
    Text(
      "${result.restockedUnits} ${if (result.restockedUnits == 1) "unit" else "units"} back in stock.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}
