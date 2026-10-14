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

/**
 * What a store's shipping settings cover, replayed from `functionCases` in libs/native/contracts/function-cases.generated.json,
 * which the console's own functions produced (Apple replays the same file).
 */
class ShippingCoverageTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }
  private val functions = Json.parseToJsonElement(File(root, "libs/native/contracts/function-cases.generated.json").readText()).jsonObject["functions"]!!.jsonObject

  private fun cases(name: String): List<JsonObject> = functions[name]!!.jsonObject["cases"]!!.jsonArray.map { it.jsonObject }

  private fun settings(args: JsonArray): JsonElement? = args.firstOrNull()?.takeIf { it !is JsonNull }

  private fun flag(json: JsonObject, key: String) = (json[key] as? JsonPrimitive)?.content == "true"

  private fun coverage(json: JsonObject) = ShippingCoverage.Coverage(
    served = json["served"]!!.jsonArray.map { (it as JsonPrimitive).content },
    unserved = json["unserved"]!!.jsonArray.map { (it as JsonPrimitive).content },
    shipsNowhere = flag(json, "shipsNowhere"),
    asksDestination = flag(json, "asksDestination"),
    offersLocalPickup = flag(json, "offersLocalPickup"),
    hasRestOfWorldZone = flag(json, "hasRestOfWorldZone"),
  )

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
    val all = cases("summarizeShippingCoverage")
    assertTrue(all.size > 20)
    for (case in all) assertEquals(coverage(case["result"]!!.jsonObject), ShippingCoverage.summarize(settings(case["args"]!!.jsonArray)), "${case["args"]}")
  }

  @Test
  fun theWordsAreTheConsolesWords() {
    val all = cases("describeShippingCoverage")
    assertTrue(all.size > 6)
    for (case in all) {
      val said = ShippingCoverage.words(coverage(case["args"]!!.jsonArray[0].jsonObject))
      val expected = case["result"]!!.jsonObject
      assertEquals((expected["headline"] as JsonPrimitive).content, said.headline)
      assertEquals((expected["detail"] as JsonPrimitive).content, said.detail)
      assertEquals((expected["note"] as JsonPrimitive).content, said.note)
      assertEquals((expected["asks"] as JsonPrimitive).content, said.asks)
    }
  }

  @Test
  fun everyDestinationsOptionsAreTheOnesTheConsoleOffers() {
    val all = cases("resolveCheckoutShippingOptions")
    assertTrue(all.size > 300)
    for (case in all) {
      val args = case["args"]!!.jsonArray
      val cartJson = args[2].jsonObject
      val cart = ShippingCoverage.Cart(ScreenValues.number(cartJson["subtotalCents"]) ?: 0.0, ScreenValues.number(cartJson["totalGrams"]) ?: 0.0)
      val destinations = args[1].jsonArray.map { (it as JsonPrimitive).content }
      assertEquals(case["result"], whole(options(ShippingCoverage.checkoutOptions(settings(args), destinations, cart))), "$args")
    }
  }
}
