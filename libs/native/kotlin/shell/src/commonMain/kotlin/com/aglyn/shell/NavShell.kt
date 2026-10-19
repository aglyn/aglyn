package com.aglyn.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.safeDrawing
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.pointer.isCtrlPressed as isCtrlHeld
import androidx.compose.ui.input.pointer.isMetaPressed as isMetaHeld
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.NativeNavListId
import com.aglyn.contracts.toRef
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

/** The slot the AI panel's widget is drawn in (its plugin's, e.g. Assist). */
internal const val ASSIST_PANEL_SLOT = "assistPanel"

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
internal fun SignedInShell(services: ShellServices, root: ShellNavigator, uid: String, pendingLink: String?, onLinkOpened: () -> Unit) {
  // The window's tabs (wide windows): the root navigator is the pinned Home tab, and every other tab holds its own place.
  val tabs = remember(uid) { ShellTabs(root) }
  val navigator = tabs.active.navigator
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
  val compactChrome = usesCompactChrome
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
  // A workspace's color tints the app while it is on screen (it stands in for the accent); the sidebar wears it too unless
  // the Sidebar setting is Plain.
  val brand = orgColor?.takeIf { tints }
  val tintsSidebar = brand != null && prefs.theme.sidebarStyle != com.aglyn.contracts.AppSidebarStyle.PLAIN

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
      themeSettings = { chrome.settingsMode = null; navigator.select(ShellNavigator.SETTINGS); navigator.push(Route.ThemeSettings) },
      addAccount = { services.accounts?.startAdding() },
      switchAccount = { slot -> exitScope.launch { services.accounts?.switchTo(slot) } },
      signOut = { exitScope.launch { services.signOut() } },
    )
  }

  fun newTab(key: String = ShellNavigator.HOME) {
    chrome.closeMenus()
    tabs.open(services.workspace, workspace.org?.id, workspace.site?.id, key)
  }
  fun closeTab(tab: ShellTab = tabs.active) = tabs.close(tab, services.workspace, workspace.org?.id, workspace.site?.id)
  fun selectTab(tab: ShellTab) {
    chrome.settingsMode = null
    tabs.activate(tab, services.workspace, workspace.org?.id, workspace.site?.id)
  }
  fun reopenTab() = tabs.reopen(services.workspace, workspace.org?.id, workspace.site?.id)

  // Ctrl/⌘-click on a row opens it in a new tab, on windows wide enough for tabs.
  val windowInfo = androidx.compose.ui.platform.LocalWindowInfo.current
  fun openRow(row: NavItem) {
    val mods = windowInfo.keyboardModifiers
    val newTabClick = wide && row.opensSettings == null && (if (isMacPlatform) mods.isMetaHeld else mods.isCtrlHeld)
    val mode = row.opensSettings
    when {
      newTabClick -> newTab(row.key)
      mode != null -> actions.enterSettings(mode)
      else -> navigator.select(row.key)
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
      event.key == Key.K -> { chrome.oneBox = true; true }
      event.key == Key.Slash -> { chrome.shortcuts = true; true }
      event.key == Key.LeftBracket -> navigator.back()
      event.key == Key.Comma && !event.isShiftPressed -> { actions.enterSettings(if (inSite) NativeNavListId.SITE_SETTINGS else NativeNavListId.WORKSPACE_SETTINGS); true }
      // Tabs: the desktop's menu bar owns these keys there, so only a window without one handles them here.
      !wide || hasMenuBar -> false
      event.key == Key.T && event.isShiftPressed -> { reopenTab(); true }
      event.key == Key.T -> { newTab(); true }
      event.key == Key.W && !tabs.active.pinned -> { closeTab(); true }
      event.key == Key.Backslash && event.isShiftPressed -> { tabs.overview = true; true }
      else -> false
    }
  }

  // Help docs opens the docs page of the row (or section) on screen.
  val docsPath = allGroups.rowFor(navigator.top)?.docsFor(navigator.top)
  val help = helpEntries(services, navigator::openWeb, { screen -> chrome.settingsMode = null; navigator.select(NavKeys.of(screen)) }, { chrome.shortcuts = true }, docsPath)
  // Commands come in on the root navigator (the desktop's menu bar) and act on the tab on screen.
  LaunchedEffect(root.command) {
    val command = root.command ?: return@LaunchedEffect
    root.command = null
    when (command) {
      ShellCommand.HOME -> { chrome.settingsMode = null; navigator.select(ShellNavigator.HOME) }
      ShellCommand.NOTIFICATIONS -> { chrome.settingsMode = null; navigator.select(ShellNavigator.NOTIFICATIONS) }
      ShellCommand.BACK -> navigator.back()
      ShellCommand.NEW_TAB -> if (wide) newTab()
      ShellCommand.CLOSE_TAB -> if (!tabs.active.pinned) closeTab()
      ShellCommand.REOPEN_TAB -> if (wide) reopenTab()
      ShellCommand.TAB_OVERVIEW -> if (wide) tabs.overview = true
      ShellCommand.FIND -> chrome.oneBox = true
      ShellCommand.SWITCH_WORKSPACE -> chrome.picker = PickerStep.WORKSPACE
      ShellCommand.SWITCH_SITE -> chrome.picker = PickerStep.SITE
      ShellCommand.SETTINGS -> actions.enterSettings(if (inSite) NativeNavListId.SITE_SETTINGS else NativeNavListId.WORKSPACE_SETTINGS)
      ShellCommand.TOGGLE_SIDEBAR -> chrome.toggleSidebar()
      ShellCommand.TOGGLE_RAIL -> chrome.toggleRail()
      ShellCommand.ADD_ACCOUNT -> actions.addAccount()
      ShellCommand.SHORTCUTS -> chrome.shortcuts = true
      ShellCommand.AI_PANEL -> chrome.toggleAiPanel()
      ShellCommand.HELP_DOCS -> help.firstOrNull()?.open?.invoke()
      else -> prefs.pinned.getOrNull(command.ordinal - ShellCommand.PIN_1.ordinal)?.let { orgId ->
        chrome.settingsMode = null
        services.workspace.selectOrg(orgId)
        navigator.select(ShellNavigator.HOME)
      }
    }
  }

  WorkspaceBrandTheme(services, dark, brand) {
  val shell = com.aglyn.ui.shellColors(MaterialTheme.colorScheme, LocalAglynPalette.current, com.aglyn.ui.LocalThemeSurfaces.current)
  // The sidebar's tint over this theme's own sidebar ground, and its ink, both read after the theme is in force.
  val tint = if (tintsSidebar && brand != null) workspaceTint(brand, shell.sidebar, dark) else null
  CompositionLocalProvider(
    androidx.compose.material3.LocalContentColor provides MaterialTheme.colorScheme.onSurface,
    com.aglyn.screens.LocalScreenSession provides screenSession,
    LocalShellActions provides actions,
    LocalShellColors provides shell,
    LocalShowShortcuts provides wide,
  ) {
  var openRecentHolder by remember { mutableStateOf<((com.aglyn.contracts.AccountItemRef) -> Unit)?>(null) }
  val bellPopover: @Composable (Boolean, () -> Unit) -> Unit = { expanded, dismiss ->
    BellPopover(
      services, context, workspace, uid, expanded, dismiss,
      onSeeAll = { chrome.settingsMode = null; navigator.select(ShellNavigator.NOTIFICATIONS) },
      onSettings = { chrome.settingsMode = null; navigator.select(ShellNavigator.SETTINGS); navigator.push(Route.NotificationSettings) },
    )
  }
  CompositionLocalProvider(LocalOpenRecent provides openRecentHolder, LocalBellPopover provides bellPopover) {
  // Every plain web page a screen opens is pushed onto this stack as the browser screen (AGL-3935).
  com.aglyn.webview.ProvideInAppBrowser(secureTab = services.openHostedPage, openPage = navigator::openWeb) {
    val entries = rememberSaveableStateHolder()
    // Each tab's places hold their own saved state.
    val tabKey = "tab${tabs.activeId}/"
    val liveKeys = navigator.keys.map { tabKey + it }
    val pushedKeys = remember { mutableSetOf<String>() }
    // A popped screen's saved state goes with it: opening it again starts it fresh.
    LaunchedEffect(liveKeys) {
      pushedKeys.filter { it.startsWith(tabKey) && it !in liveKeys }.forEach { entries.removeState(it); pushedKeys.remove(it) }
      pushedKeys += liveKeys.filter { ShellNavigator.isPushedKey(it.removePrefix(tabKey)) }
    }
    val screenTitle = remember(navigator.currentKey) { mutableStateOf<String?>(null) }
    val route = navigator.current
    val row = allGroups.rowFor(navigator.top)
    val title = titleFor(services, navigator, route, row, screenTitle.value)
    // Where the person is, as an account item: what ☆ stars and what Recents remember.
    val here = placeRef(navigator, route, row, title, workspace)
    // The tab names where it stands: the place, then its site or workspace.
    // As Figma words a tab: "Bakery — Orders" (the scope, then the place); Home is just "Home".
    val atHome = route == null && navigator.top == ShellNavigator.HOME
    val tabTitle = if (atHome) "Home" else listOfNotNull(workspace.site?.name ?: workspace.org?.name, title.takeIf { it.isNotBlank() }).joinToString(" — ")
    LaunchedEffect(tabTitle, tabs.activeId) { tabs.active.title = tabTitle.ifBlank { "Home" } }
    LaunchedEffect(here) {
      val item = here ?: return@LaunchedEffect
      // A screen names itself once its data is in; the visit counts once it has stayed a moment.
      kotlinx.coroutines.delay(1_500)
      services.accountPrefs.opened(item)
    }
    // Opens a recent or starred item: its workspace and site first, then its screen.
    val openRef: (com.aglyn.contracts.AccountItemRef) -> Unit = { item ->
      if (item.orgId != workspace.org?.id || (item.hostId != null && item.hostId != workspace.site?.id)) {
        services.workspace.select(item.orgId, item.hostId)
      }
      chrome.settingsMode = settingsModeFor(item.screen, item.params, settingsLists(enabled, orgEnabled, hostAdmin, services))
      navigator.select(NavKeys.of(item.screen, item.params))
    }
    val banner: @Composable () -> Unit = {
      impersonation?.let { ImpersonationBanner(it, onExit = { exitScope.launch { services.auth.endImpersonation() } }) }
    }
    val body: @Composable () -> Unit = {
      CompositionLocalProvider(com.aglyn.ui.LocalScreenTitle provides screenTitle) {
        entries.SaveableStateProvider(tabKey + navigator.currentKey) {
          ShellBody(services, context, navigator, workspace, widthClass, uid, route, openInBrowser, banner, screenSession.claims.isStaff) { chrome.colorFor = it }
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
    // The AI panel is a plugin's (slot "assistPanel"), shown while that plugin runs here; it reads where the person is.
    val assist = remember(version) { context.slotWidgets(ASSIST_PANEL_SLOT) }.firstOrNull { it.pluginId in enabled || it.pluginId in orgEnabled }
    val assistContent: @Composable () -> Unit = {
      assist?.let { widget ->
        CompositionLocalProvider(
          com.aglyn.pluginhost.LocalSlotParams provides mapOf(
            "route" to consolePathOf(workspace.org?.slug, workspace.site?.subdomain?.ifEmpty { null }, row),
            "title" to listOfNotNull(title.takeIf { it.isNotBlank() }, workspace.site?.name ?: workspace.org?.name).joinToString(" · "),
          ),
        ) { widget.content(context) }
      }
    }
    // The plan card: the console's own usage notice for this workspace, until it is dismissed here.
    var planDismissals by remember(uid) { mutableStateOf(0) }
    val feed = (notificationFeed(services, uid, 50) as? com.aglyn.core.Live.Ready)?.value.orEmpty()
    val planNotice = remember(feed, workspace.org?.id, planDismissals) { planNoticeFor(feed, workspace.org?.id, uid, services.prefs, com.aglyn.core.nowMillis()) }
    val planFoot: @Composable () -> Unit = {
      planNotice?.let { notice ->
        PlanCard(
          notice,
          onOpen = { notice.link?.let { context.openLink(it) } ?: navigator.select(NavKeys.of("core.billing")) },
          onDismiss = { services.prefs.set(planCardDismissedKey(uid, notice.id), "1"); planDismissals++ },
        )
      }
    }
    val starred = prefs.starred.filter { it.orgId == workspace.org?.id && (it.hostId == null || it.hostId == workspace.site?.id) }
    val onStar: (com.aglyn.contracts.StarredItem) -> Unit = { item -> openRef(item.toRef()) }
    if (wide) {
      val metrics = if (compactChrome) com.aglyn.ui.CompactShellMetrics else com.aglyn.ui.TouchShellMetrics
      // The window's radii: controls 6, cards 10, menus and sheets 12 on the desktop; a step larger on tablets.
      val shapes = if (compactChrome) {
        com.aglyn.ui.CompactShapes
      } else {
        MaterialTheme.shapes.copy(extraLarge = RoundedCornerShape(16.dp))
      }
      MaterialTheme(colorScheme = MaterialTheme.colorScheme, typography = MaterialTheme.typography, shapes = shapes) {
      CompositionLocalProvider(com.aglyn.ui.LocalShellMetrics provides metrics) {
      // One continuous title bar over the rail, the sidebar and the content (as Figma draws the window), then the flush
      // columns under it. A tablet draws edge to edge: the status bar and the taskbar keep their space.
      Column(Modifier.fillMaxSize().background(shellColors.titleBar).windowInsetsPadding(androidx.compose.foundation.layout.WindowInsets.safeDrawing).then(shortcuts)) {
        WideTitleBar(
          services, navigator, chrome, tabs, onSelectTab = ::selectTab, onCloseTab = { closeTab(it) }, onNewTab = { newTab() },
          pushed = route != null, uid = uid, here = here, prefs = prefs,
        ) {
          HelpButton(help)
          if (assist != null) TitleBarButton(if (chrome.aiPanel) "Close the AI panel" else "AI", "auto_awesome", "ai-panel-toggle") { chrome.toggleAiPanel() }
        }
        HorizontalDivider(color = shellColors.divider)
        Row(Modifier.weight(1f).fillMaxWidth().testTag("nav-shell-wide")) {
          if (!chrome.railHidden) {
            Box(Modifier.fillMaxHeight().background(shellColors.rail)) {
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
                CreateMenu(services, workspace, chrome, enabled, uid, actions)
              }
            }
            VerticalDivider(color = shellColors.divider)
          }
          if (!chrome.sidebarHidden) {
            NavSidebar(services, workspace, chrome, sidebar, selectedKey, starred, tint, onRow = { openRow(it) }, onStar = onStar, foot = planFoot)
            VerticalDivider(color = shellColors.divider)
          }
          Column(Modifier.weight(1f).fillMaxHeight().background(MaterialTheme.colorScheme.background)) {
            if (route !is Route.Web) {
              // Where the screen sits, as Figma heads every page: the scope, the group, the destination, then a pushed screen.
              if (row != null || route != null) {
                val group = allGroups.firstOrNull { g -> g.rows.any { navigator.top in it.keys } }?.label
                val place = row?.label
                val steps = buildList {
                  add(Crumb(workspace.site?.name ?: workspace.org?.name ?: "") { chrome.settingsMode = null; navigator.select(ShellNavigator.HOME) })
                  group?.let { add(Crumb(it, null)) }
                  place?.let { add(Crumb(it) { navigator.select(navigator.top) }) }
                  if (route != null && title.isNotBlank() && title != place) add(Crumb(title, null))
                }.filter { it.label.isNotBlank() }
                Breadcrumbs(steps)
              }
              banner()
              sections?.let { SectionTabs(it, navigator.top) { key -> navigator.select(key) } }
            }
            Row(Modifier.weight(1f).fillMaxWidth()) {
              Box(Modifier.weight(1f).fillMaxHeight()) { body() }
              if (assist != null && chrome.aiPanel && route !is Route.Web) {
                VerticalDivider(color = shellColors.divider)
                Column(Modifier.width(380.dp).fillMaxHeight().background(shellColors.sidebar).testTag("ai-panel")) {
                  Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(assist.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    TitleBarButton("Close", "close", "ai-panel-close") { chrome.toggleAiPanel(false) }
                  }
                  Box(Modifier.weight(1f)) { assistContent() }
                }
              }
            }
          }
        }
      }
      if (tabs.overview) TabOverview(tabs, onSelect = ::selectTab, onReopen = { tab -> tabs.closed.remove(tab); tabs.closed.add(0, tab); reopenTab() })
      }
      }
    } else {
      PhoneShell(
        services, navigator, chrome, workspace, prefs, user, uid, title, route, scopeGroups, settingsGroups, sidebar, starred,
        sections, banner, actions, enabled, onRow = { openRow(it) }, onStar = onStar, body = body,
        assistTitle = assist?.title, assistContent = assistContent, help = help,
      )
    }
    if (chrome.shortcuts) KeyboardShortcutsDialog { chrome.shortcuts = false }
    if (chrome.oneBox) {
      OneBox(
        services, workspace, prefs, enabled, hostAdmin, fullScreen = !wide,
        onOpen = { line ->
          chrome.oneBox = false
          openOneBoxLine(services, navigator, chrome, context, workspace, line, openRef)
        },
        onClose = { chrome.oneBox = false },
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
    openRecentHolder = openRef
  }
  }
  }
  }
}

/** The account's theme again with a workspace's color as the accent, while that workspace tints the app. */
@Composable
private fun WorkspaceBrandTheme(services: ShellServices, dark: Boolean, brand: androidx.compose.ui.graphics.Color?, content: @Composable () -> Unit) {
  if (brand == null) content() else AccountTheme(services, dark, brand, content)
}

/** Which settings mode a screen belongs to, so opening a setting from search or Recents shows its list. */
private fun settingsModeFor(screen: String, params: Map<String, String>?, lists: Map<NativeNavListId, List<NavGroupItem>>): NativeNavListId? {
  val key = NavKeys.of(screen, params)
  return lists.entries.firstOrNull { (_, groups) -> groups.rowFor(key) != null }?.key
}

private fun settingsLists(enabled: Collection<String>, orgEnabled: Collection<String>, hostAdmin: Boolean, services: ShellServices) = mapOf(
  NativeNavListId.SITE_SETTINGS to navGroups(NativeNavListId.SITE_SETTINGS, enabled, hostAdmin, services.registry, inSite = true),
  NativeNavListId.WORKSPACE_SETTINGS to navGroups(NativeNavListId.WORKSPACE_SETTINGS, orgEnabled, hostAdmin, services.registry, inSite = true),
)

/**
 * The place on screen as an account item: a destination (`screen`, its row's id), or a pushed record (`record`, its
 * screen and params); nothing for Home, Menu, the account's own pages and web pages.
 */
private fun placeRef(navigator: ShellNavigator, route: Route?, row: NavItem?, title: String, workspace: WorkspaceState): com.aglyn.contracts.AccountItemRef? {
  val orgId = workspace.org?.id ?: return null
  val hostId = workspace.site?.id
  if (title.isBlank()) return null
  return when (route) {
    is Route.Screen -> com.aglyn.contracts.AccountItemRef(
      hostId = hostId, id = NavKeys.of(route.screenId, route.params), kind = "record", label = title, orgId = orgId,
      params = route.params.ifEmpty { null }, screen = route.screenId,
    )
    null -> {
      val (screen, params) = NavKeys.parse(navigator.top) ?: return null
      com.aglyn.contracts.AccountItemRef(
        hostId = hostId.takeIf { row?.listId != NativeNavListId.WORKSPACE && row?.listId != NativeNavListId.WORKSPACE_SETTINGS },
        id = row?.rowId ?: navigator.top, kind = "screen", label = title, orgId = orgId, params = params.ifEmpty { null }, screen = screen,
      )
    }
    else -> null
  }
}

/** Opens a one-box line: a workspace or site switches scope; a screen opens; a record follows its console link. */
private fun openOneBoxLine(
  services: ShellServices,
  navigator: ShellNavigator,
  chrome: NavChromeState,
  context: ShellPluginContext,
  workspace: WorkspaceState,
  line: OneBoxLine,
  openRef: (com.aglyn.contracts.AccountItemRef) -> Unit,
) {
  val row = line.row
  when {
    row.group == com.aglyn.contracts.Contracts.oneBoxWorkspacesGroup -> {
      chrome.settingsMode = null
      services.workspace.selectOrg(row.id)
      navigator.select(ShellNavigator.HOME)
    }
    row.group == "sites" -> {
      chrome.settingsMode = null
      services.workspace.select(row.orgId ?: workspace.org?.id ?: return, row.id)
      navigator.select(ShellNavigator.HOME)
    }
    row.screen != null -> openRef(
      com.aglyn.contracts.AccountItemRef(
        hostId = row.hostId ?: workspace.site?.id, id = row.id, kind = "screen", label = row.label,
        orgId = row.orgId ?: workspace.org?.id ?: return, params = row.params, screen = row.screen!!,
      ),
    )
    row.link != null -> {
      chrome.settingsMode = null
      context.openLink(row.link!!)
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
  Route.ThemeSettings -> "Theme"
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
  onWorkspaceColor: (String) -> Unit,
) {
  when (route) {
    is Route.Web -> com.aglyn.webview.WebPageScreen(route.url, onClose = { navigator.back() }, openInBrowser = openInBrowser, header = banner)
    is Route.Screen -> PluginScreenHost(services, context, route.screenId, route.params, workspace.site != null) { navigator.back() }
    is Route.Besigner -> services.besigner(route.path, { navigator.back() }) { link -> navigator.back(); context.openLink(link) }
    Route.Analytics -> AnalyticsScreen(services, context)
    Route.Switcher -> SwitcherScreen(services.workspace, workspace, services.api.origin) { navigator.back() }
    Route.NotificationSettings -> NotificationSettingsScreen(services, uid)
    Route.ThemeSettings -> ThemeSettingsScreen(services, workspace, onWorkspaceColor)
    null -> when (val top = navigator.top) {
      ShellNavigator.HOME -> HomeScreen(services, context, workspace, widthClass, navigator)
      ShellNavigator.NOTIFICATIONS -> NotificationsScreen(services, uid, context)
      ShellNavigator.SETTINGS -> SettingsScreen(services, context, staff, onTheme = { navigator.push(Route.ThemeSettings) }) { navigator.push(Route.NotificationSettings) }
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
private fun WideTitleBar(
  services: ShellServices,
  navigator: ShellNavigator,
  chrome: NavChromeState,
  tabs: ShellTabs,
  onSelectTab: (ShellTab) -> Unit,
  onCloseTab: (ShellTab) -> Unit,
  onNewTab: () -> Unit,
  pushed: Boolean,
  uid: String,
  here: com.aglyn.contracts.AccountItemRef?,
  prefs: com.aglyn.core.AccountPreferences,
  trailing: @Composable () -> Unit = {},
) {
  val m = com.aglyn.ui.shellMetrics
  // The Mac's traffic lights sit at the bar's left edge (a transparent, full-size title bar).
  val lights = if (LocalTitleBarInset.current > 0.dp) 76.dp else 8.dp
  Row(
    Modifier.fillMaxWidth().background(shellColors.titleBar).height(m.titleBar).padding(start = lights, end = 8.dp).testTag("title-bar"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(2.dp),
  ) {
    TitleBarButton(if (chrome.sidebarHidden) "Show sidebar" else "Hide sidebar", "view_sidebar", "toggle-sidebar") { chrome.toggleSidebar() }
    if (pushed) {
      TitleBarButton("Back", "arrow_back", "title-back") { navigator.back() }
    } else {
      // Back and forward through the places visited, and what was opened recently.
      TitleBarButton("Back", "arrow_back", "history-back", enabled = navigator.canGoBackInHistory) { navigator.historyBack() }
    }
    TitleBarButton("Forward", "arrow_forward", "history-forward", enabled = !pushed && navigator.canGoForwardInHistory) { navigator.historyForward() }
    val openRecent = LocalOpenRecent.current
    RecentHistoryButton(prefs) { item -> openRecent?.invoke(item) }
    Spacer(Modifier.width(6.dp))
    // The window's tabs, in the bar itself as Figma draws them: the pinned Home tab first, then +.
    Row(
      Modifier.weight(1f, fill = false).horizontalScroll(rememberScrollState()).testTag("tab-strip"),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
      for (tab in tabs.tabs) TitleTab(tab, selected = tab.id == tabs.activeId, closable = !tab.pinned, onSelect = { onSelectTab(tab) }, onClose = { onCloseTab(tab) })
    }
    TitleBarButton("New tab  ${shortcutText("T")}", "add", "tab-new", onClick = onNewTab)
    if (tabs.tabs.size > 1) TitleBarButton("All tabs", "grid_view", "tab-overview") { tabs.overview = true }
    here?.let { StarButton(services, it, prefs) }
    Spacer(Modifier.weight(0.001f))
    Surface(
      onClick = { chrome.oneBox = true },
      shape = RoundedCornerShape(m.controlRadius),
      color = MaterialTheme.colorScheme.surfaceContainerHigh,
      border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
      modifier = Modifier.widthIn(min = 180.dp, max = 340.dp).height(if (m.compact) 30.dp else 40.dp).testTag("search-or-jump").semantics { contentDescription = "Search or jump to" },
    ) {
      Row(Modifier.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(AglynIcons.named("search"), null, Modifier.size(m.rowIcon), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Search or jump to", style = MaterialTheme.typography.bodyMedium.copy(fontSize = m.rowText), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f), maxLines = 1)
        Text(
          shortcutText("K"),
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.surfaceContainerLowest).padding(horizontal = 5.dp, vertical = 1.dp),
        )
      }
    }
    Spacer(Modifier.width(6.dp))
    BellButton(services, uid) { navigator.select(ShellNavigator.NOTIFICATIONS) }
    trailing()
  }
}

/** One step of the breadcrumbs, and where it leads (none for a group heading or the page on screen). */
private data class Crumb(val label: String, val open: (() -> Unit)?)

/** "Bakery › Sell › Orders": where the screen sits; every step but the last leads back to it. */
@Composable
private fun Breadcrumbs(steps: List<Crumb>) {
  Row(
    Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 4.dp).testTag("title-crumb"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    steps.forEachIndexed { index, step ->
      val last = index == steps.lastIndex
      if (index > 0) Icon(AglynIcons.named("chevron_right"), null, Modifier.size(12.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      Text(
        step.label,
        style = MaterialTheme.typography.bodySmall,
        color = if (last) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        fontWeight = if (last) FontWeight.Medium else FontWeight.Normal,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = if (!last && step.open != null) Modifier.clip(RoundedCornerShape(4.dp)).clickable(onClick = step.open).padding(horizontal = 2.dp) else Modifier,
      )
    }
  }
}

/** One tab in the title bar: its place's icon and name, and × (the pinned Home tab has none). */
@Composable
private fun TitleTab(tab: ShellTab, selected: Boolean, closable: Boolean, onSelect: () -> Unit, onClose: () -> Unit) {
  val m = com.aglyn.ui.shellMetrics
  Surface(
    onClick = onSelect,
    shape = RoundedCornerShape(m.controlRadius),
    color = if (selected) MaterialTheme.colorScheme.surfaceContainerLowest else Color.Transparent,
    border = if (selected) androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant) else null,
    modifier = Modifier.height(if (m.compact) 28.dp else 36.dp).widthIn(max = 220.dp).testTag("tab-${tab.id}")
      .semantics { this.selected = selected; role = Role.Tab },
  ) {
    Row(Modifier.padding(start = 10.dp, end = if (closable) 2.dp else 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      Icon(AglynIcons.named(if (tab.pinned) "home" else "tab"), null, Modifier.size(m.rowIcon - 2.dp), tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
      Text(
        tab.title,
        style = MaterialTheme.typography.labelLarge.copy(fontSize = m.rowText),
        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        color = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.widthIn(max = 170.dp),
      )
      if (closable) {
        androidx.compose.material3.IconButton(onClick = onClose, modifier = Modifier.size(20.dp).testTag("tab-close-${tab.id}").semantics { contentDescription = "Close ${tab.title}" }) {
          Icon(AglynIcons.named("close"), null, Modifier.size(12.dp))
        }
      }
    }
  }
}

@Composable
internal fun TitleBarButton(label: String, icon: String, tag: String, enabled: Boolean = true, onClick: () -> Unit) {
  val m = com.aglyn.ui.shellMetrics
  WithTooltip(label) {
    androidx.compose.material3.IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(m.barButton).testTag(tag)) {
      Icon(AglynIcons.named(icon), contentDescription = label, Modifier.size(m.barIcon))
    }
  }
}

/** Opens one of the person's recent items: set by the shell, which knows how to reach its workspace and site. */
internal val LocalOpenRecent = androidx.compose.runtime.staticCompositionLocalOf<((com.aglyn.contracts.AccountItemRef) -> Unit)?> { null }

/** ☆ in the title bar: stars the screen or record on screen (synced on the account); filled while it is starred. */
@Composable
internal fun StarButton(services: ShellServices, here: com.aglyn.contracts.AccountItemRef, prefs: com.aglyn.core.AccountPreferences) {
  val starred = prefs.isStarred(here)
  var full by remember { mutableStateOf(false) }
  TitleBarButton(if (starred) "Unstar ${here.label}" else "Star ${here.label}", if (starred) "star_filled" else "star", "title-star") {
    full = !services.accountPrefs.toggleStar(here)
  }
  if (full) {
    androidx.compose.material3.AlertDialog(
      onDismissRequest = { full = false },
      title = { Text("Starred is full") },
      text = { Text("You can star ${com.aglyn.contracts.Contracts.starredMax} places. Unstar one from the sidebar's Starred group to make room.") },
      confirmButton = { androidx.compose.material3.TextButton(onClick = { full = false }) { Text("OK") } },
    )
  }
}

/** The clock in the title bar: what was opened recently, across workspaces. */
@Composable
private fun RecentHistoryButton(prefs: com.aglyn.core.AccountPreferences, open: (com.aglyn.contracts.AccountItemRef) -> Unit) {
  var expanded by remember { mutableStateOf(false) }
  Box {
    TitleBarButton("Recent", "history", "history-recent", enabled = prefs.recents.isNotEmpty()) { expanded = true }
    androidx.compose.material3.DropdownMenu(expanded, onDismissRequest = { expanded = false }, modifier = Modifier.testTag("history-menu")) {
      for (item in prefs.recents.take(12)) {
        MenuRow(item.label, oneBoxIcon(item.kind), tag = "history-${item.id}") { expanded = false; open(item.toRef()) }
      }
    }
  }
}

/** The bell, with a dot while anything is unread; it opens the notifications popover. */
@Composable
internal fun BellButton(services: ShellServices, uid: String, onClick: () -> Unit) {
  val unread = unreadByOrg(services, uid).values.sum()
  val popover = LocalBellPopover.current
  var open by remember { mutableStateOf(false) }
  Box {
    WithTooltip("Notifications") {
      androidx.compose.material3.IconButton(
        onClick = { if (popover != null) open = true else onClick() },
        modifier = Modifier.size(com.aglyn.ui.shellMetrics.barButton).testTag("bell").semantics { contentDescription = if (unread > 0) "Notifications, $unread unread" else "Notifications" },
      ) {
        androidx.compose.material3.BadgedBox(badge = { if (unread > 0) androidx.compose.material3.Badge(containerColor = shellColors.badge) }) {
          Icon(AglynIcons.named("notifications"), null, Modifier.size(com.aglyn.ui.shellMetrics.barIcon))
        }
      }
    }
    popover?.invoke(open) { open = false }
  }
}

/** The bell's popover, bound by the shell: (expanded, dismiss). */
internal val LocalBellPopover = androidx.compose.runtime.staticCompositionLocalOf<(@Composable (Boolean, () -> Unit) -> Unit)?> { null }

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
