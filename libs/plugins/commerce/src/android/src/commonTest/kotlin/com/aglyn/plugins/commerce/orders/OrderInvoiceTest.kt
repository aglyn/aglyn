package com.aglyn.plugins.commerce.orders

import com.aglyn.contracts.HostOrder
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val json = Json { ignoreUnknownKeys = true }

private fun order(fields: String = "", status: String = "paid"): HostOrder =
  json.decodeFromString("""{"status":"$status","number":1042${if (fields.isEmpty()) "" else ",$fields"}}""")

private fun send(to: String, atMs: Long = 1_793_000_000_000, paid: Boolean = false) =
  """{"atMs":$atMs,"by":"u1","messageId":"m","paid":$paid,"subject":"s","to":"$to","totalCents":1000}"""

class OrderInvoiceTest {
  @Test
  fun aPaidOrderIsOneThatStillStandsAsPaid() {
    listOf("paid", "partially_fulfilled", "fulfilled", "delivered").forEach { assertTrue(invoiceIsPaid(order(status = it)), it) }
    listOf("pending", "cancelled", "refunded").forEach { assertFalse(invoiceIsPaid(order(status = it)), it) }
  }

  @Test
  fun theFormAddressesTheCustomerThenTheLastSend() {
    assertEquals("a@example.test", invoiceSendPrefill(order(""""customerEmail":" a@example.test """")))
    assertEquals("b@example.test", invoiceSendPrefill(order(""""invoiceSends":[${send("b@example.test")}]""")))
    assertEquals("", invoiceSendPrefill(order()))
  }

  @Test
  fun theSubjectKeepsTheConversationElseNamesTheBusiness() {
    val plain = order()
    val number = formatInvoiceNumber(plain, "o1")
    assertEquals("$number from Test Shop", invoiceEmailDefaultSubject(plain, " Test Shop ", "o1"))
    assertEquals(number, invoiceEmailDefaultSubject(plain, "", "o1"))
    val threaded = order(""""emailThread":{"messageId":"m","references":[],"subject":"Your order"}""")
    assertEquals("Your order", invoiceEmailDefaultSubject(threaded, "Test Shop", "o1"))
  }

  @Test
  fun theSentLineNamesTheLastSendInTheGivenZone() {
    assertNull(invoiceSentLine(order()))
    val sends = """"invoiceSends":[${send("old@example.test", 1)},${send("new@example.test", paid = true)}]"""
    assertEquals(
      "Paid invoice sent ${formatReceiptTime(1_793_000_000_000, "UTC")} to new@example.test.",
      invoiceSentLine(order(sends), "UTC"),
    )
    assertTrue(invoiceSentLine(order(""""invoiceSends":[${send("")}]"""))!!.endsWith("to the customer."))
  }

  @Test
  fun anOfflineSaleSaysWhenAndWhatToCheck() {
    assertNull(orderOfflineNotice(order()))
    val base = """"saleKey":"k","soldAtMs":1793000000000,"syncedAtMs":1793000600000,"syncedBy":"u1""""
    val quiet = orderOfflineNotice(order(""""offline":{"flags":[],$base}"""), "UTC")!!
    assertFalse(quiet.needsCheck)
    assertTrue(quiet.text.startsWith("Rung while the register was offline\nRung "))
    val conflict = """{"applied":1,"name":"Mug","productId":"p","requested":3,"shortUnits":2}"""
    val loud = orderOfflineNotice(order(""""offline":{"flags":["stock-short","late-sync"],"stockConflicts":[$conflict],$base}"""), "UTC")!!
    assertTrue(loud.needsCheck)
    val lines = loud.text.split("\n")
    assertEquals("2 of 3× Mug not in stock", lines[2])
    assertEquals(4, lines.size)
    assertEquals(com.aglyn.contracts.Contracts.posOfflineFlagLabels["late-sync"], lines[3])
  }

  @Test
  fun theSmallPrintSaysWhereRepliesGo() {
    assertTrue(invoiceSendNote(true, "hi@example.test").endsWith("Replies go to hi@example.test."))
    assertTrue(invoiceSendNote(false, null).endsWith("Replies go to your email."))
  }

  @Test
  fun theSiteDetailsPreferSetupBusinessAndDropANonAddress() {
    val site = invoiceSiteDetails(
      mapOf(
        "displayName" to "Site",
        "seo" to mapOf("entity" to mapOf("name" to "Business", "email" to "hi@example.test")),
        "business" to mapOf("supportEmail" to "old@example.test"),
      ),
    )
    assertEquals(InvoiceSite("Business", "hi@example.test"), site)
    val older = invoiceSiteDetails(mapOf("displayName" to " Site ", "business" to mapOf("supportEmail" to "not an address")))
    assertEquals(InvoiceSite("Site", null), older)
  }

  private class Seen(val method: HttpMethod, val query: String?, val key: String?, val body: String)

  private fun api(seen: MutableList<Seen>, status: HttpStatusCode, text: String): ConsoleApiClient {
    val engine = MockEngine { request ->
      seen += Seen(
        request.method,
        request.url.encodedQuery,
        request.headers["Idempotency-Key"],
        (request.body as? io.ktor.http.content.TextContent)?.text.orEmpty(),
      )
      respond(
        text,
        status,
        headersOf(
          HttpHeaders.ContentDisposition to listOf("attachment; filename=\"invoice-1042.pdf\""),
          HttpHeaders.ContentType to listOf("application/json"),
        ),
      )
    }
    return ConsoleApiClient("https://console.test", HttpClient(engine), { "token" }, maxAttempts = 1)
  }

  @Test
  fun sendingCarriesTheFormAndItsAttemptKey() = runTest {
    val seen = mutableListOf<Seen>()
    val client = ConsoleOrderActionsApi(api(seen, HttpStatusCode.OK, """{"sent":true,"to":"typed@example.test"}"""), "h1")
    assertEquals("typed@example.test", client.sendInvoice("o1", "typed@example.test", "S", "M", "k1"))
    assertEquals("k1", seen.single().key)
    val body = json.parseToJsonElement(seen.single().body).toString()
    listOf(""""hostId":"h1"""", """"orderId":"o1"""", """"subject":"S"""", """"message":"M"""").forEach { assertTrue(it in body, it) }
  }

  @Test
  fun thePdfComesFromThePrintRouteUnderItsOwnName() = runTest {
    val seen = mutableListOf<Seen>()
    val file = downloadOrderInvoicePdf(api(seen, HttpStatusCode.OK, "%PDF-1.7"), "h 1", "o1")
    assertEquals("invoice-1042.pdf", file.name)
    assertEquals("%PDF-1.7", file.bytes.decodeToString())
    assertEquals(HttpMethod.Get, seen.single().method)
    assertEquals("hostId=h%201&orderId=o1&kind=invoice-pdf", seen.single().query)
  }

  @Test
  fun aRefusedPdfSaysTheRoutesWords() = runTest {
    val seen = mutableListOf<Seen>()
    val failure = assertFailsWith<ConsoleApiError> {
      downloadOrderInvoicePdf(api(seen, HttpStatusCode.Forbidden, """{"error":"No invoice here"}"""), "h1", "o1")
    }
    assertEquals("No invoice here", failure.message)
  }
}
