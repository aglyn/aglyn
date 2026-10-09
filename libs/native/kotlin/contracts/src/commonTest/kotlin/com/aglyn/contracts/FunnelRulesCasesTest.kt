package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/** Replays the funnels rules' cases in function-cases.generated.json: the TypeScript's own answers. */
class FunnelRulesCasesTest {
  private val functions = ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> {
    val list = functions.getValue(name).jsonObject.getValue("cases").jsonArray
    assertNotNull(list.firstOrNull(), "no cases for $name")
    return list.map { it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result") }
  }

  private fun text(element: JsonElement?): String? = (element as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
  private fun step(json: JsonElement) = ContractJsonFormat.decodeFromJsonElement(FunnelStep.serializer(), json)
  private fun inventory(json: JsonElement) = ContractJsonFormat.decodeFromJsonElement(FunnelInventory.serializer(), json)
  private fun input(json: JsonElement): FunnelStepInput {
    val o = json.jsonObject
    return FunnelStepInput(text(o["type"]), text(o["key"]), text(o["match"]), text(o["label"]))
  }

  @Test
  fun stepTitles() {
    cases("funnelStepTitle").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, funnelStepTitle(step(args[0])), args.toString()) }
  }

  @Test
  fun waitsAndFigures() {
    cases("waitLabel").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, waitLabel(args[0].jsonPrimitive.content.toInt()), args.toString()) }
    cases("formatShare").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, formatShare(args[0].jsonPrimitive.doubleOrNull), args.toString()) }
    cases("formatDuration").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, formatDuration(args[0].jsonPrimitive.doubleOrNull), args.toString()) }
  }

  @Test
  fun definitionChecks() {
    cases("normalizeFunnelDefinition").forEach { (args, result) ->
      val raw = args[0].jsonObject
      val check = normalizeFunnelDefinition(text(raw["name"]), raw.getValue("steps").jsonArray.map(::input))
      val expected = result.jsonObject
      if (expected["error"] != null) {
        assertEquals(text(expected["error"]), check.error, args.toString())
      } else {
        assertEquals(null, check.error, args.toString())
        assertEquals(ContractJsonFormat.decodeFromJsonElement(FunnelDefinition.serializer(), expected.getValue("funnel")), check.funnel, args.toString())
      }
    }
  }

  @Test
  fun inventoryChecks() {
    cases("stepInventoryProblem").forEach { (args, result) -> assertEquals(text(result), stepInventoryProblem(step(args[0]), inventory(args[1])), args.toString()) }
    cases("labelStepFromInventory").forEach { (args, result) -> assertEquals(step(result), labelStepFromInventory(step(args[0]), inventory(args[1])), args.toString()) }
  }
}
