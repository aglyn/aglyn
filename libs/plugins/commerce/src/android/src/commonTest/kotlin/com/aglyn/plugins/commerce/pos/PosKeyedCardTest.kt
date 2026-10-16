package com.aglyn.plugins.commerce.pos

import com.aglyn.core.InMemoryKeyValueStore
import com.aglyn.hardware.KeyedCardEntry
import com.aglyn.hardware.KeyedCardOutcome
import com.aglyn.hardware.KeyedCardRequest
import com.aglyn.hardware.NoPeripherals
import com.aglyn.hardware.StaticPeripherals
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/*
 * "TYPE CARD": the console's Payment Element path on the device. The Stripe
 * card SDK is Aglyn POS's alone, so these tests hand the tender a fake
 * KeyedCardEntry (the seam the SDK sits behind) and hold everything else:
 * the route's words, the checks before the form opens, and how each way the
 * form can close ends the sale step.
 */

private const val SECRET = "pi_12345678abc_secret_abcdefgh"
private const val INTENT = "pi_12345678abc"

private fun keyed(status: String, amountCents: Long = 1000, tipCents: Long = 0, failure: String? = null) =
  payment("pay1", status, "card_keyed", amountCents, tipCents, failureMessage = failure)

/** Stripe's card form, as the tests see it: it records what it was asked and answers from a script. */
private class FakeCardForm(var answer: KeyedCardOutcome) : KeyedCardEntry {
  val requests = mutableListOf<KeyedCardRequest>()

  override suspend fun collect(request: KeyedCardRequest): KeyedCardOutcome {
    requests += request
    return answer
  }
}

class KeyedCardTenderTest {
  private fun service(form: FakeCardForm) = KeyedCardService(form, "pk_test_51Habc", "Corner Shop")

  private fun checkout(api: ScriptedSaleApi): Checkout {
    var minted = 0
    return Checkout(api, opened(), PosRegisterSettings(tippingEnabled = true, tipPercentages = listOf(20.0)), AttemptKeys { "key-${++minted}" }, noSleep)
  }

  @Test
  fun theRouteSpeaksTheConsolesWords() {
    val step = SaleStep.CardKeyed(1000, 200)
    val body = step.body("h1", "o1")
    assertEquals("card-keyed", body["action"]!!.jsonPrimitive.content)
    assertEquals("1000", body["amountCents"]!!.jsonPrimitive.content)
    assertEquals("200", body["tipCents"]!!.jsonPrimitive.content)
    assertTrue(step.startsPayment, "a typed card takes money, so it needs its attempt key")
  }

  @Test
  fun theContextCarriesTheSitesPublishableKey() {
    val with = readPosContext(Json.parseToJsonElement("""{"settings":{},"publishableKey":"pk_test_51Habc"}"""))
    assertEquals("pk_test_51Habc", with.publishableKey)
    assertEquals("", readPosContext(Json.parseToJsonElement("""{"settings":{}}""")).publishableKey, "no key, no typed card")
  }

  @Test
  fun aConfirmedCardIsRecordedFromTheServersReadOfStripe() = runTest {
    val api = ScriptedSaleApi(
      mapOf(
        "card-keyed" to listOf(sale(listOf(keyed("pending")), clientSecret = SECRET)),
        "status" to listOf(sale(listOf(keyed("succeeded")), dueCents = 0, completed = true)),
      ),
    )
    val form = FakeCardForm(KeyedCardOutcome.Confirmed(INTENT))
    val checkout = checkout(api)
    checkout.payCard(service(form))
    assertIs<CheckoutStep.Receipt>(checkout.state.value.step)
    assertEquals(listOf("card-keyed", "status"), api.actions, "the form's say-so is never the record")
    assertEquals(SaleStep.CardKeyed(1000, 0), api.calls.first().step)
    assertNotNull(api.calls.first().key, "the press carries its attempt key")
    val request = form.requests.single()
    assertEquals(INTENT, request.paymentIntentId, "the intent is named by its own secret")
    assertEquals(SECRET, request.clientSecret)
    assertEquals("pk_test_51Habc", request.publishableKey)
    assertEquals(1000L, request.amountCents)
    assertEquals("Corner Shop", request.merchantName)
  }

  @Test
  fun theTipIsPartOfWhatTheFormCharges() = runTest {
    val api = ScriptedSaleApi(
      mapOf(
        "card-keyed" to listOf(sale(listOf(keyed("pending", tipCents = 200)), clientSecret = SECRET, paymentIntentId = INTENT)),
        "status" to listOf(sale(listOf(keyed("succeeded", tipCents = 200)), dueCents = 0, completed = true)),
      ),
    )
    val form = FakeCardForm(KeyedCardOutcome.Confirmed(INTENT))
    val checkout = checkout(api)
    checkout.customTip(200)
    checkout.payCard(service(form))
    assertEquals(SaleStep.CardKeyed(1000, 200), api.calls.first().step)
    assertEquals(1200L, form.requests.single().amountCents)
  }

  @Test
  fun closingTheFormWithoutPayingReleasesTheAmount() = runTest {
    val api = ScriptedSaleApi(
      mapOf(
        "card-keyed" to listOf(sale(listOf(keyed("pending")), clientSecret = SECRET)),
        "cancel" to listOf(sale(listOf(keyed("canceled")))),
      ),
    )
    val checkout = checkout(api)
    checkout.payCard(service(FakeCardForm(KeyedCardOutcome.Canceled(INTENT))))
    assertEquals(listOf("card-keyed", "cancel"), api.actions)
    assertEquals(CheckoutStep.Tender, checkout.state.value.step)
    assertEquals(1000L, checkout.state.value.dueCents)
    assertFalse(checkout.state.value.busy)
  }

  @Test
  fun aFormThatFailedReleasesTheAmountAndSaysWhy() = runTest {
    val api = ScriptedSaleApi(
      mapOf(
        "card-keyed" to listOf(sale(listOf(keyed("pending")), clientSecret = SECRET)),
        "cancel" to listOf(sale(listOf(keyed("canceled")))),
      ),
    )
    val checkout = checkout(api)
    checkout.payCard(service(FakeCardForm(KeyedCardOutcome.Failed(INTENT, "Your card was declined."))))
    assertEquals(listOf("card-keyed", "cancel"), api.actions)
    assertEquals(CheckoutStep.Tender, checkout.state.value.step)
    assertEquals("Your card was declined.", checkout.state.value.notice?.message)
  }

  @Test
  fun aCardStripeTookJustBeforeTheFormFailedIsStillRecordedAsPaid() = runTest {
    // The server reads Stripe before it cancels, so the cancel itself answers "succeeded".
    val api = ScriptedSaleApi(
      mapOf(
        "card-keyed" to listOf(sale(listOf(keyed("pending")), clientSecret = SECRET)),
        "cancel" to listOf(sale(listOf(keyed("succeeded")), dueCents = 0, completed = true)),
      ),
    )
    val checkout = checkout(api)
    checkout.payCard(service(FakeCardForm(KeyedCardOutcome.Failed(INTENT, "The connection dropped."))))
    assertIs<CheckoutStep.Receipt>(checkout.state.value.step, "a charge that went through is never lost")
  }

  @Test
  fun anIntentForAnotherAmountNeverOpensTheForm() = runTest {
    val api = ScriptedSaleApi(
      mapOf(
        "card-keyed" to listOf(sale(listOf(keyed("pending", amountCents = 9999)), clientSecret = SECRET)),
        "cancel" to listOf(sale(emptyList())),
      ),
    )
    val form = FakeCardForm(KeyedCardOutcome.Confirmed(INTENT))
    val checkout = checkout(api)
    checkout.payCard(service(form))
    assertTrue(form.requests.isEmpty())
    assertEquals("The amount to charge does not match the register. Start the payment again.", checkout.state.value.notice?.message)
    assertEquals(listOf("card-keyed", "cancel"), api.actions)
  }

  @Test
  fun aSecretThatDoesNotMatchItsIntentNeverOpensTheForm() = runTest {
    val api = ScriptedSaleApi(
      mapOf(
        "card-keyed" to listOf(sale(listOf(keyed("pending")), clientSecret = SECRET, paymentIntentId = "pi_other0000000")),
        "cancel" to listOf(sale(emptyList())),
      ),
    )
    val form = FakeCardForm(KeyedCardOutcome.Confirmed(INTENT))
    val checkout = checkout(api)
    checkout.payCard(service(form))
    assertTrue(form.requests.isEmpty())
    assertEquals("The payment to collect does not match its secret.", checkout.state.value.notice?.message)
  }

  @Test
  fun anAnswerWithNoSecretFailsWithTheServersWords() = runTest {
    val api = ScriptedSaleApi(mapOf("card-keyed" to listOf(sale(listOf(keyed("failed", failure = "Card payments are not set up."))))))
    val form = FakeCardForm(KeyedCardOutcome.Confirmed(INTENT))
    val checkout = checkout(api)
    checkout.payCard(service(form))
    assertTrue(form.requests.isEmpty())
    assertEquals("Card payments are not set up.", checkout.state.value.notice?.message)
    assertEquals(CheckoutStep.Tender, checkout.state.value.step)
  }

  @Test
  fun aPaymentTheServerRefusesToStartShowsItsWords() = runTest {
    val api = ScriptedSaleApi(mapOf("card-keyed" to listOf(refused("Card payments not set up", 409))))
    val form = FakeCardForm(KeyedCardOutcome.Confirmed(INTENT))
    val checkout = checkout(api)
    checkout.payCard(service(form))
    assertTrue(form.requests.isEmpty())
    assertEquals("Card payments not set up", checkout.state.value.notice?.message)
  }

  @Test
  fun aLostAnswerBlocksTendersUntilTheSaleIsReadAgain() = runTest {
    val api = ScriptedSaleApi(mapOf("card-keyed" to listOf(lost()), "sale" to listOf(lost())))
    val form = FakeCardForm(KeyedCardOutcome.Confirmed(INTENT))
    val checkout = checkout(api)
    checkout.payCard(service(form))
    assertTrue(checkout.state.value.lost)
    assertTrue(form.requests.isEmpty())
  }

  @Test
  fun aPressRetriedAfterTheFirstSettledDoesNotOpenTheFormAgain() = runTest {
    val api = ScriptedSaleApi(mapOf("card-keyed" to listOf(sale(listOf(keyed("succeeded")), dueCents = 0, completed = true, clientSecret = SECRET))))
    val form = FakeCardForm(KeyedCardOutcome.Confirmed(INTENT))
    val checkout = checkout(api)
    checkout.payCard(service(form))
    assertTrue(form.requests.isEmpty())
    assertIs<CheckoutStep.Receipt>(checkout.state.value.step)
  }

  @Test
  fun theCardStepReadsAsTypingNotTapping() {
    val keyed = service(FakeCardForm(KeyedCardOutcome.Canceled(INTENT)))
    assertEquals("Type card", keyed.label)
    assertEquals(CardReaderKind.KEYED, keyed.kind)
    assertEquals("Type the card into the card form.", keyed.prompt)
  }
}

class KeyedCardOfferTest {
  private fun register(api: ScriptedSaleApi, entry: KeyedCardEntry?, scope: kotlinx.coroutines.CoroutineScope) = RegisterModel(
    hostId = "h1",
    firestore = object : com.aglyn.core.FirestoreReader {
      override suspend fun get(path: String): com.aglyn.core.FirestoreDoc? = null
      override suspend fun page(query: com.aglyn.core.FirestoreQuery) = com.aglyn.core.FirestorePage(emptyList(), null)
      override fun observeDoc(path: String): kotlinx.coroutines.flow.Flow<com.aglyn.core.Live<com.aglyn.core.FirestoreDoc?>> = kotlinx.coroutines.flow.emptyFlow()
      override fun observe(query: com.aglyn.core.FirestoreQuery): kotlinx.coroutines.flow.Flow<com.aglyn.core.Live<List<com.aglyn.core.FirestoreDoc>>> = kotlinx.coroutines.flow.emptyFlow()
    },
    api = api,
    terminal = com.aglyn.hardware.CardReaderSessionSource { error("no card reader in this test") },
    deviceStore = InMemoryKeyValueStore(),
    peripherals = if (entry == null) NoPeripherals else StaticPeripherals(keyedCardEntry = entry),
    scope = scope,
  )

  private val form = FakeCardForm(KeyedCardOutcome.Canceled(INTENT))

  @Test
  fun typeCardIsOfferedWithTheSitesKeyAndThisAppsCardForm() = runTest {
    val api = ScriptedSaleApi().also { it.publishableKey = "pk_test_51Habc" }
    val model = register(api, form, backgroundScope)
    model.loadContext()
    assertEquals("Type card", model.keyedCard?.label)
    assertEquals("pk_test_51Habc", model.keyedCard?.publishableKey)
    assertEquals(CardReaderKind.KEYED, model.cardService("Type card")?.kind)
  }

  @Test
  fun typeCardIsNotOfferedWithoutTheKeyAsTheConsoleDoesNot() = runTest {
    val model = register(ScriptedSaleApi(), form, backgroundScope)
    model.loadContext()
    assertNull(model.keyedCard)
  }

  @Test
  fun typeCardIsNotOfferedWhereTheAppHasNoCardForm() = runTest {
    val api = ScriptedSaleApi().also { it.publishableKey = "pk_test_51Habc" }
    val model = register(api, null, backgroundScope)
    model.loadContext()
    assertNull(model.keyedCard, "the desktop register and the Aglyn app carry no Stripe card SDK")
    assertNull(model.cardService("Type card"))
  }

  @Test
  fun typeCardIsNotOfferedWhileTheRegisterIsOffline() = runTest {
    val api = ScriptedSaleApi().also { it.publishableKey = "pk_test_51Habc" }
    val model = register(api, form, backgroundScope)
    model.loadContext()
    api.answer("context", lost())
    model.loadContext()
    assertFalse(model.online)
    assertNull(model.keyedCard, "a card needs the server's intent")
  }
}
