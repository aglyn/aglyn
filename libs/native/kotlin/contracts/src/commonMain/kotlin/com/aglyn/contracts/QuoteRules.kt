package com.aglyn.contracts

/*
 * The console's quote rules for the apps' Quotes list and quote view (AGL-4093, AGL-4162), ported once from
 * libs/plugins/commerce/src/lib/model/{commerce-quotes,commerce-quote-pay,commerce-quote-proofs,commerce-invoices,
 * commerce-tax-decision,commerce-tax-engine}.ts and libs/tenant/feature/instance/src/lib/hooks/use-merchant-payments.ts.
 * function-cases.generated.json holds the TypeScript's answers for the commerce-quotes ones, and the tests replay them;
 * the others are held to the console's own spec cases.
 */

/** `Quote #1042`; an order number until it is paid. */
fun formatQuoteNumber(order: HostOrder?, docId: String? = null): String {
  val number = order?.number
  if (number != null) return "Quote #${number.toLong()}"
  return if (!docId.isNullOrEmpty()) "Quote #${docId.takeLast(6).uppercase()}" else "Quote"
}

/** Whether an order document is a quote nobody has paid yet, which no order list counts. */
fun isUnpaidQuote(order: HostOrder?): Boolean = order?.channel == OrderChannel.QUOTE && order.status == OrderStatus.PENDING

/** A quote with no lines: it shows its customer a proof to answer and no price (AGL-4184). Only a stored quote says this. */
fun quoteIsProofOnly(order: HostOrder?): Boolean = order?.lineItems?.isEmpty() == true

/** The console's words for each stage (`QUOTE_STAGE_LABELS`). */
val QUOTE_STAGE_LABELS: Map<QuoteStage, String> = mapOf(
  QuoteStage.DRAFT to "Draft",
  QuoteStage.SENT to "Sent",
  QuoteStage.CHANGES_REQUESTED to "Rejected with changes",
  QuoteStage.APPROVED to "Approved",
)

/** A quote's status as its list shows it: its stage until it is paid. `key` is the stage's raw value, or paid, cancelled, refunded. */
data class QuoteDisplayStatus(val key: String, val label: String)

fun quoteDisplayStatus(order: HostOrder?): QuoteDisplayStatus {
  val status = order?.status
  if (status == OrderStatus.CANCELLED) return QuoteDisplayStatus("cancelled", "Canceled")
  if (status == OrderStatus.REFUNDED) return QuoteDisplayStatus("refunded", "Refunded")
  if (status != null && status != OrderStatus.PENDING && status != OrderStatus.UNKNOWN) return QuoteDisplayStatus("paid", "Paid")
  val stage = order?.quote?.stage?.takeIf { it != QuoteStage.UNKNOWN } ?: QuoteStage.DRAFT
  return QuoteDisplayStatus(stage.raw, QUOTE_STAGE_LABELS[stage] ?: "Draft")
}

/** The status chip's color (`QUOTE_STATUS_COLOR`): default, info, warning, success or error. */
fun quoteStatusColor(key: String): String = when (key) {
  "sent", "approved" -> "info"
  "changes_requested" -> "warning"
  "paid" -> "success"
  "refunded" -> "error"
  else -> "default"
}

/** The customer's latest answer to the current revision, if they gave one. */
fun latestQuoteResponse(quote: OrderQuote?): QuoteCustomerResponse? {
  val revision = quote?.revision ?: 1.0
  return quote?.responses.orEmpty().lastOrNull { it.revision == revision }
}

/** The store's sales tax choice, as `hosts/{hostId}/settings/store` keeps it under `tax`: its mode and whether prices include tax. Null when it has not chosen. */
data class PayLinkStore(val taxMode: String? = null, val pricesIncludeTax: Boolean? = null, val hasTax: Boolean = false)

/** The store a pay link reads, from the settings document's `tax` map (nothing, for no document). */
fun payLinkStoreOf(tax: Map<String, Any?>?): PayLinkStore =
  if (tax == null) PayLinkStore() else PayLinkStore(tax["mode"] as? String, tax["pricesIncludeTax"] as? Boolean, hasTax = true)

/** `storefrontTaxDecision`'s kind for the store: stripe-automatic, manual, none or undecided. */
fun storefrontTaxDecisionKind(store: PayLinkStore): String = when (store.taxMode) {
  "stripe" -> "stripe-automatic"
  "manual" -> "manual"
  "none" -> "none"
  else -> "undecided"
}

/** Whether the store's tax settings let an outside service price its sales (`storeTaxAllowsEngine`). */
fun storeTaxAllowsEngine(store: PayLinkStore): Boolean = store.taxMode == "manual" && store.pricesIncludeTax != true

/** Where a quote's tax comes from when it is shown and paid (`QuotePayTaxSource`): stored, current or save. */
data class QuotePayTax(val basis: QuoteTaxBasis, val source: String)

/**
 * The tax a quote is shown, charged and paid under (`quotePayTax`, AGL-4162). A quote keeps the basis it was saved
 * with, except one saved before the store chose how it handles sales tax, which takes the choice as it stands now; on
 * the store's own rates on prices that exclude tax only a save prices it.
 */
fun quotePayTax(quote: OrderQuote?, store: PayLinkStore?): QuotePayTax {
  val stored = quote?.tax ?: QuoteTaxBasis(kind = QuoteTaxKind.NONE, reason = QuoteNoTaxReason.NOT_COLLECTED)
  val undecided = stored.kind == QuoteTaxKind.NONE && stored.reason == QuoteNoTaxReason.UNDECIDED
  if (store == null || !undecided) return QuotePayTax(stored, "stored")
  val decision = storefrontTaxDecisionKind(store)
  if (decision == "undecided") return QuotePayTax(stored, "stored")
  if (storeTaxAllowsEngine(store)) return QuotePayTax(stored, "save")
  // `quoteTaxBasisFromSettings` for the choices that reach here: Stripe Tax, none, or prices that include tax.
  val basis = when {
    decision == "stripe-automatic" -> QuoteTaxBasis(kind = QuoteTaxKind.AT_PAYMENT)
    decision != "manual" -> QuoteTaxBasis(kind = QuoteTaxKind.NONE, reason = QuoteNoTaxReason.NOT_COLLECTED)
    else -> QuoteTaxBasis(kind = QuoteTaxKind.NONE, reason = QuoteNoTaxReason.PRICES_INCLUDE_TAX)
  }
  return QuotePayTax(basis, "current")
}

/** What stands between a pay link and a payment that the business fixes (`PayLinkGap`). */
enum class PayLinkGap(val raw: String) { PAYMENTS("payments"), TAX_UNDECIDED("tax-undecided"), TAX_SAVE("tax-save") }

/**
 * What the "Customers can't pay this … online yet" notice names (`payLinkGaps`), for an unpaid quote (null: a quote not
 * saved yet). Null while either answer is unknown; empty for anything the pay link does not charge or nothing stands
 * in front of.
 */
fun payLinkGaps(order: HostOrder?, paymentsReady: Boolean?, store: PayLinkStore?): List<PayLinkGap>? {
  if (paymentsReady == null || store == null) return null
  if (order != null) {
    val linked = if (order.channel == OrderChannel.QUOTE) order.quote != null else order.channel == OrderChannel.DRAFT
    if (order.status != OrderStatus.PENDING || !linked) return emptyList()
    if (order.quote != null && quoteIsProofOnly(order)) return emptyList()
  }
  val gaps = mutableListOf<PayLinkGap>()
  if (!paymentsReady) gaps += PayLinkGap.PAYMENTS
  if (storefrontTaxDecisionKind(store) == "undecided") gaps += PayLinkGap.TAX_UNDECIDED
  else if (order?.quote != null && quotePayTax(order.quote, store).source == "save") gaps += PayLinkGap.TAX_SAVE
  return gaps
}

/** The notice's first line: `Customers can’t pay this quote online yet.` */
fun payLinkNoticeTitle(noun: String): String = "Customers can’t pay this $noun online yet."

/**
 * Card-payment readiness from the workspace owner's profile (`merchantPaymentsStateFromProfile`): not-connected,
 * charges-disabled, mode-mismatch, mode-unverified or ready. `platformMode` is the deployment's Stripe key mode, live
 * or test; null when unknown, as the console reads a missing key.
 */
fun merchantPaymentsStateFromProfile(profile: Map<String, Any?>?, platformMode: String?): String {
  val accountId = (profile?.get("stripeAccountId") as? String)?.trim().orEmpty()
  if (accountId.isEmpty()) return "not-connected"
  if (profile?.get("stripeChargesEnabled") != true) return "charges-disabled"
  val livemode = profile["stripeAccountLivemode"] as? Boolean
  if (livemode != null) {
    if (platformMode == null) return "ready"
    return if (livemode == (platformMode == "live")) "ready" else "mode-mismatch"
  }
  return if (platformMode == "live") "mode-unverified" else "ready"
}

/** Why the workspace can't take card payments (`merchantPaymentsBlockedReason`), or null. */
fun merchantPaymentsBlockedReason(state: String): String? = when (state) {
  "not-connected" -> "Connect Stripe to take card payments."
  "charges-disabled" -> "Finish setting up Stripe to take card payments: Stripe has not turned on charges for this account yet."
  "mode-mismatch", "mode-unverified" -> "Reconnect Stripe to take card payments: the connected account has not been confirmed for live payments."
  else -> null
}

/** What the notice says about one gap, and the button that fixes it (`payLinkGapLine`). */
data class PayLinkGapLine(val text: String, val action: String?)

fun payLinkGapLine(gap: PayLinkGap, paymentsReason: String?, noun: String): PayLinkGapLine = when (gap) {
  PayLinkGap.PAYMENTS -> PayLinkGapLine(paymentsReason ?: "Connect a payment account to take card payments.", "Open Payments")
  PayLinkGap.TAX_UNDECIDED -> PayLinkGapLine("Choose how this store handles sales tax.", "Open Taxes")
  PayLinkGap.TAX_SAVE -> PayLinkGapLine("${if (noun == "quote") "Save this quote" else "Save the quote"} again to apply the store’s sales tax setting.", null)
}
