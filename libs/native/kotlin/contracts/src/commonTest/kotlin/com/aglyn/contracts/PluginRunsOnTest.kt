package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Replays the console's answers for where a plugin runs (plugin-site-exclusions.ts) from function-cases.generated.json. */
class PluginRunsOnTest {
  private val functions =
    ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
      it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
    }.also { assertTrue(it.isNotEmpty(), "$name has no cases") }

  private fun strings(value: JsonElement?): List<String>? = (value as? JsonArray)?.map { it.jsonPrimitive.content }

  private fun sites(value: JsonElement): List<PluginSiteEntry> = value.jsonArray.map {
    val site = it.jsonObject
    PluginSiteEntry(site.getValue("id").jsonPrimitive.content, strings(site["disabledPlugins"]), strings(site["enabledPlugins"]))
  }

  private fun choice(value: JsonElement): PluginRunsOn {
    val raw = value.jsonObject
    return if (raw["mode"]?.jsonPrimitive?.content == "allExcept") PluginRunsOn.AllExcept(strings(raw["exceptHostIds"]).orEmpty()) else PluginRunsOn.All
  }

  @Test
  fun runsOnReadsTheSitesLists() = cases("pluginRunsOnOf").forEach { (args, result) ->
    assertEquals(choice(result), pluginRunsOnOf(args[0].jsonPrimitive.content, sites(args[1])), args.toString())
  }

  @Test
  fun plansAsTheConsole() = cases("planPluginRunsOn").forEach { (args, result) ->
    val input = args[0].jsonObject
    val org = input["org"] as? JsonObject
    val plan = planPluginRunsOn(input.getValue("pluginId").jsonPrimitive.content, choice(input.getValue("choice")), strings(org?.get("enabledPlugins")), sites(input.getValue("sites")))
    val want = result.jsonObject
    assertEquals((want["problem"] as? JsonPrimitive)?.takeIf { it.isString }?.content, plan.problem, args.toString())
    val writes = (want["writes"] as? JsonArray)?.map {
      val write = it.jsonObject
      PluginSiteWrite(write.getValue("hostId").jsonPrimitive.content, strings(write["disabledPlugins"]).orEmpty(), write.getValue("leftOut").jsonPrimitive.boolean)
    }
    assertEquals(writes, plan.writes, args.toString())
    val stranded = want.getValue("stranded").jsonArray.map {
      val entry = it.jsonObject
      PluginSiteStranding(entry.getValue("hostId").jsonPrimitive.content, entry.getValue("pluginId").jsonPrimitive.content, strings(entry["missing"]).orEmpty())
    }
    assertEquals(stranded, plan.stranded, args.toString())
  }

  @Test
  fun optInNoteAsTheConsole() = cases("pluginRunsOnOptInNote").forEach { (args, result) ->
    assertEquals(if (result is JsonNull) null else result.jsonPrimitive.content, pluginRunsOnOptInNote(args[0].jsonPrimitive.content), args.toString())
  }
}
