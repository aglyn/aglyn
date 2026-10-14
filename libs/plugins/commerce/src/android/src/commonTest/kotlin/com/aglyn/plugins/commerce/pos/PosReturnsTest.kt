package com.aglyn.plugins.commerce.pos

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun json(text: String) = Json.parseToJsonElement(text)

private const val ORDER_JSON = """{"id":"o1","number":1042,"label":"#1042","status":"paid","channel":"pos","createdAtMs":1700000000000,"customerEmail":"a@b.co","customerName":"Ana","totalCents":3000,"refundedCents":0,"returnable":true,"lines":[{"index":0,"name":"Mug","variantLabel":"Blue","quantity":3,"returned":0,"held":0,"valueCents":3000}],"tenders":[{"id":"p1","method":"cash","label":"Cash","amountCents":3000,"refundableCents":3000}]}"""

private fun order(text: String = ORDER_JSON) = readReturnOrder(json(text))!!

private class FakeReturns : PosReturnsApi {
  val calls = mutableListOf<String>()
  val requests = mutableListOf<PosReturnRequest>()
  val failures = ArrayDeque<ConsoleApiError>()
  var found: List<PosReturnOrder> = emptyList()

  override suspend fun find(text: String): List<PosReturnOrder> {
    calls += "find $text"
    return found
  }

  override suspend fun refund(registerId: String, assertion: String?, managerAssertion: String?, request: PosReturnRequest, attemptKey: String): PosReturnResult {
    calls += "refund $registerId ${assertion ?: "-"} ${managerAssertion ?: "-"} $attemptKey"
    requests += request
    failures.removeFirstOrNull()?.let { throw it }
    return PosReturnResult("ret1", 1000, 0, false, 1000, 1, listOf(PosReturnTenderResult("Cash", 1000, false, null)))
  }
}

class PosReturnReadingTest {
  @Test
  fun anOrderReadsItsLinesAndTenders() {
    val read = order()
    assertEquals("#1042", read.label)
    assertEquals(3, read.lines.single().left)
    assertEquals(3000L, read.tenders.single().refundableCents)
    assertTrue(read.returnable)
  }

  @Test
  fun aLineRefundsByTheServersCumulativeSplit() {
    val line = PosReturnLine(0, "Mug", null, quantity = 3, returned = 1, held = 0, valueCents = 1000)
    // 1000 * 2/3 = 667 less 1000 * 1/3 = 333, rounded the way the server rounds.
    assertEquals(334L, line.refundCents(1))
    assertEquals(667L, line.refundCents(2))
    assertEquals(0L, line.refundCents(0))
  }

  @Test
  fun unitsHeldByAnOnlineReturnCannotComeBackAtTheRegister() {
    assertEquals(1, PosReturnLine(0, "Mug", null, 3, returned = 1, held = 1, valueCents = 900).left)
  }

  @Test
  fun anAnswerWithoutARefundIsNotAResult() {
    assertNull(readReturnResult(json("""{"error":"no"}""")))
    val read = readReturnResult(
      json("""{"returnId":"r","refundedCents":500,"outstandingCents":200,"partial":true,"cashOutCents":300,"restockedUnits":2,"tenders":[{"label":"Visa","amountCents":200,"status":"failed","error":"declined"},{"label":"Cash","amountCents":300,"status":"refunded"}]}"""),
    )!!
    assertTrue(read.partial)
    assertTrue(read.tenders.first().failed)
    assertEquals("declined", read.tenders.first().error)
    assertEquals(300L, read.cashOutCents)
  }
}

class PosReturnModelTest {
  private fun model(api: FakeReturns, scope: kotlinx.coroutines.CoroutineScope, key: () -> String = { "key-1" }) =
    PosReturnModel(api, scope, { "r1" }, { "cashier-1" }, key)

  private suspend fun kotlinx.coroutines.test.TestScope.picked(returns: PosReturnModel) {
    returns.text = "1042"
    returns.find()
    advanceUntilIdle()
    returns.step(returns.order!!.lines[0], 1)
  }

  @Test
  fun oneMatchOpensStraightAway() = runTest {
    val api = FakeReturns().apply { found = listOf(order()) }
    val returns = model(api, this)
    returns.text = "  #1042 "
    returns.find()
    advanceUntilIdle()
    assertEquals(listOf("find #1042"), api.calls)
    assertEquals("o1", returns.order?.id)
  }

  @Test
  fun severalMatchesWaitForAPickAndBackReturnsToThem() = runTest {
    val api = FakeReturns().apply { found = listOf(order(), order()) }
    val returns = model(api, this)
    returns.text = "a@b.co"
    returns.find()
    advanceUntilIdle()
    assertNull(returns.order)
    returns.choose(api.found[0])
    returns.back()
    assertNull(returns.order)
    assertEquals(2, returns.orders?.size)
  }

  @Test
  fun quantitiesStopAtWhatCanStillComeBackAndPreviewTheRefund() = runTest {
    val api = FakeReturns().apply { found = listOf(order()) }
    val returns = model(api, this)
    picked(returns)
    assertEquals(1000L, returns.refundCents)
    val line = returns.order!!.lines[0]
    repeat(5) { returns.step(line, 1) }
    assertEquals(3, returns.quantity(line))
    assertEquals(3000L, returns.refundCents)
    assertTrue(returns.canSubmit)
  }

  @Test
  fun anOrderThatCannotBeReturnedTakesNoPicks() = runTest {
    val api = FakeReturns().apply { found = listOf(order(ORDER_JSON.replace("\"returnable\":true", "\"returnable\":false"))) }
    val returns = model(api, this)
    picked(returns)
    assertFalse(returns.canSubmit)
    assertTrue(returns.picks.isEmpty())
  }

  @Test
  fun theRefundNamesTheCashierTheRegisterAndOneKey() = runTest {
    val api = FakeReturns().apply { found = listOf(order()) }
    val returns = model(api, this)
    picked(returns)
    returns.note = "Handle cracked"
    returns.submit()
    advanceUntilIdle()
    assertEquals("refund r1 cashier-1 - key-1", api.calls.last())
    assertEquals(listOf(PosReturnPick(0, 1)), api.requests.last().picks)
    assertEquals("no_longer_needed", api.requests.last().reasonCode)
    assertTrue(api.requests.last().restock)
    assertEquals("Handle cracked", api.requests.last().note)
    assertNull(api.requests.last().split)
    assertEquals(1000L, returns.result?.cashOutCents)
  }

  @Test
  fun aboveTheLimitTheManagerApprovesTheSameAttempt() = runTest {
    val api = FakeReturns().apply {
      found = listOf(order())
      failures += ConsoleApiError("Register refunds need a manager's PIN.", 403, json("""{"error":"Register refunds need a manager's PIN.","needsManager":true,"limitCents":0}"""))
    }
    val returns = model(api, this)
    picked(returns)
    returns.submit()
    advanceUntilIdle()
    assertEquals("Register refunds need a manager's PIN.", returns.managerPrompt)
    assertNull(returns.result)
    assertNull(returns.error)
    returns.approve(PosStaffAssertion("mgr-1", 1, "m", "Mo", "manager"))
    advanceUntilIdle()
    assertNull(returns.managerPrompt)
    assertEquals(listOf("refund r1 cashier-1 - key-1", "refund r1 cashier-1 mgr-1 key-1"), api.calls.takeLast(2))
    assertNotNull(returns.result)
  }

  @Test
  fun aRefusalShowsItsWordsAndTheNextTapIsANewAttempt() = runTest {
    val keys = ArrayDeque(listOf("k1", "k2"))
    val api = FakeReturns().apply {
      found = listOf(order())
      failures += ConsoleApiError("Open a shift before paying cash out of the drawer.", 409, null)
    }
    val returns = model(api, this) { keys.removeFirst() }
    picked(returns)
    returns.submit()
    advanceUntilIdle()
    assertEquals("Open a shift before paying cash out of the drawer.", returns.error)
    returns.submit()
    advanceUntilIdle()
    assertEquals(listOf("refund r1 cashier-1 - k1", "refund r1 cashier-1 - k2"), api.calls.takeLast(2))
  }

  @Test
  fun aSplitByHandNamesOnlyThePaymentsGivenAnAmount() = runTest {
    val two = ORDER_JSON.replace("\"tenders\":[", "\"tenders\":[{\"id\":\"p0\",\"method\":\"card\",\"label\":\"Visa 4242\",\"amountCents\":1000,\"refundableCents\":1000},")
    val api = FakeReturns().apply { found = listOf(order(two)) }
    val returns = model(api, this)
    picked(returns)
    returns.splitByHand = true
    returns.split = mapOf("p0" to "4.00", "p1" to "6.00", "zz" to "1.00")
    returns.submit()
    advanceUntilIdle()
    assertEquals(listOf(PosReturnSplit("p0", 400), PosReturnSplit("p1", 600)), api.requests.last().split)
  }
}

class ConsolePosReturnsApiTest {
  private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")

  private class Seen(val path: String, val body: JsonObject, val key: String?)

  private fun api(seen: MutableList<Seen>, answer: String): ConsolePosReturnsApi {
    val engine = MockEngine { request ->
      seen += Seen(request.url.encodedPath, Json.parseToJsonElement(request.body.toByteArray().decodeToString()).jsonObject, request.headers["Idempotency-Key"])
      respond(answer, HttpStatusCode.OK, jsonHeaders)
    }
    return ConsolePosReturnsApi(ConsoleApiClient("https://console.test", HttpClient(engine), { "token" }, maxAttempts = 1), "h1")
  }

  @Test
  fun findAsksTheReturnRouteForTheText() = runTest {
    val seen = mutableListOf<Seen>()
    val found = api(seen, """{"orders":[$ORDER_JSON]}""").find("1042")
    assertEquals("/api/commerce/pos-return", seen.single().path)
    assertEquals("find", seen.single().body["action"]!!.jsonPrimitive.content)
    assertEquals("1042", seen.single().body["text"]!!.jsonPrimitive.content)
    assertEquals("h1", seen.single().body["hostId"]!!.jsonPrimitive.content)
    assertEquals("o1", found.single().id)
  }

  @Test
  fun aRefundSendsThePicksTheCashierAndTheIdempotencyKey() = runTest {
    val seen = mutableListOf<Seen>()
    val answer = """{"returnId":"r","refundedCents":1000,"outstandingCents":0,"partial":false,"cashOutCents":1000,"restockedUnits":1,"tenders":[]}"""
    val request = PosReturnRequest("o1", listOf(PosReturnPick(0, 2)), false, "damaged", " cracked ", listOf(PosReturnSplit("p1", 1000)))
    val result = api(seen, answer).refund("r1", "cashier-1", "mgr", request, "k-9")
    val body = seen.single().body
    assertEquals("refund", body["action"]!!.jsonPrimitive.content)
    assertEquals("r1", body["registerId"]!!.jsonPrimitive.content)
    assertEquals("o1", body["orderId"]!!.jsonPrimitive.content)
    assertEquals("false", body["restock"]!!.jsonPrimitive.content)
    assertEquals("damaged", body["reasonCode"]!!.jsonPrimitive.content)
    assertEquals("cracked", body["reason"]!!.jsonPrimitive.content)
    assertEquals("cashier-1", body["cashierAssertion"]!!.jsonPrimitive.content)
    assertEquals("mgr", body["managerAssertion"]!!.jsonPrimitive.content)
    val line = (body["lines"] as JsonArray).first().jsonObject
    assertEquals("2", line["quantity"]!!.jsonPrimitive.content)
    assertEquals("p1", body["tenders"]!!.jsonArray.first().jsonObject["paymentId"]!!.jsonPrimitive.content)
    assertEquals("k-9", seen.single().key)
    assertEquals(1000L, result.refundedCents)
  }
}
