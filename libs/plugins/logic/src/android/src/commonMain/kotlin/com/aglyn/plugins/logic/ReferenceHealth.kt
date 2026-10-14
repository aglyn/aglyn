package com.aglyn.plugins.logic

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.ORG_SCOPE_TOKEN
import com.aglyn.contracts.hostScopeToken
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

/** How much of each collection the audit judges against: one number so every window agrees. */
internal const val REFERENCE_CEILING = 100

private fun windowQuery(path: String, filters: List<FirestoreFilter> = emptyList()) =
  FirestoreQuery(path, filters = filters, orderBy = listOf(FirestoreOrder("__name__")), limit = REFERENCE_CEILING + 1)

private class Window(val rows: List<FirestoreDoc>, val truncated: Boolean, val loaded: Boolean)

@Composable
private fun window(context: NativePluginContext, query: FirestoreQuery?): Window {
  val live by remember(query, context.firestore) { query?.let { context.firestore.observe(it) } ?: kotlinx.coroutines.flow.flowOf(Live.Ready(emptyList())) }.collectAsState(Live.Loading)
  val docs = (live as? Live.Ready)?.value
  return Window(docs.orEmpty().take(REFERENCE_CEILING), (docs?.size ?: 0) > REFERENCE_CEILING, docs != null && query != null)
}

/**
 * Reference health: every automation, workflow and computed-variable reference cross-checked against what still
 * exists, so broken wiring surfaces here instead of failing silently on a visitor's pageview.
 */
@Composable
fun ReferenceHealth(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val orgId = context.orgId
  val tokens = listOf(ORG_SCOPE_TOKEN, hostScopeToken(hostId))
  val shared = listOf(FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, tokens))
  fun host(name: String) = windowQuery("hosts/$hostId/$name")
  val actions = window(context, remember(hostId) { host("actions") })
  val workflows = window(context, remember(hostId) { host("workflows") })
  val variables = window(context, remember(hostId) { host("variables") })
  val functions = window(context, remember(hostId) { host("functions") })
  val overlays = window(context, remember(hostId) { host("overlays") })
  val webhooks = window(context, remember(hostId) { host("webhooks") })
  val screens = window(context, remember(hostId) { host("screens") })
  val datasets = window(context, remember(orgId, hostId) { orgId?.let { windowQuery("orgs/$it/datasets", shared) } })
  val campaigns = window(context, remember(orgId, hostId) { orgId?.let { windowQuery("orgs/$it/emailCampaigns", shared) } })
  val lists = window(context, remember(orgId) { orgId?.let { windowQuery("orgs/$it/lists") } })
  val all = listOf(actions, workflows, variables, functions, overlays, webhooks, screens, datasets, campaigns, lists)
  val loaded = listOf(actions, workflows, variables, functions, overlays, webhooks, screens).all { it.loaded }
  if (!loaded) return SkeletonList(rows = 4, modifier = Modifier.padding(space(2f)))
  val truncated = all.any { it.truncated }
  val issues = auditHostReferences(
    actions = actions.rows.filter { it.alive() },
    workflows = workflows.rows.filter { it.alive() },
    variables = variables.rows.filter { it.alive() },
    known = KnownTargets(
      workflows = knownSet(workflows.rows),
      functions = knownSet(functions.rows),
      datasets = datasets.takeIf { it.loaded }?.let { knownSet(it.rows.map { doc -> doc }, "displayName") + knownSet(it.rows) },
      lists = lists.takeIf { it.loaded }?.let { knownSet(it.rows) },
      campaigns = campaigns.takeIf { it.loaded }?.let { knownSet(it.rows) },
      overlays = knownSet(overlays.rows),
      webhooks = knownSet(webhooks.rows),
      screens = knownSet(screens.rows, "displayName"),
    ),
  )
  LazyColumn(Modifier.fillMaxSize().testTag("reference-health"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    if (truncated) {
      item {
        NoticeBanner(
          "Audited against the first $REFERENCE_CEILING rows of each collection, ordered by id. At least one of them holds more, so a step pointing past that window is listed here as broken when it is not, and a step held past it is not checked at all.",
          StatusTone.INFO,
          Modifier.padding(horizontal = space(2f)),
        )
      }
    }
    if (issues.isEmpty()) {
      item {
        NoticeBanner(
          if (truncated) "Every reference the audit read resolves." else "Every automation, workflow, and variable reference resolves.",
          StatusTone.SUCCESS,
          Modifier.padding(horizontal = space(2f)).testTag("health-ok"),
        )
      }
    } else {
      item {
        NoticeBanner(
          "${issues.size} broken reference${if (issues.size == 1) "" else "s"} — these steps do nothing until re-pointed or removed.",
          StatusTone.WARNING,
          Modifier.padding(horizontal = space(2f)).testTag("health-broken"),
        )
      }
      items(issues) { issue ->
        AglynListItem(
          title = issue.sourceName,
          supporting = "${issue.source} → missing ${issue.refType} ${issue.missing.ifEmpty { "(empty)" }}",
          icon = AglynIcons.named("link_off"),
        )
      }
    }
  }
}
