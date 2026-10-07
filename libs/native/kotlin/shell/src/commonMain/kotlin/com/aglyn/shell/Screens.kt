package com.aglyn.shell

import androidx.compose.foundation.layout.Box
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
  val type: String? = null,
  val createdAt: com.aglyn.core.FirestoreTimestamp? = null,
)

/** The AGL-3437 levels as intents; unknown or absent reads as info. */
fun levelIntent(level: String?): String = when (level) {
  "critical", "error" -> "error"
  "warning" -> "warning"
  "success" -> "success"
  "neutral" -> "neutral"
  else -> "info"
}

@Composable
internal fun NotificationsScreen(services: ShellServices, uid: String, context: ShellPluginContext) {
  when (val feed = notificationFeed(services, uid, 50)) {
    Live.Loading -> SkeletonList(rows = 5)
    is Live.Failed -> EmptyState("Could not load notifications", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> if (feed.value.isEmpty()) {
      EmptyState("You're all caught up", body = "New orders, form entries and alerts show up here.", icon = AglynIcons.named("notifications"))
    } else {
      val now = remember(feed) { com.aglyn.core.nowMillis() }
      Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
          Modifier.widthIn(max = 840.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(1f)),
        ) { NotificationRows(feed.value, now, context) }
      }
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
