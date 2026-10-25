package com.aglyn.plugins.commerce.products

import com.aglyn.plugins.commerce.lists.ListSortMenu
import com.aglyn.plugins.commerce.lists.filterChoices
import com.aglyn.plugins.commerce.lists.filterRefusals
import com.aglyn.pluginhost.ClauseFilterBar
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import com.aglyn.contracts.Contracts
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.COMMERCE_MAX_OPTIONS
import com.aglyn.contracts.ProductStatus
import com.aglyn.contracts.ProductType
import com.aglyn.contracts.isLowStock
import com.aglyn.contracts.productInventory
import com.aglyn.contracts.productPriceRange
import com.aglyn.core.liveCount
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.plugins.commerce.pos.Load
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.FormSheet
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.CloseWhenGone
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.AmountRow
import com.aglyn.ui.BarcodeScanSheet
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.DetailHeader
import com.aglyn.ui.EmptyState
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.LocalCameraScanner
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectionPlaceholder
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

const val COMMERCE_PRODUCTS_SCREEN = "commerce.products"
const val COMMERCE_PRODUCT_SCREEN = "commerce.product"
const val COMMERCE_SCAN_SCREEN = "commerce.scan"

fun statusTone(status: ProductStatus): StatusTone = when (status) {
  ProductStatus.ACTIVE -> StatusTone.SUCCESS
  ProductStatus.DRAFT -> StatusTone.NEUTRAL
  ProductStatus.ARCHIVED -> StatusTone.WARNING
  ProductStatus.UNKNOWN -> StatusTone.NEUTRAL
}

private fun statusLabel(status: ProductStatus) = when (status) {
  ProductStatus.ACTIVE -> "Active"
  ProductStatus.DRAFT -> "Draft"
  ProductStatus.ARCHIVED -> "Archived"
  ProductStatus.UNKNOWN -> "Unknown"
}

private fun typeLabel(type: ProductType) = when (type) {
  ProductType.PHYSICAL -> "Physical"
  ProductType.DIGITAL -> "Digital"
  ProductType.SERVICE -> "Service"
  ProductType.UNKNOWN -> "Product"
}

/** The site's catalog beside the picked product; [initialProductId] opens one, as a link or a scan does. */
@Composable
fun ProductsScreen(context: NativePluginContext, initialProductId: String? = null, startNew: Boolean = false) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val model = remember(hostId, context.firestore) { ProductsListModel(hostId, context.firestore, scope) }
  val editor = remember(hostId) { ProductEditorModel(ConsoleProductWriteApi(context.api, hostId), scope) }
  LaunchedEffect(model) { model.reload() }
  LaunchedEffect(editor.done) { if (editor.done != null) model.reload() }
  LaunchedEffect(startNew) { if (startNew) editor.create() }
  AglynListDetail(
    initialSelected = initialProductId,
    onItemRemoved = { model.reload() },
    list = { selected, onSelect -> ProductsList(context, model, editor, selected, onSelect) },
    detail = { selected ->
      if (selected == null) SelectionPlaceholder("Pick a product to see it here", icon = AglynIcons.named("inventory"))
      else ProductDetailPane(context, selected, editor)
    },
  )
  ProductDialogs(editor)
}

@Composable
private fun ProductsList(context: NativePluginContext, model: ProductsListModel, editor: ProductEditorModel, selected: String?, onSelect: (String) -> Unit) {
  LaunchedEffect(editor.created) {
    editor.created?.let { id ->
      onSelect(id)
      editor.created = null
    }
  }
  val listState = rememberLazyListState()
  // A new chip, filter or sort is a new list: it starts at its first row, not at the row that was on top before.
  // Coming back to the list (from a product, or Back) keeps where it was.
  var arrived by remember { mutableStateOf(false) }
  LaunchedEffect(model.filter, model.clauses, model.sort) { if (arrived) listState.scrollToItem(0) else arrived = true }
  val nearEnd by remember {
    derivedStateOf {
      val info = listState.layoutInfo
      info.totalItemsCount > 0 && (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - 4
    }
  }
  LaunchedEffect(nearEnd, model.hasMore) { if (nearEnd && model.hasMore) model.loadMore() }
  // The cap, standing rather than only on refusal (AGL-2113): the site's products against the plan's productsPerHost.
  // LIVE products, as the create door counts them (AGL-3918): a deleted product frees its slot, an archived one keeps it.
  var used by remember { mutableStateOf(0L) }
  var limit by remember { mutableStateOf<Double?>(null) }
  var planReady by remember { mutableStateOf(false) }
  LaunchedEffect(context.hostId, editor.done) {
    val hostId = context.hostId ?: return@LaunchedEffect
    try {
      used = context.firestore.liveCount(productsPath(hostId)) ?: used
      limit = productsPerHostLimit(context.api, hostId)
      planReady = true
    } catch (error: Throwable) {
      if (error is kotlinx.coroutines.CancellationException) throw error
    }
  }
  val hasRoom = !planReady || limit?.let { used < it } ?: true
  Column(Modifier.fillMaxSize()) {
    Column(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        SearchField(model.search, model::type, placeholder = "Search products", modifier = Modifier.weight(1f))
        WithTooltip("Scan a barcode") {
          OutlinedButton(onClick = { context.navigate(COMMERCE_SCAN_SCREEN) }, Modifier.testTag("products-scan")) {
            Icon(AglynIcons.named("qr_code_scanner"), contentDescription = "Scan a barcode")
          }
        }
      }
      // The list's own actions, end-aligned, then its filter chips on a row of their own (never squeezed by a button).
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(space(1f), Alignment.End), verticalAlignment = Alignment.CenterVertically) {
        if (canImportProducts(context)) {
          // The console's Import beside Add product: the data transfer hub's import, for this site's products.
          OutlinedButton(
            onClick = { context.navigate(CORE_DATA_IMPORT_SCREEN, productsImportParams(context.hostId)) },
            modifier = Modifier.testTag("import-products"),
          ) { Text("Import") }
        }
        Button(onClick = editor::create, Modifier.testTag("new-product"), enabled = hasRoom) {
          Icon(AglynIcons.named("add"), contentDescription = null)
          Text("New product", Modifier.padding(start = space(1f)))
        }
      }
      ChoiceChipRow(
        options = ProductFilter.entries.map { ChipOption(it.name, it.label) },
        selected = model.filter.name,
        onSelect = { model.pick(ProductFilter.valueOf(it)) },
        modifier = Modifier.fillMaxWidth(),
      )
      // Any filter the console's grid takes (name, status, type, slug, SKU, barcode) and its header sorts.
      Row(verticalAlignment = Alignment.Top) {
        ClauseFilterBar(
          fields = Contracts.productListQuery.fields,
          headers = Contracts.productListHeaders,
          choices = filterChoices(Contracts.productListOptions),
          clauses = model.clauses,
          onChange = model::setFilters,
          modifier = Modifier.weight(1f),
          refused = model.plan?.let { filterRefusals(it, model.clauses) } ?: emptyList(),
          notices = model.plan?.notices ?: emptyList(),
        )
        ListSortMenu(Contracts.productListQuery.sorts, model.sort, model::sortBy, Modifier.padding(start = space(1f)))
      }
      ProductsZone(context, COMMERCE_PRODUCTS_CREATE_SLOT)
      ProductsZone(context, COMMERCE_PRODUCTS_HUB_SLOT)
      // Products listed before they have a price (AGL-3676): the one step left before the store sells them.
      comingSoonNotice((model.rows as? Load.Ready)?.value.orEmpty().filter { it.status == ProductStatus.ACTIVE && it.priceMissing }.map { it.name })
        ?.let { NoticeBanner(it, StatusTone.INFO) }
      Text(productQuotaReadout(used, limit, planReady), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("products-quota"))
      if (editor.draft == null && editor.stock == null) {
        editor.done?.let { message ->
          NoticeBanner(message, StatusTone.SUCCESS, action = { com.aglyn.ui.TextButton(onClick = { editor.done = null }) { Text("Dismiss") } })
        }
      }
    }
    when (val rows = model.rows) {
      Load.Loading -> SkeletonList(rows = 6)
      is Load.Failed -> EmptyState("Could not load products", body = rows.message, icon = AglynIcons.named("error"), tone = EmptyTone.ERROR, action = { OutlinedButton(onClick = { model.reload() }) { Text("Try again") } })
      is Load.Ready -> if (rows.value.isEmpty()) {
        EmptyState(
          if (model.search.isBlank() && model.filter == ProductFilter.ALL) "No products yet" else "No products match",
          body = if (model.search.isBlank() && model.filter == ProductFilter.ALL) "Products in this store show up here." else "Try another filter or search.",
          icon = AglynIcons.named("inventory"),
        )
      } else {
        LazyColumn(Modifier.fillMaxSize().testTag("products-list"), state = listState) {
          items(rows.value, key = { it.id }) { row ->
            AglynListItem(
              title = row.name,
              supporting = listOfNotNull(
                priceLabel(row.priceRange),
                stockLabel(row.inventory),
                if (row.variantCount > 1) "${row.variantCount} variants" else null,
              ).joinToString(" · "),
              icon = AglynIcons.named("inventory"),
              selected = row.id == selected,
              trailing = {
                Row(horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
                  if (row.lowStock) StatusChip("Low stock", StatusTone.WARNING)
                  StatusChip(statusLabel(row.status), statusTone(row.status))
                }
              },
              onClick = { onSelect(row.id) },
              modifier = Modifier.testTag("product-${row.id}"),
            )
          }
          if (model.hasMore) item { SkeletonList(rows = 2) }
        }
      }
    }
  }
}

/** One product, live: what it is, its variants with their prices, codes and stock. */
@Composable
fun ProductDetailPane(context: NativePluginContext, productId: String, editor: ProductEditorModel? = null) {
  val hostId = context.hostId ?: return
  val flow = remember(hostId, productId, context.firestore) { context.firestore.observeDoc("${productsPath(hostId)}/$productId") }
  val live by flow.collectAsState(Live.Loading)
  var labels by remember(productId) { mutableStateOf<List<ProductLabelRow>?>(null) }
  var keys by remember(productId) { mutableStateOf(false) }
  var deleting by remember(productId) { mutableStateOf(false) }
  var working by remember(productId) { mutableStateOf(false) }
  var notice by remember(productId) { mutableStateOf<Pair<String, StatusTone>?>(null) }
  val scope = rememberCoroutineScope()
  // A deleted product closes its detail and drops out of the list.
  CloseWhenGone((live as? Live.Ready)?.let { ready -> ready.value != null && ready.value?.data?.get("deletedAt") == null })
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 8, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this product", body = "Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
    is Live.Ready -> {
      val doc = value.value
      if (doc == null || doc.data["deletedAt"] != null) {
        EmptyState("This product is gone", body = "It may have been deleted.", icon = AglynIcons.named("inventory"))
        return
      }
      val product = hostProductFrom(doc)
      val status = product.status ?: ProductStatus.ACTIVE
      labels?.let { rows ->
        ProductLabelsDialog(product.name ?: "Product", rows, context.peripherals.systemPrinter) { labels = null }
      }
      if (keys) ProductKeysDialog(context, productId, product.name ?: "Product") { keys = false }
      if (deleting) {
        ActionDialog(
          title = "Delete this product?",
          body = "\"${product.name ?: "This product"}\" stops being purchasable; blocks referencing it show a checkout error until repointed.",
          icon = "delete",
          confirmLabel = "Delete",
          destructive = true,
          busy = working,
          error = null,
          onDismiss = { deleting = false },
          onConfirm = {
            working = true
            scope.launch {
              notice = try {
                deleteProduct(context.api, hostId, productId)
                // In the catalog the detail closes on the delete, so the list says it.
                if (editor != null) {
                  editor.done = "Product deleted"
                  null
                } else {
                  "Product deleted" to StatusTone.SUCCESS
                }
              } catch (error: Throwable) {
                if (error is CancellationException) throw error
                productWriteMessage(error, "Could not delete product") to StatusTone.ERROR
              } finally {
                working = false
                deleting = false
              }
            }
          },
        )
      }
      Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("product-detail"),
        verticalArrangement = Arrangement.spacedBy(space(2f)),
      ) {
        notice?.let { (text, tone) -> NoticeBanner(text, tone, action = { com.aglyn.ui.TextButton(onClick = { notice = null }) { Text("Dismiss") } }) }
        val archived = status == ProductStatus.ARCHIVED
        fun duplicate() {
          working = true
          scope.launch {
            notice = try {
              val id = duplicateProduct(context.api, hostId, productId, com.aglyn.core.createResourceUid(20))
              context.navigate(COMMERCE_PRODUCT_SCREEN, mapOf("product" to id))
              "Product duplicated as draft" to StatusTone.SUCCESS
            } catch (error: Throwable) {
              if (error is CancellationException) throw error
              productWriteMessage(error, "Could not duplicate product") to StatusTone.WARNING
            } finally {
              working = false
            }
          }
                }
        fun setStatus(next: String) {
          working = true
          scope.launch {
            notice = try {
              ConsoleProductWriteApi(context.api, hostId).save(productId, false, productStatusSaveJson(doc.data, next), com.aglyn.plugins.commerce.pos.newAttemptKey("status"))
              // A product with a variant nobody has priced may go live (AGL-3676): the owner is told, not stopped.
              if (next == "active" && productPriceMissing(doc.data)) activatingUnpricedNotice(product.name ?: "This product") to StatusTone.INFO else null
            } catch (error: Throwable) {
              if (error is CancellationException) throw error
              productWriteMessage(error, "The product could not be saved") to StatusTone.ERROR
            } finally {
              working = false
            }
          }
                }
        fun toggleArchive() = setStatus(if (archived) "active" else "archived")
        val picture = product.mediaUrls.orEmpty().firstOrNull()?.let { mediaPreviewUrl(it, context.api.origin, hostId, 160) }
        SectionCard(null) {
          // The product's picture, name and state at the top; the less common actions in the ⋮ menu beside them.
          DetailHeader(
            product.name ?: "Product",
            icon = AglynIcons.named("inventory"),
            image = picture?.let { url -> { RemoteImage(url, null, Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop) } },
            status = {
              FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
                StatusChip(statusLabel(status), statusTone(status))
                StatusChip(typeLabel(product.type ?: ProductType.PHYSICAL))
                if (isLowStock(product)) StatusChip("Low stock", StatusTone.WARNING)
                if (product.taxExempt == true) StatusChip("Tax exempt")
              }
            },
            actions = if (editor == null) null else {
              {
                OverflowMenu(
                  buildList {
                    if (status == ProductStatus.DRAFT) add(MenuAction("product-edit", "Edit product", "tune") { editor.edit(productId, doc.data) })
                    add(MenuAction("product-duplicate", "Duplicate", "content_copy", enabled = !working) { duplicate() })
                    add(MenuAction("product-archive", if (archived) "Activate" else "Archive", if (archived) "unarchive" else "archive", enabled = !working) { toggleArchive() })
                    if (product.type == ProductType.DIGITAL) add(MenuAction("product-keys", "Keys", "key") { keys = true })
                    // Shelf labels with a barcode the register scans back (the console's Labels).
                    if (product.type == ProductType.PHYSICAL) add(MenuAction("product-labels", "Labels", "label") { labels = productLabelRows(doc.data) })
                    add(MenuAction("product-delete", "Delete", "delete", destructive = true, enabled = !working) { deleting = true })
                  },
                  contentDescription = "More product actions",
                )
              }
            },
          )
          Text(priceLabel(productPriceRange(product)), style = MaterialTheme.typography.titleLarge)
          Text(stockLabel(productInventory(product)), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          product.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
          if (editor != null) {
            // One filled button, the next step for the product: a draft goes live; anything else is edited.
            if (status == ProductStatus.DRAFT) {
              Button(onClick = { setStatus("active") }, enabled = !working, modifier = Modifier.testTag("activate-product")) {
                Icon(AglynIcons.named("check_circle"), contentDescription = null)
                Text("Activate", Modifier.padding(start = space(1f)))
              }
            } else {
              Button(onClick = { editor.edit(productId, doc.data) }, Modifier.testTag("edit-product")) {
                Icon(AglynIcons.named("tune"), contentDescription = null)
                Text("Edit product", Modifier.padding(start = space(1f)))
              }
            }
            // The address, supplier, tags, categories, tax, billing and search listing, and the pictures and downloads:
            // one step in, as rows rather than more buttons.
            AglynListItem(
              title = "Details",
              supporting = "Address, supplier, tags, categories, tax and search listing",
              icon = AglynIcons.named("info"),
              trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
              onClick = { context.navigate("commerce.productDetails", mapOf("productId" to productId)) },
              modifier = Modifier.testTag("product-details"),
            )
            AglynListItem(
              title = "Images and files",
              supporting = if (product.type == ProductType.DIGITAL) "Pictures, downloads and members videos" else "Pictures",
              icon = AglynIcons.named("photo_library"),
              trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
              onClick = { context.navigate(COMMERCE_PRODUCT_MEDIA_SCREEN, mapOf("productId" to productId)) },
              modifier = Modifier.testTag("product-media-link"),
            )
          }
        }
        SectionCard(if (product.variants.orEmpty().size > 1) "Variants" else "Price and stock") {
          product.variants.orEmpty().forEachIndexed { index, variant ->
            if (index > 0) HorizontalDivider()
            Column(Modifier.fillMaxWidth().testTag("variant-${variant.id}")) {
              AmountRow(variantLabel(variant), priceLabel((variant.priceUsd ?: 0.0) to (variant.priceUsd ?: 0.0)))
              val notes = listOfNotNull(
                variant.compareAtPriceUsd?.takeIf { it > (variant.priceUsd ?: 0.0) }?.let { "Was ${priceLabel(it to it)}" },
                variant.sku?.takeIf { it.isNotBlank() }?.let { "SKU $it" },
                variant.barcode?.takeIf { it.isNotBlank() }?.let { "Barcode $it" },
                stockLabel(variant.inventory),
              )
              Text(notes.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
              if (editor != null && variant.inventory != null && variant.id != null) {
                OutlinedButton(
                  onClick = { editor.adjust(productId, variant.id!!, variantLabel(variant)) },
                  modifier = Modifier.padding(top = space(1f)).testTag("adjust-${variant.id}"),
                ) { Text("Adjust stock") }
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Scan stock: the camera (where the device has one) or a typed code, looked
 * up across every product by its barcode, then its SKU. One match opens it;
 * several are listed.
 */
@Composable
fun ScanScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val camera = LocalCameraScanner.current
  val scope = rememberCoroutineScope()
  var cameraOpen by rememberSaveable { mutableStateOf(camera != null) }
  var typed by rememberSaveable { mutableStateOf("") }
  var status by remember { mutableStateOf<String?>(null) }
  var matches by remember { mutableStateOf<List<ProductRow>>(emptyList()) }
  fun lookUp(code: String) {
    status = "Looking up $code…"
    scope.launch {
      try {
        val found = findProductsByCode(context.firestore, hostId, code)
        matches = found
        status = when (found.size) {
          0 -> "No product has the code $code."
          1 -> null.also { cameraOpen = false; context.navigate(COMMERCE_PRODUCT_SCREEN, mapOf("product" to found.single().id)) }
          else -> "${found.size} products have the code $code."
        }
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        status = "The code could not be looked up. Check the connection and try again."
      }
    }
  }
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(space(2f)).testTag("scan"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      if (camera != null) {
        Button(onClick = { cameraOpen = true }, Modifier.fillMaxWidth().testTag("scan-camera")) {
          Icon(AglynIcons.named("photo_camera"), contentDescription = null)
          Text("Scan with the camera", Modifier.padding(start = space(1f)))
        }
      }
      OutlinedTextField(
        typed,
        { typed = it },
        label = { Text("Barcode or SKU") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { if (typed.isNotBlank()) lookUp(typed) }),
        trailingIcon = { Icon(AglynIcons.named("search"), contentDescription = null) },
        modifier = Modifier.fillMaxWidth().testTag("scan-code"),
      )
      OutlinedButton(onClick = { lookUp(typed) }, enabled = typed.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Look up") }
      status?.let { NoticeBanner(it, if (matches.isEmpty() && !it.startsWith("Looking")) StatusTone.WARNING else StatusTone.INFO) }
      if (matches.size > 1) {
        SectionCard("Matches") {
          matches.forEach { row ->
            AglynListItem(
              title = row.name,
              supporting = priceLabel(row.priceRange) + " · " + stockLabel(row.inventory),
              icon = AglynIcons.named("inventory"),
              onClick = { context.navigate(COMMERCE_PRODUCT_SCREEN, mapOf("product" to row.id)) },
            )
          }
        }
      }
    }
  }
  if (camera != null && cameraOpen) {
    BarcodeScanSheet(
      scanner = camera,
      onCode = ::lookUp,
      onDismiss = { cameraOpen = false },
      status = status,
      title = "Scan a product",
    )
  }
}

@Composable
private fun ProductDialogs(editor: ProductEditorModel) {
  editor.draft?.let { draft ->
    // A product is a long form (options, variants, prices, codes, stock): a sheet with one Save in its header, not an alert.
    FormSheet(
      title = if (draft.create) "New product" else "Edit ${draft.name.ifBlank { "product" }}",
      busy = editor.busy,
      error = editor.error,
      onDismiss = editor::close,
      onConfirm = editor::save,
      confirmLabel = if (draft.create) "Add product" else "Save",
      confirmEnabled = draft.name.isNotBlank(),
      modifier = Modifier.testTag("product-form"),
    ) {
      Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(draft.name, { editor.change(draft.copy(name = it)) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("product-name"))
        OutlinedTextField(draft.description, { editor.change(draft.copy(description = it)) }, label = { Text("Description") }, minLines = 2, modifier = Modifier.fillMaxWidth())
        ChoiceChipRow(
          options = listOf(ProductStatus.ACTIVE, ProductStatus.DRAFT, ProductStatus.ARCHIVED).map { ChipOption(it.raw, statusLabel(it)) },
          selected = draft.status.raw,
          onSelect = { raw -> editor.change(draft.copy(status = ProductStatus.entries.first { it.raw == raw })) },
        )
        if (draft.create) {
          ChoiceChipRow(
            options = listOf(ProductType.PHYSICAL, ProductType.DIGITAL, ProductType.SERVICE).map { ChipOption(it.raw, typeLabel(it)) },
            selected = draft.type.raw,
            onSelect = { raw -> editor.change(draft.copy(type = ProductType.entries.first { it.raw == raw })) },
          )
        }
        Text("Options", style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
        draft.options.forEachIndexed { index, option ->
          Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(option.name, { editor.change(draft.withOptionName(index, it)) }, label = { Text("Option name") }, placeholder = { Text("Size") }, singleLine = true,
              modifier = Modifier.weight(1f).testTag("option-name-$index"))
            WithTooltip("Remove option ${option.name.ifBlank { index + 1 }}") { IconButton(onClick = { editor.change(draft.withOptionRemoved(index)) }, modifier = Modifier.testTag("option-remove-$index")) {
              Icon(AglynIcons.named("close"), contentDescription = "Remove option ${option.name.ifBlank { index + 1 }}")
            } }
          }
          OutlinedTextField(option.valuesText, { editor.change(draft.withOptionValues(index, it)) }, label = { Text("Values") }, placeholder = { Text("Small, Medium, Large") },
            supportingText = { Text("Separate values with commas.") }, modifier = Modifier.fillMaxWidth().testTag("option-values-$index"))
        }
        if (draft.options.size < COMMERCE_MAX_OPTIONS) {
          OutlinedButton(onClick = { editor.change(draft.withOptionAdded()) }, Modifier.testTag("option-add")) {
            Icon(AglynIcons.named("add"), contentDescription = null)
            Text(if (draft.options.isEmpty()) "Add options like size or color" else "Add another option", Modifier.padding(start = space(1f)))
          }
        }
        if (draft.variants.size > 1) Text("${draft.variants.size} variants", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        draft.variants.forEachIndexed { index, variant ->
          fun update(next: VariantDraft) = editor.change(draft.copy(variants = draft.variants.toMutableList().also { it[index] = next }))
          if (draft.variants.size > 1) Text(variant.label, style = MaterialTheme.typography.titleSmall)
          Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            OutlinedTextField(variant.price, { update(variant.copy(price = it)) }, label = { Text("Price") }, prefix = { Text("$") }, singleLine = true,
              keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal), modifier = Modifier.weight(1f).testTag("variant-price-$index"))
            OutlinedTextField(variant.compareAt, { update(variant.copy(compareAt = it)) }, label = { Text("Compare at") }, prefix = { Text("$") }, singleLine = true,
              keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Decimal), modifier = Modifier.weight(1f))
          }
          Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            OutlinedTextField(variant.sku, { update(variant.copy(sku = it)) }, label = { Text("SKU") }, singleLine = true, modifier = Modifier.weight(1f))
            OutlinedTextField(variant.barcode, { update(variant.copy(barcode = it)) }, label = { Text("Barcode") }, singleLine = true, modifier = Modifier.weight(1f))
          }
          if (draft.create || variant.fresh) {
            OutlinedTextField(variant.stock, { update(variant.copy(stock = it.filter(Char::isDigit))) }, label = { Text("Stock (optional)") },
              supportingText = { Text("Leave empty to not track stock.") }, singleLine = true,
              keyboardOptions = KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number), modifier = Modifier.fillMaxWidth())
          }
        }
      }
    }
  }
  editor.stock?.let { stock ->
    ActionDialog(
      title = "Adjust stock",
      body = stock.label,
      icon = "inventory",
      confirmLabel = "Apply",
      confirmEnabled = stockDelta(stock.change) != null,
      busy = editor.busy,
      error = editor.error,
      onDismiss = editor::close,
      onConfirm = editor::applyStock,
    ) {
      OutlinedTextField(stock.change, { editor.changeStock(stock.copy(change = it)) }, label = { Text("Change") }, placeholder = { Text("+5 or -2") }, singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("stock-change"))
      ChoiceChipRow(
        options = STOCK_REASONS.map { (key, label) -> ChipOption(key, label) },
        selected = stock.reason,
        onSelect = { editor.changeStock(stock.copy(reason = it)) },
        wrap = true,
      )
    }
  }
}

/** The data transfer hub's import screen (core), which the products list's Import opens. */
const val CORE_DATA_IMPORT_SCREEN = "core.settings.data.import"

/** The import screen's parameters for this site's products, as the console's Import names its target. */
fun productsImportParams(hostId: String?): Map<String, String> =
  buildMap {
    put("resource", "commerce.products")
    put("title", "Import products")
    if (hostId != null) put("hostId", hostId)
  }

/**
 * Who may import: the import screen's own gate (a workspace owner or admin), as the console offers Import only to whom
 * the transfer route takes it from.
 */
fun canImportProducts(context: NativePluginContext): Boolean = context.hostId != null && (context.orgRole == "owner" || context.orgRole == "admin")

/** What a product write's failure says: the route's own words for a refusal, else that it is not known whether it landed. */
fun productWriteMessage(error: Throwable, fallback: String): String {
  val refused = error as? com.aglyn.core.ConsoleApiError
  return when {
    refused != null && refused.status in 1..499 -> refused.message.ifEmpty { fallback }
    else -> "It is not known whether that went through. Trying again is safe; it will not happen twice."
  }
}

/**
 * The Products page's zones, the console's `productsCreate` (another way to start a product, beside Add product) and
 * `productsHub` (above the catalog: proposals the hub writes). The plugins that put a widget here are never named;
 * each zone draws whatever the registry holds for it, and nothing when no plugin contributes.
 */
const val COMMERCE_PRODUCTS_CREATE_SLOT = "productsCreate"
const val COMMERCE_PRODUCTS_HUB_SLOT = "productsHub"

@Composable
internal fun ProductsZone(context: NativePluginContext, slot: String) {
  val widgets = context.slotWidgets(slot)
  if (widgets.isEmpty()) return
  Column(Modifier.fillMaxWidth().testTag("products-zone-$slot"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    for (widget in widgets) androidx.compose.runtime.key(widget.id) { widget.content(context) }
  }
}
