package com.aglyn.plugins.commerce.products

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AddOnsTest {
  private val stored = mapOf<String, Any?>(
    "name" to "Canopy",
    "variants" to listOf(mapOf("id" to "v10", "priceUsd" to 300.0, "options" to mapOf("Size" to "10x10")), mapOf("id" to "v20", "priceUsd" to 500.0, "options" to mapOf("Size" to "10x20"))),
    "options" to listOf(mapOf("name" to "Size", "values" to listOf("10x10", "10x20"))),
    "modifierGroups" to listOf(
      mapOf(
        "id" to "walls", "name" to "Walls", "min" to 0, "max" to 2, "online" to true,
        "options" to listOf(
          mapOf("id" to "full", "name" to "Full wall", "priceCents" to 4500, "priceCentsByVariant" to mapOf("v20" to 7500), "imageUrl" to "https://cdn.example/wall.jpg", "note" to "Blocks wind on one side"),
          mapOf("id" to "kit", "name" to "Weekend kit", "priceCents" to 12000, "includes" to listOf("Full wall ×2", "Roller bag")),
        ),
      ),
    ),
  )

  @Test
  fun aStoredProductsAddOnsReadAsDraftsWithPricesInDollars() {
    val draft = productDraftOf("p1", stored)
    val walls = draft.addOns.single()
    assertEquals("Walls", walls.name)
    assertEquals(true, walls.online)
    assertEquals(2, walls.max)
    assertEquals("45.00", walls.choices[0].price)
    assertEquals(mapOf("v20" to "75.00"), walls.choices[0].byVariant)
  }

  @Test
  fun aSaveKeepsWhatTheAppsDoNotEditPicturesNotesAndCombos() {
    val draft = productDraftOf("p1", stored)
    val edited = draft.copy(addOns = listOf(draft.addOns[0].copy(name = "Side walls", choices = draft.addOns[0].choices.map { if (it.id == "full") it.copy(price = "50") else it })))
    val groups = productSaveJson(edited, stored)["modifierGroups"]!!.jsonArray
    val group = groups[0].jsonObject
    assertEquals("Side walls", group["name"]!!.jsonPrimitive.content)
    val full = group["options"]!!.jsonArray[0].jsonObject
    assertEquals(5000L, full["priceCents"]!!.jsonPrimitive.content.toLong())
    assertEquals("https://cdn.example/wall.jpg", full["imageUrl"]!!.jsonPrimitive.content)
    assertEquals("Blocks wind on one side", full["note"]!!.jsonPrimitive.content)
    assertEquals(JsonObject(mapOf("v20" to JsonPrimitive(7500L))), full["priceCentsByVariant"])
    val kit = group["options"]!!.jsonArray[1].jsonObject
    assertEquals(JsonArray(listOf(JsonPrimitive("Full wall ×2"), JsonPrimitive("Roller bag"))), kit["includes"])
  }

  @Test
  fun aNewGroupIsOptionalPickOneAndShownOnTheWebsite() {
    var n = 0
    val group = newAddOnGroup { prefix -> "$prefix${++n}" }
    assertEquals(0, group.min)
    assertEquals(1, group.max)
    assertEquals(true, group.online)
    assertEquals(listOf("o2"), group.choices.map { it.id })
  }

  @Test
  fun aPerSizePriceLeftEmptyFallsBackToTheChoicesOwnPrice() {
    val choice = AddOnChoiceDraft("full", "Full wall", "45", mapOf("v20" to "75"))
    assertEquals(emptyMap(), choice.withVariantPrice("v20", "").byVariant)
    assertEquals(mapOf("v20" to "75", "v10" to "40"), choice.withVariantPrice("v10", "40").byVariant)
  }

  @Test
  fun theChecksSpeakTheConsolesWords() {
    val group = AddOnGroupDraft("g", "Walls", choices = listOf(AddOnChoiceDraft("o", "Full wall", "1500")))
    assertEquals("“Full wall” needs a price of $0 to $1,000", checkAddOns(listOf(group)))
    assertEquals("Name every modifier group", checkAddOns(listOf(group.copy(name = " ", choices = listOf(AddOnChoiceDraft("o", "Full wall", "45"))))))
    assertEquals("“Walls” requires more choices than it allows", checkAddOns(listOf(group.copy(min = 2, choices = listOf(AddOnChoiceDraft("o", "Full wall", "45"))))))
    assertNull(checkAddOns(listOf(group.copy(choices = listOf(AddOnChoiceDraft("o", "Full wall", ""))))))
  }

  @Test
  fun removingAChoiceNeverLeavesAtMostAboveWhatIsLeft() {
    val group = AddOnGroupDraft("g", "Walls", min = 2, max = 2, choices = listOf(AddOnChoiceDraft("a", "A"), AddOnChoiceDraft("b", "B")))
    val left = group.withChoiceRemoved(0)
    assertEquals(1, left.max)
    assertEquals(1, left.min)
  }

  @Test
  fun priceByNamesTheOneOptionAProductVariesBy() {
    assertEquals("Price by size", priceByLabel(listOf(OptionDraft("Size", "S, M"))))
    assertEquals("Price by variant", priceByLabel(listOf(OptionDraft("Size", "S, M"), OptionDraft("Color", "Red"))))
  }

  @Test
  fun moreCombinationsThanAProductHoldsSaysTheCountAndTheWayOut() {
    val options = listOf(OptionDraft("Size", (1..10).joinToString(", ") { "S$it" }), OptionDraft("Color", (1..11).joinToString(", ") { "C$it" }))
    val problem = checkOptions(options)!!
    assertTrue(problem.startsWith("These options make 110 combinations, and a product holds at most 100."), problem)
    assertTrue("Add-ons" in problem)
    assertNull(variantMatrixProblem(options.take(1)))
  }

  @Test
  fun aProductWithNoAddOnsSavesNone() {
    val plain = productDraftOf("p2", stored - "modifierGroups")
    assertNull(productSaveJson(plain, stored - "modifierGroups")["modifierGroups"])
  }
}
