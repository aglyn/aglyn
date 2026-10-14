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
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val ana = PosCustomer("contact", "c1", "Ana Ruiz", "ana@shop.co", "555 0100")

private class FakeCustomers : PosCustomersApi {
  val calls = mutableListOf<String>()
  var search = PosCustomerSearch(true, emptyList())
  var statsAnswer = PosCustomerStats(3, 12_500)
  var created = ana
  var failure: ConsoleApiError? = null

  private fun note(call: String) {
    calls += call
    failure?.let { throw it }
  }

  override suspend fun search(text: String): PosCustomerSearch = search.also { note("search $text") }
  override suspend fun stats(email: String): PosCustomerStats = statsAnswer.also { note("stats $email") }
  override suspend fun create(name: String, email: String, phone: String): PosCustomer = created.also { note("create $name|$email|$phone") }
}

class PosCustomerModelTest {
  @Test
  fun shortTextAsksNothing() = runTest {
    val api = FakeCustomers()
    val model = PosCustomerModel(api, this)
    model.type("a")
    advanceUntilIdle()
    assertTrue(api.calls.isEmpty())
    assertTrue(model.results.isEmpty())
  }

  @Test
  fun aSearchWaitsOutTheTypingPauseThenListsThePeopleFound() = runTest {
    val api = FakeCustomers().apply { search = PosCustomerSearch(true, listOf(ana)) }
    val model = PosCustomerModel(api, this)
    model.type("an")
    advanceTimeBy(100)
    model.type(" ana ")
    advanceTimeBy(100)
    assertTrue(api.calls.isEmpty(), "a newer keystroke cancelled the first wait")
    advanceUntilIdle()
    assertEquals(listOf("search ana"), api.calls)
    assertEquals(listOf(ana), model.results)
  }

  @Test
  fun aWorkspaceWithNoPeopleFallsBackToATypedEmail() = runTest {
    val api = FakeCustomers().apply { search = PosCustomerSearch(false, emptyList()) }
    val model = PosCustomerModel(api, this)
    model.type("Buyer@Shop.CO")
    advanceUntilIdle()
    assertFalse(model.available)
    assertEquals("buyer@shop.co", model.typedEmail)
    assertEquals("none", PosCustomer.typed("Buyer@Shop.CO").kind)
  }

  @Test
  fun statsReadOnlyForAnAttachedCustomerWithAnEmail() = runTest {
    val api = FakeCustomers()
    val model = PosCustomerModel(api, this)
    model.loadStats(null)
    advanceUntilIdle()
    assertTrue(api.calls.isEmpty())
    model.loadStats("ana@shop.co")
    advanceUntilIdle()
    assertEquals(PosCustomerStats(3, 12_500), model.stats)
    model.loadStats(null)
    assertNull(model.stats)
  }

  @Test
  fun addingNeedsAnEmailAndPrefillsATypedOne() = runTest {
    val api = FakeCustomers()
    val model = PosCustomerModel(api, this)
    model.type("new@shop.co")
    model.startAdding()
    assertEquals("new@shop.co", model.draftEmail)
    model.draftEmail = "nope"
    var added: PosCustomer? = null
    model.create { added = it }
    advanceUntilIdle()
    assertNull(added)
    assertEquals("Add the customer’s email address.", model.error)
    assertTrue(api.calls.none { it.startsWith("create") })
    model.draftName = "Ana Ruiz"
    model.draftEmail = "ana@shop.co"
    model.create { added = it }
    advanceUntilIdle()
    assertEquals(ana, added)
    assertFalse(model.adding)
    assertEquals("create Ana Ruiz|ana@shop.co|", api.calls.last())
  }

  @Test
  fun aRefusedAddKeepsTheFormOpenWithTheReason() = runTest {
    val api = FakeCustomers().apply { failure = ConsoleApiError("That customer could not be added.", 409, null) }
    val model = PosCustomerModel(api, this)
    model.startAdding()
    model.draftEmail = "ana@shop.co"
    var added: PosCustomer? = null
    model.create { added = it }
    advanceUntilIdle()
    assertNull(added)
    assertTrue(model.adding)
    assertEquals("That customer could not be added.", model.error)
  }
}

class CartCustomerTest {
  @Test
  fun attachingACustomerMakesTheirEmailTheSales() {
    val cart = Cart.EMPTY.withCustomer(ana)
    assertEquals("ana@shop.co", cart.customerEmail)
    assertEquals(ana, cart.customer)
    assertNull(cart.withCustomer(null).customer)
    assertEquals("", cart.withCustomer(null).customerEmail)
  }

  @Test
  fun theCustomerSurvivesARestart() {
    val kept = readStoredCart(Cart.EMPTY.withCustomer(ana).encode())
    assertEquals(ana, kept.customer)
    assertEquals("ana@shop.co", kept.customerEmail)
    val typed = readStoredCart(Cart.EMPTY.withCustomer(PosCustomer.typed("x@y.co")).encode())
    assertEquals("none", typed.customer?.kind)
    assertEquals("x@y.co", typed.customerEmail)
  }

  @Test
  fun aCustomerWithNoEmailKeepsTheReceiptEmailTypedBeforeIt() {
    val cart = Cart.EMPTY.withCustomerEmail("typed@shop.co").copy(customer = PosCustomer("contact", "c2", "No Mail"))
    val kept = readStoredCart(cart.encode())
    assertEquals("No Mail", kept.customer?.name)
    assertEquals("typed@shop.co", kept.customerEmail)
  }
}

class ConsolePosCustomersApiTest {
  private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")

  private fun api(seen: MutableList<JsonObject>, answer: String): ConsoleApiClient {
    val engine = MockEngine { request ->
      seen += Json.parseToJsonElement(request.body.toByteArray().decodeToString()).jsonObject
      respond(answer, HttpStatusCode.OK, jsonHeaders)
    }
    return ConsoleApiClient("https://console.test", HttpClient(engine), { "token" }, maxAttempts = 1)
  }

  @Test
  fun searchReadsAvailabilityAndPeople() = runTest {
    val seen = mutableListOf<JsonObject>()
    val found = ConsolePosCustomersApi(
      api(seen, """{"available":true,"customers":[{"kind":"contact","id":"c1","name":"Ana Ruiz","email":"ana@shop.co","phone":"555 0100"}]}"""),
      "h1",
    ).search("ana")
    assertEquals("search", seen.single()["action"]!!.jsonPrimitive.content)
    assertEquals("ana", seen.single()["text"]!!.jsonPrimitive.content)
    assertEquals("h1", seen.single()["hostId"]!!.jsonPrimitive.content)
    assertEquals(listOf(ana), found.customers)
    val none = ConsolePosCustomersApi(api(mutableListOf(), """{"available":false,"customers":[]}"""), "h1").search("ana")
    assertFalse(none.available)
  }

  @Test
  fun statsAndCreateSpeakTheRoutesWords() = runTest {
    val seen = mutableListOf<JsonObject>()
    val read = ConsolePosCustomersApi(api(seen, """{"orderCount":2,"lifetimeSpendCents":4200}"""), "h1").stats("ana@shop.co")
    assertEquals("stats", seen.single()["action"]!!.jsonPrimitive.content)
    assertEquals(PosCustomerStats(2, 4200), read)
    val created = mutableListOf<JsonObject>()
    val made = ConsolePosCustomersApi(
      api(created, """{"available":true,"customer":{"kind":"contact","id":"c1","name":"Ana Ruiz","email":"ana@shop.co","phone":null},"created":true}"""),
      "h1",
    ).create(" Ana Ruiz ", "ana@shop.co", "")
    assertEquals("Ana Ruiz", created.single()["name"]!!.jsonPrimitive.content)
    assertEquals("c1", made.id)
    assertNull(made.phone)
  }

  @Test
  fun theSaleCarriesTheCustomerTheWayTheConsoleDoes() = runTest {
    val seen = mutableListOf<JsonObject>()
    val client = api(seen, """{"orderId":"o1","totalCents":100,"dueCents":100}""")
    val cart = Cart.EMPTY.add(CartPick("p1", null, "Mug", null, emptyList(), 100), 1).withCustomer(ana)
    ConsolePosSaleApi(client, "h1").openSale("r1", null, cart, "k")
    val body = seen.single()
    assertEquals("ana@shop.co", body["customerEmail"]!!.jsonPrimitive.content)
    val customer = body["customer"]!!.jsonObject
    assertEquals("contact", customer["kind"]!!.jsonPrimitive.content)
    assertEquals("c1", customer["id"]!!.jsonPrimitive.content)
    assertEquals("Ana Ruiz", customer["name"]!!.jsonPrimitive.content)
  }
}
