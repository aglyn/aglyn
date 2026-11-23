package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ReceiptData
import com.aglyn.contracts.ReceiptLine
import com.aglyn.contracts.ReceiptTender
import com.aglyn.hardware.CardNotApprovedNotification
import com.aglyn.hardware.renderText
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A card reader that declines every card it was waiting for, as Apple's tests' `DecliningReader`. */
private class DecliningReader(private val waits: Boolean = true) : CardReaderService {
  override val id = "ttp"
  override val label = "Card reader"
  override val kind = CardReaderKind.DEVICE

  override suspend fun charge(deps: TenderDeps, amountCents: Long, tipCents: Long, attemptKey: String, onWaiting: (String?) -> Unit): TenderOutcome {
    if (waits) onWaiting("pay1")
    return TenderOutcome.Failed("The card was declined.", null)
  }

  override suspend fun cancel(deps: TenderDeps, paymentId: String?) = Unit
}

private fun taxed() = PosOpenedSale("o1", 1000, 0, 80, 1080, 1080, emptyList())

/** The console's receipt fixture, as Apple's ReceiptTests use it. */
private val FIXTURE = ReceiptData(
  storeName = "Corner Café",
  storeLines = listOf("12 Main St, Springfield"),
  orderNumber = "1042",
  orderId = "order1",
  createdAtMs = 1791317040000.0,
  timeZone = "America/Chicago",
  registerName = "Front counter",
  currency = "usd",
  lines = listOf(ReceiptLine(detail = "Oat milk", name = "Latte", quantity = 2.0, totalCents = 900.0, unitCents = 450.0)),
  subtotalCents = 1625.0,
  discountCents = 100.0,
  taxCents = 126.0,
  totalCents = 1651.0,
  tenders = listOf(ReceiptTender(amountCents = 2000.0, label = "Cash")),
  changeCents = 349.0,
  barcode = "1042",
)

/** Aglyn POS on Android ends a declined card on "Not paid", as on Apple (Figma iPhone POS 177:5163, Apple 5.9 to 5.12). */
class DeclinedCardTest {
  @Test
  fun aDeclinedCardKeepsItsReceiptAndTellsTheCashierWhenAway() = runTest {
    val checkout = Checkout(ScriptedSaleApi(), taxed(), PosRegisterSettings(), sleep = noSleep, now = { 1791317040000 })
    val told = mutableListOf<String>()
    checkout.onCardNotApproved = { told += it }
    checkout.payCard(DecliningReader())
    assertEquals(listOf("$10.80"), told)
    val declined = checkout.state.value.declined!!
    assertEquals(1080L, declined.amountCents)
    val receipt = declined.receipt("Juniper Street Bakery", { money(it, "usd") })
    assertTrue(receipt.startsWith("Juniper Street Bakery\n"))
    assertTrue(receipt.contains("Card payment not approved"))
    assertTrue(receipt.contains("Amount: $10.80"))
    assertTrue(receipt.contains("Taken on: Card reader"))
    assertTrue(receipt.endsWith("Nothing was charged."))
  }

  @Test
  fun aDeclinedCardShowsAsNotPaidUntilTheCashierTakesThePaymentAnotherWay() = runTest {
    val checkout = Checkout(ScriptedSaleApi(), taxed(), PosRegisterSettings(), sleep = noSleep)
    checkout.payCard(DecliningReader())
    val state = checkout.state.value
    assertTrue(state.showsDeclined)
    assertNull(state.notice, "the declined card's own notice replaces the processor's words")
    assertEquals("Card declined. Nothing was charged. Send the customer a receipt, or take the payment another way.", state.declined?.notice)
    checkout.takePaymentAnotherWay()
    assertFalse(checkout.state.value.showsDeclined)
    assertNull(checkout.state.value.declined)
    assertTrue(checkout.state.value.canTender)
  }

  /** A refusal before the reader waited for a card (an amount that does not match) is not a declined card. */
  @Test
  fun aRefusalBeforeTheCardKeepsItsOwnNotice() = runTest {
    val checkout = Checkout(ScriptedSaleApi(), taxed(), PosRegisterSettings(), sleep = noSleep)
    var told = 0
    checkout.onCardNotApproved = { told += 1 }
    checkout.payCard(DecliningReader(waits = false))
    assertFalse(checkout.state.value.showsDeclined)
    assertEquals(Notice(NoticeTone.ERROR, "The card was declined."), checkout.state.value.notice)
    assertEquals(0, told)
  }

  @Test
  fun theNextTenderClearsTheDeclinedCard() = runTest {
    val checkout = Checkout(ScriptedSaleApi(), taxed(), PosRegisterSettings(), sleep = noSleep)
    checkout.payCard(DecliningReader())
    checkout.takePaymentAnotherWay()
    checkout.payCard(DecliningReader(waits = false))
    assertNull(checkout.state.value.declined)
  }

  @Test
  fun aDeclinedCardIsNamedByItsBrandAndLastFour() {
    val failed = payment(status = "failed", amountCents = 2479, cardBrand = "visa", last4 = "4242", failureMessage = "Your card was declined.")
    assertEquals("Visa •••• 4242", declinedCardLabel(failed))
    val card = DeclinedCard(2479, "Tap to Pay", "x", 0, cardLabel = "Visa •••• 4242")
    assertEquals("Card declined: Visa •••• 4242. Nothing was charged. Send the customer a receipt, or take the payment another way.", card.notice)
    assertTrue(card.receipt("S", { money(it, "usd") }).contains("Card: Visa •••• 4242"))
    assertNull(declinedCardLabel(null))
    assertNull(declinedCardLabel(payment(status = "failed")))
  }

  @Test
  fun aDeclinedCardsReceiptHasNothingPaidAndSaysDeclinedUnderTheTotal() {
    val text = renderText(layoutDeclinedReceipt(FIXTURE, "Visa •••• 4242", ReceiptLayoutOptions(columns = 48)))
    val lines = text.split("\n")
    val total = lines.indexOfFirst { it.startsWith("TOTAL") && it.endsWith("$16.51") }
    assertTrue(total > 0, text)
    assertEquals(listOf("", "Visa **** 4242                          DECLINED", "Nothing was charged.", "", "                     [1042]"), lines.subList(total + 1, total + 6))
    assertFalse(text.contains("Cash"), "a declined sale's receipt shows nothing paid")
    assertFalse(text.contains("Change"))
    assertTrue(renderText(layoutDeclinedReceipt(FIXTURE, null, ReceiptLayoutOptions(columns = 32))).contains("Card"))
  }

  /** Apple 5.9: a payment that timed out says so on its receipt, never DECLINED. */
  @Test
  fun aTimedOutPaymentsReceiptSaysTimedOut() {
    val text = renderText(layoutDeclinedReceipt(FIXTURE, "Visa •••• 4242", ReceiptLayoutOptions(columns = 48), timedOut = true))
    val line = text.split("\n").first { it.startsWith("Visa **** 4242") }
    assertTrue(line.endsWith("TIMED OUT") && line.length == 48, line)
    assertFalse(text.contains("DECLINED"))
    assertTrue(text.contains("Nothing was charged."))
  }

  /** Apple 5.12: the words of the notification for a card not approved while the app was away. */
  @Test
  fun theCardNotApprovedNotificationSaysWhatWasNotCharged() {
    val note = CardNotApprovedNotification("$24.79", "Front counter")
    assertEquals("Card not approved", note.title)
    assertEquals("$24.79 at Front counter was not charged. Open the sale to take the payment another way.", note.body)
    assertEquals("$5.00 was not charged. Open the sale to take the payment another way.", CardNotApprovedNotification("$5.00", null).body)
  }
}
