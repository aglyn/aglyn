// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The console's rules for emailing a quote and for its pay link (AGL-4097, AGL-4094), ported once from
// libs/plugins/commerce/src/lib/model/{commerce-quote-email,commerce-quote-pay,commerce-quote-proofs,commerce-quotes}.ts
// and components/console/{quote-send,quote-pay-link}.component.tsx, as the Kotlin kit's QuoteSendRules.kt. Held to the
// console's own spec cases in QuoteSendRulesTests.

/// The longest subject a send carries (`QUOTE_MAX_SEND_SUBJECT`).
public let quoteMaxSendSubject = 200
/// The longest message a send carries (`QUOTE_MAX_SEND_MESSAGE`).
public let quoteMaxSendMessage = 5_000

/// The pay link version the quote is on (`quoteLinkVersion`): 1 until a link is replaced.
public func quoteLinkVersion(_ quote: OrderQuote?) -> Int {
  guard let raw = quote?.linkVersion, raw.isFinite else { return 1 }
  let version = Int(raw.rounded(.down))
  return version >= 1 ? version : 1
}

/// The proofs on the quote's current revision (`currentQuoteProofs`).
public func currentQuoteProofs(_ quote: OrderQuote?) -> [QuoteProof] {
  let revision = quote?.revision ?? 1
  return (quote?.proofs ?? []).filter { $0.revision == revision }
}

/// Whether the customer must approve the current revision's proof before Pay works (`quotePaymentBlockedByApproval`).
public func quotePaymentBlockedByApproval(_ quote: OrderQuote?) -> Bool {
  guard let quote, quote.requireProofApproval == true else { return false }
  guard !currentQuoteProofs(quote).isEmpty else { return false }
  return quote.approvedRevision != quote.revision
}

/// The last time the quote was emailed, or nil (`lastQuoteSend`).
public func lastQuoteSend(_ quote: OrderQuote?) -> QuoteSendRecord? { quote?.sends?.last }

/// Whether emailing now hands the customer a new revision of a quote they were already emailed
/// (`quoteSendIsNewRevision`).
public func quoteSendIsNewRevision(_ quote: OrderQuote?) -> Bool {
  guard let last = lastQuoteSend(quote) else { return false }
  return last.revision < (quote?.revision ?? 1)
}

/// Whether emailing now gives the customer a new pay link (`quoteSendReplacesLink`).
public func quoteSendReplacesLink(_ quote: OrderQuote?) -> Bool {
  guard quoteSendIsNewRevision(quote), let last = lastQuoteSend(quote) else { return false }
  return Int(last.linkVersion) == quoteLinkVersion(quote)
}

/// What the Send button says: `Send quote` (`Send proof` for one with no price yet), `Send again`, or
/// `Send revision 2` (`quoteSendLabel`).
public func quoteSendLabel(_ quote: OrderQuote?, proofOnly: Bool = false) -> String {
  if lastQuoteSend(quote) == nil { return proofOnly ? "Send proof" : "Send quote" }
  return quoteSendIsNewRevision(quote) ? "Send revision \(jsNumberText(quote?.revision ?? 1))" : "Send again"
}

/// Who the send form starts addressed to: the customer's email, else where it was last emailed (`quoteSendPrefill`).
public func quoteSendPrefill(_ order: HostOrder?) -> String {
  let email = (order?.quote?.customer.email ?? "").trimmingCharacters(in: .whitespaces)
  if !email.isEmpty { return email }
  return (lastQuoteSend(order?.quote)?.to ?? "").trimmingCharacters(in: .whitespaces)
}

/// `Proof #1042` (`formatProofNumber`).
public func formatProofNumber(_ order: HostOrder?, docId: String? = nil) -> String {
  let quote = formatQuoteNumber(order, docId: docId)
  return quote.hasPrefix("Quote") ? "Proof" + quote.dropFirst("Quote".count) : quote
}

/// The subject a send defaults to: the conversation's, else `Quote #1042 from Acme Signs` (`quoteEmailDefaultSubject`).
public func quoteEmailDefaultSubject(_ order: HostOrder?, businessName: String, quoteId: String?) -> String {
  let thread = (order?.quote?.emailThread?.subject ?? "").trimmingCharacters(in: .whitespaces)
  if !thread.isEmpty { return thread }
  let name = businessName.trimmingCharacters(in: .whitespaces)
  let number = quoteIsProofOnly(order) ? formatProofNumber(order, docId: quoteId) : formatQuoteNumber(order, docId: quoteId)
  return name.isEmpty ? number : "\(number) from \(name)"
}

/// Why a proof only quote can't be sent yet (`quoteSendRefusalMessage('nothing-to-send')`).
public let quoteNothingToSendMessage = "This quote has no items and no proof on this revision yet. Add one, then send it."

/// The "Email to customer" line: when it was last sent and to whom, or how to send it (`QuoteSendSection`'s status).
/// `sentAt` formats a time as the console does (`Oct 29, 2026, 3:04 PM`).
public func quoteSendStatus(_ order: HostOrder?, sentAt: (Double) -> String) -> String {
  let quote = order?.quote
  let proofOnly = quoteIsProofOnly(order)
  let unpaid = isUnpaidQuote(order)
  guard let last = lastQuoteSend(quote) else {
    if !unpaid { return "This quote was paid without being emailed." }
    return proofOnly
      ? "Not sent yet. Email it with your message and the proof, or copy the proof link below and send it yourself."
      : "Not sent yet. Email it with your message, the proof and the PDF, or copy the pay link below and send it yourself."
  }
  let to = last.to.isEmpty ? "the customer" : last.to
  let revision = quote?.revision ?? 1
  let older = last.revision < revision ? " (revision \(jsNumberText(last.revision)))" : ""
  return "Sent \(sentAt(last.atMs)) to \(to)\(older)."
}

/// The send form's small print: what the email shows, and where replies go.
public func quoteSendNote(_ order: HostOrder?, contact: String?) -> String {
  let quote = order?.quote
  let revision = jsNumberText(quote?.revision ?? 1)
  let replies = "Replies go to \(contact ?? "your email")."
  if quoteIsProofOnly(order) {
    return "The email shows the proof and revision \(revision), with no price, and a button to review it on your site. "
      + replies
  }
  let proofs = currentQuoteProofs(quote).isEmpty ? "" : ", the proof"
  let button = quotePaymentBlockedByApproval(quote) ? "approve the proof" : "pay"
  return "The email shows the quote number, revision \(revision) and total\(proofs), with the quote attached as a PDF "
    + "and a button to \(button) on your site. " + replies
}

/// The pay link section's words: its name, what it opens, and what it says (`QuotePayLinkSection`). A proof only quote's
/// link opens the proof.
public struct QuotePayLinkWords: Equatable, Sendable {
  public let name: String
  public let title: String
  public let opens: String
  public let explanation: String
}

public func quotePayLinkWords(_ order: HostOrder?) -> QuotePayLinkWords {
  let proofOnly = quoteIsProofOnly(order)
  let explanation =
    proofOnly
    ? "Send this link to the customer. It opens the proof on your site, with no prices, where they can approve it or reject it with changes. Only someone with the link can open it."
    : isUnpaidQuote(order)
      ? "Send this link to the customer. It opens the quote on your site, where they can pay it."
      : "The link opens the paid quote and the customer’s order."
  return QuotePayLinkWords(
    name: proofOnly ? "proof link" : "pay link", title: proofOnly ? "Proof link" : "Pay link",
    opens: proofOnly ? "proof" : "quote", explanation: explanation)
}

/// The longest reply a quote's conversation takes (`QUOTE_MESSAGE_MAX`).
public let quoteMessageMax = 5_000

/// Who a reply from the quote goes to: the customer's email, else where it was last emailed (`quoteReplyRecipient`).
public func quoteReplyRecipient(_ order: HostOrder?) -> String { quoteSendPrefill(order) }

/// Why the business can't reply to the quote's customer now, as the console says it (`quoteReplyRefusal` and
/// `quoteReplyRefusalMessage`); nil when it can. A paid quote still takes replies.
public func quoteReplyRefusal(_ order: HostOrder?) -> String? {
  guard let order, order.channel == .quote, order.quote != nil else { return "Unknown quote" }
  let to = quoteReplyRecipient(order)
  if to.isEmpty {
    return "This quote has no customer email, so there is nobody to reply to. Add their email to the quote first."
  }
  if to.count > 320 || to.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) == nil {
    return "The customer email on this quote isn’t a valid address. Fix it on the quote first."
  }
  return nil
}
