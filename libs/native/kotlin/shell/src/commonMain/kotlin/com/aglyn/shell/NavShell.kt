package com.aglyn.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
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
import androidx.compose.material3.Surface
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
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.draw.clip
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
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
import androidx.compose.ui.unit.sp
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
internal val SELF_SECTIONED_ROWS = setOf("crm", "emails", "marketing", "marketplace", "orders")

/** Room the window leaves at the top for its own controls (the Mac's traffic lights over a transparent title bar). */
val LocalTitleBarInset = androidx.compose.runtime.staticCompositionLocalOf { 0.dp }

/**
 * What a double-click on the window's tab row does, as the title bar it stands in for would (the desktop's window
 * provides it; a Mac follows System Settings' "Double-click a window's title bar to"). Null where there is no window.
 */
val LocalWindowDoubleClick = androidx.compose.runtime.staticCompositionLocalOf<(() -> Unit)?> { null }

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
  val compactChrome = LocalUsesCompactChrome.current
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
  // Less any plugin the platform has not released to this workspace (its routes would answer 404).
  val enabled = releasedPlugins(enabledPluginsFor(workspace.orgLogo?.enabledPlugins, host?.data, inSite), workspace.org?.id, workspace.orgLogo, claims.isStaff)
  val orgEnabled = releasedPlugins(enabledPluginsFor(workspace.orgLogo?.enabledPlugins, null, false), workspace.org?.id, workspace.orgLogo, claims.isStaff)
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
  // A workspace's color is its rail tile and a light wash over the sidebar while it is on screen (unless the Sidebar
  // setting is Plain). Only a white-label workspace's brand color stands in for the accent ([workspaceAccent]); a picked
  // or logo color never does, so the accent stays the account theme's (Aglyn blue unless the person picked one).
  val brand = orgColor?.takeIf { tints }
  val accentOrg = workspace.org?.id
  val accentEntitlements = accentOrg?.let { services.entitlements.state(it).collectAsState().value }
  LaunchedEffect(accentOrg) { accentOrg?.let { services.entitlements.load(it) } }
  val accent = accentOrg?.let { id ->
    workspaceAccent(workspace.orgLogos[id]?.brandColor, whiteLabel = accentEntitlements?.has("whiteLabel") == true, useWorkspaceBrand = prefs.theme.useWorkspaceBrand)
  }?.let { com.aglyn.ui.colorOfHex(it) }
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

  // The tab on screen keeps the scope it is in, so switching back to it restores exactly that.
  LaunchedEffect(workspace.org?.id, workspace.site?.id) { tabs.track(workspace.org?.id, workspace.site?.id) }
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
      // ⌃⌘S (Ctrl+Alt+S) shows or hides the workspace switcher; the desktop's menu bar owns it there.
      event.key == Key.S && !hasMenuBar && (if (isMacPlatform) event.isCtrlPressed else event.isAltPressed) -> { chrome.toggleRail(); true }
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

  WorkspaceBrandTheme(services, dark, accent) {
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
    val tabIcon = if (atHome) "home" else row?.icon
    LaunchedEffect(tabTitle, tabIcon, tabs.activeId) {
      tabs.active.title = tabTitle.ifBlank { "Home" }
      tabs.active.icon = tabIcon
    }
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
    // The ☆ for the place on screen: a screen's title row draws it (the shared list scaffold); else the breadcrumbs do.
    val starSlot = remember(here) { here?.let { item -> com.aglyn.ui.PageStarSlot { StarButton(services, item, prefs) } } }
    val body: @Composable () -> Unit = {
      CompositionLocalProvider(com.aglyn.ui.LocalScreenTitle provides screenTitle, com.aglyn.ui.LocalPageStar provides starSlot) {
        entries.SaveableStateProvider(tabKey + navigator.currentKey) {
          ShellBody(
            services, context, navigator, workspace, widthClass, uid, route, openInBrowser, banner, screenSession.claims.isStaff,
            searchResults = { query ->
              SearchResultsScreen(services, workspace, enabled, hostAdmin, query) { line -> openOneBoxLine(services, navigator, chrome, context, workspace, line, openRef) }
            },
          ) { chrome.colorFor = it }
        }
      }
    }
    val sections = row?.takeIf { it.rowId !in SELF_SECTIONED_ROWS }?.sections.orEmpty().takeIf { route == null && it.size > 1 }
    val staffList = chrome.settingsMode == STAFF_MODE
    val sidebar = SidebarContent(
      groups = settingsGroups ?: scopeGroups,
      modeTitle = when (chrome.settingsMode) {
        NativeNavListId.WORKSPACE_SETTINGS -> "Workspace settings"
        NativeNavListId.SITE_SETTINGS -> "Site settings"
        STAFF_MODE -> "Admin"
        else -> null
      },
      onExitMode = { chrome.settingsMode = null; navigator.select(ShellNavigator.HOME) },
      // "‹ Juniper Street Bakery" over Site settings, "‹ Juniper Street Co." over Workspace settings (Figma Sidebar).
      modeBack = when (chrome.settingsMode) {
        NativeNavListId.SITE_SETTINGS -> workspace.site?.name ?: "Site"
        NativeNavListId.WORKSPACE_SETTINGS -> workspace.org?.name ?: "Workspace"
        STAFF_MODE -> workspace.org?.name ?: "Back"
        else -> null
      },
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
    // The plan card (Figma 98:1048, AGL-3992): a slow carousel of the console's usage meters, the one that fits the screen in
    // front first (the shared mapping, planCardMeterOrder); shown while the viewer can upgrade or a meter is near its limit.
    var planHides by remember(uid) { mutableStateOf(0) }
    val planOrgId = workspace.org?.id
    val planHostId = workspace.site?.id
    val planSiteIds = workspace.sites.map { it.id }
    val planReadings by androidx.compose.runtime.produceState<PlanReadings?>(null, planOrgId, planHostId, planSiteIds) {
      value = planOrgId?.let { loadPlanReadings(services, it, planHostId, planSiteIds) }
    }
    val planScreen = navigator.current.let { it as? Route.Screen }?.screenId ?: NavKeys.parse(navigator.top)?.first
      ?: if (navigator.top == ShellNavigator.HOME) NavKeys.HOME_SCREEN else null
    val planContext = com.aglyn.contracts.planCardContext(planScreen, workspace.site != null)
    val planFoot: @Composable () -> Unit = {
      val loaded = planReadings
      val logo = workspace.orgLogo
      val offersUpgrade = logo?.plan != null && logo.plan !in setOf("agency", "enterprise") && !logo.enterprise &&
        workspace.org?.role in setOf("owner", "admin")
      if (loaded != null && planOrgId != null && planHides >= 0 && services.prefs.get(planCardHiddenKey(planOrgId, loaded.plan)) == null &&
        com.aglyn.contracts.planCardShows(loaded.readings, offersUpgrade)
      ) {
        val byMeter = loaded.readings.associateBy { it.meter }
        val lines = com.aglyn.contracts.planCardMeterOrder(loaded.readings, planContext).mapNotNull { meter ->
          val reading = byMeter[meter] ?: return@mapNotNull null
          val used = reading.used ?: return@mapNotNull null
          val limit = reading.limit ?: return@mapNotNull null
          com.aglyn.ui.PlanMeterLine(meter, com.aglyn.contracts.Contracts.planCardMeterLabels[meter] ?: meter, planMeterFigures(meter, used, limit), (used / limit).toFloat())
        }
        com.aglyn.ui.PlanMeterCarousel(
          detail = "${workspace.site?.name ?: workspace.org?.name ?: ""} · ${loaded.plan} plan",
          meters = lines,
          advanceMs = com.aglyn.contracts.Contracts.planCardAdvanceMs,
          warningShare = com.aglyn.contracts.Contracts.planCardWarningShare.toFloat(),
          onUpgrade = if (offersUpgrade) ({ actions.openScreen("core.billing", emptyMap()) }) else null,
          onOpenUsage = { actions.openScreen("core.billing.usage", emptyMap()) },
          onHide = { services.prefs.set(planCardHiddenKey(planOrgId, loaded.plan), "1"); planHides++ },
          modifier = Modifier.padding(start = com.aglyn.ui.shellMetrics.sidebarPad, end = com.aglyn.ui.shellMetrics.sidebarPad, bottom = 12.dp),
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
        WindowTabStrip(tabs, onSelectTab = ::selectTab, onCloseTab = { closeTab(it) }, onNewTab = { newTab() }) { HomeTabMark(services, workspace) }
        WideToolbar(
          services, navigator, chrome, pushed = route != null, uid = uid,
          search = { modifier ->
            InlineSearchField(
              services, workspace, chrome, enabled, hostAdmin,
              onOpen = { line -> openOneBoxLine(services, navigator, chrome, context, workspace, line, openRef) },
              onSeeAll = { query -> navigator.push(Route.SearchResults(query)) },
              modifier = modifier,
            )
          },
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
            val crumbsSlot = remember { com.aglyn.ui.PageCrumbsSlot() }
            if (route !is Route.Web) {
              // Where the screen sits, as Figma heads every page: the scope, the group, the destination, then a pushed screen.
              val steps = if (row == null && route == null) null else {
                val group = allGroups.firstOrNull { g -> row != null && row in g.rows }?.label
                val place = row?.label
                buildList {
                  add(Crumb(workspace.site?.name ?: workspace.org?.name ?: "") { chrome.settingsMode = null; navigator.select(ShellNavigator.HOME) })
                  group?.let { add(Crumb(it, null)) }
                  place?.let { add(Crumb(it) { navigator.select(row?.key ?: navigator.top) }) }
                  // A section the row opens without tabs (Orders' Returns): the row leads back, then the section.
                  row?.sections?.firstOrNull { it.key == navigator.top && it.key != row.key }?.takeIf { row.rowId in SELF_SECTIONED_ROWS }?.let { add(Crumb(it.label, null)) }
                  if (route != null && title.isNotBlank() && title != place) add(Crumb(title, null))
                }.filter { it.label.isNotBlank() }
              }
              // A list beside its detail draws them atop its detail column instead (it claims the slot). Every page sets
              // the slot, so a page with no trail of its own never shows the one before it (or another tab's).
              androidx.compose.runtime.SideEffect {
                crumbsSlot.crumbs = if (steps == null) NoCrumbs else ({ Breadcrumbs(steps, star = starSlot?.takeIf { !it.claimed }) })
              }
              if (steps != null && !crumbsSlot.claimed) Breadcrumbs(steps, star = starSlot?.takeIf { !it.claimed })
              banner()
              sections?.let { SectionTabs(it, navigator.top) { key -> navigator.select(key) } }
            }
            Row(Modifier.weight(1f).fillMaxWidth()) {
              // The content area brings every screen in by E − 16, so a screen that pads its content by 16 lands on the one
              // content edge E (Zach 10/19); an in-app browser page stays full-bleed.
              val bodyInset = if (route is Route.Web) 0.dp else (com.aglyn.ui.contentInset() - com.aglyn.ui.DetailPanePadding).coerceAtLeast(0.dp)
              Box(Modifier.weight(1f).fillMaxHeight().padding(horizontal = bodyInset)) {
                CompositionLocalProvider(
                  com.aglyn.ui.LocalPageCrumbs provides crumbsSlot,
                  com.aglyn.ui.LocalBodyInset provides bodyInset,
                  com.aglyn.ui.LocalContentInset provides com.aglyn.ui.DetailPanePadding,
                ) { body() }
              }
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
    if (chrome.oneBox && !wide) {
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
    ScopePicker(
      services, workspace, chrome, fullScreen = !wide, twoStep = !wide || chrome.picker == PickerStep.SITE, onPinFull = { chrome.pinFullFor = it },
      onOpenWorkspace = { chrome.settingsMode = null; navigator.select(ShellNavigator.HOME) },
    ) { screen ->
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

/** The account's theme again with a white-label workspace's brand color as the accent, while you are in it. */
@Composable
private fun WorkspaceBrandTheme(services: ShellServices, dark: Boolean, accent: androidx.compose.ui.graphics.Color?, content: @Composable () -> Unit) {
  if (accent == null) content() else AccountTheme(services, dark, accent, content)
}

/** Which settings mode a screen belongs to, so opening a setting from search or Recents shows its list. */
private fun settingsModeFor(screen: String, params: Map<String, String>?, lists: Map<NativeNavListId, List<NavGroupItem>>): NativeNavListId? {
  val key = NavKeys.of(screen, params)
  return lists.entries.firstOrNull { (_, groups) -> groups.any { g -> g.rows.any { key in it.keys } } }?.key
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
        id = row?.rowId?.takeIf { navigator.top in row.keys } ?: navigator.top, kind = "screen", label = title, orgId = orgId, params = params.ifEmpty { null }, screen = screen,
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
  is Route.SearchResults -> "Search results"
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
  searchResults: @Composable (String) -> Unit,
  onWorkspaceColor: (String) -> Unit,
) {
  when (route) {
    is Route.SearchResults -> searchResults(route.query)
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

/**
 * An area's sections as tabs over it (Contacts, Leads, Deals… inside CRM), the console's section rail. The strip scrolls
 * edge to edge, but its first label starts on the content edge E and the underline sits under each label (Figma draws no
 * full-bleed strip, so the rule's edge holds; a Material tab row centers a short label in a 90 minimum and missed it).
 */
@Composable
internal fun SectionTabs(sections: List<NavSectionItem>, selected: String, onSelect: (String) -> Unit) {
  val index = sections.indexOfFirst { it.key == selected }.coerceAtLeast(0)
  val edge = com.aglyn.ui.contentInset()
  val scroll = androidx.compose.foundation.rememberScrollState()
  Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background).testTag("section-tabs")) {
    Row(
      Modifier.fillMaxWidth().horizontalScroll(scroll).padding(start = edge - 12.dp, end = edge - 12.dp).selectableGroup(),
      verticalAlignment = Alignment.Bottom,
    ) {
      sections.forEachIndexed { i, section ->
        val on = i == index
        Column(
          Modifier.clip(RoundedCornerShape(topStart = 6.dp, topEnd = 6.dp))
            .selectable(selected = on, role = Role.Tab, onClick = { onSelect(section.key) })
            .padding(horizontal = 12.dp).height(44.dp).testTag("section-${section.id}"),
          verticalArrangement = Arrangement.Bottom,
          horizontalAlignment = Alignment.CenterHorizontally,
        ) {
          Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
            Text(
              section.label, maxLines = 1, fontSize = 14.sp, lineHeight = 20.sp,
              fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
              color = if (on) com.aglyn.ui.aglynAccentText else MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
          // The underline spans the label, the console's tab indicator.
          Box(Modifier.height(3.dp).then(if (on) Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp)).background(MaterialTheme.colorScheme.primary) else Modifier))
        }
      }
    }
    HorizontalDivider(color = shellColors.divider)
  }
}

/**
 * The title bar over the main area on tablets and desktops: hide or show the sidebar, back, the title, "Search or jump to"
 * (Ctrl/⌘K) and the bell.
 */
/**
 * The window's tab strip (the first of the two chrome rows, Figma Mac/Titlebar 12:910): the window controls' room, the
 * tabs (each up to its natural width, ellipsized), and +; a hairline under it.
 */
@Composable
private fun WindowTabStrip(tabs: ShellTabs, onSelectTab: (ShellTab) -> Unit, onCloseTab: (ShellTab) -> Unit, onNewTab: () -> Unit, homeMark: @Composable () -> Unit) {
  val m = com.aglyn.ui.shellMetrics
  // The Mac's traffic lights sit at this row's left edge (a transparent, full-size title bar).
  val lights = if (LocalTitleBarInset.current > 0.dp) 76.dp else 8.dp
  val doubleClick = LocalWindowDoubleClick.current
  Row(
    Modifier.fillMaxWidth().background(shellColors.titleBar)
      // The row stands in for the title bar: a double-click on it zooms the window (or what the Mac is set to do).
      .then(if (doubleClick != null) Modifier.pointerInput(doubleClick) { detectTapGestures(onDoubleTap = { doubleClick() }) } else Modifier)
      .height(if (m.compact) 34.dp else 40.dp).padding(start = lights, end = if (LocalWindowCaption.current != null) 0.dp else 8.dp).testTag("tab-strip"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    Row(Modifier.weight(1f, fill = false).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
      for (tab in tabs.tabs) TitleTab(tab, selected = tab.id == tabs.activeId, closable = !tab.pinned, onSelect = { onSelectTab(tab) }, onClose = { onCloseTab(tab) }, homeMark = homeMark)
    }
    TitleBarButton("New tab  ${shortcutText("T")}", "add", "tab-new", onClick = onNewTab)
    // A tablet has no menu bar (Tab ▸ Show all tabs), so its strip offers the overview.
    if (!hasMenuBar && tabs.tabs.size > 1) TitleBarButton("All tabs", "grid_view", "tab-overview") { tabs.overview = true }
    // A window that draws its own caption (Windows): the row's empty stretch drags it, and its buttons end the row.
    val caption = LocalWindowCaption.current
    if (caption != null) {
      Spacer(
        Modifier.weight(1f).fillMaxHeight().testTag("window-caption-drag").onGloballyPositioned { c ->
          val at = c.positionInWindow()
          caption.drag = CaptionRect(at.x, at.y, at.x + c.size.width, at.y + c.size.height)
        },
      )
      caption.buttons()
    }
  }
  HorizontalDivider(color = shellColors.divider.copy(alpha = shellColors.divider.alpha * 0.6f))
}

/**
 * The toolbar (the second chrome row): the workspace switcher's toggle, back and forward; "Search or jump to ⌘K" centered
 * on the window (up to 480 wide); then the bell, help and AI. Nothing of a screen's own sits here.
 */
@Composable
private fun WideToolbar(
  services: ShellServices,
  navigator: ShellNavigator,
  chrome: NavChromeState,
  pushed: Boolean,
  uid: String,
  search: @Composable (Modifier) -> Unit,
  trailing: @Composable () -> Unit = {},
) {
  val m = com.aglyn.ui.shellMetrics
  Box(Modifier.fillMaxWidth().background(shellColors.titleBar).height(if (m.compact) 44.dp else 48.dp).padding(horizontal = 8.dp).testTag("title-bar")) {
    Row(Modifier.align(Alignment.CenterStart), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
      TitleBarButton(
        (if (chrome.railHidden) "Show workspace switcher  " else "Hide workspace switcher  ") + railToggleShortcut(),
        "view_sidebar",
        "toggle-rail",
      ) { chrome.toggleRail() }
      if (pushed) {
        TitleBarButton("Back", "arrow_back", "title-back") { navigator.back() }
      } else {
        // Back and forward through the places visited.
        TitleBarButton("Back", "arrow_back", "history-back", enabled = navigator.canGoBackInHistory) { navigator.historyBack() }
      }
      TitleBarButton("Forward", "arrow_forward", "history-forward", enabled = !pushed && navigator.canGoForwardInHistory) { navigator.historyForward() }
      val openRecent = LocalOpenRecent.current
      RecentHistoryButton(services.accountPrefs.state.collectAsState().value) { item -> openRecent?.invoke(item) }
    }
    // The global search is a real field, centered on the window (Figma 8:90); its dropdown hangs under it.
    search(Modifier.align(Alignment.Center).padding(horizontal = 160.dp).widthIn(max = 480.dp).fillMaxWidth().testTag("search-or-jump"))
    Row(Modifier.align(Alignment.CenterEnd), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
      BellButton(services, uid) { navigator.select(ShellNavigator.NOTIFICATIONS) }
      trailing()
    }
  }
}

/** The workspace switcher's shortcut: ⌃⌘S on a Mac, Ctrl+Alt+S elsewhere. */
internal fun railToggleShortcut(): String = if (isMacPlatform) "⌃⌘S" else "Ctrl+Alt+S"

/** One step of the breadcrumbs, and where it leads (none for a group heading or the page on screen). */
private data class Crumb(val label: String, val open: (() -> Unit)?)

/** "Bakery › Sell › Orders": where the screen sits; every step but the last leads back to it. */
@Composable
private fun Breadcrumbs(steps: List<Crumb>, star: com.aglyn.ui.PageStarSlot? = null) {
  // On the column's content edge E: a step that leads back pads its own text by 2 for its hover, so the row starts 2 in.
  // E above the content area; inside it (atop a detail column) what is left of E there.
  val edge = com.aglyn.ui.LocalContentInset.current ?: com.aglyn.ui.contentInset()
  val firstPads = steps.firstOrNull()?.let { it.open != null && steps.size > 1 } == true
  Row(
    Modifier.fillMaxWidth().padding(start = if (firstPads) edge - 2.dp else edge, end = edge, top = 12.dp, bottom = 4.dp).testTag("title-crumb"),
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
    star?.star?.invoke()
  }
}

/**
 * One tab in the title bar (Figma Titlebar/Tab 8:111): the screen's own icon (14), its title (13, semibold in use) and ×
 * at rest; the pinned Home tab has none. The title keeps the screen whole ("— Orders") and truncates the workspace or
 * site before it, up to 260 wide, as Apple's tab does.
 */
@Composable
private fun TitleTab(tab: ShellTab, selected: Boolean, closable: Boolean, onSelect: () -> Unit, onClose: () -> Unit, homeMark: @Composable () -> Unit) {
  val m = com.aglyn.ui.shellMetrics
  Surface(
    onClick = onSelect,
    shape = RoundedCornerShape(m.controlRadius),
    color = if (selected) MaterialTheme.colorScheme.surfaceContainerLowest else Color.Transparent,
    border = if (selected) androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant) else null,
    modifier = Modifier.height(if (m.compact) 28.dp else 36.dp).widthIn(max = 260.dp).testTag("tab-${tab.id}")
      .semantics { this.selected = selected; role = Role.Tab },
  ) {
    if (tab.pinned) {
      // The pinned Home tab is the brand's mark alone (the logo kit's mark, never faded).
      Box(Modifier.padding(horizontal = 9.dp).semantics { contentDescription = "Home: ${tab.title}" }, contentAlignment = Alignment.Center) {
        homeMark()
      }
      return@Surface
    }
    Row(Modifier.padding(start = 10.dp, end = if (closable) 2.dp else 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      Icon(AglynIcons.named(tab.icon ?: "tab"), null, Modifier.size(14.dp), tint = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
      val split = tab.title.lastIndexOf(" — ")
      val owner = tab.title.takeIf { split > 0 }?.substring(0, split)
      val place = if (split > 0) tab.title.substring(split + 3) else tab.title
      val style = MaterialTheme.typography.labelLarge.copy(fontSize = 13.sp, lineHeight = 18.sp)
      val weight = if (selected) FontWeight.SemiBold else FontWeight.Normal
      val ink = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant
      Row(Modifier.weight(1f, fill = false).testTag("tab-title-${tab.id}"), verticalAlignment = Alignment.CenterVertically) {
        owner?.let { Text("$it — ", style = style, fontWeight = weight, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false)) }
        Text(place, style = style, fontWeight = weight, color = ink, maxLines = 1, softWrap = false)
      }
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
/** What a page with no trail of its own puts in the breadcrumbs slot. */
private val NoCrumbs: @Composable () -> Unit = {}

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
      confirmButton = { com.aglyn.ui.TextButton(onClick = { full = false }) { Text("OK") } },
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

/**
 * The Home tab's mark (Figma 117:16049): the logo kit's mark, 16, never faded; a white-label workspace's own mark in its
 * place, as the console's chrome wears it (`resolveBrandingProfile`: entitled to `whiteLabel` and a mark set).
 */
@Composable
internal fun HomeTabMark(services: ShellServices, workspace: com.aglyn.core.WorkspaceState) {
  val org = workspace.org
  val entitlements = org?.let { services.entitlements.state(it.id).collectAsState().value }
  LaunchedEffect(org?.id) { org?.id?.let { services.entitlements.load(it) } }
  val logo = workspace.orgLogo
  val mark = logo?.brandMark?.takeIf { entitlements?.has("whiteLabel") == true }
  if (mark == null) {
    com.aglyn.ui.AglynMark(Modifier.size(16.dp).testTag("home-tab-mark"))
  } else {
    com.aglyn.ui.BrandPicture(
      com.aglyn.core.mediaPreviewUrl(mark, services.api.origin, null, 64),
      com.aglyn.core.mediaPreviewUrl(logo.brandMarkDark, services.api.origin, null, 64),
      16.dp,
      androidx.compose.foundation.shape.RoundedCornerShape(3.dp),
    ) { com.aglyn.ui.AglynMark(Modifier.size(16.dp)) }
    Box(Modifier.size(0.dp).testTag("home-tab-brand-mark"))
  }
}
