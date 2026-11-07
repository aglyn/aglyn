package com.aglyn.contracts

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The quote rules the console's specs hold (commerce-quote-pay, commerce-invoices, use-merchant-payments). */
class QuoteRulesTest {
  private fun quote(tax: QuoteTaxBasis, lines: Int = 1) = HostOrder(
    channel = OrderChannel.QUOTE, status = OrderStatus.PENDING,
    lineItems = List(lines) { OrderLineItem(name = "Canopy", productId = "p", quantity = 1.0, unitAmountCents = 1000.0) },
    quote = OrderQuote(createdAtMs = 0.0, createdBy = "u", customer = QuoteCustomer(), revision = 1.0, stage = QuoteStage.SENT, tax = tax, updatedAtMs = 0.0, updatedBy = "u"),
  )
  private val undecided = QuoteTaxBasis(kind = QuoteTaxKind.NONE, reason = QuoteNoTaxReason.UNDECIDED)

  @Test
  fun aQuoteSavedBeforeTheStoreChoseTakesTheChoiceAsItStandsNow() {
    assertEquals("stored", quotePayTax(quote(undecided).quote, PayLinkStore()).source)
    assertEquals(QuoteTaxKind.AT_PAYMENT, quotePayTax(quote(undecided).quote, payLinkStoreOf(mapOf("mode" to "stripe"))).basis.kind)
    assertEquals("current", quotePayTax(quote(undecided).quote, payLinkStoreOf(mapOf("mode" to "none"))).source)
    assertEquals("save", quotePayTax(quote(undecided).quote, payLinkStoreOf(mapOf("mode" to "manual"))).source)
    assertEquals(QuoteNoTaxReason.PRICES_INCLUDE_TAX, quotePayTax(quote(undecided).quote, payLinkStoreOf(mapOf("mode" to "manual", "pricesIncludeTax" to true))).basis.reason)
    val rate = QuoteTaxBasis(kind = QuoteTaxKind.RATE, pct = 8.0)
    assertEquals("stored", quotePayTax(quote(rate).quote, payLinkStoreOf(mapOf("mode" to "stripe"))).source)
  }

  @Test
  fun theNoticeNamesEachGapOnceBothAnswersAreIn() {
    val sent = quote(undecided)
    assertNull(payLinkGaps(sent, null, PayLinkStore()))
    assertNull(payLinkGaps(sent, true, null))
    assertEquals(listOf(PayLinkGap.PAYMENTS, PayLinkGap.TAX_UNDECIDED), payLinkGaps(sent, false, PayLinkStore()))
    assertEquals(listOf(PayLinkGap.TAX_SAVE), payLinkGaps(sent, true, payLinkStoreOf(mapOf("mode" to "manual"))))
    assertEquals(emptyList(), payLinkGaps(sent, true, payLinkStoreOf(mapOf("mode" to "stripe"))))
    assertEquals(emptyList(), payLinkGaps(quote(undecided, lines = 0), false, PayLinkStore()))
    assertEquals(emptyList(), payLinkGaps(sent.copy(status = OrderStatus.PAID), false, PayLinkStore()))
    assertEquals(listOf(PayLinkGap.PAYMENTS), payLinkGaps(null, false, payLinkStoreOf(mapOf("mode" to "none"))))
  }

  @Test
  fun paymentsReadinessReadsTheOwnersProfile() {
    assertEquals("not-connected", merchantPaymentsStateFromProfile(null, null))
    assertEquals("charges-disabled", merchantPaymentsStateFromProfile(mapOf("stripeAccountId" to "acct_1"), null))
    val connected = mapOf("stripeAccountId" to "acct_1", "stripeChargesEnabled" to true)
    assertEquals("ready", merchantPaymentsStateFromProfile(connected, null))
    assertEquals("mode-unverified", merchantPaymentsStateFromProfile(connected, "live"))
    assertEquals("mode-mismatch", merchantPaymentsStateFromProfile(connected + ("stripeAccountLivemode" to false), "live"))
    assertEquals("ready", merchantPaymentsStateFromProfile(connected + ("stripeAccountLivemode" to true), "live"))
    assertEquals("Connect Stripe to take card payments.", merchantPaymentsBlockedReason("not-connected"))
    assertNull(merchantPaymentsBlockedReason("ready"))
  }

  @Test
  fun eachGapSaysWhatToDo() {
    assertEquals(PayLinkGapLine("Connect Stripe to take card payments.", "Open Payments"), payLinkGapLine(PayLinkGap.PAYMENTS, "Connect Stripe to take card payments.", "quote"))
    assertEquals("Save this quote again to apply the store’s sales tax setting.", payLinkGapLine(PayLinkGap.TAX_SAVE, null, "quote").text)
    assertEquals("Customers can’t pay this quote online yet.", payLinkNoticeTitle("quote"))
  }

  @Test
  fun theLatestAnswerIsTheCurrentRevisions() {
    val responses = listOf(
      QuoteCustomerResponse(action = QuoteCustomerResponseAction.entries.first(), atMs = 1.0, revision = 1.0),
      QuoteCustomerResponse(action = QuoteCustomerResponseAction.entries.first(), atMs = 5.0, revision = 2.0),
    )
    val q = quote(undecided).quote!!.copy(revision = 2.0, responses = responses)
    assertEquals(5.0, latestQuoteResponse(q)?.atMs)
    assertNull(latestQuoteResponse(q.copy(revision = 3.0)))
  }
}
