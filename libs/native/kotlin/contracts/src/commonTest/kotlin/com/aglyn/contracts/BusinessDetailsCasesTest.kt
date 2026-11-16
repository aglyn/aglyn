package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** Replays the business details cases in function-cases.generated.json: the console's own answers (AGL-4136). */
class BusinessDetailsCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> {
    val list = functions.getValue(name).jsonObject.getValue("cases").jsonArray
    assertNotNull(list.firstOrNull(), "no cases for $name")
    return list.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }
  }

  private fun plainJson(element: JsonElement?): Any? = when (element) {
    null, JsonNull -> null
    is JsonObject -> element.mapValues { plainJson(it.value) }
    is JsonArray -> element.map(::plainJson)
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.doubleOrNull
  }

  @Suppress("UNCHECKED_CAST")
  private fun map(json: JsonElement?): Map<String, Any?>? = if (json == null || json is JsonNull) null else plainJson(json) as Map<String, Any?>

  @Test
  fun write() = cases("businessDetailsWrite").forEach { (args, result) ->
    assertEquals(map(result), businessDetailsWrite(map(args[0]).orEmpty(), map(args[1])), args.toString())
  }

  @Test
  fun seed() = cases("businessDetailsSeed").forEach { (args, result) ->
    assertEquals(map(result), businessDetailsSeed(map(args[0])), args.toString())
  }

  @Test
  fun values() {
    assertEquals(120L, Contracts.siteSloganMaxLength)
    assertEquals(8L, Contracts.businessSocialLinksMax)
    assertTrue("seo.entity.slogan" in Contracts.businessDetailsClearablePathList)
    assertTrue("business.supportEmail" in Contracts.businessDetailsClearablePathList)
  }
}
