package com.aglyn.contracts

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** The console's commerce-quote-email spec cases, and the send section's words, as the apps read them. */
class QuoteSendRulesTest {
  private fun record(revision: Int, linkVersion: Int, atMs: Double = 1.0, to: String = "jane@example.com") = QuoteSendRecord(
    atMs = atMs, by = "u", linkVersion = linkVersion.toDouble(), messageId = "<m@x>", revision = revision.toDouble(), subject = "s", to = to,
  )

  private fun quote(revision: Int = 1, linkVersion: Int? = null, sends: List<QuoteSendRecord>? = null, email: String = "jane@example.com",
    thread: QuoteEmailThread? = null, proofs: List<QuoteProof>? = null, approval: Boolean? = null, approved: Int? = null) = OrderQuote(
    createdAtMs = 0.0, createdBy = "u", customer = QuoteCustomer(email = email), revision = revision.toDouble(), stage = QuoteStage.SENT,
    tax = QuoteTaxBasis(kind = QuoteTaxKind.NONE), updatedAtMs = 0.0, updatedBy = "u", linkVersion = linkVersion?.toDouble(), sends = sends,
    emailThread = thread, proofs = proofs, requireProofApproval = approval, approvedRevision = approved?.toDouble(),
  )

  private fun order(quote: OrderQuote, lines: Int = 1, status: OrderStatus = OrderStatus.PENDING) = HostOrder(
    channel = OrderChannel.QUOTE, status = status, number = 1042.0, quote = quote,
    lineItems = List(lines) { OrderLineItem(name = "Canopy", productId = "p", quantity = 1.0, unitAmountCents = 1000.0) },
  )

  private fun proof(revision: Int) = QuoteProof(addedAtMs = 0.0, addedBy = "u", contentType = "image/png", id = "p$revision", name = "Proof.png", path = "x", revision = revision.toDouble(), size = 1.0)

  @Test
  fun aNewRevisionReplacesTheLinkOnceAndOnlyOnce() {
    assertFalse(quoteSendReplacesLink(quote()))
    assertFalse(quoteSendReplacesLink(quote(sends = listOf(record(1, 1)))))
    assertTrue(quoteSendReplacesLink(quote(revision = 2, sends = listOf(record(1, 1)))))
    assertTrue(quoteSendReplacesLink(quote(revision = 3, linkVersion = 2, sends = listOf(record(1, 1), record(2, 2)))))
    assertFalse(quoteSendReplacesLink(quote(revision = 2, linkVersion = 2, sends = listOf(record(1, 1)))))
  }

  @Test
  fun theSendButtonSaysWhatItSends() {
    assertEquals("Send quote", quoteSendLabel(quote()))
    assertEquals("Send again", quoteSendLabel(quote(sends = listOf(record(1, 1)))))
    assertEquals("Send revision 2", quoteSendLabel(quote(revision = 2, sends = listOf(record(1, 1)))))
    assertEquals("Send proof", quoteSendLabel(quote(), proofOnly = true))
  }

  @Test
  fun theSubjectKeepsTheConversation() {
    assertEquals("Quote #1042 from Acme Signs", quoteEmailDefaultSubject(order(quote()), "Acme Signs", null))
    assertEquals("Quote #1042", quoteEmailDefaultSubject(order(quote()), "", null))
    assertEquals("Your request", quoteEmailDefaultSubject(order(quote(thread = QuoteEmailThread("<a@b.co>", listOf("<a@b.co>"), "Your request"))), "Acme", null))
    assertEquals("Proof #1042 from Acme", quoteEmailDefaultSubject(order(quote(), lines = 0), "Acme", null))
  }

  @Test
  fun theFormStartsAddressedToTheCustomerElseTheLastSend() {
    assertEquals("jane@example.com", quoteSendPrefill(order(quote(sends = listOf(record(1, 1, to = "buyer@example.org"))))))
    assertEquals("buyer@example.org", quoteSendPrefill(order(quote(email = "", sends = listOf(record(1, 1), record(1, 1, 2.0, "buyer@example.org"))))))
    assertEquals("", quoteSendPrefill(order(quote(email = ""))))
  }

  @Test
  fun theSectionSaysWhenItWasSentAndWhatTheEmailShows() {
    val at = { ms: Double -> "at ${ms.toLong()}" }
    assertEquals("Not sent yet. Email it with your message, the proof and the PDF, or copy the pay link below and send it yourself.", quoteSendStatus(order(quote()), at))
    assertEquals("Sent at 5 to jane@example.com (revision 1).", quoteSendStatus(order(quote(revision = 2, sends = listOf(record(1, 1, 5.0)))), at))
    assertEquals("This quote was paid without being emailed.", quoteSendStatus(order(quote(), status = OrderStatus.PAID), at))
    assertEquals(
      "The email shows the quote number, revision 2 and total, the proof, with the quote attached as a PDF and a button to approve the proof on your site. Replies go to hello@example.com.",
      quoteSendNote(order(quote(revision = 2, proofs = listOf(proof(2)), approval = true)), "hello@example.com"),
    )
    assertEquals(
      "The email shows the quote number, revision 1 and total, with the quote attached as a PDF and a button to pay on your site. Replies go to your email.",
      quoteSendNote(order(quote()), null),
    )
  }

  @Test
  fun approvalBlocksPayOnlyForAProofedRevisionNotYetApproved() {
    assertFalse(quotePaymentBlockedByApproval(quote(approval = true)))
    assertTrue(quotePaymentBlockedByApproval(quote(proofs = listOf(proof(1)), approval = true)))
    assertFalse(quotePaymentBlockedByApproval(quote(proofs = listOf(proof(1)), approval = true, approved = 1)))
    assertEquals(1, quoteLinkVersion(quote()))
    assertEquals(3, quoteLinkVersion(quote(linkVersion = 3)))
  }
}
