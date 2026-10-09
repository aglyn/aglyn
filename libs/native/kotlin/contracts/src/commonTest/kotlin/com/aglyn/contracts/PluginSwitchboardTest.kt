package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Replays the console's switchboard answers (enabled-plugins.ts) from
 * function-cases.generated.json, so the native Plugins screens resolve what
 * runs, and what switching one off strands, exactly as the console does.
 */
class PluginSwitchboardTest {
  private val functions =
    ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
      it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
    }.also { assertTrue(it.isNotEmpty(), "$name has no cases") }

  private fun list(value: JsonElement?, key: String): List<String>? =
    ((value as? JsonObject)?.get(key) as? JsonArray)?.map { it.jsonPrimitive.content }

  private fun strings(value: JsonElement): List<String> = value.jsonArray.map { it.jsonPrimitive.content }

  private fun str(value: JsonElement): String = (value as JsonPrimitive).content

  @Test
  fun catalogDecodesWithTheBaseLibraryLocked() {
    assertTrue(PluginCatalog.plugins.isNotEmpty())
    assertTrue(isLockedOnForSite("mui"))
    assertEquals("listing-xyz", PluginCatalog.label("listing-xyz"))
  }

  @Test
  fun workspaceListsResolveAsTheConsole() = cases("resolveEnabledPlugins").forEach { (args, result) ->
    assertEquals(strings(result), resolveEnabledPlugins(list(args.firstOrNull(), "enabledPlugins")), args.toString())
  }

  @Test
  fun siteListsResolveAsTheConsole() = cases("resolveHostEnabledPlugins").forEach { (args, result) ->
    val org = args[0]
    val host = args[1]
    assertEquals(
      strings(result),
      resolveHostEnabledPlugins(list(org, "enabledPlugins"), list(host, "disabledPlugins"), list(host, "enabledPlugins")),
      args.toString(),
    )
  }

  @Test
  fun siteStatesReadAsTheConsole() = cases("resolvePluginSiteState").forEach { (args, result) ->
    val org = args[0]
    val host = args[1]
    val state = resolvePluginSiteState(list(org, "enabledPlugins"), list(host, "disabledPlugins"), list(host, "enabledPlugins"), str(args[2]))
    assertEquals(str(result), state.raw, args.toString())
  }

  @Test
  fun cascadesAndEdgesMatchTheConsole() {
    cases("resolveDisableCascade").forEach { (args, result) ->
      assertEquals(strings(result), resolveDisableCascade(str(args[0]), strings(args[1])), args.toString())
    }
    cases("pluginRequirements").forEach { (args, result) -> assertEquals(strings(result), pluginRequirements(str(args[0])), args.toString()) }
    cases("pluginDependents").forEach { (args, result) -> assertEquals(strings(result), pluginDependents(str(args[0])), args.toString()) }
  }

  @Test
  fun locksMatchTheConsole() {
    cases("isLockedOnForWorkspace").forEach { (args, result) -> assertEquals(result.jsonPrimitive.boolean, isLockedOnForWorkspace(str(args[0])), args.toString()) }
    cases("isLockedOnForSite").forEach { (args, result) -> assertEquals(result.jsonPrimitive.boolean, isLockedOnForSite(str(args[0])), args.toString()) }
    cases("isDefaultOffPerSite").forEach { (args, result) -> assertEquals(result.jsonPrimitive.boolean, isDefaultOffPerSite(str(args[0])), args.toString()) }
  }

  /** The site switch writes the list the console's hook writes: a default-off plugin records consent, everything else refusal. */
  @Test
  fun siteSwitchWritesConsentOrRefusal() {
    val defaultOff = PluginCatalog.plugins.first { it.defaultOffPerSite == true }.id
    var lists = applySitePluginSwitch(SitePluginLists(listOf(defaultOff), emptyList()), listOf(defaultOff), on = true)
    assertEquals(SitePluginLists(emptyList(), listOf(defaultOff)), lists)
    lists = applySitePluginSwitch(lists, listOf(defaultOff), on = false)
    assertEquals(emptyList(), lists.optedIn)
    lists = applySitePluginSwitch(SitePluginLists(emptyList(), emptyList()), listOf("crm", "crm"), on = false)
    assertEquals(listOf("crm"), lists.disabled)
    lists = applySitePluginSwitch(lists, listOf("crm"), on = true)
    assertEquals(emptyList(), lists.disabled)
  }
}
