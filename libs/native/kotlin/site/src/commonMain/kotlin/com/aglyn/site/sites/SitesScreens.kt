package com.aglyn.site.sites

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.HostStatus
import com.aglyn.core.HostStatusKind
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.core.siteAddress
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.site.SiteAreas
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.ListHeader
import com.aglyn.ui.LoadContent
import com.aglyn.ui.LoadMoreEffect
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.RefreshableBox
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

const val SITE_SITES_SCREEN = "site.sites"
const val SITE_SITE_SCREEN = "site.site"

fun hostStatusTone(kind: HostStatusKind): StatusTone = when (kind) {
  HostStatusKind.LIVE -> StatusTone.SUCCESS
  HostStatusKind.DRAFT -> StatusTone.NEUTRAL
  HostStatusKind.MAINTENANCE -> StatusTone.WARNING
  HostStatusKind.SUSPENDED -> StatusTone.ERROR
}

/** A site's document, live, for its status pill and addresses. */
@Composable
private fun hostDoc(context: NativePluginContext, hostId: String): Live<com.aglyn.core.FirestoreDoc?> {
  val live by remember(hostId, context.firestore) { context.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading)
  return live
}

/**
 * The workspace's sites, the picked one beside the list on wide windows:
 * search, the custom-domain filter, create a site, and open or switch to
 * one, with its status and addresses.
 */
@Composable
fun SitesScreen(context: NativePluginContext, initialSiteId: String? = null) {
  val orgId = context.orgId ?: run {
    EmptyState("Pick a workspace first", icon = AglynIcons.named("workspaces"))
    return
  }
  val scope = rememberCoroutineScope()
  val model = remember(orgId, context.uid) { SitesListModel(context.uid, orgId, context.firestore, scope) }
  LaunchedEffect(model) { model.reload() }
  var creating by remember { mutableStateOf(false) }
  val canCreate = context.orgRole in setOf("owner", "admin")

  AglynListDetail(
    initialSelected = initialSiteId,
    list = { selected, onSelect ->
      val listState = rememberLazyListState()
      LoadMoreEffect(listState, model.hasMore, onLoadMore = model::loadMore)
      Column(Modifier.fillMaxSize()) {
        ListHeader("Sites") {
          Button(onClick = { creating = true }, enabled = canCreate, modifier = Modifier.testTag("add-site")) {
            Icon(AglynIcons.named("add"), contentDescription = null)
            Text("Create site", Modifier.padding(start = space(1f)))
          }
        }
        Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          SearchField(model.search, model::type, placeholder = "Search sites")
          ChoiceChipRow(SiteDomainFilter.entries.map { ChipOption(it.name, it.label) }, model.domain.name, { model.pick(SiteDomainFilter.valueOf(it)) })
        }
        RefreshableBox(model.refreshing, model::refresh) {
          LoadContent(model.rows, onRetry = { model.reload() }, failedTitle = "Could not load sites") { rows ->
            if (rows.isEmpty()) {
              EmptyState(
                if (model.search.isBlank() && model.domain == SiteDomainFilter.ALL) "No sites yet" else "No sites match",
                body = if (model.search.isBlank()) "Create a site to start building." else "Try another search.",
                icon = AglynIcons.named("public"),
              )
            } else {
              LazyColumn(Modifier.fillMaxSize().testTag("sites-list"), state = listState) {
                items(rows, key = { it.id }) { row -> SiteListRow(context, row, row.id == selected) { onSelect(row.id) } }
                if (model.hasMore) item { SkeletonList(rows = 2) }
              }
            }
          }
        }
      }
    },
    detail = { selected ->
      if (selected == null) EmptyState("Pick a site to see it here", icon = AglynIcons.named("public"))
      else SiteOverview(context, selected)
    },
  )

  if (creating) CreateSiteDialog(context, orgId) { creating = false }
}

@Composable
private fun SiteListRow(context: NativePluginContext, row: SiteRow, selected: Boolean, onClick: () -> Unit) {
  val host = hostDoc(context, row.id)
  val status = (host as? Live.Ready)?.value?.let { HostStatus.describe(it.data, nowMillis()) }
  AglynListItem(
    title = row.name,
    supporting = listOfNotNull(siteAddress(row.subdomain), row.role?.replaceFirstChar { it.uppercase() }).joinToString(" · "),
    icon = AglynIcons.named("public"),
    selected = selected,
    trailing = {
      Row(horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
        if (row.id == context.hostId) StatusChip("Current", StatusTone.INFO)
        status?.let { StatusChip(it.label, hostStatusTone(it.kind)) }
      }
    },
    onClick = onClick,
    modifier = Modifier.testTag("site-${row.id}"),
  )
}

/**
 * One site: its status, addresses and what it holds, with the switch that
 * makes it the site every screen shows, and its areas.
 */
@Composable
fun SiteOverview(context: NativePluginContext, hostId: String) {
  val live = hostDoc(context, hostId)
  val uri = LocalUriHandler.current
  when (live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this site", body = "You may no longer have access to it.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val doc = live.value ?: return EmptyState("This site is gone", icon = AglynIcons.named("public"))
      val now = remember(doc) { nowMillis() }
      val status = HostStatus.describe(doc.data, now)
      val name = doc.string("displayName")?.ifBlank { null } ?: doc.string("subdomain") ?: hostId
      val platform = siteAddress(doc.string("subdomain"))
      val custom = doc.string("cname")?.ifBlank { null }
      val favicon = (doc.data["seo"] as? Map<*, *>)?.get("favicon") as? String
      val current = hostId == context.hostId
      Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("site-detail"),
        verticalArrangement = Arrangement.spacedBy(space(2f)),
      ) {
        SectionCard(null) {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
            RemoteImage(favicon?.takeIf { it.startsWith("http") }, null, Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)), icon = "public")
            Column(Modifier.weight(1f)) {
              Text(name, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
              Text(custom ?: platform ?: "", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            StatusChip(status.label, hostStatusTone(status.kind))
          }
          Text(status.detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
            if (current) {
              StatusChip("You are working on this site", StatusTone.INFO)
            } else {
              Button(onClick = { context.selectSite(hostId) }, modifier = Modifier.testTag("site-switch")) {
                Icon(AglynIcons.named("swap_horiz"), contentDescription = null)
                Text("Work on this site", Modifier.padding(start = space(1f)))
              }
            }
            (custom ?: platform)?.let { domain ->
              OutlinedButton(onClick = { uri.openUri("https://$domain/") }, modifier = Modifier.testTag("site-visit")) {
                Icon(AglynIcons.named("open_in_new"), contentDescription = null)
                Text("Visit site", Modifier.padding(start = space(1f)))
              }
            }
          }
        }
        SectionCard("Addresses") {
          DetailRow("Platform address", platform)
          DetailRow("Custom domain", custom, placeholder = "None connected")
          DetailRow("Published pages", status.publishedPages.toString())
          DetailRow("Created", (doc.data["createdAt"] as? com.aglyn.core.FirestoreTimestamp)?.let { relativeTime(it.epochMillis, now) })
        }
        if (current) {
          SectionCard("Manage") {
            SiteAreas.entries.forEachIndexed { index, area ->
              if (index > 0) HorizontalDivider()
              AglynListItem(
                title = area.title,
                supporting = area.supporting,
                icon = AglynIcons.named(area.icon),
                trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
                onClick = { context.navigate(area.screen) },
                modifier = Modifier.testTag("site-area-${area.screen}"),
              )
            }
          }
        } else {
          NoticeBanner("Switch to this site to manage its pages, media and setup.", StatusTone.INFO)
        }
      }
    }
  }
}

@Composable
private fun CreateSiteDialog(context: NativePluginContext, orgId: String, close: () -> Unit) {
  val scope = rememberCoroutineScope()
  val runner = remember { ActionRunner(scope, roleHint = "a workspace owner or admin") }
  var name by remember { mutableStateOf("") }
  var subdomain by remember { mutableStateOf("") }
  var edited by remember { mutableStateOf(false) }
  var suggestions by remember { mutableStateOf(emptyList<String>()) }
  val valid = name.isNotBlank() && SUBDOMAIN_PATTERN.matches(subdomain)
  ActionDialog(
    title = "Create a site",
    body = "You can connect your own domain later.",
    icon = "public",
    confirmLabel = "Create site",
    confirmEnabled = valid,
    busy = runner.busy,
    error = runner.error,
    onDismiss = close,
    onConfirm = {
      runner.run {
        when (val result = createSite(context.api, orgId, name, subdomain)) {
          is CreateSiteResult.Created -> {
            context.selectSite(result.hostId)
            close()
          }
          is CreateSiteResult.Refused -> {
            suggestions = result.suggestions
            runner.error = result.message
          }
        }
      }
    },
  ) {
    OutlinedTextField(
      name,
      { next ->
        name = next.take(80)
        if (!edited) subdomain = suggestSubdomain(next)
      },
      label = { Text("Site name") },
      singleLine = true,
      modifier = Modifier.fillMaxWidth().testTag("site-name"),
    )
    OutlinedTextField(
      subdomain,
      { next ->
        edited = true
        subdomain = next.lowercase().filter { it.isLetterOrDigit() || it == '-' }.take(30)
      },
      label = { Text("Address") },
      suffix = { Text(".${com.aglyn.core.DEFAULT_TENANT_APEX}") },
      supportingText = { Text("3 to 30 letters, numbers or hyphens.") },
      isError = subdomain.isNotEmpty() && !SUBDOMAIN_PATTERN.matches(subdomain),
      singleLine = true,
      modifier = Modifier.fillMaxWidth().testTag("site-subdomain"),
    )
    if (suggestions.isNotEmpty()) {
      Text("Try one of these:", style = MaterialTheme.typography.labelLarge)
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        suggestions.forEach { suggestion ->
          SuggestionChip(onClick = { subdomain = suggestion; edited = true }, label = { Text(suggestion) })
        }
      }
    }
  }
}

/** The picked site's own overview screen. */
@Composable
fun CurrentSiteScreen(context: NativePluginContext, params: Map<String, String>) {
  val hostId = params["site"] ?: context.hostId
  if (hostId == null) {
    EmptyState("Pick a site first", icon = AglynIcons.named("public"))
  } else {
    SiteOverview(context, hostId)
  }
}

