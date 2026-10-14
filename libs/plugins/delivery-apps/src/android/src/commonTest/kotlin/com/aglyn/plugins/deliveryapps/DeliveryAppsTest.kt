package com.aglyn.plugins.deliveryapps

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun orderJson(
  id: String,
  status: String = "new",
  service: String = "doordash",
  ref: String = "ABC1",
  pending: String? = null,
  error: String? = null,
  total: Int = 2450,
): String =
  """{"id":"$id","service":"$service","externalRef":"$ref","status":"$status","handoff":"courier","placedAtMs":1700000000000,"pickupAtMs":1700000900000,
  "customerName":"Ana R.","instructions":"Leave at the door","currency":"usd","totalCents":$total,"refundedCents":0,"displayRef":"#12","oversold":0,"testMode":false,
  "lines":[{"name":"Latte","quantity":2,"unitPriceCents":450,"options":["Oat","Large"],"instructions":"Extra hot","matched":true}]${
    pending?.let { ""","pending":"$it"""" }.orEmpty()
  }${error?.let { ""","error":"$it"""" }.orEmpty()}}"""

private fun order(id: String, status: String = "new", service: String = "doordash", ref: String = "ABC1", pending: String? = null) =
  assertNotNull(readDeliveryOrder(Json.parseToJsonElement(orderJson(id, status, service, ref, pending))))

private fun queueJson(open: List<String> = emptyList(), recent: List<String> = emptyList(), connected: Boolean = true) =
  """{"connected":$connected,"open":[${open.joinToString(",")}],"recent":[${recent.joinToString(",")}]}"""

private fun queue(open: List<String> = emptyList(), recent: List<String> = emptyList()) =
  readDeliveryQueue(Json.parseToJsonElement(queueJson(open.map { orderJson(it) }, recent.map { orderJson(it, status = "picked_up") })))

class DeliveryReadingTest {
  @Test
  fun anOrderReadsWithItsLinesOptionsAndTimes() {
    val read = order("o1")
    assertEquals("DoorDash", read.serviceLabel)
    assertEquals(DeliveryOrderStatus.NEW, read.status)
    assertEquals(listOf(DeliveryOrderLine("Latte", 2, 450, listOf("Oat", "Large"), "Extra hot", true)), read.lines)
    assertEquals(1_700_000_900_000.0, read.pickupAtMs)
    assertEquals("#12", read.displayRef)
    assertNull(read.pending)
  }

  @Test
  fun anOrderInAStatusThisAppDoesNotKnowIsLeftOut() {
    assertNull(readDeliveryOrder(Json.parseToJsonElement(orderJson("o1", status = "teleported"))))
    assertNull(readDeliveryOrder(Json.parseToJsonElement("""{"status":"new"}""")), "no id, no order")
  }

  @Test
  fun aServiceThisAppHasNotHeardOfStillDrawsByItsOwnName() {
    val read = order("o1", service = "postmates")
    assertNull(read.service)
    assertEquals("postmates", read.serviceLabel)
    assertEquals(listOf(DeliveryAction.ACCEPT, DeliveryAction.REJECT), deliverySteps(read).map { it.action }, "and can still be accepted")
  }

  @Test
  fun aQueueWithNoServiceConnectedIsNothing() {
    assertEquals(DeliveryQueue.DISCONNECTED, readDeliveryQueue(Json.parseToJsonElement(queueJson(connected = false))))
    assertEquals(DeliveryQueue.DISCONNECTED, readDeliveryQueue(null))
    val read = queue(open = listOf("o1", "o2"), recent = listOf("o3"))
    assertTrue(read.connected)
    assertEquals(listOf("o1", "o2"), read.open.map { it.id })
    assertEquals(listOf(DeliveryOrderStatus.PICKED_UP), read.recent.map { it.status })
  }

  @Test
  fun eachOrderOffersTheOneNextStepTheConsoleOffers() {
    fun steps(status: String, service: String = "doordash", pending: String? = null) = deliverySteps(order("o", status, service, pending = pending)).map { it.action }
    assertEquals(listOf(DeliveryAction.ACCEPT, DeliveryAction.REJECT), steps("new"))
    assertEquals(listOf(DeliveryAction.READY, DeliveryAction.PICKED_UP), steps("accepted"), "a service that takes a ready signal")
    assertEquals(listOf(DeliveryAction.PICKED_UP), steps("accepted", service = "uber-eats"), "Uber Eats takes none")
    assertEquals(emptyList(), steps("accepted", pending = "accept"), "while the acceptance is still owed to the service")
    assertEquals(listOf(DeliveryAction.PICKED_UP), steps("ready"))
    assertEquals(emptyList(), steps("picked_up"))
    assertEquals(emptyList(), steps("rejected"))
    assertEquals(emptyList(), steps("cancelled"))
  }

  @Test
  fun theStatusesAreNamedAsTheConsoleNamesThem() {
    assertEquals("Making", DeliveryOrderStatus.ACCEPTED.label)
    assertEquals("Canceled", DeliveryOrderStatus.CANCELLED.label)
    assertEquals("Picked up", DeliveryOrderStatus.PICKED_UP.label)
  }

  @Test
  fun moneyIsInTheOrdersOwnCurrency() {
    assertEquals("$24.50", deliveryMoney(2450, "usd"))
    assertEquals("$24.50", deliveryMoney(2450, ""))
  }
}

class ConsoleDeliveryAppsApiTest {
  private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")

  private class Seen(val method: HttpMethod, val path: String, val query: String, val body: JsonObject?, val authorization: String?)

  private fun api(seen: MutableList<Seen>, answer: String): ConsoleDeliveryAppsApi {
    val engine = MockEngine { request ->
      val raw = request.body.toByteArray().decodeToString()
      seen += Seen(request.method, request.url.encodedPath, request.url.encodedQuery, raw.takeIf { it.isNotBlank() }?.let { Json.parseToJsonElement(it).jsonObject }, request.headers["Authorization"])
      respond(answer, HttpStatusCode.OK, jsonHeaders)
    }
    return ConsoleDeliveryAppsApi(ConsoleApiClient("https://console.test", HttpClient(engine), { "token" }, maxAttempts = 1))
  }

  @Test
  fun theQueueIsAskedForBySiteAsTheMember() = runTest {
    val seen = mutableListOf<Seen>()
    val read = api(seen, queueJson()).queue("h1")
    val request = seen.single()
    assertEquals("/api/delivery-apps/queue", request.path)
    assertEquals(HttpMethod.Get, request.method)
    assertTrue("hostId=h1" in request.query)
    assertEquals("Bearer token", request.authorization)
    assertTrue(read.connected)
  }

  @Test
  fun anActionCarriesTheOrderTheStepAndTheReason() = runTest {
    val seen = mutableListOf<Seen>()
    val result = api(seen, """{"ok":true,"message":"Accepted. DoorDash was told.","order":null}""").act("h1", "o1", DeliveryAction.REJECT, "The store is closing")
    val request = seen.single()
    assertEquals("/api/delivery-apps/order-action", request.path)
    assertEquals(HttpMethod.Post, request.method)
    val body = request.body!!
    assertEquals("h1", body["hostId"]!!.jsonPrimitive.content)
    assertEquals("o1", body["orderId"]!!.jsonPrimitive.content)
    assertEquals("reject", body["action"]!!.jsonPrimitive.content)
    assertEquals("The store is closing", body["reason"]!!.jsonPrimitive.content)
    assertEquals("Accepted. DoorDash was told.", result.message)
    assertNull(result.order)
  }

  @Test
  fun aPickedUpStepIsSpelledTheRoutesWay() = runTest {
    val seen = mutableListOf<Seen>()
    api(seen, """{"ok":true,"message":null,"order":null}""").act("h1", "o1", DeliveryAction.PICKED_UP, null)
    assertEquals("picked_up", seen.single().body!!["action"]!!.jsonPrimitive.content)
    assertNull(seen.single().body!!["reason"], "no reason is sent for a step that has none")
  }
}

class DeliveryQueueModelTest {
  private class Scripted : DeliveryAppsApi {
    val answers = ArrayDeque<Result<DeliveryQueue>>()
    val acted = mutableListOf<String>()
    var actResult: Result<DeliveryActionResult> = Result.success(DeliveryActionResult(null, null))

    override suspend fun queue(hostId: String): DeliveryQueue = answers.removeFirstOrNull()?.getOrThrow() ?: DeliveryQueue.DISCONNECTED

    override suspend fun act(hostId: String, orderId: String, action: DeliveryAction, reason: String?): DeliveryActionResult {
      acted += "$orderId ${action.wire} ${reason ?: "-"}"
      return actResult.getOrThrow()
    }
  }

  private fun model(api: Scripted, host: String? = "h1") = DeliveryQueueModel(api) { host }

  @Test
  fun aNewOrderIsAnnouncedOnceAndTheFirstLookIsNot() = runTest {
    val api = Scripted()
    api.answers += Result.success(queue(listOf("o1")))
    api.answers += Result.success(queue(listOf("o1")))
    api.answers += Result.success(readDeliveryQueue(Json.parseToJsonElement(queueJson(listOf(orderJson("o1"), orderJson("o2", ref = "ZZ9"))))))
    val model = model(api)
    model.refresh()
    assertNull(model.announcement, "what was already waiting at the first look is not news")
    assertEquals(1, model.waiting)
    model.refresh()
    assertNull(model.announcement)
    model.refresh()
    assertEquals("New DoorDash order ZZ9", model.announcement)
    assertEquals(2, model.waiting)
  }

  @Test
  fun severalNewOrdersAreOneAnnouncement() = runTest {
    val api = Scripted()
    api.answers += Result.success(queue())
    api.answers += Result.success(queue(listOf("o1", "o2")))
    val model = model(api)
    model.refresh()
    model.refresh()
    assertEquals("2 new delivery orders", model.announcement)
  }

  @Test
  fun aQueueTheCashierIsTurnedAwayFromDrawsNothing() = runTest {
    val api = Scripted()
    api.answers += Result.failure(ConsoleApiError("Not allowed", 403, null))
    val model = model(api)
    model.refresh()
    assertEquals(DeliveryQueue.DISCONNECTED, model.queue)
    api.answers += Result.success(queue(listOf("o1")))
    model.refresh()
    api.answers += Result.failure(ConsoleApiError("offline", 0, null))
    model.refresh()
    assertEquals(listOf("o1"), model.queue?.open?.map { it.id }, "a missed look keeps what the card showed")
  }

  @Test
  fun acceptingSendsTheStepAndLooksAgain() = runTest {
    val api = Scripted()
    api.answers += Result.success(queue(listOf("o1")))
    api.answers += Result.success(readDeliveryQueue(Json.parseToJsonElement(queueJson(listOf(orderJson("o1", status = "accepted"))))))
    api.actResult = Result.success(DeliveryActionResult("Accepted. DoorDash was told.", null))
    val model = model(api)
    model.refresh()
    model.act(model.queue!!.open.first(), DeliveryAction.ACCEPT)
    assertEquals(listOf("o1 accept -"), api.acted)
    assertEquals(DeliveryNotice("Accepted. DoorDash was told.", false), model.notice)
    assertEquals(DeliveryOrderStatus.ACCEPTED, model.queue!!.open.first().status)
    assertNull(model.busy)
  }

  @Test
  fun rejectingAsksForAReasonBeforeAnythingIsSent() = runTest {
    val api = Scripted()
    api.answers += Result.success(queue(listOf("o1")))
    api.answers += Result.success(queue())
    val model = model(api)
    model.refresh()
    val first = model.queue!!.open.first()
    model.act(first, DeliveryAction.REJECT)
    assertEquals("o1", model.rejecting?.id)
    assertTrue(api.acted.isEmpty(), "nothing goes to the service until a reason is chosen")
    model.reject(first, DELIVERY_REJECT_REASONS[1])
    assertNull(model.rejecting)
    assertEquals(listOf("o1 reject The kitchen is too busy"), api.acted)
  }

  @Test
  fun aRefusedStepShowsTheRoutesWords() = runTest {
    val api = Scripted()
    api.answers += Result.success(queue(listOf("o1")))
    api.actResult = Result.failure(ConsoleApiError("This order is being updated. Try again in a moment.", 409, null))
    val model = model(api)
    model.refresh()
    model.act(model.queue!!.open.first(), DeliveryAction.ACCEPT)
    assertEquals(DeliveryNotice("This order is being updated. Try again in a moment.", true), model.notice)
  }

  @Test
  fun theQueueIsNotAskedForWithoutASite() = runTest {
    val api = Scripted()
    api.answers += Result.success(queue(listOf("o1")))
    val model = model(api, host = null)
    model.refresh()
    assertNull(model.queue)
  }
}

class DeliveryRegistrationTest {
  @Test
  fun theWidgetSitsInTheRegistersZoneForThePosAppOnly() {
    val registry = NativePluginRegistry()
    val result = registry.load(
      listOf(NativePluginManifestEntry("delivery-apps", mapOf("widgets" to listOf("delivery-apps.pos-orders")), ::registerDeliveryAppsNative)),
    )
    assertEquals(listOf("delivery-apps"), result.loaded, result.failed.toString())
    assertEquals(listOf("delivery-apps.pos-orders"), registry.widgets(NativeApp.POS, POS_ORDERS_SLOT).map { it.id })
    assertTrue(registry.widgets(NativeApp.AGLYN, POS_ORDERS_SLOT).isEmpty(), "the Aglyn app has no register")
    assertFalse(registry.widgets(NativeApp.POS).any { it.id == "delivery-apps.pos-orders" }, "and it is never a Home card")
  }
}
