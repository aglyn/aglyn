package com.aglyn.plugins.commerce.products

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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.ProductStatus
import com.aglyn.contracts.ProductType
import com.aglyn.contracts.isLowStock
import com.aglyn.contracts.productInventory
import com.aglyn.contracts.productPriceRange
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.plugins.commerce.pos.Load
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.AmountRow
import com.aglyn.ui.BarcodeScanSheet
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.LocalCameraScanner
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
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
fun ProductsScreen(context: NativePluginContext, initialProductId: String? = null) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val model = remember(hostId, context.firestore) { ProductsListModel(hostId, context.firestore, scope) }
  LaunchedEffect(model) { model.reload() }
  AglynListDetail(
    initialSelected = initialProductId,
    list = { selected, onSelect -> ProductsList(context, model, selected, onSelect) },
    detail = { selected ->
      if (selected == null) EmptyState("Pick a product to see it here", icon = AglynIcons.named("inventory"))
      else ProductDetailPane(context, selected)
    },
  )
}

@Composable
private fun ProductsList(context: NativePluginContext, model: ProductsListModel, selected: String?, onSelect: (String) -> Unit) {
  val listState = rememberLazyListState()
  val nearEnd by remember {
    derivedStateOf {
      val info = listState.layoutInfo
      info.totalItemsCount > 0 && (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - 4
    }
  }
  LaunchedEffect(nearEnd, model.hasMore) { if (nearEnd && model.hasMore) model.loadMore() }
  Column(Modifier.fillMaxSize()) {
    Column(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        SearchField(model.search, model::type, placeholder = "Search products", modifier = Modifier.weight(1f))
        OutlinedButton(onClick = { context.navigate(COMMERCE_SCAN_SCREEN) }, Modifier.testTag("products-scan")) {
          Icon(AglynIcons.named("qr_code_scanner"), contentDescription = "Scan a barcode")
        }
      }
      ChoiceChipRow(
        options = ProductFilter.entries.map { ChipOption(it.name, it.label) },
        selected = model.filter.name,
        onSelect = { model.pick(ProductFilter.valueOf(it)) },
      )
    }
    when (val rows = model.rows) {
      Load.Loading -> SkeletonList(rows = 6)
      is Load.Failed -> EmptyState("Could not load products", body = rows.message, icon = AglynIcons.named("error"), action = { OutlinedButton(onClick = { model.reload() }) { Text("Try again") } })
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
fun ProductDetailPane(context: NativePluginContext, productId: String) {
  val hostId = context.hostId ?: return
  val flow = remember(hostId, productId, context.firestore) { context.firestore.observeDoc("${productsPath(hostId)}/$productId") }
  val live by flow.collectAsState(Live.Loading)
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 8, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this product", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val doc = value.value
      if (doc == null || doc.data["deletedAt"] != null) {
        EmptyState("This product is gone", body = "It may have been deleted.", icon = AglynIcons.named("inventory"))
        return
      }
      val product = hostProductFrom(doc)
      val status = product.status ?: ProductStatus.ACTIVE
      Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("product-detail"),
        verticalArrangement = Arrangement.spacedBy(space(2f)),
      ) {
        SectionCard(null) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text(product.name ?: "Product", Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
            StatusChip(statusLabel(status), statusTone(status))
          }
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            StatusChip(typeLabel(product.type ?: ProductType.PHYSICAL))
            if (isLowStock(product)) StatusChip("Low stock", StatusTone.WARNING)
            if (product.taxExempt == true) StatusChip("Tax exempt")
          }
          Text(priceLabel(productPriceRange(product)), style = MaterialTheme.typography.titleLarge)
          Text(stockLabel(productInventory(product)), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          product.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
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
