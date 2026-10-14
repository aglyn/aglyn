package com.aglyn.plugins.commerce.orders

import com.aglyn.contracts.OrderStatus
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * Mark several orders fulfilled at once, from the orders list (the console's `bulkFulfillOrders`, AGL-3611).
 *
 * One request per order through the same `fulfill-order` route the order screen uses, one after another, so each order gets
 * its own transition check and its own answer: a refunded order in the selection is refused on its own and the rest still
 * ship. Each carries a key derived from this batch and the order, so running the same batch again after a lost answer
 * writes nothing twice.
 */
data class BulkRefusal(val orderId: String, val error: String)

data class BulkFulfillResult(
  val fulfilled: Int = 0,
  val already: Int = 0,
  val refused: List<BulkRefusal> = emptyList(),
  /** Orders whose answer never came back: it is not known whether they shipped. */
  val unknown: List<String> = emptyList(),
)

/** The statuses a fulfil can move; the rest are skipped without a request. */
val BULK_FULFILLABLE_STATUSES = setOf(OrderStatus.PAID, OrderStatus.PARTIALLY_FULFILLED)

suspend fun bulkFulfillOrders(api: ConsoleApiClient, hostId: String, orders: List<OrderRow>, batchKey: String): BulkFulfillResult {
  var result = BulkFulfillResult()
  for (order in orders) {
    if (order.status !in BULK_FULFILLABLE_STATUSES) {
      result = result.copy(refused = result.refused + BulkRefusal(order.id, "Orders in \"${order.status.raw}\" cannot be fulfilled"))
      continue
    }
    try {
      val answer = api.request(
        FULFILL_ORDER_ROUTE,
        ApiMethod.POST,
        JsonObject(mapOf("hostId" to JsonPrimitive(hostId), "orderId" to JsonPrimitive(order.id), "to" to JsonPrimitive("fulfilled"))),
        idempotencyKey = "$batchKey:${order.id}",
      )
      val already = ((answer as? JsonObject)?.get("already") as? JsonPrimitive)?.booleanOrNull == true
      result = if (already) result.copy(already = result.already + 1) else result.copy(fulfilled = result.fulfilled + 1)
    } catch (error: CancellationException) {
      throw error
    } catch (error: ConsoleApiError) {
      // Below 500 the route answered: it refused this order. Otherwise it is not known whether it shipped.
      result = if (error.status in 400..499 && error.message.isNotBlank()) {
        result.copy(refused = result.refused + BulkRefusal(order.id, error.message))
      } else {
        result.copy(unknown = result.unknown + order.id)
      }
    } catch (_: Throwable) {
      result = result.copy(unknown = result.unknown + order.id)
    }
  }
  return result
}

/** One line for the banner: what happened, then what did not. */
fun describeBulkFulfill(result: BulkFulfillResult): String {
  val parts = mutableListOf<String>()
  val done = result.fulfilled + result.already
  if (done > 0) parts += "$done ${if (done == 1) "order" else "orders"} fulfilled"
  if (result.refused.isNotEmpty()) {
    parts += "${result.refused.size} skipped (${result.refused.first().error.lowercase()}${if (result.refused.size > 1) ", …" else ""})"
  }
  if (result.unknown.isNotEmpty()) {
    parts += "${result.unknown.size} not confirmed — reopen ${if (result.unknown.size == 1) "it" else "them"} to check; running it again is safe"
  }
  return parts.joinToString("; ").ifEmpty { "Nothing to fulfill" }
}
