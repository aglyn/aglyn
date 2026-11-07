package com.aglyn.plugins.commerce.orders

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import com.aglyn.contracts.HostOrder
import com.aglyn.contracts.OrderLineItem
import com.aglyn.contracts.OrderQuote
import com.aglyn.contracts.PayLinkGap
import com.aglyn.contracts.PayLinkStore
import com.aglyn.contracts.QuoteDisplayStatus
import com.aglyn.contracts.QuotePayTax
import com.aglyn.contracts.QuoteTaxKind
import com.aglyn.contracts.describeQuoteTax
import com.aglyn.contracts.deviceTimeZone
import com.aglyn.contracts.formatLocalDay
import com.aglyn.contracts.formatOrderMoney
import com.aglyn.contracts.formatQuoteNumber
import com.aglyn.contracts.isUnpaidQuote
import com.aglyn.contracts.latestQuoteResponse
import com.aglyn.contracts.merchantPaymentsBlockedReason
import com.aglyn.contracts.payLinkGapLine
import com.aglyn.contracts.payLinkGaps
import com.aglyn.contracts.payLinkNoticeTitle
import com.aglyn.contracts.payLinkStoreOf
import com.aglyn.contracts.quoteDisplayStatus
import com.aglyn.contracts.quoteIsProofOnly
import com.aglyn.contracts.quotePayTax
import com.aglyn.contracts.quoteStatusColor
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.ListHeader
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * Quotes (AGL-4093), as the console's Quotes card on the Orders page has them (host-quotes-card.component.tsx): prices
 * put to a customer before they buy. A quote is an unpaid order on the `quote` channel, so this reads
 * `hosts/{hostId}/orders` for that channel alone; the Orders list never shows one until it is paid. A quote opens
 * read-only here, with the console's "Customers can't pay this quote online yet." notice (AGL-4162). New quote and
 * Edit open the editor (QuoteEditor.kt, AGL-4093); sending a quote stays in the console for now. The Apple apps'
 * QuotesScreens.swift is the same screen.
 */

const val COMMERCE_QUOTES_SCREEN = "commerce.quotes"
const val COMMERCE_QUOTE_SCREEN = "commerce.quote"

/** How many quotes the list reads (the console's `QUOTE_CEILING`); a store past it is told the list stops short. */
const val QUOTE_CEILING = 500

private fun tone(color: String): StatusTone = when (color) {
  "info" -> StatusTone.INFO
  "warning" -> StatusTone.WARNING
  "success" -> StatusTone.SUCCESS
  "error" -> StatusTone.ERROR
  else -> StatusTone.NEUTRAL
}

/** One quote as its row draws it (the console's `quoteListRow`), under the store's sales tax choice. */
data class QuoteListRow(
  val id: String,
  val number: String,
  val line: String,
  val customer: String,
  val proofOnly: Boolean,
  val totalCents: Double,
  /** Unpaid, with tax still to be added at payment: the pay page's own answer. */
  val taxAtPayment: Boolean,
  val status: QuoteDisplayStatus,
  val updatedAtMs: Double,
) {
  /** What the list's search matches: the number, the first item and the customer. */
  fun matches(text: String): Boolean {
    val needle = text.trim().lowercase()
    return needle.isEmpty() || listOf(number, line, customer).any { needle in it.lowercase() }
  }
}

fun quoteListRow(id: String, order: HostOrder, store: PayLinkStore?): QuoteListRow {
  val items = order.lineItems.orEmpty()
  val proofOnly = quoteIsProofOnly(order)
  val first = items.firstOrNull()?.name.orEmpty()
  val person = order.quote?.customer
  return QuoteListRow(
    id = id,
    number = formatQuoteNumber(order, id),
    line = if (proofOnly) "Proof only" else if (items.size > 1) "$first and more" else first,
    customer = listOf(person?.name, person?.company, person?.email).firstOrNull { !it.isNullOrEmpty() }.orEmpty(),
    proofOnly = proofOnly,
    totalCents = order.totals?.totalCents ?: 0.0,
    taxAtPayment = isUnpaidQuote(order) && quotePayTax(order.quote, store).basis.kind == QuoteTaxKind.AT_PAYMENT,
    status = quoteDisplayStatus(order),
    // The customer's latest answer counts as an update, so a quote they just answered sorts to the top.
    updatedAtMs = maxOf(order.quote?.updatedAtMs ?: 0.0, latestQuoteResponse(order.quote)?.atMs ?: 0.0),
  )
}

@Suppress("UNCHECKED_CAST")
private fun storeOf(live: Live<FirestoreDoc?>): PayLinkStore? =
  (live as? Live.Ready)?.let { payLinkStoreOf(it.value?.data?.get("tax") as? Map<String, Any?>) }

/** The Quotes list: number and first item, customer, total, status and when it last changed, newest first. */
@Composable
fun QuotesScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return EmptyState("Pick a site first", icon = AglynIcons.named("public"))
  val quotes by remember(hostId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/orders", filters = listOf(FirestoreFilter("channel", FilterOp.EQ, "quote")), limit = QUOTE_CEILING + 1))
  }.collectAsState(Live.Loading)
  val store by remember(hostId, context.firestore) { context.firestore.observeDoc("hosts/$hostId/settings/store") }.collectAsState(Live.Loading)
  var search by rememberSaveable { mutableStateOf("") }
  val products by remember(hostId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/products", limit = QUOTE_PRODUCT_WINDOW + 1))
  }.collectAsState(Live.Loading)
  val canEdit = com.aglyn.pluginhost.rememberMemberPermissions(context).can(QUOTE_EDIT_PERMISSION)
  var creating by remember { mutableStateOf(false) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  if (creating) {
    QuoteEditorSheet(
      context, null, null, quoteProductsOf((products as? Live.Ready)?.value.orEmpty()), (store as? Live.Ready)?.value?.data,
      onDismiss = { creating = false },
    ) { message, _ ->
      creating = false
      notice = message to StatusTone.SUCCESS
    }
  }
  Column(Modifier.fillMaxSize()) {
    ListHeader("Quotes") {
      com.aglyn.ui.ListHeaderAction("New quote", "add", {
        if (canEdit) creating = true else notice = com.aglyn.contracts.permissionRefusalText(QUOTE_EDIT_PERMISSION) to StatusTone.INFO
      }, Modifier.testTag("quotes-new"))
    }
    notice?.let { (text, tone) -> NoticeBanner(text, tone, Modifier.padding(horizontal = space(2f))) }
    when (val value = quotes) {
      Live.Loading -> SkeletonList(rows = 5, modifier = Modifier.padding(space(2f)))
      is Live.Failed -> EmptyState("Could not load quotes", body = "Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
      is Live.Ready -> {
        val payStore = storeOf(store)
        val rows = value.value.take(QUOTE_CEILING).map { quoteListRow(it.id, hostOrderFrom(it), payStore) }.sortedByDescending { it.updatedAtMs }
        if (rows.isEmpty()) {
          EmptyState(
            "No quotes yet",
            body = "No quotes yet. A quote prices a customer’s order before they buy: your products, items typed for the job, and anything you include at no charge.",
            icon = AglynIcons.named("request_quote"),
          )
        } else {
          val shown = rows.filter { it.matches(search) }
          LazyColumn(Modifier.fillMaxSize().testTag("quotes-list")) {
            item {
              Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
                Text("Prices for a customer’s order before they buy", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(search, { search = it }, label = { Text("Search quotes") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("quotes-search"))
                if (value.value.size > QUOTE_CEILING) {
                  Text("This store has more quotes than the list shows at once.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (shown.isEmpty()) Text("No quotes match", color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
            }
            items(shown, key = { it.id }) { row ->
              QuoteRowView(row) { context.navigate(COMMERCE_QUOTE_SCREEN, mapOf("quote" to row.id)) }
              HorizontalDivider()
            }
          }
        }
      }
    }
  }
}

@Composable
private fun QuoteRowView(row: QuoteListRow, onClick: () -> Unit) {
  Row(
    Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = space(2f), vertical = space(1.5f)).testTag("quote-row-${row.id}"),
    horizontalArrangement = Arrangement.spacedBy(space(1f)),
  ) {
    Column(Modifier.weight(1f)) {
      Text(row.number, style = MaterialTheme.typography.bodyLarge)
      if (row.line.isNotEmpty()) Text(row.line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
      Text(row.customer.ifEmpty { "—" }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
      Text(if (row.proofOnly) "—" else formatOrderMoney(row.totalCents), style = MaterialTheme.typography.bodyLarge)
      if (row.taxAtPayment) Text("plus tax at payment", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      StatusChip(row.status.label, tone(quoteStatusColor(row.status.key)))
      Text(if (row.updatedAtMs > 0) formatLocalDay(row.updatedAtMs.toLong(), "M/d/yyyy", deviceTimeZone()) else "—", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

/** One quote, read-only: its customer, items and totals, notes and terms, and what stands between its link and a payment. */
@Composable
fun QuoteScreen(context: NativePluginContext, quoteId: String) {
  val hostId = context.hostId ?: return EmptyState("Pick a site first", icon = AglynIcons.named("public"))
  val quote by remember(hostId, quoteId, context.firestore) { context.firestore.observeDoc("hosts/$hostId/orders/$quoteId") }.collectAsState(Live.Loading)
  val store by remember(hostId, context.firestore) { context.firestore.observeDoc("hosts/$hostId/settings/store") }.collectAsState(Live.Loading)
  // The workspace's card payments, as the quote route answers it (it knows the deployment's payment mode): null
  // until it answers, or when it could not, which like the console's `error` shows no notice. Asked again each time
  // the quote shows, so coming back from Payments reads the new answer.
  val paymentsState by produceState<String?>(null, hostId) { value = quotePaymentsReadiness(context.api, hostId) }
  val products by remember(hostId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/products", limit = QUOTE_PRODUCT_WINDOW + 1))
  }.collectAsState(Live.Loading)
  val canEdit = com.aglyn.pluginhost.rememberMemberPermissions(context).can(QUOTE_EDIT_PERMISSION)
  // The quote as it was when Edit was pressed: the editor's starting point and the version its save names.
  var editing by remember { mutableStateOf<HostOrder?>(null) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  val host by remember(hostId, context.firestore) { context.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading)
  editing?.let { order ->
    QuoteEditorSheet(
      context, quoteId, order, quoteProductsOf((products as? Live.Ready)?.value.orEmpty()), (store as? Live.Ready)?.value?.data,
      onDismiss = { editing = null },
    ) { message, deleted ->
      editing = null
      if (deleted) context.back() else notice = message to StatusTone.SUCCESS
    }
  }
  when (val value = quote) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this quote", body = "Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
    is Live.Ready -> {
      val doc = value.value
      if (doc == null) {
        EmptyState("This quote is not here", body = "It may have been deleted.", icon = AglynIcons.named("request_quote"))
      } else {
        val order = hostOrderFrom(doc)
        val site = invoiceSiteDetails((host as? Live.Ready)?.value?.data)
        QuoteDetail(context, order, quoteId, storeOf(store), paymentsState, notice, site, { text, tone -> notice = text to tone }) {
          if (canEdit) editing = order else notice = com.aglyn.contracts.permissionRefusalText(QUOTE_EDIT_PERMISSION) to StatusTone.INFO
        }
      }
    }
  }
}

@Composable
private fun QuoteDetail(
  context: NativePluginContext, order: HostOrder, quoteId: String, store: PayLinkStore?, paymentsState: String?,
  notice: Pair<String, StatusTone>?, site: InvoiceSite, onNotice: (String, StatusTone) -> Unit, onEdit: () -> Unit,
) {
  val unpaid = isUnpaidQuote(order)
  val proofOnly = quoteIsProofOnly(order)
  val payTax = quotePayTax(order.quote, store)
  val status = quoteDisplayStatus(order)
  val gaps = if (unpaid) payLinkGaps(order, paymentsState?.let { it == "ready" }, store).orEmpty() else emptyList()
  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("quote-detail"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    notice?.let { (text, tone) -> NoticeBanner(text, tone) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      Text(formatQuoteNumber(order, quoteId), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f).semantics { heading() })
      // A paid quote is an order now and can no longer be changed.
      if (unpaid) TextButton(onClick = onEdit, modifier = Modifier.testTag("quote-edit")) { Text("Edit") }
      if (proofOnly) StatusChip("Proof only")
      StatusChip(status.label, tone(quoteStatusColor(status.key)))
    }
    QuoteEmailSection(context, order, quoteId, site, readiness = { if (gaps.isNotEmpty()) PayLinkNotice(context, gaps, paymentsState) }, onNotice = onNotice)
    if (gaps.isNotEmpty()) PayLinkNotice(context, gaps, paymentsState)
    QuotePayLinkSection(context, order, quoteId, onNotice)
    QuoteProofsSection(context, order, quoteId, onNotice)
    QuoteMessagesSection(context, order, quoteId, onNotice)
    SectionCard("Customer") { CustomerLines(order.quote) }
    if (!proofOnly) {
      SectionCard("Items") {
        Column(verticalArrangement = Arrangement.spacedBy(space(1f))) { order.lineItems.orEmpty().forEach { QuoteLineView(it) } }
      }
      SectionCard(null) { QuoteTotals(order, payTax, unpaid) }
    }
    order.quote?.notes?.trim()?.takeIf { it.isNotEmpty() }?.let { SectionCard("Notes for the customer") { Text(it) } }
    order.quote?.terms?.trim()?.takeIf { it.isNotEmpty() }?.let { SectionCard("Terms") { Text(it) } }
  }
}

/** "Customers can’t pay this quote online yet." (AGL-4162), naming each setup step, with a button to the screen that fixes it. */
@Composable
private fun PayLinkNotice(context: NativePluginContext, gaps: List<PayLinkGap>, paymentsState: String?) {
  NoticeBanner(payLinkNoticeTitle("quote"), StatusTone.WARNING, modifier = Modifier.testTag("quote-pay-link-notice"))
  Column(Modifier.padding(start = space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    gaps.forEach { gap ->
      val line = payLinkGapLine(gap, paymentsState?.let(::merchantPaymentsBlockedReason), "quote")
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(line.text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        line.action?.let { action ->
          TextButton(onClick = { context.navigate(if (gap == PayLinkGap.PAYMENTS) "commerce.payments" else "commerce.tax") }) { Text(action) }
        }
      }
    }
  }
}

@Composable
private fun CustomerLines(quote: OrderQuote?) {
  val person = quote?.customer
  val lines = listOfNotNull(person?.name, person?.company, person?.email, person?.phone).filter { it.isNotEmpty() }
  Column { if (lines.isEmpty()) Text("—", color = MaterialTheme.colorScheme.onSurfaceVariant) else lines.forEach { Text(it) } }
}

/** One line: its name and description, quantity and unit price, and its total or "Included". */
@Composable
private fun QuoteLineView(line: OrderLineItem) {
  val quantity = kotlin.math.round(line.quantity).toLong()
  val unit = kotlin.math.round(line.unitAmountCents)
  Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    Column(Modifier.weight(1f)) {
      Text(line.name)
      line.description?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      Text("$quantity × ${formatOrderMoney(unit)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Text(if (line.included == true) "Included" else formatOrderMoney(unit * quantity))
  }
}

/** The console's `QuoteTotalsSummary`: items, discount, shipping, the tax line, then the total. */
@Composable
internal fun QuoteTotals(order: HostOrder, payTax: QuotePayTax, unpaid: Boolean) {
  val totals = order.totals
  fun cents(value: Double?) = kotlin.math.round(value ?: 0.0)
  val atPayment = unpaid && payTax.basis.kind == QuoteTaxKind.AT_PAYMENT
  // Once paid, the tax is what was charged: Stripe's figure under Stripe Tax.
  val taxLabel = if (unpaid || payTax.basis.kind != QuoteTaxKind.AT_PAYMENT) describeQuoteTax(payTax.basis) else "Tax"
  @Composable fun line(label: String, value: String, strong: Boolean = false) = Row {
    Text(label, Modifier.weight(1f), color = if (strong) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = if (strong) FontWeight.SemiBold else null)
    Text(value, fontWeight = if (strong) FontWeight.SemiBold else null)
  }
  Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    line("Items", formatOrderMoney(cents(totals?.itemsCents)))
    if (cents(totals?.discountCents) != 0.0) line("Discount", "−${formatOrderMoney(cents(totals?.discountCents))}")
    if (cents(totals?.shippingCents) != 0.0) line("Shipping", formatOrderMoney(cents(totals?.shippingCents)))
    if (atPayment) Text(taxLabel, color = MaterialTheme.colorScheme.onSurfaceVariant) else line(taxLabel, formatOrderMoney(cents(totals?.taxCents)))
    line(if (atPayment) "Total before tax" else "Total", formatOrderMoney(cents(totals?.totalCents)), strong = true)
  }
}

/**
 * Whether the workspace can take card payments (ready, not-connected, charges-disabled, mode-unverified or
 * mode-mismatch), from the quote route, which knows the deployment's payment mode (AGL-4162). Null when it could not
 * answer.
 */
suspend fun quotePaymentsReadiness(api: ConsoleApiClient, hostId: String): String? = try {
  val answer = api.request(
    QUOTE_ROUTE,
    ApiMethod.POST,
    JsonObject(mapOf("hostId" to JsonPrimitive(hostId), "action" to JsonPrimitive("payments-readiness"))),
  ) as? JsonObject
  (answer?.get("state") as? JsonPrimitive)?.takeIf { it.isString }?.content
} catch (error: Throwable) {
  if (error is kotlinx.coroutines.CancellationException) throw error
  null
}

/** The console's quote route (`POST /api/commerce/quote`). */
const val QUOTE_ROUTE = "/api/commerce/quote"
