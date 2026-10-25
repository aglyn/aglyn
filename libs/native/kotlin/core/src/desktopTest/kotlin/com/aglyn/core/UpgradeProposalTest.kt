package com.aglyn.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays derived-values.generated.json's `proposalCases`: the console's standing proposal and its summary. */
class UpgradeProposalTest {
  private fun plain(element: JsonElement?): Any? = when (element) {
    null, JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map(::plain)
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.longOrNull ?: element.doubleOrNull
  }

  @Test
  fun theProposedPlanReadsAsTheConsoleReadsIt() {
    val root = Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "derived-values.generated.json").readText()).jsonObject
    val cases = root.getValue("proposalCases").jsonArray
    assertTrue(cases.isNotEmpty())
    cases.forEachIndexed { index, item ->
      @Suppress("UNCHECKED_CAST")
      val org = plain(item.jsonObject["org"]) as Map<String, Any?>
      val standing = UpgradeProposal.standing(org)
      assertEquals(plain(item.jsonObject["plan"]), standing?.plan, "case $index: $org")
      assertEquals(plain(item.jsonObject["summary"]), standing?.summary, "case $index: $org")
      assertEquals(plain(item.jsonObject["bundled"]), standing?.bundled ?: false, "case $index: $org")
    }
  }
}
