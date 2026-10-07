package com.aglyn.plugins.commerce.pos

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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import com.aglyn.hardware.renderText
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AmountRow
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.Skeleton
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/*
 * CHECKOUT, on screen: the sale the server priced, a tip, a tender, and the
 * receipt. Every press goes through [Checkout], which holds the rules.
 */

@Composable
internal fun CheckoutPane(model: RegisterModel, checkout: Checkout, onOpenReaders: () -> Unit) {
  val state by checkout.state.collectAsState()
  val scope = rememberCoroutineScope()
  val fmt = { cents: Long -> money(cents, model.currency) }
  val receiptStep = state.step as? CheckoutStep.Receipt
  LaunchedEffect(receiptStep != null) { if (receiptStep != null) model.loadReceipt(state.opened.orderId) }

  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("pos-checkout"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    Text(
      if (receiptStep != null) "Paid" else "Checkout",
      style = MaterialTheme.typography.titleLarge,
      modifier = Modifier.semantics { heading() },
    )
    if (receiptStep == null) {
      SectionCard(null, Modifier.fillMaxWidth()) {
        state.opened.subtotalCents?.let { AmountRow("Subtotal", fmt(it), muted = true) }
        state.opened.discountCents?.takeIf { it > 0 }?.let { AmountRow("Discount", "-${fmt(it)}", muted = true) }
        state.opened.taxCents?.let { AmountRow("Tax", fmt(it), muted = true) }
        AmountRow("Total", fmt(state.sale.totalCents))
        if (state.sale.paidCents > 0) AmountRow("Paid", fmt(state.sale.paidCents), muted = true)
        HorizontalDivider()
        AmountRow("Due", fmt(state.dueCents), emphasized = true, modifier = Modifier.testTag("pos-due"))
      }
    }
    state.notice?.let { notice ->
      NoticeBanner(
        notice.message,
        notice.tone.status(),
        Modifier.testTag("checkout-notice"),
        action = if (state.lost) {
          { TextButton(onClick = { scope.launch { checkout.recheck() } }, enabled = !state.busy) { Text("Check the sale") } }
        } else {
          null
        },
      )
    }
    when (val step = state.step) {
      CheckoutStep.Tender -> TenderStep(model, checkout, state, fmt, onOpenReaders)
      CheckoutStep.Cash -> CashStep(checkout, state, fmt)
      CheckoutStep.GiftCard -> GiftCardStep(checkout, state)
      is CheckoutStep.Card -> CardStep(model, checkout, state, step, fmt)
      is CheckoutStep.Receipt -> ReceiptStep(model, checkout, state, step, fmt)
    }
  }
}

@Composable
private fun TenderStep(model: RegisterModel, checkout: Checkout, state: CheckoutState, fmt: (Long) -> String, onOpenReaders: () -> Unit) {
  val scope = rememberCoroutineScope()
  val tips = checkout.tips()
  if (tips.isNotEmpty()) {
    Section("Tip") {
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
          onClick = { scope.launch { checkout.payCard(reader) } },
          enabled = state.canTender,
          modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("tender-card-${reader.id}"),
        ) {
          Icon(AglynIcons.named("contactless"), null)
          Spacer(Modifier.width(space(1f)))
          Text("Card on ${reader.label}", style = MaterialTheme.typography.titleSmall)
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
          onClick = { checkout.goTo(CheckoutStep.Cash) },
          enabled = state.canTender,
          modifier = Modifier.weight(1f).heightIn(min = 56.dp).testTag("tender-cash"),
        ) {
          Icon(AglynIcons.named("payments"), null)
          Spacer(Modifier.width(space(1f)))
          Text("Cash")
        }
        FilledTonalButton(
          onClick = { checkout.goTo(CheckoutStep.GiftCard) },
          enabled = state.canTender,
          modifier = Modifier.weight(1f).heightIn(min = 56.dp).testTag("tender-gift"),
        ) {
          Icon(AglynIcons.named("card_giftcard"), null)
          Spacer(Modifier.width(space(1f)))
          Text("Gift card")
        }
      }
    }
  }
  if (state.busy) CircularProgressIndicator(Modifier.size(28.dp))
  TextButton(
    onClick = { scope.launch { if (checkout.void()) model.voided() } },
    enabled = !state.busy && state.sale.paidCents == 0L,
    modifier = Modifier.testTag("pos-void"),
  ) {
    Icon(AglynIcons.named("close"), null, Modifier.size(18.dp))
    Spacer(Modifier.width(space(0.5f)))
    Text("Cancel sale")
  }
}

@Composable
private fun CashStep(checkout: Checkout, state: CheckoutState, fmt: (Long) -> String) {
  val scope = rememberCoroutineScope()
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
      onClick = { typed?.let { scope.launch { checkout.payCash(it) } } },
      enabled = state.canTender && (typed ?: 0) >= owed,
      modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("pos-take-cash"),
    ) { Text("Take ${fmt(owed)} in cash") }
  }
}

@Composable
private fun GiftCardStep(checkout: Checkout, state: CheckoutState) {
  val scope = rememberCoroutineScope()
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
    OutlinedButton(onClick = { scope.launch { checkout.checkGiftCard(code) } }, enabled = code.isNotBlank() && !state.busy, modifier = Modifier.heightIn(min = 52.dp)) {
      Text("Check balance")
    }
    Button(onClick = { scope.launch { checkout.payGiftCard(code) } }, enabled = code.isNotBlank() && state.canTender, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
      Text("Apply")
    }
  }
}

@Composable
private fun CardStep(model: RegisterModel, checkout: Checkout, state: CheckoutState, step: CheckoutStep.Card, fmt: (Long) -> String) {
  val scope = rememberCoroutineScope()
  val reader = model.readers.firstOrNull { it.label == step.readerLabel }
  Column(
    Modifier.fillMaxWidth().padding(vertical = space(3f)).testTag("pos-card-waiting"),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    Box(contentAlignment = Alignment.Center) {
      CircularProgressIndicator(Modifier.size(88.dp), strokeWidth = 4.dp)
      Icon(AglynIcons.named("contactless"), null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.primary)
    }
    Text(fmt(state.amountCents + state.tipCents), style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
    Text(
      if (step.paymentId == null) "Sending the payment to ${step.readerLabel}…" else "Ask the customer to tap, insert or swipe on ${step.readerLabel}.",
      style = MaterialTheme.typography.bodyLarge,
      textAlign = TextAlign.Center,
    )
    OutlinedButton(onClick = { reader?.let { scope.launch { checkout.cancelCard(it) } } }, enabled = step.paymentId != null) { Text("Cancel payment") }
  }
}

@Composable
private fun ReceiptStep(model: RegisterModel, checkout: Checkout, state: CheckoutState, step: CheckoutStep.Receipt, fmt: (Long) -> String) {
  val scope = rememberCoroutineScope()
  val context = model.context
  val cash = state.sale.payments.any { it.method == "cash" && it.status == "succeeded" }
  Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Icon(AglynIcons.named("check_circle"), null, Modifier.size(56.dp), tint = MaterialTheme.colorScheme.primary)
    Text(fmt(state.sale.totalCents), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    if (step.changeCents > 0) {
      Text("Change due ${fmt(step.changeCents)}", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.testTag("pos-change"))
    }
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
        onClick = { scope.launch { if (checkout.sendReceipt("email", email)) model.finished() } },
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
        Button(onClick = { scope.launch { if (checkout.sendReceipt("sms", phone)) model.finished() } }, enabled = isReceiptPhone(phone) && !state.busy) { Text("Send") }
      }
    }
  }
  var printProblem by remember { mutableStateOf<String?>(null) }
  printProblem?.let { NoticeBanner(it, StatusTone.ERROR) }
  Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    if (model.peripherals.printers.isNotEmpty()) {
      OutlinedButton(
        onClick = {
          val receipt = model.receipt ?: return@OutlinedButton
          scope.launch {
            printProblem = model.print(receipt, openDrawer = cash)
            if (printProblem == null && checkout.sendReceipt("print")) model.finished()
          }
        },
        enabled = model.receipt != null,
        modifier = Modifier.heightIn(min = 52.dp),
      ) {
        Icon(AglynIcons.named("print"), null)
        Spacer(Modifier.width(space(0.5f)))
        Text("Print")
      }
    }
    Button(
      onClick = { scope.launch { if (checkout.sendReceipt("none")) model.finished() } },
      modifier = Modifier.weight(1f).heightIn(min = 52.dp).testTag("pos-new-sale"),
    ) { Text("No receipt · New sale") }
  }
}
