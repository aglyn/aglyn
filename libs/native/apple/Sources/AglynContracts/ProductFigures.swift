// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * How the console reads a stored product, ported once from
 * libs/plugins/commerce/src/lib/model/commerce.ts, as the Kotlin kit ports
 * it. The liftLegacyProduct, productPriceRange, productInventory and
 * isLowStock cases in function-cases.generated.json are the TypeScript's own
 * answers, and the tests replay every one.
 */

public let commerceSlugMaxLength = 80

/// A URL segment from a name: accents dropped, lower case, runs of anything else a hyphen.
public func commerceSlug(_ name: String) -> String {
  let bare = name.decomposedStringWithCompatibilityMapping
    .replacingOccurrences(of: "[\\u0300-\\u036f]", with: "", options: .regularExpression)
    .lowercased()
    .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
    .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
  return String(bare.prefix(commerceSlugMaxLength))
}

/// A product as the console reads it: one with no variants gets a `default` variant from its price and stock.
public func liftLegacyProduct(_ raw: HostProduct) -> HostProduct {
  if let variants = raw.variants, !variants.isEmpty { return raw }
  var product = raw
  let price = raw.priceUsd.flatMap { $0.isFinite ? $0 : nil } ?? 0
  product.name = raw.name ?? "Product"
  product.slug = (raw.slug?.isEmpty == false ? raw.slug : nil) ?? commerceSlug(raw.name ?? "product")
  product.type = raw.type ?? .physical
  product.status = raw.status ?? .active
  product.variants = [ProductVariant(id: "default", inventory: raw.inventory, priceUsd: price)]
  return product
}

/// The lowest and highest variant price, ignoring a negative one; 0 to 0 with none.
public func productPriceRange(_ product: HostProduct) -> (min: Double, max: Double) {
  let prices = (product.variants ?? []).compactMap(\.priceUsd).filter { $0.isFinite && $0 >= 0 }
  guard let low = prices.min(), let high = prices.max() else { return (0, 0) }
  return (low, high)
}

/// Units across the tracked variants; nil when no variant is tracked.
public func productInventory(_ product: HostProduct) -> Double? {
  let counted = (product.variants ?? []).compactMap(\.inventory)
  return counted.isEmpty ? nil : counted.reduce(0, +)
}

/// At or under the product's low-stock threshold, when it has one and tracks stock.
public func isLowStock(_ product: HostProduct) -> Bool {
  guard let threshold = product.lowStockThreshold, threshold >= 0, let total = productInventory(product) else {
    return false
  }
  return total <= threshold
}
