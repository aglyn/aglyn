// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// The console's quote editor rules (AGL-4093): a quote's totals as it is edited, the tax its ship-to gives it under the
// store's own settings, a typed line priced, and the request a stored line is edited as. Ported once from
// libs/plugins/commerce/src/lib/model/{commerce-quotes,commerce-tax,commerce-tax-engine}.ts, as the Kotlin kit's
// QuoteEditorRules.kt. function-cases.generated.json holds the TypeScript's answers for the commerce-quotes ones,
// and the tests replay them.

private func jsRound(_ value: Double) -> Double { (value + 0.5).rounded(.down) }

/// A positive whole number, else 0 (the console's `whole`).
private func whole(_ value: Double?) -> Double {
  let number = jsRound(value ?? 0)
  return number.isFinite && number > 0 ? number : 0
}

/// A line as the totals read it.
public struct QuoteTotalsLine: Equatable, Sendable {
  public var unitAmountCents: Double
  public var quantity: Double
  public var included: Bool
  public var taxExempt: Bool
  public init(unitAmountCents: Double, quantity: Double, included: Bool = false, taxExempt: Bool = false) {
    self.unitAmountCents = unitAmountCents
    self.quantity = quantity
    self.included = included
    self.taxExempt = taxExempt
  }
}

public func quoteTotalsLine(_ line: OrderLineItem) -> QuoteTotalsLine {
  QuoteTotalsLine(
    unitAmountCents: line.unitAmountCents, quantity: line.quantity, included: line.included == true,
    taxExempt: line.taxExempt == true)
}

/// A quote's totals: the order's, plus what the tax was computed on.
public struct QuoteTotals: Equatable, Sendable {
  public let itemsCents: Double
  public let discountCents: Double
  public let shippingCents: Double
  public let taxCents: Double
  public let totalCents: Double
  public let taxableCents: Double
  /// Stripe Tax works the tax out when the customer pays; `taxCents` is 0 until then.
  public let taxAtPayment: Bool
}

/// One line's charge: nothing for an included line.
public func quoteLineCents(_ line: QuoteTotalsLine) -> Double {
  line.included ? 0 : whole(line.unitAmountCents) * whole(line.quantity)
}

/// The discount in cents on `itemsCents`, never more than it.
public func quoteDiscountCents(_ itemsCents: Double, discount: QuoteDiscount?) -> Double {
  let items = whole(itemsCents)
  guard let discount else { return 0 }
  switch discount.kind {
  case .amount: return min(items, whole(discount.amountCents))
  case .percent:
    let raw = discount.pct.flatMap { $0.isNaN ? nil : $0 } ?? 0
    let pct = min(100, max(0, raw))
    return min(items, jsRound(items * pct / 100))
  default: return 0
  }
}

/// Splits `totalCents` across `weights` in proportion, whole cents, largest remainders first (`allocateCentsByWeight`).
public func allocateCentsByWeight(_ totalCents: Double, weights: [Double]) -> [Double] {
  let total = max(0, jsRound(totalCents.isFinite ? totalCents : 0))
  let clean = weights.map { $0.isFinite && $0 > 0 ? $0 : 0 }
  let sum = clean.reduce(0, +)
  if sum <= 0 || total == 0 { return clean.map { _ in 0 } }
  let raw = clean.map { total * $0 / sum }
  var parts = raw.map { $0.rounded(.down) }
  var left = total - parts.reduce(0, +)
  struct Share {
    let index: Int
    let remainder: Double
  }
  var shares: [Share] = []
  for (index, value) in raw.enumerated() where clean[index] > 0 {
    shares.append(Share(index: index, remainder: value - value.rounded(.down)))
  }
  let order = shares.sorted { a, b in a.remainder != b.remainder ? a.remainder > b.remainder : a.index < b.index }
  var i = 0
  while left > 0, !order.isEmpty {
    parts[order[i].index] += 1
    left -= 1
    i = (i + 1) % order.count
  }
  return parts
}

/// Tax cents on a taxable amount at a percentage, on top of the price (`computeTaxCents`, exclusive pricing).
public func computeTaxCents(_ taxableCents: Double, pct: Double) -> Double {
  !(pct > 0) || !(taxableCents > 0) ? 0 : jsRound(taxableCents * pct / 100)
}

/// A quote's totals (`computeQuoteTotals`). The discount comes off before tax; a store rate taxes the taxable lines
/// (not shipping); a tax service's answer is taken as given; Stripe Tax and no-tax add nothing now.
public func computeQuoteTotals(
  _ lines: [QuoteTotalsLine], discount: QuoteDiscount?, shippingCents: Double?, tax: QuoteTaxBasis
) -> QuoteTotals {
  let gross = lines.map(quoteLineCents)
  let itemsCents = gross.reduce(0, +)
  let totalDiscount = quoteDiscountCents(itemsCents, discount: discount)
  let shares = allocateCentsByWeight(totalDiscount, weights: gross)
  let taxableCents = gross.indices.reduce(0.0) { sum, index in
    sum + (lines[index].taxExempt ? 0 : gross[index] - shares[index])
  }
  let shipping = whole(shippingCents)
  let taxCents: Double
  switch tax.kind {
  case .rate: taxCents = computeTaxCents(taxableCents, pct: tax.pct ?? 0)
  case .service: taxCents = whole(tax.taxCents)
  default: taxCents = 0
  }
  return QuoteTotals(
    itemsCents: itemsCents, discountCents: totalDiscount, shippingCents: shipping, taxCents: taxCents,
    totalCents: itemsCents - totalDiscount + shipping + taxCents, taxableCents: taxableCents,
    taxAtPayment: tax.kind == .atPayment)
}

/// One of the store's own tax rates (`TaxRate`).
public struct StoreTaxRate: Equatable, Sendable {
  public let country: String
  public let state: String?
  public let pct: Double
  public let label: String?
}

/// The store's sales tax settings, as `hosts/{hostId}/settings/store` keeps them under `tax` (`TaxSettings`).
public struct StoreTaxSettings: Equatable, Sendable {
  public var mode: String?
  public var pricesIncludeTax: Bool
  public var originCountry: String?
  public var originState: String?
  public var rates: [StoreTaxRate]
}

/// The settings from the store document's `tax` map; nil for none.
public func storeTaxSettingsOf(_ tax: [String: Any]?) -> StoreTaxSettings? {
  guard let tax else { return nil }
  let origin = tax["origin"] as? [String: Any]
  let rates: [StoreTaxRate] = ((tax["rates"] as? [Any]) ?? []).compactMap { raw in
    guard let rate = raw as? [String: Any], let country = rate["country"] as? String else { return nil }
    return StoreTaxRate(
      country: country, state: rate["state"] as? String, pct: (rate["pct"] as? NSNumber)?.doubleValue ?? 0,
      label: rate["label"] as? String)
  }
  return StoreTaxSettings(
    mode: tax["mode"] as? String, pricesIncludeTax: tax["pricesIncludeTax"] as? Bool == true,
    originCountry: origin?["country"] as? String, originState: origin?["state"] as? String, rates: rates)
}

/// The most specific of the store's rates for an address, or nil (`resolveTaxRate`).
public func resolveTaxRate(_ settings: StoreTaxSettings?, country: String?, state: String?) -> StoreTaxRate? {
  guard let settings, settings.mode != "stripe" else { return nil }
  let wantCountry = (country ?? "").uppercased()
  let wantState = (state ?? "").uppercased()
  if wantCountry.isEmpty { return nil }
  var match: StoreTaxRate?
  for rate in settings.rates where rate.country.uppercased() == wantCountry {
    if let rateState = rate.state, !rateState.isEmpty {
      if rateState.uppercased() == wantState { return rate }
      continue
    }
    if match == nil { match = rate }
  }
  return match
}

/// The tax basis the store's own settings give a quote (`quoteTaxBasisFromSettings`): Stripe Tax at payment, no tax
/// (and why), or the store's rate for where it ships: its ship-to when it has a country, else the store's own address.
public func quoteTaxBasisFromSettings(_ settings: StoreTaxSettings?, shipToCountry: String?, shipToState: String?)
  -> QuoteTaxBasis
{
  switch settings?.mode {
  case "stripe": return QuoteTaxBasis(kind: .atPayment)
  case "manual": break
  case "none": return QuoteTaxBasis(kind: .none, reason: .notCollected)
  default: return QuoteTaxBasis(kind: .none, reason: .undecided)
  }
  guard let settings else { return QuoteTaxBasis(kind: .none, reason: .undecided) }
  if settings.pricesIncludeTax { return QuoteTaxBasis(kind: .none, reason: .pricesIncludeTax) }
  let shipsSomewhere = !(shipToCountry ?? "").trimmingCharacters(in: .whitespaces).isEmpty
  let rate =
    shipsSomewhere
    ? resolveTaxRate(settings, country: shipToCountry, state: shipToState)
    : resolveTaxRate(settings, country: settings.originCountry, state: settings.originState)
  guard let rate, rate.pct > 0 else { return QuoteTaxBasis(kind: .none, reason: .noRate) }
  return QuoteTaxBasis(kind: .rate, label: rate.label.flatMap { $0.isEmpty ? nil : $0 }, pct: rate.pct)
}

/// Whether new quotes start out asking the customer to approve the proof first.
public func quoteRequiresProofApprovalByDefault(_ quotes: [String: Any]?) -> Bool {
  quotes?["requireProofApproval"] as? Bool == true
}

/// Whether new quotes start out asking a customer with a site account to sign in for the proof (AGL-4206).
public func quoteRequiresProofSignInByDefault(_ quotes: [String: Any]?) -> Bool {
  quotes?["requireProofSignIn"] as? Bool == true
}

/// A line as the editor sends it (`QuoteLineRequest`): what it is, never what a product costs.
public enum QuoteLineRequest: Equatable, Sendable {
  case catalog(
    productId: String, variantId: String?, quantity: Double, modifiers: [ModifierSelection], included: Bool,
    description: String?)
  case custom(
    name: String, description: String?, sku: String?, unitAmountCents: Double, quantity: Double, ships: Bool,
    included: Bool)
}

private func nonEmpty(_ text: String?) -> String? { text.flatMap { $0.isEmpty ? nil : $0 } }

/// The request a stored line is edited as (`quoteLineRequestFromLine`).
public func quoteLineRequestFromLine(_ line: OrderLineItem) -> QuoteLineRequest {
  if line.custom == true || line.productId.isEmpty {
    return .custom(
      name: line.name, description: nonEmpty(line.description), sku: nonEmpty(line.sku),
      unitAmountCents: line.unitAmountCents, quantity: line.quantity,
      ships: line.productType != .service && line.productType != .digital, included: line.included == true)
  }
  return .catalog(
    productId: line.productId, variantId: nonEmpty(line.variantId), quantity: line.quantity,
    modifiers: (line.modifiers ?? []).map { ModifierSelection(groupId: $0.groupId, optionId: $0.optionId) },
    included: line.included == true, description: nonEmpty(line.description))
}

/// A typed line priced (`priceQuoteCustomLine`): no product, so nothing reads stock, a supplier or a download for it.
public func priceQuoteCustomLine(
  name: String, description: String?, sku: String?, unitAmountCents: Double, quantity: Double, ships: Bool,
  included: Bool
) -> OrderLineItem {
  OrderLineItem(
    custom: true, description: nonEmpty(description), included: included ? true : nil, name: name, productId: "",
    productType: ships ? .physical : .service, quantity: quantity, sku: nonEmpty(sku),
    unitAmountCents: included ? 0 : unitAmountCents)
}
