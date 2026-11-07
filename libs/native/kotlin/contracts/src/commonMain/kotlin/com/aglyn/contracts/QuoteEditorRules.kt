package com.aglyn.contracts

import kotlin.math.floor

/*
 * The console's quote editor rules (AGL-4093): a quote's totals as it is edited, the tax its ship-to gives it under the
 * store's own settings, a typed line priced, and the request a stored line is edited as. Ported once from
 * libs/plugins/commerce/src/lib/model/{commerce-quotes,commerce-tax,commerce-tax-engine}.ts, as the Swift kit's
 * QuoteEditorRules.swift. function-cases.generated.json holds the TypeScript's answers for the commerce-quotes ones,
 * and the tests replay them.
 */

private fun jsRound(value: Double): Double = floor(value + 0.5)

/** A positive whole number, else 0 (the console's `whole`). */
private fun whole(value: Double?): Double {
  val number = jsRound(value ?: 0.0)
  return if (number.isFinite() && number > 0) number else 0.0
}

/** A line as the totals read it. */
data class QuoteTotalsLine(
  val unitAmountCents: Double,
  val quantity: Double,
  val included: Boolean = false,
  val taxExempt: Boolean = false,
)

fun quoteTotalsLineOf(line: OrderLineItem): QuoteTotalsLine =
  QuoteTotalsLine(line.unitAmountCents, line.quantity, line.included == true, line.taxExempt == true)

/** A quote's totals: the order's, plus what the tax was computed on. */
data class QuoteTotals(
  val itemsCents: Double,
  val discountCents: Double,
  val shippingCents: Double,
  val taxCents: Double,
  val totalCents: Double,
  val taxableCents: Double,
  /** Stripe Tax works the tax out when the customer pays; `taxCents` is 0 until then. */
  val taxAtPayment: Boolean,
)

/** One line's charge: nothing for an included line. */
fun quoteLineCents(line: QuoteTotalsLine): Double = if (line.included) 0.0 else whole(line.unitAmountCents) * whole(line.quantity)

/** The discount in cents on `itemsCents`, never more than it. */
fun quoteDiscountCents(itemsCents: Double, discount: QuoteDiscount?): Double {
  val items = whole(itemsCents)
  if (discount == null) return 0.0
  return when (discount.kind) {
    QuoteDiscountKind.AMOUNT -> minOf(items, whole(discount.amountCents))
    QuoteDiscountKind.PERCENT -> {
      val pct = minOf(100.0, maxOf(0.0, discount.pct?.takeIf { !it.isNaN() } ?: 0.0))
      minOf(items, jsRound(items * pct / 100))
    }
    else -> 0.0
  }
}

/** Splits `totalCents` across `weights` in proportion, whole cents, largest remainders first (`allocateCentsByWeight`). */
fun allocateCentsByWeight(totalCents: Double, weights: List<Double>): List<Double> {
  val total = maxOf(0.0, jsRound(if (totalCents.isFinite()) totalCents else 0.0))
  val clean = weights.map { if (it.isFinite() && it > 0) it else 0.0 }
  val sum = clean.sum()
  if (sum <= 0 || total == 0.0) return clean.map { 0.0 }
  val raw = clean.map { total * it / sum }
  val parts = raw.map { floor(it) }.toMutableList()
  var left = total - parts.sum()
  val order = raw.mapIndexed { index, value -> index to (value - floor(value)) }
    .filter { (index, _) -> clean[index] > 0 }
    .sortedWith(compareByDescending<Pair<Int, Double>> { it.second }.thenBy { it.first })
  var i = 0
  while (left > 0 && order.isNotEmpty()) {
    parts[order[i].first] += 1.0
    left -= 1
    i = (i + 1) % order.size
  }
  return parts
}

/** Tax cents on a taxable amount at a percentage, on top of the price (`computeTaxCents`, exclusive pricing). */
fun computeTaxCents(taxableCents: Double, pct: Double): Double =
  if (!(pct > 0) || !(taxableCents > 0)) 0.0 else jsRound(taxableCents * pct / 100)

/**
 * A quote's totals (`computeQuoteTotals`). The discount comes off before tax; a store rate taxes the taxable lines
 * (not shipping); a tax service's answer is taken as given; Stripe Tax and no-tax add nothing now.
 */
fun computeQuoteTotals(lines: List<QuoteTotalsLine>, discount: QuoteDiscount?, shippingCents: Double?, tax: QuoteTaxBasis): QuoteTotals {
  val gross = lines.map(::quoteLineCents)
  val itemsCents = gross.sum()
  val totalDiscount = quoteDiscountCents(itemsCents, discount)
  val shares = allocateCentsByWeight(totalDiscount, gross)
  val taxableCents = gross.indices.sumOf { if (lines[it].taxExempt) 0.0 else gross[it] - shares[it] }
  val shipping = whole(shippingCents)
  val taxCents = when (tax.kind) {
    QuoteTaxKind.RATE -> computeTaxCents(taxableCents, tax.pct ?: 0.0)
    QuoteTaxKind.SERVICE -> whole(tax.taxCents)
    else -> 0.0
  }
  return QuoteTotals(
    itemsCents = itemsCents,
    discountCents = totalDiscount,
    shippingCents = shipping,
    taxCents = taxCents,
    totalCents = itemsCents - totalDiscount + shipping + taxCents,
    taxableCents = taxableCents,
    taxAtPayment = tax.kind == QuoteTaxKind.AT_PAYMENT,
  )
}

/** One of the store's own tax rates (`TaxRate`). */
data class StoreTaxRate(val country: String, val state: String? = null, val pct: Double, val label: String? = null)

/** The store's sales tax settings, as `hosts/{hostId}/settings/store` keeps them under `tax` (`TaxSettings`). */
data class StoreTaxSettings(
  val mode: String? = null,
  val pricesIncludeTax: Boolean = false,
  val originCountry: String? = null,
  val originState: String? = null,
  val rates: List<StoreTaxRate> = emptyList(),
)

/** The settings from the store document's `tax` map; null for none. */
fun storeTaxSettingsOf(tax: Map<String, Any?>?): StoreTaxSettings? {
  if (tax == null) return null
  val origin = tax["origin"] as? Map<*, *>
  val rates = (tax["rates"] as? List<*>).orEmpty().mapNotNull { raw ->
    val rate = raw as? Map<*, *> ?: return@mapNotNull null
    val country = rate["country"] as? String ?: return@mapNotNull null
    StoreTaxRate(country, rate["state"] as? String, (rate["pct"] as? Number)?.toDouble() ?: 0.0, rate["label"] as? String)
  }
  return StoreTaxSettings(tax["mode"] as? String, tax["pricesIncludeTax"] == true, origin?.get("country") as? String, origin?.get("state") as? String, rates)
}

/** The most specific of the store's rates for an address, or null (`resolveTaxRate`). */
fun resolveTaxRate(settings: StoreTaxSettings?, country: String?, state: String?): StoreTaxRate? {
  if (settings == null || settings.mode == "stripe") return null
  val wantCountry = country.orEmpty().uppercase()
  val wantState = state.orEmpty().uppercase()
  if (wantCountry.isEmpty()) return null
  var match: StoreTaxRate? = null
  for (rate in settings.rates) {
    if (rate.country.uppercase() != wantCountry) continue
    if (!rate.state.isNullOrEmpty()) {
      if (rate.state.uppercase() == wantState) return rate
      continue
    }
    if (match == null) match = rate
  }
  return match
}

/**
 * The tax basis the store's own settings give a quote (`quoteTaxBasisFromSettings`): Stripe Tax at payment, no tax
 * (and why), or the store's rate for where it ships: its ship-to when it has a country, else the store's own address.
 */
fun quoteTaxBasisFromSettings(settings: StoreTaxSettings?, shipToCountry: String?, shipToState: String?): QuoteTaxBasis {
  when (settings?.mode) {
    "stripe" -> return QuoteTaxBasis(kind = QuoteTaxKind.AT_PAYMENT)
    "manual" -> Unit
    "none" -> return QuoteTaxBasis(kind = QuoteTaxKind.NONE, reason = QuoteNoTaxReason.NOT_COLLECTED)
    else -> return QuoteTaxBasis(kind = QuoteTaxKind.NONE, reason = QuoteNoTaxReason.UNDECIDED)
  }
  if (settings.pricesIncludeTax) return QuoteTaxBasis(kind = QuoteTaxKind.NONE, reason = QuoteNoTaxReason.PRICES_INCLUDE_TAX)
  val rate = if (shipToCountry.orEmpty().trim().isNotEmpty()) resolveTaxRate(settings, shipToCountry, shipToState)
  else resolveTaxRate(settings, settings.originCountry, settings.originState)
  if (rate == null || !(rate.pct > 0)) return QuoteTaxBasis(kind = QuoteTaxKind.NONE, reason = QuoteNoTaxReason.NO_RATE)
  return QuoteTaxBasis(kind = QuoteTaxKind.RATE, pct = rate.pct, label = rate.label?.takeIf { it.isNotEmpty() })
}

/** Whether new quotes start out asking the customer to approve the proof first. */
fun quoteRequiresProofApprovalByDefault(quotes: Map<String, Any?>?): Boolean = quotes?.get("requireProofApproval") == true

/** Whether new quotes start out asking a customer with a site account to sign in for the proof (AGL-4206). */
fun quoteRequiresProofSignInByDefault(quotes: Map<String, Any?>?): Boolean = quotes?.get("requireProofSignIn") == true

/** A line as the editor sends it (`QuoteLineRequest`): what it is, never what a product costs. */
sealed class QuoteLineRequest {
  abstract val quantity: Double
  abstract val included: Boolean
  abstract val description: String?

  data class Catalog(
    val productId: String,
    val variantId: String? = null,
    override val quantity: Double,
    val modifiers: List<ModifierSelection> = emptyList(),
    override val included: Boolean = false,
    override val description: String? = null,
  ) : QuoteLineRequest()

  data class Custom(
    val name: String,
    override val description: String? = null,
    val sku: String? = null,
    val unitAmountCents: Double,
    override val quantity: Double,
    val ships: Boolean = true,
    override val included: Boolean = false,
  ) : QuoteLineRequest()
}

/** The request a stored line is edited as (`quoteLineRequestFromLine`). */
fun quoteLineRequestFromLine(line: OrderLineItem): QuoteLineRequest =
  if (line.custom == true || line.productId.isEmpty()) {
    QuoteLineRequest.Custom(
      name = line.name,
      description = line.description?.takeIf { it.isNotEmpty() },
      sku = line.sku?.takeIf { it.isNotEmpty() },
      unitAmountCents = line.unitAmountCents,
      quantity = line.quantity,
      ships = line.productType != ProductType.SERVICE && line.productType != ProductType.DIGITAL,
      included = line.included == true,
    )
  } else {
    QuoteLineRequest.Catalog(
      productId = line.productId,
      variantId = line.variantId?.takeIf { it.isNotEmpty() },
      quantity = line.quantity,
      modifiers = line.modifiers.orEmpty().map { ModifierSelection(groupId = it.groupId, optionId = it.optionId) },
      included = line.included == true,
      description = line.description?.takeIf { it.isNotEmpty() },
    )
  }

/** A typed line priced (`priceQuoteCustomLine`): no product, so nothing reads stock, a supplier or a download for it. */
fun priceQuoteCustomLine(request: QuoteLineRequest.Custom): OrderLineItem = OrderLineItem(
  productId = "",
  custom = true,
  name = request.name,
  sku = request.sku?.takeIf { it.isNotEmpty() },
  productType = if (request.ships) ProductType.PHYSICAL else ProductType.SERVICE,
  quantity = request.quantity,
  unitAmountCents = if (request.included) 0.0 else request.unitAmountCents,
  included = if (request.included) true else null,
  description = request.description?.takeIf { it.isNotEmpty() },
)
