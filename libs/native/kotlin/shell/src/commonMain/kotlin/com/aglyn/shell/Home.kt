package com.aglyn.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.HostStatus
import com.aglyn.core.HostStatusKind
import com.aglyn.core.Live
import com.aglyn.core.WorkspaceState
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.core.siteAddress
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.WidgetSize
import com.aglyn.ui.ActivityRow
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.DashboardGrid
import com.aglyn.ui.DashboardSectionTitle
import com.aglyn.ui.EmptyState
import com.aglyn.ui.GridSpan
import com.aglyn.ui.LocalAglynPalette
import com.aglyn.ui.MetricCard
import com.aglyn.ui.QuickActionGrid
import com.aglyn.ui.QuickActionItem
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SiteHeaderCard
import com.aglyn.ui.Skeleton
import com.aglyn.ui.StatusTone
import com.aglyn.ui.WidthClass
import com.aglyn.ui.space

/** The shell's own native areas it offers as quick actions, beside the plugins' own. */
private data class ShellAction(val key: String, val title: String, val icon: String, val order: Int, val route: Route)

// Pages, Sites and the rest of a site's content are the site registration's
// own quick actions (libs/native/kotlin/site), listed with the plugins'.
private val SHELL_ACTIONS = emptyList<ShellAction>()

/** How many recent notifications the dashboard reads. */
private const val RECENT_WINDOW = 50
private const val RECENT_SHOWN = 5

/**
 * The dashboard. Sections, in order: the site header (name, address, live
 * status, Visit site, Switch site); quick actions; "At a glance" summary
 * cards (the shell's own, then plugin widgets by order); "Recent activity".
 * Expanded windows put the activity beside the actions and cards, and the
 * cards three to a row.
 */
@Composable
internal fun HomeScreen(
  services: ShellServices,
  context: ShellPluginContext,
  workspace: WorkspaceState,
  widthClass: WidthClass,
  navigator: ShellNavigator,
) {
  val version by services.registry.version.collectAsState()
  val site = workspace.site
  val hasSite = site != null
  val uriHandler = LocalUriHandler.current

  val host = hostDoc(services, site?.id)
  val feed = notificationFeed(services, context.uid, RECENT_WINDOW)
  val now = remember(feed) { nowMillis() }

  val actions = remember(version, hasSite, context.orgSlug, context.hostSlug) {
    val shell = if (hasSite) SHELL_ACTIONS.map { action ->
      action.order to QuickActionItem(action.key, action.title, action.icon) { navigator.push(action.route) }
    } else emptyList()
    val plugins = services.registry.quickActions(NativeApp.AGLYN).filter { hasSite || !it.requiresSite }.map { action ->
      action.order to QuickActionItem(action.id, action.title, action.icon) { context.navigate(action.screen, action.params) }
    }
    (shell + plugins).sortedBy { it.first }.map { it.second }
  }
  val widgets = remember(version, hasSite) { services.registry.widgets(NativeApp.AGLYN).filter { hasSite || !it.requiresSite } }

  val glance: List<Pair<GridSpan, @Composable (Modifier) -> Unit>> = buildList {
    if (hasSite) {
      add(GridSpan.HALF to { modifier -> PagesCard(host, modifier) { navigator.push(Route.Screen(SITE_PAGES_SCREEN_ID)) } })
    }
    add(GridSpan.HALF to { modifier -> UnreadCard(feed, modifier) { navigator.select(ShellNavigator.NOTIFICATIONS) } })
    for (widget in widgets) {
      val span = if (widget.size == WidgetSize.FULL) GridSpan.FULL else GridSpan.HALF
      add(span to { modifier -> Box(modifier.testTag("widget-${widget.id}")) { widget.content(context) } })
    }
  }

  val activity: @Composable (Modifier) -> Unit = { modifier ->
    RecentActivityCard(feed, now, context, modifier) { navigator.select(ShellNavigator.NOTIFICATIONS) }
  }

  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 1280.dp).fillMaxWidth().verticalScroll(rememberScrollState())
        .padding(horizontal = space(2f), vertical = space(1f)),
      verticalArrangement = Arrangement.spacedBy(space(3f)),
    ) {
      workspace.error?.let { error -> SectionCard(null) { Text(error, color = MaterialTheme.colorScheme.error) } }
      if (workspace.ready && workspace.orgs.isEmpty()) {
        EmptyState(
          "No workspaces yet",
          body = "Create a workspace in the ${services.config.brandName} console, then come back here.",
          icon = AglynIcons.named("workspaces"),
        )
        return@Column
      }
      SiteHeader(workspace, host, now, onSwitch = { navigator.push(Route.Switcher) }) { url -> runCatching { uriHandler.openUri(url) } }

      val actionsSection: @Composable () -> Unit = {
        if (actions.isNotEmpty()) {
          Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
            DashboardSectionTitle("Quick actions")
            QuickActionGrid(actions)
          }
        }
      }
      val glanceSection: @Composable (columns: Int) -> Unit = { columns ->
        Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
          DashboardSectionTitle("At a glance")
          DashboardGrid(columns, glance)
        }
      }

      when (widthClass) {
        WidthClass.EXPANDED, WidthClass.LARGE -> Row(horizontalArrangement = Arrangement.spacedBy(space(3f))) {
          Column(Modifier.weight(1.4f), verticalArrangement = Arrangement.spacedBy(space(3f))) {
            actionsSection()
            glanceSection(3)
          }
          activity(Modifier.weight(1f))
        }
        else -> {
          actionsSection()
          glanceSection(2)
          activity(Modifier.fillMaxWidth())
        }
      }
    }
  }
}

@Composable
private fun hostDoc(services: ShellServices, hostId: String?): Live<FirestoreDoc?> {
  if (hostId == null) return Live.Ready(null)
  val flow = remember(hostId) { services.firestore.observeDoc("hosts/$hostId") }
  val live by flow.collectAsState(Live.Loading)
  return live
}

@Composable
private fun SiteHeader(
  workspace: WorkspaceState,
  host: Live<FirestoreDoc?>,
  now: Long,
  onSwitch: () -> Unit,
  onVisit: (String) -> Unit,
) {
  val site = workspace.site
  if (site == null) {
    SiteHeaderCard(
      workspaceName = workspace.org?.name,
      siteName = if (workspace.ready) "Pick a site" else " ",
      address = null,
      statusLabel = null,
      statusTone = StatusTone.NEUTRAL,
      statusDetail = if (workspace.ready && workspace.sites.isEmpty()) "Create a site in the console, then pick it here." else null,
      onSwitch = onSwitch,
      onVisit = null,
    )
    return
  }
  val status = (host as? Live.Ready)?.value?.let { HostStatus.describe(it.data, now) }
  val address = siteAddress(site.subdomain)
  SiteHeaderCard(
    workspaceName = workspace.org?.name,
    siteName = site.name,
    address = address,
    statusLabel = status?.label,
    statusTone = when (status?.kind) {
      HostStatusKind.LIVE -> StatusTone.SUCCESS
      HostStatusKind.MAINTENANCE -> StatusTone.WARNING
      HostStatusKind.SUSPENDED -> StatusTone.ERROR
      else -> StatusTone.NEUTRAL
    },
    // Live needs no sentence: the pages card counts them.
    statusDetail = status?.takeIf { it.kind != HostStatusKind.LIVE }?.detail,
    onSwitch = onSwitch,
    onVisit = address?.let { { onVisit("https://$it/") } },
  )
}

@Composable
private fun PagesCard(host: Live<FirestoreDoc?>, modifier: Modifier, onClick: () -> Unit) {
  val pages = (host as? Live.Ready)?.value?.data?.let(HostStatus::publishedScreenCount)
  MetricCard(
    title = "Published pages",
    value = pages?.toString(),
    caption = when (pages) {
      null -> null
      0 -> "Nothing published yet"
      1 -> "page visitors can open"
      else -> "pages visitors can open"
    },
    icon = "description",
    actionLabel = "Manage pages",
    modifier = modifier.testTag("glance-pages"),
    loading = host is Live.Loading,
    error = if (host is Live.Failed) "Could not load this site." else null,
    onClick = onClick,
  )
}

@Composable
private fun UnreadCard(feed: Live<List<FeedNotification>>, modifier: Modifier, onClick: () -> Unit) {
  val rows = (feed as? Live.Ready)?.value
  val unread = rows?.count { !it.read }
  MetricCard(
    title = "Unread notifications",
    value = unread?.toString(),
    caption = when {
      rows == null -> null
      unread == 0 -> "You're all caught up"
      else -> "of ${rows.size} recent"
    },
    icon = "notifications",
    actionLabel = "Open notifications",
    modifier = modifier.testTag("glance-unread"),
    loading = feed is Live.Loading,
    error = if (feed is Live.Failed) "Could not load notifications." else null,
    onClick = onClick,
  )
}

@Composable
private fun RecentActivityCard(
  feed: Live<List<FeedNotification>>,
  now: Long,
  context: ShellPluginContext,
  modifier: Modifier,
  onSeeAll: () -> Unit,
) {
  Column(modifier, verticalArrangement = Arrangement.spacedBy(space(1f))) {
    DashboardSectionTitle("Recent activity") {
      TextButton(onClick = onSeeAll, modifier = Modifier.testTag("see-all-notifications")) { Text("All notifications") }
    }
    Surface(
      Modifier.fillMaxWidth(),
      shape = MaterialTheme.shapes.large,
      color = MaterialTheme.colorScheme.surfaceContainerLowest,
      shadowElevation = 1.dp,
    ) {
      Column(Modifier.padding(space(1f))) {
        when (feed) {
          Live.Loading -> Column(Modifier.padding(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
            repeat(3) { Skeleton(height = 44.dp) }
          }
          is Live.Failed -> EmptyState("Could not load notifications", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
          is Live.Ready -> if (feed.value.isEmpty()) {
            EmptyState("You're all caught up", body = "New orders, form entries and alerts show up here.", icon = AglynIcons.named("notifications"))
          } else {
            NotificationRows(feed.value.take(RECENT_SHOWN), now, context)
          }
        }
      }
    }
  }
}

/** A notification type's glyph, by the catalog's type families. */
internal fun notificationIcon(type: String?): String = when {
  type == null -> "notifications"
  type.startsWith("billing.") -> "credit_card"
  type.startsWith("team.") -> "group"
  type == "content.formSubmission" -> "inbox"
  type == "content.booking" -> "event"
  type == "content.order" -> "receipt"
  type == "content.lowStock" -> "inventory"
  type.startsWith("content.task") -> "task"
  type == "content.contactAssigned" || type == "content.leadAssigned" -> "person"
  type.endsWith("Digest") -> "insights"
  type.startsWith("content.aiJob") -> "auto_awesome"
  type.startsWith("marketplace.") -> "star"
  type.startsWith("support.") -> "support"
  type.startsWith("system.") -> "shield"
  else -> "notifications"
}

@Composable
internal fun levelTint(level: String?): Color {
  val palette = LocalAglynPalette.current
  return when (levelIntent(level)) {
    "error" -> palette.error.text
    "warning" -> palette.warning.text
    "success" -> palette.success.text
    "neutral" -> MaterialTheme.colorScheme.onSurfaceVariant
    else -> palette.info.text
  }
}

@Composable
internal fun NotificationRows(rows: List<FeedNotification>, now: Long, context: ShellPluginContext) {
  for (row in rows) {
    ActivityRow(
      title = row.title,
      body = row.body,
      time = row.createdAt?.let { relativeTime(it.epochMillis, now) },
      icon = notificationIcon(row.type),
      tint = levelTint(row.level),
      unread = !row.read,
      onClick = row.link?.let { link -> { context.openLink(link) } },
      modifier = Modifier.testTag("notification-${row.id}"),
    )
  }
}

@Composable
internal fun notificationFeed(services: ShellServices, uid: String, count: Int): Live<List<FeedNotification>> {
  val flow = remember(uid, count) {
    services.firestore.observe(
      FirestoreQuery("users/$uid/notifications", orderBy = listOf(FirestoreOrder("createdAt", descending = true)), limit = count),
    )
  }
  val live by flow.collectAsState(Live.Loading)
  return when (val value = live) {
    is Live.Ready -> Live.Ready(
      value.value.map {
        FeedNotification(
          id = it.id,
          title = it.string("title") ?: "",
          body = it.string("body"),
          link = it.string("link"),
          read = it.bool("read") == true,
          level = it.string("level"),
          type = it.string("type"),
          createdAt = it.data["createdAt"] as? FirestoreTimestamp,
        )
      },
    )
    is Live.Failed -> value
    Live.Loading -> Live.Loading
  }
}
