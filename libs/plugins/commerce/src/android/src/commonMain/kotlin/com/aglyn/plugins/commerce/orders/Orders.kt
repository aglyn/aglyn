package com.aglyn.plugins.commerce.orders

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.FulfillmentLine
import com.aglyn.contracts.carrierLabelFor
import com.aglyn.contracts.describeFulfillmentLines
import com.aglyn.contracts.fulfillmentLines
import com.aglyn.contracts.fulfillmentTrackingUrl
import com.aglyn.contracts.orderFulfillmentsEditable
import com.aglyn.contracts.trackingStatusLabel
import com.aglyn.contracts.HostOrder
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.contracts.ListQuerySort
import com.aglyn.contracts.OrderChannel
import com.aglyn.contracts.OrderLineFulfillmentState
import com.aglyn.contracts.OrderRefundState
import com.aglyn.contracts.OrderRestockCheck
import com.aglyn.contracts.OrderStatus
import com.aglyn.contracts.OrderTimelineEvent
import com.aglyn.contracts.canTransitionOrder
import com.aglyn.contracts.formatOrderNumber
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.contracts.fulfillmentIsActive
import com.aglyn.contracts.liftLegacyOrder
import com.aglyn.contracts.orderIsTestMode
import com.aglyn.contracts.orderChannelLabel
import com.aglyn.contracts.orderDisputeBlocksRefund
import com.aglyn.contracts.orderLineFulfillmentStates
import com.aglyn.contracts.orderNetCents
import com.aglyn.contracts.orderRefundState
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.decode
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlin.math.max

/*
 * A site's orders in the Aglyn app: the list, one order, and what can be
 * done to it (ship, mark delivered, refund, cancel, resend the receipt).
 *
 * The list is the console's list: ORDER_LIST_QUERY planned by the shared
 * planner over `hosts/{hostId}/orders`, so each filter chip is a clause on
 * the one query, served by the composites the console's own list uses. The
 * actions post to the routes the console's order dialog posts to, which
 * re-ask the transition rule and the member's role; what this file decides
 * (may it be shipped, what is left) is only what to OFFER, from the same
 * ported model the routes use.
 */

const val ORDERS_PAGE_SIZE = 25
const val FULFILL_ORDER_ROUTE = "/api/commerce/fulfill-order"
const val REFUND_ORDER_ROUTE = "/api/commerce/refund"
const val CANCEL_ORDER_ROUTE = "/api/commerce/cancel-order"
const val ORDER_RECEIPT_ROUTE = "/api/commerce/order-receipt-send"
const val ORDER_NOTE_ROUTE = "/api/commerce/order-note"
const val ORDER_RESTOCK_ANSWER_ROUTE = "/api/commerce/order-restock-answer"

/** The longest note the order timeline keeps (`ORDER_NOTE_MAX_LENGTH` in the console's model). */
const val ORDER_NOTE_MAX_LENGTH = 500

fun ordersPath(hostId: String) = "hosts/$hostId/orders"

/** The chips above the list, each a set of clauses on the one query. */
enum class OrderFilter(val label: String, val clauses: () -> List<ListFilterRequest>) {
  ALL("All", { emptyList() }),
  UNFULFILLED("Unfulfilled", { listOf(ListFilterRequest("statusKey", "isAnyOf", "paid,partially_fulfilled")) }),
  FULFILLED("Fulfilled", { listOf(ListFilterRequest("statusKey", "isAnyOf", "fulfilled,delivered")) }),
  PENDING("Unpaid", { listOf(ListFilterRequest("statusKey", "equals", "pending")) }),
  RETURNS("Canceled & refunded", { listOf(ListFilterRequest("statusKey", "isAnyOf", "cancelled,refunded")) }),
  DISPUTES("Disputes", { Contracts.openDisputeClause.let { listOf(ListFilterRequest(it.field, it.op, it.value)) } }),
}

/** The request the list sends the planner: the chip's clauses, the filters added, the quick search's words and the sort asked. */
fun ordersListRequest(
  filter: OrderFilter,
  search: String = "",
  clauses: List<ListFilterRequest> = emptyList(),
  sort: ListQuerySort? = null,
): ListQueryRequest = ListQueryRequest(
  clauses = filter.clauses() + clauses,
  search = search.trim().ifEmpty { null }?.let { listOf(it) },
  sort = sort,
)

fun ordersQuery(
  hostId: String,
  filter: OrderFilter,
  search: String = "",
  startAfter: List<Any?>? = null,
  clauses: List<ListFilterRequest> = emptyList(),
  sort: ListQuerySort? = null,
): FirestoreQuery =
  planListQuery(Contracts.orderListQuery, ordersListRequest(filter, search, clauses, sort))
    .toFirestoreQuery(ordersPath(hostId), ORDERS_PAGE_SIZE, startAfter)

/** An order as the console reads it ([liftLegacyOrder]); a document that is not an order reads as an empty one. */
fun hostOrderFrom(doc: FirestoreDoc): HostOrder = liftLegacyOrder(doc.decode(HostOrder.serializer()) ?: HostOrder())

/** A test-mode order, as the console badges it: `livemode`, else a test checkout session id. */
fun docIsTestMode(doc: FirestoreDoc, order: HostOrder): Boolean = orderIsTestMode(order, doc.id, doc.data["livemode"] as? Boolean)

fun statusLabel(status: OrderStatus?): String =
  status?.let { Contracts.orderStatusLabels[it.raw] } ?: "Pending"

/** One row of the list: everything a row shows, worked out once. */
data class OrderRow(
  val id: String,
  val label: String,
  val status: OrderStatus,
  val statusLabel: String,
  val channelLabel: String,
  val customer: String,
  val itemCount: Long,
  val netCents: Double,
  val createdAtMs: Long,
  val testMode: Boolean,
  val disputeOpen: Boolean,
)

fun orderRow(doc: FirestoreDoc): OrderRow {
  val order = hostOrderFrom(doc)
  return OrderRow(
    id = doc.id,
    label = formatOrderNumber(order, doc.id),
    status = order.status ?: OrderStatus.PENDING,
    statusLabel = statusLabel(order.status),
    channelLabel = orderChannelLabel((order.channel ?: OrderChannel.ONLINE).raw),
    customer = listOf(order.customerName, order.customerEmail, order.customerPhone).firstOrNull { !it.isNullOrBlank() } ?: "Guest",
    itemCount = order.lineItems.orEmpty().sumOf { max(0L, it.quantity.toLong()) },
    netCents = orderNetCents(order),
    createdAtMs = order.createdAtMs?.toLong() ?: 0L,
    testMode = docIsTestMode(doc, order),
    disputeOpen = doc.data["disputeKey"] == "open",
  )
}

/** What the order's screen offers. The routes re-ask every one. */
data class OrderActions(
  val fulfill: Boolean,
  val markDelivered: Boolean,
  val refund: Boolean,
  val cancel: Boolean,
  val resendReceipt: Boolean,
)

fun orderActions(order: HostOrder): OrderActions {
  val status = order.status ?: OrderStatus.PENDING
  // Anything left to fulfill: a digital-only order is fulfilled in one step too (Fulfill items starts its lines full).
  val remaining = orderLineFulfillmentStates(order).any { it.remainingQuantity > 0 }
  val refundable = max(0.0, orderNetCents(order)) > 0 && status != OrderStatus.PENDING
  return OrderActions(
    fulfill = remaining && (canTransitionOrder(status, OrderStatus.FULFILLED) || canTransitionOrder(status, OrderStatus.PARTIALLY_FULFILLED)),
    markDelivered = canTransitionOrder(status, OrderStatus.DELIVERED),
    refund = refundable && canTransitionOrder(status, OrderStatus.REFUNDED) && !orderDisputeBlocksRefund(order),
    cancel = canTransitionOrder(status, OrderStatus.CANCELLED),
    resendReceipt = status != OrderStatus.PENDING && !(order.customerEmail.isNullOrBlank() && order.customerPhone.isNullOrBlank()),
  )
}

/** A shipment recorded on the order, as the dialog's Shipments list shows it. */
data class Shipment(
  val id: String,
  val carrier: String,
  val trackingNumber: String,
  val trackingUrl: String?,
  val atMs: Long,
  /** "2× Mug, 1× Shirt": what it carried. */
  val summary: String,
  /** The carrier's label, which prints on the device's print sheet. */
  val labelUrl: String? = null,
  /** Canceled shipments stay listed, struck through. */
  val active: Boolean = true,
  /** Edit tracking and Cancel shipment, while the order is still open to them. */
  val editable: Boolean = false,
  /** The carrier's tracking status in words (`Delivered`), when a carrier reports one. */
  val trackingStatus: String = "",
  /** The tracking number as stored, for Edit tracking. */
  val rawCarrier: String = "",
  val rawTrackingUrl: String = "",
)

/** One order, with what its screen may offer. */
data class OrderDetail(
  val id: String,
  val label: String,
  val order: HostOrder,
  val status: OrderStatus,
  val testMode: Boolean,
  val lines: List<OrderLineFulfillmentState>,
  val shipments: List<Shipment>,
  val refundState: OrderRefundState,
  val refundableCents: Double,
  val actions: OrderActions,
  /** The timeline, newest first, as the console's dialog lists it. */
  val timeline: List<OrderTimelineEvent>,
  /** The restock question still waiting for an answer, if any. */
  val restock: OrderRestockCheck?,
)

fun orderDetail(doc: FirestoreDoc): OrderDetail {
  val order = hostOrderFrom(doc)
  val names = order.lineItems.orEmpty()
  val editable = orderFulfillmentsEditable(order.status)
  val shipments = order.fulfillments.orEmpty()
    .map { f ->
      val active = fulfillmentIsActive(f)
      Shipment(
        id = f.id,
        carrier = f.carrier?.let { carrierLabelFor(it) }.orEmpty(),
        trackingNumber = f.trackingNumber.orEmpty(),
        trackingUrl = fulfillmentTrackingUrl(f.carrier, f.trackingNumber, f.trackingUrl),
        atMs = f.atMs.toLong(),
        summary = describeFulfillmentLines(order, fulfillmentLines(order, f)).ifEmpty { "Fulfilled" },
        labelUrl = f.labelUrl?.takeIf { it.startsWith("https://") || it.startsWith("http://") },
        active = active,
        editable = active && editable,
        trackingStatus = trackingStatusLabel(f.trackingStatus),
        rawCarrier = f.carrier.orEmpty(),
        rawTrackingUrl = f.trackingUrl.orEmpty(),
      )
    }
  return OrderDetail(
    id = doc.id,
    label = formatOrderNumber(order, doc.id),
    order = order,
    status = order.status ?: OrderStatus.PENDING,
    testMode = docIsTestMode(doc, order),
    lines = orderLineFulfillmentStates(order),
    shipments = shipments,
    refundState = orderRefundState(order),
    refundableCents = max(0.0, orderNetCents(order)),
    actions = orderActions(order),
    timeline = order.timeline.orEmpty().reversed(),
    restock = order.restockCheck?.takeIf { it.resolution == null },
  )
}

/** One timeline line as the console's dialog prints it: `time — event: detail`. */
fun timelineLine(event: OrderTimelineEvent): String =
  "${formatReceiptTime(event.atMs.toLong())} — ${event.event}" + (event.detail?.takeIf { it.isNotEmpty() }?.let { ": $it" } ?: "")

/** Why a note cannot be sent, or null. The route checks again. */
fun checkOrderNote(text: String): String? = if (text.isBlank()) "Write a note first" else null

/** Why a refund amount cannot be sent, or null. The route checks again. */
fun checkRefundAmount(amountCents: Long?, refundableCents: Double): String? = when {
  amountCents == null || amountCents <= 0 -> "Enter an amount above zero"
  amountCents > refundableCents -> "That is more than is left to refund"
  else -> null
}

/** Typed money (`12.50`, `$12.5`, `12`) as cents, or null when it is not an amount. */
fun parseMoneyCents(text: String): Long? {
  val cleaned = text.trim().removePrefix("$").replace(",", "")
  if (!Regex("""\d+(\.\d{0,2})?|\.\d{1,2}""").matches(cleaned)) return null
  val (whole, fraction) = cleaned.split('.').let { it[0] to it.getOrElse(1) { "" } }
  return (whole.ifEmpty { "0" }.toLong() * 100) + fraction.padEnd(2, '0').take(2).ifEmpty { "0" }.toLong()
}

/** Why a receipt cannot go to [to], or null. The route checks again. */
fun checkReceiptRecipient(channel: ReceiptChannel, to: String): String? {
  val value = to.trim()
  return when (channel) {
    ReceiptChannel.SMS -> if (Regex("""^\+?[\d\s().-]{7,}$""").matches(value)) null else "Enter a phone number"
    ReceiptChannel.EMAIL -> if (Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""").matches(value)) null else "Enter an email address"
  }
}

enum class ReceiptChannel(val raw: String, val label: String) { EMAIL("email", "Email"), SMS("sms", "Text") }

/**
 * The order routes, as the console's order dialog calls them. Each refuses
 * the app exactly when it would refuse the console.
 */
/** What Fulfill items asks the route to record (`FulfillItemsSubmission`). */
data class FulfillItemsRequest(
  /** Null when the picked units are everything still to ship. */
  val lineItems: List<FulfillmentLine>? = null,
  val carrier: String = "",
  val trackingNumber: String = "",
  val trackingUrl: String = "",
  /** Whole minor units of the store's currency; null when not typed (not known, which is not 0). */
  val shippingCostCents: Long? = null,
  val notify: Boolean = true,
)

/** The route body beyond the site and order, as the console's dialog sends it. */
fun fulfillItemsBody(request: FulfillItemsRequest): List<Pair<String, Any?>> = listOf(
  "to" to "fulfilled",
  "lineItems" to request.lineItems?.let { lines ->
    kotlinx.serialization.json.JsonArray(lines.map { JsonObject(mapOf("lineItemId" to JsonPrimitive(it.lineItemId), "quantity" to JsonPrimitive(it.quantity))) })
  },
  "carrier" to request.carrier.trim().ifEmpty { null },
  "trackingNumber" to request.trackingNumber.trim().ifEmpty { null },
  "trackingUrl" to request.trackingUrl.trim().ifEmpty { null },
  "shippingCostCents" to request.shippingCostCents,
  "notify" to if (request.notify) null else false,
)

/** What the route answered a shipment with, in the console's words. */
fun fulfillmentMessage(answer: JsonElement?): String {
  val o = answer as? JsonObject
  return when {
    (o?.get("already") as? JsonPrimitive)?.booleanOrNull == true -> "Order was already fulfilled"
    (o?.get("status") as? JsonPrimitive)?.contentOrNull == "partially_fulfilled" -> "Items fulfilled — the rest are still to ship"
    else -> "Order fulfilled"
  }
}

interface OrderActionsApi {
  /** Records a shipment and answers what to say about it. */
  suspend fun fulfill(orderId: String, request: FulfillItemsRequest, attemptKey: String): String

  /** Changes a shipment's carrier, number and link. */
  suspend fun updateTracking(orderId: String, fulfillmentId: String, carrier: String, trackingNumber: String, trackingUrl: String): String

  /** Cancels a shipment: its items go back to unfulfilled; the buyer is not told. */
  suspend fun cancelShipment(orderId: String, fulfillmentId: String): String

  /** Refunds the named lines; the route works out the amount from them. */
  suspend fun refundLines(orderId: String, lineItemIds: List<Int>, attemptKey: String)

  /** The store's currency, which a typed shipping cost is in. */
  suspend fun storeCurrency(): String
  suspend fun markDelivered(orderId: String)
  suspend fun refund(orderId: String, amountCents: Long?, attemptKey: String)
  suspend fun cancel(orderId: String)
  suspend fun receiptChannels(): Set<ReceiptChannel>
  suspend fun sendReceipt(orderId: String, channel: ReceiptChannel, to: String)
  suspend fun addNote(orderId: String, note: String)

  /** Answers the open restock question; the route's verdict says whether it landed (`recorded`, `answered`, `changed`). */
  suspend fun answerRestock(orderId: String, resolution: RestockAnswerChoice, flaggedAtMs: Double): String
}

enum class RestockAnswerChoice(val raw: String, val label: String, val recorded: String) {
  RESTOCKED("restocked", "Restocked", "Recorded as restocked"),
  DISMISSED("dismissed", "No restock", "Recorded — no restock"),
}

class ConsoleOrderActionsApi(
  private val api: ConsoleApiClient,
  private val hostId: String,
  private val firestore: com.aglyn.core.FirestoreReader? = null,
) : OrderActionsApi {
  private fun body(vararg pairs: Pair<String, Any?>): JsonObject = JsonObject(
    (listOf("hostId" to hostId) + pairs).filter { it.second != null }.associate { (key, value) ->
      key to when (value) {
        is JsonElement -> value
        is Boolean -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        else -> JsonPrimitive(value.toString())
      }
    },
  )

  override suspend fun fulfill(orderId: String, request: FulfillItemsRequest, attemptKey: String): String =
    fulfillmentMessage(
      api.request(FULFILL_ORDER_ROUTE, ApiMethod.POST, body("orderId" to orderId, *fulfillItemsBody(request).toTypedArray()), idempotencyKey = attemptKey),
    )

  override suspend fun updateTracking(orderId: String, fulfillmentId: String, carrier: String, trackingNumber: String, trackingUrl: String): String {
    val answer = api.request(
      FULFILL_ORDER_ROUTE,
      ApiMethod.POST,
      body(
        "orderId" to orderId,
        "action" to "update-tracking",
        "fulfillmentId" to fulfillmentId,
        "carrier" to carrier.trim(),
        "trackingNumber" to trackingNumber.trim(),
        "trackingUrl" to trackingUrl.trim().ifEmpty { null },
      ),
    ) as? JsonObject
    return if ((answer?.get("already") as? JsonPrimitive)?.booleanOrNull == true) "Tracking was already up to date" else "Tracking updated"
  }

  override suspend fun cancelShipment(orderId: String, fulfillmentId: String): String {
    val answer = api.request(
      FULFILL_ORDER_ROUTE,
      ApiMethod.POST,
      body("orderId" to orderId, "action" to "cancel-fulfillment", "fulfillmentId" to fulfillmentId),
    ) as? JsonObject
    return if ((answer?.get("already") as? JsonPrimitive)?.booleanOrNull == true) "Shipment was already canceled" else "Shipment canceled"
  }

  override suspend fun refundLines(orderId: String, lineItemIds: List<Int>, attemptKey: String) {
    api.request(
      REFUND_ORDER_ROUTE,
      ApiMethod.POST,
      body("orderId" to orderId, "lineItemIds" to kotlinx.serialization.json.JsonArray(lineItemIds.map { JsonPrimitive(it) })),
      idempotencyKey = attemptKey,
    )
  }

  override suspend fun storeCurrency(): String = try {
    (firestore?.get("hosts/$hostId/settings/store")?.data?.get("currency") as? String)?.ifEmpty { null }?.uppercase() ?: "USD"
  } catch (error: Throwable) {
    if (error is kotlinx.coroutines.CancellationException) throw error
    "USD"
  }

  override suspend fun markDelivered(orderId: String) {
    api.request(FULFILL_ORDER_ROUTE, ApiMethod.POST, body("orderId" to orderId, "to" to "delivered"))
  }

  override suspend fun refund(orderId: String, amountCents: Long?, attemptKey: String) {
    api.request(REFUND_ORDER_ROUTE, ApiMethod.POST, body("orderId" to orderId, "amountCents" to amountCents), idempotencyKey = attemptKey)
  }

  override suspend fun cancel(orderId: String) {
    api.request(CANCEL_ORDER_ROUTE, ApiMethod.POST, body("orderId" to orderId))
  }

  override suspend fun receiptChannels(): Set<ReceiptChannel> = try {
    val answer = api.request(ORDER_RECEIPT_ROUTE, ApiMethod.GET, query = mapOf("hostId" to hostId))?.jsonObject
    ReceiptChannel.entries.filter { (answer?.get(it.raw) as? JsonPrimitive)?.booleanOrNull == true }.toSet()
  } catch (error: Throwable) {
    if (error is kotlinx.coroutines.CancellationException) throw error
    // As the console's dialog: offer email, which the route re-checks.
    setOf(ReceiptChannel.EMAIL)
  }

  override suspend fun sendReceipt(orderId: String, channel: ReceiptChannel, to: String) {
    api.request(ORDER_RECEIPT_ROUTE, ApiMethod.POST, body("orderId" to orderId, "channel" to channel.raw, "to" to to.trim()))
  }

  override suspend fun addNote(orderId: String, note: String) {
    api.request(ORDER_NOTE_ROUTE, ApiMethod.POST, body("orderId" to orderId, "note" to note.trim().take(ORDER_NOTE_MAX_LENGTH)))
  }

  override suspend fun answerRestock(orderId: String, resolution: RestockAnswerChoice, flaggedAtMs: Double): String {
    val answer = api.request(
      ORDER_RESTOCK_ANSWER_ROUTE,
      ApiMethod.POST,
      body("orderId" to orderId, "resolution" to resolution.raw, "flaggedAtMs" to flaggedAtMs.toLong()),
    )?.jsonObject
    return (answer?.get("verdict") as? JsonPrimitive)?.contentOrNull ?: "recorded"
  }
}

/**
 * The console link to the customer's CRM record (`pluginRecordByEmailHref('contact', …)`): the Contacts list asked
 * to open the one person with this address. Null for a guest with no address, or before the site's slugs are known.
 */
fun customerCrmLink(orgSlug: String?, hostSlug: String?, email: String?): String? {
  val address = email?.trim().orEmpty()
  if (orgSlug.isNullOrBlank() || hostSlug.isNullOrBlank() || address.isEmpty()) return null
  return "/$orgSlug/hosts/$hostSlug/crm/contacts?email=${percentEncode(address)}"
}

/** Percent-encodes every byte but the unreserved characters, as `encodeURIComponent` does for a query value. */
private fun percentEncode(value: String): String = buildString {
  for (byte in value.encodeToByteArray()) {
    val c = byte.toInt().toChar()
    if (c.isLetterOrDigit() && c.code < 128 || c in "-._~") append(c) else append('%').append((byte.toInt() and 0xff).toString(16).uppercase().padStart(2, '0'))
  }
}
