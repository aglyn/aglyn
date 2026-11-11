package com.aglyn.screens

import com.aglyn.contracts.FirstPartyPlugin
import com.aglyn.contracts.PluginCatalog
import com.aglyn.contracts.PluginSiteState
import com.aglyn.contracts.SitePluginLists
import com.aglyn.contracts.applySitePluginSwitch
import com.aglyn.contracts.isDefaultOffPerSite
import com.aglyn.contracts.isLockedOnForSite
import com.aglyn.contracts.isLockedOnForWorkspace
import com.aglyn.contracts.pluginDependents
import com.aglyn.contracts.pluginRequirements
import com.aglyn.contracts.resolveDisableCascade
import com.aglyn.contracts.resolveEnabledPlugins
import com.aglyn.contracts.resolveHostEnabledPlugins
import com.aglyn.contracts.resolvePluginSiteState
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The plugin switchboard as rows a spec draws: a `{ "switchboard": "org" }`
 * or `"site"` load. It reads the same documents the console's switchboards
 * read (`orgs/{org}`, and `hosts/{site}` for a site) and resolves them with
 * the ported enabled-plugins resolvers, so each row carries what it shows (on,
 * locked, the site state, what switching it off strands) and the exact lists
 * its switch writes: the workspace list sent to `/api/orgs/settings`, or the
 * site's `disabledPlugins` and `enabledPlugins` merged into the host document
 * under the rules.
 */
internal object SwitchboardRows {
  fun stringList(value: JsonElement?): List<String>? =
    (value as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }

  private fun labels(ids: List<String>): JsonElement =
    if (ids.isEmpty()) JsonNull else JsonPrimitive(ids.joinToString(", ") { PluginCatalog.label(it) })

  private fun strings(ids: List<String>): JsonElement = JsonArray(ids.map(::JsonPrimitive))

  private fun base(plugin: FirstPartyPlugin): MutableMap<String, JsonElement> = mutableMapOf(
    "id" to JsonPrimitive(plugin.id),
    "label" to JsonPrimitive(plugin.label),
    "description" to (plugin.description?.let(::JsonPrimitive) ?: JsonNull),
    "requires" to labels(pluginRequirements(plugin.id)),
    "dependents" to labels(pluginDependents(plugin.id)),
    "defaultOff" to JsonPrimitive(isDefaultOffPerSite(plugin.id)),
    "stops" to (plugin.siteOff?.stops?.let(::JsonPrimitive) ?: JsonNull),
    "keeps" to (plugin.siteOff?.keeps?.let(::JsonPrimitive) ?: JsonNull),
  )

  /** The workspace switchboard over `orgs/{org}`. */
  fun org(orgDoc: JsonElement): JsonElement {
    val stored = stringList((orgDoc as? JsonObject)?.get("enabledPlugins"))
    val enabled = resolveEnabledPlugins(stored)
    val rows = PluginCatalog.plugins.map { plugin ->
      val row = base(plugin)
      val locked = isLockedOnForWorkspace(plugin.id)
      val cascade = resolveDisableCascade(plugin.id, enabled)
      row["locked"] = JsonPrimitive(locked)
      row["on"] = JsonPrimitive(locked || plugin.id in enabled)
      row["cascade"] = labels(cascade)
      row["enable"] = strings(if (plugin.id in enabled) enabled else enabled + plugin.id)
      row["disable"] = strings(enabled.filter { it != plugin.id && it !in cascade })
      JsonObject(row)
    }
    return JsonObject(mapOf("rows" to JsonArray(rows), "stored" to JsonPrimitive(stored != null)))
  }

  /** One site's switchboard over `orgs/{org}` and `hosts/{site}`. */
  fun site(orgDoc: JsonElement, hostDoc: JsonElement): JsonElement {
    val orgEnabled = stringList((orgDoc as? JsonObject)?.get("enabledPlugins"))
    val host = hostDoc as? JsonObject
    val lists = SitePluginLists(stringList(host?.get("disabledPlugins")).orEmpty(), stringList(host?.get("enabledPlugins")).orEmpty())
    val running = resolveHostEnabledPlugins(orgEnabled, lists.disabled, lists.optedIn)
    val workspace = resolveEnabledPlugins(orgEnabled)
    val rows = PluginCatalog.plugins.map { plugin ->
      val row = base(plugin)
      val state = resolvePluginSiteState(orgEnabled, lists.disabled, lists.optedIn, plugin.id)
      val cascade = resolveDisableCascade(plugin.id, running)
      val turnOn = applySitePluginSwitch(lists, listOf(plugin.id), on = true)
      val turnOff = applySitePluginSwitch(lists, listOf(plugin.id) + cascade, on = false)
      row["state"] = JsonPrimitive(state.raw)
      row["on"] = JsonPrimitive(state == PluginSiteState.RunsHere || state == PluginSiteState.AlwaysOn)
      row["locked"] = JsonPrimitive(isLockedOnForSite(plugin.id))
      row["workspaceOn"] = JsonPrimitive(plugin.id in workspace)
      row["cascade"] = labels(cascade)
      row["confirmOff"] = JsonPrimitive(cascade.isNotEmpty() || plugin.siteOff?.confirm == true)
      row["turnOn"] = JsonObject(mapOf("disabledPlugins" to strings(turnOn.disabled), "enabledPlugins" to strings(turnOn.optedIn)))
      row["turnOff"] = JsonObject(mapOf("disabledPlugins" to strings(turnOff.disabled), "enabledPlugins" to strings(turnOff.optedIn)))
      JsonObject(row)
    }
    return JsonObject(mapOf("rows" to JsonArray(rows)))
  }

  /**
   * The site's two lists after switching [pluginId] on or off over `orgs/{org}` and `hosts/{site}` as stored now, the
   * same move a row's `turnOn` / `turnOff` makes (switching off takes the plugins that need it along).
   */
  fun switched(orgDoc: JsonElement, hostDoc: JsonElement, pluginId: String, on: Boolean): JsonObject {
    val orgEnabled = stringList((orgDoc as? JsonObject)?.get("enabledPlugins"))
    val host = hostDoc as? JsonObject
    val lists = SitePluginLists(stringList(host?.get("disabledPlugins")).orEmpty(), stringList(host?.get("enabledPlugins")).orEmpty())
    val running = resolveHostEnabledPlugins(orgEnabled, lists.disabled, lists.optedIn)
    val ids = if (on) listOf(pluginId) else listOf(pluginId) + resolveDisableCascade(pluginId, running)
    val next = applySitePluginSwitch(lists, ids, on)
    return JsonObject(mapOf("disabledPlugins" to strings(next.disabled), "enabledPlugins" to strings(next.optedIn)))
  }

  /** What a held switch says while the site's lists are not yet the server's (`SITE_PLUGINS_CHECKING_TEXT`). */
  const val CHECKING_TEXT = "Checking this site’s plugin list with the server…"

  /** Why a switch did not save (`writeGuardedBySeed`'s words for the site plugin list). */
  const val UNCONFIRMED_TEXT =
    "We could not confirm your site plugin list with the server yet, so nothing was saved. Check your connection and try again in a moment."
  const val UNREADABLE_TEXT =
    "Your site plugin list could not be loaded, so there is nothing safe to save — saving now would overwrite the stored copy with blanks. Reload and try again."
}
