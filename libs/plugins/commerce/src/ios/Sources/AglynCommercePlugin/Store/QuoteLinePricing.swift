// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

// A quote's product line priced as the console's editor and the server price it (AGL-4093): the variant's price plus
// the chosen add-ons, as the register prices one (`priceQuoteCatalogLine` in commerce-quotes.ts). It reuses the
// register's modifier rules (POS/Modifiers.swift), as the Kotlin kit's QuoteLinePricing.kt does.

/// A priced line, or why the line can't be priced yet.
enum PricedQuoteLine: Equatable {
  case ok(OrderLineItem)
  case refused(String)
}

/// The product's groups, or none when they are missing or malformed (`productModifierGroups`).
func productModifierGroups(_ product: HostProduct?) -> [ProductModifierGroup] {
  guard let groups = product?.modifierGroups else { return [] }
  return modifierGroupsProblem(groups) == nil ? groups : []
}

/// Whether a group must be answered before the line can be priced (`modifierGroupRequired`).
func modifierGroupRequired(_ group: ProductModifierGroup) -> Bool { group.min > 0 }

/// An add-on as the editor's menu names it: `Back wall (+$150.00)`; a free one is its name alone
/// (`quoteModifierOptionLabel`).
func quoteModifierOptionLabel(_ option: ProductModifierOption, variantID: String?) -> String {
  let cents = modifierOptionPriceCents(option, variantID: variantID)
  return cents != 0 ? "\(option.name) (+\(formatOrderMoney(cents)))" : option.name
}

/// A product line priced from the PRODUCT (`priceQuoteCatalogLine`). An included line keeps what it is and charges
/// nothing.
func priceQuoteCatalogLine(
  _ rawProduct: HostProduct?, productID: String, variantID: String?, quantity: Double, modifiers: [ModifierSelection],
  included: Bool, description: String?
) -> PricedQuoteLine {
  guard let rawProduct else {
    return .refused("A product on this quote no longer exists. Remove it and add it again.")
  }
  let product = liftLegacyProduct(rawProduct)
  let name = product.name ?? ""
  let variants = product.variants ?? []
  let variant =
    (variantID?.isEmpty == false) ? variants.first { $0.id == variantID } : variants.first
  guard let variant else { return .refused("Choose an option of \(name) that still exists.") }
  let price = variant.priceUsd
  if !included, !(price.map { $0.isFinite && $0 >= 0 } ?? false) {
    return .refused("Set a price for \(name) before quoting it.")
  }
  switch resolveLineModifiers(name, productModifierGroups(product), modifiers, variantID: variant.id) {
  case .refused(let error): return .refused(error)
  case .ok(let chosen, let extraCents):
    // Firestore hands a map's keys back sorted, so the values are read in key order, as the register reads them.
    let options = variant.options ?? [:]
    let variantLabel = options.isEmpty ? nil : options.keys.sorted().compactMap { options[$0] }.joined(separator: " / ")
    let label = lineLabelWithModifiers(variantLabel, chosen.map(\.name))
    let unitCents = included ? 0 : ((price ?? 0) * 100 + 0.5).rounded(.down) + Double(extraCents)
    return .ok(
      OrderLineItem(
        description: description?.isEmpty == false ? description : nil,
        included: included ? true : nil,
        modifiers: chosen.isEmpty
          ? nil
          : chosen.map {
            OrderLineModifier(
              group: $0.group, groupId: $0.groupID, name: $0.name, optionId: $0.optionID, priceCents: Double($0.priceCents))
          },
        name: name, productId: productID, productType: product.type ?? .physical, quantity: quantity,
        sku: variant.sku?.isEmpty == false ? variant.sku : nil, taxExempt: product.taxExempt == true ? true : nil,
        unitAmountCents: unitCents, variantId: variant.id == "default" ? nil : variant.id,
        variantLabel: label.isEmpty ? nil : label))
  }
}
