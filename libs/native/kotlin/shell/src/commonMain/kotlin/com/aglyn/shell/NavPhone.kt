package com.aglyn.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.rememberModalBottomSheetState
import com.aglyn.ui.LocalAccent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.NativeNavListId
import com.aglyn.contracts.StarredItem
import com.aglyn.core.AccountPreferences
import com.aglyn.core.AuthUser
import com.aglyn.core.WorkspaceState
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.WorkspaceTile
import com.aglyn.ui.radius
import com.aglyn.ui.shellColors
import com.aglyn.ui.space

/**
 * The phone shell (AGL-4006; Figma Android Home 22:775): the scope chip (opening the two-step picker),
 * search, the bell (Activity), Create new when four areas fill the tab bar, your AI and your photo on top; along the
 * bottom Home and the areas the person pinned for this site or the whole workspace, with Create new in the centre until
 * four areas fill the bar. Home is every area of the scope as the same tile; nothing sits behind a Menu or a More.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PhoneShell(
  services: ShellServices,
  navigator: ShellNavigator,
  chrome: NavChromeState,
  workspace: WorkspaceState,
  prefs: AccountPreferences,
  user: AuthUser?,
  uid: String,
  title: String,
  route: Route?,
  scopeGroups: List<NavGroupItem>,
  settingsGroups: List<NavGroupItem>?,
  sidebar: SidebarContent,
  starred: List<StarredItem>,
  sections: List<NavSectionItem>?,
  banner: @Composable () -> Unit,
  actions: ShellActions,
  enabled: Collection<String>,
  onRow: (NavItem) -> Unit,
  onStar: (StarredItem) -> Unit,
  body: @Composable () -> Unit,
  assistTitle: String? = null,
  assistContent: @Composable () -> Unit = {},
  help: List<HelpEntry> = emptyList(),
  context: ShellPluginContext? = null,
  team: NavItem? = null,
) {
  val top = navigator.top
  if (route is Route.Web) {
    // The browser screen brings its own bar; the system back gesture returns.
    body()
    return
  }
  val inSite = workspace.site != null
  val homeGroups = remember(scopeGroups, team, workspace.org?.name, inSite) { phoneHomeItems(scopeGroups, inSite, team, workspace.org?.name.orEmpty()) }
  val tabScope = workspace.org?.id?.let { com.aglyn.contracts.tabBarScope(it, workspace.site?.id) }
  val pinned = tabScope?.let { prefs.tabAreas(it) }.orEmpty()
  val tabs = phoneTabs(homeGroups, pinned)
  val items = homeGroups.flatMap { it.rows }.associateBy { it.rowId }
  val tabItems = tabs.slots.mapNotNull { items[it] }
  // The settings list a Site settings or Workspace settings tile opened (the navigator's Menu key, never a tab of its own).
  val settingsList = top == ShellNavigator.MENU && route == null && settingsGroups != null
  val onTab = route == null && tabItems.any { top in it.keys }
  val atHome = route == null && top == ShellNavigator.HOME && settingsGroups == null
  // Anything else is pushed on the Home tab, with the way back.
  val pushed = route != null || (!atHome && !onTab)
  val areaOnScreen = route == null && NavKeys.parse(top) != null && settingsGroups == null
  fun openTile(item: NavItem) {
    chrome.areaSwitcher = false
    val mode = item.opensSettings
    if (mode != null) {
      chrome.settingsMode = mode
      navigator.select(ShellNavigator.MENU)
      return
    }
    chrome.settingsMode = null
    navigator.select(item.key)
    if (com.aglyn.contracts.isTabPinnable(item.screen) && tabScope != null) services.accountPrefs.openedArea(item.rowId, tabScope)
  }
  fun goBack() {
    when {
      route != null -> navigator.back()
      settingsGroups != null && top != ShellNavigator.MENU -> navigator.select(ShellNavigator.MENU)
      else -> { chrome.settingsMode = null; navigator.select(ShellNavigator.HOME) }
    }
  }
  // In the phone's bold look the ground carries the brand's glow under the top bar (AGL-3990): the bars let it through.
  val bold = com.aglyn.ui.LocalPhoneBold.current
  val barGround = if (bold) androidx.compose.ui.graphics.Color.Transparent else MaterialTheme.colorScheme.background
  Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
  com.aglyn.ui.PhoneHeaderGlow()
  Scaffold(
    containerColor = barGround,
    topBar = {
      Column {
        banner()
        TopAppBar(
          title = {
            if (route != null || settingsGroups != null && !settingsList || top == ShellNavigator.NOTIFICATIONS || top == ShellNavigator.SETTINGS) {
              Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
            } else {
              ScopeChip(services, workspace, prefs) { chrome.picker = PickerStep.WORKSPACE }
            }
          },
          navigationIcon = {
            if (pushed) TitleBarButton("Back", "arrow_back", "title-back") { goBack() }
          },
          actions = {
            TitleBarButton("Search or jump to", "search", "phone-search") { chrome.oneBox = true }
            // The bell is Activity on a phone: what needs you, then the notifications.
            BellButton(services, uid) { chrome.settingsMode = null; navigator.select(ShellNavigator.NOTIFICATIONS) }
            // Four pinned areas fill the tab bar, so Create new comes up here, beside your AI (Figma Home · 4 pinned).
            if (tabs.createInTopBar) TitleBarButton("Create new", "add", "phone-create") { chrome.createMenu = true }
            // Your AI, one tap away on every screen as the tablet's and the desktop's title bar has it (Figma Phone/Top
            // bar 273:20194, Root and Pushed): after the bell, before your photo. The in-app browser keeps its own bar.
            if (assistTitle != null) TitleBarButton(assistTitle, "auto_awesome", "phone-ai") { chrome.toggleAiPanel(true) }
            AccountAvatar(user, size = 32, onClick = { chrome.accountMenu = true }, modifier = Modifier.padding(end = 8.dp).testTag("phone-account"))
          },
          colors = TopAppBarDefaults.topAppBarColors(containerColor = barGround),
        )
        if (route == null && !atHome) sections?.let { SectionTabs(it, top) { key -> navigator.select(key) } }
      }
    },
    bottomBar = {
      NavigationBar(containerColor = com.aglyn.ui.phoneTabBarColor(shellColors.sidebar), modifier = Modifier.testTag("phone-tabs")) {
        val colors = com.aglyn.ui.phoneTabItemColors()
        for (slot in tabs.slots) {
          when (slot) {
            com.aglyn.contracts.Contracts.tabBarHome ->
              PhoneTab("Home", "home", !onTab, "tab-home", colors) { chrome.settingsMode = null; navigator.select(ShellNavigator.HOME) }
            com.aglyn.contracts.Contracts.tabBarCreate -> NavigationBarItem(
              selected = false,
              onClick = { chrome.createMenu = true },
              icon = { com.aglyn.ui.PhoneCreateTile() },
              modifier = Modifier.testTag("tab-create"),
            )
            else -> items[slot]?.let { item ->
              PhoneTab(item.label, item.icon, onTab && top in item.keys, "tab-${item.rowId}", colors, count = context?.let { ctx -> { AreaCount(ctx, item.rowId) } }) {
                chrome.settingsMode = null
                navigator.select(item.key)
              }
            }
          }
        }
      }
    },
  ) { padding ->
    Box(Modifier.padding(padding).fillMaxSize()) {
      androidx.compose.runtime.CompositionLocalProvider(com.aglyn.ui.LocalAreaSwitcher provides if (areaOnScreen) ({ chrome.areaSwitcher = true }) else null) {
        when {
          settingsList -> PhoneMenu(services, workspace, chrome, sidebar, top, starred, onRow, onStar, assistTitle, help)
          atHome && workspace.ready && workspace.orgs.isNotEmpty() ->
            PhoneHome(
              services, context, homeGroups, tabScope, pinned, prefs.loaded, onOpen = ::openTile,
              onEditTabBar = { chrome.tabBarSheet = true },
              header = { context?.let { PhoneHomeHeader(services, it, workspace) } },
              stats = { context?.let { PhoneHomeStats(services, it, workspace) { navigator.select(NavKeys.of(NavKeys.ANALYTICS_SCREEN)) } } },
            )
          top == ShellNavigator.NOTIFICATIONS && route == null && context != null -> Column(Modifier.fillMaxSize()) {
            NeedsYouBlock(services, context, workspace, Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            Box(Modifier.weight(1f).fillMaxWidth()) { body() }
          }
          else -> body()
        }
      }
    }
  }
  }
  if (chrome.accountMenu) {
    ModalBottomSheet(onDismissRequest = { chrome.accountMenu = false }, modifier = Modifier.testTag("account-sheet")) {
      Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 16.dp)) {
        AccountMenuItems(services, user) { chrome.accountMenu = false }
        // The tab bar is yours: remove, reorder and add areas (AGL-4006).
        MenuRow("Tab bar", "tab", tag = "account-tab-bar") { chrome.accountMenu = false; chrome.tabBarSheet = true }
      }
    }
  }
  if (chrome.aiPanel && assistTitle != null) {
    PhoneAiSheet(assistTitle, onClose = { chrome.toggleAiPanel(false) }, content = assistContent)
  }
  if (chrome.createMenu) {
    ModalBottomSheet(onDismissRequest = { chrome.createMenu = false }, modifier = Modifier.testTag("create-sheet")) {
      Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 16.dp)) {
        Text("Create new", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        CreateMenuItems(services, workspace, enabled, uid) { item ->
          chrome.createMenu = false
          actions.openScreen(item.screen, item.params ?: mapOf("new" to "1"))
        }
      }
    }
  }
  if (chrome.areaSwitcher) {
    AreaSwitcherSheet(services, context, homeGroups, top, onOpen = ::openTile, onEditTabBar = { chrome.areaSwitcher = false; chrome.tabBarSheet = true }) {
      chrome.areaSwitcher = false
    }
  }
  if (chrome.tabBarSheet && tabScope != null) {
    TabBarSheet(homeGroups, tabs.pinnable, pinned, onDone = { next -> if (next != pinned) services.accountPrefs.setTabs(next, tabScope); chrome.tabBarSheet = false }) {
      chrome.tabBarSheet = false
    }
  }
}

/** A plugin's own count for an area (slot `sidebarCount.<row>`, Inbox's unread), drawn where the tile or tab wants it. */
@Composable
private fun AreaCount(context: ShellPluginContext, rowId: String) {
  for (widget in remember(rowId) { context.slotWidgets("sidebarCount.$rowId") }) widget.content(context)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun androidx.compose.foundation.layout.RowScope.PhoneTab(
  label: String,
  icon: String,
  selected: Boolean,
  tag: String,
  colors: androidx.compose.material3.NavigationBarItemColors,
  count: (@Composable () -> Unit)? = null,
  onClick: () -> Unit,
) {
  NavigationBarItem(
    selected = selected,
    onClick = onClick,
    icon = {
      if (count != null) {
        androidx.compose.material3.BadgedBox(badge = { count() }) { Icon(AglynIcons.named(icon), contentDescription = null) }
      } else {
        Icon(AglynIcons.named(icon), contentDescription = null)
      }
    },
    label = {
      Text(
        label, maxLines = 1, overflow = TextOverflow.Ellipsis,
        fontWeight = if (selected && com.aglyn.ui.LocalPhoneBold.current) FontWeight.Bold else null,
      )
    },
    colors = colors,
    modifier = Modifier.testTag(tag),
  )
}

/** The scope chip on a phone: the site (or the workspace) on screen, opening the picker. */
@Composable
private fun ScopeChip(services: ShellServices, workspace: WorkspaceState, prefs: AccountPreferences, onClick: () -> Unit) {
  val org = workspace.org
  val name = workspace.site?.name ?: org?.name ?: "Choose a workspace"
  val (color) = org?.id?.let { rememberWorkspaceColor(it, workspace, prefs, services.api.origin) } ?: (null to false)
  val (light, dark) = org?.id?.let { orgLogoUrls(workspace, it, services.api.origin) } ?: (null to null)
  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(20.dp),
    color = com.aglyn.ui.phoneChipColor(MaterialTheme.colorScheme.surfaceContainerHigh),
    border = com.aglyn.ui.phoneChipBorder(),
    modifier = Modifier.widthIn(max = 260.dp).testTag("scope-chip").semantics { contentDescription = "$name. Switch workspace or site" },
  ) {
    Row(Modifier.padding(start = 6.dp, end = 10.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      WorkspaceTile(org?.name ?: name, light, dark, color, size = 24.dp)
      Text(name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
      Icon(AglynIcons.named("expand_more"), null, Modifier.size(18.dp))
    }
  }
}

/**
 * A settings mode's list on a phone (Site settings, Workspace settings, opened from their Home tiles, AGL-4006): the way
 * back over the mode's title, then its grouped rows.
 */
@Composable
private fun PhoneMenu(
  services: ShellServices,
  workspace: WorkspaceState,
  chrome: NavChromeState,
  sidebar: SidebarContent,
  selectedKey: String,
  starred: List<StarredItem>,
  onRow: (NavItem) -> Unit,
  onStar: (StarredItem) -> Unit,
  assistTitle: String?,
  help: List<HelpEntry>,
) {
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp).testTag("phone-menu")) {
    if (sidebar.modeTitle != null) {
      BackLink(sidebar.modeBack ?: sidebar.modeTitle, tag = "settings-mode-back", onClick = sidebar.onExitMode)
      Text(sidebar.modeTitle, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp).testTag("settings-mode-title"))
    } else {
      ScopeHeader(services, workspace, chrome)
    }
    NavGroupsList(sidebar.groups, sidebar.groups, chrome, selectedKey, starred, onRow, onStar, dense = false)
  }
}

/**
 * The AI panel on a phone (Figma Android / Sheet / AI 273:20299): a sheet over a scrim that opens all the way, 16 under the
 * status bar, never floating over content. A drag handle, then ✦, the title and Close on one 36-tall row, then the panel;
 * the keyboard lifts the whole sheet, so the field stays in sight while you type.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PhoneAiSheet(title: String, onClose: () -> Unit, content: @Composable () -> Unit) {
  ModalBottomSheet(
    onDismissRequest = onClose,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    // The sheet stops 16 under the status bar, the scrim showing above it.
    modifier = Modifier.windowInsetsPadding(WindowInsets.statusBars.only(WindowInsetsSides.Top)).padding(top = space(2f)).testTag("ai-sheet"),
    containerColor = MaterialTheme.colorScheme.surfaceContainer,
    contentWindowInsets = { WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom) },
    dragHandle = {
      Box(Modifier.padding(top = space(1.5f), bottom = space(0.75f)).size(width = space(4f), height = space(0.5f)).background(MaterialTheme.colorScheme.outline, RoundedCornerShape(radius(0.5f))))
    },
  ) {
    Column(Modifier.fillMaxSize()) {
      Row(Modifier.fillMaxWidth().height(space(4.5f)).padding(start = space(2f), end = space(1f)), verticalAlignment = Alignment.CenterVertically) {
        Icon(AglynIcons.named("auto_awesome"), null, Modifier.size(space(2.5f)), tint = LocalAccent.current?.icon ?: MaterialTheme.colorScheme.primary)
        Text(
          title,
          style = MaterialTheme.typography.titleLarge,
          fontWeight = FontWeight.SemiBold,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.weight(1f).padding(start = space(1f)),
        )
        WithTooltip("Close") {
          IconButton(onClick = onClose, modifier = Modifier.size(space(4.5f)).testTag("ai-sheet-close")) {
            Icon(AglynIcons.named("close"), contentDescription = "Close", Modifier.size(space(2.5f)), tint = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
      Box(Modifier.fillMaxWidth().weight(1f).padding(top = space(0.25f))) { content() }
    }
  }
}
