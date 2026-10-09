package com.aglyn.plugins.commerce.orders

import androidx.compose.foundation.layout.Arrangement
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
import com.aglyn.plugins.commerce.pos.Load
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

const val COMMERCE_ORDERS_SCREEN = "commerce.orders"
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
    list = { selected, onSelect -> OrdersList(model, selected, onSelect) },
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
private fun OrdersList(model: OrdersListModel, selected: String?, onSelect: (String) -> Unit) {
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
      SearchField(model.search, model::type, placeholder = "Search by order number or customer")
      ChoiceChipRow(
        options = OrderFilter.entries.map { ChipOption(it.name, it.label) },
        selected = model.filter.name,
        onSelect = { key -> model.pick(OrderFilter.valueOf(key)) },
      )
      model.notice?.let { NoticeBanner(it, StatusTone.WARNING) }
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
        LazyColumn(Modifier.fillMaxSize().testTag("orders-list"), state = listState) {
          items(rows.value, key = { it.id }) { row -> OrderListRow(row, row.id == selected) { onSelect(row.id) } }
          if (model.hasMore || model.loadingMore) item { SkeletonList(rows = 2) }
        }
      }
    }
  }
}

@Composable
private fun OrderListRow(row: OrderRow, selected: Boolean, onClick: () -> Unit) {
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
    icon = AglynIcons.named(if (row.channelLabel == orderChannelLabel("pos")) "point_of_sale" else "receipt"),
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
  val actions = remember(hostId, orderId) { OrderActionsModel(ConsoleOrderActionsApi(context.api, hostId), scope) }
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
        OrderDetailContent(detail, actions)
        OrderDialogs(detail, actions)
      }
    }
  }
}

@Composable
private fun OrderDetailContent(detail: OrderDetail, actions: OrderActionsModel) {
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
      OrderActionButtons(detail.actions, actions)
    }

    SectionCard("Items") {
      if (detail.lines.isEmpty()) Text("No items on this order.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      order.lineItems.orEmpty().forEachIndexed { index, line ->
        val state = detail.lines.getOrNull(index)
        Column(Modifier.fillMaxWidth().testTag("order-line-$index")) {
          AmountRow("${line.quantity.toLong()} × ${line.name}", money(line.unitAmountCents * line.quantity))
          val notes = listOfNotNull(
            line.variantLabel,
            line.sku?.let { "SKU $it" },
            line.modifiers?.takeIf { it.isNotEmpty() }?.joinToString(", ") { it.name },
            state?.takeIf { it.requiresShipping && it.quantity > 0 }?.let { "Shipped ${it.fulfilledQuantity} of ${it.quantity}" },
          )
          if (notes.isNotEmpty()) Text(notes.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }

    SectionCard("Payment") {
      totals?.itemsCents?.let { AmountRow("Items", money(it), muted = true) }
      totals?.discountCents?.takeIf { it > 0 }?.let { AmountRow("Discount", "−" + money(it), muted = true) }
      totals?.shippingCents?.takeIf { it > 0 }?.let { AmountRow("Shipping", money(it), muted = true) }
      totals?.taxCents?.takeIf { it > 0 }?.let { AmountRow("Tax", money(it), muted = true) }
      HorizontalDivider()
      AmountRow("Total", money(totals?.totalCents ?: order.amountCents ?: 0.0), emphasized = true)
      if (detail.refundState != OrderRefundState.NONE) {
        Text(orderRefundSummary(order), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
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
          AglynListItem(
            title = listOf(shipment.carrier.uppercase(), shipment.trackingNumber).filter { it.isNotBlank() }.joinToString(" ").ifBlank { "Shipped" },
            supporting = listOf(shipment.summary, formatReceiptTime(shipment.atMs)).filter { it.isNotBlank() }.joinToString(" · "),
            icon = AglynIcons.named("local_shipping"),
            trailing = shipment.trackingUrl?.let { url -> { TextButton(onClick = { uriHandler.openUri(url) }) { Text("Track") } } },
          )
        }
      }
    }

    order.note?.takeIf { it.isNotBlank() }?.let { note -> SectionCard("Note") { Text(note) } }

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
    if (offer.fulfill) Triple("Ship items", "local_shipping", OrderDialog.FULFILL) else null,
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
    OrderDialog.FULFILL -> {
      var carrier by rememberSaveable(actions.attemptKey) { mutableStateOf("") }
      var tracking by rememberSaveable(actions.attemptKey) { mutableStateOf("") }
      var notify by rememberSaveable(actions.attemptKey) { mutableStateOf(true) }
      val left = detail.lines.filter { it.requiresShipping && it.remainingQuantity > 0 }
      val names = detail.order.lineItems.orEmpty()
      ActionDialog(
        title = "Ship ${detail.label}",
        body = "Ships everything still to ship: " + left.joinToString(", ") { "${it.remainingQuantity}× ${names.getOrNull(it.lineItemId)?.name ?: "Item"}" } + ".",
        icon = "local_shipping",
        confirmLabel = "Mark as shipped",
        busy = actions.busy,
        error = actions.error,
        onDismiss = actions::close,
        onConfirm = { actions.run("${detail.label} is marked as shipped.") { key -> fulfill(orderId, carrier, tracking, notify, key) } },
      ) {
        OutlinedTextField(carrier, { carrier = it }, label = { Text("Carrier (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(tracking, { tracking = it }, label = { Text("Tracking number (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        SwitchRow("Notify customer", notify, { notify = it })
      }
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
