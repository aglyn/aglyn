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
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.WorkspaceState
import com.aglyn.core.WorkspaceStore
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.pluginhost.NativeApp
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.WidgetSize
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.BrandPicture
import com.aglyn.ui.EmptyState
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.LocalAglynPalette
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SectionCard
import com.aglyn.ui.Skeleton
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.TextButton
import com.aglyn.ui.WidthClass
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/** The workspace and site picker. */
@Composable
internal fun SwitcherScreen(store: WorkspaceStore, workspace: WorkspaceState, origin: String, onDone: () -> Unit) {
  // Each workspace's logo, read from its own document as the console's switcher reads them.
  LaunchedEffect(workspace.orgs.map { it.id }) { store.loadLogos(workspace.orgs.map { it.id }) }
  LazyColumn(Modifier.fillMaxSize()) {
    item { SectionHeader("Workspaces") }
    items(workspace.orgs, key = { "org-${it.id}" }) { org ->
      AglynListItem(
        title = org.name,
        supporting = org.role.replaceFirstChar { it.uppercase() },
        icon = AglynIcons.named("workspaces"),
        imageUrl = mediaPreviewUrl(workspace.orgLogos[org.id]?.light, origin, null, 160),
        darkImageUrl = mediaPreviewUrl(workspace.orgLogos[org.id]?.dark, origin, null, 160),
        trailing = { RadioButton(selected = org.id == workspace.org?.id, onClick = null) },
        onClick = { store.selectOrg(org.id) },
        modifier = Modifier.testTag("switcher-org-${org.id}"),
      )
    }
    // A full window is not the whole list (the console's switcher, AGL-2336).
    if (workspace.hasMoreOrgs) {
      item {
        com.aglyn.ui.TextButton(
          onClick = { store.loadMoreOrgs() },
          modifier = Modifier.padding(horizontal = space(1f)).testTag("switcher-more-orgs"),
        ) { Text("Load more workspaces") }
      }
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
        imageUrl = mediaPreviewUrl(site.favicon, origin, site.id, 160),
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
    style = MaterialTheme.typography.titleSmall,
    color = com.aglyn.ui.aglynAccentText,
  )
}

/** A plugin screen the shell lists as a place of its own: in the drawer on wide windows, in Apps on phones. */
internal data class ShellPlace(val id: String, val title: String, val icon: String, val screen: String, val requiresSite: Boolean)

/**
 * Each plugin tab, then each quick action that opens a screen, one place per screen (the iOS shell's `SidebarScreen.all`).
 * A quick action that carries params (New product, Ship orders) is an action rather than a place: it stays on Home.
 */
internal fun shellPlaces(registry: com.aglyn.pluginhost.NativePluginRegistry, app: NativeApp): List<ShellPlace> {
  val seen = mutableSetOf<String>()
  val tabs = registry.tabs(app).filter { seen.add(it.screen) }.map { tab ->
    ShellPlace(tab.id, tab.title, tab.icon, tab.screen, registry.screen(tab.screen)?.requiresSite ?: false)
  }
  val actions = registry.quickActions(app).filter { it.params.isEmpty() && seen.add(it.screen) }.map { action ->
    ShellPlace(action.id, action.title, action.icon, action.screen, action.requiresSite)
  }
  return tabs + actions
}

/**
 * The plan feature each plugin's screens need, as the console gates the plugin's page (`featureFlag`), for the plugins
 * whose plan the console's notice can name.
 */
internal val PLUGIN_PLAN_FEATURES = mapOf("crm" to "crm", "commerce" to "commerce", "bookings" to "bookings")

@Composable
internal fun PluginScreenHost(
  services: ShellServices,
  context: NativePluginContext,
  screenId: String,
  params: NativeParams,
  hasSite: Boolean,
  onExit: () -> Unit = {},
) {
  val screen = services.registry.screen(screenId)
  // A plugin the plan leaves out shows the console's upgrade notice where its screen would be (the console's blocked
  // plugin page), from the console's own settled answer; while that is read, or if it cannot be, the screen shows.
  val feature = screen?.pluginId?.let { PLUGIN_PLAN_FEATURES[it] }
  val orgId = services.workspace.state.collectAsState().value.org?.id
  val entitlements = if (feature != null && orgId != null) services.entitlements.state(orgId).collectAsState().value else null
  if (feature != null && orgId != null) LaunchedEffect(orgId) { services.entitlements.load(orgId) }
  when {
    screen == null -> EmptyState("This page is not available", body = "Update the app to open it.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
    feature != null && entitlements != null && !entitlements.has(feature) -> com.aglyn.ui.UpgradeNoticeScreen(
      com.aglyn.core.upgradeNoticeMessage(screen.title, feature),
      com.aglyn.ui.UpgradeKind.PLAN,
      tag = "feature-gate-$feature",
    ) { context.navigate("core.billing") }
    screen.requiresSite && !hasSite -> EmptyState("Pick a site first", body = "This page shows one site's data.", icon = AglynIcons.named("public"))
    screen.upcoming -> EmptyState(
      "${screen.title} is coming to the app",
      body = "This part of ${services.config.brandName} is on its way to the app.",
      icon = AglynIcons.named(screen.icon ?: "extension"),
      action = { OutlinedButton(shape = com.aglyn.ui.controlShape(), onClick = onExit) { Text("Back") } },
      modifier = Modifier.testTag("upcoming-${screen.id}"),
    )
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
  /** The workspace and site it is about, which opening it switches to. */
  val orgId: String? = null,
  val hostId: String? = null,
  /** The invitee's own invitation: opening it answers the invite instead of following [link]. */
  val inviteId: String? = null,
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
internal fun SettingsScreen(
  services: ShellServices,
  context: NativePluginContext? = null,
  staff: Boolean = false,
  onTheme: () -> Unit = {},
  onNotificationSettings: () -> Unit = {},
) {
  val auth by services.auth.state.collectAsState()
  val user = (auth as? com.aglyn.core.AuthState.SignedIn)?.user
  val scope = rememberCoroutineScope()
  val workspace by services.workspace.state.collectAsState()
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
    SectionHeader("Account")
    // A blank display name falls back to the email as the title, so the row never shows an empty line above it.
    val accountTitle = user?.displayName?.takeIf { it.isNotBlank() } ?: user?.email ?: "Signed in"
    AglynListItem(
      title = accountTitle,
      supporting = user?.email?.takeIf { it != accountTitle },
      icon = AglynIcons.named("account_circle"),
    )
    // Your account's own screens (profile, email addresses, security, support). The workspace's and the site's settings
    // are settings modes of the sidebar now; staff reach the staff list from the rail's Admin button, or here on a phone.
    if (context != null) {
      val groups = buildList {
        add("account" to "Your account")
        if (staff && com.aglyn.ui.currentWidthClass() == com.aglyn.ui.WidthClass.COMPACT) add("staff" to "Admin")
      }
      for ((group, heading) in groups) {
        val screens = com.aglyn.screens.ScreenCatalog.group(group)
        if (screens.isEmpty()) continue
        HorizontalDivider()
        SectionHeader(heading)
        for (screen in screens) {
          AglynListItem(
            title = screen.label,
            supporting = screen.subtitle,
            icon = AglynIcons.named(screen.icon),
            trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
            onClick = { context.navigate(screen.id) },
            modifier = Modifier.testTag("settings-${screen.id}"),
          )
        }
      }
    }
    HorizontalDivider()
    SectionHeader("Preferences")
    val theme = services.accountPrefs.state.collectAsState().value.theme
    AglynListItem(
      title = "Theme",
      supporting = "${themeLabel(theme.theme, services.config.brandName)} · ${appearanceLabel(theme.appearance)} · ${densityLabel(theme.density)}",
      icon = AglynIcons.named("palette"),
      trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
      onClick = onTheme,
      modifier = Modifier.testTag("settings-theme"),
    )
    AglynListItem(
      title = "Notifications",
      supporting = "What reaches you in the app, by email and as push",
      icon = AglynIcons.named("notifications"),
      trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
      onClick = onNotificationSettings,
      modifier = Modifier.testTag("settings-notifications"),
    )
    HorizontalDivider()
    HelpSection(services.config)
    HorizontalDivider()
    Column(Modifier.padding(space(2f)).widthIn(max = 480.dp).fillMaxWidth()) {
      OutlinedButton(shape = com.aglyn.ui.controlShape(), onClick = { scope.launch { services.signOut() } }, modifier = Modifier.fillMaxWidth().testTag("sign-out")) {
        Text("Sign out")
      }
    }
  }
}
