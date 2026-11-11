package com.aglyn.plugins.commerce.products

import com.aglyn.contracts.ProductCheckIn
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val PASS: Map<String, Any?> = mapOf(
  "name" to "Day pass",
  "status" to "active",
  "type" to "service",
  "priceUsd" to 20L,
  "checkIn" to mapOf("enabled" to true, "headcount" to 2L, "askUseDate" to true),
  "options" to listOf(mapOf("name" to "Kind", "values" to listOf("Adult", "Spectator", "Family"))),
  "variants" to listOf(
    mapOf("id" to "v1", "options" to mapOf("Kind" to "Adult"), "priceUsd" to 20L),
    mapOf("id" to "v2", "options" to mapOf("Kind" to "Spectator"), "priceUsd" to 5L, "checkIn" to mapOf("enabled" to false)),
    mapOf("id" to "v3", "options" to mapOf("Kind" to "Family"), "priceUsd" to 50L, "checkIn" to mapOf("enabled" to true, "headcount" to 4L)),
  ),
)

private fun json(vararg pairs: Pair<String, Any>): JsonObject = JsonObject(
  pairs.associate { (key, value) ->
    key to when (value) {
      is Boolean -> JsonPrimitive(value)
      is Number -> JsonPrimitive(value)
      else -> JsonPrimitive(value.toString())
    }
  },
)

/** The product editor's check-in fields (AGL-4063) read and write what the console's `ProductCheckInFields` does. */
class ProductCheckInTest {
  @Test
  fun anEditReadsTheProductsAndEachVariantsSetting() {
    val draft = productDraftOf("p1", PASS)
    assertEquals(ProductCheckIn(askUseDate = true, enabled = true, headcount = 2.0), draft.checkIn)
    assertNull(draft.variants[0].checkIn, "no setting of its own follows the product")
    assertEquals(ProductCheckIn(enabled = false), draft.variants[1].checkIn)
    assertEquals(ProductCheckIn(enabled = true, headcount = 4.0), draft.variants[2].checkIn)
    assertEquals(
      listOf(VariantCheckInChoice.PRODUCT, VariantCheckInChoice.OFF, VariantCheckInChoice.ON),
      draft.variants.map { variantCheckInChoice(it.checkIn) },
    )
  }

  @Test
  fun aProductThatNeverHadItReadsAsOff() {
    val draft = productDraftOf("p2", mapOf("name" to "Mug", "priceUsd" to 10L))
    assertNull(draft.checkIn)
    assertFalse(productNeedsCheckIn(draft.checkIn))
    assertEquals(1, productCheckInHeadcount(draft.checkIn))
  }

  @Test
  fun anUntouchedSettingIsSentAsStored() {
    val raw: Map<String, Any?> = mapOf("name" to "Day pass", "checkIn" to mapOf("enabled" to true, "headcount" to 70L))
    val body = productSaveJson(productDraftOf("p3", raw), raw)
    assertEquals(json("enabled" to true, "headcount" to 70L), body["checkIn"], "the console writes only what the fields change")
  }

  @Test
  fun nothingIsWrittenForAProductLeftOff() {
    val draft = ProductDraft(productId = "p4", create = true, name = "Mug").let { it.copy(variants = it.variants.map { v -> v.copy(price = "10") }) }
    assertFalse("checkIn" in productSaveJson(draft, null))
  }

  @Test
  fun switchingItOnStartsAtOnePersonAndOffWritesOnlyOff() {
    val on = productCheckInSwitched(null, true)
    assertEquals(ProductCheckIn(enabled = true, headcount = 1.0), on)
    val typed = productCheckInHeadcountTyped(on, "3")
    assertEquals(ProductCheckIn(enabled = true, headcount = 3.0), typed)
    assertEquals(ProductCheckIn(enabled = false), productCheckInSwitched(typed, false))
    assertEquals(json("enabled" to false), productCheckInJson(ProductCheckIn(enabled = false)))
  }

  @Test
  fun peoplePerItemIsAWholeNumberFromOneToFifty() {
    val on = ProductCheckIn(enabled = true, headcount = 2.0)
    assertEquals(1.0, productCheckInHeadcountTyped(on, "").headcount)
    assertEquals(1.0, productCheckInHeadcountTyped(on, "x").headcount)
    assertEquals(50.0, productCheckInHeadcountTyped(on, "120").headcount)
    assertEquals("Buying 3 makes 6 check-ins", productCheckInHeadcountHelp(on))
    assertEquals("Buying 3 makes 3 check-ins", productCheckInHeadcountHelp(ProductCheckIn(enabled = true, headcount = 1.0)))
  }

  @Test
  fun theDayQuestionIsKeptAcrossChangesAndDroppedWhenOff() {
    val asks = productCheckInAskUseDateSwitched(ProductCheckIn(enabled = true, headcount = 2.0), true)
    assertEquals(ProductCheckIn(askUseDate = true, enabled = true, headcount = 2.0), asks)
    assertEquals(ProductCheckIn(askUseDate = true, enabled = true, headcount = 5.0), productCheckInHeadcountTyped(asks, "5"))
    assertEquals(ProductCheckIn(enabled = true, headcount = 2.0), productCheckInAskUseDateSwitched(asks, false))
    assertEquals(json("enabled" to true, "headcount" to 2L, "askUseDate" to true), productCheckInJson(asks))
    assertTrue(productCheckInUseDayHelp(asks).startsWith("Buyers online can pick the day"))
    assertTrue(productCheckInUseDayHelp(null).startsWith("It is for the day it is bought."))
  }

  @Test
  fun aVariantPickStartsFromTheProductsPeopleAndDayQuestion() {
    val product = ProductCheckIn(askUseDate = true, enabled = true, headcount = 2.0)
    assertNull(variantCheckInPicked(VariantCheckInChoice.PRODUCT, ProductCheckIn(enabled = false), product))
    assertEquals(ProductCheckIn(enabled = false), variantCheckInPicked(VariantCheckInChoice.OFF, null, product))
    assertEquals(ProductCheckIn(askUseDate = true, enabled = true, headcount = 2.0), variantCheckInPicked(VariantCheckInChoice.ON, null, product))
    assertEquals(
      ProductCheckIn(enabled = true, headcount = 6.0),
      variantCheckInPicked(VariantCheckInChoice.ON, ProductCheckIn(enabled = true, headcount = 6.0), null),
    )
    assertEquals("Same as the product (needs check-in)", variantCheckInChoiceLabel(VariantCheckInChoice.PRODUCT, true))
    assertEquals("Same as the product (no check-in)", variantCheckInChoiceLabel(VariantCheckInChoice.PRODUCT, false))
  }

  @Test
  fun aVariantsOwnFieldsKeepEachOther() {
    val own = ProductCheckIn(askUseDate = true, enabled = true, headcount = 4.0)
    assertEquals(ProductCheckIn(askUseDate = true, enabled = true, headcount = 7.0), variantCheckInHeadcountTyped(own, "7"))
    assertEquals(ProductCheckIn(enabled = true, headcount = 4.0), variantCheckInAskUseDateSwitched(own, false))
  }

  @Test
  fun aSaveWritesTheProductsAndOnlyTheChangedVariantsSettings() {
    val start = productDraftOf("p1", PASS)
    val product = productCheckInHeadcountTyped(start.checkIn, "3")
    val draft = start.copy(
      checkIn = product,
      variants = start.variants.mapIndexed { index, variant ->
        when (index) {
          0 -> variant.copy(checkIn = variantCheckInPicked(VariantCheckInChoice.OFF, null, product))
          2 -> variant.copy(checkIn = variantCheckInPicked(VariantCheckInChoice.PRODUCT, variant.checkIn, product))
          else -> variant
        }
      },
    )
    val body = productSaveJson(draft, PASS)
    assertEquals(json("enabled" to true, "headcount" to 3L, "askUseDate" to true), body["checkIn"])
    val variants = (body["variants"] as JsonArray).map { it.jsonObject }
    assertEquals(json("enabled" to false), variants[0]["checkIn"])
    assertEquals(json("enabled" to false), variants[1]["checkIn"], "an untouched variant keeps its own")
    assertFalse("checkIn" in variants[2], "Same as the product removes the variant's own")
  }

  @Test
  fun theUpsellIsTheConsoles() {
    assertTrue(
      productCheckInUpsell().startsWith("Register quick keys, check-in at the window and selling a product in person only come with the point of sale."),
    )
  }
}
