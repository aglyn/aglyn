package com.aglyn.contracts

import kotlin.math.floor

/*
 * The console's rules for emailing a quote and for its pay link (AGL-4097, AGL-4094), ported once from
 * libs/plugins/commerce/src/lib/model/{commerce-quote-email,commerce-quote-pay,commerce-quote-proofs,commerce-quotes}.ts
 * and components/console/{quote-send,quote-pay-link}.component.tsx, as the Swift kit's QuoteSendRules.swift. Held to the
 * console's own spec cases in QuoteSendRulesTest.
 */

/** The longest subject a send carries (`QUOTE_MAX_SEND_SUBJECT`). */
const val QUOTE_MAX_SEND_SUBJECT = 200

/** The longest message a send carries (`QUOTE_MAX_SEND_MESSAGE`). */
const val QUOTE_MAX_SEND_MESSAGE = 5_000

/** The pay link version the quote is on (`quoteLinkVersion`): 1 until a link is replaced. */
fun quoteLinkVersion(quote: OrderQuote?): Int {
  val raw = quote?.linkVersion ?: return 1
  if (!raw.isFinite()) return 1
  val version = floor(raw).toInt()
  return if (version >= 1) version else 1
}

/** The proofs on the quote's current revision (`currentQuoteProofs`). */
fun currentQuoteProofs(quote: OrderQuote?): List<QuoteProof> {
  val revision = quote?.revision ?: 1.0
  return quote?.proofs.orEmpty().filter { it.revision == revision }
}

/** Whether the customer must approve the current revision's proof before Pay works (`quotePaymentBlockedByApproval`). */
fun quotePaymentBlockedByApproval(quote: OrderQuote?): Boolean {
  if (quote == null || quote.requireProofApproval != true) return false
  if (currentQuoteProofs(quote).isEmpty()) return false
  return quote.approvedRevision != quote.revision
}

/** The last time the quote was emailed, or null (`lastQuoteSend`). */
fun lastQuoteSend(quote: OrderQuote?): QuoteSendRecord? = quote?.sends?.lastOrNull()

/** Whether emailing now hands the customer a new revision of a quote they were already emailed (`quoteSendIsNewRevision`). */
fun quoteSendIsNewRevision(quote: OrderQuote?): Boolean {
  val last = lastQuoteSend(quote) ?: return false
  return last.revision < (quote?.revision ?: 1.0)
}

/** Whether emailing now gives the customer a new pay link (`quoteSendReplacesLink`). */
fun quoteSendReplacesLink(quote: OrderQuote?): Boolean {
  if (!quoteSendIsNewRevision(quote)) return false
  return lastQuoteSend(quote)?.linkVersion?.toInt() == quoteLinkVersion(quote)
}

/** What the Send button says: `Send quote` (`Send proof` for one with no price yet), `Send again`, or `Send revision 2` (`quoteSendLabel`). */
fun quoteSendLabel(quote: OrderQuote?, proofOnly: Boolean = false): String {
  if (lastQuoteSend(quote) == null) return if (proofOnly) "Send proof" else "Send quote"
  return if (quoteSendIsNewRevision(quote)) "Send revision ${jsNumberText(quote?.revision ?: 1.0)}" else "Send again"
}

/** Who the send form starts addressed to: the customer's email, else where it was last emailed (`quoteSendPrefill`). */
fun quoteSendPrefill(order: HostOrder?): String =
  order?.quote?.customer?.email.orEmpty().trim().ifEmpty { lastQuoteSend(order?.quote)?.to.orEmpty().trim() }

/** `Proof #1042` (`formatProofNumber`). */
fun formatProofNumber(order: HostOrder?, docId: String? = null): String {
  val quote = formatQuoteNumber(order, docId)
  return if (quote.startsWith("Quote")) "Proof" + quote.removePrefix("Quote") else quote
}

/** The subject a send defaults to: the conversation's, else `Quote #1042 from Acme Signs` (`quoteEmailDefaultSubject`). */
fun quoteEmailDefaultSubject(order: HostOrder?, businessName: String, quoteId: String?): String {
  val thread = order?.quote?.emailThread?.subject.orEmpty().trim()
  if (thread.isNotEmpty()) return thread
  val name = businessName.trim()
  val number = if (quoteIsProofOnly(order)) formatProofNumber(order, quoteId) else formatQuoteNumber(order, quoteId)
  return if (name.isEmpty()) number else "$number from $name"
}

/** Why a proof only quote can't be sent yet (`quoteSendRefusalMessage('nothing-to-send')`). */
const val QUOTE_NOTHING_TO_SEND_MESSAGE = "This quote has no items and no proof on this revision yet. Add one, then send it."

/**
 * The "Email to customer" line: when it was last sent and to whom, or how to send it (`QuoteSendSection`'s status).
 * [sentAt] formats a time as the console does (`Oct 29, 2026, 3:04 PM`).
 */
fun quoteSendStatus(order: HostOrder?, sentAt: (Double) -> String): String {
  val quote = order?.quote
  val last = lastQuoteSend(quote)
  if (last == null) {
    if (!isUnpaidQuote(order)) return "This quote was paid without being emailed."
    return if (quoteIsProofOnly(order)) "Not sent yet. Email it with your message and the proof, or copy the proof link below and send it yourself."
    else "Not sent yet. Email it with your message, the proof and the PDF, or copy the pay link below and send it yourself."
  }
  val to = last.to.ifEmpty { "the customer" }
  val older = if (last.revision < (quote?.revision ?: 1.0)) " (revision ${jsNumberText(last.revision)})" else ""
  return "Sent ${sentAt(last.atMs)} to $to$older."
}

/** The send form's small print: what the email shows, and where replies go. */
fun quoteSendNote(order: HostOrder?, contact: String?): String {
  val quote = order?.quote
  val revision = jsNumberText(quote?.revision ?: 1.0)
  val replies = "Replies go to ${contact ?: "your email"}."
  if (quoteIsProofOnly(order)) {
    return "The email shows the proof and revision $revision, with no price, and a button to review it on your site. $replies"
  }
  val proofs = if (currentQuoteProofs(quote).isEmpty()) "" else ", the proof"
  val button = if (quotePaymentBlockedByApproval(quote)) "approve the proof" else "pay"
  return "The email shows the quote number, revision $revision and total$proofs, with the quote attached as a PDF " +
    "and a button to $button on your site. $replies"
}

/** The pay link section's words: its name, what it opens, and what it says (`QuotePayLinkSection`). */
data class QuotePayLinkWords(val name: String, val title: String, val opens: String, val explanation: String)

fun quotePayLinkWords(order: HostOrder?): QuotePayLinkWords {
  val proofOnly = quoteIsProofOnly(order)
  val explanation = when {
    proofOnly -> "Send this link to the customer. It opens the proof on your site, with no prices, where they can approve it or reject it with changes. Only someone with the link can open it."
    isUnpaidQuote(order) -> "Send this link to the customer. It opens the quote on your site, where they can pay it."
    else -> "The link opens the paid quote and the customer’s order."
  }
  return QuotePayLinkWords(
    if (proofOnly) "proof link" else "pay link", if (proofOnly) "Proof link" else "Pay link", if (proofOnly) "proof" else "quote", explanation,
  )
}
