package com.aglyn.plugins.commerce.orders

import com.aglyn.contracts.HostProduct
import com.aglyn.contracts.ModifierSelection
import com.aglyn.contracts.ProductModifierGroup
import com.aglyn.contracts.ProductModifierOption
import com.aglyn.contracts.ProductVariant
import com.aglyn.contracts.QuoteLineRequest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/** The console's `priceQuoteCatalogLine` cases (commerce-quotes.spec), as the editor prices a product line. */
class QuoteLinePricingTest {
  private val walls = ProductModifierGroup(
    id = "walls", name = "Walls", min = 0.0, max = 2.0,
    options = listOf(
      ProductModifierOption(id = "back", name = "Back wall", priceCents = 15_000.0, priceCentsByVariant = mapOf("big" to 20_000.0)),
      ProductModifierOption(id = "side", name = "Side wall", priceCents = 0.0),
    ),
  )
  private val canopy = HostProduct(
    name = "Canopy",
    variants = listOf(
      ProductVariant(id = "small", options = mapOf("Size" to "10x10"), priceUsd = 1200.0, sku = "CAN-S"),
      ProductVariant(id = "big", options = mapOf("Size" to "10x20"), priceUsd = 1800.0),
      ProductVariant(id = "unpriced", options = mapOf("Size" to "Custom")),
    ),
    modifierGroups = listOf(walls),
  )

  private fun line(variantId: String?, picks: List<String> = emptyList(), included: Boolean = false) = QuoteLineRequest.Catalog(
    productId = "canopy", variantId = variantId, quantity = 2.0,
    modifiers = picks.map { ModifierSelection(groupId = "walls", optionId = it) }, included = included,
  )

  @Test
  fun pricesTheVariantPlusItsAddOnsForThatSize() {
    val priced = assertIs<PricedQuoteLine.Ok>(priceQuoteCatalogLine(canopy, line("big", listOf("back", "side")))).line
    assertEquals(200_000.0, priced.unitAmountCents)
    assertEquals("10x20 / Back wall, Side wall", priced.variantLabel)
    assertEquals("big", priced.variantId)
    assertEquals(listOf(20_000.0, 0.0), priced.modifiers?.map { it.priceCents })
  }

  @Test
  fun refusesWhatCannotBePriced() {
    assertEquals(
      PricedQuoteLine.Refused("Set a price for Canopy before quoting it."),
      priceQuoteCatalogLine(canopy, line("unpriced")),
    )
    assertEquals(PricedQuoteLine.Refused("Choose an option of Canopy that still exists."), priceQuoteCatalogLine(canopy, line("gone")))
    assertEquals(
      PricedQuoteLine.Refused("A product on this quote no longer exists. Remove it and add it again."),
      priceQuoteCatalogLine(null, line("small")),
    )
  }

  @Test
  fun anIncludedLineChargesNothingEvenWithoutAPrice() {
    val priced = assertIs<PricedQuoteLine.Ok>(priceQuoteCatalogLine(canopy, line("unpriced", included = true))).line
    assertEquals(0.0, priced.unitAmountCents)
    assertEquals(true, priced.included)
  }

  @Test
  fun namesAnAddOnWithItsPriceForThePickedSize() {
    assertEquals("Back wall (+$200.00)", quoteModifierOptionLabel(walls.options[0], "big"))
    assertEquals("Back wall (+$150.00)", quoteModifierOptionLabel(walls.options[0], "small"))
    assertEquals("Side wall", quoteModifierOptionLabel(walls.options[1], "small"))
  }
}
