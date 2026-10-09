package com.aglyn.contracts

// The console's plugin switchboard resolvers, ported once from
// libs/aglyn/src/lib/plugin-manager/enabled-plugins.ts over the generated
// first-party catalog (FIRST_PARTY_PLUGINS). function-cases.generated.json
// holds the answers the TypeScript gives, and the tests replay every one.
// Lists keep the TypeScript's order: a JavaScript Set keeps insertion order.

/** The first-party plugin catalog the console's switchboards list. */
object PluginCatalog {
  val plugins: List<FirstPartyPlugin> get() = Contracts.firstPartyPlugins

  fun plugin(id: String): FirstPartyPlugin? = plugins.firstOrNull { it.id == id }

  /** The catalog label, else the raw id (a marketplace listing's). */
  fun label(id: String): String = plugin(id)?.label ?: id

  /** Every first-party plugin: what a workspace with no stored list runs. */
  val defaultEnabled: List<String> get() = plugins.map { it.id }

  internal val alwaysOn: List<String> get() = plugins.filter { it.alwaysOn == true }.map { it.id }

  internal val alwaysOnForWorkspace: List<String>
    get() = plugins.filter { it.alwaysOn == true || it.alwaysOnForWorkspace == true }.map { it.id }

  internal val defaultOffPerSite: Set<String> get() = plugins.filter { it.defaultOffPerSite == true }.map { it.id }.toSet()
}

fun isLockedOnForWorkspace(pluginId: String): Boolean = pluginId in PluginCatalog.alwaysOnForWorkspace

fun isLockedOnForSite(pluginId: String): Boolean = pluginId in PluginCatalog.alwaysOn

fun isDefaultOffPerSite(pluginId: String): Boolean = pluginId in PluginCatalog.defaultOffPerSite

/** The plugins a workspace runs: its stored list plus the locked ones, or every first-party plugin when it never stored one. */
fun resolveEnabledPlugins(configured: List<String>?): List<String> {
  if (configured == null) return PluginCatalog.defaultEnabled
  return (PluginCatalog.alwaysOnForWorkspace + configured.distinct()).distinct()
}

/** Drops a default-off plugin the site has not opted into. */
fun applyDefaultOffOptIn(pluginIds: List<String>, optedIn: List<String>?): List<String> {
  val defaultOff = PluginCatalog.defaultOffPerSite
  if (defaultOff.isEmpty()) return pluginIds
  val asked = optedIn.orEmpty().toSet()
  return pluginIds.filter { it !in defaultOff || it in asked }
}

/** Drops what a site refused, except the always-on base library. */
fun subtractDisabledPlugins(pluginIds: List<String>, disabled: List<String>?): List<String> {
  if (disabled.isNullOrEmpty()) return pluginIds
  val refused = disabled.toSet()
  val alwaysOn = PluginCatalog.alwaysOn
  return pluginIds.filter { it in alwaysOn || it !in refused }
}

/** What runs on one site: the workspace's plugins, less a default-off one the site never asked for, less what it refused. */
fun resolveHostEnabledPlugins(orgEnabled: List<String>?, hostDisabled: List<String>?, hostEnabled: List<String>?): List<String> =
  subtractDisabledPlugins(applyDefaultOffOptIn(resolveEnabledPlugins(orgEnabled), hostEnabled), hostDisabled)

/** Why a plugin does or does not run on a site, as the console words its state. */
enum class PluginSiteState(val raw: String) {
  AlwaysOn("always-on"),
  OffForWorkspace("off-for-workspace"),
  RunsHere("runs-here"),
  AwaitingOptIn("awaiting-opt-in"),
  OffForSite("off-for-site"),
}

fun resolvePluginSiteState(
  orgEnabled: List<String>?,
  hostDisabled: List<String>?,
  hostEnabled: List<String>?,
  pluginId: String,
): PluginSiteState {
  if (pluginId in PluginCatalog.alwaysOn) return PluginSiteState.AlwaysOn
  if (pluginId !in resolveEnabledPlugins(orgEnabled)) return PluginSiteState.OffForWorkspace
  if (pluginId in resolveHostEnabledPlugins(orgEnabled, hostDisabled, hostEnabled)) return PluginSiteState.RunsHere
  val denied = hostDisabled?.contains(pluginId) ?: false
  return if (!denied && isDefaultOffPerSite(pluginId)) PluginSiteState.AwaitingOptIn else PluginSiteState.OffForSite
}

private class DependencyEdges(val dependents: Map<String, List<String>>, val requires: Map<String, List<String>>)

private fun dependencyEdges(): DependencyEdges {
  val dependents = linkedMapOf<String, MutableList<String>>()
  val requires = linkedMapOf<String, MutableList<String>>()
  for (plugin in PluginCatalog.plugins) {
    for (required in plugin.requires.orEmpty()) {
      dependents.getOrPut(required) { mutableListOf() }.add(plugin.id)
      requires.getOrPut(plugin.id) { mutableListOf() }.add(required)
    }
  }
  return DependencyEdges(dependents, requires)
}

/** The plugins this one needs on. */
fun pluginRequirements(pluginId: String): List<String> = dependencyEdges().requires[pluginId].orEmpty()

/** The plugins that need this one on. */
fun pluginDependents(pluginId: String): List<String> = dependencyEdges().dependents[pluginId].orEmpty()

/** The enabled plugins switching this one off would strand, breadth first, as the console's confirmation lists them. */
fun resolveDisableCascade(pluginId: String, enabled: List<String>): List<String> {
  val on = enabled.toSet()
  val dependents = dependencyEdges().dependents
  val seen = mutableSetOf(pluginId)
  val cascade = mutableListOf<String>()
  val queue = ArrayDeque(listOf(pluginId))
  while (queue.isNotEmpty()) {
    val current = queue.removeFirst()
    for (dependent in dependents[current].orEmpty()) {
      if (!seen.add(dependent)) continue
      if (dependent in on) cascade.add(dependent)
      queue.addLast(dependent)
    }
  }
  return cascade
}

/** A site's two plugin lists, as its host document stores them. */
data class SitePluginLists(val disabled: List<String>, val optedIn: List<String>)

/**
 * A site's two plugin lists after switching [pluginIds] on or off, as the
 * console's site switchboard writes them: a default-off plugin records
 * consent in `enabledPlugins` (and turning it on also stops refusing it);
 * every other plugin records refusal in `disabledPlugins`.
 */
fun applySitePluginSwitch(lists: SitePluginLists, pluginIds: List<String>, on: Boolean): SitePluginLists {
  val disabled = lists.disabled.toMutableList()
  val optedIn = lists.optedIn.toMutableList()
  for (pluginId in pluginIds) {
    if (isDefaultOffPerSite(pluginId)) {
      if (on) {
        if (pluginId !in optedIn) optedIn.add(pluginId)
        disabled.removeAll { it == pluginId }
      } else {
        optedIn.removeAll { it == pluginId }
      }
      continue
    }
    if (on) disabled.removeAll { it == pluginId } else if (pluginId !in disabled) disabled.add(pluginId)
  }
  return SitePluginLists(disabled, optedIn)
}
