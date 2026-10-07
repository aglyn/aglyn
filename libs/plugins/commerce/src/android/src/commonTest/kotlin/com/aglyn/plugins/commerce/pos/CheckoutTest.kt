package com.aglyn.plugins.commerce.pos

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val tipping = PosRegisterSettings(tippingEnabled = true, tipPercentages = listOf(15.0, 20.0))

private class OneShotReader(val outcome: TenderOutcome) : CardReaderService {
  override val id = "r1"
  override val label = "Counter reader"
  override val kind = CardReaderKind.SMART
  val keys = mutableListOf<String>()
  val amounts = mutableListOf<Pair<Long, Long>>()

  override suspend fun charge(deps: TenderDeps, amountCents: Long, tipCents: Long, attemptKey: String, onWaiting: (String?) -> Unit): TenderOutcome {
    keys += attemptKey
    amounts += amountCents to tipCents
    onWaiting("pay1")
    return outcome
  }

  override suspend fun cancel(deps: TenderDeps, paymentId: String?) = Unit
}

class CheckoutTest {
  private fun checkout(api: ScriptedSaleApi, settings: PosRegisterSettings = tipping): Checkout {
    var minted = 0
    return Checkout(api, opened(), settings, AttemptKeys { "key-${++minted}" }, noSleep)
  }

  @Test
  fun startsAtTheTenderWithTheWholeBalanceDue() {
    val state = checkout(ScriptedSaleApi()).state.value
    assertEquals(CheckoutStep.Tender, state.step)
    assertEquals(1000L, state.dueCents)
    assertEquals(1000L, state.amountCents)
    assertTrue(state.canTender)
  }

  @Test
  fun pricesTipsOnWhatThisTenderPaysAndRepricesThemOnASplit() {
    val checkout = checkout(ScriptedSaleApi())
    assertEquals(listOf(0L, 150L, 200L), checkout.tips().map { it.cents })
    checkout.chooseTip(checkout.tips()[1])
    assertEquals(150L, checkout.state.value.tipCents)
    checkout.setPart(400)
    assertTrue(checkout.state.value.isSplit)
    assertEquals(60L, checkout.state.value.tipCents)
    // A part as large as the balance is the whole balance.
    checkout.setPart(5000)
    assertFalse(checkout.state.value.isSplit)
    assertEquals(emptyList(), checkout(ScriptedSaleApi(), PosRegisterSettings()).tips())
  }

  @Test
  fun aSettledSplitLeavesTheRestDueAndResetsTipAndPart() = runTest {
    val api = ScriptedSaleApi(mapOf("cash" to listOf(sale(listOf(payment("c1", "succeeded", "cash", 400)), dueCents = 600))))
    val checkout = checkout(api)
    checkout.setPart(400)
    checkout.payCash(500)
    val state = checkout.state.value
    assertEquals(CheckoutStep.Tender, state.step)
    assertEquals(600L, state.dueCents)
    assertNull(state.partCents)
    assertEquals(NoticeTone.SUCCESS, state.notice?.tone)
    assertEquals("Paid $4.00. $6.00 is left to pay.", state.notice?.message)
    assertEquals(SaleStep.Cash(500, 0, 400), api.calls.single().step)
  }

  @Test
  fun aSettledFullPaymentGoesToTheReceiptWithTheChange() = runTest {
    val api = ScriptedSaleApi(mapOf("cash" to listOf(sale(listOf(payment("c1", "succeeded", "cash", 1000, changeCents = 1000)), dueCents = 0, completed = true))))
    val checkout = checkout(api)
    checkout.payCash(2000)
    assertEquals(CheckoutStep.Receipt(1000), checkout.state.value.step)
    assertFalse(checkout.state.value.canTender)
  }

  @Test
  fun refusesCashShortOfTheAmountWithoutCallingTheServer() = runTest {
    val api = ScriptedSaleApi()
    val checkout = checkout(api)
    checkout.payCash(500)
    assertEquals(NoticeTone.ERROR, checkout.state.value.notice?.tone)
    assertTrue(api.calls.isEmpty())
    assertTrue(checkout.state.value.canTender)
  }

  @Test
  fun aLostAnswerRereadsTheSaleAndBlocksEveryTenderUntilItIsRead() = runTest {
    val api = ScriptedSaleApi(mapOf("sale" to listOf(lost())))
    val checkout = checkout(api)
    val reader = OneShotReader(TenderOutcome.Unknown(LOST_ANSWER))
    checkout.payCard(reader)
    // The automatic re-read failed too: still unknown, and no tender can be pressed.
    assertTrue(checkout.state.value.lost)
    assertFalse(checkout.state.value.canTender)
    assertEquals(listOf("sale"), api.actions)
    checkout.payCard(reader)
    checkout.payCash(5000)
    assertEquals(1, reader.keys.size)
    assertEquals(listOf("sale"), api.actions)
  }

  @Test
  fun aRereadThatFindsTheSalePaidGoesToTheReceipt() = runTest {
    val api = ScriptedSaleApi(mapOf("sale" to listOf(sale(listOf(payment(status = "succeeded")), status = "paid", dueCents = 0, completed = true))))
    val checkout = checkout(api)
    checkout.payCard(OneShotReader(TenderOutcome.Unknown(LOST_ANSWER)))
    assertIs<CheckoutStep.Receipt>(checkout.state.value.step)
    assertFalse(checkout.state.value.lost)
  }

  @Test
  fun aRereadThatFindsTheSaleOpenKeepsTheAttemptKeyForTheSamePress() = runTest {
    val api = ScriptedSaleApi(mapOf("sale" to listOf(sale(emptyList()))))
    val checkout = checkout(api)
    val reader = OneShotReader(TenderOutcome.Unknown(LOST_ANSWER))
    checkout.payCard(reader)
    assertFalse(checkout.state.value.lost)
    assertTrue(checkout.state.value.canTender)
    checkout.payCard(reader)
    // The same press (same reader, amount and tip) finds the payment the first one started.
    assertEquals(listOf("key-1", "key-1"), reader.keys)
  }

  @Test
  fun anAnswerRetiresTheKeySoTheNextPressIsANewAttempt() = runTest {
    val checkout = checkout(ScriptedSaleApi())
    val reader = OneShotReader(TenderOutcome.Canceled(null))
    checkout.payCard(reader)
    assertEquals("The payment was canceled. Nobody was charged.", checkout.state.value.notice?.message)
    checkout.payCard(reader)
    assertEquals(listOf("key-1", "key-2"), reader.keys)
  }

  @Test
  fun chargesTheCardTheAmountAndTheTip() = runTest {
    val checkout = checkout(ScriptedSaleApi())
    checkout.chooseTip(checkout.tips()[2])
    val reader = OneShotReader(TenderOutcome.Failed("Card declined", null))
    checkout.payCard(reader)
    assertEquals(listOf(1000L to 200L), reader.amounts)
    assertEquals(NoticeTone.ERROR, checkout.state.value.notice?.tone)
    assertEquals(CheckoutStep.Tender, checkout.state.value.step)
  }

  @Test
  fun voidsTheSaleAndReportsARefusal() = runTest {
    assertTrue(checkout(ScriptedSaleApi()).void())
    val refusedApi = ScriptedSaleApi(mapOf("void" to listOf(refused("This sale has a payment. Refund it instead.", 409))))
    val checkout = checkout(refusedApi)
    assertFalse(checkout.void())
    assertEquals("This sale has a payment. Refund it instead.", checkout.state.value.notice?.message)
  }

  @Test
  fun sendsTheReceiptAndNeverHoldsTheNextCustomerForNoReceipt() = runTest {
    val api = ScriptedSaleApi(mapOf("receipt" to listOf(lost())))
    val checkout = checkout(api)
    assertTrue(checkout.sendReceipt("none"))
    assertTrue(checkout.sendReceipt("email", " ada@example.test "))
    assertEquals(SaleStep.Receipt("email", "ada@example.test"), api.calls.last().step)
    assertTrue(isReceiptEmail("ada@example.test"))
    assertFalse(isReceiptEmail("ada@"))
    assertTrue(isReceiptPhone("+1 555 123 4567"))
    assertFalse(isReceiptPhone("555"))
  }

  @Test
  fun readsAGiftCardsBalanceBeforeItIsApplied() = runTest {
    val api = ScriptedSaleApi(mapOf("gift-card-balance" to listOf(GiftCardBalance(2500, false, false, "1234"), GiftCardBalance(0, true, false, "1234"))))
    val checkout = checkout(api)
    checkout.checkGiftCard("abcd")
    assertEquals("Available: $25.00", checkout.state.value.giftBalance)
    checkout.checkGiftCard("abcd")
    assertEquals("This card is on hold.", checkout.state.value.giftBalance)
  }

  @Test
  fun aRereadAsksTheProcessorAboutAPaymentStillAtAReaderAndCanStopIt() = runTest {
    val atReader = payment("pay1", "pending", amountCents = 1000)
    val api = ScriptedSaleApi(
      mapOf(
        "sale" to listOf(sale(listOf(atReader), paymentId = null)),
        "status" to listOf(sale(listOf(atReader))),
        "cancel" to listOf(sale(listOf(atReader.copy(status = "canceled")))),
      ),
    )
    val checkout = checkout(api)
    checkout.recheck()
    assertEquals(listOf("sale", "status"), api.actions)
    assertEquals(listOf("pay1"), checkout.state.value.inFlight.map { it.id })
    checkout.cancelPending("pay1")
    assertTrue(checkout.state.value.inFlight.isEmpty())
  }
}
