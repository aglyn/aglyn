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
 * The phone shell: the scope chip (opening the two-step picker), search, the bell and your photo on top; Home, the
 * scope's busiest area, Create, Inbox and Menu along the bottom; a pushed screen keeps the bottom bar under a back arrow.
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
) {
  val (busiest, inbox) = phoneTabRows(scopeGroups, workspace.site != null)
  val top = navigator.top
  if (route is Route.Web) {
    // The browser screen brings its own bar; the system back gesture returns.
    body()
    return
  }
  val menuOpen = top == ShellNavigator.MENU && route == null
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
            if (route != null || settingsGroups != null && !menuOpen) {
              Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
            } else {
              ScopeChip(services, workspace, prefs) { chrome.picker = PickerStep.WORKSPACE }
            }
          },
          navigationIcon = {
            if (route != null) TitleBarButton("Back", "arrow_back", "title-back") { navigator.back() }
          },
          actions = {
            TitleBarButton("Search or jump to", "search", "phone-search") { chrome.oneBox = true }
            BellButton(services, uid) { navigator.select(ShellNavigator.NOTIFICATIONS) }
            // Your AI, one tap away on every screen as the tablet's and the desktop's title bar has it (Figma Phone/Top
            // bar 273:20194, Root and Pushed): after the bell, before your photo. The in-app browser keeps its own bar.
            if (assistTitle != null) TitleBarAIButton(assistTitle, "phone-ai") { chrome.toggleAiPanel(true) }
            AccountAvatar(user, size = 32, onClick = { chrome.accountMenu = true }, modifier = Modifier.padding(end = 8.dp).testTag("phone-account"))
          },
          colors = TopAppBarDefaults.topAppBarColors(containerColor = barGround),
        )
        if (route == null) sections?.let { SectionTabs(it, top) { key -> navigator.select(key) } }
      }
    },
    bottomBar = {
      NavigationBar(containerColor = com.aglyn.ui.phoneTabBarColor(shellColors.sidebar), modifier = Modifier.testTag("phone-tabs")) {
        val colors = com.aglyn.ui.phoneTabItemColors()
        PhoneTab("Home", "home", top == ShellNavigator.HOME && settingsGroups == null, "tab-home", colors) { chrome.settingsMode = null; navigator.select(ShellNavigator.HOME) }
        busiest?.let { row ->
          PhoneTab(row.label, row.icon, top in row.keys, "tab-${row.rowId}", colors) { chrome.settingsMode = null; navigator.select(row.key) }
        }
        NavigationBarItem(
          selected = false,
          onClick = { chrome.createMenu = true },
          icon = { com.aglyn.ui.PhoneCreateTile() },
          modifier = Modifier.testTag("tab-create"),
        )
        inbox?.let { row ->
          PhoneTab(row.label, row.icon, top in row.keys, "tab-${row.rowId}", colors) { chrome.settingsMode = null; navigator.select(row.key) }
        }
        PhoneTab("Menu", "menu", menuOpen || settingsGroups != null && route == null && top != ShellNavigator.HOME, "tab-menu", colors) {
          navigator.select(ShellNavigator.MENU)
        }
      }
    },
  ) { padding ->
    Box(Modifier.padding(padding).fillMaxSize()) {
      if (menuOpen) {
        PhoneMenu(services, workspace, chrome, sidebar, top, starred, onRow, onStar, assistTitle, help)
      } else {
        body()
      }
    }
  }
  }
  if (chrome.accountMenu) {
    ModalBottomSheet(onDismissRequest = { chrome.accountMenu = false }, modifier = Modifier.testTag("account-sheet")) {
      Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 16.dp)) {
        AccountMenuItems(services, user) { chrome.accountMenu = false }
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
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.PhoneTab(
  label: String,
  icon: String,
  selected: Boolean,
  tag: String,
  colors: androidx.compose.material3.NavigationBarItemColors,
  onClick: () -> Unit,
) {
  NavigationBarItem(
    selected = selected,
    onClick = onClick,
    icon = { Icon(AglynIcons.named(icon), contentDescription = null) },
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
 * The phone's Menu: the same grouped list as the tablet sidebar (Overview, Starred, Website, Sell, Customers, More, Site
 * settings), with a settings list in its place while one is open, and the scope header above it.
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
  var helpOpen by remember { mutableStateOf(false) }
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 8.dp).testTag("phone-menu")) {
    Text("Menu", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 8.dp))
    // The AI panel and help sit here and under the scope chip, never floating over content.
    Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      assistTitle?.let { androidx.compose.material3.AssistChip(onClick = { chrome.toggleAiPanel(true) }, label = { Text(it) }, leadingIcon = { com.aglyn.ui.AIGlyph(size = 18.dp) }, modifier = Modifier.testTag("menu-ai")) }
      Box {
        androidx.compose.material3.AssistChip(onClick = { helpOpen = true }, label = { Text("Help and docs") }, leadingIcon = { Icon(AglynIcons.named("help_outline"), null, Modifier.size(18.dp)) }, modifier = Modifier.testTag("menu-help"))
        androidx.compose.material3.DropdownMenu(helpOpen, onDismissRequest = { helpOpen = false }) {
          for (entry in help) MenuRow(entry.label, entry.icon, tag = entry.id) { helpOpen = false; entry.open() }
        }
      }
    }
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
  // In the phone's bold look (Figma 273:20299): the sheet on bg/sheet, the AI glow behind its top, the handle in
  // border/strong and ✦ in the brand gradient; otherwise as before.
  val bold = com.aglyn.ui.LocalPhoneBold.current
  val surfaces = com.aglyn.ui.LocalThemeSurfaces.current
  ModalBottomSheet(
    onDismissRequest = onClose,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    // The sheet stops 16 under the status bar, the scrim showing above it.
    modifier = Modifier.windowInsetsPadding(WindowInsets.statusBars.only(WindowInsetsSides.Top)).padding(top = space(2f)).testTag("ai-sheet"),
    containerColor = if (bold) surfaces?.raised ?: MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.surfaceContainer,
    contentWindowInsets = { WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom) },
    // The handle is drawn in the content, so the glow reaches behind it.
    dragHandle = null,
  ) {
    Box(Modifier.fillMaxSize()) {
      com.aglyn.ui.PhoneHeaderGlow(width = space(70f), height = space(27.5f))
      Column(Modifier.fillMaxSize()) {
        val handle = if (bold) surfaces?.borderStrong ?: MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.outline
        Box(
          Modifier.align(Alignment.CenterHorizontally).padding(top = space(1.5f), bottom = space(0.75f))
            .size(width = space(4f), height = space(0.5f)).background(handle, RoundedCornerShape(radius(0.5f))),
        )
        Row(Modifier.fillMaxWidth().height(space(4.5f)).padding(start = space(2f), end = space(1f)), verticalAlignment = Alignment.CenterVertically) {
          com.aglyn.ui.AIGlyph(size = space(2.5f))
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
}
