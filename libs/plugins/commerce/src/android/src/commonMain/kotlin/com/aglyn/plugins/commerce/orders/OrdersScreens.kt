package com.aglyn.plugins.commerce.orders

import com.aglyn.ui.FoldedSection
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.PlainSection
import com.aglyn.ui.RecordHeader
import com.aglyn.ui.RecordAction
import com.aglyn.plugins.commerce.lists.ListSortMenu
import com.aglyn.plugins.commerce.lists.filterRefusals
import com.aglyn.plugins.commerce.lists.orderFilterChoices
import com.aglyn.pluginhost.ClauseFilterBar
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.MetricCard
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectionPlaceholder
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.TextButton
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
fun OrdersScreen(context: NativePluginContext, initialOrderId: String? = null, startNew: Boolean = false, initialFilter: OrderFilter? = null) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val model = remember(hostId, context.firestore) { OrdersListModel(hostId, context.firestore, scope) }
  // Opened from Home on a chip (to get ready, disputes): the list starts on it.
  LaunchedEffect(model) { if (initialFilter != null) model.pick(initialFilter) else model.reload() }
  // The site's registers: with any, Day report and Shift history head the list (AGL-4062).
  val registers = rememberOrdersRegisters(context)
  val currency = rememberStoreCurrency(context)
  AglynListDetail(
    initialSelected = initialOrderId,
    list = { selected, onSelect -> OrdersList(context, model, selected, onSelect, startNew, registers) },
    detail = { selected ->
      if (selected == ORDERS_DAY_REPORT_ROW) {
        OrdersDayReportPane(context, currency)
      } else if (selected == ORDERS_SHIFT_HISTORY_ROW) {
        ShiftHistoryPane(context, registers, currency)
      } else if (selected == null) {
        SelectionPlaceholder("Pick an order to see it here", icon = AglynIcons.named("receipt"))
      } else {
        OrderDetailPane(context, selected, onChanged = { model.reload() })
      }
    },
  )
}

@Composable
private fun OrdersList(
  context: NativePluginContext,
  model: OrdersListModel,
  selected: String?,
  onSelect: (String) -> Unit,
  startNew: Boolean = false,
  registers: List<com.aglyn.plugins.commerce.pos.PosRegister> = emptyList(),
) {
  val listState = rememberLazyListState()
  // A new chip, filter or sort is a new list: it starts at its first row, not at the row that was on top before.
  // Coming back to the list (from an order, or Back) keeps where it was.
  var arrived by remember { mutableStateOf(false) }
  LaunchedEffect(model.filter, model.clauses, model.sort) { if (arrived) listState.scrollToItem(0) else arrived = true }
  val scope = rememberCoroutineScope()
  // Select mode: tick orders, then mark them all fulfilled in one go (the console's bulk action on the orders list).
  var selecting by remember { mutableStateOf(false) }
  var picked by remember { mutableStateOf(emptySet<String>()) }
  var confirming by remember { mutableStateOf(false) }
  var running by remember { mutableStateOf(false) }
  var outcome by remember { mutableStateOf<BulkFulfillResult?>(null) }
  // Opened from Create new: the draft order comes up at once.
  var drafting by remember { mutableStateOf(startNew) }
  var exportPreset by remember { mutableStateOf<String?>(null) }
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
  // The shared list screen (Figma Mac Orders 13:483): "Orders" with ☆ and New order; search and one Filter (status and
  // sort); Select, Export for shipping, Import tracking and More filters in ⋯.
  var advanced by remember { mutableStateOf(model.clauses.isNotEmpty()) }
  val sorts = Contracts.orderListQuery.sorts
  // Calm rule (Figma 13:483 draws no tabs): Returns and Reservations are one Filter choice away, not a tab row.
  val filterChoices = ORDERS_SHOW.map { (key, label) -> com.aglyn.ui.FilterChoice("Show", key, label) } +
    OrderFilter.entries.map { com.aglyn.ui.FilterChoice("Status", it.name, it.label) } +
    sorts.mapIndexed { index, sort -> com.aglyn.ui.FilterChoice("Sort", "sort-$index", com.aglyn.plugins.commerce.lists.sortLabel(sort)) }
  val sortKey = sorts.indexOf(model.sort ?: sorts.firstOrNull()).takeIf { it >= 0 }?.let { "sort-$it" }
  val moreActions = buildList {
    add(com.aglyn.ui.MenuAction("orders-select", if (selecting) "Done selecting" else "Select orders", "fact_check") { selecting = !selecting; picked = emptySet() })
    Contracts.orderShippingPresetChoices.forEach { preset ->
      add(com.aglyn.ui.MenuAction("orders-export-${preset.id}", "Export for shipping: ${preset.label}", "local_shipping") {
        val id = hostId ?: return@MenuAction
        scope.launch {
          prepareOrdersForShipping(context.api, id)
          exportPreset = preset.id
        }
      })
    }
    if (com.aglyn.plugins.commerce.products.canImportProducts(context)) {
      add(com.aglyn.ui.MenuAction("orders-import-tracking", "Import tracking", "upload") {
        context.navigate(com.aglyn.plugins.commerce.products.CORE_DATA_IMPORT_SCREEN, trackingImportParams(hostId))
      })
    }
    add(com.aglyn.ui.MenuAction("orders-more-filters", if (advanced) "Hide more filters" else "More filters", "tune") { advanced = !advanced })
  }
  com.aglyn.ui.ListScreenScaffold(
    title = "Orders",
    query = model.search,
    onQuery = model::type,
    placeholder = "Order, customer or email",
    tag = "orders",
    primary = com.aglyn.ui.PrimaryAction("orders-draft", "Draft order") { drafting = true },
    inListColumn = true,
    more = moreActions,
    filters = filterChoices,
    picked = mapOf("Show" to COMMERCE_ORDERS_SCREEN, "Status" to model.filter.name) + (sortKey?.let { mapOf("Sort" to it) } ?: emptyMap()),
    onPick = { choice ->
      if (choice.group == "Show") { if (choice.key != COMMERCE_ORDERS_SCREEN) context.navigate(choice.key, emptyMap()) }
      else if (choice.group == "Status") model.pick(OrderFilter.valueOf(choice.key))
      else choice.key.removePrefix("sort-").toIntOrNull()?.let { index -> model.sortBy(if (index == 0) null else sorts[index]) }
    },
  ) {
    Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      outcome?.let { done ->
        NoticeBanner(describeBulkFulfill(done), if (done.refused.isEmpty() && done.unknown.isEmpty()) StatusTone.SUCCESS else StatusTone.WARNING)
      }
      // Any filter the console's grid takes (status, channel, customer, date, product, disputes), once asked for.
      if (advanced || model.clauses.isNotEmpty()) {
        ClauseFilterBar(
          fields = Contracts.orderListQuery.fields,
          headers = Contracts.orderListHeaders,
          choices = orderFilterChoices(),
          clauses = model.clauses,
          onChange = model::setFilters,
          refused = model.plan?.let { filterRefusals(it, model.clauses) } ?: emptyList(),
          notices = model.plan?.notices ?: emptyList(),
        )
      }
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
        icon = AglynIcons.named("error"), tone = EmptyTone.ERROR,
        action = { OutlinedButton(shape = com.aglyn.ui.controlShape(), onClick = { model.reload() }) { Text("Try again") } },
      )
      is Load.Ready -> if (rows.value.isEmpty()) {
        EmptyState(
          if (model.search.isBlank() && model.filter == OrderFilter.ALL) "No orders yet" else "No orders match",
          body = if (model.search.isBlank() && model.filter == OrderFilter.ALL) "Orders from the store and the register show up here." else "Try another filter or search.",
          icon = AglynIcons.named("receipt"),
        )
      } else {
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("orders-list"), state = listState) {
          // Day report and Shift history head the list for a store with registers, while no filter or search is on.
          if (registers.isNotEmpty() && !selecting && model.filter == OrderFilter.ALL && model.search.isBlank() && model.clauses.isEmpty()) {
            item(key = ORDERS_DAY_REPORT_ROW) {
              com.aglyn.ui.ScaffoldListRow(
                title = "Day report", detail = "Every register, today or picked days", kind = com.aglyn.ui.ScaffoldRowKind.ORDER,
                selected = selected == ORDERS_DAY_REPORT_ROW, leading = { com.aglyn.ui.ScaffoldRowTile("bar_chart") },
                onClick = { onSelect(ORDERS_DAY_REPORT_ROW) }, modifier = Modifier.testTag("orders-day-report"),
              )
            }
            item(key = ORDERS_SHIFT_HISTORY_ROW) {
              com.aglyn.ui.ScaffoldListRow(
                title = "Shift history", detail = if (registers.size == 1) "This store's register" else "${registers.size} registers",
                kind = com.aglyn.ui.ScaffoldRowKind.ORDER, selected = selected == ORDERS_SHIFT_HISTORY_ROW,
                leading = { com.aglyn.ui.ScaffoldRowTile("history") },
                onClick = { onSelect(ORDERS_SHIFT_HISTORY_ROW) }, modifier = Modifier.testTag("orders-shift-history"),
              )
            }
          }
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
        Button(shape = com.aglyn.ui.controlShape(), 
          onClick = { confirming = true },
          enabled = picked.isNotEmpty() && !running,
          modifier = Modifier.weight(1f).testTag("orders-bulk-fulfill"),
        ) { Text("Mark ${picked.size} fulfilled") }
        // Whatever services are connected add what they can do to the ticked orders (buy their labels, say).
        if (ScreenCatalog.zone("ordersBulk").isNotEmpty()) {
          OutlinedButton(shape = com.aglyn.ui.controlShape(), 
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
  // Figma List/Order row (11:329): the number and customer over items, channel and time; the total over the status.
  com.aglyn.ui.ScaffoldListRow(
    title = "${row.label} · ${row.customer}",
    detail = listOfNotNull(items, row.channelLabel, row.createdAtMs.takeIf { it > 0 }?.let { relativeTime(it, now) }).joinToString(" · "),
    kind = com.aglyn.ui.ScaffoldRowKind.ORDER,
    selected = selected,
    // The order's glyph is Orders' own (the manifest's bag), the register's for a sale rung up there.
    // Every order wears the bag (Figma List/Order row, as on Apple); the channel is in its detail line.
    leading = { com.aglyn.ui.ScaffoldRowTile(if (ticked == true) "check_circle" else "shopping_bag") },
    figure = money(row.netCents),
    status = {
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
    is Live.Failed -> EmptyState("Could not load this order", body = "Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
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
        val customerLink = customerCrmLink(context.orgSlug, context.hostSlug, detail.order.customerEmail)
        OrderDetailContent(
          detail, actions, printing, onPrint, onPrintLabel, registerReceipt,
          openCustomer = customerLink?.let { link -> { context.openLink(link) } },
        ) {
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
  openCustomer: (() -> Unit)? = null,
  openServices: () -> Unit,
) {
  val order = detail.order
  val totals = order.totals
  val uriHandler = LocalUriHandler.current
  val offer = detail.actions
  // One filled button, the next step for this order's state; every other act is in ⋯ and in the section it belongs to.
  val primary = when {
    offer.fulfill -> RecordAction("order-action-fulfill", "Fulfill", "local_shipping") { actions.open(OrderDialog.FULFILL) }
    offer.markDelivered -> RecordAction("order-action-delivered", "Mark delivered", "done_all") { actions.open(OrderDialog.DELIVERED) }
    else -> null
  }
  val more = buildList {
    if (offer.resendReceipt) add(RecordAction("order-action-receipt", "Send receipt", "mail") { actions.open(OrderDialog.RECEIPT) })
    OrderPrintKind.entries.forEach { kind -> add(RecordAction("order-print-${kind.raw}", kind.title, kind.icon, enabled = printing.busy == null) { onPrint(kind) }) }
    add(RecordAction("order-add-note", "Add a note", "edit_note") { actions.open(OrderDialog.NOTE) })
    openCustomer?.let { add(RecordAction("order-customer-crm", "View customer in CRM", "contact_mail", run = it)) }
    add(RecordAction("order-more", "Pickup, returns and services", "extension", run = openServices))
    if (offer.refund) add(RecordAction("order-action-refund", "Refund", "undo", destructive = true) { actions.open(OrderDialog.REFUND) })
    if (offer.cancel) add(RecordAction("order-action-cancel", "Cancel order", "cancel", destructive = true) { actions.open(OrderDialog.CANCEL) })
  }
  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("order-detail"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    actions.done?.let { message ->
      NoticeBanner(message, StatusTone.SUCCESS, action = { TextButton(onClick = { actions.done = null }) { Text("Dismiss") } })
    }
    if (actions.dialog == null) actions.error?.let { NoticeBanner(it, StatusTone.ERROR) }
    printing.problem?.let { NoticeBanner(it, StatusTone.ERROR) }
    RecordHeader(
      detail.label,
      status = {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          StatusChip(statusLabel(detail.status), statusTone(detail.status))
          if (detail.testMode) StatusChip("Test mode", StatusTone.WARNING)
          if (detail.refundState != OrderRefundState.NONE) StatusChip(if (detail.refundState == OrderRefundState.FULL) "Refunded" else "Partly refunded", StatusTone.ERROR)
        }
      },
      primary = primary,
      more = more,
    )
    // What waits on the merchant comes first: a dispute, a risky payment, a refund the dispute blocks.
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
    // Who and when, in one line.
    Text(
      listOfNotNull(
        order.customerName?.takeIf { it.isNotBlank() } ?: order.customerEmail?.takeIf { it.isNotBlank() } ?: "Guest",
        orderChannelLabel(order.channel?.raw),
        order.createdAtMs?.let { formatReceiptTime(it.toLong()) },
      ).joinToString(" · "),
      style = MaterialTheme.typography.bodyLarge,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.testTag("order-summary-line"),
    )

    // The lines, then the totals under a hairline and the notes under them, as the console's order says them
    // (order-detail-dialog): there is no payments section; a refund is a caption in the error color.
    val canRefundLines = canTransitionOrder(detail.status, OrderStatus.REFUNDED) && !orderDisputeBlocksRefund(order)
    val beside = com.aglyn.ui.LocalShellMetrics.current.compact || com.aglyn.ui.currentWidthClass() != com.aglyn.ui.WidthClass.COMPACT
    // The lines and the totals are one block: Figma keeps the 40 rhythm from the last line into the totals.
    Column(Modifier.fillMaxWidth()) {
    PlainSection("Items") {
      if (detail.lines.isEmpty()) Text("No items on this order.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      order.lineItems.orEmpty().forEachIndexed { index, line ->
        val state = detail.lines.getOrNull(index)
        val withdrawn = orderLineRefunded(order, index)
        // A line refunded by itself (AGL-2454): beside a list, from the line's own menu (a long press), as Apple's
        // context menu; on a phone, a button under it.
        var lineMenu by remember { mutableStateOf(false) }
        val refundable = canRefundLines && !withdrawn
        Box {
          Column(
            Modifier.fillMaxWidth()
              .then(if (beside && refundable) Modifier.combinedClickable(onClick = {}, onLongClick = { lineMenu = true }) else Modifier)
              .padding(vertical = if (beside) 8.dp else space(0.5f)).testTag("order-line-$index"),
          ) {
            val quantity = line.quantity.toLong()
            val amount = money(line.unitAmountCents * line.quantity)
            if (beside) {
              // Figma 13:483 / 13:2167's plain line: what was bought, its options, and how many, then its amount.
              AmountRow(listOfNotNull(line.name, line.variantLabel).joinToString(", ") + if (quantity == 1L) "" else " × $quantity", amount, muted = withdrawn, size = 14.sp)
            } else {
              AmountRow("$quantity × ${line.name}", amount, muted = withdrawn)
            }
            val notes = listOfNotNull(
              line.variantLabel.takeIf { !beside },
              line.sku?.takeIf { !beside }?.let { "SKU $it" },
              line.modifiers?.takeIf { it.isNotEmpty() }?.joinToString(", ") { it.name },
              state?.takeIf { it.fulfilledQuantity > 0 }?.let { "${it.fulfilledQuantity} of ${it.quantity} fulfilled" },
              if (withdrawn) "Refunded" else null,
            )
            if (notes.isNotEmpty()) Text(notes.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (!beside && refundable) {
              TextButton(onClick = { actions.open(OrderDialog.REFUND_LINE, index.toString()) }, enabled = !actions.busy, modifier = Modifier.testTag("order-refund-line-$index")) {
                Text("Refund line", color = MaterialTheme.colorScheme.error)
              }
            }
          }
          if (beside && refundable) {
            androidx.compose.material3.DropdownMenu(lineMenu, onDismissRequest = { lineMenu = false }) {
              androidx.compose.material3.DropdownMenuItem(
                text = { Text("Refund line", color = MaterialTheme.colorScheme.error) },
                enabled = !actions.busy,
                onClick = { lineMenu = false; actions.open(OrderDialog.REFUND_LINE, index.toString()) },
                modifier = Modifier.testTag("order-refund-line-$index"),
              )
            }
          }
        }
      }
      if (detail.refundState != OrderRefundState.NONE) {
        Text(orderRefundSummary(order), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("order-refund-state"))
      }
    }
    Column(Modifier.fillMaxWidth().testTag("order-totals"), verticalArrangement = Arrangement.spacedBy(if (beside) 0.dp else space(0.5f))) {
      // Beside a list each row is Figma's 40 (14/20 text, 10 above and below); a phone keeps its own rhythm.
      val size = if (beside) 14.sp else null
      val row = if (beside) Modifier.padding(vertical = 10.dp) else Modifier
      totals?.itemsCents?.let { AmountRow("Items", money(it), row, size = size) }
      totals?.discountCents?.takeIf { it > 0 }?.let { AmountRow("Discount", "−" + money(it), row, size = size) }
      totals?.shippingCents?.takeIf { it > 0 }?.let { AmountRow("Shipping", money(it), row, size = size) }
      totals?.taxCents?.takeIf { it > 0 }?.let { AmountRow("Tax", money(it), row, size = size) }
      order.extras.orEmpty().forEach { extra -> AmountRow(extra.label, money(extra.amountCents), row, size = size) }
      totals?.tipCents?.takeIf { it > 0 }?.let { AmountRow("Tip", money(it), row, size = size) }
      HorizontalDivider(color = com.aglyn.ui.shellColors.divider)
      AmountRow("Total", money(totals?.totalCents ?: order.amountCents ?: 0.0), row, emphasized = true, size = size)
      Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        val reversal = splitOrderReversal(order)
        val note = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp, lineHeight = 16.sp)
        Text(describeOrderTaxMode(order.taxMode?.raw), style = note, color = MaterialTheme.colorScheme.onSurfaceVariant)
        reversal.refundedCents.takeIf { it > 0 }?.let { Text("Refunded ${money(it.toDouble())}", style = note, color = MaterialTheme.colorScheme.error) }
        reversal.chargedBackCents.takeIf { it > 0 }?.let { Text("Charged back ${money(it.toDouble())}", style = note, color = MaterialTheme.colorScheme.error) }
      }
    }
    }

    if (detail.status == OrderStatus.PENDING) {
      order.paymentLinkUrl?.takeIf { it.isNotBlank() }?.let { link ->
        val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          OutlinedButton(shape = com.aglyn.ui.controlShape(), 
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

    registerReceipt?.invoke()
    detail.restock?.let { check -> RestockCard(detail, check, actions) }

    Column {
      FoldedSection("Customer details", tag = "order-fold-customer") {
        val who = listOfNotNull(order.customerName, order.customerEmail, order.customerPhone).filter { it.isNotBlank() }
        if (who.isEmpty()) Text("Guest", style = MaterialTheme.typography.bodyLarge)
        who.forEach { Text(it, style = MaterialTheme.typography.bodyLarge) }
        openCustomer?.let { open -> TextButton(onClick = open) { Text("View customer in CRM") } }
        val shipTo = addressLines(order.shippingAddress)
        if (shipTo.isNotEmpty()) {
          Text("Ship to", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
          shipTo.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
        }
      }
      if (detail.shipments.isNotEmpty()) {
        FoldedSection("Shipments", count = detail.shipments.size, tag = "order-fold-shipments") {
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
                    TextButton(onClick = { onPrintLabel(shipment) }, enabled = printing.busy == null, modifier = Modifier.testTag("order-print-label-${shipment.id}")) { Text("Print label") }
                  }
                  if (shipment.editable) {
                    TextButton(onClick = { actions.open(OrderDialog.EDIT_TRACKING, shipment.id) }, enabled = !actions.busy, modifier = Modifier.testTag("order-edit-tracking-${shipment.id}")) { Text("Edit tracking") }
                    TextButton(onClick = { actions.open(OrderDialog.CANCEL_SHIPMENT, shipment.id) }, enabled = !actions.busy, modifier = Modifier.testTag("order-cancel-shipment-${shipment.id}")) { Text("Cancel shipment") }
                  }
                }
              }
            }
          }
        }
      }
      FoldedSection("Timeline and notes", count = detail.timeline.size + if (order.note.isNullOrBlank()) 0 else 1, tag = "order-fold-timeline") {
        order.note?.takeIf { it.isNotBlank() }?.let { note -> Text(note, style = MaterialTheme.typography.bodyMedium) }
        if (detail.timeline.isEmpty()) Text("Nothing has happened on this order yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        detail.timeline.forEachIndexed { index, event ->
          Text(timelineLine(event), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("order-timeline-$index"))
        }
        TextButton(onClick = { actions.open(OrderDialog.NOTE) }) { Text("Add a note") }
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
        if (index == 0) OutlinedButton(shape = com.aglyn.ui.controlShape(), onClick = onClick, enabled = !actions.busy, modifier = tag) { Text(choice.label) }
        else TextButton(onClick = onClick, enabled = !actions.busy, modifier = tag) { Text(choice.label) }
      }
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

/** What the Orders list can show besides orders, as the console's Products hub sections name them. */
private val ORDERS_SHOW = listOf(
  COMMERCE_ORDERS_SCREEN to "Orders",
  "commerce.returns" to "Returns",
  "commerce.reservations" to "Reservations",
)
