package com.aglyn.plugins.commerce.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
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
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ShippingCostInput
import com.aglyn.contracts.canTransitionOrder
import com.aglyn.contracts.describeOrderDispute
import com.aglyn.contracts.describeOrderTaxMode
import com.aglyn.contracts.describePaymentRisk
import com.aglyn.contracts.fulfillItemsIsEverything
import com.aglyn.contracts.fulfillItemsSelection
import com.aglyn.contracts.fulfillItemsStartQuantities
import com.aglyn.contracts.fulfillmentCarrierChoice
import com.aglyn.contracts.orderDisputeBlocksRefund
import com.aglyn.contracts.orderLineRefunded
import com.aglyn.contracts.orderRefundPrompt
import com.aglyn.contracts.parseShippingCostInput
import com.aglyn.contracts.splitOrderReversal
import com.aglyn.contracts.trackingUrlFor
import com.aglyn.contracts.OrderAddress
import com.aglyn.contracts.OrderRefundState
import com.aglyn.contracts.OrderRestockCheck
import com.aglyn.contracts.describeRestockCheck
import com.aglyn.contracts.OrderStatus
import com.aglyn.contracts.OrderStatusColorValue
import com.aglyn.contracts.formatOrderMoney
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.contracts.orderChannelLabel
import com.aglyn.contracts.orderRefundSummary
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.screens.ScreenCatalog
import com.aglyn.plugins.commerce.pos.Load
import com.aglyn.plugins.commerce.pos.newAttemptKey
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.AmountRow
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.MetricCard
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space
import kotlinx.coroutines.launch

const val COMMERCE_ORDERS_SCREEN = "commerce.orders"

/** The spec screen with this order's pickup and delivery steps, its returns and the services other plugins add. */
const val COMMERCE_ORDER_SERVICES_SCREEN = "commerce.orderServices"
const val COMMERCE_ORDER_SCREEN = "commerce.order"

/** The console's chip color for a status, as a kit tone. */
fun statusTone(status: OrderStatus): StatusTone = when (Contracts.orderStatusColor[status.raw]) {
  OrderStatusColorValue.SUCCESS -> StatusTone.SUCCESS
  OrderStatusColorValue.INFO -> StatusTone.INFO
  OrderStatusColorValue.WARNING -> StatusTone.WARNING
  OrderStatusColorValue.ERROR -> StatusTone.ERROR
  else -> StatusTone.NEUTRAL
}

private fun money(cents: Double) = formatOrderMoney(cents)

private fun addressLines(address: OrderAddress?): List<String> = address?.let {
  listOfNotNull(
    it.name,
    it.line1,
    it.line2,
    listOfNotNull(it.city, listOfNotNull(it.state, it.postalCode).joinToString(" ").ifBlank { null }).joinToString(", ").ifBlank { null },
    it.country,
  ).filter { line -> line.isNotBlank() }
} ?: emptyList()

/**
 * A site's orders: the list (filter chips, search, a page at a time) beside
 * the picked order on wide windows. [initialOrderId] opens one order, as a
 * notification or a link to it does.
 */
@Composable
fun OrdersScreen(context: NativePluginContext, initialOrderId: String? = null) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val model = remember(hostId, context.firestore) { OrdersListModel(hostId, context.firestore, scope) }
  LaunchedEffect(model) { model.reload() }
  AglynListDetail(
    initialSelected = initialOrderId,
    list = { selected, onSelect -> OrdersList(context, model, selected, onSelect) },
    detail = { selected ->
      if (selected == null) {
        EmptyState("Pick an order to see it here", icon = AglynIcons.named("receipt"))
      } else {
        OrderDetailPane(context, selected, onChanged = { model.reload() })
      }
    },
  )
}

@Composable
private fun OrdersList(context: NativePluginContext, model: OrdersListModel, selected: String?, onSelect: (String) -> Unit) {
  val listState = rememberLazyListState()
  val scope = rememberCoroutineScope()
  // Select mode: tick orders, then mark them all fulfilled in one go (the console's bulk action on the orders list).
  var selecting by remember { mutableStateOf(false) }
  var picked by remember { mutableStateOf(emptySet<String>()) }
  var confirming by remember { mutableStateOf(false) }
  var running by remember { mutableStateOf(false) }
  var outcome by remember { mutableStateOf<BulkFulfillResult?>(null) }
  var drafting by remember { mutableStateOf(false) }
  var exportPreset by remember { mutableStateOf<String?>(null) }
  var presetMenu by remember { mutableStateOf(false) }
  var said by remember { mutableStateOf<String?>(null) }
  val hostId = context.hostId
  // Charges a shopper's bank is disputing, on their own query whatever the list is filtered to (the console's banner).
  val disputeFlow = remember(hostId, context.firestore) { hostId?.let { context.firestore.observe(openDisputesQuery(it)) } }
  val disputeDocs = disputeFlow?.collectAsState(Live.Loading)?.value
  val disputeRows = (disputeDocs as? Live.Ready)?.value.orEmpty()
  val disputes = com.aglyn.contracts.summariseOpenDisputes(disputeRows.take(OPEN_DISPUTE_CEILING).map(::hostOrderFrom), nowMillis().toDouble())
  val loaded = (model.rows as? Load.Ready)?.value.orEmpty()
  val nearEnd by remember {
    derivedStateOf {
      val info = listState.layoutInfo
      info.totalItemsCount > 0 && (info.visibleItemsInfo.lastOrNull()?.index ?: 0) >= info.totalItemsCount - 4
    }
  }
  LaunchedEffect(nearEnd, model.hasMore) { if (nearEnd && model.hasMore) model.loadMore() }
  Column(Modifier.fillMaxSize()) {
    Column(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) { SearchField(model.search, model::type, placeholder = "Search by order number or customer") }
        TextButton(
          onClick = { selecting = !selecting; picked = emptySet() },
          modifier = Modifier.testTag("orders-select"),
        ) { Text(if (selecting) "Done" else "Select") }
      }
      outcome?.let { done ->
        NoticeBanner(describeBulkFulfill(done), if (done.refused.isEmpty() && done.unknown.isEmpty()) StatusTone.SUCCESS else StatusTone.WARNING)
      }
      ChoiceChipRow(
        options = OrderFilter.entries.map { ChipOption(it.name, it.label) },
        selected = model.filter.name,
        onSelect = { key -> model.pick(OrderFilter.valueOf(key)) },
      )
      model.notice?.let { NoticeBanner(it, StatusTone.WARNING) }
      said?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = { said = null }) { Text("Dismiss") } }) }
      if (disputes.count > 0) {
        NoticeBanner(
          "${openDisputesTitle(disputes, disputeRows.size > OPEN_DISPUTE_CEILING)}. ${openDisputesDetail(disputes)}",
          if (disputes.overdue) StatusTone.ERROR else StatusTone.WARNING,
          modifier = Modifier.testTag("orders-disputes"),
          action = if (model.filter == OrderFilter.DISPUTES) null else ({ TextButton(onClick = { model.pick(OrderFilter.DISPUTES) }) { Text("Show them") } }),
        )
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        // Selling to someone directly: their order as a payment link (the console's Draft order).
        OutlinedButton(onClick = { drafting = true }, modifier = Modifier.testTag("orders-draft")) { Text("Draft order") }
        Box {
          OutlinedButton(onClick = { presetMenu = true }, modifier = Modifier.testTag("orders-export-shipping")) { Text("Export for shipping") }
          androidx.compose.material3.DropdownMenu(expanded = presetMenu, onDismissRequest = { presetMenu = false }) {
            Contracts.orderShippingPresetChoices.forEach { preset ->
              androidx.compose.material3.DropdownMenuItem(
                text = {
                  Column {
                    Text(preset.label)
                    preset.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                  }
                },
                onClick = {
                  presetMenu = false
                  val id = hostId ?: return@DropdownMenuItem
                  scope.launch {
                    prepareOrdersForShipping(context.api, id)
                    exportPreset = preset.id
                  }
                },
              )
            }
          }
        }
        if (com.aglyn.plugins.commerce.products.canImportProducts(context)) {
          OutlinedButton(
            onClick = { context.navigate(com.aglyn.plugins.commerce.products.CORE_DATA_IMPORT_SCREEN, trackingImportParams(hostId)) },
            modifier = Modifier.testTag("orders-import-tracking"),
          ) { Text("Import tracking") }
        }
      }
    }
    if (drafting) {
      DraftOrderDialog(context, onDismiss = { drafting = false }) { message ->
        drafting = false
        said = message
        model.reload()
      }
    }
    exportPreset?.let { preset ->
      com.aglyn.pluginhost.TransferExportDialog(
        context = context,
        resource = "commerce.orders",
        title = "Export orders for shipping",
        hostId = hostId,
        scope = shippingExportScope(),
        fileStem = "orders-to-ship",
        filterLabel = Contracts.ordersToShipFilterLabel,
        preset = preset,
      ) { message ->
        exportPreset = null
        if (message != null) said = message
      }
    }
    when (val rows = model.rows) {
      Load.Loading -> SkeletonList(rows = 6)
      is Load.Failed -> EmptyState(
        "Could not load orders",
        body = rows.message,
        icon = AglynIcons.named("error"),
        action = { OutlinedButton(onClick = { model.reload() }) { Text("Try again") } },
      )
      is Load.Ready -> if (rows.value.isEmpty()) {
        EmptyState(
          if (model.search.isBlank() && model.filter == OrderFilter.ALL) "No orders yet" else "No orders match",
          body = if (model.search.isBlank() && model.filter == OrderFilter.ALL) "Orders from the store and the register show up here." else "Try another filter or search.",
          icon = AglynIcons.named("receipt"),
        )
      } else {
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("orders-list"), state = listState) {
          items(rows.value, key = { it.id }) { row ->
            if (selecting) {
              OrderListRow(row, row.id in picked, ticked = row.id in picked) { picked = if (row.id in picked) picked - row.id else picked + row.id }
            } else {
              OrderListRow(row, row.id == selected) { onSelect(row.id) }
            }
          }
          if (model.hasMore || model.loadingMore) item { SkeletonList(rows = 2) }
        }
      }
    }
    if (selecting) {
      Row(Modifier.fillMaxWidth().padding(space(2f)), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Button(
          onClick = { confirming = true },
          enabled = picked.isNotEmpty() && !running,
          modifier = Modifier.weight(1f).testTag("orders-bulk-fulfill"),
        ) { Text("Mark ${picked.size} fulfilled") }
        // Whatever services are connected add what they can do to the ticked orders (buy their labels, say).
        if (ScreenCatalog.zone("ordersBulk").isNotEmpty()) {
          OutlinedButton(
            onClick = { context.navigate("commerce.ordersBulk", mapOf("orderIds" to picked.sorted().joinToString(","), "run" to newAttemptKey("bulk").filter { it.isLetterOrDigit() })) },
            enabled = picked.isNotEmpty() && picked.size <= 50,
            modifier = Modifier.testTag("orders-bulk-more"),
          ) { Text("More…") }
        }
      }
    }
    if (confirming) {
      ActionDialog(
        title = "Mark ${picked.size} ${if (picked.size == 1) "order" else "orders"} fulfilled?",
        body = "Each order is checked on its own: one that cannot be fulfilled is skipped and the rest go ahead. Customers are emailed as they are for a single order.",
        icon = "done_all",
        confirmLabel = "Mark fulfilled",
        busy = running,
        error = null,
        onDismiss = { confirming = false },
        onConfirm = {
          val hostId = context.hostId ?: return@ActionDialog
          scope.launch {
            running = true
            outcome = bulkFulfillOrders(context.api, hostId, loaded.filter { it.id in picked }, newAttemptKey("bulk-fulfill"))
            running = false
            confirming = false
            picked = emptySet()
            selecting = false
            model.reload()
          }
        },
      )
    }
  }
}

@Composable
private fun OrderListRow(row: OrderRow, selected: Boolean, ticked: Boolean? = null, onClick: () -> Unit) {
  val now = nowMillis()
  val items = if (row.itemCount == 1L) "1 item" else "${row.itemCount} items"
  AglynListItem(
    title = "${row.label} · ${row.customer}",
    supporting = listOfNotNull(
      money(row.netCents),
      items,
      row.channelLabel,
      row.createdAtMs.takeIf { it > 0 }?.let { relativeTime(it, now) },
    ).joinToString(" · "),
    icon = AglynIcons.named(if (ticked == true) "check_circle" else if (row.channelLabel == orderChannelLabel("pos")) "point_of_sale" else "receipt"),
    selected = selected,
    trailing = {
      Row(horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
        if (row.disputeOpen) StatusChip("Dispute", StatusTone.ERROR)
        if (row.testMode) StatusChip("Test")
        StatusChip(row.statusLabel, statusTone(row.status))
      }
    },
    onClick = onClick,
    modifier = Modifier.testTag("order-${row.id}"),
  )
}

/** One order, live: what was bought, what it cost, who bought it, what shipped, and what can be done. */
@Composable
fun OrderDetailPane(context: NativePluginContext, orderId: String, onChanged: () -> Unit = {}) {
  val hostId = context.hostId ?: return
  val flow = remember(hostId, orderId, context.firestore) { context.firestore.observeDoc("${ordersPath(hostId)}/$orderId") }
  val live by flow.collectAsState(Live.Loading)
  val scope = rememberCoroutineScope()
  val actions = remember(hostId, orderId) { OrderActionsModel(ConsoleOrderActionsApi(context.api, hostId, context.firestore), scope) }
  LaunchedEffect(actions.done) { if (actions.done != null) onChanged() }
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 8, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this order", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val doc = value.value
      if (doc == null) {
        EmptyState("This order is gone", body = "It may have been removed in the console.", icon = AglynIcons.named("receipt"))
      } else {
        val detail = orderDetail(doc)
        val printing = remember(orderId) { OrderPrintState() }
        val uriHandler = LocalUriHandler.current
        val printer = context.peripherals.systemPrinter
        val onPrint: (OrderPrintKind) -> Unit = { kind ->
          scope.launch {
            printing.busy = kind.raw
            printing.problem = printOrderPage(context.api, printer, hostId, orderId, kind)
            printing.busy = null
          }
        }
        val onPrintLabel: (Shipment) -> Unit = { shipment ->
          val link = shipment.labelUrl
          if (link != null) {
            scope.launch {
              printing.busy = shipment.id
              printing.problem = null
              when (val outcome = printShippingLabel(context.api, printer, link, detail.label)) {
                LabelPrintOutcome.Done -> Unit
                LabelPrintOutcome.OpenInstead -> uriHandler.openUri(link)
                is LabelPrintOutcome.Failed -> printing.problem = outcome.message
              }
              printing.busy = null
            }
          }
        }
        val registerReceipt: (@Composable () -> Unit)? = if (detail.order.channel == com.aglyn.contracts.OrderChannel.POS) {
          {
            OrderReceiptActions(context, orderId, doc.data, detail.label) { said, failure ->
              actions.done = said
              printing.problem = failure
            }
          }
        } else {
          null
        }
        OrderDetailContent(detail, actions, printing, onPrint, onPrintLabel, registerReceipt) {
          context.navigate(COMMERCE_ORDER_SERVICES_SCREEN, mapOf("orderId" to orderId))
        }
        OrderDialogs(detail, actions)
      }
    }
  }
}

/** What the order screen's Print buttons are doing: the page or label printing, and why one did not. */
class OrderPrintState {
  var busy by mutableStateOf<String?>(null)
  var problem by mutableStateOf<String?>(null)
}

@Composable
private fun OrderDetailContent(
  detail: OrderDetail,
  actions: OrderActionsModel,
  printing: OrderPrintState,
  onPrint: (OrderPrintKind) -> Unit,
  onPrintLabel: (Shipment) -> Unit,
  registerReceipt: (@Composable () -> Unit)?,
  openServices: () -> Unit,
) {
  val order = detail.order
  val totals = order.totals
  val uriHandler = LocalUriHandler.current
  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("order-detail"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    actions.done?.let { message ->
      NoticeBanner(message, StatusTone.SUCCESS, action = { TextButton(onClick = { actions.done = null }) { Text("Dismiss") } })
    }
    if (actions.dialog == null) actions.error?.let { NoticeBanner(it, StatusTone.ERROR) }
    SectionCard(null) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(detail.label, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
        StatusChip(statusLabel(detail.status), statusTone(detail.status))
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        StatusChip(orderChannelLabel(order.channel?.raw))
        if (detail.testMode) StatusChip("Test mode", StatusTone.WARNING)
        if (detail.refundState != OrderRefundState.NONE) StatusChip(if (detail.refundState == OrderRefundState.FULL) "Refunded" else "Partly refunded", StatusTone.ERROR)
      }
      order.createdAtMs?.let {
        Text(formatReceiptTime(it.toLong()), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      describeOrderDispute(order, nowMillis().toDouble())?.let { dispute ->
        NoticeBanner(
          "${dispute.label}. ${dispute.detail}",
          if (dispute.tone == "open" || dispute.tone == "lost") StatusTone.ERROR else StatusTone.INFO,
          modifier = Modifier.testTag("order-dispute"),
        )
      }
      describePaymentRisk(order.paymentRisk)?.let { risk ->
        NoticeBanner("${risk.label}. ${risk.detail}", StatusTone.WARNING, modifier = Modifier.testTag("order-payment-risk"))
      }
      if (canTransitionOrder(detail.status, OrderStatus.REFUNDED) && orderDisputeBlocksRefund(order)) {
        NoticeBanner(Contracts.refundBlockedByDispute, StatusTone.INFO)
      }
      OrderActionButtons(detail.actions, actions)
    }

    SectionCard("Items") {
      if (detail.lines.isEmpty()) Text("No items on this order.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      val canRefundLines = canTransitionOrder(detail.status, OrderStatus.REFUNDED) && !orderDisputeBlocksRefund(order)
      order.lineItems.orEmpty().forEachIndexed { index, line ->
        val state = detail.lines.getOrNull(index)
        // What this line is still entitled to (AGL-2454): a line refunded by itself is struck through.
        val withdrawn = orderLineRefunded(order, index)
        Column(Modifier.fillMaxWidth().testTag("order-line-$index")) {
          AmountRow("${line.quantity.toLong()} × ${line.name}", money(line.unitAmountCents * line.quantity), muted = withdrawn)
          val notes = listOfNotNull(
            line.variantLabel,
            line.sku?.let { "SKU $it" },
            line.modifiers?.takeIf { it.isNotEmpty() }?.joinToString(", ") { it.name },
          )
          if (notes.isNotEmpty()) Text(notes.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
            state?.takeIf { it.fulfilledQuantity > 0 }?.let { StatusChip("${it.fulfilledQuantity} of ${it.quantity} fulfilled") }
            if (withdrawn) {
              StatusChip("Refunded", StatusTone.ERROR)
            } else if (canRefundLines) {
              TextButton(
                onClick = { actions.open(OrderDialog.REFUND_LINE, index.toString()) },
                enabled = !actions.busy,
                modifier = Modifier.testTag("order-refund-line-$index"),
              ) { Text("Refund line") }
            }
          }
        }
      }
    }

    SectionCard("Payment") {
      totals?.itemsCents?.let { AmountRow("Items", money(it), muted = true) }
      totals?.discountCents?.takeIf { it > 0 }?.let { AmountRow("Discount", "−" + money(it), muted = true) }
      totals?.shippingCents?.takeIf { it > 0 }?.let { AmountRow("Shipping", money(it), muted = true) }
      totals?.taxCents?.takeIf { it > 0 }?.let { AmountRow("Tax", money(it), muted = true) }
      // Optional lines the buyer took at checkout (AGL-3635), by name.
      order.extras.orEmpty().forEach { extra -> AmountRow(extra.label, money(extra.amountCents), muted = true) }
      HorizontalDivider()
      AmountRow("Total", money(totals?.totalCents ?: order.amountCents ?: 0.0), emphasized = true)
      if (detail.refundState != OrderRefundState.NONE) {
        Text(orderRefundSummary(order), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      // A merchant's refund and a lost chargeback are different doors (AGL-1787), said apart.
      splitOrderReversal(order).chargedBackCents.takeIf { it > 0 }?.let { AmountRow("Charged back", money(it.toDouble()), muted = true) }
      // How the tax was computed (AGL-2451); absent means not recorded, never "no tax".
      Text(describeOrderTaxMode(order.taxMode?.raw), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }

    SectionCard("Customer") {
      val who = listOfNotNull(order.customerName, order.customerEmail, order.customerPhone).filter { it.isNotBlank() }
      if (who.isEmpty()) Text("Guest", style = MaterialTheme.typography.bodyLarge)
      who.forEach { Text(it, style = MaterialTheme.typography.bodyLarge) }
      val shipTo = addressLines(order.shippingAddress)
      if (shipTo.isNotEmpty()) {
        Text("Ship to", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        shipTo.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
      }
    }

    if (detail.shipments.isNotEmpty()) {
      SectionCard("Shipments") {
        detail.shipments.forEach { shipment ->
          Column(Modifier.fillMaxWidth().testTag("order-shipment-${shipment.id}")) {
            AglynListItem(
              title = shipment.summary,
              supporting = listOf(
                formatReceiptTime(shipment.atMs),
                shipment.trackingNumber.takeIf { it.isNotBlank() }?.let { "${shipment.carrier.ifBlank { "Tracking" }} $it" }.orEmpty(),
                shipment.trackingStatus,
              ).filter { it.isNotBlank() }.joinToString(" · "),
              icon = AglynIcons.named("local_shipping"),
              trailing = if (shipment.active) null else ({ StatusChip("Canceled") }),
            )
            if (shipment.active) {
              FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
                shipment.trackingUrl?.let { url -> TextButton(onClick = { uriHandler.openUri(url) }) { Text("Track") } }
                if (shipment.labelUrl != null) {
                  TextButton(
                    onClick = { onPrintLabel(shipment) },
                    enabled = printing.busy == null,
                    modifier = Modifier.testTag("order-print-label-${shipment.id}"),
                  ) { Text("Print label") }
                }
                if (shipment.editable) {
                  TextButton(
                    onClick = { actions.open(OrderDialog.EDIT_TRACKING, shipment.id) },
                    enabled = !actions.busy,
                    modifier = Modifier.testTag("order-edit-tracking-${shipment.id}"),
                  ) { Text("Edit tracking") }
                  TextButton(
                    onClick = { actions.open(OrderDialog.CANCEL_SHIPMENT, shipment.id) },
                    enabled = !actions.busy,
                    modifier = Modifier.testTag("order-cancel-shipment-${shipment.id}"),
                  ) { Text("Cancel shipment") }
                }
              }
            }
          }
        }
      }
    }

    if (detail.status == OrderStatus.PENDING) {
      order.paymentLinkUrl?.takeIf { it.isNotBlank() }?.let { link ->
        val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
        SectionCard(null) {
          OutlinedButton(
            onClick = {
              clipboard.setText(androidx.compose.ui.text.AnnotatedString(link))
              actions.done = "Payment link copied"
            },
            modifier = Modifier.testTag("order-copy-payment-link"),
          ) { Text("Copy payment link") }
          Text("The buyer pays this draft order through the link.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }

    order.note?.takeIf { it.isNotBlank() }?.let { note -> SectionCard("Note") { Text(note) } }

    registerReceipt?.invoke()

    // The console's Packing slip and Invoice: its own pages, on this device's print sheet.
    SectionCard("Print") {
      printing.problem?.let { NoticeBanner(it, StatusTone.ERROR) }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        OrderPrintKind.entries.forEach { kind ->
          OutlinedButton(onClick = { onPrint(kind) }, enabled = printing.busy == null, modifier = Modifier.testTag("order-print-${kind.raw}")) {
            Icon(AglynIcons.named(kind.icon), contentDescription = null)
            Text(if (printing.busy == kind.raw) "Printing…" else kind.title, Modifier.padding(start = space(1f)))
          }
        }
      }
    }

    // Pickup and delivery steps, returns on this order, shipping labels and the services the store has connected.
    SectionCard(null) {
      AglynListItem(
        title = "Pickup, returns and services",
        supporting = "Pickup and delivery steps, returns, labels and connected services",
        icon = AglynIcons.named("extension"),
        trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
        onClick = openServices,
        modifier = Modifier.testTag("order-more"),
      )
    }

    detail.restock?.let { check -> RestockCard(detail, check, actions) }

    SectionCard("Timeline") {
      if (detail.timeline.isEmpty()) Text("Nothing has happened on this order yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      detail.timeline.forEachIndexed { index, event ->
        Text(
          timelineLine(event),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.testTag("order-timeline-$index"),
        )
      }
      OutlinedButton(onClick = { actions.open(OrderDialog.NOTE) }, modifier = Modifier.testTag("order-add-note")) {
        Icon(AglynIcons.named("edit_note"), contentDescription = null)
        Text("Add a note", Modifier.padding(start = space(1f)))
      }
    }
  }
}

/** The question a refund or chargeback leaves: did the goods come back? An answer moves no stock. */
@Composable
private fun RestockCard(detail: OrderDetail, check: OrderRestockCheck, actions: OrderActionsModel) {
  SectionCard("Restock check") {
    Text(describeRestockCheck(check, detail.order), style = MaterialTheme.typography.bodyMedium)
    check.lines.forEach { line ->
      Text(
        "${line.quantity.toLong()}× ${line.name ?: line.productId}" + (line.variantLabel?.let { " — $it" } ?: ""),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
    Text(
      "If goods came back, put them on the shelf with Adjust stock on the product first — these answers move no stock, they only clear this question.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      RestockAnswerChoice.entries.forEachIndexed { index, choice ->
        val onClick = { actions.answerRestock(detail.id, choice, check.flaggedAtMs) }
        val tag = Modifier.testTag("order-restock-${choice.raw}")
        if (index == 0) OutlinedButton(onClick = onClick, enabled = !actions.busy, modifier = tag) { Text(choice.label) }
        else TextButton(onClick = onClick, enabled = !actions.busy, modifier = tag) { Text(choice.label) }
      }
    }
  }
}

@Composable
private fun OrderActionButtons(offer: OrderActions, actions: OrderActionsModel) {
  val buttons = listOfNotNull(
    if (offer.fulfill) Triple("Fulfill…", "local_shipping", OrderDialog.FULFILL) else null,
    if (offer.markDelivered) Triple("Mark delivered", "done_all", OrderDialog.DELIVERED) else null,
    if (offer.resendReceipt) Triple("Send receipt", "mail", OrderDialog.RECEIPT) else null,
    if (offer.refund) Triple("Refund", "undo", OrderDialog.REFUND) else null,
    if (offer.cancel) Triple("Cancel order", "cancel", OrderDialog.CANCEL) else null,
  )
  if (buttons.isEmpty()) return
  FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    buttons.forEachIndexed { index, (label, icon, dialog) ->
      val content: @Composable () -> Unit = {
        Icon(AglynIcons.named(icon), contentDescription = null)
        Text(label, Modifier.padding(start = space(1f)), maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      val tag = Modifier.testTag("order-action-${dialog.name.lowercase()}")
      if (index == 0) Button(onClick = { actions.open(dialog) }, modifier = tag) { content() }
      else OutlinedButton(onClick = { actions.open(dialog) }, modifier = tag) { content() }
    }
  }
}

@Composable
private fun OrderDialogs(detail: OrderDetail, actions: OrderActionsModel) {
  val orderId = detail.id
  when (actions.dialog) {
    null -> Unit
    OrderDialog.FULFILL -> FulfillItemsDialog(detail, actions)
    OrderDialog.EDIT_TRACKING -> {
      val shipment = detail.shipments.firstOrNull { it.id == actions.target }
      if (shipment == null) {
        LaunchedEffect(Unit) { actions.close() }
      } else {
        var carrier by rememberSaveable(shipment.id) { mutableStateOf(shipment.rawCarrier) }
        var number by rememberSaveable(shipment.id) { mutableStateOf(shipment.trackingNumber) }
        var link by rememberSaveable(shipment.id) { mutableStateOf(shipment.rawTrackingUrl) }
        ActionDialog(
          title = "Edit tracking",
          icon = "local_shipping",
          confirmLabel = "Save tracking",
          busy = actions.busy,
          error = actions.error,
          onDismiss = actions::close,
          onConfirm = { actions.runFor { updateTracking(orderId, shipment.id, carrier, number, link) } },
        ) {
          CarrierFields(carrier, number, link, { carrier = it }, { number = it }, { link = it })
        }
      }
    }
    OrderDialog.CANCEL_SHIPMENT -> ActionDialog(
      title = "Cancel this shipment?",
      body = "Its items go back to unfulfilled and can be shipped again. The buyer is not told.",
      icon = "cancel",
      confirmLabel = "Cancel shipment",
      destructive = true,
      busy = actions.busy,
      error = actions.error,
      onDismiss = actions::close,
      onConfirm = { actions.target?.let { id -> actions.runFor { cancelShipment(orderId, id) } } },
    )
    OrderDialog.REFUND_LINE -> {
      val index = actions.target?.toIntOrNull() ?: 0
      val prompt = orderRefundPrompt(detail.order, listOf(index))
      ActionDialog(
        title = prompt.title,
        body = prompt.text,
        icon = "undo",
        confirmLabel = "Refund",
        destructive = true,
        busy = actions.busy,
        error = actions.error,
        onDismiss = actions::close,
        onConfirm = { actions.runFor { key -> refundLines(orderId, listOf(index), key); "Refund issued" } },
      )
    }
    OrderDialog.DELIVERED -> ActionDialog(
      title = "Mark ${detail.label} delivered?",
      body = "Use this when the customer has the order in hand.",
      icon = "done_all",
      confirmLabel = "Mark delivered",
      busy = actions.busy,
      error = actions.error,
      onDismiss = actions::close,
      onConfirm = { actions.run("${detail.label} is marked as delivered.") { markDelivered(orderId) } },
    )
    OrderDialog.CANCEL -> ActionDialog(
      title = "Cancel ${detail.label}?",
      body = "Its stock goes back on the shelf. The customer is not refunded automatically: refund first if they paid.",
      icon = "cancel",
      confirmLabel = "Cancel order",
      dismissLabel = "Keep order",
      destructive = true,
      busy = actions.busy,
      error = actions.error,
      onDismiss = actions::close,
      onConfirm = { actions.run("${detail.label} is canceled.") { cancel(orderId) } },
    )
    OrderDialog.REFUND -> {
      var full by rememberSaveable(actions.attemptKey) { mutableStateOf(true) }
      var amount by rememberSaveable(actions.attemptKey) { mutableStateOf("") }
      val cents = if (full) detail.refundableCents.toLong() else parseMoneyCents(amount)
      val problem = if (full) null else checkRefundAmount(cents, detail.refundableCents)
      ActionDialog(
        title = "Refund ${detail.label}",
        body = "${money(detail.refundableCents)} is left to refund on this order.",
        icon = "undo",
        confirmLabel = if (cents != null && problem == null) "Refund ${money(cents.toDouble())}" else "Refund",
        confirmEnabled = problem == null,
        destructive = true,
        busy = actions.busy,
        error = actions.error ?: problem.takeIf { amount.isNotBlank() },
        onDismiss = actions::close,
        onConfirm = { actions.run("${detail.label} is refunded.") { key -> refund(orderId, if (full) null else cents, key) } },
      ) {
        ChoiceChipRow(
          options = listOf(ChipOption("full", "Full refund"), ChipOption("part", "Part of it")),
          selected = if (full) "full" else "part",
          onSelect = { full = it == "full" },
        )
        if (!full) {
          OutlinedTextField(
            amount,
            { amount = it },
            label = { Text("Amount") },
            prefix = { Text("$") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth().testTag("refund-amount"),
          )
        }
      }
    }
    OrderDialog.NOTE -> {
      var note by rememberSaveable(actions.attemptKey) { mutableStateOf("") }
      ActionDialog(
        title = "Add a note",
        body = "A note goes on ${detail.label}'s timeline, for your team. The customer does not see it.",
        icon = "edit_note",
        confirmLabel = "Add note",
        confirmEnabled = checkOrderNote(note) == null,
        busy = actions.busy,
        error = actions.error,
        onDismiss = actions::close,
        onConfirm = { actions.run("The note is on the timeline.") { addNote(orderId, note) } },
      ) {
        OutlinedTextField(
          note,
          { note = it.take(ORDER_NOTE_MAX_LENGTH) },
          label = { Text("Note") },
          supportingText = { Text("${note.length}/$ORDER_NOTE_MAX_LENGTH") },
          minLines = 3,
          modifier = Modifier.fillMaxWidth().testTag("order-note-text"),
        )
      }
    }
    OrderDialog.RECEIPT -> {
      val order = detail.order
      var channel by rememberSaveable(actions.attemptKey) { mutableStateOf(ReceiptChannel.EMAIL) }
      var to by rememberSaveable(actions.attemptKey, channel) {
        mutableStateOf((if (channel == ReceiptChannel.EMAIL) order.customerEmail else order.customerPhone).orEmpty())
      }
      val problem = checkReceiptRecipient(channel, to)
      ActionDialog(
        title = "Send the receipt",
        icon = "mail",
        confirmLabel = "Send",
        confirmEnabled = problem == null,
        busy = actions.busy,
        error = actions.error,
        onDismiss = actions::close,
        onConfirm = { actions.run("The receipt is on its way.") { sendReceipt(orderId, channel, to) } },
      ) {
        if (actions.receiptChannels.size > 1) {
          ChoiceChipRow(
            options = ReceiptChannel.entries.filter { it in actions.receiptChannels }.map { ChipOption(it.raw, it.label) },
            selected = channel.raw,
            onSelect = { key -> channel = ReceiptChannel.entries.first { it.raw == key } },
          )
        }
        OutlinedTextField(
          to,
          { to = it },
          label = { Text(if (channel == ReceiptChannel.EMAIL) "Email address" else "Phone number") },
          singleLine = true,
          isError = to.isNotBlank() && problem != null,
          supportingText = problem?.takeIf { to.isNotBlank() }?.let { { Text(it) } },
          keyboardOptions = KeyboardOptions(keyboardType = if (channel == ReceiptChannel.EMAIL) KeyboardType.Email else KeyboardType.Phone),
          modifier = Modifier.fillMaxWidth(),
        )
      }
    }
  }
}

/**
 * The Home card: orders still to ship, from the same planned query the
 * Unfulfilled chip runs, a page's worth. The card opens the orders.
 */
@Composable
fun OrdersToShipWidget(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val flow = remember(hostId, context.firestore) { context.firestore.observe(ordersQuery(hostId, OrderFilter.UNFULFILLED)) }
  val live by flow.collectAsState(Live.Loading)
  val count = (live as? Live.Ready)?.value?.size
  MetricCard(
    title = "To ship",
    value = count?.let { if (it >= ORDERS_PAGE_SIZE) "$ORDERS_PAGE_SIZE+" else it.toString() },
    caption = count?.let { if (it == 1) "order is waiting to ship" else "orders are waiting to ship" },
    icon = "local_shipping",
    actionLabel = "Open orders",
    modifier = Modifier.fillMaxSize().testTag("orders-to-ship"),
    loading = live is Live.Loading,
    error = if (live is Live.Failed) "Could not load orders." else null,
    onClick = { context.navigate(COMMERCE_ORDERS_SCREEN) },
  )
}

/** Carrier, tracking number and, for a carrier without a known tracker, the link (the console's `CarrierFields`). */
@Composable
private fun CarrierFields(
  carrier: String,
  number: String,
  link: String,
  onCarrier: (String) -> Unit,
  onNumber: (String) -> Unit,
  onLink: (String) -> Unit,
) {
  val values = Contracts
  var other by remember { mutableStateOf(fulfillmentCarrierChoice(carrier) == values.fulfillmentOtherCarrier) }
  val choice = if (other) values.fulfillmentOtherCarrier else fulfillmentCarrierChoice(carrier)
  com.aglyn.ui.SelectField(
    label = "Carrier",
    options = values.fulfillmentCarrierChoices.map { com.aglyn.ui.SelectOption(it, it) } +
      com.aglyn.ui.SelectOption(values.fulfillmentOtherCarrier, "Other"),
    selected = choice.ifEmpty { null },
    onSelect = { picked ->
      other = picked == values.fulfillmentOtherCarrier
      onCarrier(if (other || picked == null) "" else picked)
    },
    noneLabel = "None",
    modifier = Modifier.fillMaxWidth().testTag("fulfill-carrier"),
  )
  if (other) {
    OutlinedTextField(carrier, onCarrier, label = { Text("Carrier name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("fulfill-carrier-name"))
  }
  OutlinedTextField(number, onNumber, label = { Text("Tracking number") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("fulfill-tracking"))
  if (number.isNotEmpty() && trackingUrlFor(carrier, number) == null) {
    OutlinedTextField(
      link,
      onLink,
      label = { Text("Tracking link") },
      placeholder = { Text("https://") },
      supportingText = { Text("Optional. USPS, UPS, FedEx, DHL, Canada Post, Royal Mail and Australia Post get a link on their own.") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
      modifier = Modifier.fillMaxWidth().testTag("fulfill-tracking-link"),
    )
  }
}

/** Fulfill items: one count per line, starting at what is left of each shippable line, so shipping everything is one tap. */
@Composable
private fun FulfillItemsDialog(detail: OrderDetail, actions: OrderActionsModel) {
  val order = detail.order
  var quantities by remember(detail.id) { mutableStateOf(fulfillItemsStartQuantities(order)) }
  var carrier by rememberSaveable(detail.id) { mutableStateOf("") }
  var number by rememberSaveable(detail.id) { mutableStateOf("") }
  var link by rememberSaveable(detail.id) { mutableStateOf("") }
  var cost by rememberSaveable(detail.id) { mutableStateOf("") }
  var notify by rememberSaveable(detail.id) { mutableStateOf(true) }
  var currency by remember { mutableStateOf("USD") }
  LaunchedEffect(detail.id) { currency = actions.storeCurrency() }
  val selection = fulfillItemsSelection(quantities.map { it.toDouble() })
  val parsed = parseShippingCostInput(cost, currency)
  val costError = (parsed as? ShippingCostInput.Error)?.message
  val names = order.lineItems.orEmpty()
  ActionDialog(
    title = "Fulfill items",
    icon = "local_shipping",
    confirmLabel = "Fulfill",
    confirmEnabled = selection.isNotEmpty() && costError == null,
    busy = actions.busy,
    error = actions.error,
    onDismiss = actions::close,
    onConfirm = {
      val request = FulfillItemsRequest(
        lineItems = if (fulfillItemsIsEverything(order, selection)) null else selection,
        carrier = carrier,
        trackingNumber = number,
        trackingUrl = link,
        shippingCostCents = (parsed as? ShippingCostInput.Cents)?.cents,
        notify = notify,
      )
      actions.runFor { attempt -> fulfill(detail.id, request, attempt) }
    },
    modifier = Modifier.testTag("fulfill-dialog"),
  ) {
    detail.lines.filter { it.remainingQuantity > 0 }.forEach { state ->
      val line = names.getOrNull(state.lineItemId)
      val picked = quantities.getOrElse(state.lineItemId) { 0L }
      fun set(next: Long) {
        quantities = quantities.mapIndexed { index, value -> if (index == state.lineItemId) next.coerceIn(0L, state.remainingQuantity) else value }
      }
      Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().testTag("fulfill-line-${state.lineItemId}")) {
        Column(Modifier.weight(1f)) {
          Text((line?.name ?: "Item") + (line?.variantLabel?.let { " — $it" } ?: ""), maxLines = 2, overflow = TextOverflow.Ellipsis)
          Text(
            "$picked of ${state.remainingQuantity}" + if (state.requiresShipping) "" else " · no shipping needed",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        TextButton(onClick = { set(picked - 1) }, enabled = !actions.busy && picked > 0) { Text("−") }
        TextButton(onClick = { set(picked + 1) }, enabled = !actions.busy && picked < state.remainingQuantity) { Text("+") }
      }
    }
    CarrierFields(carrier, number, link, { carrier = it }, { number = it }, { link = it })
    OutlinedTextField(
      cost,
      { cost = it },
      label = { Text("Shipping cost") },
      prefix = { Text(currency) },
      isError = costError != null,
      supportingText = { Text(costError ?: "Optional. What sending this shipment cost you, in $currency.") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
      modifier = Modifier.fillMaxWidth().testTag("fulfill-cost"),
    )
    SwitchRow("Notify customer", notify, { notify = it })
  }
}
