package com.aglyn.contracts

/*
 * Where a built-in plugin runs across a workspace's sites (AGL-4047), as the console's plugin-site-exclusions.ts has
 * it: on every site, or on every site except the ones whose `disabledPlugins` names it. The choice is the sites'
 * own lists, so a site left out can switch it back on for itself, and a new site gets it. The planner says which
 * sites' lists a choice rewrites, or why it can't be made: a locked plugin, one off for the workspace, nothing left
 * out, everything left out, or a site where leaving it out strands a plugin that needs it. The Apple kit's
 * PluginRunsOn.swift.
 */

/** One of the workspace's sites, with the lists that decide what runs there. */
data class PluginSiteEntry(val id: String, val disabledPlugins: List<String>? = null, val enabledPlugins: List<String>? = null)

/** Where a plugin runs: every site, or every site except some. */
sealed interface PluginRunsOn {
  data object All : PluginRunsOn
  data class AllExcept(val exceptHostIds: List<String>) : PluginRunsOn
}

/** Whether a site's own list leaves the plugin out (`siteLeavesOutPlugin`). */
fun siteLeavesOutPlugin(site: PluginSiteEntry?, pluginId: String): Boolean = site?.disabledPlugins?.contains(pluginId) == true

/** Where a plugin runs today, read off the sites' lists (`pluginRunsOnOf`). */
fun pluginRunsOnOf(pluginId: String, sites: List<PluginSiteEntry>): PluginRunsOn {
  val except = sites.filter { siteLeavesOutPlugin(it, pluginId) }.map { it.id }
  return if (except.isEmpty()) PluginRunsOn.All else PluginRunsOn.AllExcept(except)
}

private fun nextDisabled(site: PluginSiteEntry, pluginId: String, leaveOut: Boolean): List<String>? {
  val current = site.disabledPlugins.orEmpty()
  if (leaveOut == siteLeavesOutPlugin(site, pluginId)) return null
  return if (leaveOut) current + pluginId else current.filter { it != pluginId }
}

/** One site's list as a choice rewrites it. */
data class PluginSiteWrite(val hostId: String, val disabledPlugins: List<String>, val leftOut: Boolean)

/** A plugin a site would still run without one it needs. */
data class PluginSiteStranding(val hostId: String, val pluginId: String, val missing: List<String>)

/** The writes a choice makes, or why it can't be made (`planPluginRunsOn`). */
data class PluginRunsOnPlan(val writes: List<PluginSiteWrite>?, val problem: String?, val stranded: List<PluginSiteStranding> = emptyList())

/** The plugins on that run without one they need (`strandedDependents`). */
fun strandedDependents(enabledIds: List<String>): List<Pair<String, List<String>>> {
  val enabled = enabledIds.toSet()
  val known = PluginCatalog.plugins.map { it.id }.toSet() + enabled
  return enabledIds.distinct().mapNotNull { pluginId ->
    val missing = pluginRequirements(pluginId).filter { it in known && it !in enabled }
    if (missing.isEmpty()) null else pluginId to missing
  }
}

fun planPluginRunsOn(
  pluginId: String,
  choice: PluginRunsOn,
  orgEnabled: List<String>?,
  sites: List<PluginSiteEntry>,
  siteName: (String) -> String = { it },
): PluginRunsOnPlan {
  fun refuse(problem: String, stranded: List<PluginSiteStranding> = emptyList()) = PluginRunsOnPlan(null, problem, stranded)
  val label = PluginCatalog.label(pluginId)
  if (isLockedOnForSite(pluginId)) return refuse("$label runs on every site, because sites are built out of it, so it can’t be left out.")
  if (pluginId !in resolveEnabledPlugins(orgEnabled)) return refuse("$label is switched off for this workspace, so it runs on no site. Switch it on first.")
  val siteIds = sites.map { it.id }
  val except = (choice as? PluginRunsOn.AllExcept)?.exceptHostIds.orEmpty().distinct().filter { it in siteIds }
  if (choice is PluginRunsOn.AllExcept) {
    if (except.isEmpty()) return refuse("Choose at least one site to leave out, or choose All sites.")
    if (except.size == siteIds.size) return refuse("Keep at least one site in. To stop $label on every site, switch it off for the workspace.")
  }
  val writes = mutableListOf<PluginSiteWrite>()
  val stranded = mutableListOf<PluginSiteStranding>()
  for (site in sites) {
    val leaveOut = site.id in except
    val disabled = nextDisabled(site, pluginId, leaveOut) ?: continue
    if (leaveOut) {
      val before = strandedDependents(resolveHostEnabledPlugins(orgEnabled, site.disabledPlugins, site.enabledPlugins)).map { it.first }.toSet()
      for ((dependent, missing) in strandedDependents(resolveHostEnabledPlugins(orgEnabled, disabled, site.enabledPlugins))) {
        if (dependent !in before) stranded += PluginSiteStranding(site.id, dependent, missing)
      }
    }
    writes += PluginSiteWrite(site.id, disabled, leaveOut)
  }
  if (stranded.isNotEmpty()) {
    val one = stranded.size == 1
    val sentences = stranded.joinToString("; ") { entry ->
      "${PluginCatalog.label(entry.pluginId)} on ${siteName(entry.hostId)} needs ${entry.missing.joinToString(" and ") { PluginCatalog.label(it) }}"
    }
    return refuse(
      "$sentences. Switch ${if (one) "it" else "them"} off on ${if (one) "that site" else "those sites"} first, or keep " +
        "${if (one) "the site" else "those sites"} in.",
      stranded,
    )
  }
  return PluginRunsOnPlan(writes, null)
}

/** What a default-off plugin's Runs on says beside it (`pluginRunsOnOptInNote`). */
fun pluginRunsOnOptInNote(pluginId: String): String? =
  if (isDefaultOffPerSite(pluginId)) {
    "${PluginCatalog.label(pluginId)} still runs only on the sites that turned it on. Leaving a site out here keeps it off there even if that site turned it on."
  } else {
    null
  }
