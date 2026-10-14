package com.aglyn.plugins.deliveryapps

import com.aglyn.contracts.formatOrderMoney
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/*
 * DELIVERY ORDERS AT THE REGISTER (AGL-3644, AGL-3651, AGL-3652). The Apple
 * app's `DeliveryApps.swift`. The console's delivery queue, native: the
 * merchant's own DoorDash, Uber Eats or Grubhub orders that the services'
 * webhooks bring to the register, each with the one next step (accept or
 * reject, ready, picked up).
 *
 * The queue and its actions go through the SAME routes the console register's
 * `DeliveryQueue` calls (`delivery-apps/queue`, `delivery-apps/order-action`),
 * as the signed-in member, so the register's own gate holds on the device: an
 * admin or editor of the site with `managePos`, the `pos` entitlement, and this
 * plugin on for the site. With no service connected the queue answers
 * `connected: false` and the register draws nothing.
 */

const val DELIVERY_QUEUE_ROUTE = "/api/delivery-apps/queue"
const val DELIVERY_ORDER_ACTION_ROUTE = "/api/delivery-apps/order-action"

/** How often the register asks for the queue again. */
const val DELIVERY_QUEUE_POLL_MS = 10_000L

/** The delivery services, as the plugin names them. */
enum class DeliveryService(val wire: String, val label: String, val readySignal: Boolean) {
  DOORDASH("doordash", "DoorDash", true),
  UBER_EATS("uber-eats", "Uber Eats", false),
  GRUBHUB("grubhub", "Grubhub", true),
  ;

  companion object {
    fun of(wire: String?): DeliveryService? = entries.firstOrNull { it.wire == wire }
  }
}

/** Where an order stands at the counter: `new`, `accepted`, `ready`, `picked_up`, or `rejected` / `cancelled`. */
enum class DeliveryOrderStatus(val wire: String, val label: String) {
  NEW("new", "New"),
  ACCEPTED("accepted", "Making"),
  READY("ready", "Ready"),
  PICKED_UP("picked_up", "Picked up"),
  REJECTED("rejected", "Rejected"),
  CANCELLED("cancelled", "Canceled"),
  ;

  companion object {
    fun of(wire: String?): DeliveryOrderStatus? = entries.firstOrNull { it.wire == wire }
  }
}

enum class DeliveryAction(val wire: String) { ACCEPT("accept"), REJECT("reject"), READY("ready"), PICKED_UP("picked_up"), RETRY("retry") }

/** A call to the service still owed, retried by the plugin's job. */
enum class DeliveryPendingCall(val wire: String) {
  ACCEPT("accept"),
  REJECT("reject"),
  READY("ready"),
  ;

  companion object {
    fun of(wire: String?): DeliveryPendingCall? = entries.firstOrNull { it.wire == wire }
  }
}

data class DeliveryOrderLine(
  val name: String,
  val quantity: Int,
  val unitPriceCents: Long,
  /** The options the buyer chose, as the service named them. */
  val options: List<String>,
  val instructions: String?,
  /** Whether the line takes stock from a product. */
  val matched: Boolean,
)

/** One order at the counter, as the register reads it. */
data class DeliveryOrder(
  val id: String,
  /** The service, by the id the plugin names it with; a service this app has not heard of still draws. */
  val serviceId: String,
  /** The short code the courier and the service show. */
  val externalRef: String,
  val status: DeliveryOrderStatus,
  /** `courier` for the service's courier, `customer` when the buyer collects it. */
  val handoff: String,
  val placedAtMs: Double,
  /** When the service expects it ready, when it said. */
  val pickupAtMs: Double?,
  val customerName: String?,
  val instructions: String?,
  val lines: List<DeliveryOrderLine>,
  val currency: String,
  val totalCents: Long,
  val refundedCents: Long,
  /** The short number of the store order it became, once accepted. */
  val displayRef: String?,
  /** Units the service sold beyond the shelf, once accepted. */
  val oversold: Int,
  val testMode: Boolean,
  /** A call to the service still owed. */
  val pending: DeliveryPendingCall?,
  /** Why the last attempt failed. */
  val error: String?,
) {
  val service: DeliveryService? get() = DeliveryService.of(serviceId)
  val serviceLabel: String get() = service?.label ?: serviceId
}

/** The register's queue: open orders, oldest first, and the latest finished ones. */
data class DeliveryQueue(
  /** Whether any service is connected for the site; the register draws nothing otherwise. */
  val connected: Boolean,
  val open: List<DeliveryOrder>,
  val recent: List<DeliveryOrder>,
) {
  companion object {
    val DISCONNECTED = DeliveryQueue(false, emptyList(), emptyList())
  }
}

/** The one next step (or two) an order offers, as the console's queue lists them. */
data class DeliveryStep(val action: DeliveryAction, val label: String, val primary: Boolean = false, val destructive: Boolean = false)

fun deliverySteps(order: DeliveryOrder): List<DeliveryStep> = when {
  order.status == DeliveryOrderStatus.NEW -> listOf(
    DeliveryStep(DeliveryAction.ACCEPT, "Accept", primary = true),
    DeliveryStep(DeliveryAction.REJECT, "Reject", destructive = true),
  )
  order.status == DeliveryOrderStatus.ACCEPTED && order.pending != DeliveryPendingCall.ACCEPT ->
    if (order.service?.readySignal != false) {
      listOf(DeliveryStep(DeliveryAction.READY, "Ready for pickup", primary = true), DeliveryStep(DeliveryAction.PICKED_UP, "Picked up"))
    } else {
      listOf(DeliveryStep(DeliveryAction.PICKED_UP, "Picked up", primary = true))
    }
  order.status == DeliveryOrderStatus.READY -> listOf(DeliveryStep(DeliveryAction.PICKED_UP, "Picked up", primary = true))
  else -> emptyList()
}

/** Why a cashier turns an order down, in the words the service is sent. */
val DELIVERY_REJECT_REASONS = listOf(
  "An item is out of stock",
  "The kitchen is too busy",
  "The store is closing",
  "The store cannot make this order",
)

/** Minor units as money, in the order's currency. */
fun deliveryMoney(cents: Long, currency: String): String = formatOrderMoney(cents.toDouble(), currency.ifEmpty { "USD" }.uppercase())

private fun JsonElement?.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
private fun JsonElement?.arr(): JsonArray = this as? JsonArray ?: JsonArray(emptyList())
private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.ifEmpty { null }
private fun JsonElement?.number(): Double? = (this as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
private fun JsonElement?.whole(): Long = number()?.let { kotlin.math.round(it).toLong() } ?: 0
private fun JsonElement?.flag(): Boolean = (this as? JsonPrimitive)?.booleanOrNull == true

fun readDeliveryOrder(element: JsonElement): DeliveryOrder? {
  val fields = element.obj()
  val id = fields["id"].text() ?: return null
  val status = DeliveryOrderStatus.of(fields["status"].text()) ?: return null
  return DeliveryOrder(
    id = id,
    serviceId = fields["service"].text() ?: "",
    externalRef = fields["externalRef"].text() ?: "",
    status = status,
    handoff = fields["handoff"].text() ?: "courier",
    placedAtMs = fields["placedAtMs"].number() ?: 0.0,
    pickupAtMs = fields["pickupAtMs"].number(),
    customerName = fields["customerName"].text(),
    instructions = fields["instructions"].text(),
    lines = fields["lines"].arr().map { line ->
      val entry = line.obj()
      DeliveryOrderLine(
        name = entry["name"].text() ?: "Item",
        quantity = maxOf(1L, entry["quantity"].whole()).toInt(),
        unitPriceCents = entry["unitPriceCents"].whole(),
        options = entry["options"].arr().mapNotNull { it.text() },
        instructions = entry["instructions"].text(),
        matched = entry["matched"].flag(),
      )
    },
    currency = fields["currency"].text() ?: "USD",
    totalCents = fields["totalCents"].whole(),
    refundedCents = fields["refundedCents"].whole(),
    displayRef = fields["displayRef"].text(),
    oversold = fields["oversold"].whole().toInt(),
    testMode = fields["testMode"].flag(),
    pending = DeliveryPendingCall.of(fields["pending"].text()),
    error = fields["error"].text(),
  )
}

fun readDeliveryQueue(body: JsonElement?): DeliveryQueue {
  val record = body.obj()
  if (!record["connected"].flag()) return DeliveryQueue.DISCONNECTED
  return DeliveryQueue(true, record["open"].arr().mapNotNull(::readDeliveryOrder), record["recent"].arr().mapNotNull(::readDeliveryOrder))
}

/** What an action answered: the route's own sentence for the cashier, and the order as it now stands. */
data class DeliveryActionResult(val message: String?, val order: DeliveryOrder?)

/** The queue's routes for one site; specs answer them from a script. */
interface DeliveryAppsApi {
  suspend fun queue(hostId: String): DeliveryQueue
  suspend fun act(hostId: String, orderId: String, action: DeliveryAction, reason: String?): DeliveryActionResult
}

/** The queue's routes over the console API, as the signed-in member. */
class ConsoleDeliveryAppsApi(private val api: ConsoleApiClient) : DeliveryAppsApi {
  override suspend fun queue(hostId: String): DeliveryQueue =
    readDeliveryQueue(api.request(DELIVERY_QUEUE_ROUTE, ApiMethod.GET, query = mapOf("hostId" to hostId)))

  override suspend fun act(hostId: String, orderId: String, action: DeliveryAction, reason: String?): DeliveryActionResult {
    val answer = api.request(
      DELIVERY_ORDER_ACTION_ROUTE,
      ApiMethod.POST,
      buildJsonObject {
        put("hostId", hostId)
        put("orderId", orderId)
        put("action", action.wire)
        if (!reason.isNullOrEmpty()) put("reason", reason)
      },
    ).obj()
    return DeliveryActionResult(answer["message"].text(), answer["order"]?.let(::readDeliveryOrder))
  }
}
