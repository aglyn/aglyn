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

  @Test
  fun aChoicesPictureNoteAndComboReadAndSaveAsTheConsoleWritesThem() {
    val draft = productDraftOf("p1", stored)
    val kit = draft.addOns[0].choices[1]
    assertEquals("Full wall ×2\nRoller bag", kit.includes)
    assertEquals("https://cdn.example/wall.jpg", draft.addOns[0].choices[0].imageUrl)
    val long = "x".repeat(200)
    val edited = draft.copy(addOns = listOf(draft.addOns[0].copy(choices = listOf(
      draft.addOns[0].choices[0].copy(imageUrl = " ", note = "  $long  "),
      kit.copy(includes = "  Full wall ×2 \n\n${(1..14).joinToString("\n") { "Item $it" }}", note = "Two walls and a bag"),
    ))))
    val options = productSaveJson(edited, stored)["modifierGroups"]!!.jsonArray[0].jsonObject["options"]!!.jsonArray
    val full = options[0].jsonObject
    assertNull(full["imageUrl"])
    assertEquals(160, full["note"]!!.jsonPrimitive.content.length)
    val combo = options[1].jsonObject
    val items = combo["includes"]!!.jsonArray.map { it.jsonPrimitive.content }
    assertEquals(12, items.size)
    assertEquals("Full wall ×2", items[0])
    assertEquals("Two walls and a bag", combo["note"]!!.jsonPrimitive.content)
    val cleared = edited.copy(addOns = listOf(edited.addOns[0].copy(choices = edited.addOns[0].choices.map { it.copy(note = "", includes = "") })))
    val after = productSaveJson(cleared, stored)["modifierGroups"]!!.jsonArray[0].jsonObject["options"]!!.jsonArray[1].jsonObject
    assertNull(after["includes"])
    assertNull(after["note"])
  }

  @Test
  fun aNewWriteInIsOneRequiredFieldShownOnTheWebsite() {
    var n = 0
    val group = newWriteInGroup { prefix -> "$prefix${++n}" }
    assertTrue(group.isWriteIn)
    assertEquals(1, group.min)
    assertEquals(1, group.max)
    assertEquals(20, group.maxLength)
    assertEquals(true, group.online)
    assertEquals(listOf("o2"), group.choices.map { it.id })
    val named = group.withWriteInName("Name on jersey")
    assertEquals("Name on jersey", named.choices.single().name)
    assertNull(checkAddOns(listOf(named)))
    assertEquals("“Name on jersey” takes 1 to 40 characters", checkAddOns(listOf(named.copy(maxLength = 41))))
    assertEquals(40, writeInLengthOf("99"))
    assertEquals(1, writeInLengthOf(""))
    assertEquals(14, writeInLengthOf("14"))
  }

  @Test
  fun aWriteInAndANamedGroupSaveAndReadBackWithEveryField() {
    val size = AddOnGroupDraft("jersey", "Jersey size", min = 1, max = 1, online = true, nameOnOrder = true, choices = listOf(AddOnChoiceDraft("jersey-m", "M")))
    val number = newWriteInGroup { prefix -> prefix + "n" }.withWriteInName("Number").copy(maxLength = 3, digitsOnly = true)
      .let { it.copy(choices = listOf(it.choices[0].copy(price = "5", note = "On the back"))) }
    val draft = productDraftOf("p1", stored).copy(addOns = listOf(size, number))
    val saved = productSaveJson(draft, stored)["modifierGroups"]!!.jsonArray.map { it.jsonObject }
    assertEquals(true, saved[0]["nameOnOrder"]!!.jsonPrimitive.content.toBoolean())
    assertNull(saved[0]["kind"])
    val field = saved[1]
    assertEquals("text", field["kind"]!!.jsonPrimitive.content)
    assertEquals(3L, field["maxLength"]!!.jsonPrimitive.content.toLong())
    assertEquals(true, field["digitsOnly"]!!.jsonPrimitive.content.toBoolean())
    val option = field["options"]!!.jsonArray.single().jsonObject
    assertEquals("Number", option["name"]!!.jsonPrimitive.content)
    assertEquals(500L, option["priceCents"]!!.jsonPrimitive.content.toLong())
    assertEquals("On the back", option["note"]!!.jsonPrimitive.content)
    val back = addOnDrafts(
      mapOf(
        "modifierGroups" to listOf(
          mapOf("id" to "number", "name" to "Number", "kind" to "text", "min" to 1, "max" to 1, "maxLength" to 3, "digitsOnly" to true, "options" to listOf(mapOf("id" to "o", "name" to "Number", "priceCents" to 500))),
          mapOf("id" to "jersey", "name" to "Jersey size", "min" to 1, "max" to 1, "nameOnOrder" to true, "options" to listOf(mapOf("id" to "m", "name" to "M", "priceCents" to 0))),
        ),
      ),
    )
    assertTrue(back[0].isWriteIn)
    assertEquals(3, back[0].maxLength)
    assertEquals(true, back[0].digitsOnly)
    assertEquals("5.00", back[0].choices[0].price)
    assertEquals(true, back[1].nameOnOrder)
    val turnedOff = productSaveJson(draft.copy(addOns = listOf(size.copy(nameOnOrder = null))), stored)["modifierGroups"]!!.jsonArray[0].jsonObject
    assertNull(turnedOff["nameOnOrder"])
  }
}
