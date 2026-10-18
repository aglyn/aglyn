package com.aglyn.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.NativeNavListId
import com.aglyn.core.AuthState
import com.aglyn.core.WorkspaceState
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.LocalAglynPalette
import com.aglyn.ui.LocalShellColors
import com.aglyn.ui.WidthClass
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.shellColors
import com.aglyn.ui.workspaceTint
import kotlinx.coroutines.launch

/** Areas whose screens draw their own section chips (the CRM, Emails, Marketing and Marketplace hubs): no tabs over them. */
internal val SELF_SECTIONED_ROWS = setOf("crm", "emails", "marketing", "marketplace")

/** Room the window leaves at the top for its own controls (the Mac's traffic lights over a transparent title bar). */
val LocalTitleBarInset = androidx.compose.runtime.staticCompositionLocalOf { 0.dp }

/**
 * The signed-in app (AGL-3946, the native nav redesign): one scope at a time. Tablets and desktops get the workspace rail,
 * the scope's sidebar and the main area; phones get the scope chip with search, the bell and your photo on top, and Home,
 * the busiest area, Create, Inbox and Menu along the bottom.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
internal fun SignedInShell(services: ShellServices, navigator: ShellNavigator, uid: String, pendingLink: String?, onLinkOpened: () -> Unit) {
  val impersonation by services.auth.impersonation.collectAsState()
  // A support session reads the customer's workspaces but never registers this device's notifications under their account.
  LaunchedEffect(uid) { if (services.auth.impersonation.value == null) services.push.register(uid) }
  // Entering or leaving a support session starts from home: nothing open belonged to the other person.
  val supporting = impersonation != null
  var wasSupporting by remember { mutableStateOf(supporting) }
  val chrome = remember(uid) { NavChromeState(services.prefs) }
  LaunchedEffect(supporting) {
    if (supporting != wasSupporting) {
      wasSupporting = supporting
      chrome.settingsMode = null
      navigator.select(ShellNavigator.HOME)
    }
  }
  val exitScope = rememberCoroutineScope()
  val workspace by services.workspace.state.collectAsState()
  val prefs by services.accountPrefs.state.collectAsState()
  val version by services.registry.version.collectAsState()
  val widthClass = currentWidthClass()
  val wide = widthClass != WidthClass.COMPACT
  val context = ShellPluginContext(uid, workspace, services, navigator, emptySet())

  // The workspace on screen is the most recent one; each account remembers the workspaces it holds for links.
  LaunchedEffect(workspace.org?.id) { workspace.org?.id?.let(services.accountPrefs::openedOrg) }
  LaunchedEffect(workspace.orgs) {
    services.accounts?.rememberWorkspaces(workspace.orgs.map { it.slug })
    services.workspace.loadLogos((prefs.pinned + prefs.recentOrgs + workspace.orgs.take(8).map { it.id }).distinct())
  }
  // Moving to another scope leaves its settings mode.
  LaunchedEffect(workspace.org?.id, workspace.site?.id) {
    if (chrome.settingsMode == NativeNavListId.SITE_SETTINGS && workspace.site == null) chrome.settingsMode = null
  }

  // A link that switched workspace or site opens once that workspace is on screen.
  LaunchedEffect(navigator.deferredLink, workspace) { context.settleDeferredLink() }
  LaunchedEffect(pendingLink, workspace.ready) {
    if (pendingLink != null && workspace.ready && !AuthFlow.isAuthLink(pendingLink)) {
      // A link to a workspace another signed-in account holds opens in that account.
      val slug = com.aglyn.pluginhost.DeepLinks.consolePathOf(pendingLink)?.let { com.aglyn.pluginhost.DeepLinks.splitConsoleScope(it).orgSlug }
      val other = slug?.takeIf { s -> workspace.orgs.none { it.slug == s } }?.let { services.accounts?.accountForWorkspace(it) }
      if (other != null) {
        services.accounts?.switchTo(other.slot)
        return@LaunchedEffect
      }
      context.openLink(pendingLink)
      onLinkOpened()
    }
  }
  // The first verified session of an account with no workspace creates the one its sign-up asked for; a new workspace with a
  // plan lands on billing with it.
  LaunchedEffect(uid, workspace.ready) { services.settleFirstRun(workspace) }
  val landingLink = services.authFlow.landingLink
  LaunchedEffect(landingLink, workspace.ready, workspace.org?.slug) {
    val link = landingLink ?: return@LaunchedEffect
    val slug = link.removePrefix("/").substringBefore('/')
    if (workspace.ready && workspace.orgs.any { it.slug == slug }) {
      workspace.orgs.firstOrNull { it.slug == slug }?.let { services.workspace.selectOrg(it.id) }
      services.authFlow.landingLink = null
      context.openLink(link)
    }
  }

  // The token's claims gate the staff section; read from the token itself, as the console does.
  var claims by remember(uid) { mutableStateOf(com.aglyn.core.TokenClaims()) }
  LaunchedEffect(uid) { claims = com.aglyn.core.TokenClaims.fromIdToken(runCatching { services.auth.idToken(false) }.getOrNull()) }
  val authState by services.auth.state.collectAsState()
  val user = (authState as? AuthState.SignedIn)?.user
  val screenSession = rememberScreenSession(services, navigator, workspace, user, claims) { claims = it }

  // The scope's lists, from the manifest.
  val inSite = workspace.site != null
  val host = liveHostDoc(services, workspace.site?.id)
  val enabled = enabledPluginsFor(workspace.orgLogo?.enabledPlugins, host?.data, inSite)
  val orgEnabled = enabledPluginsFor(workspace.orgLogo?.enabledPlugins, null, false)
  val hostAdmin = isHostAdmin(workspace.site?.role, workspace.org?.role)
  val scopeList = if (inSite) NativeNavListId.SITE else NativeNavListId.WORKSPACE
  val scopeGroups = remember(version, enabled, hostAdmin, inSite) { navGroups(scopeList, enabled, hostAdmin, services.registry, inSite) }
  val staffGroups = remember(version, claims.isStaff) { if (claims.isStaff) staffNavGroups() else emptyList() }
  val settingsGroups = when (val mode = chrome.settingsMode) {
    NativeNavListId.WORKSPACE_SETTINGS -> remember(version, orgEnabled) { navGroups(mode, orgEnabled, hostAdmin, services.registry, inSite = true) }
    NativeNavListId.SITE_SETTINGS -> remember(version, enabled, hostAdmin) { navGroups(mode, enabled, hostAdmin, services.registry, inSite = true) }
    STAFF_MODE -> staffGroups
    else -> null
  }
  val allGroups = scopeGroups + settingsGroups.orEmpty()

  val (orgColor, tints) = workspace.org?.id?.let { rememberWorkspaceColor(it, workspace, prefs, services.api.origin) } ?: (null to false)
  val dark = MaterialTheme.colorScheme.background.let { (it.red + it.green + it.blue) / 3 < 0.5f }
  val tint = if (tints && orgColor != null) workspaceTint(orgColor, shellColors.sidebar, dark) else null

  val openInBrowser = com.aglyn.webview.rememberSystemBrowser()
  val actions = remember(navigator, chrome, services) {
    ShellActions(
      openScreen = { screen, params ->
        chrome.closeMenus()
        navigator.select(NavKeys.of(screen, params))
      },
      enterSettings = { mode ->
        chrome.settingsMode = mode
        val first = navGroups(mode, if (mode == NativeNavListId.SITE_SETTINGS) enabled else orgEnabled, hostAdmin, services.registry, inSite = true)
          .flatMap { it.rows }.firstOrNull()
        first?.let { navigator.select(it.key) }
      },
      openWeb = navigator::openWeb,
      accountSettings = { chrome.settingsMode = null; navigator.select(ShellNavigator.SETTINGS) },
      addAccount = { services.accounts?.startAdding() },
      switchAccount = { slot -> exitScope.launch { services.accounts?.switchTo(slot) } },
      signOut = { exitScope.launch { services.signOut() } },
    )
  }

  fun openRow(row: NavItem) {
    val mode = row.opensSettings
    if (mode != null) {
      actions.enterSettings(mode)
    } else {
      navigator.select(row.key)
    }
  }

  val selectedKey = navigator.top
  BackHandler(enabled = navigator.stack.isNotEmpty() || chrome.settingsMode != null || navigator.top != ShellNavigator.HOME) {
    when {
      navigator.stack.isNotEmpty() -> navigator.back()
      chrome.settingsMode != null -> { chrome.settingsMode = null; navigator.select(ShellNavigator.HOME) }
      else -> navigator.select(ShellNavigator.HOME)
    }
  }

  // Ctrl (⌘ on a Mac) shortcuts: 1–5 jump to the pins, K finds a workspace or site, [ goes back, comma opens settings.
  val shortcuts = Modifier.onPreviewKeyEvent { event ->
    if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
    val command = if (isMacPlatform) event.isMetaPressed else event.isCtrlPressed
    if (!command) return@onPreviewKeyEvent false
    val pin = listOf(Key.One, Key.Two, Key.Three, Key.Four, Key.Five).indexOf(event.key)
    when {
      pin >= 0 -> prefs.pinned.getOrNull(pin)?.let { services.workspace.selectOrg(it); true } ?: false
      event.key == Key.K -> { chrome.picker = PickerStep.WORKSPACE; true }
      event.key == Key.LeftBracket -> navigator.back()
      event.key == Key.Comma && !event.isShiftPressed -> { actions.enterSettings(if (inSite) NativeNavListId.SITE_SETTINGS else NativeNavListId.WORKSPACE_SETTINGS); true }
      else -> false
    }
  }

  LaunchedEffect(navigator.command) {
    val command = navigator.command ?: return@LaunchedEffect
    navigator.command = null
    when (command) {
      ShellCommand.FIND -> chrome.picker = PickerStep.WORKSPACE
      ShellCommand.SETTINGS -> actions.enterSettings(if (inSite) NativeNavListId.SITE_SETTINGS else NativeNavListId.WORKSPACE_SETTINGS)
      ShellCommand.TOGGLE_SIDEBAR -> chrome.toggleSidebar()
      ShellCommand.TOGGLE_RAIL -> chrome.toggleRail()
      ShellCommand.ADD_ACCOUNT -> actions.addAccount()
      else -> prefs.pinned.getOrNull(command.ordinal - ShellCommand.PIN_1.ordinal)?.let { orgId ->
        chrome.settingsMode = null
        services.workspace.selectOrg(orgId)
        navigator.select(ShellNavigator.HOME)
      }
    }
  }

  val shell = com.aglyn.ui.shellColors(MaterialTheme.colorScheme, LocalAglynPalette.current)
  CompositionLocalProvider(
    com.aglyn.screens.LocalScreenSession provides screenSession,
    LocalShellActions provides actions,
    LocalShellColors provides shell,
  ) {
  // Every plain web page a screen opens is pushed onto this stack as the browser screen (AGL-3935).
  com.aglyn.webview.ProvideInAppBrowser(secureTab = services.openHostedPage, openPage = navigator::openWeb) {
    val entries = rememberSaveableStateHolder()
    val liveKeys = navigator.keys
    val pushedKeys = remember { mutableSetOf<String>() }
    // A popped screen's saved state goes with it: opening it again starts it fresh.
    LaunchedEffect(liveKeys) {
      pushedKeys.filter { it !in liveKeys }.forEach(entries::removeState)
      pushedKeys.retainAll(liveKeys.toSet())
      pushedKeys += liveKeys.filter { ShellNavigator.isPushedKey(it) }
    }
    val screenTitle = remember(navigator.currentKey) { mutableStateOf<String?>(null) }
    val route = navigator.current
    val row = allGroups.rowFor(navigator.top)
    val title = titleFor(services, navigator, route, row, screenTitle.value)
    val banner: @Composable () -> Unit = {
      impersonation?.let { ImpersonationBanner(it, onExit = { exitScope.launch { services.auth.endImpersonation() } }) }
    }
    val body: @Composable () -> Unit = {
      CompositionLocalProvider(com.aglyn.ui.LocalScreenTitle provides screenTitle) {
        entries.SaveableStateProvider(navigator.currentKey) {
          ShellBody(services, context, navigator, workspace, widthClass, uid, route, openInBrowser, banner, screenSession.claims.isStaff)
        }
      }
    }
    val sections = row?.takeIf { it.rowId !in SELF_SECTIONED_ROWS }?.sections.orEmpty().takeIf { route == null && it.size > 1 }
    val staffList = chrome.settingsMode == STAFF_MODE
    val sidebar = SidebarContent(
      groups = settingsGroups ?: scopeGroups,
      modeTitle = when (chrome.settingsMode) {
        NativeNavListId.WORKSPACE_SETTINGS -> "${workspace.org?.name ?: "Workspace"} settings"
        NativeNavListId.SITE_SETTINGS -> "${workspace.site?.name ?: "Site"} settings"
        STAFF_MODE -> "Admin"
        else -> null
      },
      onExitMode = { chrome.settingsMode = null; navigator.select(ShellNavigator.HOME) },
    )
    val starred = prefs.starred.filter { it.orgId == workspace.org?.id && (it.hostId == null || it.hostId == workspace.site?.id) }
    val onStar: (com.aglyn.contracts.StarredItem) -> Unit = { item -> navigator.select(NavKeys.of(item.screen, item.params)) }
    if (wide) {
      Row(Modifier.fillMaxSize().then(shortcuts).testTag("nav-shell-wide")) {
        if (!chrome.railHidden) {
          Box(Modifier.fillMaxHeight().background(shellColors.rail).padding(top = LocalTitleBarInset.current)) {
            WorkspaceRail(
              services, workspace, prefs, user, unreadByOrg(services, uid),
              RailActions(
                open = { orgId -> chrome.settingsMode = null; services.workspace.selectOrg(orgId); navigator.select(ShellNavigator.HOME) },
                all = { chrome.picker = PickerStep.WORKSPACE },
                create = { chrome.createMenu = true },
                admin = if (screenSession.claims.isStaff) ({ chrome.settingsMode = STAFF_MODE; staffGroups.firstOrNull()?.rows?.firstOrNull()?.let { navigator.select(it.key) } }) else null,
                account = { chrome.accountMenu = true },
                color = { chrome.colorFor = it },
                settings = { orgId -> services.workspace.selectOrg(orgId); actions.enterSettings(NativeNavListId.WORKSPACE_SETTINGS) },
                pinFull = { chrome.pinFullFor = it },
              ),
            )
            Box(Modifier.align(Alignment.BottomStart)) {
              AccountMenu(services, user, chrome)
              CreateMenu(services, workspace, chrome, enabled, actions)
            }
          }
          VerticalDivider(color = shellColors.divider)
        }
        if (!chrome.sidebarHidden) {
          Box(Modifier.padding(top = LocalTitleBarInset.current).background(tint ?: shellColors.sidebar)) {
            NavSidebar(services, workspace, chrome, sidebar, selectedKey, starred, tint, onRow = { openRow(it) }, onStar = onStar)
          }
          VerticalDivider(color = shellColors.divider)
        }
        Column(Modifier.weight(1f).fillMaxHeight().background(MaterialTheme.colorScheme.background)) {
          if (route !is Route.Web) {
            WideTitleBar(services, navigator, chrome, title, route != null, uid)
            banner()
            sections?.let { SectionTabs(it, navigator.top) { key -> navigator.select(key) } }
          }
          Box(Modifier.weight(1f).fillMaxWidth()) { body() }
        }
      }
    } else {
      PhoneShell(
        services, navigator, chrome, workspace, prefs, user, uid, title, route, scopeGroups, settingsGroups, sidebar, starred,
        sections, banner, actions, enabled, onRow = { openRow(it) }, onStar = onStar, body = body,
      )
    }
    // The picker, the pin and color dialogs, and the one-time "Keep which 5 pins?".
    ScopePicker(services, workspace, chrome, fullScreen = !wide, twoStep = !wide || chrome.picker == PickerStep.SITE, onPinFull = { chrome.pinFullFor = it }) { screen ->
      navigator.select(NavKeys.of(screen))
    }
    chrome.pinFullFor?.let { orgId -> PinnedFullDialog(services, workspace, orgId) { chrome.pinFullFor = null } }
    chrome.colorFor?.let { orgId -> WorkspaceColorDialog(services, workspace, orgId) { chrome.colorFor = null } }
    if (prefs.loaded && prefs.overCap && !chrome.keepPinsLater && impersonation == null) {
      KeepPinsDialog(services, workspace) { chrome.keepPinsLater = true }
    }
  }
  }
}

/** The title over the main area: a pushed screen's own name, else the row's manifest label (Logic, not its page title). */
private fun titleFor(services: ShellServices, navigator: ShellNavigator, route: Route?, row: NavItem?, named: String?): String = when (route) {
  is Route.Screen -> named ?: services.registry.screen(route.screenId)?.title ?: "Not found"
  is Route.Besigner -> "Besigner"
  Route.Analytics -> "Overview"
  Route.Switcher -> "Switch workspace or site"
  Route.NotificationSettings -> "Notifications"
  is Route.Web -> ""
  null -> when (navigator.top) {
    ShellNavigator.HOME -> "Home"
    ShellNavigator.NOTIFICATIONS -> "Notifications"
    ShellNavigator.SETTINGS -> "Settings"
    ShellNavigator.MENU -> "Menu"
    else -> row?.let { r -> r.sections.firstOrNull { it.key == navigator.top }?.takeIf { r.sections.size > 1 }?.let { r.label } ?: r.label }
      ?: NavKeys.parse(navigator.top)?.first?.let { services.registry.screen(it)?.title }
      ?: named ?: ""
  }
}

/** What the main area shows for the destination and the pushed screen on top of it. */
@Composable
private fun ShellBody(
  services: ShellServices,
  context: ShellPluginContext,
  navigator: ShellNavigator,
  workspace: WorkspaceState,
  widthClass: WidthClass,
  uid: String,
  route: Route?,
  openInBrowser: (String) -> Unit,
  banner: @Composable () -> Unit,
  staff: Boolean,
) {
  when (route) {
    is Route.Web -> com.aglyn.webview.WebPageScreen(route.url, onClose = { navigator.back() }, openInBrowser = openInBrowser, header = banner)
    is Route.Screen -> PluginScreenHost(services, context, route.screenId, route.params, workspace.site != null) { navigator.back() }
    is Route.Besigner -> services.besigner(route.path, { navigator.back() }) { link -> navigator.back(); context.openLink(link) }
    Route.Analytics -> AnalyticsScreen(services, context)
    Route.Switcher -> SwitcherScreen(services.workspace, workspace, services.api.origin) { navigator.back() }
    Route.NotificationSettings -> NotificationSettingsScreen(services, uid)
    null -> when (val top = navigator.top) {
      ShellNavigator.HOME -> HomeScreen(services, context, workspace, widthClass, navigator)
      ShellNavigator.NOTIFICATIONS -> NotificationsScreen(services, uid, context)
      ShellNavigator.SETTINGS -> SettingsScreen(services, context, staff) { navigator.push(Route.NotificationSettings) }
      ShellNavigator.MENU -> Unit
      else -> {
        val (screen, params) = NavKeys.parse(top) ?: ("" to emptyMap())
        when (screen) {
          NavKeys.ANALYTICS_SCREEN -> AnalyticsScreen(services, context)
          "" -> HomeScreen(services, context, workspace, widthClass, navigator)
          else -> PluginScreenHost(services, context, screen, params, workspace.site != null) { navigator.select(ShellNavigator.HOME) }
        }
      }
    }
  }
}

/** An area's sections as tabs over it (Contacts, Leads, Deals… inside CRM), the console's section rail. */
@Composable
internal fun SectionTabs(sections: List<NavSectionItem>, selected: String, onSelect: (String) -> Unit) {
  val index = sections.indexOfFirst { it.key == selected }.coerceAtLeast(0)
  PrimaryScrollableTabRow(
    selectedTabIndex = index,
    edgePadding = 16.dp,
    containerColor = MaterialTheme.colorScheme.background,
    modifier = Modifier.testTag("section-tabs"),
    divider = { HorizontalDivider(color = shellColors.divider) },
  ) {
    sections.forEachIndexed { i, section ->
      Tab(
        selected = i == index,
        onClick = { onSelect(section.key) },
        text = { Text(section.label, maxLines = 1) },
        modifier = Modifier.testTag("section-${section.id}"),
      )
    }
  }
}

/**
 * The title bar over the main area on tablets and desktops: hide or show the sidebar, back, the title, "Search or jump to"
 * (Ctrl/⌘K) and the bell.
 */
@Composable
private fun WideTitleBar(services: ShellServices, navigator: ShellNavigator, chrome: NavChromeState, title: String, pushed: Boolean, uid: String) {
  Row(
    Modifier.fillMaxWidth().background(shellColors.titleBar).padding(top = LocalTitleBarInset.current).height(52.dp).padding(horizontal = 8.dp).testTag("title-bar"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    TitleBarButton(if (chrome.sidebarHidden) "Show sidebar" else "Hide sidebar", "view_sidebar", "toggle-sidebar") { chrome.toggleSidebar() }
    if (pushed) TitleBarButton("Back", "arrow_back", "title-back") { navigator.back() }
    Text(
      title,
      style = MaterialTheme.typography.titleMedium,
      fontWeight = FontWeight.SemiBold,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.padding(start = 8.dp).weight(1f).semantics { heading() },
    )
    Surface(
      onClick = { chrome.picker = PickerStep.WORKSPACE },
      shape = RoundedCornerShape(10.dp),
      color = MaterialTheme.colorScheme.surfaceContainerHigh,
      modifier = Modifier.widthIn(min = 220.dp, max = 340.dp).height(36.dp).testTag("search-or-jump").semantics { contentDescription = "Search or jump to" },
    ) {
      Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(AglynIcons.named("search"), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Search or jump to", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(shortcutText("K"), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    Spacer(Modifier.width(4.dp))
    BellButton(services, uid) { navigator.select(ShellNavigator.NOTIFICATIONS) }
  }
}

@Composable
internal fun TitleBarButton(label: String, icon: String, tag: String, onClick: () -> Unit) {
  WithTooltip(label) {
    androidx.compose.material3.IconButton(onClick = onClick, modifier = Modifier.testTag(tag)) { Icon(AglynIcons.named(icon), contentDescription = label) }
  }
}

/** The bell, with a dot while anything is unread. */
@Composable
internal fun BellButton(services: ShellServices, uid: String, onClick: () -> Unit) {
  val unread = unreadByOrg(services, uid).values.sum()
  WithTooltip("Notifications") {
    androidx.compose.material3.IconButton(onClick = onClick, modifier = Modifier.testTag("bell").semantics { contentDescription = if (unread > 0) "Notifications, $unread unread" else "Notifications" }) {
      androidx.compose.material3.BadgedBox(badge = { if (unread > 0) androidx.compose.material3.Badge(containerColor = shellColors.badge) }) {
        Icon(AglynIcons.named("notifications"), null)
      }
    }
  }
}

/** Unread notifications by workspace, from the newest 50 the feed holds: the rail's badges and the bell's dot. */
@Composable
internal fun unreadByOrg(services: ShellServices, uid: String): Map<String, Int> {
  val feed = notificationFeed(services, uid, 50)
  val rows = (feed as? com.aglyn.core.Live.Ready)?.value ?: return emptyMap()
  return rows.filter { !it.read }.groupingBy { it.orgId ?: "" }.eachCount()
}

/** The staff section as a list of its own (the rail's Admin button), from the core screens' staff group. */
internal fun staffNavGroups(): List<NavGroupItem> {
  val rows = com.aglyn.screens.ScreenCatalog.group("staff").map { spec ->
    NavItem(
      key = NavKeys.of(spec.id), rowId = spec.id, listId = STAFF_MODE, label = spec.label, icon = spec.icon,
      screen = spec.id, params = emptyMap(), description = spec.subtitle, sections = emptyList(), actions = emptyList(), pluginId = null, keywords = emptyList(),
    )
  }
  return if (rows.isEmpty()) emptyList() else listOf(NavGroupItem("staff", null, false, null, rows))
}

/** The session every spec screen reads: who is signed in, the scope, and the account operations. */
@Composable
private fun rememberScreenSession(
  services: ShellServices,
  navigator: ShellNavigator,
  workspace: WorkspaceState,
  user: com.aglyn.core.AuthUser?,
  claims: com.aglyn.core.TokenClaims,
  setClaims: (com.aglyn.core.TokenClaims) -> Unit,
): com.aglyn.screens.ScreenSession {
  // A passkey can be made where the app is configured for one and the platform bound a creator.
  val passkeyRelyingParty = services.config.passkeyRelyingParty.takeIf { com.aglyn.screens.LocalPasskeyCreator.current != null }
  // Google can be connected where the platform bound a way to sign in to it.
  val googleSource = com.aglyn.screens.LocalGoogleCredentialSource.current
  suspend fun freshClaims() = setClaims(com.aglyn.core.TokenClaims.fromIdToken(runCatching { services.auth.idToken(true) }.getOrNull()))
  return com.aglyn.screens.ScreenSession(
    passkeyRelyingParty = passkeyRelyingParty,
    googleConfigured = googleSource != null,
    email = user?.email,
    displayName = user?.displayName,
    orgName = workspace.org?.name,
    orgRole = workspace.org?.role,
    siteName = workspace.site?.name,
    claims = claims,
    origin = services.config.consoleOrigin,
    reauthenticate = { password -> services.auth.signInWithEmail(user?.email.orEmpty(), password) },
    impersonate = { token, tenantId -> services.auth.beginImpersonation(token, tenantId) },
    refreshClaims = { freshClaims() },
    openHostedPage = services.openHostedPage,
    back = { navigator.back() },
    account = com.aglyn.screens.AccountOperations(
      changePassword = { current, new -> services.auth.changePassword(current, new) },
      updateDisplayName = { name -> services.auth.updateDisplayName(name) },
      linkGoogle = {
        val source = googleSource ?: throw com.aglyn.core.GoogleLinkError("Connecting Google is not set up in this build.")
        services.auth.linkGoogle(source.idToken(user?.email))
        freshClaims()
      },
      unlinkProvider = { provider ->
        services.auth.unlinkProvider(provider)
        freshClaims()
      },
    ),
  )
}
