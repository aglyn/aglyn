package com.aglyn.screens

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** What a store's shipping settings cover, replayed from libs/native/screens/shipping-coverage-cases.json, which the console's own resolver produced (Apple replays the same file). */
class ShippingCoverageTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }
  private val cases: List<JsonObject> =
    Json.parseToJsonElement(File(root, "libs/native/screens/shipping-coverage-cases.json").readText()).jsonObject["cases"]!!.jsonArray.map { it.jsonObject }

  private fun settings(case: JsonObject): JsonElement? = case["settings"]?.takeIf { it !is JsonNull }

  private fun options(list: List<ShippingCoverage.Option>): JsonArray = buildJsonArray {
    list.forEach {
      add(buildJsonObject {
        put("rateId", it.rateId)
        put("name", it.name)
        put("amountCents", it.amountCents)
      })
    }
  }

  /** `500` and `500.0` are the same price; the cases write whole cents the way a JSON number does. */
  private fun whole(element: JsonElement?): JsonElement? = when (element) {
    is JsonArray -> JsonArray(element.map { whole(it)!! })
    is JsonObject -> JsonObject(element.mapValues { whole(it.value)!! })
    is JsonPrimitive -> if (!element.isString && element.content.endsWith(".0")) JsonPrimitive(element.content.removeSuffix(".0").toLong()) else element
    else -> element
  }

  @Test
  fun everyStoresCoverageReadsAsTheConsolesDoes() {
    assertTrue(cases.size > 20)
    for (case in cases) assertEquals(case["coverage"], ShippingCoverage.summary(settings(case)), "coverage of: ${case["name"]}")
  }

  @Test
  fun everyDestinationsOptionsAreTheOnesTheConsoleOffers() {
    for (case in cases) {
      for (scenario in case["options"]!!.jsonArray.map { it.jsonObject }) {
        val cartJson = scenario["cart"]!!.jsonObject
        val cart = ShippingCoverage.Cart(
          ScreenValues.number(cartJson["subtotalCents"]) ?: 0.0,
          ScreenValues.number(cartJson["totalGrams"]) ?: 0.0,
        )
        for (country in ShippingCoverage.countries) {
          assertEquals(
            scenario["byCountry"]!!.jsonObject[country],
            whole(options(ShippingCoverage.checkoutOptions(settings(case), listOf(country), cart))),
            "$country of: ${case["name"]}, cart $cart",
          )
        }
        assertEquals(scenario["union"], whole(options(ShippingCoverage.checkoutOptions(settings(case), ShippingCoverage.countries, cart))), "every destination of: ${case["name"]}, cart $cart")
      }
    }
  }
}
