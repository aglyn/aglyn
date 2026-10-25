package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
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
import com.aglyn.contracts.PosOfflineCardForward
import com.aglyn.contracts.PosOfflineFlag
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.hardware.CardCollectorState
import com.aglyn.hardware.DeviceReaderControls
import com.aglyn.hardware.offlineCardLabel
import com.aglyn.ui.AmountRow
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/*
 * WHAT THE REGISTER SAYS ABOUT ITS CONNECTION (AGL-3625), and the offline sale:
 * cash, or a card on this device's own reader (AGL-4039). The Apple app's
 * `PosOfflineViews.swift`. The console's banner and
 * offline checkout, at a tablet-sized touch.
 *
 *  - offline: what still sells (cash, and cards on this device's reader), what
 *    does not, and how many sales wait, cards to charge among them;
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
        when {
          !offline.ready -> "Offline. Sales are paused: ${offline.unavailableReason ?: "this register cannot sell offline."}. Hold baskets and charge when you are back online."
          model.offlineCardsReady -> "Offline. Cash and card sales keep ringing and are saved on this register until the connection returns; cards are charged then. Gift cards, store credit and room charges are off."
          else -> "Offline. Cash sales keep ringing and are saved on this register until the connection returns. Card readers, gift cards, store credit and room charges are off."
        },
        StatusTone.WARNING,
        Modifier.testTag("pos-offline"),
        action = { TextButton(onClick = { model.reconnect() }, modifier = Modifier.testTag("pos-reconnect")) { Text("Retry") } },
      )
      if (waiting.isNotEmpty()) {
        Text(
          waitingSummary(model),
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
          waitingSummary(model)
        },
        StatusTone.INFO,
        Modifier.testTag("pos-offline-sync"),
        action = if (offline.syncing) null else ({ TextButton(onClick = { offline.syncInBackground() }) { Text("Sync now") } }),
      )
    }
    // Cards stored on this device wait for a connection: Stripe recommends reconnecting within a day (AGL-4039).
    offline.oldestCardOnDeviceMs?.let { oldest ->
      NoticeBanner(reconnectMessage(oldest, model), if (offline.cardsWaitedTooLong) StatusTone.ERROR else StatusTone.WARNING, Modifier.testTag("pos-offline-cards-reconnect"))
    }
    offline.syncError?.let { NoticeBanner("Offline sales could not sync: $it They stay on this register.", StatusTone.ERROR) }
    offline.refused.forEach { entry ->
      NoticeBanner(
        "A ${money(entry.totalCents, model.currency)} offline sale from ${formatReceiptTime(entry.sale.soldAtMs.toLong(), model.timeZone)} did not sync: ${entry.error ?: "refused"}",
        StatusTone.ERROR,
        action = { TextButton(onClick = { removing = entry }) { Text("Remove") } },
      )
    }
    // A card the bank declined after the sale stands on its own: the order is unpaid (AGL-4039).
    offline.notices.filter { it.cardUnpaid }.forEach { notice ->
      NoticeBanner(
        declinedCardMessage(notice, model),
        StatusTone.ERROR,
        Modifier.testTag("pos-offline-card-declined"),
        action = { TextButton(onClick = { offline.dismissNotice(notice.saleKey) }) { Text("Dismiss") } },
      )
    }
    val checks = offline.notices.filter { !it.cardUnpaid || it.lines.isNotEmpty() }
    if (checks.isNotEmpty()) {
      NoticeBanner(
        "Synced, with something to check",
        StatusTone.WARNING,
        action = { TextButton(onClick = offline::dismissNotices) { Text("Dismiss") } },
      )
      checks.forEach { notice ->
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
      text = {
        Text(
          if (entry.isCard) "The ${money(entry.totalCents, model.currency)} card sale will not be recorded anywhere. Record it by hand first."
          else "The ${money(entry.totalCents, model.currency)} cash sale will not be recorded anywhere. Record it by hand first if the cash was taken.",
        )
      },
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
    tenders = listOf(
      rung.card?.let { card ->
        ReceiptTender(amountCents = totals.totalCents ?: 0.0, label = "${offlineCardLabel(card.brand, card.last4)} (charged when back online)")
      } ?: ReceiptTender(amountCents = sale.cashTenderedCents, label = "Cash"),
    ),
    changeCents = sale.changeCents.takeIf { it > 0 },
    footer = kit?.receipt?.footer?.ifEmpty { null } ?: kit?.receipt?.returnPolicy?.ifEmpty { null },
    barcode = sale.saleKey,
  )
}

private enum class OfflineTender { CASH, CARD }

/**
 * An offline sale (AGL-3625, AGL-4039): the total the register rings from its
 * cached prices and the store's rate, then cash (the change) or a card on this
 * device's own reader (saved on the device and charged when the connection
 * returns).
 */
@Composable
fun OfflineSaleDialog(model: RegisterModel) {
  val offline = model.offline
  val sold = remember { model.cart }
  var tender by remember { mutableStateOf(OfflineTender.CASH) }
  var received by remember { mutableStateOf("") }
  var rung by remember { mutableStateOf<PosOfflineRung?>(null) }
  var failed by remember { mutableStateOf<String?>(null) }
  var taking by remember { mutableStateOf(false) }
  var printProblem by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val totals = rung?.sale?.totals ?: offline.totals(sold)
  val owed = (totals?.totalCents ?: 0.0).toLong()
  val tendered = centsFromText(received) ?: 0L
  val cardRefusal = model.offlineCardRefusal(sold)
  val prompt = (model.cardCollector as? DeviceReaderControls)?.prompt?.collectAsState()
  val readerState = model.cardCollector?.state?.collectAsState()
  fun fmt(cents: Long) = money(cents, model.currency)
  val done = {
    model.offlineCashOpen = false
  }
  AlertDialog(
    onDismissRequest = { if (rung == null && !taking) done() },
    modifier = Modifier.testTag("pos-offline-cash"),
    title = { Text(if (rung == null) "Offline sale — ${fmt(owed)}" else "Sale saved on this register") },
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
          val card = saved.card
          if (card != null) {
            NoticeBanner(
              "Card saved: ${offlineCardLabel(card.brand, card.last4)}. " +
                if (card.forward == PosOfflineCardForward.FORWARDED) "Stripe has it; it is charged when the sale syncs." else "It is charged when the register is back online.",
              StatusTone.SUCCESS,
              Modifier.testTag("offline-card-saved"),
            )
            Text(
              "If the bank declines the card then, the order is marked unpaid and this register tells you.",
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          } else {
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
          }
          printProblem?.let { NoticeBanner(it, StatusTone.ERROR) }
          if (model.peripherals.printers.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
              fun print(gift: Boolean) {
                val receipt = offlineReceipt(saved, offline.kit, model.register?.name, model.cashier.cashier?.name, model.currency, model.timeZone)
                scope.launch { printProblem = model.print(if (gift) receipt.copy(banner = "GIFT RECEIPT") else receipt, openDrawer = !gift && card == null, gift = gift) }
              }
              OutlinedButton(onClick = { print(false) }, modifier = Modifier.testTag("offline-print")) { Text("Print receipt") }
              OutlinedButton(onClick = { print(true) }, modifier = Modifier.testTag("offline-gift")) { Text("Gift receipt") }
            }
          }
        } else if (totals != null) {
          // The selected segment wears the brand's container, not Material's default secondary (pink) one.
          val segmentColors = SegmentedButtonDefaults.colors(
            activeContainerColor = MaterialTheme.colorScheme.primaryContainer,
            activeContentColor = MaterialTheme.colorScheme.onPrimaryContainer,
          )
          SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().testTag("offline-tender")) {
            SegmentedButton(tender == OfflineTender.CASH, onClick = { tender = OfflineTender.CASH }, shape = SegmentedButtonDefaults.itemShape(0, 2), colors = segmentColors, enabled = !taking) { Text("Cash") }
            SegmentedButton(tender == OfflineTender.CARD, onClick = { tender = OfflineTender.CARD }, shape = SegmentedButtonDefaults.itemShape(1, 2), colors = segmentColors, enabled = !taking) { Text("Card") }
          }
          if (tender == OfflineTender.CASH) {
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
          } else {
            val reader = (readerState?.value as? CardCollectorState.Connected)?.label ?: "Not connected"
            AmountRow("Card reader", reader)
            when {
              taking -> Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag("offline-card-prompt")) {
                CircularProgressIndicator(Modifier.padding(space(0.5f)))
                Text(prompt?.value ?: "Present the card.")
              }
              cardRefusal != null -> NoticeBanner(cardRefusal, StatusTone.WARNING, Modifier.testTag("offline-card-refusal"))
              else -> NoticeBanner(
                offlineCardLimitsNote(
                  (offline.kit?.card?.maxSaleCents ?: 0.0).toLong(),
                  (offline.kit?.card?.maxDeviceDailyCents ?: 0.0).toLong(),
                  ::fmt,
                ),
                StatusTone.INFO,
              )
            }
          }
          failed?.let { NoticeBanner(it, StatusTone.ERROR) }
        }
      }
    },
    confirmButton = {
      when {
        rung != null -> Button(onClick = done, modifier = Modifier.testTag("offline-done")) { Text("New sale") }
        tender == OfflineTender.CASH -> Button(
          onClick = {
            failed = null
            val made = model.takeOfflineCash(sold, tendered)
            if (made == null) failed = "This register could not save the sale. Do not take the cash; try again." else rung = made
          },
          enabled = totals != null && tendered >= owed && !offline.discountOverLimit(sold),
          modifier = Modifier.testTag("offline-take-cash"),
        ) { Text("Take cash") }
        taking -> OutlinedButton(onClick = { scope.launch { model.cardCollector?.cancel() } }, modifier = Modifier.testTag("offline-cancel-card")) { Text("Cancel the card") }
        else -> Button(
          onClick = {
            failed = null
            taking = true
            scope.launch {
              when (val result = model.takeOfflineCard(sold)) {
                is RegisterModel.OfflineCardResult.Rung -> rung = result.rung
                RegisterModel.OfflineCardResult.Canceled -> Unit
                is RegisterModel.OfflineCardResult.Failed -> failed = result.message
              }
              taking = false
            }
          },
          enabled = totals != null && cardRefusal == null,
          modifier = Modifier.testTag("offline-take-card"),
        ) { Text("Take card") }
      }
    },
    dismissButton = if (rung == null && !taking) ({ TextButton(onClick = done) { Text("Cancel") } }) else null,
  )
}

/** "3 sales ($74.37) waiting to sync, 1 of them a card to charge ($24.79)." */
private fun waitingSummary(model: RegisterModel): String {
  val offline = model.offline
  val waiting = offline.waiting
  val cards = offline.waitingCards
  val head = "${plural(waiting.size, "sale", "sales")} (${money(offline.waitingCents, model.currency)}) waiting to sync"
  if (cards.isEmpty()) return "$head."
  val tail = if (cards.size == waiting.size) {
    if (cards.size == 1) "a card to charge" else "all cards to charge"
  } else {
    "${cards.size} of them ${if (cards.size == 1) "a card" else "cards"} to charge (${money(offline.waitingCardCents, model.currency)})"
  }
  return "$head, $tail."
}

/** Reconnect soon: the cards on this device are charged only once Stripe has them. */
private fun reconnectMessage(oldestMs: Double, model: RegisterModel): String {
  val count = model.offline.queue.count { it.cardOnDevice }
  val cards = if (count == 1) "1 card taken offline is" else "$count cards taken offline are"
  if (model.offline.cardsWaitedTooLong) return "$cards still on this device after more than a day. Reconnect now so they can be charged."
  val by = formatReceiptTime((oldestMs + com.aglyn.contracts.Contracts.posOfflineCardReconnectWithinMs).toLong(), model.timeZone)
  return "$cards saved on this device and charged once it reconnects. Reconnect within a day, by $by."
}

/** The words for a card taken offline that was never paid. */
private fun declinedCardMessage(notice: PosOfflineSyncNotice, model: RegisterModel): String {
  val card = offlineCardLabel(notice.card?.brand, notice.card?.last4)
  val order = notice.number?.let { "Order #$it" } ?: "The order"
  val what = if (PosOfflineFlag.CARD_DECLINED in notice.flags) "was declined when it was charged" else "could not be charged"
  return "A ${money(notice.totalCents, model.currency)} card sale ($card) rung offline ${formatReceiptTime(notice.soldAtMs.toLong(), model.timeZone)} $what. $order is unpaid: collect it another way."
}

/** Exact, and the next few round amounts a customer hands over. */
fun offlineQuickAmounts(owed: Long): List<Long> =
  listOf(owed, (owed + 499) / 500 * 500, (owed + 999) / 1000 * 1000, (owed + 1999) / 2000 * 2000).filter { it >= owed }.distinct().take(4)

/** The card banner's words: the limit per sale, and the daily limit per device when the store set one (0 is none). */
fun offlineCardLimitsNote(perSaleCents: Long, perDayCents: Long, money: (Long) -> String): String =
  "The card is saved on this register and charged when the connection returns. Offline, a card sale can be up to ${money(perSaleCents)}" +
    if (perDayCents > 0) ", and this device can take up to ${money(perDayCents)} in cards a day." else "."
