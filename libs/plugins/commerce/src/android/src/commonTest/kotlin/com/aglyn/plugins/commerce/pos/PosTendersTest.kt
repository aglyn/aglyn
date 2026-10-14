package com.aglyn.plugins.commerce.pos

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FilterOp
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun body(step: SaleStep): JsonObject = step.body("h1", "o1")

class PosTenderRoutesTest {
  @Test
  fun theNewStepsSpeakTheRoutesWords() {
    val credit = body(SaleStep.Credit("REF-1234", null, null, null))
    assertEquals("credit", credit["action"]!!.jsonPrimitive.content)
    assertEquals("REF-1234", credit["code"]!!.jsonPrimitive.content)
    assertNull(credit["providerId"])
    val account = body(SaleStep.Credit(null, "rewards", "acct_1", 300))
    assertEquals("rewards", account["providerId"]!!.jsonPrimitive.content)
    assertEquals("acct_1", account["reference"]!!.jsonPrimitive.content)
    assertEquals("300", account["amountCents"]!!.jsonPrimitive.content)
    val folio = body(SaleStep.Folio("res_1", null))
    assertEquals("res_1", folio["reservationId"]!!.jsonPrimitive.content)
    assertNull(folio["amountCents"], "no amount means the whole balance")
    val link = body(SaleStep.CardLink(1080, 200))
    assertEquals("card-link", link["action"]!!.jsonPrimitive.content)
    assertEquals("200", link["tipCents"]!!.jsonPrimitive.content)
    assertEquals("pay1", body(SaleStep.Retry("pay1"))["paymentId"]!!.jsonPrimitive.content)
    assertEquals("simulate", body(SaleStep.Simulate("pay1"))["action"]!!.jsonPrimitive.content)
    for (step in listOf(SaleStep.Credit("C", null, null, null), SaleStep.Folio("r", null), SaleStep.CardLink(1, 0))) {
      assertTrue(step.startsPayment, "${step.action} takes money, so it needs its attempt key")
    }
    for (step in listOf(SaleStep.Retry("p"), SaleStep.Simulate("p"))) assertFalse(step.startsPayment)
  }

  @Test
  fun theContextCarriesTheStoreCreditsThisSiteTakes() {
    val context = readPosContext(
      Json.parseToJsonElement(
        """{"settings":{},"terminal":{"available":true,"testMode":true},"credits":[
          {"providerId":"rewards","label":"Rewards","lookup":true},
          {"providerId":"referral","label":"Referral credit","lookup":false},
          {"label":"no id"}]}""",
      ),
    )
    assertEquals(listOf(PosCreditProvider("rewards", "Rewards", true), PosCreditProvider("referral", "Referral credit", false)), context.credits)
  }

  @Test
  fun aPaymentCarriesItsQrPageItsCreditNameAndWhetherItWasATest() {
    val answer = readPaymentAnswer(
      Json.parseToJsonElement(
        """{"sale":{"orderId":"o1","status":"pending","totalCents":1080,"paidCents":0,"dueCents":1080,"tenderableCents":0,"tipCents":0,"payments":[
          {"id":"p1","method":"card_link","amountCents":1080,"status":"pending","checkoutUrl":"https://pay.test/c/abc","livemode":false},
          {"id":"p2","method":"credit","amountCents":100,"status":"succeeded","creditLabel":"Rewards"}]},"paymentId":"p1"}""",
      ),
    )
    assertEquals("https://pay.test/c/abc", answer.payment?.checkoutUrl)
    assertEquals(false, answer.payment?.livemode)
    assertEquals("Rewards", answer.sale.payments[1].creditLabel)
    assertNull(answer.sale.payments[1].livemode, "a payment that does not say is not called a test")
  }

  @Test
  fun aPaymentIsDescribedTheWayTheConsoleLedgerDescribesIt() {
    fun money(cents: Long) = "$" + "${cents / 100}.${(cents % 100).toString().padStart(2, '0')}"
    assertEquals("Cash $5.00", describePayment(payment("p", "succeeded", "cash", 500), ::money))
    assertEquals(
      "Card reader (visa •••• 4242) $10.00 + $2.00 tip",
      describePayment(payment("p", "succeeded", "card_present", 1000, tipCents = 200, cardBrand = "visa", last4 = "4242"), ::money),
    )
    assertEquals("Rewards $10.00", describePayment(payment("p", "succeeded", "credit", 1000, creditLabel = "Rewards"), ::money))
    assertEquals("Store credit $10.00", describePayment(payment("p", "succeeded", "credit", 1000), ::money))
    assertEquals("Charged to room $10.00", describePayment(payment("p", "succeeded", "folio", 1000), ::money))
    assertEquals("Card (QR) $10.00", describePayment(payment("p", "pending", "card_link", 1000), ::money))
    assertEquals("Waiting", paymentStatusLabel("pending"))
    assertEquals("Declined", paymentStatusLabel("failed"))
  }

  @Test
  fun theStaysQueryAsksByStatusAndAStayIsNamedByItsGuest() {
    val query = staysQuery("h1")
    assertEquals("hosts/h1/reservations", query.collectionPath)
    assertEquals(listOf("status"), query.filters.map { it.field })
    assertEquals(FilterOp.EQ, query.filters.single().op)
    assertEquals("checked_in", query.filters.single().value)
    assertEquals(100, query.limit)
    assertEquals(PosStay("r1", "Ana Ruiz"), posStayFrom(com.aglyn.core.FirestoreDoc("r1", "hosts/h1/reservations/r1", mapOf("guestName" to "Ana Ruiz", "guestEmail" to "a@b.co"))))
    assertEquals(PosStay("r2", "a@b.co"), posStayFrom(com.aglyn.core.FirestoreDoc("r2", "hosts/h1/reservations/r2", mapOf("guestEmail" to "a@b.co"))))
    assertEquals(PosStay("r3", "r3"), posStayFrom(com.aglyn.core.FirestoreDoc("r3", "hosts/h1/reservations/r3", emptyMap())))
  }

  @Test
  fun theCreditLookupAsksTheProviderAndReadsTheAccounts() = runTest {
    val seen = mutableListOf<JsonObject>()
    val engine = MockEngine { request ->
      seen += Json.parseToJsonElement(request.body.toByteArray().decodeToString()).jsonObject
      respond(
        """{"providerId":"rewards","accounts":[{"reference":"acct_1","label":"Rewards","last4":"4821","availableCents":750,"detail":"Gold member"},{"label":"no reference"}]}""",
        HttpStatusCode.OK,
        headersOf(HttpHeaders.ContentType, "application/json"),
      )
    }
    val api = ConsolePosSaleApi(ConsoleApiClient("https://console.test", HttpClient(engine), { "token" }, maxAttempts = 1), "h1")
    val accounts = api.creditLookup("rewards", "ana@shop.co")
    assertEquals("credit-lookup", seen.single()["action"]!!.jsonPrimitive.content)
    assertEquals("rewards", seen.single()["providerId"]!!.jsonPrimitive.content)
    assertEquals("ana@shop.co", seen.single()["query"]!!.jsonPrimitive.content)
    assertEquals(listOf(PosCreditAccount("acct_1", "Rewards", "4821", 750, "Gold member")), accounts)
  }
}

class CheckoutTenderTest {
  private fun checkout(api: ScriptedSaleApi): Checkout {
    var minted = 0
    return Checkout(api, opened(1080), PosRegisterSettings(), AttemptKeys { "key-${++minted}" }, noSleep)
  }

  private fun answer(due: Long, vararg payments: PosSalePayment, completed: Boolean = false) =
    sale(payments.toList(), paymentId = payments.lastOrNull()?.id, dueCents = due, completed = completed)

  @Test
  fun storeCreditByCodeSettlesWhatTheAccountCanGive() = runTest {
    val api = ScriptedSaleApi(mapOf("credit" to listOf(answer(780, payment("p1", "succeeded", "credit", 300, creditLabel = "Rewards")))))
    val checkout = checkout(api)
    checkout.payCredit(" ref-1234 ")
    assertEquals(SaleStep.Credit("ref-1234", null, null, null), api.calls.single().step)
    assertNotNull(api.calls.single().key, "a payment carries its attempt key")
    val state = checkout.state.value
    assertEquals(CheckoutStep.Tender, state.step)
    assertEquals(780L, state.dueCents)
    assertEquals(NoticeTone.SUCCESS, state.notice?.tone)
  }

  @Test
  fun anEmptyCreditCodeIsRefusedBeforeAnyCall() = runTest {
    val api = ScriptedSaleApi()
    val checkout = checkout(api)
    checkout.payCredit("  ")
    assertEquals("Enter the code.", checkout.state.value.notice?.message)
    assertTrue(api.calls.isEmpty())
  }

  @Test
  fun storeCreditFromAFoundAccountNamesTheProviderAndAccountAndKeepsASplit() = runTest {
    val api = ScriptedSaleApi(mapOf("credit" to listOf(answer(0, payment("p1", "succeeded", "credit", 1080, creditLabel = "Rewards"), completed = true))))
    val checkout = checkout(api)
    checkout.setPart(500)
    checkout.payCredit("rewards", PosCreditAccount("acct_1", "Rewards", "4821", 750, null))
    assertEquals(SaleStep.Credit(null, "rewards", "acct_1", 500), api.calls.single().step)
    assertEquals(CheckoutStep.Receipt(0), checkout.state.value.step)
  }

  @Test
  fun aCreditTheServerRefusesShowsItsWords() = runTest {
    val api = ScriptedSaleApi(mapOf("credit" to listOf(refused("This rewards account has nothing to spend.", 409))))
    val checkout = checkout(api)
    checkout.payCredit("ABC")
    assertEquals("This rewards account has nothing to spend.", checkout.state.value.notice?.message)
    assertEquals(CheckoutStep.Tender, checkout.state.value.step)
  }

  @Test
  fun theCreditLookupKeepsWhatItFoundAndSaysWhenNothingMatched() = runTest {
    val api = ScriptedSaleApi()
    val found = PosCreditAccount("acct_1", "Rewards", "", 750, null)
    api.creditAccounts = Result.success(listOf(found))
    val checkout = checkout(api)
    checkout.lookUpCredit("rewards", " ana@shop.co ")
    assertEquals(listOf(found), checkout.state.value.creditAccounts)
    assertEquals(listOf("rewards:ana@shop.co"), api.lookups)
    api.creditAccounts = Result.success(emptyList())
    checkout.lookUpCredit("rewards", "nobody")
    assertEquals(emptyList(), checkout.state.value.creditAccounts)
    api.creditAccounts = Result.failure(ConsoleApiError("Too many lookups. Wait a moment.", 429, null))
    checkout.lookUpCredit("rewards", "again")
    assertNull(checkout.state.value.creditAccounts)
    assertEquals("Too many lookups. Wait a moment.", checkout.state.value.notice?.message)
    checkout.clearCreditLookup()
    assertNull(checkout.state.value.creditAccounts)
  }

  @Test
  fun aRoomChargeGoesOnTheStaysFolio() = runTest {
    val api = ScriptedSaleApi(mapOf("folio" to listOf(answer(0, payment("p1", "succeeded", "folio", 1080), completed = true))))
    val checkout = checkout(api)
    checkout.payFolio("res_1")
    assertEquals(SaleStep.Folio("res_1", null), api.calls.single().step)
    assertEquals(CheckoutStep.Receipt(0), checkout.state.value.step)
  }

  @Test
  fun theQrPaymentShowsItsPageThenSettlesWhenTheCustomerPays() = runTest {
    val waiting = payment("p1", "pending", "card_link", 1080, checkoutUrl = "https://pay.test/c/abc")
    val api = ScriptedSaleApi(
      mapOf(
        "card-link" to listOf(answer(1080, waiting)),
        "status" to listOf(answer(1080, waiting), answer(0, payment("p1", "succeeded", "card_link", 1080), completed = true)),
      ),
    )
    val checkout = checkout(api)
    checkout.payLink()
    assertEquals(CheckoutStep.Qr("p1", "https://pay.test/c/abc", 1080), checkout.state.value.step)
    assertEquals(SaleStep.CardLink(1080, 0), api.calls.first().step)
    assertFalse(checkout.state.value.busy)
    checkout.pollLink()
    assertEquals(CheckoutStep.Qr("p1", "https://pay.test/c/abc", 1080), checkout.state.value.step, "still waiting")
    checkout.pollLink()
    assertEquals(CheckoutStep.Receipt(0), checkout.state.value.step)
    assertEquals(listOf("card-link", "status", "status"), api.actions)
  }

  @Test
  fun closingTheQrPageReleasesTheAmountForAnotherTender() = runTest {
    val waiting = payment("p1", "pending", "card_link", 1080, checkoutUrl = "https://pay.test/c/abc")
    val api = ScriptedSaleApi(
      mapOf("card-link" to listOf(answer(1080, waiting)), "cancel" to listOf(answer(1080, payment("p1", "canceled", "card_link", 1080)))),
    )
    val checkout = checkout(api)
    checkout.payLink()
    checkout.cancelLink()
    assertEquals(CheckoutStep.Tender, checkout.state.value.step)
    assertEquals(listOf("card-link", "cancel"), api.actions)
    assertEquals(1080L, checkout.state.value.dueCents)
  }

  @Test
  fun aQrPaymentTheServerCouldNotMakeSaysSo() = runTest {
    val api = ScriptedSaleApi(mapOf("card-link" to listOf(refused("Card payments are not set up for this store.", 409))))
    val checkout = checkout(api)
    checkout.payLink()
    assertEquals(CheckoutStep.Tender, checkout.state.value.step)
    assertEquals("Card payments are not set up for this store.", checkout.state.value.notice?.message)
  }

  @Test
  fun aPendingQrPaymentCanBeShownAgainButNotAnythingElse() {
    val checkout = checkout(ScriptedSaleApi())
    checkout.showLink(payment("p1", "succeeded", "card_link", 1080, checkoutUrl = "https://pay.test/c/abc"))
    assertEquals(CheckoutStep.Tender, checkout.state.value.step)
    checkout.showLink(payment("p1", "pending", "cash", 1080))
    assertEquals(CheckoutStep.Tender, checkout.state.value.step)
    checkout.showLink(payment("p1", "pending", "card_link", 1080, checkoutUrl = "https://pay.test/c/abc"))
    assertEquals(CheckoutStep.Qr("p1", "https://pay.test/c/abc", 1080), checkout.state.value.step)
  }

  @Test
  fun aTestTapOnTheReaderIsFollowedByReadingTheSaleAgain() = runTest {
    val settled = answer(0, payment("p1", "succeeded", "card_present", 1080, livemode = false), completed = true)
    val api = ScriptedSaleApi(
      mapOf(
        "simulate" to listOf(answer(1080, payment("p1", "pending", "card_present", 1080, livemode = false))),
        "sale" to listOf(settled),
        "status" to listOf(settled),
      ),
    )
    val checkout = checkout(api)
    checkout.simulateTap("p1")
    assertEquals(SaleStep.Simulate("p1"), api.calls.first().step)
    assertEquals(CheckoutStep.Receipt(0), checkout.state.value.step)
  }

  @Test
  fun aDeclinedReaderPaymentIsRetriedOnTheSamePayment() = runTest {
    val api = ScriptedSaleApi(
      mapOf("retry" to listOf(answer(1080, payment("p1", "pending", "card_present", 1080)), refused("That reader is offline.", 409))),
    )
    val checkout = checkout(api)
    checkout.retryReaderPayment("p1")
    assertEquals(SaleStep.Retry("p1"), api.calls.first().step)
    assertEquals(listOf("p1"), checkout.state.value.inFlight.map { it.id })
    checkout.retryReaderPayment("p1")
    assertEquals("That reader is offline.", checkout.state.value.notice?.message)
  }
}

class ReceiptPrintTest {
  private fun checkout(api: ScriptedSaleApi) = Checkout(api, opened(1080), PosRegisterSettings(), AttemptKeys { "key-1" }, noSleep)

  @Test
  fun theReceiptGoesToTheRegistersPrinterUnderTheSalesOwnKey() = runTest {
    val api = ScriptedSaleApi()
    val checkout = checkout(api)
    assertNull(checkout.printToCloud())
    assertTrue(checkout.state.value.printed)
    assertEquals(SaleStep.Receipt("print"), api.calls.single().step)
    assertNull(api.calls.single().key, "a receipt is not a payment, so it needs no attempt key")
    assertEquals("Sent to the receipt printer.", checkout.state.value.notice?.message)
  }

  @Test
  fun aPrinterThatCannotBeReachedSaysSoAndTheReceiptIsNotCalledPrinted() = runTest {
    val api = ScriptedSaleApi(mapOf("receipt" to listOf(refused("The receipt printer did not answer.", 502))))
    val checkout = checkout(api)
    assertEquals("The receipt printer did not answer.", checkout.printToCloud())
    assertFalse(checkout.state.value.printed)
    assertEquals(NoticeTone.ERROR, checkout.state.value.notice?.tone)
  }

  @Test
  fun aReceiptPrintedOnADirectPrinterIsRecordedAsPrinted() = runTest {
    val api = ScriptedSaleApi()
    val checkout = checkout(api)
    checkout.markPrinted()
    assertTrue(checkout.state.value.printed)
    assertEquals(listOf("receipt"), api.actions)
  }
}
