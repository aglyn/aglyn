package com.aglyn.plugins.commerce.pos

import com.aglyn.hardware.CardCollectOutcome
import com.aglyn.hardware.CardCollectRequest
import com.aglyn.hardware.CardCollector
import com.aglyn.hardware.CardCollectorKind
import com.aglyn.hardware.CardCollectorState
import com.aglyn.hardware.CardReaderSessionSource
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val SECRET = "pi_123456789_secret_abcdefghij"
private const val INTENT = "pi_123456789"

/** A device reader answering from a script, recording what it was asked to collect. */
private class FakeCollector(private val outcome: (CardCollectRequest) -> CardCollectOutcome) : CardCollector {
  override val state = MutableStateFlow<CardCollectorState>(CardCollectorState.Connected("Tap to Pay", CardCollectorKind.TAP_TO_PAY, true))
  val requests = mutableListOf<CardCollectRequest>()
  var canceled = false

  override suspend fun connect(hostId: String, sessions: CardReaderSessionSource) = state.value

  override suspend fun collect(request: CardCollectRequest): CardCollectOutcome {
    requests += request
    return outcome(request)
  }

  override suspend fun cancel() {
    canceled = true
  }
}

private val pending = payment(amountCents = 1000, tipCents = 150)

class DeviceReaderTest {
  @Test
  fun startsTheIntentWithTheAttemptKeyCollectsAmountPlusTipAndLetsTheServerSettle() = runTest {
    val api = ScriptedSaleApi(
      mapOf(
        "card-present-sdk" to listOf(sale(listOf(pending), clientSecret = SECRET, paymentIntentId = INTENT)),
        "status" to listOf(sale(listOf(pending.copy(status = "succeeded")), status = "paid", dueCents = 0, completed = true)),
      ),
    )
    val reader = FakeCollector { CardCollectOutcome.Collected(it.paymentIntentId, it.amountCents) }
    val outcome = DeviceReaderService(reader).charge(TenderDeps(api, "o1", noSleep), 1000, 150, "press-1")
    assertTrue(assertIs<TenderOutcome.Settled>(outcome).answer.completed)
    assertEquals(listOf("card-present-sdk", "status"), api.actions)
    assertEquals("press-1", api.calls[0].key)
    assertEquals(SaleStep.CardPresentSdk(1000, 150), api.calls[0].step)
    assertEquals(listOf(CardCollectRequest(INTENT, SECRET, 1150)), reader.requests)
  }

  @Test
  fun releasesTheIntentWhenTheCustomerCancelsOrTheCardIsDeclined() = runTest {
    for (answer in listOf<CardCollectOutcome>(CardCollectOutcome.Canceled(INTENT), CardCollectOutcome.Failed(INTENT, "Declined: insufficient funds."))) {
      val api = ScriptedSaleApi(
        mapOf(
          "card-present-sdk" to listOf(sale(listOf(pending), clientSecret = SECRET, paymentIntentId = INTENT)),
          "cancel" to listOf(sale(listOf(pending.copy(status = "canceled")))),
        ),
      )
      val outcome = DeviceReaderService(FakeCollector { answer }).charge(TenderDeps(api, "o1", noSleep), 1000, 150, "k")
      if (answer is CardCollectOutcome.Failed) {
        assertEquals("Declined: insufficient funds.", assertIs<TenderOutcome.Failed>(outcome).message)
      } else {
        assertIs<TenderOutcome.Canceled>(outcome)
      }
      assertEquals(listOf("card-present-sdk", "cancel"), api.actions)
    }
  }

  @Test
  fun refusesToCollectASecretForAnotherIntent() = runTest {
    val api = ScriptedSaleApi(mapOf("card-present-sdk" to listOf(sale(listOf(pending), clientSecret = "pi_999999999_secret_abcdefghij", paymentIntentId = INTENT))))
    val reader = FakeCollector { error("never asked") }
    val outcome = DeviceReaderService(reader).charge(TenderDeps(api, "o1", noSleep), 1000, 150, "k")
    assertEquals("The payment to collect does not match its secret.", assertIs<TenderOutcome.Failed>(outcome).message)
    assertTrue(reader.requests.isEmpty())
    assertEquals(listOf("card-present-sdk", "cancel"), api.actions)
  }

  @Test
  fun refusesToCollectAnAmountOtherThanAmountPlusTip() = runTest {
    val api = ScriptedSaleApi(mapOf("card-present-sdk" to listOf(sale(listOf(pending.copy(tipCents = 0)), clientSecret = SECRET, paymentIntentId = INTENT))))
    val reader = FakeCollector { error("never asked") }
    val outcome = DeviceReaderService(reader).charge(TenderDeps(api, "o1", noSleep), 1000, 150, "k")
    assertEquals("The amount to charge does not match the register. Start the payment again.", assertIs<TenderOutcome.Failed>(outcome).message)
    assertTrue(reader.requests.isEmpty())
  }

  @Test
  fun settlesFromTheServerWhenTheReadersAnswerIsLost() = runTest {
    val api = ScriptedSaleApi(
      mapOf(
        "card-present-sdk" to listOf(sale(listOf(pending), clientSecret = SECRET, paymentIntentId = INTENT)),
        "status" to listOf(sale(listOf(pending)), sale(listOf(pending.copy(status = "succeeded")), dueCents = 0, completed = true)),
      ),
    )
    val reader = FakeCollector { throw IllegalStateException("reader went away") }
    val outcome = DeviceReaderService(reader).charge(TenderDeps(api, "o1", noSleep), 1000, 150, "k")
    assertIs<TenderOutcome.Settled>(outcome)
    assertEquals(listOf("card-present-sdk", "status", "status"), api.actions)
  }

  @Test
  fun reportsADroppedConnectionAsUnknownNeverAsAFailure() = runTest {
    val api = ScriptedSaleApi(mapOf("card-present-sdk" to listOf(lost())))
    val reader = FakeCollector { error("never asked") }
    val outcome = DeviceReaderService(reader).charge(TenderDeps(api, "o1", noSleep), 1000, 0, "k")
    assertEquals(LOST_ANSWER, assertIs<TenderOutcome.Unknown>(outcome).message)
    assertTrue(reader.requests.isEmpty())
    assertTrue(isLostAnswer(lost()))
    assertTrue(!isLostAnswer(refused("conflict", 409)))
  }

  @Test
  fun doesNotAskForTheCardTwiceWhenARetriedPressAlreadySettled() = runTest {
    val api = ScriptedSaleApi(mapOf("card-present-sdk" to listOf(sale(listOf(pending.copy(status = "succeeded"))))))
    val reader = FakeCollector { error("never asked") }
    assertIs<TenderOutcome.Settled>(DeviceReaderService(reader).charge(TenderDeps(api, "o1", noSleep), 1000, 150, "k"))
    assertTrue(reader.requests.isEmpty())
  }

  @Test
  fun givesUpAsUnknownWhenTheServerNeverConfirms() = runTest {
    val api = ScriptedSaleApi(mapOf("status" to List(5) { sale(listOf(pending)) }))
    val outcome = settleCardPayment(TenderDeps(api, "o1", noSleep), "pay1")
    assertIs<TenderOutcome.Unknown>(outcome)
    assertEquals(5, api.actions.size)
  }
}

class SmartReaderTest {
  private val counter = PosSmartReader("tmr_1", "Counter reader", null, "online", livemode = false)

  @Test
  fun pushesToTheReaderThenReadsItUntilItAnswers() = runTest {
    val api = ScriptedSaleApi(
      mapOf(
        "card-present" to listOf(sale(listOf(pending.copy(readerId = "tmr_1")))),
        "status" to listOf(sale(listOf(pending)), lost(), sale(listOf(pending.copy(status = "failed", failureMessage = "Card declined")))),
      ),
    )
    var waitingOn: String? = null
    val outcome = SmartReaderService(counter, pollMs = 0).charge(TenderDeps(api, "o1", noSleep), 1000, 150, "k") { waitingOn = it }
    assertEquals("pay1", waitingOn)
    assertEquals("Card declined", assertIs<TenderOutcome.Failed>(outcome).message)
    assertEquals(SaleStep.CardPresent("tmr_1", 1000, 150), api.calls[0].step)
    assertEquals("k", api.calls[0].key)
    // A lost read while the customer is at the reader is just another read.
    assertEquals(listOf("card-present", "status", "status", "status"), api.actions)
  }

  @Test
  fun asksToCheckTheSaleWhenTheReaderNeverAnswers() = runTest {
    val api = ScriptedSaleApi(mapOf("card-present" to listOf(sale(listOf(pending)))))
    val outcome = SmartReaderService(counter, pollMs = 0, maxPolls = 3).charge(TenderDeps(api, "o1", noSleep), 1000, 0, "k")
    assertIs<TenderOutcome.Unknown>(outcome)
  }

  @Test
  fun cancelsThePaymentOnTheReader() = runTest {
    val api = ScriptedSaleApi()
    SmartReaderService(counter).cancel(TenderDeps(api, "o1", noSleep), "pay1")
    assertEquals(SaleStep.Cancel("pay1"), api.calls.single().step)
  }
}

class CashAndGiftCardTest {
  @Test
  fun takesCashWithWhatWasHandedOverAndAPartForASplit() = runTest {
    val api = ScriptedSaleApi(mapOf("cash" to listOf(sale(listOf(payment("c1", "succeeded", "cash", 400, changeCents = 100)), dueCents = 600))))
    val outcome = assertIs<TenderOutcome.Settled>(payCash(TenderDeps(api, "o1", noSleep), 500, 400, 0, "cash-1"))
    assertEquals(100L, outcome.payment?.changeCents)
    assertEquals(600L, outcome.answer.sale.dueCents)
    assertEquals(Call("cash", SaleStep.Cash(500, 0, 400), "cash-1"), api.calls.single())
    val refusedApi = ScriptedSaleApi(mapOf("cash" to listOf(refused("Cash received is short"))))
    assertEquals(TenderOutcome.Failed("Cash received is short", null), payCash(TenderDeps(refusedApi, "o1", noSleep), 1, null, 0, "k"))
  }

  @Test
  fun takesAGiftCardByItsCode() = runTest {
    val api = ScriptedSaleApi(mapOf("gift-card" to listOf(sale(listOf(payment("g1", "succeeded", "gift_card", 1000)), dueCents = 0, completed = true))))
    assertIs<TenderOutcome.Settled>(payGiftCard(TenderDeps(api, "o1", noSleep), " abcd-1234 ", null, "gift-1"))
    assertEquals(SaleStep.GiftCard("ABCD-1234", null), api.calls.single().step)
    assertEquals("""{"hostId":"h1","orderId":"o1","action":"gift-card","code":"ABCD-1234"}""", SaleStep.GiftCard("ABCD-1234", null).body("h1", "o1").toString())
  }

  @Test
  fun aPaymentStepCannotLeaveWithoutItsAttemptKey() = runTest {
    val error = runCatching { ScriptedSaleApi().payment("o1", SaleStep.Cash(100, 0, null)) }.exceptionOrNull()
    assertEquals("A payment needs its attempt key.", error?.message)
  }
}

class TipsAndAmountsTest {
  @Test
  fun offersTheMerchantsPresetsAndNoTip() {
    assertEquals(
      listOf(TipChoice("none", "No tip", 0), TipChoice("pct-15", "15%", 300), TipChoice("pct-20", "20%", 400)),
      tipChoices(1999, listOf(15.0, 20.0)),
    )
    assertEquals("pct-12.5", tipChoices(1000, listOf(12.5))[1].id)
  }

  @Test
  fun suggestsTheBillsACustomerHandsOver() {
    assertEquals(listOf(1234L, 1500, 2000, 5000, 10000), cashQuickAmounts(1234))
    assertEquals(listOf(2000L, 5000, 10000), cashQuickAmounts(2000))
    assertEquals(emptyList(), cashQuickAmounts(0))
  }

  @Test
  fun readsTypedMoneyAsWholeCents() {
    assertEquals(1250L, centsFromText("$12.5"))
    assertEquals(100000L, centsFromText("1,000"))
    assertNull(centsFromText("12.345"))
    assertNull(centsFromText("abc"))
    assertEquals("12.50", amountText(1250))
    assertEquals("-0.99", amountText(-99))
    assertEquals(0L, posTipFromPercent(0, 15.0))
    assertEquals(150L, posTipFromPercent(1000, 15.0))
  }
}

class AttemptKeysTest {
  @Test
  fun keepsOneKeyPerPressUntilAnAnswerArrives() {
    var minted = 0
    val keys = AttemptKeys { "key-${++minted}" }
    assertEquals("key-1", keys.keyFor("card:tmr_1:1000:0"))
    // Pressing the same tender again after a lost answer reuses the key.
    assertEquals("key-1", keys.keyFor("card:tmr_1:1000:0"))
    assertEquals("key-1", keys.pending)
    // A different tender (another amount) is another attempt.
    assertEquals("key-2", keys.keyFor("cash:2000:1000:0"))
    keys.answered()
    assertNull(keys.pending)
    assertEquals("key-3", keys.keyFor("cash:2000:1000:0"))
  }

  @Test
  fun mintsDistinctKeysWithAPrefix() {
    val a = newAttemptKey()
    assertTrue(a.startsWith("pos-app-"))
    assertTrue(a != newAttemptKey())
  }
}
