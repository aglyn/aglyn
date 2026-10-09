package com.aglyn.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays derived-values.generated.json: the console's own `checkEntitlement` answers. */
class PlanFeaturesTest {
  private fun plain(element: JsonElement?): Any? = when (element) {
    null, JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map(::plain)
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.longOrNull
  }

  @Test
  fun planFeaturesAreTheConsoles() {
    val root = Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "derived-values.generated.json").readText()).jsonObject
    val cases = root.getValue("cases").jsonArray
    assertTrue(cases.isNotEmpty())
    for (item in cases) {
      val case = item.jsonObject
      @Suppress("UNCHECKED_CAST")
      val org = plain(case["org"]) as? Map<String, Any?>
      val feature = case.getValue("feature").jsonPrimitive.content
      assertEquals(case.getValue("result").jsonPrimitive.boolean, planFeatureCarried(org, feature), "$feature $org")
    }
  }

  @Test
  fun releaseFlagsAreTheConsoles() {
    val root = Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "derived-values.generated.json").readText()).jsonObject
    val cases = root.getValue("flagCases").jsonArray
    assertTrue(cases.isNotEmpty())
    for (item in cases) {
      @Suppress("UNCHECKED_CAST")
      val case = plain(item) as Map<String, Any?>
      @Suppress("UNCHECKED_CAST")
      val raw = case["value"] as Map<String, Any?>
      @Suppress("UNCHECKED_CAST")
      val value = ReleaseFlagValue(raw["enabled"] == true, (raw["rolloutPercent"] as? Number)?.toInt() ?: 0, (raw["plans"] as? List<String>).orEmpty())
      @Suppress("UNCHECKED_CAST")
      val got = isReleaseFlagOn(case["flag"] as String, value, case["orgId"] as? String, case["plan"] as? String, case["overrides"] as? Map<String, Any?>)
      assertEquals(case["result"], got, case.toString())
    }
  }
}
