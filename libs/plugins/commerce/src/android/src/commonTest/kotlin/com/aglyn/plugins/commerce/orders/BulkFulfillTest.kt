package com.aglyn.plugins.commerce.orders

import com.aglyn.contracts.OrderStatus
import com.aglyn.core.ConsoleApiClient
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals

private fun row(id: String, status: OrderStatus) = OrderRow(
  id = id, label = "#$id", status = status, statusLabel = status.raw, channelLabel = "Online", customer = "Ana", itemCount = 1,
  netCents = 1000.0, createdAtMs = 1L, testMode = false, disputeOpen = false,
)

/** Several orders marked fulfilled from the list: each is its own request with its own key, and each answer is read on its own. */
class BulkFulfillTest {
  private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")

  private class Seen(val body: String, val key: String?)

  private fun api(seen: MutableList<Seen>, answer: (String) -> Pair<HttpStatusCode, String>): ConsoleApiClient {
    val engine = MockEngine { request ->
      val body = request.body.toByteArray().decodeToString()
      seen += Seen(body, request.headers["Idempotency-Key"])
      val (status, text) = answer(Json.parseToJsonElement(body).jsonObject["orderId"].toString().trim('"'))
      respond(text, status, jsonHeaders)
    }
    return ConsoleApiClient("https://console.test", HttpClient(engine), { "token" }, maxAttempts = 1)
  }

  @Test
  fun eachOrderIsItsOwnRequestWithAKeyFromTheBatchAndTheOrder() = runTest {
    val seen = mutableListOf<Seen>()
    val result = bulkFulfillOrders(
      api(seen) { id -> if (id == "b") HttpStatusCode.OK to """{"already":true}""" else HttpStatusCode.OK to "{}" },
      "h1",
      listOf(row("a", OrderStatus.PAID), row("b", OrderStatus.PARTIALLY_FULFILLED)),
      "batch-1",
    )
    assertEquals(listOf("batch-1:a", "batch-1:b"), seen.map { it.key })
    assertEquals(Json.parseToJsonElement("""{"hostId":"h1","orderId":"a","to":"fulfilled"}"""), Json.parseToJsonElement(seen.first().body))
    assertEquals(BulkFulfillResult(fulfilled = 1, already = 1), result)
    assertEquals("2 orders fulfilled", describeBulkFulfill(result))
  }

  @Test
  fun anOrderThatCannotShipIsSkippedWithoutARequestAndTheRestGoAhead() = runTest {
    val seen = mutableListOf<Seen>()
    val result = bulkFulfillOrders(
      api(seen) { id -> if (id == "c") HttpStatusCode.Conflict to """{"error":"Cannot fulfill a refunded order"}""" else HttpStatusCode.OK to "{}" },
      "h1",
      listOf(row("a", OrderStatus.PAID), row("x", OrderStatus.CANCELLED), row("c", OrderStatus.PAID)),
      "batch-2",
    )
    assertEquals(listOf("a", "c"), seen.map { Json.parseToJsonElement(it.body).jsonObject["orderId"].toString().trim('"') }, "a canceled order asks nothing of the route")
    assertEquals(1, result.fulfilled)
    assertEquals(listOf(BulkRefusal("x", "Orders in \"cancelled\" cannot be fulfilled"), BulkRefusal("c", "Cannot fulfill a refunded order")), result.refused)
    assertEquals(
      "1 order fulfilled; 2 skipped (orders in \"cancelled\" cannot be fulfilled, …)",
      describeBulkFulfill(result),
    )
  }

  @Test
  fun aServerFailureLeavesTheOrderUnconfirmedRatherThanRefused() = runTest {
    val seen = mutableListOf<Seen>()
    val result = bulkFulfillOrders(api(seen) { HttpStatusCode.InternalServerError to """{"error":"boom"}""" }, "h1", listOf(row("a", OrderStatus.PAID)), "batch-3")
    assertEquals(BulkFulfillResult(unknown = listOf("a")), result)
    assertEquals("1 not confirmed — reopen it to check; running it again is safe", describeBulkFulfill(result))
    assertEquals("Nothing to fulfill", describeBulkFulfill(BulkFulfillResult()))
  }
}
