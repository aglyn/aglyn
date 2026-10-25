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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.Live
import com.aglyn.core.OrgAccess
import com.aglyn.core.UpgradeProposal
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.WidgetSize
import com.aglyn.site.analytics.SiteActivityCard
import com.aglyn.site.analytics.SiteTrafficCard
import com.aglyn.ui.DashboardSectionTitle
import com.aglyn.ui.StatsCard
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
internal fun HomeGlanceGrid(services: ShellServices, context: NativePluginContext, title: String?, slot: String? = null) {
  val version by services.registry.version.collectAsState()
  // Only the cards of plugins on for the scope, as the console's slot gates them (a site's set inside a site).
  val workspace = services.workspace.state.collectAsState().value
  val host = liveHostDoc(services, context.hostId)
  val enabled = releasedPlugins(
    enabledPluginsFor(workspace.orgLogo?.enabledPlugins, host?.data, context.hostId != null),
    workspace.org?.id, workspace.orgLogo, staff = false,
  )
  val widgets = remember(version, context.hostId, slot, enabled) {
    services.registry.widgets(NativeApp.AGLYN, slot)
      .filter { (context.hostId != null || !it.requiresSite) && (it.pluginId == "core" || it.pluginId in enabled) }
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

/** A site's Home numbers, between Needs you and Pick up. */
@Composable
internal fun HomeSiteStats(services: ShellServices, context: NativePluginContext, hostId: String, openAnalytics: () -> Unit) {
  SiteTrafficCard(services.firestore, hostId, viewDetails = openAnalytics)
  HomeGlanceGrid(services, context, "At a glance")
  SiteActivityCard(services.firestore, services.api, hostId, limit = 5, viewAll = { context.navigate("core.site.activity") })
}

/**
 * The console's `OrgUpgradeProposalCard`: the plan the workspace's team proposed, only for the people who may buy it
 * (`billing.manage`, owner and admin by default), only while the proposal stands.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun HomeUpgradeProposal(context: NativePluginContext, org: Map<String, Any?>?, orgName: String?, orgSlug: String?, productName: String) {
  val proposal = UpgradeProposal.standing(org) ?: return
  if (context.orgRole !in setOf("owner", "admin") || orgSlug == null) return
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
  if (!reach || context.orgRole !in setOf("owner", "admin", "editor")) return
  HomeGlanceGrid(services, context, "At a glance", ORG_DASHBOARD_SLOT)
}
