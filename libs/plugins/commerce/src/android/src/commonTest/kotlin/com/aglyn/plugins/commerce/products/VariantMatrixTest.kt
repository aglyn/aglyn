package com.aglyn.plugins.commerce.products

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun counter(): () -> String {
  var n = 0
  return { "n${++n}" }
}

private val STORED_TEE: Map<String, Any?> = mapOf(
  "name" to "Tee",
  "slug" to "tee",
  "status" to "active",
  "type" to "physical",
  "options" to listOf(mapOf("name" to "Size", "values" to listOf("S", "M"))),
  "variants" to listOf(
    mapOf("id" to "vs", "options" to mapOf("Size" to "S"), "priceUsd" to 10.0, "inventory" to 4L, "sku" to "TEE-S"),
    mapOf("id" to "vm", "options" to mapOf("Size" to "M"), "priceUsd" to 12.0, "inventory" to 0L),
  ),
)

class VariantMatrixTest {
  @Test
  fun valuesAreSplitTrimmedAndDeduplicated() {
    assertEquals(listOf("Small", "Large"), parseOptionValues(" Small, ,Large,\nSmall "))
    assertEquals(emptyList(), parseOptionValues(" , "))
  }

  @Test
  fun anOptionWithValuesMakesOneVariantEachStartingFromTheFirstOnesPriceAndStock() {
    val start = ProductDraft("p", create = true, name = "Tee", variants = listOf(VariantDraft("default", "Default", "9.50", stock = "7")))
    val withOption = start.withOptionAdded().withOptionName(0, "Size", counter()).withOptionValues(0, "S, M, L", counter())
    assertEquals(listOf("S", "M", "L"), withOption.variants.map { it.label })
    assertEquals(listOf("n1", "n2", "n3"), withOption.variants.map { it.id })
    assertTrue(withOption.variants.all { it.fresh && it.price == "9.50" && it.stock == "7" })
    assertEquals(mapOf("Size" to "M"), withOption.variants[1].selections)
  }

  @Test
  fun anOptionWithNoNameYetJoinsTheMatrixWhenItIsNamed() {
    val start = ProductDraft("p", create = true, name = "Tee", variants = listOf(VariantDraft("default", "Default", "5")))
    val valuesFirst = start.withOptionAdded().withOptionValues(0, "S, M", counter())
    assertEquals(1, valuesFirst.variants.size, "an unnamed option is not in the matrix")
    val named = valuesFirst.withOptionName(0, "Size", counter())
    assertEquals(listOf("S", "M"), named.variants.map { it.label })
  }

  @Test
  fun changingValuesKeepsTheVariantsThatSurvive() {
    val draft = productDraftOf("p", STORED_TEE)
    val edited = draft.copy(variants = draft.variants.map { if (it.id == "vs") it.copy(price = "11", sku = "KEEP") else it })
    val more = edited.withOptionValues(0, "S, M, L", counter())
    assertEquals(listOf("vs", "vm", "n1"), more.variants.map { it.id })
    assertEquals("KEEP", more.variants[0].sku)
    assertEquals("11", more.variants[0].price)
    assertFalse(more.variants[0].fresh)
    assertTrue(more.variants[2].fresh)
    val fewer = more.withOptionValues(0, "M", counter())
    assertEquals(listOf("vm"), fewer.variants.map { it.id })
  }

  @Test
  fun renamingAnOptionMovesTheSelectionsAndKeepsEveryVariant() {
    val renamed = productDraftOf("p", STORED_TEE).withOptionName(0, "Fit", counter())
    assertEquals(listOf("vs", "vm"), renamed.variants.map { it.id })
    assertEquals(mapOf("Fit" to "S"), renamed.variants[0].selections)
    assertEquals("TEE-S", renamed.variants[0].sku)
    assertTrue(renamed.variants.none { it.fresh })
  }

  @Test
  fun twoOptionsMakeTheCartesianProduct() {
    val two = ProductDraft("p", create = true, name = "Tee", variants = listOf(VariantDraft("default", "Default", "1")))
      .withOptionAdded().withOptionName(0, "Size", counter()).withOptionValues(0, "S, M", counter())
      .withOptionAdded().withOptionName(1, "Color", counter()).withOptionValues(1, "Red, Blue, Green", counter())
    assertEquals(6, two.variants.size)
    assertEquals("S / Red", two.variants.first().label)
    assertEquals("M / Green", two.variants.last().label)
    val back = two.withOptionRemoved(1, counter())
    assertEquals(listOf("S", "M"), back.variants.map { it.label })
    assertEquals(two.variants.first().id, back.variants.first().id, "removing the last option keeps the first axis's variants")
  }

  @Test
  fun aSaveWritesTheOptionsTheSelectionsAndTheStockOfOnlyTheNewVariants() {
    val draft = productDraftOf("p", STORED_TEE).withOptionValues(0, "S, M, L", counter())
    val json = productSaveJson(draft, STORED_TEE)
    val option = json["options"]!!.jsonArray.single().jsonObject
    assertEquals("Size", option["name"]!!.jsonPrimitive.content)
    assertEquals(listOf("S", "M", "L"), option["values"]!!.jsonArray.map { it.jsonPrimitive.content })
    val variants = json["variants"] as JsonArray
    assertEquals("S", variants[0].jsonObject["options"]!!.jsonObject["Size"]!!.jsonPrimitive.content)
    assertEquals(4L, variants[0].jsonObject["inventory"]!!.jsonPrimitive.content.toLong())
    val fresh = variants[2].jsonObject
    assertEquals("n1", fresh["id"]!!.jsonPrimitive.content)
    assertEquals(4L, fresh["inventory"]!!.jsonPrimitive.content.toLong(), "a new variant starts from the first variant's stock, as the console's does")
    assertEquals(10.0, fresh["priceUsd"]!!.jsonPrimitive.content.toDouble())
  }

  @Test
  fun aNewProductWithoutOptionsWritesNone() {
    val draft = ProductDraft("p", create = true, name = "Mug", variants = listOf(VariantDraft("default", "Default", "4")))
    assertFalse("options" in productSaveJson(draft, null))
    assertEquals(JsonNull, (productSaveJson(draft, null)["variants"] as JsonArray).single().jsonObject["inventory"])
  }

  @Test
  fun theOptionLimitsAreTheConsoles() {
    fun option(name: String, count: Int) = OptionDraft(name, (1..count).joinToString(", ") { "v$it" })
    assertNull(checkOptions(listOf(option("A", 25), option("B", 4))))
    assertEquals("Option names are required", checkOptions(listOf(OptionDraft("", "x"))))
    assertEquals("Option \"Size\" needs at least one value", checkOptions(listOf(OptionDraft("Size", " , "))))
    assertEquals("Option \"A\" has too many values", checkOptions(listOf(option("A", 26))))
    assertEquals("Each option needs its own name", checkOptions(listOf(option("A", 2), option("A ", 2))))
    assertEquals("At most 3 options per product", checkOptions(listOf(option("A", 1), option("B", 1), option("C", 1), option("D", 1))))
    assertEquals("At most 100 variants per product", checkOptions(listOf(option("A", 25), option("B", 5))))
  }

  @Test
  fun aDraftChecksPricesAndCodesAcrossVariants() {
    fun variant(id: String, price: String, compareAt: String = "", sku: String = "") = VariantDraft(id, id, price, compareAt = compareAt, sku = sku)
    fun draft(vararg v: VariantDraft) = ProductDraft("p", true, name = "x", variants = v.toList())
    assertEquals("Variant SKUs must be unique", checkProductDraft(draft(variant("a", "1", sku = "S"), variant("b", "1", sku = "S"))))
    assertEquals("Compare-at price must exceed the price", checkProductDraft(draft(variant("a", "5", compareAt = "5"))))
    assertEquals("Prices are capped at $10000", checkProductDraft(draft(variant("a", "10000.01"))))
    assertNull(checkProductDraft(draft(variant("a", "5", compareAt = "6"), variant("b", "5"))))
  }
}
