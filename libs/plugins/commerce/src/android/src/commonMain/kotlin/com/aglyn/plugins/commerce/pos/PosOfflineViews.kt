package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import com.aglyn.contracts.ReceiptData
import com.aglyn.contracts.ReceiptLine
import com.aglyn.contracts.ReceiptTender
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.ui.AmountRow
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/*
 * WHAT THE REGISTER SAYS ABOUT ITS CONNECTION (AGL-3625), and the offline cash
 * sale. The Apple app's `PosOfflineViews.swift`. The console's banner and
 * offline checkout, at a tablet-sized touch.
 *
 *  - offline: what still sells (cash), what does not, and how many sales wait;
 *  - back online: the sync, then what the server flagged by order number;
 *  - a sale the server would not take, kept on the device with its reason.
 */

private fun plural(count: Int, one: String, many: String) = "$count ${if (count == 1) one else many}"

@Composable
fun RegisterOfflineBanner(model: RegisterModel) {
  val offline = model.offline
  val waiting = offline.waiting
  var removing by remember { mutableStateOf<PosOfflineQueued?>(null) }
  Column(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    if (!model.online) {
      NoticeBanner(
        if (offline.ready) {
          "Offline. Cash sales keep ringing and are saved on this register until the connection returns. Card readers, gift cards, store credit and room charges are off."
        } else {
          "Offline. Sales are paused: ${offline.unavailableReason ?: "this register cannot sell offline."}. Hold baskets and charge when you are back online."
        },
        StatusTone.WARNING,
        Modifier.testTag("pos-offline"),
        action = { TextButton(onClick = { model.reconnect() }, modifier = Modifier.testTag("pos-reconnect")) { Text("Retry") } },
      )
      if (waiting.isNotEmpty()) {
        Text(
          "${plural(waiting.size, "sale", "sales")} (${money(offline.waitingCents, model.currency)}) waiting to sync.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.testTag("pos-offline-waiting"),
        )
      }
    } else if (waiting.isNotEmpty()) {
      NoticeBanner(
        if (offline.syncing) {
          "Syncing ${plural(waiting.size, "offline sale", "offline sales")}…"
        } else {
          "${plural(waiting.size, "offline sale", "offline sales")} (${money(offline.waitingCents, model.currency)}) waiting to sync."
        },
        StatusTone.INFO,
        Modifier.testTag("pos-offline-sync"),
        action = if (offline.syncing) null else ({ TextButton(onClick = { offline.syncInBackground() }) { Text("Sync now") } }),
      )
    }
    offline.syncError?.let { NoticeBanner("Offline sales could not sync: $it They stay on this register.", StatusTone.ERROR) }
    offline.refused.forEach { entry ->
      NoticeBanner(
        "A ${money(entry.totalCents, model.currency)} offline sale from ${formatReceiptTime(entry.sale.soldAtMs.toLong(), model.timeZone)} did not sync: ${entry.error ?: "refused"}",
        StatusTone.ERROR,
        action = { TextButton(onClick = { removing = entry }) { Text("Remove") } },
      )
    }
    if (offline.notices.isNotEmpty()) {
      NoticeBanner(
        "Synced, with something to check",
        StatusTone.WARNING,
        action = { TextButton(onClick = offline::dismissNotices) { Text("Dismiss") } },
      )
      offline.notices.forEach { notice ->
        Text(
          "Order ${notice.number?.let { "#$it" } ?: notice.orderId}: ${notice.lines.joinToString("; ")}",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
  }
  removing?.let { entry ->
    AlertDialog(
      onDismissRequest = { removing = null },
      title = { Text("Remove this sale from the register?") },
      text = { Text("The ${money(entry.totalCents, model.currency)} cash sale will not be recorded anywhere. Record it by hand first if the cash was taken.") },
      confirmButton = { TextButton(onClick = { offline.discard(entry.id); removing = null }) { Text("Remove") } },
      dismissButton = { TextButton(onClick = { removing = null }) { Text("Cancel") } },
    )
  }
}

/** The receipt an offline sale prints, from what the register queued (the console's offline receipt). */
fun offlineReceipt(rung: PosOfflineRung, kit: com.aglyn.contracts.PosOfflineKit?, registerName: String?, cashierName: String?, currency: String, timeZone: String?): ReceiptData {
  val sale = rung.sale
  val totals = sale.totals
  val number = sale.saleKey.take(8)
  return ReceiptData(
    storeName = kit?.receipt?.name ?: "Receipt",
    storeLines = kit?.receipt?.address.orEmpty().lines().map { it.trim() }.filter { it.isNotEmpty() }.ifEmpty { null },
    orderNumber = number,
    orderId = sale.saleKey,
    createdAtMs = sale.soldAtMs,
    timeZone = timeZone,
    registerName = registerName,
    cashierName = cashierName,
    currency = currency,
    lines = sale.lines.map { line ->
      ReceiptLine(detail = line.variantLabel, name = line.name, quantity = line.quantity, totalCents = line.unitAmountCents * line.quantity, unitCents = line.unitAmountCents)
    },
    subtotalCents = totals.itemsCents ?: 0.0,
    discountCents = totals.discountCents?.takeIf { it != 0.0 },
    taxCents = totals.taxCents?.takeIf { it != 0.0 },
    totalCents = totals.totalCents ?: 0.0,
    tenders = listOf(ReceiptTender(amountCents = sale.cashTenderedCents, label = "Cash")),
    changeCents = sale.changeCents.takeIf { it > 0 },
    footer = kit?.receipt?.footer?.ifEmpty { null } ?: kit?.receipt?.returnPolicy?.ifEmpty { null },
    barcode = sale.saleKey,
  )
}

/** An offline cash sale: the total the register rings from its cached prices and the store's rate, the cash handed over, and, once the sale is on the device, the change. */
@Composable
fun OfflineCashDialog(model: RegisterModel) {
  val offline = model.offline
  val sold = remember { model.cart }
  var received by remember { mutableStateOf("") }
  var rung by remember { mutableStateOf<PosOfflineRung?>(null) }
  var failed by remember { mutableStateOf(false) }
  var printProblem by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val totals = rung?.sale?.totals ?: offline.totals(sold)
  val owed = (totals?.totalCents ?: 0.0).toLong()
  val tendered = centsFromText(received) ?: 0L
  fun fmt(cents: Long) = money(cents, model.currency)
  val done = {
    model.offlineCashOpen = false
  }
  AlertDialog(
    onDismissRequest = { if (rung == null) done() },
    modifier = Modifier.testTag("pos-offline-cash"),
    title = { Text(if (rung == null) "Cash — ${fmt(owed)}" else "Sale saved on this register") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
        if (totals != null) {
          AmountRow("Items", fmt((totals.itemsCents ?: 0.0).toLong()))
          if ((totals.discountCents ?: 0.0) > 0) AmountRow("Discount", "-${fmt((totals.discountCents ?: 0.0).toLong())}")
          AmountRow("Tax", fmt((totals.taxCents ?: 0.0).toLong()))
          AmountRow("Total", fmt(owed), emphasized = true)
        } else {
          NoticeBanner(offline.unavailableReason ?: "This basket cannot be rung offline.", StatusTone.WARNING)
        }
        val saved = rung
        if (saved != null) {
          NoticeBanner(
            if (saved.changeCents > 0) "Change due: ${fmt(saved.changeCents)}" else "No change due.",
            StatusTone.SUCCESS,
            Modifier.testTag("offline-change"),
          )
          Text(
            if (saved.hasCustomerEmail) "It syncs when the register is back online, and the emailed receipt goes then." else "It syncs when the register is back online.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          printProblem?.let { NoticeBanner(it, StatusTone.ERROR) }
          if (model.peripherals.printers.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
              fun print(gift: Boolean) {
                val receipt = offlineReceipt(saved, offline.kit, model.register?.name, model.cashier.cashier?.name, model.currency, model.timeZone)
                scope.launch { printProblem = model.print(if (gift) receipt.copy(banner = "GIFT RECEIPT") else receipt, openDrawer = !gift, gift = gift) }
              }
              OutlinedButton(onClick = { print(false) }, modifier = Modifier.testTag("offline-print")) { Text("Print receipt") }
              OutlinedButton(onClick = { print(true) }, modifier = Modifier.testTag("offline-gift")) { Text("Gift receipt") }
            }
          }
        } else if (totals != null) {
          if (offline.discountOverLimit(sold)) {
            NoticeBanner("This register may discount up to ${(offline.kit?.maxDiscountPct ?: 0.0).toLong()}%.", StatusTone.ERROR)
          }
          OutlinedTextField(
            received, { received = it.filter { c -> c.isDigit() || c == '.' } }, label = { Text("Cash received") }, prefix = { Text("$") },
            singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth().testTag("offline-received"),
          )
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            offlineQuickAmounts(owed).forEach { cents ->
              OutlinedButton(onClick = { received = amountText(cents) }) { Text(if (cents == owed) "Exact" else fmt(cents)) }
            }
          }
          if (tendered > 0 && tendered >= owed) {
            NoticeBanner("Change: ${fmt(tendered - owed)}", StatusTone.SUCCESS)
          } else if (tendered > 0) {
            NoticeBanner("Offline sales take the whole total in cash: ${fmt(owed - tendered)} more.", StatusTone.INFO)
          }
          if (failed) NoticeBanner("This register could not save the sale. Do not take the cash; try again.", StatusTone.ERROR)
        }
      }
    },
    confirmButton = {
      if (rung == null) {
        Button(
          onClick = {
            failed = false
            val made = model.takeOfflineCash(sold, tendered)
            if (made == null) failed = true else rung = made
          },
          enabled = totals != null && tendered >= owed && !offline.discountOverLimit(sold),
          modifier = Modifier.testTag("offline-take-cash"),
        ) { Text("Take cash") }
      } else {
        Button(onClick = done, modifier = Modifier.testTag("offline-done")) { Text("New sale") }
      }
    },
    dismissButton = if (rung == null) ({ TextButton(onClick = done) { Text("Cancel") } }) else null,
  )
}

/** Exact, and the next few round amounts a customer hands over. */
fun offlineQuickAmounts(owed: Long): List<Long> =
  listOf(owed, (owed + 499) / 500 * 500, (owed + 999) / 1000 * 1000, (owed + 1999) / 2000 * 2000).filter { it >= owed }.distinct().take(4)
