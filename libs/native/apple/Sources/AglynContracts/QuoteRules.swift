// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The console's quote rules for the apps' Quotes list and quote view (AGL-4093, AGL-4162), ported once from
// libs/plugins/commerce/src/lib/model/{commerce-quotes,commerce-quote-pay,commerce-quote-proofs,commerce-invoices,
// commerce-tax-decision,commerce-tax-engine}.ts and libs/tenant/feature/instance/src/lib/hooks/use-merchant-payments.ts,
// as the Kotlin kit's QuoteRules.kt. function-cases.generated.json holds the TypeScript's answers for the
// commerce-quotes ones, and the tests replay them; the others are held to the console's own spec cases.

/// `Quote #1042`; an order number until it is paid.
public func formatQuoteNumber(_ order: HostOrder?, docId: String? = nil) -> String {
  if let number = order?.number { return "Quote #\(jsNumberText(number))" }
  if let docId, !docId.isEmpty { return "Quote #\(String(docId.suffix(6)).uppercased())" }
  return "Quote"
}

/// Whether an order document is a quote nobody has paid yet, which no order list counts.
public func isUnpaidQuote(_ order: HostOrder?) -> Bool { order?.channel == .quote && order?.status == .pending }

/// A quote with no lines: it shows its customer a proof to answer and no price (AGL-4184). Only a stored quote says this.
public func quoteIsProofOnly(_ order: HostOrder?) -> Bool { order?.lineItems?.isEmpty == true }

/// The console's words for each stage (`QUOTE_STAGE_LABELS`).
public let quoteStageLabels: [QuoteStage: String] = [
  .draft: "Draft", .sent: "Sent", .changesRequested: "Rejected with changes", .approved: "Approved",
]

/// A quote's status as its list shows it: its stage until it is paid. `key` is the stage's raw value, or paid,
/// cancelled, refunded.
public struct QuoteDisplayStatus: Equatable, Sendable {
  public let key: String
  public let label: String
}

public func quoteDisplayStatus(_ order: HostOrder?) -> QuoteDisplayStatus {
  let status = order?.status
  if status == .cancelled { return QuoteDisplayStatus(key: "cancelled", label: "Canceled") }
  if status == .refunded { return QuoteDisplayStatus(key: "refunded", label: "Refunded") }
  if let status, status != .pending, status != .unknown { return QuoteDisplayStatus(key: "paid", label: "Paid") }
  let stored = order?.quote?.stage
  let stage = stored == nil || stored == .unknown ? QuoteStage.draft : stored!
  return QuoteDisplayStatus(key: stage.rawValue, label: quoteStageLabels[stage] ?? "Draft")
}

/// The status chip's color (`QUOTE_STATUS_COLOR`): default, info, warning, success or error.
public func quoteStatusColor(_ key: String) -> String {
  switch key {
  case "sent", "approved": "info"
  case "changes_requested": "warning"
  case "paid": "success"
  case "refunded": "error"
  default: "default"
  }
}

/// The customer's latest answer to the current revision, if they gave one.
public func latestQuoteResponse(_ quote: OrderQuote?) -> QuoteCustomerResponse? {
  let revision = quote?.revision ?? 1
  return (quote?.responses ?? []).last { $0.revision == revision }
}

/// The store's sales tax choice, as `hosts/{hostId}/settings/store` keeps it under `tax`.
public struct PayLinkStore: Equatable, Sendable {
  public var taxMode: String?
  public var pricesIncludeTax: Bool?
  public init(taxMode: String? = nil, pricesIncludeTax: Bool? = nil) {
    self.taxMode = taxMode
    self.pricesIncludeTax = pricesIncludeTax
  }
}

/// The store a pay link reads, from the settings document's `tax` map (nothing, for no document).
public func payLinkStoreOf(_ tax: [String: Any]?) -> PayLinkStore {
  PayLinkStore(taxMode: tax?["mode"] as? String, pricesIncludeTax: tax?["pricesIncludeTax"] as? Bool)
}

/// `storefrontTaxDecision`'s kind for the store: stripe-automatic, manual, none or undecided.
public func storefrontTaxDecisionKind(_ store: PayLinkStore) -> String {
  switch store.taxMode {
  case "stripe": "stripe-automatic"
  case "manual": "manual"
  case "none": "none"
  default: "undecided"
  }
}

/// Whether the store's tax settings let an outside service price its sales (`storeTaxAllowsEngine`).
public func storeTaxAllowsEngine(_ store: PayLinkStore) -> Bool { store.taxMode == "manual" && store.pricesIncludeTax != true }

/// Where a quote's tax comes from when it is shown and paid (`QuotePayTaxSource`): stored, current or save.
public struct QuotePayTax: Equatable, Sendable {
  public let basis: QuoteTaxBasis
  public let source: String
}

/// The tax a quote is shown, charged and paid under (`quotePayTax`, AGL-4162). A quote keeps the basis it was saved
/// with, except one saved before the store chose how it handles sales tax, which takes the choice as it stands now; on
/// the store's own rates on prices that exclude tax only a save prices it.
public func quotePayTax(_ quote: OrderQuote?, store: PayLinkStore?) -> QuotePayTax {
  let stored = quote?.tax ?? QuoteTaxBasis(kind: .none, reason: .notCollected)
  let undecided = stored.kind == .none && stored.reason == .undecided
  guard let store, undecided else { return QuotePayTax(basis: stored, source: "stored") }
  let decision = storefrontTaxDecisionKind(store)
  if decision == "undecided" { return QuotePayTax(basis: stored, source: "stored") }
  if storeTaxAllowsEngine(store) { return QuotePayTax(basis: stored, source: "save") }
  // `quoteTaxBasisFromSettings` for the choices that reach here: Stripe Tax, none, or prices that include tax.
  let basis: QuoteTaxBasis =
    decision == "stripe-automatic"
    ? QuoteTaxBasis(kind: .atPayment)
    : decision != "manual" ? QuoteTaxBasis(kind: .none, reason: .notCollected) : QuoteTaxBasis(kind: .none, reason: .pricesIncludeTax)
  return QuotePayTax(basis: basis, source: "current")
}

/// What stands between a pay link and a payment that the business fixes (`PayLinkGap`).
public enum PayLinkGap: String, Sendable {
  case payments, taxUndecided = "tax-undecided", taxSave = "tax-save"
}

/// What the "Customers can't pay this … online yet" notice names (`payLinkGaps`), for an unpaid quote (nil: a quote
/// not saved yet). Nil while either answer is unknown; empty for anything the pay link does not charge or nothing
/// stands in front of.
public func payLinkGaps(_ order: HostOrder?, paymentsReady: Bool?, store: PayLinkStore?) -> [PayLinkGap]? {
  guard let paymentsReady, let store else { return nil }
  if let order {
    let linked = order.channel == .quote ? order.quote != nil : order.channel == .draft
    if order.status != .pending || !linked { return [] }
    if order.quote != nil, quoteIsProofOnly(order) { return [] }
  }
  var gaps: [PayLinkGap] = []
  if !paymentsReady { gaps.append(.payments) }
  if storefrontTaxDecisionKind(store) == "undecided" {
    gaps.append(.taxUndecided)
  } else if let quote = order?.quote, quotePayTax(quote, store: store).source == "save" {
    gaps.append(.taxSave)
  }
  return gaps
}

/// The notice's first line: `Customers can’t pay this quote online yet.`
public func payLinkNoticeTitle(_ noun: String) -> String { "Customers can’t pay this \(noun) online yet." }

/// Card-payment readiness from the workspace owner's profile (`merchantPaymentsStateFromProfile`): not-connected,
/// charges-disabled, mode-mismatch, mode-unverified or ready. `platformMode` is the deployment's Stripe key mode, live
/// or test; nil when unknown, as the console reads a missing key.
public func merchantPaymentsStateFromProfile(_ profile: [String: Any]?, platformMode: String?) -> String {
  let accountID = (profile?["stripeAccountId"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
  if accountID.isEmpty { return "not-connected" }
  if profile?["stripeChargesEnabled"] as? Bool != true { return "charges-disabled" }
  if let livemode = profile?["stripeAccountLivemode"] as? Bool {
    guard let platformMode else { return "ready" }
    return livemode == (platformMode == "live") ? "ready" : "mode-mismatch"
  }
  return platformMode == "live" ? "mode-unverified" : "ready"
}

/// Why the workspace can't take card payments (`merchantPaymentsBlockedReason`), or nil.
public func merchantPaymentsBlockedReason(_ state: String) -> String? {
  switch state {
  case "not-connected": "Connect Stripe to take card payments."
  case "charges-disabled":
    "Finish setting up Stripe to take card payments: Stripe has not turned on charges for this account yet."
  case "mode-mismatch", "mode-unverified":
    "Reconnect Stripe to take card payments: the connected account has not been confirmed for live payments."
  default: nil
  }
}

/// What the notice says about one gap, and the button that fixes it (`payLinkGapLine`).
public struct PayLinkGapLine: Equatable, Sendable {
  public let text: String
  public let action: String?
}

public func payLinkGapLine(_ gap: PayLinkGap, paymentsReason: String?, noun: String) -> PayLinkGapLine {
  switch gap {
  case .payments:
    PayLinkGapLine(text: paymentsReason ?? "Connect a payment account to take card payments.", action: "Open Payments")
  case .taxUndecided: PayLinkGapLine(text: "Choose how this store handles sales tax.", action: "Open Taxes")
  case .taxSave:
    PayLinkGapLine(
      text: "\(noun == "quote" ? "Save this quote" : "Save the quote") again to apply the store’s sales tax setting.",
      action: nil)
  }
}
