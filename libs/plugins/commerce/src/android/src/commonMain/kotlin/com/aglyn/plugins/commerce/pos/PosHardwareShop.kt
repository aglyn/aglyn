package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.Contracts
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * THE HARDWARE SHOP A MERCHANT BUYS CARD READERS FROM (AGL-4038), as the console's Hardware card and Card readers to
 * set up card (pos-hardware-card.component.tsx, pos-hardware-waiting-card.component.tsx) have it: the catalog and its
 * prices, the basket and its summary, the two boxes, Check out on Stripe's own page, Your orders with their states, a
 * return request, and the readers bought in person that wait to be set up. Every call is the console's own route,
 * `/api/commerce/pos-hardware`, which decides each of these again. The words and small rules come from the console
 * through the native contracts (pos-hardware-shop.ts, pos-hardware.ts). Card readers are physical goods paid for on
 * Stripe's page, never an in-app purchase, so none of this waits on `StoreBilling.buying`. The Apple kit's
 * PosHardwareShop.swift.
 */

const val POS_HARDWARE_ROUTE = "/api/commerce/pos-hardware"
const val COMMERCE_HARDWARE_SCREEN = "commerce.hardware"
/** Who may see the shop and the site's orders: whoever works the register or may buy hardware (the route's door). */
val POS_HARDWARE_VISIT_KEYS = listOf("managePos", "posBuyHardware")
/** Who may start a checkout. */
const val POS_HARDWARE_BUY_KEY = "posBuyHardware"
/** Who may set a reader up on a store (choose its store, mark it set up). */
const val POS_HARDWARE_DEVICES_KEY = "posDevices"

private fun JsonElement?.hwObj(): JsonObject? = this as? JsonObject
private fun JsonElement?.hwText(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
private fun JsonElement?.hwNum(): Double? = (this as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
private fun JsonElement?.hwFlag(): Boolean = (this as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true
private fun JsonElement?.hwList(): List<JsonElement> = (this as? JsonArray).orEmpty()

data class PosHardwareOffer(val sku: String, val name: String, val use: String, val unitCents: Long)

data class PosHardwareShipOption(val method: String, val label: String, val cents: Long)

/** What the catalog answers: closed, or the offers, shipping speeds and whether tax is added at checkout. */
data class PosHardwareCatalog(
  val available: Boolean,
  val offers: List<PosHardwareOffer> = emptyList(),
  val shipping: List<PosHardwareShipOption> = emptyList(),
  val automaticTax: Boolean = false,
) {
  companion object {
    val CLOSED = PosHardwareCatalog(false)

    fun from(json: JsonElement?): PosHardwareCatalog {
      val o = json.hwObj() ?: return CLOSED
      if (!o["available"].hwFlag()) return CLOSED
      return PosHardwareCatalog(
        available = true,
        offers = o["offers"].hwList().mapNotNull { item ->
          val offer = item.hwObj() ?: return@mapNotNull null
          val sku = offer["sku"].hwText() ?: return@mapNotNull null
          PosHardwareOffer(sku, offer["name"].hwText() ?: sku, offer["use"].hwText().orEmpty(), (offer["unitCents"].hwNum() ?: 0.0).toLong())
        },
        shipping = o["shipping"].hwList().mapNotNull { item ->
          val option = item.hwObj() ?: return@mapNotNull null
          val method = option["method"].hwText() ?: return@mapNotNull null
          PosHardwareShipOption(method, option["label"].hwText() ?: method, (option["cents"].hwNum() ?: 0.0).toLong())
        },
        automaticTax = o["automaticTax"].hwFlag(),
      )
    }
  }
}

data class PosHardwareOrderLine(val name: String, val quantity: Int)

/** An order as Your orders lists it (the route's merchant view), or a reader waiting to be set up. */
data class PosHardwareOrderRow(
  val id: String,
  val number: String,
  val status: String,
  val lines: List<PosHardwareOrderLine>,
  val totalCents: Long,
  val createdAtMs: Double,
  val source: String,
  val returnState: String?,
  val trackingNumber: String?,
  val trackingUrl: String?,
  val hostId: String,
  val serialsTaken: Int,
) {
  val statusLabel: String get() = Contracts.posHardwareStatusLabels[status] ?: status
  val returnLabel: String? get() = returnState?.let { Contracts.posHardwareReturnLabels[it].orEmpty() }
  val returnOffered: Boolean get() = posHardwareReturnOffered(status, source, returnState != null)

  companion object {
    fun from(json: JsonElement?): PosHardwareOrderRow? {
      val o = json.hwObj() ?: return null
      val id = o["id"].hwText() ?: return null
      return PosHardwareOrderRow(
        id = id,
        number = o["number"].hwText().orEmpty(),
        status = o["status"].hwText().orEmpty(),
        lines = o["lines"].hwList().map { PosHardwareOrderLine(it.hwObj()?.get("name").hwText().orEmpty(), (it.hwObj()?.get("quantity").hwNum() ?: 0.0).toInt()) },
        totalCents = (o["totalCents"].hwNum() ?: 0.0).toLong(),
        createdAtMs = o["createdAtMs"].hwNum() ?: 0.0,
        source = o["source"].hwText() ?: "online",
        returnState = o["returnRequest"].hwObj()?.get("state").hwText(),
        trackingNumber = o["tracking"].hwObj()?.get("number").hwText(),
        trackingUrl = o["tracking"].hwObj()?.get("url").hwText()?.takeIf { it.startsWith("https://") },
        hostId = o["hostId"].hwText().orEmpty(),
        serialsTaken = (o["serialsTaken"].hwNum() ?: 0.0).toInt(),
      )
    }
  }
}

data class PosHardwareStoreChoice(val hostId: String, val name: String, val hasLocation: Boolean)

/** The readers bought in person that wait to be set up, as `waiting` answers. */
data class PosHardwareWaiting(
  val posPlan: Boolean = false,
  val stores: List<PosHardwareStoreChoice> = emptyList(),
  val orders: List<PosHardwareOrderRow> = emptyList(),
) {
  companion object {
    val NONE = PosHardwareWaiting()

    fun from(json: JsonElement?): PosHardwareWaiting {
      val o = json.hwObj() ?: return NONE
      return PosHardwareWaiting(
        posPlan = o["posPlan"].hwFlag(),
        stores = o["stores"].hwList().mapNotNull { item ->
          val store = item.hwObj() ?: return@mapNotNull null
          val id = store["hostId"].hwText() ?: return@mapNotNull null
          PosHardwareStoreChoice(id, store["name"].hwText() ?: id, store["hasLocation"].hwFlag())
        },
        orders = o["orders"].hwList().mapNotNull(PosHardwareOrderRow::from),
      )
    }
  }
}

// The console's rules (pos-hardware-shop.ts, pos-hardware.ts), replayed by the function cases.

/** Dollars and cents as the card shows them (`formatPosHardwareCents`): `$1,234.50`, `-$2.50`. */
fun formatPosHardwareCents(cents: Long): String {
  val negative = cents < 0
  val abs = if (negative) -cents else cents
  val dollars = (abs / 100).toString().reversed().chunked(3).joinToString(",").reversed()
  val rest = (abs % 100).toString().padStart(2, '0')
  return "${if (negative) "-" else ""}$$dollars.$rest"
}

/** The prompt to add the point of sale (`posPlanPrompt`): never a refusal. */
fun posHardwarePlanPrompt(arrived: List<String> = emptyList()): String {
  val adds = Contracts.posPlanAdds
  if (arrived.isNotEmpty()) {
    val one = arrived.size == 1
    return "${arrived.joinToString(", ")} ${if (one) "has" else "have"} arrived. To take payments with ${if (one) "it" else "them"}, add the point of sale: $adds."
  }
  return "You can buy readers on any plan. To take payments with them, add the point of sale: $adds."
}

/** Whether an order offers "Request a return" (`posHardwareReturnOffered`). */
fun posHardwareReturnOffered(status: String, source: String?, asked: Boolean): Boolean =
  !asked && (status == "delivered" || status == "registered" || ((source ?: "online") != "in_person" && status == "shipped"))

/** The arrived orders bought from the shop, by number (`posHardwareArrivedNumbers`). */
fun posHardwareArrivedNumbers(orders: List<Triple<String, String, String?>>): List<String> =
  orders.filter { (it.third ?: "online") == "online" && (it.second == "delivered" || it.second == "registered") }.map { it.first }

/** `Name × 2, …` (`posHardwareOrderItems`). */
fun posHardwareOrderItems(lines: List<PosHardwareOrderLine>): String = lines.joinToString(", ") { "${it.name} × ${it.quantity}" }

/** `2 × Name, …` (`posHardwareWaitingItems`). */
fun posHardwareWaitingItems(lines: List<PosHardwareOrderLine>): String = lines.joinToString(", ") { "${it.quantity} × ${it.name}" }

/** What a waiting reader still needs once its store is chosen (`posHardwareWaitingNote`). */
fun posHardwareWaitingNote(storeName: String, serialsTaken: Int, hasLocation: Boolean): String {
  val base = if (serialsTaken > 0) {
    "For $storeName. Add it on the POS devices card with the code it shows, and it is set up: we know its serial number."
  } else {
    "For $storeName. Add it on the POS devices card with the code it shows, then mark it set up."
  }
  return if (hasLocation) base else "$base The first reader asks for the store’s address."
}

/** `Return HW-…?` (`posHardwareReturnTitle`). */
fun posHardwareReturnTitle(number: String): String = "Return $number?"

/** A reason long enough to send (`posHardwareReturnReasonReady`). */
fun posHardwareReturnReasonReady(reason: String): Boolean = reason.trim().length >= 3

/** The basket and its summary (`posHardwareBasket`). */
data class PosHardwareBasket(val lines: List<Pair<String, Int>>, val itemsCents: Long, val totalCents: Long, val totalLabel: String)

fun posHardwareBasket(offers: List<Pair<String, Long>>, quantities: Map<String, Int>, shippingCents: Long?, automaticTax: Boolean): PosHardwareBasket {
  val lines = offers.map { it.first to maxOf(0, quantities[it.first] ?: 0) }.filter { it.second > 0 }
  val items = lines.sumOf { line -> (offers.firstOrNull { it.first == line.first }?.second ?: 0L) * line.second }
  val text = Contracts.posHardwareShopText
  return PosHardwareBasket(lines, items, items + (shippingCents ?: 0L), if (automaticTax) text.totalBeforeTax else text.total)
}

/** Check out's reason when blocked, and whether it can be pressed (`posHardwareCheckoutState`). */
fun posHardwareCheckoutState(canBuy: Boolean, termsAccepted: Boolean, businessUse: Boolean, hasLines: Boolean, hasShipping: Boolean): Pair<String?, Boolean> {
  val text = Contracts.posHardwareShopText
  val reason = when {
    !canBuy -> text.buyKeyReason
    !termsAccepted || !businessUse -> text.termsReason
    else -> null
  }
  return reason to (reason == null && hasLines && hasShipping)
}

/** The day an order was placed, as Placed reads it (`Nov 19, 2026`), or the numeric day a reader was bought. */
fun posHardwareDay(ms: Double, numeric: Boolean = false): String =
  if (ms <= 0) "—" else com.aglyn.contracts.formatLocalDay(ms.toLong(), if (numeric) "M/d/yyyy" else "MMM d, yyyy")

/** The route's own words for a refusal, or [fallback] when there are none (no connection). */
fun posHardwareRefusal(error: Throwable, fallback: String): String =
  (error as? ConsoleApiError)?.takeIf { it.status != 0 }?.message ?: fallback

/** The shop's calls, through the console's own route under the same gate. */
class PosHardwareApi(private val api: ConsoleApiClient, private val hostId: String) {
  private suspend fun call(action: String, extra: Map<String, JsonElement> = emptyMap(), attemptKey: String? = null, on: String = hostId): JsonElement? =
    api.request(
      POS_HARDWARE_ROUTE,
      ApiMethod.POST,
      JsonObject(mapOf("action" to JsonPrimitive(action), "hostId" to JsonPrimitive(on)) + extra),
      idempotencyKey = attemptKey,
    )

  suspend fun catalog(): PosHardwareCatalog = PosHardwareCatalog.from(call("catalog"))

  suspend fun orders(): List<PosHardwareOrderRow> = call("orders").hwObj()?.get("orders").hwList().mapNotNull(PosHardwareOrderRow::from)

  /** Starts Stripe Checkout for the basket; the page it answers takes the card and the address. */
  suspend fun checkout(lines: List<Pair<String, Int>>, shippingMethod: String, attemptKey: String): String? {
    val answer = call(
      "checkout",
      mapOf(
        "lines" to JsonArray(lines.map { JsonObject(mapOf("sku" to JsonPrimitive(it.first), "quantity" to JsonPrimitive(it.second))) }),
        "shippingMethod" to JsonPrimitive(shippingMethod),
        "hardwareTerms" to JsonObject(mapOf("accepted" to JsonPrimitive(true), "businessUse" to JsonPrimitive(true))),
      ),
      attemptKey = attemptKey,
    )
    return answer.hwObj()?.get("url").hwText()?.takeIf { it.startsWith("https://") }
  }

  suspend fun requestReturn(orderId: String, reason: String) {
    call("request-return", mapOf("orderId" to JsonPrimitive(orderId), "reason" to JsonPrimitive(reason.trim())))
  }

  suspend fun waiting(): PosHardwareWaiting = PosHardwareWaiting.from(call("waiting"))

  /** Chooses the store a reader bought in person is for: the call is made as that store. */
  suspend fun chooseStore(storeId: String, orderId: String) {
    call("choose-store", mapOf("orderId" to JsonPrimitive(orderId)), on = storeId)
  }

  /** Marks a reader set up, on the store it is for. */
  suspend fun markSetUp(storeId: String, orderId: String) {
    call("mark-set-up", mapOf("orderId" to JsonPrimitive(orderId)), on = storeId)
  }
}
