package com.aglyn.contracts

/*
 * How the console reads a stored product, ported once from
 * libs/plugins/commerce/src/lib/model/commerce.ts. The liftLegacyProduct,
 * productPriceRange, productInventory and isLowStock cases in
 * function-cases.generated.json are the TypeScript's own answers, and the
 * tests replay every one.
 */

const val COMMERCE_SLUG_MAX_LENGTH = 80

/** A URL segment from a name: accents dropped, lower case, runs of anything else a hyphen. */
fun commerceSlug(name: String): String =
  normalizeNfkd(name)
    .replace(Regex("[̀-ͯ]"), "")
    .lowercase()
    .replace(Regex("[^a-z0-9]+"), "-")
    .trim('-')
    .take(COMMERCE_SLUG_MAX_LENGTH)

/** A product as the console reads it: one with no variants gets a `default` variant from its price and stock. */
fun liftLegacyProduct(raw: HostProduct): HostProduct {
  if (!raw.variants.isNullOrEmpty()) return raw
  val price = raw.priceUsd?.takeIf { it.isFinite() } ?: 0.0
  return raw.copy(
    name = raw.name ?: "Product",
    slug = raw.slug?.ifEmpty { null } ?: commerceSlug(raw.name ?: "product"),
    type = raw.type ?: ProductType.PHYSICAL,
    status = raw.status ?: ProductStatus.ACTIVE,
    variants = listOf(ProductVariant(id = "default", priceUsd = price, inventory = raw.inventory)),
  )
}

/** The lowest and highest variant price, ignoring a negative one; 0 to 0 with none. */
fun productPriceRange(product: HostProduct): Pair<Double, Double> {
  val prices = product.variants.orEmpty().mapNotNull { it.priceUsd }.filter { it.isFinite() && it >= 0 }
  return if (prices.isEmpty()) 0.0 to 0.0 else prices.min() to prices.max()
}

/** Units across the tracked variants; null when no variant is tracked. */
fun productInventory(product: HostProduct): Double? =
  product.variants.orEmpty().mapNotNull { it.inventory }.takeIf { it.isNotEmpty() }?.sum()

/** At or under the product's low-stock threshold, when it has one and tracks stock. */
fun isLowStock(product: HostProduct): Boolean {
  val threshold = product.lowStockThreshold ?: return false
  if (!(threshold >= 0)) return false
  val total = productInventory(product) ?: return false
  return total <= threshold
}
