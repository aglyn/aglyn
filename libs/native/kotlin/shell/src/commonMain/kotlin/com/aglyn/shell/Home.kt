package com.aglyn.shell

import com.aglyn.ui.EmptyTone
import kotlinx.coroutines.launch
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
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.material3.Icon
import com.aglyn.contracts.toRef
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
import com.aglyn.core.mediaPreviewUrl
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

/** The slot plugins draw their "Needs you" lines in (orders to get ready, unanswered messages, today's bookings…). */
const val HOME_NEEDS_YOU_SLOT = "homeNeedsYou"

/** How many recent places Home offers to pick up. */
private const val PICK_UP_SHOWN = 4

/**
 * Home is the overview (AGL-4011). The site or workspace in one line (the workspace's proposed plan under it); then
 * "Needs you", only what waits (each line opens its list, already filtered; the plugins draw their own lines in
 * [HOME_NEEDS_YOU_SLOT], the shell adds the plan's failed payment); then the numbers (a site's Traffic, its cards and its
 * recent activity, or the cards that total the workspace); then where the person left off; then the one-line prompt that
 * starts Create with AI. Analytics holds the full drill-down.
 */
@Composable
internal fun HomeScreen(
  services: ShellServices,
  context: ShellPluginContext,
  workspace: WorkspaceState,
  widthClass: WidthClass,
  navigator: ShellNavigator,
) {
  val site = workspace.site
  val uriHandler = LocalUriHandler.current
  val host = hostDoc(services, site?.id)
  val now = remember { nowMillis() }
  val prefs by services.accountPrefs.state.collectAsState()
  val version by services.registry.version.collectAsState()
  val lines = remember { com.aglyn.ui.NeedsYouLines() }
  val needs = remember(version, site != null) { context.slotWidgets(HOME_NEEDS_YOU_SLOT).filter { site != null || !it.requiresSite } }
  val org = (orgDocLive(services, workspace.org?.id) as? Live.Ready)?.value?.data
  val openRecent = LocalOpenRecent.current

  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      // The whole content area, on the content edge E (Zach 10/19: no left-aligned or capped column).
      Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
        .padding(horizontal = com.aglyn.ui.paneInset(), vertical = space(2f)).testTag("home"),
      verticalArrangement = Arrangement.spacedBy(space(3f)),
    ) {
      workspace.error?.let { error -> SectionCard(null) { Text(error, color = MaterialTheme.colorScheme.error) } }
      if (workspace.ready && workspace.orgs.isEmpty()) {
        FirstRunContent(services)
        return@Column
      }
      HomeSiteLine(workspace, host, now, services.api.origin, onSwitch = { navigator.command = ShellCommand.SWITCH_SITE }) { url -> runCatching { uriHandler.openUri(url) } }
      if (site == null) {
        HomeUpgradeProposal(services, context, org, workspace.org?.name, workspace.org?.slug, com.aglyn.contracts.Contracts.platformBrandName)
      }

      CompositionLocalProvider(com.aglyn.ui.LocalNeedsYou provides lines) {
        Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          DashboardSectionTitle("Needs you")
          planPaymentProblem(org)?.let { problem ->
            com.aglyn.ui.NeedsYouLine("plan-payment", "credit_card", problem, "Billing", onClick = { context.navigate("core.billing") }, tone = StatusTone.ERROR)
          }
          for (widget in needs) Box(Modifier.testTag("widget-${widget.id}")) { widget.content(context) }
          if (!lines.any && planPaymentProblem(org) == null) {
            Text(
              "Nothing needs you right now.",
              style = MaterialTheme.typography.bodyLarge,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              modifier = Modifier.padding(horizontal = space(1.5f), vertical = space(1f)).testTag("needs-you-none"),
            )
          }
        }
      }

      // The numbers (AGL-4011): a site's Traffic, its cards and its activity; the workspace's cards.
      if (site != null) {
        HomeSiteStats(services, context, site.id) { navigator.select(NavKeys.of(NavKeys.ANALYTICS_SCREEN)) }
      } else {
        workspace.org?.id?.let { HomeOrgGlance(services, context, it) }
      }

      val recents = prefs.recents.filter { it.orgId == workspace.org?.id }.take(PICK_UP_SHOWN)
      if (recents.isNotEmpty()) {
        Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
          DashboardSectionTitle("Pick up where you left off")
          val columns = if (widthClass == WidthClass.COMPACT) 2 else 4
          recents.chunked(columns).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
              row.forEach { item ->
                RecentCard(item, now, workspace, services.registry.screen(item.screen)?.icon, Modifier.weight(1f)) { openRecent?.invoke(item.toRef()) }
              }
              repeat(columns - row.size) { Box(Modifier.weight(1f)) }
            }
          }
        }
      }

      if (site != null && services.registry.screen(AI_CREATE_SCREEN_ID) != null) {
        AiPromptLine { brief -> context.navigate(AI_CREATE_SCREEN_ID, mapOf("kind" to "page", "brief" to brief)) }
      }
    }
  }
}

/** The AI plugin's Create with AI screen, which the prompt opens with what was typed. */
private const val AI_CREATE_SCREEN_ID = "ai.create"

/** The workspace's own document, live. */
@Composable
private fun orgDocLive(services: ShellServices, orgId: String?): Live<FirestoreDoc?> {
  if (orgId == null) return Live.Ready(null)
  val flow = remember(orgId) { services.firestore.observeDoc("orgs/$orgId") }
  val live by flow.collectAsState(Live.Loading)
  return live
}

/** The plan's payment failed (the subscription is past due or unpaid): the one money line Home owns. */
internal fun planPaymentProblem(org: Map<String, Any?>?): String? {
  val status = (org?.get("billingStatus") as? String)?.takeIf { it.isNotEmpty() }
    ?: ((org?.get("subscription") as? Map<*, *>)?.get("status") as? String)
  return when (status) {
    "past_due" -> "Your plan's last payment did not go through"
    "unpaid" -> "Your plan is unpaid"
    else -> null
  }
}

/** One recent place as a card: what it was, where, and when. */
@Composable
private fun RecentCard(item: com.aglyn.contracts.RecentItem, now: Long, workspace: WorkspaceState, screenIcon: String?, modifier: Modifier, onClick: () -> Unit) {
  Surface(
    onClick = onClick,
    shape = MaterialTheme.shapes.large,
    color = MaterialTheme.colorScheme.surfaceContainerLowest,
    shadowElevation = 1.dp,
    modifier = modifier.testTag("recent-${item.id}"),
  ) {
    Column(Modifier.padding(space(1.5f)), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      // The place's own screen icon (Orders' basket), else its kind's.
      Icon(AglynIcons.named(screenIcon ?: oneBoxIcon(item.kind.takeIf { it != "record" && it != "screen" } ?: "screen")), null, tint = MaterialTheme.colorScheme.primary)
      Text(item.label, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
      val where = item.hostId?.let { id -> workspace.sites.firstOrNull { it.id == id }?.name }
      Text(listOfNotNull(where, relativeTime(item.openedAtMs, now)).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
  }
}

/** "Describe what you want to build": the one line that starts the existing Create with AI flow with what was typed. */
@Composable
private fun AiPromptLine(onStart: (String) -> Unit) {
  var brief by remember { mutableStateOf("") }
  Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLowest, shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth().testTag("home-ai-prompt")) {
    Row(Modifier.padding(start = space(2f), end = space(0.5f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      Icon(AglynIcons.named("auto_awesome"), null, tint = MaterialTheme.colorScheme.secondary)
      androidx.compose.material3.TextField(
        brief,
        onValueChange = { brief = it },
        placeholder = { Text("Describe what you want to build") },
        singleLine = true,
        colors = androidx.compose.material3.TextFieldDefaults.colors(
          focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
          focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
        ),
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Send),
        keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSend = { if (brief.isNotBlank()) onStart(brief.trim()) }),
        modifier = Modifier.weight(1f).testTag("home-ai-field"),
      )
      androidx.compose.material3.FilledIconButton(onClick = { onStart(brief.trim()) }, enabled = brief.isNotBlank(), modifier = Modifier.testTag("home-ai-start")) {
        Icon(AglynIcons.named("send"), contentDescription = "Start with AI")
      }
    }
  }
}

/** The site in one line: its name and status, its address, Visit site, and the switch. */
@Composable
private fun HomeSiteLine(
  workspace: WorkspaceState,
  host: Live<FirestoreDoc?>,
  now: Long,
  origin: String,
  onSwitch: () -> Unit,
  onVisit: (String) -> Unit,
) {
  SiteHeader(workspace, host, now, origin, onSwitch, onVisit)
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
  /** The console the app talks to, which serves the site's favicon. */
  origin: String,
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
    iconUrl = mediaPreviewUrl(site.favicon, origin, site.id, 160),
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
  val scope = androidx.compose.runtime.rememberCoroutineScope()
  for (row in rows) {
    ActivityRow(
      title = row.title,
      body = row.body,
      time = row.createdAt?.let { relativeTime(it.epochMillis, now) },
      icon = notificationIcon(row.type),
      tint = levelTint(com.aglyn.contracts.Notifications.level(row.level, row.type)),
      unread = !row.read,
      onClick = {
        if (!row.read) scope.launch { runCatching { markNotificationRead(context.writer, context.uid, row.id) } }
        if (row.inviteId != null) context.showNotifications() else context.openNotification(row)
      },
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
    is Live.Ready -> Live.Ready(value.value.map(::feedNotificationOf))
    is Live.Failed -> value
    Live.Loading -> Live.Loading
  }
}
