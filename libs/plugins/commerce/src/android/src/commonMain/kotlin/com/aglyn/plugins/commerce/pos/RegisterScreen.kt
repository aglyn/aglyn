package com.aglyn.plugins.commerce.pos

import com.aglyn.hardware.CameraScanFilter
import com.aglyn.ui.BarcodeScanSheet
import com.aglyn.ui.LocalCameraScanner
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.utf16CodePoint
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.ModifierSelection
import com.aglyn.hardware.HidBurstDetector
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.plugins.commerce.COMMERCE_CARD_READERS_SCREEN
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AmountRow
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.QuantityStepper
import com.aglyn.ui.SkeletonGrid
import com.aglyn.ui.StatusTone
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.space
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged

/*
 * THE REGISTER.
 *
 * Phone: the item grid, with the basket a sheet away. Tablet and desktop: the
 * grid on the left and the basket (then checkout) on the right. Desktop adds
 * keyboard shortcuts and reads a keyboard-wedge barcode scanner from any
 * field.
 */

internal fun NoticeTone.status() = when (this) {
  NoticeTone.ERROR -> StatusTone.ERROR
  NoticeTone.WARNING -> StatusTone.WARNING
  NoticeTone.SUCCESS -> StatusTone.SUCCESS
  NoticeTone.INFO -> StatusTone.INFO
}

@Composable
fun RegisterScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val model = remember(hostId) {
    // The sale and each payment it starts name the cashier a PIN switched in,
    // who lives on the model the API is handed to.
    var registerModel: RegisterModel? = null
    RegisterModel(
      hostId = hostId,
      firestore = context.firestore,
      api = ConsolePosSaleApi(context.api, hostId) { registerModel?.cashier?.assertion },
      terminal = CommerceTerminalConnection(context.api),
      deviceStore = context.deviceStore,
      peripherals = context.peripherals,
      scope = scope,
      opsApi = ConsolePosOpsApi(context.api, hostId),
    ).also { registerModel = it }
  }
  LaunchedEffect(model) { model.start() }
  RegisterContent(model, onOpenReaders = { context.navigate(COMMERCE_CARD_READERS_SCREEN) })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegisterContent(model: RegisterModel, onOpenReaders: () -> Unit) {
  val wide = currentWidthClass() != WidthClass.COMPACT
  var query by remember { mutableStateOf("") }
  val searchFocus = remember { FocusRequester() }
  var basketOpen by remember { mutableStateOf(false) }
  var holdsOpen by remember { mutableStateOf(false) }
  var codeOpen by remember { mutableStateOf(false) }
  val camera = LocalCameraScanner.current
  var cameraOpen by remember { mutableStateOf(false) }
  val scanner = remember(model) { model.peripherals.hidScanner ?: HidBurstDetector() }

  // Charging from the phone's basket sheet moves to checkout; the sheet stays shut after it.
  LaunchedEffect(model.checkout) { if (model.checkout != null) basketOpen = false }

  // The toast fades on its own.
  LaunchedEffect(model.toast) {
    if (model.toast != null) {
      delay(4_000)
      model.toast = null
    }
  }

  val keys = Modifier.onPreviewKeyEvent { event ->
    if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
    model.cashier.touch()
    val now = nowMs()
    val command = event.isCtrlPressed || event.isMetaPressed
    when {
      event.key == Key.Enter || event.key == Key.NumPadEnter || event.key == Key.Tab -> {
        if (command && event.key != Key.Tab) {
          model.charge()
          return@onPreviewKeyEvent true
        }
        val code = scanner.onTerminator(now) ?: return@onPreviewKeyEvent false
        // The scanner typed into the search field: take the code back out.
        if (query.endsWith(code)) {
          query = query.removeSuffix(code)
          model.search(query)
        }
        model.lookUp(code)
        true
      }
      command && event.key == Key.F -> {
        searchFocus.requestFocus()
        true
      }
      command && event.key == Key.H -> {
        model.hold()
        true
      }
      command && (event.key == Key.Equals || event.key == Key.Plus || event.key == Key.NumPadAdd) -> {
        model.cart.lines.lastOrNull()?.let { model.setQuantity(it.key, it.quantity + 1) }
        true
      }
      command && (event.key == Key.Minus || event.key == Key.NumPadSubtract) -> {
        model.cart.lines.lastOrNull()?.let { model.setQuantity(it.key, it.quantity - 1) }
        true
      }
      event.key == Key.F12 -> {
        model.charge()
        true
      }
      event.key == Key.Escape && model.sheet != null -> {
        model.sheet = null
        true
      }
      else -> {
        val code = event.utf16CodePoint
        if (!command && code in 0x21..0x7e) scanner.onCharacter(code.toChar(), now)
        false
      }
    }
  }

  // The register holds the keyboard when no field does, so a keyboard-wedge
  // scanner's burst and the shortcuts reach it from anywhere in the window.
  val registerFocus = remember { FocusRequester() }
  LaunchedEffect(Unit) { runCatching { registerFocus.requestFocus() } }

  val checkout = model.checkout
  var opsOpen by remember { mutableStateOf(false) }
  Box(
    Modifier.fillMaxSize().then(keys).focusRequester(registerFocus).focusable().testTag("pos-register")
      // Any touch is the register in use: it keeps the idle lock away.
      .pointerInput(model) {
        awaitPointerEventScope {
          while (true) {
            awaitPointerEvent(PointerEventPass.Initial)
            model.cashier.touch()
          }
        }
      },
  ) {
    if (wide) {
      Row(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f)) {
          CatalogPane(model, query, { query = it; model.search(it) }, searchFocus, { codeOpen = true }, onCamera = camera?.let { { cameraOpen = true } }, onOps = { opsOpen = true })
          // The basket is the sale now: the grid rests until it is paid or canceled.
          if (checkout != null) {
            Box(
              Modifier.matchParentSize().background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.32f)).clickable(enabled = true, onClick = {}),
              contentAlignment = Alignment.Center,
            ) {
              Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface, shadowElevation = 4.dp) {
                Text(
                  "Finish or cancel this sale to ring up the next one.",
                  Modifier.padding(horizontal = space(3f), vertical = space(2f)),
                  style = MaterialTheme.typography.titleMedium,
                )
              }
            }
          }
        }
        VerticalDivider()
        Surface(Modifier.width(if (currentWidthClass() == WidthClass.MEDIUM) 340.dp else 420.dp).fillMaxHeight(), color = MaterialTheme.colorScheme.surfaceContainerLow) {
          Crossfade(checkout) { open ->
            if (open != null) CheckoutPane(model, open, onOpenReaders) else BasketPane(model, onHolds = { holdsOpen = true })
          }
        }
      }
    } else if (checkout != null) {
      Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { CheckoutPane(model, checkout, onOpenReaders) }
    } else {
      Column(Modifier.fillMaxSize()) {
        CatalogPane(model, query, { query = it; model.search(it) }, searchFocus, { codeOpen = true }, Modifier.weight(1f), onCamera = camera?.let { { cameraOpen = true } }, onOps = { opsOpen = true })
        BasketBar(model) { basketOpen = true }
      }
    }

    model.toast?.let { toast ->
      Box(Modifier.align(Alignment.BottomCenter).padding(space(2f)).padding(bottom = if (wide) 0.dp else 72.dp).widthIn(max = 560.dp)) {
        Surface(shape = MaterialTheme.shapes.medium, shadowElevation = 6.dp, color = MaterialTheme.colorScheme.surface) {
          NoticeBanner(toast.message, toast.tone.status(), Modifier.testTag("pos-toast"))
        }
      }
    }
  }

  if (basketOpen && !wide && checkout == null) {
    ModalBottomSheet(onDismissRequest = { basketOpen = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), dragHandle = { SheetHandle() }) {
      BasketPane(model, onHolds = { holdsOpen = true }, inSheet = true, onHeld = { basketOpen = false })
    }
  }
  model.sheet?.let { ItemSheetDialog(model, it, wide) }
  if (holdsOpen) HoldsDialog(model) { holdsOpen = false }
  if (opsOpen) RegisterOpsDialog(model) { opsOpen = false }
  if (model.cashier.locked) LockedRegister(model)
  if (cameraOpen && camera != null) {
    val filter = remember { CameraScanFilter() }
    var status by remember { mutableStateOf<String?>(null) }
    BarcodeScanSheet(
      scanner = camera,
      accept = { filter.accept(it, nowMs()) },
      onCode = { code ->
        model.lookUp(code) { answer ->
          status = answer.words
          // An item with options opens its sheet; the camera makes way for it.
          if (answer.needsSheet) cameraOpen = false
        }
      },
      onDismiss = { cameraOpen = false },
      status = status,
    )
  }
  if (codeOpen) CodeDialog(onDismiss = { codeOpen = false }) { code ->
    codeOpen = false
    model.lookUp(code)
  }
}

// ---- catalog

@Composable
private fun CatalogPane(
  model: RegisterModel,
  query: String,
  onQuery: (String) -> Unit,
  searchFocus: FocusRequester,
  onEnterCode: () -> Unit,
  modifier: Modifier = Modifier,
  /** Opens the camera scanner; null where the app has no camera scanner. */
  onCamera: (() -> Unit)? = null,
  /** Opens the Register sheet: the cashier, the shift and the drawer. */
  onOps: () -> Unit = {},
) {
  Column(modifier.fillMaxHeight()) {
    Row(
      Modifier.fillMaxWidth().padding(start = space(2f), end = space(2f), top = space(1.5f)),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(space(1f)),
    ) {
      OutlinedTextField(
        value = query,
        onValueChange = onQuery,
        modifier = Modifier.weight(1f).focusRequester(searchFocus).testTag("pos-search"),
        placeholder = { Text(if (currentWidthClass() == WidthClass.COMPACT) "Search or scan" else "Search products or scan a barcode", maxLines = 1, overflow = TextOverflow.Ellipsis) },
        leadingIcon = { Icon(AglynIcons.named("search"), contentDescription = null) },
        trailingIcon = {
          if (query.isNotEmpty()) {
            IconButton(onClick = { onQuery("") }) { Icon(AglynIcons.named("close"), contentDescription = "Clear search") }
          }
        },
        singleLine = true,
        shape = MaterialTheme.shapes.large,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
      )
      if (onCamera != null) {
        IconButton(onClick = onCamera, modifier = Modifier.testTag("pos-scan-camera")) {
          Icon(AglynIcons.named("photo_camera"), contentDescription = "Scan barcodes with the camera")
        }
      }
      IconButton(onClick = onEnterCode, modifier = Modifier.testTag("pos-enter-code")) {
        Icon(AglynIcons.named("barcode"), contentDescription = "Enter a barcode or SKU")
      }
      IconButton(onClick = onOps, modifier = Modifier.testTag("pos-ops-open")) {
        Icon(AglynIcons.named("person_check"), contentDescription = "Cashier and shift")
      }
      RegisterPicker(model)
    }
    if (!model.online) {
      NoticeBanner(
        "Offline. Keep ringing up; hold baskets and charge when you are back online.",
        StatusTone.WARNING,
        Modifier.padding(horizontal = space(2f), vertical = space(1f)).testTag("pos-offline"),
        action = { TextButton(onClick = { model.reconnect() }, modifier = Modifier.testTag("pos-reconnect")) { Text("Retry") } },
      )
    }
    val selected = when {
      model.args.search.isNotBlank() -> null
      model.args.quickKeys -> "quick"
      model.args.categoryId != null -> model.args.categoryId
      else -> "all"
    }
    val options = buildList {
      if (model.hasQuickKeys) add(ChipOption("quick", "Quick keys", "bolt"))
      add(ChipOption("all", "All products"))
      categoryLevel(model.categories, null).forEach { add(ChipOption(it.id, it.name)) }
    }
    ChoiceChipRow(
      options,
      selected,
      onSelect = { key ->
        if (query.isNotEmpty()) onQuery("")
        when (key) {
          "quick" -> model.showQuickKeys()
          "all" -> model.showAll()
          else -> model.showCategory(key)
        }
      },
      modifier = Modifier.padding(horizontal = space(2f), vertical = space(1f)),
    )
    // A category with children offers them as a second row.
    val parent = model.args.categoryId?.let { id -> model.categories.firstOrNull { it.id == id } }
    val children = parent?.let { categoryLevel(model.categories, it.id) }.orEmpty()
    if (children.isNotEmpty()) {
      ChoiceChipRow(children.map { ChipOption(it.id, it.name) }, null, { model.showCategory(it) }, Modifier.padding(horizontal = space(2f)))
    }
    when (val grid = model.grid) {
      Load.Loading -> SkeletonGrid(tiles = 12, minTileWidth = 148.dp)
      is Load.Failed -> EmptyState(
        "Products did not load",
        body = grid.message,
        icon = AglynIcons.named("error"),
        action = { OutlinedButton(onClick = { model.loadGrid() }) { Text("Try again") } },
      )
      is Load.Ready -> if (grid.value.isEmpty()) {
        EmptyState(
          if (model.args.search.isNotBlank()) "No product matches “${model.args.search.trim()}”" else "Nothing to sell here yet",
          body = if (model.args.search.isNotBlank()) "Search matches the start of a word in a product's name." else "Active products you add in the console show up here.",
          icon = AglynIcons.named("inventory"),
        )
      } else {
        ProductGrid(model, grid.value)
      }
    }
  }
}

@Composable
private fun RegisterPicker(model: RegisterModel) {
  val all = (model.registers as? Load.Ready)?.value.orEmpty()
  if (all.size < 2) return
  var open by remember { mutableStateOf(false) }
  Box {
    TextButton(onClick = { open = true }, modifier = Modifier.testTag("pos-register-picker")) {
      Icon(AglynIcons.named("point_of_sale"), null, Modifier.size(18.dp))
      Spacer(Modifier.width(space(0.5f)))
      Text(model.register?.name ?: "Register", maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    DropdownMenu(open, onDismissRequest = { open = false }) {
      for (entry in all) {
        DropdownMenuItem(text = { Text(entry.name) }, onClick = { open = false; model.selectRegister(entry) })
      }
    }
  }
}

@Composable
private fun ProductGrid(model: RegisterModel, items: List<PosItem>) {
  val state = rememberLazyGridState()
  val inBasket = remember(model.cart) { model.cart.lines.groupBy { it.productId }.mapValues { (_, lines) -> lines.sumOf { it.quantity } } }
  LaunchedEffect(state, items.size) {
    snapshotFlow { state.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
      .distinctUntilChanged()
      .collect { last -> if (last >= items.size - 8 && model.gridHasMore) model.loadMore() }
  }
  val minTile = 148.dp * LocalDensity.current.fontScale.coerceAtLeast(1f)
  LazyVerticalGrid(
    columns = GridCells.Adaptive(minTile),
    state = state,
    modifier = Modifier.fillMaxSize().testTag("pos-grid"),
    contentPadding = androidx.compose.foundation.layout.PaddingValues(space(2f)),
    horizontalArrangement = Arrangement.spacedBy(space(1.5f)),
    verticalArrangement = Arrangement.spacedBy(space(1.5f)),
  ) {
    items(items, key = { it.id }) { item -> ProductTile(item, inBasket[item.id] ?: 0, model.currency) { model.tap(item) } }
  }
}

@Composable
private fun ProductTile(item: PosItem, inBasket: Int, currency: String, onClick: () -> Unit) {
  val soldOut = item.variants.all { it.soldOut() }
  val price = when {
    item.fromCents == null -> "No price"
    item.toCents != item.fromCents -> "From ${money(item.fromCents, currency)}"
    else -> money(item.fromCents, currency)
  }
  Surface(
    Modifier.heightIn(min = 120.dp).clip(MaterialTheme.shapes.large).clickable(onClickLabel = "Add ${item.name}", onClick = onClick)
      .semantics { contentDescription = "${item.name}, $price" + if (inBasket > 0) ", $inBasket in the basket" else "" }
      .testTag("tile-${item.id}"),
    shape = MaterialTheme.shapes.large,
    color = MaterialTheme.colorScheme.surfaceContainerLowest,
    border = BorderStroke(1.dp, if (inBasket > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
  ) {
    Column(Modifier.padding(space(1.5f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Row(verticalAlignment = Alignment.Top) {
        Box(
          Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer),
          contentAlignment = Alignment.Center,
        ) {
          Text(
            item.name.trim().take(1).uppercase(),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
          )
        }
        Spacer(Modifier.weight(1f))
        if (inBasket > 0) Badge(containerColor = MaterialTheme.colorScheme.primary) { Text(inBasket.toString()) }
      }
      Text(
        item.name,
        style = MaterialTheme.typography.titleSmall,
        maxLines = 2,
        minLines = 2,
        overflow = TextOverflow.Ellipsis,
      )
      Text(price, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold, maxLines = 1)
      // Every tile keeps this line, so the grid's rows line up.
      Text(
        when {
          soldOut -> "Sold out"
          item.needsSheet() -> "Choose options"
          else -> "Tap to add"
        },
        style = MaterialTheme.typography.bodySmall,
        color = if (soldOut) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
}

// ---- item sheet

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ItemSheetDialog(model: RegisterModel, sheet: ItemSheet, wide: Boolean) {
  val content: @Composable () -> Unit = { ItemSheetContent(model, sheet) }
  if (wide) {
    androidx.compose.ui.window.Dialog(onDismissRequest = { model.sheet = null }) {
      Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surface, modifier = Modifier.widthIn(max = 520.dp)) { content() }
    }
  } else {
    ModalBottomSheet(onDismissRequest = { model.sheet = null }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), dragHandle = { SheetHandle() }) { content() }
  }
}

@Composable
private fun ItemSheetContent(model: RegisterModel, sheet: ItemSheet) {
  val item = sheet.item
  val variant = item.variants.firstOrNull { it.id == sheet.variantId } ?: item.variants.first()
  val pick = pickOf(item, variant, sheet.picks)
  val unit = (pick as? PickResult.Ok)?.pick?.unitCents
  Column(
    Modifier.verticalScroll(rememberScrollState()).padding(space(3f)).testTag("pos-item-sheet"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    Text(item.name, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
    if (item.variants.size > 1) {
      Section("Choose one") {
        ChoiceChipRow(
          item.variants.map { ChipOption(it.id, listOfNotNull(it.label ?: "Default", it.unitCents?.let { cents -> money(cents, model.currency) }).joinToString(" · ")) },
          variant.id,
          { model.sheet = sheet.copy(variantId = it, problem = null) },
          wrap = true,
        )
        if (variant.soldOut()) Text("Sold out by the count. The sale may refuse it.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
      }
    }
    for (group in item.modifierGroups) {
      val chosen = sheet.picks.filter { it.groupId == group.id }.map { it.optionId }
      Section(group.name + if (group.required()) " · Required" else if (!group.single()) " · Up to ${group.max.toInt()}" else " · Optional") {
        androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          for (option in group.options) {
            val on = option.id in chosen
            androidx.compose.material3.FilterChip(
              selected = on,
              onClick = {
                val others = sheet.picks.filter { it.groupId != group.id }
                val mine = when {
                  group.single() -> if (on && !group.required()) emptyList() else listOf(option.id)
                  on -> chosen - option.id
                  else -> chosen + option.id
                }
                model.sheet = sheet.copy(picks = others + mine.map { ModifierSelection(group.id, it) }, problem = null)
              },
              label = { Text(if (option.priceCents > 0) "${option.name} +${money(option.priceCents.toLong(), model.currency)}" else option.name) },
              leadingIcon = if (on) ({ Icon(AglynIcons.named("check"), null, Modifier.size(18.dp)) }) else null,
              modifier = Modifier.heightIn(min = 40.dp).testTag("option-${group.id}-${option.id}"),
            )
          }
        }
      }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text("Quantity", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
      QuantityStepper(sheet.quantity, { model.sheet = sheet.copy(quantity = it.coerceIn(1, POS_LINE_MAX_QUANTITY)) }, range = 1..POS_LINE_MAX_QUANTITY)
    }
    (sheet.problem ?: (pick as? PickResult.Problem)?.message?.takeIf { variant.unitCents == null })?.let {
      NoticeBanner(it, StatusTone.ERROR)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedButton(onClick = { model.sheet = null }, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("Cancel") }
      Button(onClick = { model.addFromSheet() }, modifier = Modifier.weight(2f).heightIn(min = 52.dp).testTag("pos-item-add")) {
        Text(if (unit != null) "Add · ${money(unit * sheet.quantity, model.currency)}" else "Add to basket")
      }
    }
  }
}

/** The sheet's grabber, without the tooltip the stock handle shows on a long press. */
@Composable
private fun SheetHandle() {
  Box(
    Modifier.padding(vertical = space(1.5f)).width(32.dp).height(4.dp).clip(CircleShape)
      .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)),
  )
}

@Composable
internal fun Section(title: String, content: @Composable () -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    content()
  }
}

// ---- basket

@Composable
private fun BasketBar(model: RegisterModel, onOpen: () -> Unit) {
  val cart = model.cart
  // Large text gets the summary on its own line, so nothing wraps a word at a time.
  val stacked = LocalDensity.current.fontScale > 1.3f
  val summary: @Composable (Modifier) -> Unit = { modifier ->
    Column(modifier.clickable(onClick = onOpen).testTag("pos-basket-bar")) {
      Text(
        if (cart.isEmpty) "Basket is empty" else "${cart.count} ${if (cart.count == 1) "item" else "items"}",
        style = MaterialTheme.typography.titleSmall,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      Text(
        if (cart.isEmpty) "Tap a product to start" else "${money(cart.subtotalCents - cart.discountCents, model.currency)} before tax",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
  val actions: @Composable (Modifier) -> Unit = { modifier ->
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedButton(onClick = onOpen, enabled = !cart.isEmpty || model.holds.isNotEmpty(), modifier = Modifier.heightIn(min = 52.dp)) { Text("Basket") }
      ChargeButton(model, if (stacked) Modifier.weight(1f) else Modifier)
    }
  }
  Surface(color = MaterialTheme.colorScheme.surfaceContainer, tonalElevation = 3.dp, shadowElevation = 6.dp) {
    if (stacked) {
      Column(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1.5f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        summary(Modifier.fillMaxWidth())
        actions(Modifier.fillMaxWidth())
      }
    } else {
      Row(
        Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1.5f)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(space(1.5f)),
      ) {
        summary(Modifier.weight(1f))
        actions(Modifier)
      }
    }
  }
}

@Composable
private fun ChargeButton(model: RegisterModel, modifier: Modifier = Modifier) {
  val cart = model.cart
  Button(
    onClick = { model.charge() },
    enabled = !cart.isEmpty && !model.charging && model.register != null,
    modifier = modifier.heightIn(min = 52.dp).testTag("pos-charge"),
  ) {
    if (model.charging) {
      androidx.compose.material3.CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
    } else {
      // The server adds the store's tax when the sale opens; the button names no figure it would change.
      Text("Charge", style = MaterialTheme.typography.titleMedium)
    }
  }
}

@Composable
private fun BasketPane(model: RegisterModel, onHolds: () -> Unit, inSheet: Boolean = false, onHeld: () -> Unit = {}) {
  val cart = model.cart
  Column(Modifier.fillMaxWidth().then(if (inSheet) Modifier else Modifier.fillMaxHeight()).testTag("pos-basket")) {
    Row(Modifier.fillMaxWidth().padding(start = space(2f), end = space(1f), top = space(1.5f)), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text("Basket", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
        Text(
          model.register?.name ?: "No register",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      TextButton(onClick = onHolds, enabled = model.holds.isNotEmpty(), modifier = Modifier.testTag("pos-holds")) {
        Icon(AglynIcons.named("history"), null, Modifier.size(18.dp))
        Spacer(Modifier.width(space(0.5f)))
        Text("Held (${model.holds.size})")
      }
      IconButton(onClick = { model.clearCart() }, enabled = !cart.isEmpty) { Icon(AglynIcons.named("clear_all"), contentDescription = "Clear the basket") }
    }
    if (model.registers is Load.Ready && model.register == null) {
      NoticeBanner("This store has no register yet. Add one in the console's register settings.", StatusTone.WARNING, Modifier.padding(space(2f)))
    }
    if (cart.isEmpty) {
      Box(Modifier.fillMaxWidth().then(if (inSheet) Modifier.height(240.dp) else Modifier.weight(1f))) {
        EmptyState("Tap a product to start a sale", body = "Scan a barcode or search by name.", icon = AglynIcons.named("shopping_basket"))
      }
    } else {
      LazyColumn(Modifier.fillMaxWidth().then(if (inSheet) Modifier.heightIn(max = 360.dp) else Modifier.weight(1f))) {
        items(cart.lines, key = { it.key }) { line ->
          Row(
            Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)).testTag("line-${line.productId}"),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(space(1f)),
          ) {
            Column(Modifier.weight(1f)) {
              Text(line.name, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
              line.variantLabel?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis) }
              Text(money(line.unitCents * line.quantity, model.currency), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            }
            QuantityStepper(line.quantity, { model.setQuantity(line.key, it) }, range = 0..POS_LINE_MAX_QUANTITY, label = "${line.name} quantity")
          }
          HorizontalDivider(Modifier.padding(horizontal = space(2f)))
        }
      }
    }
    Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      AnimatedVisibility(!cart.isEmpty) {
        Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
          ChoiceChipRow(
            listOf(0, 5, 10, 15, 20).map { ChipOption(it.toString(), if (it == 0) "No discount" else "$it% off", if (it == 0) null else "percent") },
            cart.discountPct.toString(),
            { model.setDiscount(it.toDouble()) },
          )
          var email by remember(cart.customerEmail) { mutableStateOf(cart.customerEmail) }
          OutlinedTextField(
            value = email,
            onValueChange = { email = it; model.setCustomerEmail(it) },
            label = { Text("Customer email (optional)") },
            leadingIcon = { Icon(AglynIcons.named("mail"), null) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
          )
          AmountRow("Subtotal", money(cart.subtotalCents, model.currency))
          if (cart.discountCents > 0) AmountRow("Discount (${cart.discountPct}%)", "-${money(cart.discountCents, model.currency)}")
          Text("Tax and the final total are worked out when you charge.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedButton(onClick = { model.hold(); onHeld() }, enabled = !cart.isEmpty, modifier = Modifier.heightIn(min = 52.dp).testTag("pos-hold")) {
          Icon(AglynIcons.named("pause"), null, Modifier.size(18.dp))
          Spacer(Modifier.width(space(0.5f)))
          Text("Hold")
        }
        ChargeButton(model, Modifier.weight(1f))
      }
    }
  }
}

@Composable
private fun HoldsDialog(model: RegisterModel, onDismiss: () -> Unit) {
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("Held baskets") },
    text = {
      if (model.holds.isEmpty()) {
        Text("Nothing is held on this register.")
      } else {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(space(1f))) {
          items(model.holds, key = { it.id }) { held ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag("hold-${held.id}")) {
              Column(Modifier.weight(1f)) {
                Text(held.label, style = MaterialTheme.typography.titleSmall)
                Text(
                  "${held.cart.count} items · ${money(held.cart.subtotalCents - held.cart.discountCents, model.currency)}",
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
              }
              IconButton(onClick = { model.discardHold(held.id) }) { Icon(AglynIcons.named("delete"), contentDescription = "Discard ${held.label}") }
              TextButton(onClick = { model.resume(held.id); onDismiss() }) { Text("Resume") }
            }
          }
        }
      }
    },
    confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
  )
}

@Composable
private fun CodeDialog(onDismiss: () -> Unit, onCode: (String) -> Unit) {
  var code by remember { mutableStateOf("") }
  val focus = remember { FocusRequester() }
  LaunchedEffect(Unit) { focus.requestFocus() }
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("Barcode or SKU") },
    text = {
      OutlinedTextField(
        value = code,
        onValueChange = { code = it },
        singleLine = true,
        label = { Text("Code") },
        modifier = Modifier.focusRequester(focus).testTag("pos-code-field"),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { if (code.isNotBlank()) onCode(code) }),
      )
    },
    confirmButton = { TextButton(onClick = { onCode(code) }, enabled = code.isNotBlank()) { Text("Look up") } },
    dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
  )
}
