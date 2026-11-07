package com.aglyn.site

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.PluginCatalog
import com.aglyn.contracts.PluginRunsOn
import com.aglyn.contracts.PluginSiteEntry
import com.aglyn.contracts.isLockedOnForSite
import com.aglyn.contracts.isLockedOnForWorkspace
import com.aglyn.contracts.orgPermissionLabel
import com.aglyn.contracts.permissionRefusalText
import com.aglyn.contracts.planPluginRunsOn
import com.aglyn.contracts.pluginRunsOnOf
import com.aglyn.contracts.pluginRunsOnOptInNote
import com.aglyn.contracts.resolveEnabledPlugins
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.Live
import com.aglyn.pluginhost.LocalSlotParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.ScopeSharingChoice
import com.aglyn.pluginhost.SharingSite
import com.aglyn.pluginhost.SiteSharingField
import com.aglyn.pluginhost.SiteSharingMode
import com.aglyn.pluginhost.rememberMemberPermissions
import com.aglyn.pluginhost.rememberWorkspaceSites
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/*
 * Where a built-in plugin runs (AGL-4047), as the console's PluginRunsOnField has it on a plugin's page: every site, or
 * every site except some. The choice is the sites' own `disabledPlugins`, so a site left out can switch it back on for
 * itself, and a new site gets it; Save sends the choice to `/api/orgs/plugin-sites`, which writes those lists. Drawn in
 * the plugin page's `pluginRunsOn` zone, given `pluginId`. The Apple kit's PluginRunsOnSection.swift.
 */

const val PLUGIN_RUNS_ON_SLOT = "pluginRunsOn"
const val PLUGIN_RUNS_ON_WIDGET = "site.plugin-runs-on"

private fun count(n: Int) = if (n == 1) "1 site" else "$n sites"

private fun strings(value: Any?): List<String>? = (value as? List<*>)?.filterIsInstance<String>()

@Composable
fun PluginRunsOnSection(context: NativePluginContext) {
  val pluginId = LocalSlotParams.current["pluginId"].orEmpty()
  val orgId = context.orgId ?: return
  // Sites are built out of an always-on plugin, so it has nowhere to choose; the console shows nothing for it either.
  if (pluginId.isEmpty() || PluginCatalog.plugins.none { it.id == pluginId } || isLockedOnForSite(pluginId)) return
  val plugin = PluginCatalog.plugins.first { it.id == pluginId }
  val label = plugin.label
  val coroutines = rememberCoroutineScope()
  val org by remember(orgId) { context.firestore.observeDoc("orgs/$orgId") }.collectAsState(Live.Loading)
  val orgData = (org as? Live.Ready)?.value?.data
  val orgEnabled = strings(orgData?.get("enabledPlugins"))
  val names = (rememberWorkspaceSites(context) as? Live.Ready)?.value.orEmpty().associate { it.id to it.name }
  // The workspace's sites (`orgs/{org}.hosts`), each read for the lists that decide what runs there.
  val hostIds = (orgData?.get("hosts") as? Map<*, *>)?.filter { (_, on) -> on == true }?.keys?.map { it.toString() }?.sorted().orEmpty()
  val entries = hostIds.map { hostId ->
    key(hostId) {
      val host by remember(hostId) { context.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading)
      hostId to (host as? Live.Ready)?.value?.data
    }
  }
  val sitesReady = org is Live.Ready && entries.all { it.second != null }
  val sites = entries.mapNotNull { (id, data) -> data?.let { PluginSiteEntry(id, strings(it["disabledPlugins"]), strings(it["enabledPlugins"])) } }
  val siteName = { hostId: String -> names[hostId] ?: entries.firstOrNull { it.first == hostId }?.second?.get("displayName") as? String ?: "a site" }
  val permissions = rememberMemberPermissions(context)
  val canChange = permissions.workspace["org.settings"] == true

  val stored = pluginRunsOnOf(pluginId, sites)
  var draft by remember(pluginId) { mutableStateOf<PluginRunsOn?>(null) }
  var busy by remember { mutableStateOf(false) }
  var refusal by remember { mutableStateOf<String?>(null) }
  var notice by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(stored) {
    draft = null
    refusal = null
  }
  val choice = draft ?: stored
  val dirty = draft != null && draft != stored &&
    !(draft is PluginRunsOn.AllExcept && stored is PluginRunsOn.AllExcept && (draft as PluginRunsOn.AllExcept).exceptHostIds.toSet() == stored.exceptHostIds.toSet())
  val plan = if (sitesReady) planPluginRunsOn(pluginId, choice, orgEnabled, sites, siteName) else null
  val locked = isLockedOnForSite(pluginId)
  val onForWorkspace = if (org is Live.Ready) pluginId in resolveEnabledPlugins(orgEnabled) || isLockedOnForWorkspace(pluginId) else null
  val readOnlyReason = when {
    locked -> "Sites are built out of it, so it runs on every site."
    onForWorkspace == false -> "It is switched off for this workspace, so it runs on no site. Switch it on to choose where it runs."
    !canChange -> permissionRefusalText("org.settings")
    else -> null
  }
  val readOnly = locked || onForWorkspace != true || !canChange || busy

  fun save() {
    val ready = plan ?: return
    if (!dirty || ready.problem != null) return
    busy = true
    refusal = null
    coroutines.launch {
      try {
        val body = mapOf(
          "orgId" to JsonPrimitive(orgId),
          "pluginId" to JsonPrimitive(pluginId),
          "choice" to when (choice) {
            PluginRunsOn.All -> JsonObject(mapOf("mode" to JsonPrimitive("all")))
            is PluginRunsOn.AllExcept -> JsonObject(mapOf("mode" to JsonPrimitive("allExcept"), "exceptHostIds" to JsonArray(choice.exceptHostIds.map(::JsonPrimitive))))
          },
        )
        context.api.request("/api/orgs/plugin-sites", ApiMethod.POST, JsonObject(body))
        notice = "Saved where $label runs"
        draft = null
      } catch (failure: Throwable) {
        if (failure is kotlinx.coroutines.CancellationException) throw failure
        refusal = (((failure as? ConsoleApiError)?.body as? JsonObject)?.get("error") as? JsonPrimitive)?.contentOrNull ?: "Request failed"
      } finally {
        busy = false
      }
    }
  }

  val leftOut = plan?.writes?.count { it.leftOut } ?: 0
  val broughtBack = plan?.writes?.count { !it.leftOut } ?: 0
  val caption = @Composable { text: String -> Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
  SectionCard(null, Modifier.fillMaxWidth().testTag("plugin-runs-on")) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      notice?.let { NoticeBanner(it, StatusTone.SUCCESS) }
      SiteSharingField(
        value = if (locked) ScopeSharingChoice.All else when (choice) {
          PluginRunsOn.All -> ScopeSharingChoice.All
          is PluginRunsOn.AllExcept -> ScopeSharingChoice.AllExcept(choice.exceptHostIds)
        },
        onChange = { next ->
          refusal = null
          notice = null
          draft = if (next is ScopeSharingChoice.AllExcept) PluginRunsOn.AllExcept(next.exceptHostIds) else PluginRunsOn.All
        },
        sites = sites.map { SharingSite(it.id, siteName(it.id)) },
        sitesReady = sitesReady,
        label = "Runs on",
        modes = listOf(SiteSharingMode.ALL, SiteSharingMode.ALL_EXCEPT),
        readOnly = readOnly,
        readOnlyReason = readOnlyReason,
        problem = if (!readOnly && dirty) plan?.problem ?: refusal else refusal,
      )
      if (!locked) {
        caption(
          "A site left out can turn it back on for itself: anyone holding “${orgPermissionLabel("site.manage")}” on that site, which its admins hold by default, " +
            "can switch it on from the site’s Admin › Plugins page.",
        )
        pluginRunsOnOptInNote(pluginId)?.let { caption(it) }
        if (choice is PluginRunsOn.AllExcept) plugin.siteOff?.stops?.let { caption("On each site left out: $it") }
      }
      if (dirty && !readOnly) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          val summary = if (plan != null && plan.problem == null && (leftOut > 0 || broughtBack > 0)) {
            listOfNotNull(
              if (leftOut > 0) "Takes $label off ${count(leftOut)}." else null,
              if (broughtBack > 0) "Turns it back on for ${count(broughtBack)}." else null,
            ).joinToString(" ")
          } else {
            ""
          }
          Text(summary, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          TextButton(onClick = { draft = null }, enabled = !busy) { Text("Cancel") }
          Button(onClick = ::save, enabled = !busy && plan != null && plan.problem == null, modifier = Modifier.testTag("plugin-runs-on-save")) { Text("Save") }
        }
      }
    }
  }
}
