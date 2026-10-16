package com.aglyn.contracts

/*
 * What the marketplace's seller panel says about money, ported once from libs/plugins/marketplace/src/lib/model
 * (seller-ledger-totals.ts, payout-readiness.ts). The cases in function-cases.generated.json are the TypeScript's own answers,
 * and SellerRulesCasesTest replays every one.
 */

/** JavaScript's truthiness for a plain value: not null, false, 0, NaN or empty text. */
private fun truthy(value: Any?): Boolean = when (value) {
  null -> false
  is Boolean -> value
  is Number -> value.toDouble().let { !it.isNaN() && it != 0.0 }
  is String -> value.isNotEmpty()
  else -> true
}

/** What the seller's sales add up to. Cents are numbers as the ledger holds them, so a stored string counts as the number it reads as. */
data class SellerLedgerTotals(
  /** Sales still standing. */
  val paidCount: Int,
  /** Refunded or charged back. */
  val refundedCount: Int,
  /** What Stripe was asked to move to the publisher's Connect account, net of any pull-back: not what reached their bank. */
  val sentToStripeCents: Double,
  /** Tax-inclusive gross on the sales still standing. */
  val buyersPaidCents: Double,
  /** Tax on those sales: the platform's remittance liability, never the seller's. */
  val salesTaxCents: Double,
  /** Platform fee on those sales. */
  val platformFeeCents: Double,
  /** Pulled back out of the publisher's account on the refunded ones. */
  val returnedCents: Double,
)

private fun field(sale: Map<String, Any?>, key: String): Double = if (sale[key] == null) 0.0 else jsNumber(sale[key])

private fun transferOf(sale: Map<String, Any?>): Double =
  if (sale["transferCents"] != null) jsNumber(sale["transferCents"]) else field(sale, "amountCents") - field(sale, "feeCents")

/** `summarizeSellerLedger`: the totals over a seller's purchase records; a record that is not a number adds nothing. */
fun summarizeSellerLedger(sales: List<Map<String, Any?>>?): SellerLedgerTotals {
  val all = sales.orEmpty()
  val paid = all.filter { !truthy(it["refundedAt"]) }
  val refunded = all.filter { truthy(it["refundedAt"]) }
  fun sum(rows: List<Map<String, Any?>>, of: (Map<String, Any?>) -> Double): Double =
    rows.fold(0.0) { total, sale -> total + of(sale).let { if (it.isNaN() || it == 0.0) 0.0 else it } }
  return SellerLedgerTotals(
    paidCount = paid.size,
    refundedCount = refunded.size,
    sentToStripeCents = sum(paid) { transferOf(it) - field(it, "reversedTransferCents") - field(it, "partialReversedTransferCents") },
    buyersPaidCents = sum(paid) { field(it, "amountCents") },
    salesTaxCents = sum(paid) { field(it, "taxCents") },
    platformFeeCents = sum(paid) { field(it, "feeCents") },
    returnedCents = sum(refunded) { field(it, "reversedTransferCents") + field(it, "partialReversedTransferCents") },
  )
}

/** Where a publisher's payouts stand, as the Payouts card words it (`PayoutReadiness`). */
enum class PayoutReadiness(val wire: String) {
  /** Still reading the profile: say nothing about payouts. */
  PENDING("pending"),

  /** The read failed: say nothing about payouts, this is not "off". */
  ERROR("error"),

  /** No Stripe account can take charges yet: the call to action. */
  DISCONNECTED("disconnected"),

  /** Charges on, payout readiness never recorded: not a problem report. */
  UNKNOWN("unknown"),

  /** Charges on, payouts explicitly not enabled: the stranded-funds state. */
  BLOCKED("blocked"),

  /** Charges on, but which Stripe mode the account belongs to was never recorded, so no checkout will charge against it. */
  UNVERIFIED("unverified"),

  /** Charges on and payouts on: the only state that may claim success. */
  READY("ready"),
}

/** `payoutReadiness`: [state] is the profile load (`pending`, `error` or `loaded`); the rest are the profile's Stripe fields as stored. */
fun payoutReadiness(state: String, chargesEnabled: Any?, payoutsEnabled: Any?, accountLivemode: Any?): PayoutReadiness {
  if (state != "loaded") return if (state == "error") PayoutReadiness.ERROR else PayoutReadiness.PENDING
  if (chargesEnabled != true) return PayoutReadiness.DISCONNECTED
  // Only a literal boolean counts as recorded, the same three-valued reading the server gate uses.
  if (accountLivemode !is Boolean) return PayoutReadiness.UNVERIFIED
  if (payoutsEnabled == true) return PayoutReadiness.READY
  if (payoutsEnabled == false) return PayoutReadiness.BLOCKED
  return PayoutReadiness.UNKNOWN
}

/** A publisher handle: three to thirty lowercase letters, digits and hyphens, starting with a letter or digit. */
private val HANDLE_PATTERN = Regex("^[a-z0-9][a-z0-9-]{2,29}$")

fun isPublisherHandle(handle: String): Boolean = HANDLE_PATTERN.matches(handle)
