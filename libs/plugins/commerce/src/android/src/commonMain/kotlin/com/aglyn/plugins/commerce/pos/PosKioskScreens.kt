package com.aglyn.plugins.commerce.pos

import androidx.compose.ui.draw.clip
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ModifierSelection
import com.aglyn.contracts.PosDeviceMode
import com.aglyn.contracts.PosDisplayResponseTipChoice
import com.aglyn.contracts.PosDisplayStateReceipt
import com.aglyn.contracts.PosDisplayStateTip
import com.aglyn.contracts.PosKioskProduct
import com.aglyn.contracts.PosKioskSale
import com.aglyn.contracts.PosKioskSaleStatus
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.ChipOption
import com.aglyn.ui.KeepScreenOn
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.QuantityStepper
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/*
 * THE SELF-SERVICE KIOSK (AGL-3623), full screen on the tablet customers order
 * from. The Apple app's `PosKioskView.swift`. The console's kiosk page, native:
 * pairing by code, a start screen, the menu (categories, product tiles, an item
 * sheet for options and modifiers, the cart), the priced review, the tip, the
 * card in flight, the receipt, and the order number. A staff PIN in the corner
 * opens the card reader choice and leaves kiosk mode.
 */

const val COMMERCE_KIOSK_SCREEN = "commerce.kiosk"

@Composable
fun PosKioskScreen(context: NativePluginContext) {
  // The kiosk's products name their pictures by a path on the console (`/api/media/cdn/…`), read from its origin.
  val pictures = remember(context.api.origin, context.hostId) {
    { value: String? -> value?.let { mediaPreviewUrl(it, context.api.origin, context.hostId) } }
  }
  CompositionLocalProvider(LocalPosPictures provides pictures) { PosKioskScreenBody(context) }
}

@Composable
private fun PosKioskScreenBody(context: NativePluginContext) {
  val model = remember {
    PosKioskModel(
      device = ConsolePosDeviceApi(context.api),
      api = ConsolePosKioskApi(context.api),
      store = PosDeviceTokenStore(context.deviceStore, PosDeviceMode.KIOSK),
      collector = context.peripherals.cardCollector,
    )
  }
  val scope = rememberCoroutineScope()
  // A kiosk nobody is touching must not dim or lock: the next customer walks up to a lit screen.
  KeepScreenOn()
  LaunchedEffect(Unit) { model.start() }
  // The idle clock, once a second.
  LaunchedEffect(model.token) {
    if (model.token == null) return@LaunchedEffect
    while (isActive) {
      delay(1_000)
      model.tick()
      model.tickDone()
    }
  }
  // The menu is re-read ten minutes at a time while idle on the start screen, so an edit reaches it.
  LaunchedEffect(model.token) {
    if (model.token == null) return@LaunchedEffect
    while (isActive) {
      delay(10L * 60 * 1000)
      if (model.phase == PosKioskPhase.Start) model.refresh()
    }
  }
  Surface(
    Modifier.fillMaxSize().testTag("pos-kiosk")
      // Any touch is the customer still there.
      .pointerInput(model) {
        awaitPointerEventScope {
          while (true) {
            awaitPointerEvent(PointerEventPass.Initial)
            model.touch()
          }
        }
      },
    color = MaterialTheme.colorScheme.background,
  ) {
    Box(Modifier.fillMaxSize()) {
      when {
        !model.started -> CircularProgressIndicator(Modifier.align(Alignment.Center))
        model.token == null -> PosDevicePairing(
          mode = PosDeviceMode.KIOSK,
          busy = model.pairing,
          error = model.pairError,
          onPair = { code -> scope.launch { model.pair(code) } },
          onLeave = context::back,
        )
        else -> key(model.turn) { KioskBody(model, context.api.origin, onExit = { model.unpaired() }) }
      }
    }
  }
}

@Composable
private fun KioskBody(model: PosKioskModel, origin: String, onExit: () -> Unit) {
  val scope = rememberCoroutineScope()
  var itemSheet by remember { mutableStateOf<PosKioskProduct?>(null) }
  var cartOpen by remember { mutableStateOf(false) }
  LaunchedEffect(model.token, model.categoryId, model.turn) { model.loadCatalog() }
  // The card in flight, asked after until it is paid or fails.
  LaunchedEffect(model.phase) {
    val first = model.phase as? PosKioskPhase.Paying ?: return@LaunchedEffect
    if (first.paymentId == null || first.failure != null) return@LaunchedEffect
    while (isActive) {
      delay(POS_KIOSK_PAYMENT_POLL_MS)
      model.pollPayment()
      val next = model.phase as? PosKioskPhase.Paying ?: return@LaunchedEffect
      if (next.failure != null) return@LaunchedEffect
    }
  }
  Box(Modifier.fillMaxSize()) {
    KioskScreen(model, origin, onProduct = { product ->
      val item = kioskItemOf(product)
      if (item.needsSheet()) itemSheet = product else item.variants.firstOrNull()?.let { model.add(item, it) }
    }, onCart = { cartOpen = true })
    if (model.offline) NoticeBanner("Reconnecting…", StatusTone.WARNING, Modifier.align(Alignment.TopCenter).padding(space(1f)))
    if (model.phase == PosKioskPhase.Start || model.phase == PosKioskPhase.Menu) {
      KioskStaffControl(model, onExit, Modifier.align(Alignment.TopStart))
    }
  }
  itemSheet?.let { product -> KioskItemSheet(model, product) { itemSheet = null } }
  if (cartOpen) KioskCartSheet(model) { cartOpen = false }
  model.idleWarning?.let { left ->
    AlertDialog(
      onDismissRequest = { model.touch() },
      title = { Text("Still there?") },
      text = { Text("This order will be cleared in $left seconds.") },
      confirmButton = { TextButton(onClick = { model.touch() }, modifier = Modifier.testTag("kiosk-still-here")) { Text("I’m still here") } },
      dismissButton = { TextButton(onClick = { scope.launch { model.reset() } }) { Text("Start over") } },
    )
  }
}

@Composable
private fun KioskScreen(model: PosKioskModel, origin: String, onProduct: (PosKioskProduct) -> Unit, onCart: () -> Unit) {
  val scope = rememberCoroutineScope()
  val branding = model.context?.branding?.asDeviceBranding(origin)
  when (val phase = model.phase) {
    PosKioskPhase.Start -> PosDeviceBrandScreen(branding, title = null, message = branding?.message ?: "Order here") {
      Button(
        onClick = { model.startOrder() },
        modifier = Modifier.widthIn(max = 360.dp).fillMaxWidth().heightIn(min = 80.dp).testTag("kiosk-start"),
      ) { Text("Start order", fontSize = 22.sp, fontWeight = FontWeight.SemiBold) }
    }
    PosKioskPhase.Menu -> KioskMenu(model, onProduct, onCart)
    PosKioskPhase.Review -> model.sale?.let { KioskReview(model, it, branding) }
    is PosKioskPhase.Tip -> {
      val sale = model.sale
      val context = model.context
      if (sale != null && context != null) {
        DeviceScroll(branding, null) {
          Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(space(2f))) {
            DisplayTipView(
              PosDisplayStateTip(allowCustom = true, baseCents = sale.dueCents.toDouble(), percentages = context.tipping.percentages),
              model.currency,
              model.busy,
            ) { answer ->
              val chosen = when (answer.tipChoice) {
                PosDisplayResponseTipChoice.PERCENT -> PosKioskTip.Percent(answer.tipPercent ?: 0.0)
                PosDisplayResponseTipChoice.CUSTOM -> PosKioskTip.Custom(answer.tipCents ?: 0)
                else -> PosKioskTip.None
              }
              scope.launch { model.tipChosen(phase.method, chosen) }
            }
            TextButton(onClick = { model.backToReview() }, enabled = !model.busy) { Text("Back") }
          }
        }
      }
    }
    is PosKioskPhase.Paying -> KioskPaying(model, phase)
    PosKioskPhase.Receipt -> {
      val context = model.context
      if (model.sale != null && context != null) {
        DeviceScroll(branding, model.notice) {
          DisplayReceiptView(PosDisplayStateReceipt(channels = context.receipts, offerMarketing = context.offerMarketing), model.busy) { answer ->
            val channel = answer.receiptChannel ?: return@DisplayReceiptView
            scope.launch { model.answerReceipt(channel, answer.email ?: answer.phone, answer.marketingOptIn == true) }
          }
        }
      }
    }
    PosKioskPhase.Done -> model.sale?.let { KioskDone(model, it) }
  }
}

/** The menu: category chips, the product tiles, and the cart bar. */
@Composable
private fun KioskMenu(model: PosKioskModel, onProduct: (PosKioskProduct) -> Unit, onCart: () -> Unit) {
  val scope = rememberCoroutineScope()
  val categories = model.catalog?.categories ?: emptyList()
  val products = model.catalog?.products ?: emptyList()
  Column(Modifier.fillMaxSize()) {
    Box(Modifier.padding(start = space(2f), end = space(2f), top = space(5f), bottom = space(1f))) {
      ChoiceChipRow(
        listOf(ChipOption("all", "All")) + categories.map { ChipOption(it.id, it.name) },
        model.categoryId ?: "all",
        { key -> model.categoryId = key.takeIf { it != "all" } },
      )
    }
    HorizontalDivider()
    model.notice?.let { NoticeBanner(it, StatusTone.WARNING, Modifier.fillMaxWidth().padding(space(2f))) }
    Box(Modifier.weight(1f).fillMaxWidth()) {
      when {
        model.catalogLoading && model.catalog == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
        products.isEmpty() -> Text(
          "Nothing here yet. Try another category.",
          Modifier.align(Alignment.Center).padding(space(4f)),
          style = MaterialTheme.typography.titleLarge,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        else -> LazyVerticalGrid(
          GridCells.Adaptive(170.dp),
          contentPadding = PaddingValues(space(2f)),
          horizontalArrangement = Arrangement.spacedBy(space(2f)),
          verticalArrangement = Arrangement.spacedBy(space(2f)),
        ) {
          items(products, key = { it.id }) { product ->
            val soldOut = kioskProductSoldOut(product)
            Card(Modifier.fillMaxWidth().clickable(enabled = !soldOut) { onProduct(product) }.alpha(if (soldOut) 0.5f else 1f).testTag("kiosk-tile-${product.id}")) {
              Column(Modifier.padding(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
                // Every tile keeps the same picture band, so a row with one photo stays even: the photo, or the product's
                // initial on primaryContainer, as the register's tiles draw it.
                val picture = LocalPosPictures.current(product.imageUrl)
                if (picture != null) {
                  RemoteImage(picture, product.name, Modifier.fillMaxWidth().height(110.dp).clip(MaterialTheme.shapes.medium).testTag("kiosk-photo-${product.id}"), contentScale = ContentScale.Crop, icon = "image")
                } else {
                  Box(
                    Modifier.fillMaxWidth().height(110.dp).clip(MaterialTheme.shapes.medium).background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center,
                  ) {
                    Text(product.name.take(1).uppercase(), style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                  }
                }
                // Two lines reserved, two at most: a long name never makes its tile taller than its row.
                Text(
                  product.name,
                  style = MaterialTheme.typography.titleMedium,
                  minLines = 2,
                  maxLines = 2,
                  overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
                Text(
                  if (soldOut) "Sold out" else "${if (product.variants.size > 1) "From " else ""}${model.money(kioskFromCents(product))}",
                  style = MaterialTheme.typography.bodyMedium,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
              }
            }
          }
        }
      }
    }
    if (model.cartCount > 0) {
      Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.fillMaxWidth().padding(space(2f)), horizontalArrangement = Arrangement.spacedBy(space(2f))) {
          DeviceButton("Cart (${model.cartCount})", Modifier.widthIn(max = 220.dp).weight(1f), prominent = false, onClick = onCart)
          DeviceButton(
            if (model.busy) "Getting your total…" else "Checkout · ${model.money(model.cartEstimateCents)}",
            Modifier.weight(2f).testTag("kiosk-checkout"),
            enabled = !model.busy,
          ) { scope.launch { model.checkout() } }
        }
      }
    }
  }
}

/** Options and modifiers for one product, picked before it goes in the cart. */
@Composable
private fun KioskItemSheet(model: PosKioskModel, product: PosKioskProduct, close: () -> Unit) {
  val item = remember(product) { kioskItemOf(product) }
  var variantId by remember(product) { mutableStateOf((product.variants.firstOrNull { !it.soldOut } ?: product.variants.firstOrNull())?.id ?: "default") }
  var picks by remember(product) { mutableStateOf<List<ModifierSelection>>(emptyList()) }
  var quantity by remember(product) { mutableStateOf(1) }
  var problem by remember(product) { mutableStateOf<String?>(null) }
  val most = Contracts.posKioskMaxQuantity.toInt()
  Dialog(onDismissRequest = close) {
    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surface, modifier = Modifier.widthIn(max = 560.dp)) {
      Column(Modifier.verticalScroll(rememberScrollState()).padding(space(3f)).testTag("kiosk-item-sheet"), verticalArrangement = Arrangement.spacedBy(space(2f))) {
        Text(product.name, style = MaterialTheme.typography.headlineSmall)
        if (item.variants.size > 1) {
          Section("Option") {
            ChoiceChipRow(
              item.variants.map { variant ->
                ChipOption(variant.id, listOfNotNull(variant.label ?: "Default", variant.unitCents?.let { model.money(it) }, if (variant.soldOut()) "Sold out" else null).joinToString(" · "))
              },
              variantId,
              { chosen -> if (item.variants.firstOrNull { it.id == chosen }?.soldOut() != true) { variantId = chosen; problem = null } },
              wrap = true,
            )
          }
        }
        for (group in item.modifierGroups) {
          val chosen = picks.filter { it.groupId == group.id }.map { it.optionId }
          Section(group.name + if (group.required()) " · Required" else if (!group.single()) " · Up to ${group.max.toInt()}" else " · Optional") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
              for (option in group.options) {
                val on = option.id in chosen
                FilterChip(
                  selected = on,
                  colors = com.aglyn.ui.aglynFilterChipColors(),
                  onClick = {
                    val others = picks.filter { it.groupId != group.id }
                    val mine = when {
                      group.single() -> if (on && !group.required()) emptyList() else listOf(option.id)
                      on -> chosen - option.id
                      else -> chosen + option.id
                    }
                    picks = others + mine.map { ModifierSelection(group.id, it) }
                    problem = null
                  },
                  label = { Text(if (option.priceCents > 0) "${option.name} +${model.money(option.priceCents.toLong())}" else option.name) },
                  leadingIcon = if (on) ({ Icon(AglynIcons.named("check"), null, Modifier.size(18.dp)) }) else null,
                  modifier = Modifier.heightIn(min = 48.dp).testTag("kiosk-option-${group.id}-${option.id}"),
                )
              }
            }
          }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text("Quantity", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
          QuantityStepper(quantity, { quantity = it.coerceIn(1, most) }, range = 1..most)
        }
        problem?.let { NoticeBanner(it, StatusTone.ERROR) }
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          OutlinedButton(onClick = close, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) { Text("Cancel") }
          Button(
            onClick = {
              val variant = item.variants.firstOrNull { it.id == variantId }
              if (variant != null) {
                val result = pickOf(item, variant, picks)
                if (result is PickResult.Problem) {
                  problem = result.message
                } else if (model.add(item, variant, picks, quantity)) {
                  close()
                }
              }
            },
            modifier = Modifier.weight(2f).heightIn(min = 56.dp).testTag("kiosk-item-add"),
          ) { Text("Add") }
        }
      }
    }
  }
}

/** The cart: every line with its steppers, and the way on to checkout. */
@Composable
private fun KioskCartSheet(model: PosKioskModel, close: () -> Unit) {
  val scope = rememberCoroutineScope()
  val most = Contracts.posKioskMaxQuantity.toInt()
  Dialog(onDismissRequest = close) {
    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surface, modifier = Modifier.widthIn(max = 560.dp)) {
      Column(Modifier.verticalScroll(rememberScrollState()).padding(space(3f)).testTag("kiosk-cart"), verticalArrangement = Arrangement.spacedBy(space(2f))) {
        Text("Your order", style = MaterialTheme.typography.headlineSmall)
        if (model.cart.isEmpty) Text("Your cart is empty.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        model.cart.lines.forEach { line ->
          Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
              Text(line.name, style = MaterialTheme.typography.titleMedium)
              line.variantLabel?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
              Text(model.money(line.unitCents * line.quantity), style = MaterialTheme.typography.bodyMedium)
            }
            QuantityStepper(line.quantity, { model.setQuantity(line.key, it) }, range = 0..most, label = line.name)
          }
        }
        Text("Tax is added at checkout.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          OutlinedButton(onClick = close, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) { Text("Keep ordering") }
          Button(
            onClick = {
              close()
              scope.launch { model.checkout() }
            },
            enabled = !model.busy && !model.cart.isEmpty,
            modifier = Modifier.weight(2f).heightIn(min = 56.dp),
          ) { Text("Checkout · ${model.money(model.cartEstimateCents)}") }
        }
      }
    }
  }
}

/** The priced order: every line, the server's subtotal, discount, tax and total, and the ways to pay. Nothing here was computed on the kiosk. */
@Composable
private fun KioskReview(model: PosKioskModel, sale: PosKioskSale, branding: PosDeviceBranding?) {
  val scope = rememberCoroutineScope()
  val none = !model.canPayByReader && !model.canPayByTap && !model.canPayAtCounter

  @Composable
  fun row(label: String, cents: Long, negative: Boolean = false, strong: Boolean = false) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      val style = if (strong) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.titleMedium
      Text(label, Modifier.weight(1f), style = style)
      Text((if (negative) "−" else "") + model.money(cents), style = style)
    }
  }
  DeviceScroll(branding, null) {
    Column(Modifier.fillMaxWidth().testTag("kiosk-review"), verticalArrangement = Arrangement.spacedBy(space(2f))) {
      Text("Review your order", style = MaterialTheme.typography.displaySmall)
      sale.lines.forEach { line ->
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f)) {
            Text("${line.quantity} × ${line.name}", style = MaterialTheme.typography.titleMedium)
            line.variantLabel?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
          }
          Text(model.money(line.amountCents), style = MaterialTheme.typography.titleMedium)
        }
        HorizontalDivider()
      }
      row("Subtotal", sale.itemsCents)
      if (sale.discountCents > 0) row("Discount", sale.discountCents, negative = true)
      row("Tax", sale.taxCents)
      row("Total", sale.totalCents, strong = true)
      model.notice?.let { NoticeBanner(it, StatusTone.WARNING) }
      if (none) NoticeBanner("Payment is not set up on this kiosk yet. Please order at the counter.", StatusTone.INFO)
      if (model.canPayByReader) {
        DeviceButton("Pay with card", Modifier.fillMaxWidth().testTag("kiosk-pay-card"), enabled = !model.busy) { scope.launch { model.choosePay(PosKioskMethod.READER) } }
      }
      if (model.canPayByTap) {
        DeviceButton("Tap to Pay", Modifier.fillMaxWidth().testTag("kiosk-pay-tap"), prominent = !model.canPayByReader, enabled = !model.busy) {
          scope.launch { model.choosePay(PosKioskMethod.TAP) }
        }
      }
      if (model.canPayAtCounter) {
        DeviceButton(
          "Pay at counter",
          Modifier.fillMaxWidth().testTag("kiosk-pay-counter"),
          prominent = !model.canPayByReader && !model.canPayByTap,
          enabled = !model.busy,
        ) { scope.launch { model.sendToCounter() } }
      }
      TextButton(onClick = { scope.launch { model.backToMenu() } }, enabled = !model.busy, modifier = Modifier.fillMaxWidth()) { Text("Back to menu") }
    }
  }
}

/** Waiting on the card: the reader's prompt, or the device's Tap to Pay. */
@Composable
private fun KioskPaying(model: PosKioskModel, paying: PosKioskPhase.Paying) {
  val scope = rememberCoroutineScope()
  val failure = paying.failure
  Column(
    Modifier.fillMaxSize().padding(space(4f)).verticalScroll(rememberScrollState()).testTag("kiosk-paying"),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(space(3f), Alignment.CenterVertically),
  ) {
    Text(
      when {
        failure != null -> "The card did not go through"
        paying.method == PosKioskMethod.READER -> "Tap, insert or swipe your card on the reader"
        else -> "Hold your card near the device"
      },
      style = MaterialTheme.typography.displaySmall,
      textAlign = TextAlign.Center,
    )
    Text("Total ${model.money(paying.chargeCents)}", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    failure?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.widthIn(max = 520.dp)) }
    if (failure != null) {
      DeviceButton("Try again", Modifier.widthIn(max = 520.dp).fillMaxWidth().testTag("kiosk-retry"), enabled = !model.busy) { scope.launch { model.retryPayment() } }
      if (model.canPayAtCounter) {
        DeviceButton("Pay at counter", Modifier.widthIn(max = 520.dp).fillMaxWidth(), prominent = false, enabled = !model.busy) { scope.launch { model.sendToCounter() } }
      }
    } else if (model.context?.testMode == true && paying.method == PosKioskMethod.READER && paying.paymentId != null) {
      OutlinedButton(onClick = { scope.launch { model.simulate() } }, enabled = !model.busy) { Text("Test mode: tap a test card") }
    } else {
      CircularProgressIndicator()
    }
    TextButton(onClick = { scope.launch { model.cancelPayment() } }, enabled = !model.busy, modifier = Modifier.testTag("kiosk-cancel")) {
      Text(if (failure != null) "Back to my order" else "Cancel")
    }
  }
}

/** The order number the customer is called by, paid or to pay at the counter. */
@Composable
private fun KioskDone(model: PosKioskModel, sale: PosKioskSale) {
  val scope = rememberCoroutineScope()
  val queued = sale.status == PosKioskSaleStatus.QUEUED
  Column(
    Modifier.fillMaxSize().padding(space(4f)).verticalScroll(rememberScrollState()),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(space(3f), Alignment.CenterVertically),
  ) {
    Text("Your order number", style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text("${sale.number}", fontSize = 120.sp, fontWeight = FontWeight.Bold, modifier = Modifier.testTag("kiosk-number"))
    Text(if (queued) "Please pay at the counter" else "Thank you!", style = MaterialTheme.typography.displaySmall)
    Text(
      if (queued) "Show this number at the counter. Total ${model.money(sale.totalCents)}." else "We’ll call your number when your order is ready.",
      style = MaterialTheme.typography.headlineSmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      textAlign = TextAlign.Center,
    )
    DeviceButton("Done", Modifier.widthIn(max = 360.dp).fillMaxWidth().testTag("kiosk-done")) { scope.launch { model.reset() } }
  }
}

/**
 * Staff unlock: a corner button, then the staff PIN the register uses, checked on the server. No names are listed, the
 * screen faces the public, and a right PIN opens the kiosk's settings for a few minutes: which card reader it sends
 * payments to, and leaving kiosk mode.
 */
@Composable
private fun KioskStaffControl(model: PosKioskModel, onExit: () -> Unit, modifier: Modifier = Modifier) {
  val staff = remember { PosKioskStaffModel() }
  val scope = rememberCoroutineScope()
  TextButton(onClick = { staff.open() }, modifier.padding(space(1f)).alpha(0.5f).testTag("kiosk-staff")) {
    Text("Staff", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
  // The unlock lapses on its own: the settings close with it.
  LaunchedEffect(staff.unlock?.unlock) {
    if (staff.unlock == null) return@LaunchedEffect
    delay(staff.lapsesInMs())
    staff.close()
  }
  if (staff.stage == PosKioskStaffModel.Stage.CLOSED) return
  AlertDialog(
    onDismissRequest = { staff.close() },
    title = { Text(if (staff.stage == PosKioskStaffModel.Stage.SETTINGS) staff.view?.label?.ifEmpty { null } ?: "Kiosk settings" else "Staff unlock") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
        staff.error?.let { NoticeBanner(it, StatusTone.ERROR) }
        if (staff.stage == PosKioskStaffModel.Stage.SETTINGS) {
          val view = staff.view
          if (view != null && view.readers.isNotEmpty()) {
            Text("Card reader", style = MaterialTheme.typography.titleSmall)
            (listOf(PosKioskSettingsView.Reader("", "None — pay at counter only", "")) + view.readers).forEach { reader ->
              Row(
                Modifier.fillMaxWidth().clickable(enabled = !staff.busy && reader.id.isNotEmpty()) { scope.launch { staff.chooseReader(model, reader.id) } },
                verticalAlignment = Alignment.CenterVertically,
              ) {
                RadioButton(selected = (view.readerId ?: "") == reader.id, onClick = null)
                Text(if (reader.status.isEmpty()) reader.label else "${reader.label} (${reader.status})", Modifier.padding(start = space(1f)))
              }
            }
          } else {
            Text("No card reader is assigned to this register.", color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          if (staff.confirmExit) {
            NoticeBanner("This unpairs the kiosk. To use it again, show a new kiosk code on the register.", StatusTone.WARNING)
            Button(
              onClick = { scope.launch { if (staff.exit(model)) onExit() } },
              enabled = !staff.busy,
              modifier = Modifier.testTag("kiosk-exit-confirm"),
            ) { Text("Exit kiosk mode") }
          } else {
            OutlinedButton(onClick = { staff.confirmExit = true }, enabled = !staff.busy, modifier = Modifier.testTag("kiosk-exit")) { Text("Exit kiosk mode") }
          }
        } else {
          Text("Enter your register PIN.")
          OutlinedTextField(
            staff.pin,
            { staff.pin = it.filter { c -> c.isDigit() }.take(6) },
            modifier = Modifier.fillMaxWidth().testTag("kiosk-staff-pin"),
            label = { Text("Staff PIN") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
          )
        }
      }
    },
    confirmButton = {
      if (staff.stage == PosKioskStaffModel.Stage.PIN) {
        Button(
          onClick = { scope.launch { if (staff.submit(model)) onExit() } },
          enabled = !staff.busy && staff.pin.length >= 4,
          modifier = Modifier.testTag("kiosk-staff-unlock"),
        ) { Text(if (staff.busy) "Checking…" else "Unlock") }
      } else {
        TextButton(onClick = { staff.close() }, enabled = !staff.busy) { Text("Done") }
      }
    },
    dismissButton = if (staff.stage == PosKioskStaffModel.Stage.PIN) ({ TextButton(onClick = { staff.close() }, enabled = !staff.busy) { Text("Cancel") } }) else null,
  )
}
