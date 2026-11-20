package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.DashboardWidgetPrefs
import com.aglyn.core.DashboardWidgets
import com.aglyn.core.Live
import com.aglyn.core.OrgAccess
import com.aglyn.core.UpgradeProposal
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.WidgetSize
import com.aglyn.site.analytics.SiteActivityCard
import com.aglyn.site.analytics.SiteTrafficCard
import com.aglyn.ui.DashboardCustomizeRow
import com.aglyn.ui.DashboardCustomizeSheet
import com.aglyn.ui.DashboardSectionTitle
import com.aglyn.ui.StatsCard
import kotlinx.coroutines.launch
import com.aglyn.ui.space

/*
 * Home as an overview with its numbers (AGL-4011, Figma "Mac / Site / Home · Stats" and "Mac / Workspace / Home"): a
 * site's Home is the console's dashboard (Traffic with View details, the cards the plugins draw, Recent activity); the
 * workspace's Home is the console's organization row (the plan its team proposed, the cards that total every site). The
 * cards themselves are the site module's and the plugins'; this file only places them. The Apple twin is
 * Shared/HomeStats.swift.
 */

/** The console's `orgDashboard` slot: the workspace Home's cards. */
const val ORG_DASHBOARD_SLOT = "orgDashboard"

/**
 * "At a glance": the cards the plugins draw on a site's Home (the console's `commerceGlance` and `hostDashboard`), two
 * to a row, a wide one on a row of its own. Every glance a plugin registers lands here, which is the seam a new one
 * slots into.
 */
@Composable
internal fun HomeGlanceGrid(
  services: ShellServices,
  context: NativePluginContext,
  title: String?,
  slot: String? = null,
  /** The person's arrangement (Customize dashboard): hidden cards leave, the rest keep its order. */
  dashboard: DashboardPrefsState? = null,
) {
  val all = homeGlanceWidgets(services, context, slot)
  val widgets = if (dashboard == null) all else {
    DashboardWidgets.ordered(all.filter { !dashboard.isHidden(DashboardWidgets.storedId(it.id)) }, dashboard.prefs.order) { DashboardWidgets.storedId(it.id) }
  }
  if (widgets.isEmpty()) return
  Column(Modifier.fillMaxWidth().testTag(if (slot == null) "home-glance" else "home-org-glance"), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    if (title != null) DashboardSectionTitle(title)
    GlanceRows(
      widgets.map { widget ->
        val card: @Composable () -> Unit = { Box(Modifier.fillMaxWidth().testTag("widget-${widget.id}")) { widget.content(context) } }
        Pair(widget.size == WidgetSize.FULL, card)
      },
    )
  }
}

/** Two to a row, a full-width card on a row of its own. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GlanceRows(items: List<Pair<Boolean, @Composable () -> Unit>>) {
  Column(verticalArrangement = Arrangement.spacedBy(space(2f))) {
    var pending = mutableListOf<@Composable () -> Unit>()
    val rows = mutableListOf<List<@Composable () -> Unit>>()
    for ((full, content) in items) {
      if (full) {
        if (pending.isNotEmpty()) rows += pending.toList()
        pending = mutableListOf()
        rows += listOf(content)
      } else {
        pending += content
        if (pending.size == 2) {
          rows += pending.toList()
          pending = mutableListOf()
        }
      }
    }
    if (pending.isNotEmpty()) rows += pending.toList()
    rows.forEach { row ->
      androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(space(2f))) {
        row.forEach { content -> Box(Modifier.weight(1f)) { content() } }
      }
    }
  }
}

/** The glance cards the plugins on for the scope draw, in their registered order. */
@Composable
private fun homeGlanceWidgets(services: ShellServices, context: NativePluginContext, slot: String?): List<com.aglyn.pluginhost.NativeWidget> {
  val version by services.registry.version.collectAsState()
  // Only the cards of plugins on for the scope, as the console's slot gates them (a site's set inside a site).
  val workspace = services.workspace.state.collectAsState().value
  val host = liveHostDoc(services, context.hostId)
  val enabled = releasedPlugins(
    enabledPluginsFor(workspace.orgLogo?.enabledPlugins, host?.data, context.hostId != null),
    workspace.org?.id, workspace.orgLogo, staff = false,
  )
  return remember(version, context.hostId, slot, enabled) {
    services.registry.widgets(NativeApp.AGLYN, slot)
      .filter { (context.hostId != null || !it.requiresSite) && (it.pluginId == "core" || it.pluginId in enabled) }
  }
}

/**
 * A site's Home numbers, between Needs you and Pick up. Customize dashboard: the cards the person switched off are not
 * drawn, and none is until the arrangement is read (the console's slots withhold theirs the same way).
 */
@Composable
internal fun HomeSiteStats(services: ShellServices, context: NativePluginContext, hostId: String, openAnalytics: () -> Unit) {
  val dashboard = rememberDashboardPrefs(context)
  if (!dashboard.ready) return
  if (!dashboard.isHidden(DashboardWidgets.trafficId)) SiteTrafficCard(services.firestore, hostId, viewDetails = openAnalytics)
  HomeGlanceGrid(services, context, "At a glance", dashboard = dashboard)
  if (!dashboard.isHidden(DashboardWidgets.ACTIVITY_ID)) {
    SiteActivityCard(services.firestore, services.api, hostId, limit = 5, viewAll = { context.navigate("core.site.activity") })
  }
}

/** A person's arrangement of this workspace's site Home, and the switches that change it (the console's `DashboardWidgetPrefsProvider`). */
internal class DashboardPrefsState(
  val prefs: DashboardWidgetPrefs,
  /** The stored arrangement has arrived (an unreadable one is the ordinary Home). */
  val ready: Boolean,
  val setHidden: (String, Boolean) -> Unit,
  val move: (List<String>, String, Int) -> Unit,
) {
  fun isHidden(widgetId: String) = DashboardWidgets.isHidden(prefs, widgetId)
}

/**
 * Reads `users/{uid}.dashboardWidgets` live and writes each change as it is made: shown at once, saved as a merge of
 * both lists under the workspace's key, so no other workspace's arrangement is read or rewritten.
 */
@Composable
internal fun rememberDashboardPrefs(context: NativePluginContext): DashboardPrefsState {
  val uid = context.uid
  val orgId = context.orgId
  val live by remember(uid) { context.firestore.observeDoc("users/$uid") }.collectAsState(Live.Loading)
  val stored = (live as? Live.Ready)?.value?.data?.get(DashboardWidgets.field)
  var local by remember(uid, orgId) { androidx.compose.runtime.mutableStateOf<DashboardWidgetPrefs?>(null) }
  // A newer stored answer (this person on the web, or the echo of this write) replaces the local one.
  androidx.compose.runtime.LaunchedEffect(stored) { local = null }
  val prefs = local ?: DashboardWidgets.read(stored, orgId)
  val scope = androidx.compose.runtime.rememberCoroutineScope()
  val persist: (DashboardWidgetPrefs) -> Unit = { next ->
    local = next
    if (orgId != null) {
      scope.launch { runCatching { context.writer.merge("users/$uid", mapOf(DashboardWidgets.field to mapOf(orgId to next.stored))) } }
    }
  }
  return DashboardPrefsState(
    prefs,
    ready = live !is Live.Loading,
    setHidden = { id, hidden -> persist(DashboardWidgets.setHidden(prefs, id, hidden)) },
    move = { group, id, delta -> persist(DashboardWidgets.move(prefs, group, id, delta)) },
  )
}

/** Customize dashboard for a site's Home, opened from its header (the console's button beside Visit site). */
@Composable
internal fun HomeDashboardCustomize(services: ShellServices, context: NativePluginContext, onDismiss: () -> Unit) {
  val dashboard = rememberDashboardPrefs(context)
  val glance = DashboardWidgets.ordered(homeGlanceWidgets(services, context, null), dashboard.prefs.order) { DashboardWidgets.storedId(it.id) }
  val group = glance.map { DashboardWidgets.storedId(it.id) }
  val rows = listOf(DashboardCustomizeRow(DashboardWidgets.trafficId, "Traffic")) +
    glance.map { DashboardCustomizeRow(DashboardWidgets.storedId(it.id), it.title, group) } +
    DashboardCustomizeRow(DashboardWidgets.ACTIVITY_ID, "Recent activity", listOf(DashboardWidgets.ACTIVITY_ID))
  DashboardCustomizeSheet(rows, dashboard.ready, dashboard::isHidden, dashboard.setHidden, dashboard.move, onDismiss)
}

/**
 * The console's `OrgUpgradeProposalCard`: the plan the workspace's team proposed, only for the people who may buy it
 * (`billing.manage`, custom roles included), only while the proposal stands. Never in a store build, which takes no payment
 * to Aglyn (the owner's decision of 2026-11-19): the card is a plan to buy and nothing else.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun HomeUpgradeProposal(services: ShellServices, context: NativePluginContext, org: Map<String, Any?>?, orgName: String?, orgSlug: String?, productName: String) {
  if (!com.aglyn.core.StoreBilling.buying) return
  val proposal = UpgradeProposal.standing(org) ?: return
  val workspace = services.workspace.state.collectAsState().value
  // `billing.manage` as the console resolves it: the role's grants, the custom role, the member's own overrides.
  if (rememberCreateGates(services, workspace, context.uid).permissions["billing.manage"] != true || orgSlug == null) return
  StatsCard(Modifier.testTag("home-upgrade-proposal")) {
    FlowRow(
      Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalArrangement = Arrangement.spacedBy(space(1f)),
      itemVerticalAlignment = Alignment.CenterVertically,
    ) {
      Text(proposal.headline(orgName, productName), Modifier.widthIn(max = space(80f)), style = MaterialTheme.typography.titleMedium)
      Button(onClick = { context.openLink(proposal.destination(orgSlug)) }, modifier = Modifier.testTag("home-upgrade-review")) { Text("Review the plan") }
    }
    // The bundle proposed with the plan, named so the owner knows what Billing will have chosen (AGL-3956).
    if (proposal.bundled) Text(proposal.summary, style = MaterialTheme.typography.titleSmall)
    Text(proposal.body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    proposal.note?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
  }
}

/**
 * The console's `OrgDashboardWidgets`: the cards total the whole workspace, so only an org-wide member who may open the
 * workspace's CRM (`data.manage`) sees the row.
 */
@Composable
internal fun HomeOrgGlance(services: ShellServices, context: NativePluginContext, orgId: String) {
  val member by remember(orgId, context.uid) { services.firestore.observeDoc("orgs/$orgId/members/${context.uid}") }.collectAsState(Live.Loading)
  val reach = (member as? Live.Ready)?.value?.data?.let { OrgAccess.isOrgWideMember(it) } == true
  val workspace = services.workspace.state.collectAsState().value
  if (!reach || rememberCreateGates(services, workspace, context.uid).permissions["data.manage"] != true) return
  HomeGlanceGrid(services, context, "At a glance", ORG_DASHBOARD_SLOT)
}
