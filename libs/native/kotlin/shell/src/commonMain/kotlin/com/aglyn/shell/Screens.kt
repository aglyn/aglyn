package com.aglyn.shell

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.WorkspaceState
import com.aglyn.core.WorkspaceStore
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.WidgetSize
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.EmptyState
import com.aglyn.ui.LocalAglynPalette
import com.aglyn.ui.SectionCard
import com.aglyn.ui.Skeleton
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.WidthClass
import com.aglyn.ui.space
import kotlinx.coroutines.launch

@Composable
internal fun WorkspaceTitle(workspace: WorkspaceState, onClick: () -> Unit) {
  Row(
    Modifier.clip(MaterialTheme.shapes.medium).clickable(role = Role.Button, onClickLabel = "Switch workspace or site", onClick = onClick)
      .padding(vertical = 4.dp, horizontal = 4.dp).testTag("home-switcher"),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Column(Modifier.weight(1f, fill = false)) {
      Text(
        workspace.org?.name ?: if (workspace.ready) "No workspace" else " ",
        style = MaterialTheme.typography.titleLarge,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      Text(
        workspace.site?.name ?: if (workspace.ready) "Pick a site" else " ",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
      )
    }
    Icon(AglynIcons.named("swap_horiz"), null, Modifier.padding(start = 8.dp), tint = MaterialTheme.colorScheme.primary)
  }
}

@Composable
internal fun WorkspaceChip(workspace: WorkspaceState, onClick: () -> Unit) {
  AssistChip(
    onClick = onClick,
    label = { Text(workspace.site?.name ?: workspace.org?.name ?: "Workspace", maxLines = 1) },
    leadingIcon = { Icon(AglynIcons.named("swap_horiz"), null, Modifier.size(18.dp)) },
    modifier = Modifier.padding(end = 8.dp),
  )
}

/** The workspace and site picker. */
@Composable
internal fun SwitcherScreen(store: WorkspaceStore, workspace: WorkspaceState, onDone: () -> Unit) {
  LazyColumn(Modifier.fillMaxSize()) {
    item { SectionHeader("Workspaces") }
    items(workspace.orgs, key = { "org-${it.id}" }) { org ->
      AglynListItem(
        title = org.name,
        supporting = org.role.replaceFirstChar { it.uppercase() },
        icon = AglynIcons.named("workspaces"),
        trailing = { RadioButton(selected = org.id == workspace.org?.id, onClick = null) },
        onClick = { store.selectOrg(org.id) },
        modifier = Modifier.testTag("switcher-org-${org.id}"),
      )
    }
    item { SectionHeader("Sites in ${workspace.org?.name ?: "this workspace"}") }
    if (!workspace.ready) {
      item { SkeletonList(rows = 2) }
    } else if (workspace.sites.isEmpty()) {
      item { EmptyState("No sites yet", body = "Create a site in the console, then pick it here.", icon = AglynIcons.named("public")) }
    }
    items(workspace.sites, key = { "site-${it.id}" }) { site ->
      AglynListItem(
        title = site.name,
        supporting = site.subdomain.ifEmpty { null },
        icon = AglynIcons.named("public"),
        trailing = { RadioButton(selected = site.id == workspace.site?.id, onClick = null) },
        onClick = {
          store.selectSite(site.id)
          onDone()
        },
        modifier = Modifier.testTag("switcher-site-${site.id}"),
      )
    }
  }
}

@Composable
internal fun SectionHeader(text: String) {
  Text(
    text,
    Modifier.padding(start = space(2f), end = space(2f), top = space(2f), bottom = space(1f)).semantics { heading() },
    style = MaterialTheme.typography.labelLarge,
    color = MaterialTheme.colorScheme.primary,
  )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun HomeScreen(
  services: ShellServices,
  context: ShellPluginContext,
  workspace: WorkspaceState,
  widthClass: WidthClass,
  navigator: ShellNavigator,
) {
  val version by services.registry.version.collectAsState()
  val hasSite = workspace.site != null
  val actions = remember(version, hasSite) { services.registry.quickActions(NativeApp.AGLYN).filter { hasSite || !it.requiresSite } }
  val widgets = remember(version, hasSite) { services.registry.widgets(NativeApp.AGLYN).filter { hasSite || !it.requiresSite } }
  val columns = when (widthClass) {
    WidthClass.COMPACT -> 1
    WidthClass.MEDIUM -> 2
    else -> 3
  }
  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = space(2f), vertical = space(1f)),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    workspace.error?.let { error ->
      SectionCard(null) { Text(error, color = MaterialTheme.colorScheme.error) }
    }
    if (actions.isNotEmpty()) {
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        for (action in actions) {
          QuickActionTile(action.title, action.icon, Modifier.testTag("quick-action-${action.id}")) {
            if (action.screen != null) context.navigate(action.screen!!, action.params) else context.openConsolePath(action.consolePath ?: "/")
          }
        }
      }
    }
    FlowRow(
      horizontalArrangement = Arrangement.spacedBy(space(2f)),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
      maxItemsInEachRow = columns,
    ) {
      for (widget in widgets) {
        val span = if (widget.size == WidgetSize.FULL && columns > 1) columns.toFloat() else 1f
        SectionCard(widget.title, Modifier.weight(span).testTag("widget-${widget.id}")) {
          widget.content(context)
        }
      }
      RecentNotificationsCard(services, context, Modifier.weight(columns.toFloat()), onSeeAll = { navigator.select(ShellNavigator.NOTIFICATIONS) })
    }
    if (workspace.ready && workspace.orgs.isEmpty()) {
      EmptyState(
        "No workspaces yet",
        body = "Create a workspace in the ${services.config.brandName} console, then come back here.",
        icon = AglynIcons.named("workspaces"),
      )
    }
  }
}

@Composable
private fun QuickActionTile(title: String, icon: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
  Surface(
    modifier.widthIn(min = 104.dp).clip(MaterialTheme.shapes.medium)
      .border(1.dp, MaterialTheme.colorScheme.outlineVariant, MaterialTheme.shapes.medium)
      .clickable(role = Role.Button, onClick = onClick),
    color = MaterialTheme.colorScheme.surfaceContainerLowest,
  ) {
    Column(Modifier.padding(space(1.5f)), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      Icon(AglynIcons.named(icon), null, tint = MaterialTheme.colorScheme.primary)
      Text(title, style = MaterialTheme.typography.labelLarge, maxLines = 2)
    }
  }
}

/** Every plugin screen the app has, on phones (wide windows show them in the rail). */
@Composable
internal fun MoreScreen(services: ShellServices, context: NativePluginContext) {
  val version by services.registry.version.collectAsState()
  val actions = remember(version) { services.registry.quickActions(NativeApp.AGLYN).filter { it.screen != null } }
  if (actions.isEmpty()) {
    EmptyState("Nothing here yet", body = "Features you turn on show up here.", icon = AglynIcons.named("apps"))
    return
  }
  LazyColumn(Modifier.fillMaxSize()) {
    items(actions, key = { it.id }) { action ->
      AglynListItem(
        title = action.title,
        icon = AglynIcons.named(action.icon),
        onClick = { context.navigate(action.screen!!, action.params) },
        modifier = Modifier.testTag("more-${action.id}"),
      )
    }
  }
}

@Composable
internal fun PluginScreenHost(
  services: ShellServices,
  context: NativePluginContext,
  screenId: String,
  params: NativeParams,
  hasSite: Boolean,
) {
  val screen = services.registry.screen(screenId)
  when {
    screen == null -> EmptyState("This page is not available", body = "Update the app to open it.", icon = AglynIcons.named("error"))
    screen.requiresSite && !hasSite -> EmptyState("Pick a site first", body = "This page shows one site's data.", icon = AglynIcons.named("public"))
    else -> screen.content(context, params)
  }
}

data class FeedNotification(
  val id: String,
  val title: String,
  val body: String?,
  val link: String?,
  val read: Boolean,
  val level: String?,
)

/** The AGL-3437 levels as intents; unknown or absent reads as info. */
fun levelIntent(level: String?): String = when (level) {
  "critical", "error" -> "error"
  "warning" -> "warning"
  "success" -> "success"
  else -> "info"
}

@Composable
private fun notificationFeed(services: ShellServices, uid: String, count: Int): Live<List<FeedNotification>> {
  val flow = remember(uid, count) {
    services.firestore.observe(
      FirestoreQuery("users/$uid/notifications", orderBy = listOf(FirestoreOrder("createdAt", descending = true)), limit = count),
    )
  }
  val live by flow.collectAsState(Live.Loading)
  return when (val value = live) {
    is Live.Ready -> Live.Ready(
      value.value.map {
        FeedNotification(it.id, it.string("title") ?: "", it.string("body"), it.string("link"), it.bool("read") == true, it.string("level"))
      },
    )
    is Live.Failed -> value
    Live.Loading -> Live.Loading
  }
}

@Composable
private fun NotificationRows(rows: List<FeedNotification>, context: ShellPluginContext) {
  val palette = LocalAglynPalette.current
  for (row in rows) {
    val intent = when (levelIntent(row.level)) {
      "error" -> palette.error
      "warning" -> palette.warning
      "success" -> palette.success
      else -> palette.info
    }
    AglynListItem(
      title = row.title,
      supporting = row.body,
      emphasized = !row.read,
      trailing = {
        Surface(Modifier.size(10.dp), shape = CircleShape, color = if (row.read) MaterialTheme.colorScheme.outlineVariant else intent.main) {}
      },
      onClick = row.link?.let { link -> { context.openLink(link) } },
      modifier = Modifier.testTag("notification-${row.id}"),
    )
  }
}

@Composable
internal fun RecentNotificationsCard(services: ShellServices, context: ShellPluginContext, modifier: Modifier, onSeeAll: () -> Unit) {
  val feed = notificationFeed(services, context.uid, 5)
  SectionCard("Notifications", modifier, action = { TextButton(onClick = onSeeAll) { Text("See all") } }) {
    when (feed) {
      Live.Loading -> Skeleton(height = 40.dp)
      is Live.Failed -> Text("Could not load notifications.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      is Live.Ready -> if (feed.value.isEmpty()) {
        Text("You're all caught up", color = MaterialTheme.colorScheme.onSurfaceVariant)
      } else {
        Column { NotificationRows(feed.value, context) }
      }
    }
  }
}

@Composable
internal fun NotificationsScreen(services: ShellServices, uid: String, context: ShellPluginContext) {
  when (val feed = notificationFeed(services, uid, 50)) {
    Live.Loading -> SkeletonList(rows = 5)
    is Live.Failed -> EmptyState("Could not load notifications", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> if (feed.value.isEmpty()) {
      EmptyState("You're all caught up", body = "New orders, form entries and alerts show up here.", icon = AglynIcons.named("notifications"))
    } else {
      Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) { NotificationRows(feed.value, context) }
    }
  }
}

@Composable
internal fun SettingsScreen(services: ShellServices) {
  val auth by services.auth.state.collectAsState()
  val user = (auth as? com.aglyn.core.AuthState.SignedIn)?.user
  val scope = rememberCoroutineScope()
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
    SectionHeader("Account")
    AglynListItem(
      title = user?.displayName ?: user?.email ?: "Signed in",
      supporting = user?.email,
      icon = AglynIcons.named("settings"),
    )
    HorizontalDivider()
    Column(Modifier.padding(space(2f)).widthIn(max = 480.dp).fillMaxWidth()) {
      OutlinedButton(onClick = { scope.launch { services.auth.signOut() } }, modifier = Modifier.fillMaxWidth().testTag("sign-out")) {
        Text("Sign out")
      }
    }
  }
}
