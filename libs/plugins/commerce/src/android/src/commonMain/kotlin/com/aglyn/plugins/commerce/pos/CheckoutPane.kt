package com.aglyn.plugins.commerce.pos

import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import com.aglyn.hardware.deviceReaders
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.TextButton
import kotlinx.coroutines.flow.MutableStateFlow
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aglyn.hardware.SystemPrintResult
import com.aglyn.hardware.renderText
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AmountRow
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.QrCodeImage
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusChip
import com.aglyn.ui.qrCodeFits
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import com.aglyn.ui.Skeleton
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

/*
 * CHECKOUT, on screen: the sale the server priced, a tip, a tender, and the
 * receipt. Every press goes through [Checkout], which holds the rules.
 */

@Composable
internal fun CheckoutPane(model: RegisterModel, checkout: Checkout, onOpenReaders: () -> Unit) {
  val state by checkout.state.collectAsState()
  val fmt = { cents: Long -> money(cents, model.currency) }
  val receiptStep = state.step as? CheckoutStep.Receipt
  LaunchedEffect(receiptStep != null) { if (receiptStep != null) model.loadReceipt(state.opened.orderId) }

  // The heading, and once paid the total and the change to hand back, stay put above what scrolls: the change due is what
  // the cashier reads while counting it out, so it never scrolls away under the header.
  Column(Modifier.fillMaxSize().testTag("pos-checkout")) {
    Column(
      Modifier.fillMaxWidth().padding(start = space(2f), end = space(2f), top = space(2f), bottom = space(1f)),
      verticalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      Text(
        if (receiptStep != null) "Paid" else "Checkout",
        style = MaterialTheme.typography.titleLarge,
        modifier = Modifier.semantics { heading() },
      )
      receiptStep?.let { PaidSummary(state, it, fmt) }
    }
    Column(
      Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = space(2f), end = space(2f), bottom = space(2f)),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      CheckoutBody(model, checkout, state, receiptStep, fmt, onOpenReaders)
    }
  }
}

@Composable
private fun PaidSummary(state: CheckoutState, step: CheckoutStep.Receipt, fmt: (Long) -> String) {
  Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Icon(AglynIcons.named("check_circle"), null, Modifier.size(56.dp), tint = MaterialTheme.colorScheme.primary)
    Text(fmt(state.sale.totalCents), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    if (step.changeCents > 0) {
      Text("Change due ${fmt(step.changeCents)}", style = MaterialTheme.typography.titleLarge, color = com.aglyn.ui.aglynAccentText, modifier = Modifier.testTag("pos-change"))
    }
  }
}

@Composable
private fun androidx.compose.foundation.layout.ColumnScope.CheckoutBody(
  model: RegisterModel,
  checkout: Checkout,
  state: CheckoutState,
  receiptStep: CheckoutStep.Receipt?,
  fmt: (Long) -> String,
  onOpenReaders: () -> Unit,
) {
    if (receiptStep == null) {
      SectionCard(null, Modifier.fillMaxWidth()) {
        state.opened.subtotalCents?.let { AmountRow("Subtotal", fmt(it), muted = true) }
        state.opened.discountCents?.takeIf { it > 0 }?.let { AmountRow("Discount", "-${fmt(it)}", muted = true) }
        state.opened.taxCents?.let { AmountRow("Tax", fmt(it), muted = true) }
        AmountRow("Total", fmt(state.sale.totalCents))
        if (state.sale.paidCents > 0) AmountRow("Paid", fmt(state.sale.paidCents), muted = true)
        HorizontalDivider()
        AmountRow("Due", fmt(state.sale.dueCents), emphasized = true, modifier = Modifier.testTag("pos-due"))
      }
    }
    state.notice?.let { notice ->
      NoticeBanner(
        notice.message,
        notice.tone.status(),
        Modifier.testTag("checkout-notice"),
        action = if (state.lost) {
          { TextButton(onClick = { model.act { checkout.recheck() } }, enabled = !state.busy) { Text("Check the sale") } }
        } else {
          null
        },
      )
    }
    when (val step = state.step) {
      CheckoutStep.Tender -> TenderStep(model, checkout, state, fmt, onOpenReaders)
      CheckoutStep.Cash -> CashStep(model, checkout, state, fmt)
      CheckoutStep.GiftCard -> GiftCardStep(model, checkout, state)
      is CheckoutStep.Credit -> CreditStep(model, checkout, state, step, fmt)
      CheckoutStep.Room -> RoomStep(model, checkout, state, fmt)
      is CheckoutStep.Qr -> QrStep(model, checkout, state, step, fmt)
      is CheckoutStep.Card -> CardStep(model, checkout, state, step, fmt)
      is CheckoutStep.Receipt -> ReceiptStep(model, checkout, state, step, fmt)
    }
}

@Composable
private fun TenderStep(model: RegisterModel, checkout: Checkout, state: CheckoutState, fmt: (Long) -> String, onOpenReaders: () -> Unit) {
  if (state.sale.payments.isNotEmpty()) {
    Section("Payments") {
      Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
        for (payment in state.sale.payments) PaymentRow(model, checkout, state, payment, fmt)
      }
    }
  }
  if (state.dueCents <= 0) return
  val tips = checkout.tips()
  if (tips.isNotEmpty()) {
    Section("Tip") {
      if (model.display.connected) {
        TextButton(
          onClick = { model.act { model.askTipOnDisplay() } },
          enabled = model.display.asking == null && !state.busy,
          modifier = Modifier.testTag("tip-ask-display"),
        ) { Text(if (model.display.asking == com.aglyn.contracts.PosDisplayMode.TIP) "Waiting for the customer…" else "Ask on display") }
      }
      ChoiceChipRow(
        tips.map { ChipOption(it.id, if (it.cents > 0) "${it.label} · ${fmt(it.cents)}" else it.label) },
        state.tipId,
        { id -> tips.firstOrNull { it.id == id }?.let(checkout::chooseTip) },
        wrap = true,
      )
    }
  }
  var part by remember(state.sale.dueCents) { mutableStateOf("") }
  Section("Pay part of it (split)") {
    OutlinedTextField(
      value = part,
      onValueChange = { part = it; checkout.setPart(centsFromText(it)) },
      placeholder = { Text(amountText(state.dueCents)) },
      prefix = { Text("$") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
      supportingText = { Text(if (state.isSplit) "${fmt(state.dueCents - state.amountCents)} stays due for the next tender." else "Leave empty to pay the whole balance.") },
      modifier = Modifier.fillMaxWidth().testTag("pos-split"),
    )
  }
  val charge = state.amountCents + state.tipCents
  Section("Take ${fmt(charge)}") {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      for (reader in model.readers) {
        Button(
          onClick = { model.act { checkout.payCard(reader) } },
          enabled = state.canTender,
          modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("tender-card-${reader.id}"),
        ) {
          Icon(AglynIcons.named("contactless"), null)
          Spacer(Modifier.width(space(1f)))
          Text("Card on ${reader.label}", style = MaterialTheme.typography.titleSmall)
        }
      }
      model.keyedCard?.let { keyed ->
        Button(
          onClick = { model.act { checkout.payCard(keyed) } },
          enabled = state.canTender,
          modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("tender-card-${keyed.id}"),
        ) {
          Icon(AglynIcons.named("credit_card"), null)
          Spacer(Modifier.width(space(1f)))
          Text(keyed.label, style = MaterialTheme.typography.titleSmall)
        }
      }
      if (model.readers.isEmpty()) {
        NoticeBanner(
          "No card reader is ready on this register.",
          StatusTone.NEUTRAL,
          action = { TextButton(onClick = onOpenReaders) { Text("Card readers") } },
        )
      }
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        FilledTonalButton(
          colors = com.aglyn.ui.aglynTonalButtonColors(),
          onClick = { checkout.goTo(CheckoutStep.Cash) },
          enabled = state.canTender,
          modifier = Modifier.weight(1f).heightIn(min = 56.dp).testTag("tender-cash"),
        ) {
          Icon(AglynIcons.named("payments"), null)
          Spacer(Modifier.width(space(1f)))
          Text("Cash")
        }
        FilledTonalButton(
          colors = com.aglyn.ui.aglynTonalButtonColors(),
          onClick = { checkout.goTo(CheckoutStep.GiftCard) },
          enabled = state.canTender,
          modifier = Modifier.weight(1f).heightIn(min = 56.dp).testTag("tender-gift"),
        ) {
          Icon(AglynIcons.named("card_giftcard"), null)
          Spacer(Modifier.width(space(1f)))
          Text("Gift card")
        }
      }
      val credits = model.context?.credits ?: emptyList()
      androidx.compose.foundation.layout.FlowRow(
        horizontalArrangement = Arrangement.spacedBy(space(1f)),
        verticalArrangement = Arrangement.spacedBy(space(1f)),
      ) {
        FilledTonalButton(
          colors = com.aglyn.ui.aglynTonalButtonColors(),
          onClick = { model.act { checkout.payLink() } },
          enabled = state.canTender,
          modifier = Modifier.heightIn(min = 56.dp).testTag("tender-qr"),
        ) {
          Icon(AglynIcons.named("qr_code_scanner"), null)
          Spacer(Modifier.width(space(1f)))
          Text("Card (QR)")
        }
        for (provider in credits) {
          FilledTonalButton(
            colors = com.aglyn.ui.aglynTonalButtonColors(),
            onClick = {
              checkout.clearCreditLookup()
              checkout.goTo(CheckoutStep.Credit(provider.providerId))
            },
            enabled = state.canTender,
            modifier = Modifier.heightIn(min = 56.dp).testTag("tender-credit-${provider.providerId}"),
          ) {
            Icon(AglynIcons.named("card_giftcard"), null)
            Spacer(Modifier.width(space(1f)))
            Text(provider.label)
          }
        }
        if (model.stays.isNotEmpty()) {
          FilledTonalButton(
            colors = com.aglyn.ui.aglynTonalButtonColors(),
            onClick = { checkout.goTo(CheckoutStep.Room) },
            enabled = state.canTender,
            modifier = Modifier.heightIn(min = 56.dp).testTag("tender-room"),
          ) {
            Icon(AglynIcons.named("hotel"), null)
            Spacer(Modifier.width(space(1f)))
            Text("Room")
          }
        }
      }
    }
  }
  if (state.busy) CircularProgressIndicator(Modifier.size(28.dp))
  TextButton(
    onClick = { model.act { if (checkout.void()) model.voided() } },
    enabled = !state.busy && state.sale.paidCents == 0L,
    modifier = Modifier.testTag("pos-void"),
  ) {
    Icon(AglynIcons.named("close"), null, Modifier.size(18.dp))
    Spacer(Modifier.width(space(0.5f)))
    Text("Cancel sale")
  }
}

/** One payment on the sale: what it was, its status, and what can still be done with it. */
@Composable
private fun PaymentRow(model: RegisterModel, checkout: Checkout, state: CheckoutState, payment: PosSalePayment, fmt: (Long) -> String) {
  Column(Modifier.fillMaxWidth().testTag("pos-payment-${payment.id}"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(
        describePayment(payment, fmt) + if (payment.changeCents > 0) " · change ${fmt(payment.changeCents)}" else "",
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.weight(1f),
      )
      StatusChip(
        paymentStatusLabel(payment.status),
        when (payment.status) {
          "succeeded" -> StatusTone.SUCCESS
          "failed" -> StatusTone.ERROR
          "pending" -> StatusTone.INFO
          "reversed" -> StatusTone.WARNING
          else -> StatusTone.NEUTRAL
        },
      )
    }
    if (payment.status == "failed") {
      payment.failureMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
    }
    if (payment.status == "pending" && payment.method.startsWith("card")) {
      Row {
        TextButton(onClick = { model.act { checkout.recheck() } }, enabled = !state.busy) { Text("Check") }
        if (payment.method == "card_link" && payment.checkoutUrl != null) {
          TextButton(onClick = { checkout.showLink(payment) }, modifier = Modifier.testTag("show-qr")) { Text("Show QR") }
        }
        if (payment.method == "card_present" && payment.livemode == false && model.context?.testMode == true) {
          TextButton(
            onClick = { model.act { checkout.simulateTap(payment.id) } },
            enabled = !state.busy,
            modifier = Modifier.testTag("simulate-tap"),
          ) { Text("Simulate tap") }
        }
        TextButton(onClick = { model.act { checkout.cancelPending(payment.id) } }, enabled = !state.busy, modifier = Modifier.testTag("pos-in-flight")) { Text("Stop it") }
      }
    }
    if (payment.status == "failed" && payment.method == "card_present") {
      TextButton(onClick = { model.act { checkout.retryReaderPayment(payment.id) } }, enabled = state.canTender) { Text("Retry") }
    }
  }
}

@Composable
private fun CashStep(model: RegisterModel, checkout: Checkout, state: CheckoutState, fmt: (Long) -> String) {
  val owed = state.amountCents + state.tipCents
  var text by remember { mutableStateOf("") }
  val typed = centsFromText(text)
  Section("Cash handed over") {
    ChoiceChipRow(
      cashQuickAmounts(owed).map { ChipOption(it.toString(), if (it == owed) "Exact ${fmt(it)}" else fmt(it)) },
      typed?.toString(),
      { text = amountText(it.toLong()) },
      wrap = true,
    )
    OutlinedTextField(
      value = text,
      onValueChange = { text = it },
      prefix = { Text("$") },
      label = { Text("Amount received") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
      modifier = Modifier.fillMaxWidth().testTag("pos-cash-field"),
    )
    if (typed != null && typed >= owed) {
      AmountRow("Change", fmt(typed - owed), emphasized = true, modifier = Modifier.testTag("pos-change-preview"))
    }
  }
  Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    OutlinedButton(onClick = { checkout.goTo(CheckoutStep.Tender) }, modifier = Modifier.heightIn(min = 52.dp)) { Text("Back") }
    Button(
      onClick = { typed?.let { model.act { checkout.payCash(it) } } },
      enabled = state.canTender && (typed ?: 0) >= owed,
      modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("pos-take-cash"),
    ) { Text("Take ${fmt(owed)} in cash") }
  }
}

@Composable
private fun GiftCardStep(model: RegisterModel, checkout: Checkout, state: CheckoutState) {
  var code by remember { mutableStateOf("") }
  Section("Gift card") {
    OutlinedTextField(
      value = code,
      onValueChange = { code = it.uppercase() },
      label = { Text("Gift card code") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
      modifier = Modifier.fillMaxWidth().testTag("pos-gift-code"),
    )
    state.giftBalance?.let { NoticeBanner(it, StatusTone.INFO) }
  }
  Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    OutlinedButton(onClick = { checkout.goTo(CheckoutStep.Tender) }, modifier = Modifier.heightIn(min = 52.dp)) { Text("Back") }
    OutlinedButton(onClick = { model.act { checkout.checkGiftCard(code) } }, enabled = code.isNotBlank() && !state.busy, modifier = Modifier.heightIn(min = 52.dp)) {
      Text("Check balance")
    }
    Button(onClick = { model.act { checkout.payGiftCard(code) } }, enabled = code.isNotBlank() && state.canTender, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
      Text("Apply")
    }
  }
}

/** Store credit another plugin keeps: the customer reads out a code, or staff find the account by email or code. */
@Composable
private fun CreditStep(model: RegisterModel, checkout: Checkout, state: CheckoutState, step: CheckoutStep.Credit, fmt: (Long) -> String) {
  val provider = model.context?.credits?.firstOrNull { it.providerId == step.providerId }
  var query by remember { mutableStateOf("") }
  Section(provider?.label ?: "Store credit") {
    OutlinedTextField(
      value = query,
      onValueChange = {
        query = it
        checkout.clearCreditLookup()
      },
      label = { Text(if (provider?.lookup == true) "Code or customer email" else "Code") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
      modifier = Modifier.fillMaxWidth().testTag("pos-credit-query"),
    )
    val found = state.creditAccounts
    if (found != null && found.isEmpty()) NoticeBanner("No account matches.", StatusTone.INFO)
    for (account in found ?: emptyList()) {
      OutlinedButton(
        onClick = { model.act { checkout.payCredit(step.providerId, account) } },
        enabled = state.canTender && account.availableCents > 0,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("credit-account-${account.reference}"),
      ) {
        Column(Modifier.fillMaxWidth()) {
          Text("${account.label}${if (account.last4.isEmpty()) "" else " •• ${account.last4}"} · ${fmt(account.availableCents)} available", style = MaterialTheme.typography.titleSmall)
          account.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
      }
    }
  }
  Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    OutlinedButton(
      onClick = {
        checkout.clearCreditLookup()
        checkout.goTo(CheckoutStep.Tender)
      },
      modifier = Modifier.heightIn(min = 52.dp),
    ) { Text("Back") }
    if (provider?.lookup == true) {
      OutlinedButton(
        onClick = { model.act { checkout.lookUpCredit(step.providerId, query) } },
        enabled = query.isNotBlank() && !state.busy,
        modifier = Modifier.heightIn(min = 52.dp),
      ) { Text("Find") }
    }
    Button(
      onClick = {
        val code = query
        query = ""
        model.act { checkout.payCredit(code) }
      },
      enabled = query.isNotBlank() && '@' !in query && state.canTender,
      modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("pos-credit-apply"),
    ) { Text("Apply code") }
  }
}

/** Charge to a checked-in stay's folio. */
@Composable
private fun RoomStep(model: RegisterModel, checkout: Checkout, state: CheckoutState, fmt: (Long) -> String) {
  // Guests come and go: the list is read again as the room charge opens.
  LaunchedEffect(Unit) { model.loadStays() }
  Section("Charge to room — ${fmt(state.amountCents)}") {
    for (stay in model.stays) {
      OutlinedButton(
        onClick = { model.act { checkout.payFolio(stay.id) } },
        enabled = state.canTender,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("room-${stay.id}"),
      ) { Text(stay.name, Modifier.fillMaxWidth(), textAlign = TextAlign.Start) }
    }
    if (model.stays.isEmpty()) Text("Nobody is checked in.", color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
  OutlinedButton(onClick = { checkout.goTo(CheckoutStep.Tender) }, modifier = Modifier.heightIn(min = 52.dp)) { Text("Back") }
}

/** The QR payment page: the customer scans it and pays on their phone; the payment shows here as soon as it goes through. */
@Composable
private fun QrStep(model: RegisterModel, checkout: Checkout, state: CheckoutState, step: CheckoutStep.Qr, fmt: (Long) -> String) {
  LaunchedEffect(step.paymentId) {
    while (isActive) {
      delay(2_000)
      checkout.pollLink()
    }
  }
  Column(
    Modifier.fillMaxWidth().padding(vertical = space(2f)).testTag("pos-qr"),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    Text("Scan to pay ${fmt(step.amountCents)}", style = MaterialTheme.typography.titleLarge)
    Text(
      "The customer scans this and pays on their phone. The payment shows here as soon as it goes through.",
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
    )
    if (qrCodeFits(step.url)) {
      QrCodeImage(step.url, size = 256.dp)
    } else {
      NoticeBanner("This payment page is too long to draw as a QR code.", StatusTone.WARNING)
    }
    OutlinedButton(onClick = { model.act { checkout.cancelLink() } }, enabled = !state.busy, modifier = Modifier.testTag("pos-qr-close")) { Text("Close") }
  }
}

@Composable
private fun CardStep(model: RegisterModel, checkout: Checkout, state: CheckoutState, step: CheckoutStep.Card, fmt: (Long) -> String) {
  val reader = model.cardService(step.readerLabel)
  val typed = reader is KeyedCardService
  // A device reader says what it wants ("Insert the card."); a smart reader shows it on its own screen.
  val devicePrompt by (
    (if (reader is DeviceReaderService) model.cardCollector?.deviceReaders?.prompt else null)
      ?: remember { MutableStateFlow<String?>(null) }
    ).collectAsState()
  Column(
    Modifier.fillMaxWidth().padding(vertical = space(3f)).testTag("pos-card-waiting"),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    Box(contentAlignment = Alignment.Center) {
      CircularProgressIndicator(Modifier.size(88.dp), strokeWidth = 4.dp)
      Icon(AglynIcons.named(if (typed) "credit_card" else "contactless"), null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.primary)
    }
    Text(fmt(state.amountCents + state.tipCents), style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
    Text(
      when {
        step.paymentId == null -> "Sending the payment to ${step.readerLabel}…"
        reader is KeyedCardService -> reader.prompt
        else -> "Ask the customer to tap, insert or swipe on ${step.readerLabel}."
      },
      style = MaterialTheme.typography.bodyLarge,
      textAlign = TextAlign.Center,
    )
    devicePrompt?.let {
      Text(
        it,
        style = MaterialTheme.typography.titleMedium,
        color = com.aglyn.ui.aglynAccentText,
        textAlign = TextAlign.Center,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("pos-reader-prompt"),
      )
    }
    val waiting = step.paymentId
    if (waiting != null && reader?.kind == CardReaderKind.SMART && model.context?.testMode == true) {
      OutlinedButton(onClick = { model.act { checkout.simulateTapOnReader(waiting) } }, modifier = Modifier.testTag("simulate-tap")) {
        Text("Simulate a card tap (test mode)")
      }
    }
    OutlinedButton(onClick = { reader?.let { model.act { checkout.cancelCard(it) } } }, enabled = step.paymentId != null) { Text("Cancel payment") }
  }
}

@Composable
private fun ReceiptStep(model: RegisterModel, checkout: Checkout, state: CheckoutState, step: CheckoutStep.Receipt, fmt: (Long) -> String) {
  val context = model.context
  val cash = state.sale.payments.any { it.method == "cash" && it.status == "succeeded" }
  // Once per sale: when the store asks, the receipt choice goes to the customer's screen.
  LaunchedEffect(checkout) { model.askReceiptOnDisplay(checkout) }
  // A store that always prints: the receipt prints as soon as the sale is paid (a direct printer waits for the sale's read).
  LaunchedEffect(checkout, model.receipt != null, model.lastReceipt.hasPrinter) { model.printReceiptByDefault(checkout) }
  if (model.display.asking == com.aglyn.contracts.PosDisplayMode.RECEIPT) {
    NoticeBanner("The customer is choosing a receipt on the display…", StatusTone.INFO)
  }
  SectionCard("Receipt", Modifier.fillMaxWidth()) {
    val receipt = model.receipt
    if (receipt == null) {
      repeat(4) { Skeleton(Modifier.fillMaxWidth(), 14.dp) }
    } else {
      Text(
        renderText(layoutReceipt(receipt, ReceiptLayoutOptions(columns = 40))).trimEnd(),
        fontFamily = FontFamily.Monospace,
        style = MaterialTheme.typography.bodySmall,
        softWrap = false,
        modifier = Modifier.horizontalScroll(rememberScrollState()).testTag("pos-receipt-preview"),
      )
    }
  }
  var email by remember { mutableStateOf(model.cart.customerEmail) }
  Section("Email the receipt") {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedTextField(
        value = email,
        onValueChange = { email = it },
        placeholder = { Text("customer@example.com") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        modifier = Modifier.weight(1f).testTag("pos-receipt-email"),
      )
      Button(
        onClick = { model.display.cancelAsk(); model.act { if (checkout.sendReceipt("email", email)) model.finished() } },
        enabled = isReceiptEmail(email) && !state.busy && model.online,
      ) { Text("Send") }
    }
  }
  if (context?.smsReceipts == true) {
    var phone by remember { mutableStateOf("") }
    Section("Text the receipt") {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(
          value = phone,
          onValueChange = { phone = it },
          placeholder = { Text("+1 555 123 4567") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
          modifier = Modifier.weight(1f),
        )
        Button(onClick = { model.display.cancelAsk(); model.act { if (checkout.sendReceipt("sms", phone)) model.finished() } }, enabled = isReceiptPhone(phone) && !state.busy) { Text("Send") }
      }
    }
  }
  var printProblem by remember { mutableStateOf<String?>(null) }
  printProblem?.let { NoticeBanner(it, StatusTone.ERROR) }
  Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    if (model.canPrintReceipt) {
      OutlinedButton(
        onClick = {
          model.display.cancelAsk()
          model.act {
            when (val result = model.printReceipt(checkout)) {
              SystemPrintResult.Printed -> model.finished()
              SystemPrintResult.Canceled -> printProblem = null
              is SystemPrintResult.Failed -> printProblem = result.message
            }
          }
        },
        enabled = (model.receipt != null || (model.peripherals.printers.isEmpty() && model.lastReceipt.hasPrinter)) && !state.busy,
        modifier = Modifier.heightIn(min = 52.dp).testTag("pos-print-receipt"),
      ) {
        Icon(AglynIcons.named("print"), null)
        Spacer(Modifier.width(space(0.5f)))
        Text("Print")
      }
    }
    if (model.peripherals.printers.isNotEmpty() || model.peripherals.systemPrinter != null) {
      // The items and the barcode a recipient returns with, and no price.
      OutlinedButton(
        onClick = {
          model.display.cancelAsk()
          model.act { (model.printReceipt(checkout, gift = true) as? SystemPrintResult.Failed)?.let { printProblem = it.message } }
        },
        enabled = model.receipt != null && !state.busy,
        modifier = Modifier.heightIn(min = 52.dp).testTag("pos-gift-receipt"),
      ) {
        Icon(AglynIcons.named("card_giftcard"), null)
        Spacer(Modifier.width(space(0.5f)))
        Text("Gift receipt")
      }
    }
    Button(
      onClick = { model.display.cancelAsk(); model.act { if (checkout.sendReceipt("none")) model.finished() } },
      modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("pos-new-sale"),
    ) { Text(if (state.printed) "New sale" else "No receipt · New sale") }
  }
}
