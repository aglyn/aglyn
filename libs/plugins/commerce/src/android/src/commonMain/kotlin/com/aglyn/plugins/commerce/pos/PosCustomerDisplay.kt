package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aglyn.contracts.PosDeviceMode
import com.aglyn.contracts.PosDisplayCart
import com.aglyn.contracts.PosDisplayResponseTipChoice
import com.aglyn.contracts.PosDisplayStateReceipt
import com.aglyn.contracts.PosDisplayStateTip
import com.aglyn.contracts.PosReceiptChannel
import com.aglyn.contracts.posDisplayEmail
import com.aglyn.contracts.posDisplayPhone
import com.aglyn.contracts.posTipProblem
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.KeepScreenOn
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/*
 * THE CUSTOMER DISPLAY (AGL-3608), full screen on the tablet facing the customer.
 * The Apple app's `PosCustomerDisplayView.swift`. The console's display page,
 * native: pairing by code, the store's idle and thank-you screens, the basket as
 * the cashier builds it, the tip prompt, the receipt prompt, and a processing
 * screen while a card waits on the reader. The customer's typed address lives in
 * this view only until it is sent; every screen is keyed by its prompt, so the
 * next customer finds nothing of the last one's.
 */

const val COMMERCE_DISPLAY_SCREEN = "commerce.display"

@Composable
fun PosCustomerDisplayScreen(context: NativePluginContext) {
  val model = remember { PosCustomerDisplayModel(ConsolePosDeviceApi(context.api), PosDeviceTokenStore(context.deviceStore, PosDeviceMode.DISPLAY)) }
  val scope = rememberCoroutineScope()
  // A display facing the customer must not dim or lock between sales.
  KeepScreenOn()
  LaunchedEffect(Unit) { model.start() }
  LaunchedEffect(model.token) {
    if (model.token == null) return@LaunchedEffect
    while (isActive) {
      model.poll()
      delay(model.pollDelayMs)
    }
  }
  Surface(Modifier.fillMaxSize().testTag("pos-customer-display"), color = MaterialTheme.colorScheme.background) {
    Box(Modifier.fillMaxSize()) {
      when {
        !model.started -> CircularProgressIndicator(Modifier.align(Alignment.Center))
        model.token == null -> PosDevicePairing(
          mode = PosDeviceMode.DISPLAY,
          busy = model.pairing,
          error = model.pairError,
          onPair = { code -> scope.launch { model.pair(code) } },
          onLeave = context::back,
        )
        else -> {
          Column(Modifier.fillMaxSize()) {
            if (model.offline) NoticeBanner("Reconnecting…", StatusTone.WARNING, Modifier.padding(space(1f)))
            key(model.view?.state?.mode, model.view?.state?.promptId) { DisplayBody(model) }
          }
          UnpairControl(model, Modifier.align(Alignment.BottomEnd))
        }
      }
    }
  }
}

@Composable
private fun DisplayBody(model: PosCustomerDisplayModel) {
  val scope = rememberCoroutineScope()
  when (val screen = model.screen) {
    PosDisplayScreen.Idle -> PosDeviceBrandScreen(model.branding, title = null, message = model.branding?.message ?: "Welcome")
    PosDisplayScreen.Thanks -> PosDeviceBrandScreen(model.branding, title = "Thank you!", message = null)
    is PosDisplayScreen.Processing -> PosDeviceBrandScreen(
      model.branding,
      title = screen.message,
      message = screen.totalCents?.let { "Total ${money(it, model.currency)}" },
      busy = true,
    )
    PosDisplayScreen.Answered -> PosDeviceBrandScreen(model.branding, title = "Thanks — the cashier will finish up", message = null)
    is PosDisplayScreen.Cart -> DeviceScroll(model.branding, model.notice) { DisplayCartView(screen.cart, model.currency) }
    is PosDisplayScreen.Tip -> DeviceScroll(model.branding, model.notice) {
      DisplayTipView(screen.tip, model.currency, model.busy) { answer -> scope.launch { model.answer(answer.copy(promptId = screen.promptId)) } }
    }
    is PosDisplayScreen.Receipt -> DeviceScroll(model.branding, model.notice) {
      DisplayReceiptView(screen.receipt, model.busy) { answer -> scope.launch { model.answer(answer.copy(promptId = screen.promptId)) } }
    }
  }
}

/** A prompt's layout: the store's mark, the cashier-side notice, then the screen. */
@Composable
fun DeviceScroll(branding: PosDeviceBranding?, notice: String?, content: @Composable () -> Unit) {
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 720.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(4f)),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(space(4f)),
    ) {
      PosDeviceBrandMark(branding)
      notice?.let { NoticeBanner(it, StatusTone.INFO, Modifier.fillMaxWidth()) }
      content()
    }
  }
}

/** The store's logo, or its name. */
@Composable
fun PosDeviceBrandMark(branding: PosDeviceBranding?, modifier: Modifier = Modifier) {
  val logo = (if (androidx.compose.foundation.isSystemInDarkTheme()) branding?.logoDarkUrl else null) ?: branding?.logoUrl
  if (logo != null) {
    RemoteImage(logo, branding?.name, modifier.heightIn(max = 72.dp), contentScale = ContentScale.Fit, icon = "storefront")
  } else if (!branding?.name.isNullOrEmpty()) {
    Text(branding!!.name, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = modifier)
  }
}

/** The idle, thank-you and processing screens: the store's mark and one line. */
@Composable
fun PosDeviceBrandScreen(branding: PosDeviceBranding?, title: String?, message: String?, busy: Boolean = false, extra: @Composable () -> Unit = {}) {
  Column(
    Modifier.fillMaxSize().padding(space(4f)),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(space(3f), Alignment.CenterVertically),
  ) {
    PosDeviceBrandMark(branding, Modifier.heightIn(max = 120.dp))
    title?.let { Text(it, style = MaterialTheme.typography.displaySmall, textAlign = TextAlign.Center) }
    if (busy) CircularProgressIndicator()
    message?.let { Text(it, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center) }
    extra()
  }
}

/**
 * The basket as the cashier builds it, with what is paid and still due.
 *
 * `totalCents` is the SALE: a tip rides beside it and never inside it, and so do `paidCents` and `dueCents`.
 * Once a tip is on the sale the customer sees it as its own line and the total they are actually paying
 * under it, so the screen never reads short by the tip.
 */
@Composable
fun DisplayCartView(cart: PosDisplayCart, currency: String?) {
  fun fmt(cents: Double) = money(cents.toLong(), currency)
  // The register prices tax when the cashier charges; until then the basket has no tax figure.
  val priced = cart.dueCents != null
  val tip = cart.tipCents ?: 0.0

  @Composable
  fun totalRow(label: String, cents: Double, negative: Boolean = false, strong: Boolean = false) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      val style = if (strong) MaterialTheme.typography.displaySmall else MaterialTheme.typography.titleLarge
      Text(label, Modifier.weight(1f), style = style)
      Text((if (negative) "−" else "") + fmt(cents), style = style)
    }
  }
  Column(Modifier.fillMaxWidth().testTag("display-cart"), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    if (cart.lines.isEmpty()) {
      Text("Your items will show here", Modifier.fillMaxWidth(), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
    cart.lines.forEach { line ->
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text("${line.quantity.toLong()} × ${line.name}", style = MaterialTheme.typography.titleLarge)
          line.variantLabel?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Text(fmt(line.amountCents), style = MaterialTheme.typography.titleLarge)
      }
      HorizontalDivider()
    }
    totalRow("Subtotal", cart.itemsCents)
    if (cart.discountCents > 0) totalRow("Discount", cart.discountCents, negative = true)
    if (priced) totalRow("Tax", cart.taxCents)
    HorizontalDivider()
    if (tip > 0) {
      totalRow("Total", cart.totalCents)
      totalRow("Tip", tip)
      totalRow("Total with tip", cart.totalCents + tip, strong = true)
    } else {
      totalRow("Total", cart.totalCents, strong = true)
    }
    if (!priced) Text("Any tax is added when you pay.", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    cart.paidCents?.takeIf { it > 0 }?.let { totalRow("Paid", it) }
    if ((cart.paidCents ?: 0.0) > 0) cart.dueCents?.let { totalRow("Due", it, strong = true) }
  }
}

/** A tall, full-width touch target. */
@Composable
internal fun DeviceButton(label: String, modifier: Modifier = Modifier, prominent: Boolean = true, enabled: Boolean = true, sub: String? = null, onClick: () -> Unit) {
  val content: @Composable () -> Unit = {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
      Text(label, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
      sub?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
    }
  }
  if (prominent) {
    Button(onClick, modifier.heightIn(min = 80.dp), enabled = enabled) { content() }
  } else {
    OutlinedButton(onClick, modifier.heightIn(min = 80.dp), enabled = enabled) { content() }
  }
}

/**
 * The tip prompt: the merchant's presets, each with the amount it comes to, a custom amount and no tip. The
 * server recomputes a percentage from the prompt it sent, so what is shown here is never what is charged.
 */
@Composable
fun DisplayTipView(tip: PosDisplayStateTip, currency: String?, busy: Boolean, onAnswer: (PosDisplayAnswer) -> Unit) {
  var custom by remember { mutableStateOf<String?>(null) }
  var problem by remember { mutableStateOf<String?>(null) }
  fun fmt(cents: Double) = money(cents.toLong(), currency)
  val typed = custom
  if (typed != null) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(3f)), horizontalAlignment = Alignment.CenterHorizontally) {
      Text("Custom tip", style = MaterialTheme.typography.displaySmall)
      OutlinedTextField(
        typed,
        { custom = it; problem = null },
        modifier = Modifier.fillMaxWidth().testTag("display-tip-custom"),
        prefix = { Text("$") },
        isError = problem != null,
        supportingText = { Text(problem ?: "Up to ${fmt(tip.baseCents)}") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        textStyle = MaterialTheme.typography.headlineMedium,
      )
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(space(2f))) {
        DeviceButton("Back", Modifier.weight(1f), prominent = false, enabled = !busy) { custom = null; problem = null }
        DeviceButton("Add tip", Modifier.weight(1f).testTag("display-tip-add"), enabled = !busy && typed.isNotBlank()) {
          val cents = centsFromText(typed)
          val issue = if (cents == null) "Enter an amount, like 5 or 5.50." else posTipProblem(cents.toDouble(), tip.baseCents)
          if (cents == null || issue != null) {
            problem = issue
          } else {
            custom = null
            problem = null
            onAnswer(PosDisplayAnswer("", tipChoice = PosDisplayResponseTipChoice.CUSTOM, tipCents = cents))
          }
        }
      }
    }
  } else {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(3f)), horizontalAlignment = Alignment.CenterHorizontally) {
      Text("Add a tip?", style = MaterialTheme.typography.displaySmall)
      Text("On ${fmt(tip.baseCents)}", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(space(2f))) {
        tip.percentages.forEach { percent ->
          DeviceButton(
            "${percent.toLong()}%",
            Modifier.weight(1f).testTag("display-tip-${percent.toLong()}"),
            enabled = !busy,
            sub = fmt(posTipFromPercent(tip.baseCents.toLong(), percent).toDouble()),
          ) { onAnswer(PosDisplayAnswer("", tipChoice = PosDisplayResponseTipChoice.PERCENT, tipPercent = percent)) }
        }
      }
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(space(2f))) {
        if (tip.allowCustom) DeviceButton("Custom amount", Modifier.weight(1f), prominent = false, enabled = !busy) { custom = "" }
        DeviceButton("No tip", Modifier.weight(1f).testTag("display-tip-none"), prominent = false, enabled = !busy) {
          onAnswer(PosDisplayAnswer("", tipChoice = PosDisplayResponseTipChoice.NONE))
        }
      }
    }
  }
}

/**
 * The receipt prompt. The channels are the register's offer; email and text ask for an address on this screen, and the
 * marketing box is shown only when the store turned it on, unticked.
 */
@Composable
fun DisplayReceiptView(receipt: PosDisplayStateReceipt, busy: Boolean, onAnswer: (PosDisplayAnswer) -> Unit) {
  var entry by remember { mutableStateOf<PosReceiptChannel?>(null) }
  var value by remember { mutableStateOf("") }
  var optIn by remember { mutableStateOf(false) }
  var problem by remember { mutableStateOf<String?>(null) }
  fun reset() {
    entry = null
    value = ""
    optIn = false
    problem = null
  }
  val channel = entry
  if (channel != null) {
    val email = channel == PosReceiptChannel.EMAIL
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(3f)), horizontalAlignment = Alignment.CenterHorizontally) {
      Text(if (email) "Email receipt" else "Text receipt", style = MaterialTheme.typography.displaySmall)
      OutlinedTextField(
        value,
        { value = it; problem = null },
        modifier = Modifier.fillMaxWidth().testTag("display-receipt-value"),
        label = { Text(if (email) "Email" else "Mobile number") },
        isError = problem != null,
        supportingText = { Text(problem ?: if (email) "For your receipt" else "For your receipt by text") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = if (email) KeyboardType.Email else KeyboardType.Phone),
        textStyle = MaterialTheme.typography.headlineSmall,
      )
      if (email && receipt.offerMarketing) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Checkbox(optIn, { optIn = it })
          Text("Email me news and offers", style = MaterialTheme.typography.titleLarge)
        }
      }
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(space(2f))) {
        DeviceButton("Back", Modifier.weight(1f), prominent = false, enabled = !busy) { reset() }
        DeviceButton("Send", Modifier.weight(1f).testTag("display-receipt-send"), enabled = !busy && value.isNotBlank()) {
          if (email) {
            val address = posDisplayEmail(value)
            if (address.isEmpty()) {
              problem = "Enter an email address, like name@example.com."
            } else {
              val marketing = receipt.offerMarketing && optIn
              reset()
              onAnswer(PosDisplayAnswer("", receiptChannel = PosReceiptChannel.EMAIL, email = address, marketingOptIn = if (marketing) true else null))
            }
          } else {
            val phone = posDisplayPhone(value)
            if (phone.isEmpty()) {
              problem = "Enter a phone number with its area code."
            } else {
              reset()
              onAnswer(PosDisplayAnswer("", receiptChannel = PosReceiptChannel.SMS, phone = phone))
            }
          }
        }
      }
    }
  } else {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(3f)), horizontalAlignment = Alignment.CenterHorizontally) {
      Text("How would you like your receipt?", style = MaterialTheme.typography.displaySmall, textAlign = TextAlign.Center)
      receipt.channels.forEach { option ->
        DeviceButton(
          when (option) {
            PosReceiptChannel.EMAIL -> "Email"
            PosReceiptChannel.SMS -> "Text"
            PosReceiptChannel.PRINT -> "Print"
            else -> "No receipt"
          },
          Modifier.fillMaxWidth().testTag("display-receipt-${option.raw}"),
          prominent = option != PosReceiptChannel.NONE,
          enabled = !busy,
        ) {
          if (option == PosReceiptChannel.EMAIL || option == PosReceiptChannel.SMS) entry = option else onAnswer(PosDisplayAnswer("", receiptChannel = option))
        }
      }
    }
  }
}

/**
 * Unpairing, tucked into a corner behind a confirmation: the person at the counter is a customer, and one stray tap
 * must not take the screen away.
 */
@Composable
private fun UnpairControl(model: PosCustomerDisplayModel, modifier: Modifier = Modifier) {
  var confirming by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  TextButton(onClick = { confirming = true }, modifier.padding(space(1f)).testTag("display-unpair")) {
    Text("Unpair this display", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
  if (confirming) {
    AlertDialog(
      onDismissRequest = { confirming = false },
      title = { Text("Unpair this display?") },
      text = { Text("It stops showing sales from the register. To use it again, enter a new code from the register.") },
      confirmButton = { TextButton(onClick = { confirming = false; scope.launch { model.unpair() } }) { Text("Unpair") } },
      dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancel") } },
    )
  }
}

/** The unpaired screen: six digits from the register's pairing dialog, exchanged once for this device's token. */
@Composable
fun PosDevicePairing(mode: PosDeviceMode, busy: Boolean, error: String?, onPair: (String) -> Unit, onLeave: () -> Unit) {
  var code by remember { mutableStateOf("") }
  val noun = if (mode == PosDeviceMode.KIOSK) "kiosk" else "display"
  Column(
    Modifier.fillMaxSize().padding(space(4f)),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(space(3f), Alignment.CenterVertically),
  ) {
    Text("Pair this $noun", style = MaterialTheme.typography.displaySmall)
    Text("Enter the code shown on the register", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedTextField(
      code,
      { code = it.filter { c -> c.isDigit() }.take(6) },
      modifier = Modifier.widthIn(max = 360.dp).fillMaxWidth().testTag("pairing-entry"),
      placeholder = { Text("000000", Modifier.fillMaxWidth(), textAlign = TextAlign.Center, style = MaterialTheme.typography.displaySmall) },
      singleLine = true,
      textStyle = MaterialTheme.typography.displaySmall.copy(textAlign = TextAlign.Center),
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
    )
    error?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.widthIn(max = 360.dp)) }
    Button(onClick = { onPair(code) }, enabled = code.length == 6 && !busy, modifier = Modifier.widthIn(max = 360.dp).fillMaxWidth().heightIn(min = 56.dp).testTag("pairing-submit")) {
      Text(if (busy) "Pairing…" else "Pair $noun")
    }
    TextButton(onClick = onLeave) { Text("Back to sign in") }
  }
}
