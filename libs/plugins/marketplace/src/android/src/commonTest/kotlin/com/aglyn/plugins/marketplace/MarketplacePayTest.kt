package com.aglyn.plugins.marketplace

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
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

/** Buying a paid listing (AGL-4049): the console's `use-marketplace-pay.tsx` and `marketplace-pay-panel.spec.tsx`. */
class MarketplacePayTest {
  /** Answers each call in turn, recording the path, body and Idempotency-Key it was sent with. */
  private class Door(vararg answers: Pair<Int, String>) {
    private val queue = ArrayDeque(answers.toList())
    val calls = mutableListOf<Triple<String, JsonObject, String?>>()
    val client = ConsoleApiClient(
      origin = "https://console.test/",
      http = HttpClient(
        MockEngine { request ->
          val text = (request.body as? OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
          calls += Triple(request.url.encodedPath, if (text.isEmpty()) JsonObject(emptyMap()) else Json.parseToJsonElement(text).jsonObject, request.headers["Idempotency-Key"])
          val (status, body) = queue.removeFirstOrNull() ?: (200 to "{}")
          respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, "application/json"))
        },
      ),
      getIdToken = { "t" },
      sleep = {},
      maxAttempts = 1,
    )
    val actions get() = calls.map { (path, body) -> path + ":" + (body["action"]?.jsonPrimitive?.content ?: "pay") }
  }

  private val quote = """{"quote":{"listingName":"Hero","amountCents":1000,"taxCents":66,"totalCents":1066,"card":{"brand":"visa","last4":"4242"},"canPay":true}}"""

  private fun model(door: Door, opened: MutableList<String> = mutableListOf(), ended: MutableList<PayOutcome> = mutableListOf()) =
    MarketplacePay(MarketplacePayApi(door.client, "o1", "h1"), openPage = { opened += it }, onFinish = { ended += it }, newKey = { "key-1" })

  @Test
  fun theTotalReadsAsTheConsoleWritesIt() {
    assertEquals("$10.66", formatPayCents(1066))
    assertEquals("$1,234,567.05", formatPayCents(123456705))
    assertEquals("$0.00", formatPayCents(0))
    assertEquals("VISA •••• 4242", payCardLabel(PayQuoteCard(brand = "visa", last4 = "4242")))
    assertEquals("link · a@example.com", payCardLabel(PayQuoteCard(type = "link", email = "a@example.com")))
    assertEquals("the card on file", payCardLabel(null))
  }

  @Test
  fun refusalsSayWhatTheConsoleSays() {
    val body = Json.parseToJsonElement("""{"code":"card_required","error":"Add a card in Billing first"}""")
    assertEquals(PayPrerequisite.CARD_REQUIRED, payPrerequisite(412, body))
    assertNull(payPrerequisite(400, body))
    assertEquals("Purchases are not set up on this deployment.", payRefusalText(501, null))
    assertEquals("The payment did not go through.", payRefusalText(502, null))
    assertEquals("Add a card in Billing first", payRefusalText(412, body))
    assertEquals(
      "Checkout is paused — Try again soon.",
      payRefusalText(423, Json.parseToJsonElement("""{"title":"Checkout is paused","message":"Try again soon."}""")),
    )
    assertEquals("Checkout is paused for now.", lockdownRefusalLine(423, Json.parseToJsonElement("""{"title":"Checkout is paused","message":"Checkout is paused for now."}""")))
  }

  @Test
  fun aLicenceBelongsToTheWorkspaceItWasBoughtFor() {
    fun row(id: String, org: String?, uid: String = "u1", listing: String = "l1") =
      LicenceRow.from(FirestoreDoc(id, "marketplacePurchases/$id", mapOf("listingId" to listing, "buyerUid" to uid, "buyerOrgId" to org)))
    val here = row("p1", "o1")
    val there = row("p2", "o2")
    val legacy = row("p3", null)
    assertTrue(hasOrgLicence(listOf(here), "l1", "o1", "u1"))
    assertFalse(hasOrgLicence(listOf(there), "l1", "o1", "u1"))
    assertTrue(licensedElsewhere(listOf(there), "l1", "o1", "u1"))
    assertFalse(licensedElsewhere(listOf(here, there), "l1", "o1", "u1"))
    // Before AGL-2331 a purchase named no workspace: it licenses its buyer wherever they install, and nobody else.
    assertTrue(hasOrgLicence(listOf(legacy), "l1", "o1", "u1"))
    assertFalse(hasOrgLicence(listOf(legacy), "l1", "o1", "u2"))
    assertFalse(hasOrgLicence(listOf(here), "l2", "o1", "u1"))
    assertTrue(mustBuy(10.0, purchased = false, ownWorkspace = false, installed = false))
    assertFalse(mustBuy(10.0, purchased = true, ownWorkspace = false, installed = false))
    assertFalse(mustBuy(10.0, purchased = false, ownWorkspace = true, installed = false))
    assertFalse(mustBuy(10.0, purchased = false, ownWorkspace = false, installed = true))
    assertFalse(mustBuy(0.0, purchased = false, ownWorkspace = false, installed = false))
    assertEquals("Buy for $12", buyLabel(12.0, false))
    assertEquals("Buy for this workspace — $12.5", buyLabel(12.5, true))
    assertEquals("Someone in this workspace who isn't in Acme Builders needs to buy it.", publisherMemberBuyReason("Acme Builders"))
    assertEquals("Someone in this workspace who isn't in the publishing workspace needs to buy it.", publisherMemberBuyReason(" "))
    assertEquals("hosts.create", buyPermissionKey("siteStarter"))
    assertEquals(INSTALL_PLUGINS_KEY, buyPermissionKey("plugin"))
    assertEquals(PURCHASE_LOOKUP_CEILING.toLong(), listingPurchasesQuery("u1").limit?.toLong())
  }

  @Test
  fun theTotalComesFirstThenOnePressOfPayPays() = runTest {
    val door = Door(200 to quote, 200 to """{"paid":true,"invoiceId":"in_1"}""")
    val ended = mutableListOf<PayOutcome>()
    val pay = model(door, ended = ended)
    pay.buy("l1", "Hero")
    assertEquals(PayStep.Confirm(PayQuote("Hero", 1000, 66, 1066, PayQuoteCard(brand = "visa", last4 = "4242"), canPay = true)), pay.step)
    pay.pay()
    assertEquals<List<PayOutcome>>(listOf(PayOutcome.Paid), ended)
    assertNull(pay.step)
    val (path, body, key) = door.calls[1]
    assertEquals("/api/marketplace/pay", path)
    assertEquals("1066", body["expectedTotalCents"]?.jsonPrimitive?.content)
    assertEquals("o1", body["orgId"]?.jsonPrimitive?.content)
    assertEquals("h1", body["hostId"]?.jsonPrimitive?.content)
    assertEquals("key-1", key)
    assertNull(door.calls[0].third)
    assertEquals("Bought \"Hero\". It is yours to install.", payOutcomeNotice(PayOutcome.Paid, "Hero")?.first)
  }

  @Test
  fun alreadyOwnedEndsBeforeAnythingIsCharged() = runTest {
    val ended = mutableListOf<PayOutcome>()
    model(Door(409 to """{"code":"already_purchased","error":"Already owned"}"""), ended = ended).buy("l1", "Hero")
    assertEquals<List<PayOutcome>>(listOf(PayOutcome.Owned), ended)
    assertEquals("This organization already owns \"Hero\".", payOutcomeNotice(PayOutcome.Owned, "Hero")?.first)
  }

  @Test
  fun aDeclineStaysOnTheTotalWithStripesReasonAndANewKeyNextTime() = runTest {
    var keys = 0
    val door = Door(200 to quote, 402 to """{"error":"Your card was declined.","declined":true}""", 200 to """{"paid":true}""")
    val pay = MarketplacePay(MarketplacePayApi(door.client, "o1", null), openPage = {}, onFinish = {}, newKey = { "key-${++keys}" })
    pay.buy("l1", "Hero")
    pay.pay()
    assertEquals("Your card was declined.", pay.error)
    assertTrue(pay.step is PayStep.Confirm)
    pay.pay()
    assertEquals(listOf(null, "key-1", "key-2"), door.calls.map { it.third })
    assertNull(door.calls[1].second["hostId"]?.jsonPrimitive?.content)
  }

  @Test
  fun aMissingCardIsAddedOnStripesPageThenTheTotalIsAskedAgain() = runTest {
    val opened = mutableListOf<String>()
    val door = Door(
      412 to """{"code":"card_required","canManageBilling":true,"amountCents":1000}""",
      409 to """{"error":"No billing account yet"}""",
      200 to """{"clientSecret":"seti_1_secret"}""",
      200 to """{"url":"https://billing.stripe.com/p/session/test_1"}""",
      200 to quote,
    )
    val pay = model(door, opened)
    pay.buy("l1", "Hero")
    assertEquals(PayStep.Card, pay.step)
    pay.addCard()
    assertEquals(listOf("https://billing.stripe.com/p/session/test_1"), opened)
    assertTrue(pay.away)
    pay.backFromStripe()
    assertTrue(pay.step is PayStep.Confirm)
    assertEquals(
      listOf(
        "/api/marketplace/pay:quote", "/api/billing/subscription:portal", "/api/billing/profile:create-setup-intent",
        "/api/billing/subscription:portal", "/api/marketplace/pay:quote",
      ),
      door.actions,
    )
    assertEquals("payment_method_update", door.calls[1].second["flow"]?.jsonPrimitive?.content)
  }

  @Test
  fun anAddressIsSavedToBillingThenTheTotalIsAskedAgain() = runTest {
    val door = Door(412 to """{"code":"billing_address_required","canManageBilling":true}""", 200 to "{}", 200 to quote)
    val pay = model(door)
    pay.buy("l1", "Hero")
    assertEquals(PayStep.Address, pay.step)
    assertFalse(PayBillingAddress(line1 = "1 Main St", country = "USA").complete)
    pay.saveAddress(PayBillingAddress(line1 = "1 Main St", city = "Austin", state = "TX", postalCode = "78701", country = "us"))
    assertTrue(pay.step is PayStep.Confirm)
    val saved = door.calls[1].second
    assertEquals("set-billing-address", saved["action"]?.jsonPrimitive?.content)
    assertEquals("US", saved["country"]?.jsonPrimitive?.content)
  }

  @Test
  fun someoneWhoCannotManageBillingIsToldWhoCan() = runTest {
    val pay = model(Door(412 to """{"code":"card_required","canManageBilling":false,"amountCents":1000}"""))
    pay.buy("l1", "Hero")
    assertEquals(PayStep.AskBilling(PayPrerequisite.CARD_REQUIRED, 1000), pay.step)
  }

  @Test
  fun theBankConfirmsOnTheInvoicePageAndTheServerSettlesIt() = runTest {
    val opened = mutableListOf<String>()
    val ended = mutableListOf<PayOutcome>()
    val door = Door(
      200 to quote,
      200 to """{"requiresAction":true,"paymentClientSecret":"pi_secret","invoiceId":"in_1","hostedInvoiceUrl":"https://invoice.stripe.com/i/test_1"}""",
      200 to """{"paid":true,"invoiceId":"in_1"}""",
    )
    val pay = model(door, opened, ended)
    pay.buy("l1", "Hero")
    pay.pay()
    assertEquals(PayStep.Bank, pay.step)
    assertEquals(listOf("https://invoice.stripe.com/i/test_1"), opened)
    pay.backFromStripe()
    assertEquals<List<PayOutcome>>(listOf(PayOutcome.Paid), ended)
    assertEquals("in_1", door.calls[2].second["invoiceId"]?.jsonPrimitive?.content)
    assertEquals("settle", door.calls[2].second["action"]?.jsonPrimitive?.content)
  }

  @Test
  fun aBankStepWithNoPageIsSettledAtOnceAndSaysItCannotBeFinishedHere() = runTest {
    val door = Door(
      200 to quote,
      200 to """{"requiresAction":true,"paymentClientSecret":"pi_secret","invoiceId":"in_1"}""",
      402 to """{"error":"That payment was not completed. Nothing has been charged.","declined":true}""",
    )
    val pay = model(door)
    pay.buy("l1", "Hero")
    pay.pay()
    assertTrue(pay.step is PayStep.Confirm)
    assertEquals(
      "Your bank needs to confirm this payment, but it cannot be finished here. Nothing has changed and nothing has been charged.",
      pay.error,
    )
  }

  @Test
  fun aTotalThatMovedIsShownAgainBeforeAnotherPress() = runTest {
    val moved = quote.replace("1066", "1100")
    val door = Door(200 to quote, 409 to """{"code":"total_changed","error":"The total changed. Check the new total and pay again."}""", 200 to moved)
    val pay = model(door)
    pay.buy("l1", "Hero")
    pay.pay()
    assertEquals(1100, (pay.step as PayStep.Confirm).quote.totalCents)
    assertEquals("The total changed. Check the new total and pay again.", pay.error)
  }
}
