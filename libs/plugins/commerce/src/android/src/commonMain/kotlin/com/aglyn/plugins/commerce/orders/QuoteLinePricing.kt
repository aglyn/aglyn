package com.aglyn.plugins.commerce.orders

import com.aglyn.contracts.HostProduct
import com.aglyn.contracts.OrderLineItem
import com.aglyn.contracts.OrderLineModifier
import com.aglyn.contracts.ProductModifierGroup
import com.aglyn.contracts.ProductModifierOption
import com.aglyn.contracts.ProductType
import com.aglyn.contracts.QuoteLineRequest
import com.aglyn.contracts.formatOrderMoney
import com.aglyn.contracts.liftLegacyProduct
import com.aglyn.plugins.commerce.pos.ResolvedModifiers
import com.aglyn.plugins.commerce.pos.lineLabelWithModifiers
import com.aglyn.plugins.commerce.pos.modifierGroupsProblem
import com.aglyn.plugins.commerce.pos.modifierOptionPriceCents
import com.aglyn.plugins.commerce.pos.resolveLineModifiers

/*
 * A quote's product line priced as the console's editor and the server price it (AGL-4093): the variant's price plus
 * the chosen add-ons, as the register prices one (`priceQuoteCatalogLine` in commerce-quotes.ts). It lives beside the
 * register's modifier rules, which it reuses.
 */

/** A priced line, or why the line can't be priced yet. */
sealed interface PricedQuoteLine {
  data class Ok(val line: OrderLineItem) : PricedQuoteLine
  data class Refused(val error: String) : PricedQuoteLine
}

/** The product's groups, or none when they are missing or malformed (`productModifierGroups`). */
fun productModifierGroups(product: HostProduct?): List<ProductModifierGroup> {
  val groups = product?.modifierGroups ?: return emptyList()
  return if (modifierGroupsProblem(groups) != null) emptyList() else groups
}

/** Whether a group must be answered before the line can be priced (`modifierGroupRequired`). */
fun modifierGroupRequired(group: ProductModifierGroup): Boolean = group.min > 0

/** An add-on as the editor's menu names it: `Back wall (+$150.00)`; a free one is its name alone (`quoteModifierOptionLabel`). */
fun quoteModifierOptionLabel(option: ProductModifierOption, variantId: String?): String {
  val cents = modifierOptionPriceCents(option, variantId)
  return if (cents != 0L) "${option.name} (+${formatOrderMoney(cents.toDouble())})" else option.name
}

/** A variant's option values as a line prints them, or nothing for a default (`variantOptionsLabel`). */
private fun variantOptionsLabel(options: Map<String, String>?): String? =
  if (options.isNullOrEmpty()) null else options.values.joinToString(" / ")

/** Whether a variant has a price set (`variantHasPrice`). */
private fun variantHasPrice(price: Double?): Boolean = price != null && price.isFinite() && price >= 0

/** A product line priced from the PRODUCT (`priceQuoteCatalogLine`). An included line keeps what it is and charges nothing. */
fun priceQuoteCatalogLine(rawProduct: HostProduct?, request: QuoteLineRequest.Catalog): PricedQuoteLine {
  if (rawProduct == null) return PricedQuoteLine.Refused("A product on this quote no longer exists. Remove it and add it again.")
  val product = liftLegacyProduct(rawProduct)
  val name = product.name.orEmpty()
  val variants = product.variants.orEmpty()
  val variant = if (!request.variantId.isNullOrEmpty()) variants.firstOrNull { it.id == request.variantId } else variants.firstOrNull()
  if (variant == null) return PricedQuoteLine.Refused("Choose an option of $name that still exists.")
  if (!request.included && !variantHasPrice(variant.priceUsd)) {
    return PricedQuoteLine.Refused("Set a price for $name before quoting it.")
  }
  val chosen = resolveLineModifiers(name, productModifierGroups(product), request.modifiers, variant.id)
  if (chosen is ResolvedModifiers.Refused) return PricedQuoteLine.Refused(chosen.error)
  chosen as ResolvedModifiers.Ok
  val label = lineLabelWithModifiers(variantOptionsLabel(variant.options), chosen.modifiers.map { it.name }).ifEmpty { null }
  val unitCents = if (request.included) 0.0 else kotlin.math.floor((variant.priceUsd ?: 0.0) * 100 + 0.5) + chosen.extraCents
  return PricedQuoteLine.Ok(
    OrderLineItem(
      productId = request.productId,
      variantId = variant.id?.takeIf { it != "default" },
      name = name,
      variantLabel = label,
      sku = variant.sku?.takeIf { it.isNotEmpty() },
      productType = product.type ?: ProductType.PHYSICAL,
      quantity = request.quantity,
      unitAmountCents = unitCents,
      modifiers = chosen.modifiers.takeIf { it.isNotEmpty() }?.map {
        OrderLineModifier(group = it.group, groupId = it.groupId, name = it.name, optionId = it.optionId, priceCents = it.priceCents.toDouble())
      },
      included = if (request.included) true else null,
      description = request.description?.takeIf { it.isNotEmpty() },
      taxExempt = if (product.taxExempt == true) true else null,
    ),
  )
}
