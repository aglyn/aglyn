package com.aglyn.shell

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.unit.sp
import com.aglyn.contracts.scoreMatch
import com.aglyn.core.WorkspaceSite
import com.aglyn.ui.ShellMotion
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.StarredItem
import com.aglyn.contracts.accountItemKey
import com.aglyn.core.WorkspaceState
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.SidebarWidth
import com.aglyn.ui.WorkspaceTile
import com.aglyn.ui.shellColors

/** What the sidebar shows: the scope's everyday list, a settings list, or the staff list. */
internal data class SidebarContent(
  val groups: List<NavGroupItem>,
  /** A settings or staff mode's title ("Site settings"); null over the everyday list. */
  val modeTitle: String?,
  val onExitMode: () -> Unit,
  /** Where the mode's "‹" line leads back to ("Juniper Street Bakery"). */
  val modeBack: String? = null,
)

/** One scope as the sidebar draws it, kept whole so a drill slides the old scope out while the new one comes in. */
private data class SidebarScene(val key: String, val depth: Int, val content: SidebarContent, val workspace: WorkspaceState)

/**
 * The sidebar for the scope on screen (tablet, desktop), Figma Sidebar 12:703: the scope's header (the workspace and its
 * menu; inside a site "‹ workspace" over the site's title row; in a settings mode "‹ place" over its title and search),
 * then the manifest's groups, folded except the one in use. Drilling in or out of a scope slides it (Motion 121:6163).
 */
@Composable
internal fun NavSidebar(
  services: ShellServices,
  workspace: WorkspaceState,
  chrome: NavChromeState,
  content: SidebarContent,
  selectedKey: String,
  starred: List<StarredItem>,
  onRow: (NavItem) -> Unit,
  onStar: (StarredItem) -> Unit,
  modifier: Modifier = Modifier,
  /** What sits at the sidebar's foot, below the lists (the plan card while a limit is close). */
  foot: @Composable () -> Unit = {},
) {
  val shell = shellColors
  val m = com.aglyn.ui.shellMetrics
  val reduce = com.aglyn.ui.reduceMotion()
  val mode = chrome.settingsMode
  // How deep the scope sits: the workspace, then a site or the workspace's settings, then a site's settings.
  val depth = when {
    mode == com.aglyn.contracts.NativeNavListId.SITE_SETTINGS -> 2
    mode != null || workspace.site != null -> 1
    else -> 0
  }
  val scene = SidebarScene("${mode?.raw}|${workspace.site?.id}|${workspace.org?.id}", depth, content, workspace)
  // One flush, full-height column under the toolbar (no inset card), on the theme's own sidebar ground: a workspace's
  // color never washes it (AGL-4000).
  Column(modifier.width(m.sidebarWidth).fillMaxHeight().background(shell.sidebar).testTag("nav-sidebar")) {
    AnimatedContent(
      targetState = scene,
      contentKey = { it.key },
      transitionSpec = {
        val forward = targetState.depth > initialState.depth
        val back = targetState.depth < initialState.depth
        if (reduce || (!forward && !back)) {
          // Another workspace or site at the same depth, or Reduce Motion: a short cross-fade.
          fadeIn(ShellMotion.crossFade()) togetherWith fadeOut(ShellMotion.crossFade())
        } else {
          // In: the new scope slides in from the trailing edge as the old one leaves to the leading edge; back reverses it.
          val sign = if (forward) 1 else -1
          (slideInHorizontally(ShellMotion.drill()) { w -> sign * w } + fadeIn(tween(ShellMotion.DRILL_MS))) togetherWith
            (slideOutHorizontally(ShellMotion.drill()) { w -> -sign * w } + fadeOut(tween(ShellMotion.DRILL_MS)))
        }.using(SizeTransform(clip = true))
      },
      modifier = Modifier.weight(1f).fillMaxWidth().clipToBounds(),
      label = "sidebar-scope",
    ) { s ->
      SidebarScope(services, s.workspace, chrome, s.content, selectedKey, starred, onRow, onStar)
    }
    foot()
  }
}

@Composable
private fun SidebarScope(
  services: ShellServices,
  workspace: WorkspaceState,
  chrome: NavChromeState,
  content: SidebarContent,
  selectedKey: String,
  starred: List<StarredItem>,
  onRow: (NavItem) -> Unit,
  onStar: (StarredItem) -> Unit,
) {
  val m = com.aglyn.ui.shellMetrics
  var filter by remember(content.modeTitle) { mutableStateOf("") }
  Column(Modifier.fillMaxSize()) {
    // Figma Sidebar's Header: 8 around it at Compact; 12 at the top and sides and 8 under it at Touch.
    Column(Modifier.fillMaxWidth().padding(start = m.sidebarPad, end = m.sidebarPad, top = m.sidebarPad, bottom = 8.dp)) {
      if (content.modeTitle != null) {
        ModeHeader(content.modeBack ?: "Back", content.modeTitle, content.onExitMode) { SettingsSearchField(filter) { filter = it } }
      } else {
        ScopeHeader(services, workspace, chrome)
      }
    }
    // Figma Sidebar's Rows: 4 above and 12 below, 2 between items. Every item keeps 1 above and below itself, so the
    // column's own padding is 1 less.
    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = m.sidebarPad, end = m.sidebarPad, top = 3.dp, bottom = 11.dp)) {
      NavGroupsList(
        groups = content.groups,
        listOrder = content.groups,
        chrome = chrome,
        selectedKey = selectedKey,
        starred = starred,
        onRow = onRow,
        onStar = onStar,
        dense = true,
        filter = filter,
      )
    }
  }
}

/**
 * A settings mode's head: "‹ Juniper Street Bakery" back, its title, then its search, 8 apart (Figma Sidebar, Scope =
 * Settings).
 */
@Composable
private fun ModeHeader(back: String, title: String, onBack: () -> Unit, search: @Composable () -> Unit) {
  val m = com.aglyn.ui.shellMetrics
  Column(Modifier.fillMaxWidth().padding(scopeHeaderPadding(m)), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    BackLine(back, tag = "settings-mode-back", onClick = onBack)
    Text(
      title,
      fontSize = m.modeTitleText,
      lineHeight = 24.sp,
      fontWeight = FontWeight.SemiBold,
      color = MaterialTheme.colorScheme.onSurface,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.semantics { heading() }.testTag("settings-mode-title"),
    )
    search()
  }
}

/** Figma Sidebar/Scope header's padding: 8 at the sides and 6 above and below (Compact); 10, 6 and 8 (Touch). */
private fun scopeHeaderPadding(m: com.aglyn.ui.ShellMetrics) =
  androidx.compose.foundation.layout.PaddingValues(start = m.rowPad, end = m.rowPad, top = 6.dp, bottom = if (m.compact) 6.dp else 8.dp)

/** "Search settings": settings get their own search, which narrows the list as you type. */
@Composable
private fun SettingsSearchField(value: String, onChange: (String) -> Unit) {
  CompactSearchField(value, "Search settings", "settings-mode-search", onChange = onChange)
}

/** A small search field (Figma Menu/Search field): 28 to 32 tall, a 14 icon, 13 text, the control radius. */
@Composable
internal fun CompactSearchField(
  value: String,
  placeholder: String,
  tag: String,
  modifier: Modifier = Modifier,
  autoFocus: Boolean = false,
  /** Figma's settings search is 28 tall at Compact; a menu's (Menu/Search field) is 32. */
  height: androidx.compose.ui.unit.Dp = 28.dp,
  onChange: (String) -> Unit,
) {
  val m = com.aglyn.ui.shellMetrics
  val focus = remember { androidx.compose.ui.focus.FocusRequester() }
  if (autoFocus) LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
  val ink = MaterialTheme.colorScheme.onSurface
  androidx.compose.foundation.text.BasicTextField(
    value,
    onValueChange = onChange,
    singleLine = true,
    textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = m.rowText, lineHeight = 18.sp, color = ink),
    cursorBrush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary),
    modifier = modifier.fillMaxWidth().focusRequester(focus).testTag(tag),
    decorationBox = { field ->
      Row(
        Modifier.fillMaxWidth().heightIn(min = if (m.compact) height else 36.dp).clip(RoundedCornerShape(m.controlRadius))
          .background(MaterialTheme.colorScheme.surfaceContainerHighest).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
      ) {
        Icon(AglynIcons.named("search"), null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Box(Modifier.weight(1f)) {
          if (value.isEmpty()) Text(placeholder, fontSize = m.rowText, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
          field()
        }
      }
    },
  )
}

/**
 * The scope's header. The whole workspace: its tile, name and plan, opening the workspace menu. Inside a site (Figma Sidebar
 * 12:703, Scope = Site): "‹ Juniper Street Co." back to the whole workspace, then the site's title row, whose ▾ switches
 * to another site of the workspace. There is no separate step to "work on" a site: opening it drills in.
 */
@Composable
internal fun ScopeHeader(services: ShellServices, workspace: WorkspaceState, chrome: NavChromeState) {
  val org = workspace.org ?: return
  val site = workspace.site
  val m = com.aglyn.ui.shellMetrics
  if (site == null) {
    // With the workspace switcher (the rail) hidden, the header opens the switcher; otherwise the workspace's menu.
    WorkspaceHeaderRow(
      services, workspace, chrome,
      onClick = { if (chrome.railHidden) chrome.picker = PickerStep.WORKSPACE else chrome.workspaceMenu = true },
      tag = "workspace-menu-button",
      description = if (chrome.railHidden) "${org.name}. Switch workspace" else "${org.name} menu",
    )
    workspaceMenuAnchor(services, workspace, chrome)
  } else {
    Column(Modifier.fillMaxWidth().padding(scopeHeaderPadding(m)), verticalArrangement = Arrangement.spacedBy(8.dp)) {
      BackLine(org.name, tag = "scope-back-to-workspace") { services.workspace.selectWholeWorkspace() }
      SiteTitleRow(services, workspace, site)
    }
    workspaceMenuAnchor(services, workspace, chrome)
  }
}

/** The workspace's header: its logo (20, radius 5), name and plan, and ▾ for its menu. */
@Composable
private fun WorkspaceHeaderRow(services: ShellServices, workspace: WorkspaceState, chrome: NavChromeState, onClick: () -> Unit, tag: String, description: String) {
  val org = workspace.org ?: return
  val prefs = services.accountPrefs.state.collectAsState().value
  val (light, dark) = orgLogoUrls(workspace, org.id, services.api.origin)
  val (color) = rememberWorkspaceColor(org.id, workspace, prefs, services.api.origin)
  val m = com.aglyn.ui.shellMetrics
  Row(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(m.controlRadius)).clickable(onClick = onClick).padding(horizontal = m.rowPad, vertical = if (m.compact) 6.dp else 8.dp)
      .testTag(tag).semantics(mergeDescendants = true) { role = Role.Button; contentDescription = description },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    WorkspaceTile(org.name, light, dark, color, size = m.workspaceLogo, cornerRadius = m.workspaceLogoRadius, initialSize = m.rowText * 0.8f, initials = com.aglyn.contracts.workspaceInitial(org.name))
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(
        org.name,
        style = MaterialTheme.typography.titleSmall.copy(fontSize = if (m.compact) 13.sp else 14.sp, lineHeight = if (m.compact) 18.sp else 20.sp),
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      workspace.orgLogo?.plan?.let { PlanChip(it) }
    }
    androidx.compose.material3.IconButton(onClick = { chrome.workspaceMenu = true }, modifier = Modifier.size(m.barButton).testTag("workspace-menu-chevron")) {
      Icon(AglynIcons.named("expand_more"), "${org.name} menu", Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

/** The workspace menu, anchored under the header that opens it. */
@Composable
private fun workspaceMenuAnchor(services: ShellServices, workspace: WorkspaceState, chrome: NavChromeState) {
  Box { WorkspaceMenu(services, workspace, chrome) }
}

/**
 * The site's title row in its own sidebar: its favicon (20), its name (semibold) and ▾, which opens the site switcher
 * anchored under it (Figma "Mac / Popover / Site switcher" 16:425).
 */
@Composable
private fun SiteTitleRow(services: ShellServices, workspace: WorkspaceState, site: WorkspaceSite) {
  val m = com.aglyn.ui.shellMetrics
  var switching by remember { mutableStateOf(false) }
  Box {
    Row(
      Modifier.fillMaxWidth().clip(RoundedCornerShape(m.controlRadius)).clickable { switching = true }.testTag("site-picker-button")
        .semantics(mergeDescendants = true) { role = Role.Button; contentDescription = "Site: ${site.name}. Switch site" },
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      com.aglyn.ui.BrandPicture(com.aglyn.core.mediaPreviewUrl(site.favicon, services.api.origin, site.id, 96), null, m.headerLogo, RoundedCornerShape(m.headerLogoRadius)) {
        WorkspaceTile(site.name, null, null, null, size = m.headerLogo, cornerRadius = m.headerLogoRadius, initialSize = m.rowText * 0.7f)
      }
      Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(site.name, fontSize = m.siteTitleText, lineHeight = if (m.compact) 18.sp else 20.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        Icon(AglynIcons.named("expand_more"), null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    if (switching) SiteSwitcherPopover(services, workspace) { switching = false }
  }
}

/**
 * The site switcher (Figma 16:425): find a site, Recent (this workspace's recently opened sites) first, then the rest A to
 * Z, then View all sites and Create site. Esc, a click outside or a pick closes it.
 */
@Composable
internal fun SiteSwitcherPopover(services: ShellServices, workspace: WorkspaceState, onDismiss: () -> Unit) {
  val m = com.aglyn.ui.shellMetrics
  val prefs by services.accountPrefs.state.collectAsState()
  val actions = LocalShellActions.current
  var query by remember { mutableStateOf("") }
  val orgId = workspace.org?.id
  val recentIds = prefs.recents.filter { it.orgId == orgId }.mapNotNull { it.hostId }.distinct()
  val sites = workspace.sites
  val recent = recentIds.mapNotNull { id -> sites.firstOrNull { it.id == id } }.take(5)
  val rest = sites.filter { s -> recent.none { it.id == s.id } }.sortedBy { it.name.lowercase() }
  val matches = if (query.isBlank()) null else sites.mapNotNull { site -> scoreMatch(site.name, listOfNotNull(site.subdomain, site.cname), query)?.let { it to site } }
    .sortedWith { a, b -> com.aglyn.contracts.scoredOrder.compare(a.first to a.second.name, b.first to b.second.name) }.map { it.second }
  fun pick(site: WorkspaceSite) { onDismiss(); services.workspace.selectSite(site.id) }
  androidx.compose.ui.window.Popup(
    popupPositionProvider = remember { BelowAnchor() },
    onDismissRequest = onDismiss,
    properties = androidx.compose.ui.window.PopupProperties(focusable = true),
  ) {
    Surface(
      shape = RoundedCornerShape(m.sheetRadius),
      color = MaterialTheme.colorScheme.surfaceContainerLow,
      shadowElevation = 8.dp,
      tonalElevation = 2.dp,
      border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
      modifier = Modifier.width(344.dp).heightIn(max = 420.dp).testTag("site-switcher")
        .onPreviewKeyEvent { e -> if (e.type == KeyEventType.KeyDown && e.key == Key.Escape) { onDismiss(); true } else false },
    ) {
      Column(Modifier.padding(6.dp)) {
        CompactSearchField(query, "Find a site", "site-switcher-search", autoFocus = true, height = 32.dp) { query = it }
        Spacer(Modifier.height(6.dp))
        Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
          if (matches != null) {
            if (matches.isEmpty()) MenuLabel("No sites match")
            for (site in matches) SwitcherSiteRow(services, site, site.id == workspace.site?.id) { pick(site) }
          } else {
            if (recent.isNotEmpty()) MenuLabel("Recent")
            for (site in recent) SwitcherSiteRow(services, site, site.id == workspace.site?.id) { pick(site) }
            if (recent.isNotEmpty() && rest.isNotEmpty()) MenuLabel("All sites")
            for (site in rest) SwitcherSiteRow(services, site, site.id == workspace.site?.id) { pick(site) }
          }
        }
        HorizontalDivider(Modifier.padding(vertical = 4.dp), color = shellColors.divider)
        SwitcherAction("View all sites", "grid_view", "site-switcher-all") { onDismiss(); services.workspace.selectWholeWorkspace(); actions?.openScreen?.invoke("site.sites", emptyMap()) }
        SwitcherAction("Create site", "add", "site-switcher-create") { onDismiss(); services.workspace.selectWholeWorkspace(); actions?.openScreen?.invoke("site.sites", emptyMap()) }
      }
    }
  }
}

/** Places a popup under its anchor, its leading edges aligned, kept inside the window. */
internal class BelowAnchor(private val gap: Int = 4) : androidx.compose.ui.window.PopupPositionProvider {
  override fun calculatePosition(
    anchorBounds: androidx.compose.ui.unit.IntRect,
    windowSize: androidx.compose.ui.unit.IntSize,
    layoutDirection: androidx.compose.ui.unit.LayoutDirection,
    popupContentSize: androidx.compose.ui.unit.IntSize,
  ): androidx.compose.ui.unit.IntOffset {
    val x = anchorBounds.left.coerceIn(0, (windowSize.width - popupContentSize.width).coerceAtLeast(0))
    val y = (anchorBounds.bottom + gap).coerceAtMost((windowSize.height - popupContentSize.height).coerceAtLeast(0))
    return androidx.compose.ui.unit.IntOffset(x, y)
  }
}

@Composable
private fun MenuLabel(text: String) {
  // Figma Menu/Section label: 28 tall, 8 above and 4 below 12/16 semibold.
  Text(text, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 10.dp, end = 10.dp, top = 8.dp, bottom = 4.dp))
}

/** One site in the switcher (Figma: 44 tall, favicon 24 radius 6, name 13 semibold, address 12, a check on the current). */
@Composable
private fun SwitcherSiteRow(services: ShellServices, site: WorkspaceSite, current: Boolean, onClick: () -> Unit) {
  Row(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).clickable(onClick = onClick).heightIn(min = 44.dp).padding(horizontal = 10.dp)
      .testTag("site-switcher-${site.id}").semantics(mergeDescendants = true) { role = Role.Button; this.selected = current },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    com.aglyn.ui.BrandPicture(com.aglyn.core.mediaPreviewUrl(site.favicon, services.api.origin, site.id, 96), null, 24.dp, RoundedCornerShape(6.dp)) {
      WorkspaceTile(site.name, null, null, null, size = 24.dp, cornerRadius = 6.dp, initialSize = 10.sp)
    }
    Column(Modifier.weight(1f)) {
      Text(site.name, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(site.address ?: site.subdomain, fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    if (current) Icon(AglynIcons.named("check"), null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
  }
}

@Composable
private fun SwitcherAction(label: String, icon: String, tag: String, onClick: () -> Unit) {
  Row(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).clickable(onClick = onClick).heightIn(min = 30.dp).padding(horizontal = 10.dp).testTag(tag),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Icon(AglynIcons.named(icon), null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurface)
    Text(label, fontSize = 13.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurface)
  }
}

@Composable
internal fun PlanChip(plan: String) {
  Text(
    plan.replaceFirstChar { it.uppercase() },
    style = MaterialTheme.typography.labelSmall.copy(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold),
    color = MaterialTheme.colorScheme.onPrimaryContainer,
    modifier = Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer).padding(horizontal = 7.dp, vertical = 1.dp),
  )
}

/** "‹ Name" as Figma's scope header draws it: a 14 chevron, 12 text in the secondary color, 4 between. */
@Composable
internal fun BackLine(label: String, tag: String, onClick: () -> Unit) {
  Row(
    Modifier.clip(RoundedCornerShape(4.dp)).clickable(onClick = onClick).testTag(tag).semantics(mergeDescendants = true) { role = Role.Button; contentDescription = "Back to $label" },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    Icon(AglynIcons.named("chevron_left"), null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(label, fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

/** "‹ Name": a step back out of a scope or a mode. */
@Composable
internal fun BackLink(label: String, tag: String, onClick: () -> Unit) {
  Row(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(com.aglyn.ui.shellMetrics.pillRadius)).clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 6.dp).testTag(tag)
      .semantics { role = Role.Button; contentDescription = "Back to $label" },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    Icon(AglynIcons.named("chevron_left"), null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(label, style = MaterialTheme.typography.bodyMedium.copy(fontSize = com.aglyn.ui.shellMetrics.rowText), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

/** Where the selected row sits in its list, so one pill can move between rows (Figma Motion: the selection pill). */
@Stable
internal class SelectionPill {
  var bounds by mutableStateOf<androidx.compose.ui.geometry.Rect?>(null)
  var owner: String? = null
}

internal val LocalSelectionPill = staticCompositionLocalOf<SelectionPill?> { null }

/** The groups of the site and workspace lists that make up their top block (Home, Overview, Starred). */
private val TOP_BLOCK = setOf("top", "starred")

/**
 * Where Figma draws a hairline before a group (Sidebar 12:703): in the workspace list after Home; in a site's list after the
 * top block, above More and above Site settings; in a settings list above Danger zone and any heading-less group.
 */
private fun dividerBefore(listId: com.aglyn.contracts.NativeNavListId, group: NavGroupItem, previous: NavGroupItem?): Boolean {
  if (previous == null) return false
  return when (listId) {
    com.aglyn.contracts.NativeNavListId.WORKSPACE -> previous.id == "top"
    com.aglyn.contracts.NativeNavListId.SITE ->
      group.id == "more" || group.id == "settings" || (previous.id in TOP_BLOCK && group.id !in TOP_BLOCK)
    else -> group.id == "danger" || (group.label == null && !group.foldable && group.id != "top")
  }
}

/**
 * The groups of one list, drawn the same way in the sidebar and in the phone's Menu (Figma Sidebar 12:703): a group's
 * heading is a small label (11 semibold, secondary) with its chevron after it and, while folded, its count at the right;
 * its rows sit 12 further in than the heading; More is a row of its own; hairlines part the blocks. Folding animates its
 * height, and one selection pill moves between rows. [filter] narrows a settings list as its search is typed.
 */
@Composable
internal fun NavGroupsList(
  groups: List<NavGroupItem>,
  listOrder: List<NavGroupItem>,
  chrome: NavChromeState,
  selectedKey: String,
  starred: List<StarredItem>,
  onRow: (NavItem) -> Unit,
  onStar: (StarredItem) -> Unit,
  dense: Boolean,
  filter: String = "",
) {
  val reduce = com.aglyn.ui.reduceMotion()
  val pill = remember { SelectionPill() }
  var origin by remember { mutableStateOf<androidx.compose.ui.layout.LayoutCoordinates?>(null) }
  val query = filter.trim()
  val listId = listOrder.flatMap { it.rows }.firstOrNull()?.listId ?: com.aglyn.contracts.NativeNavListId.SITE
  Box(Modifier.fillMaxWidth().onGloballyPositioned { origin = it }) {
    SelectionPillLayer(pill, dense, reduce)
    CompositionLocalProvider(LocalSelectionPill provides pill, LocalPillOrigin provides origin) {
      // Opening a destination opens its own group if the person had folded it, and leaves every other group as it is.
      val currentGroup = groups.firstOrNull { g -> g.foldable && g.dynamic != "starred" && g.rows.any { selectedKey in it.keys } }?.id
      androidx.compose.runtime.LaunchedEffect(listId, selectedKey, currentGroup) { currentGroup?.let { chrome.reveal(listId, it) } }
      Column(Modifier.fillMaxWidth()) {
        // The workspace's header has a hairline under it (Figma Sidebar, Scope = Workspace).
        if (dense && listId == com.aglyn.contracts.NativeNavListId.WORKSPACE && query.isEmpty()) NavDivider(Modifier.padding(vertical = 1.dp))
        var previous: NavGroupItem? = null
        for (group in groups) {
          val isStarred = group.dynamic == "starred"
          val rows = if (query.isEmpty()) group.rows else group.rows.filter { it.label.contains(query, ignoreCase = true) || it.keywords.any { k -> k.contains(query, ignoreCase = true) } }
          if (isStarred && (starred.isEmpty() || query.isNotEmpty())) continue
          if (!isStarred && rows.isEmpty()) continue
          if (query.isEmpty() && dividerBefore(listId, group, previous)) NavDivider(Modifier.padding(vertical = 1.dp))
          previous = group
          val holdsCurrent = rows.any { selectedKey in it.keys }
          val open = query.isNotEmpty() || !group.foldable || chrome.isOpen(listId, group.id, holdsCurrent)
          val indented = group.label != null
          when {
            group.id == "more" && group.foldable && query.isEmpty() -> {
              // More is a row of its own (Figma "··· More"), opening its rows under it.
              NavLine("More", "more_horiz", selected = false, dense = dense, badge = 0, tag = "nav-group-more", trailingChevron = if (open) 90f else 0f) {
                chrome.toggle(listId, group.id, !open)
              }
            }
            group.label != null && group.foldable -> GroupHeading(group.label, open, if (isStarred) starred.size else rows.size, dense, "nav-group-${group.id}") {
              chrome.toggle(listId, group.id, !open)
            }
            group.label != null -> GroupHeading(group.label, open = true, count = 0, dense = dense, tag = "nav-group-${group.id}", onClick = null)
          }
          androidx.compose.animation.AnimatedVisibility(
            visible = open,
            enter = if (reduce) fadeIn(ShellMotion.crossFade()) else expandVertically(ShellMotion.fold()) + fadeIn(ShellMotion.fold()),
            exit = if (reduce) fadeOut(ShellMotion.crossFade()) else shrinkVertically(ShellMotion.fold()) + fadeOut(ShellMotion.fold()),
          ) {
            Column(Modifier.fillMaxWidth()) {
              if (isStarred) for (item in starred) StarRow(item, selectedKey, dense, indented) { onStar(item) }
              for (row in rows) NavRow(row, selected = selectedKey in row.keys, dense = dense, indented = indented) { onRow(row) }
            }
          }
        }
      }
    }
  }
}

internal val LocalPillOrigin = staticCompositionLocalOf<androidx.compose.ui.layout.LayoutCoordinates?> { null }

/** The one selection pill behind the rows, moving to the selected row on the pill spring (a fade with Reduce Motion). */
@Composable
private fun SelectionPillLayer(pill: SelectionPill, dense: Boolean, reduce: Boolean) {
  val target = pill.bounds ?: return
  val density = androidx.compose.ui.platform.LocalDensity.current
  val m = com.aglyn.ui.shellMetrics
  var placed by remember { mutableStateOf(false) }
  val y by androidx.compose.animation.core.animateFloatAsState(target.top, if (!placed || reduce) androidx.compose.animation.core.snap() else ShellMotion.pill(), label = "pill-y")
  val h by androidx.compose.animation.core.animateFloatAsState(target.height, if (!placed || reduce) androidx.compose.animation.core.snap() else ShellMotion.pill(), label = "pill-h")
  LaunchedEffect(Unit) { placed = true }
  with(density) {
    Box(
      Modifier.offset { androidx.compose.ui.unit.IntOffset(target.left.toInt(), y.toInt()) }
        .size(target.width.toDp(), h.toDp())
        .clip(RoundedCornerShape(if (dense) m.pillRadius else 8.dp))
        .background(shellColors.selected)
        .testTag("nav-selection-pill"),
    )
  }
}

/** A hairline in the border-subtle token, inset to the row padding (Figma Sidebar/Divider). */
@Composable
internal fun NavDivider(modifier: Modifier = Modifier) {
  val m = com.aglyn.ui.shellMetrics
  HorizontalDivider(modifier.padding(horizontal = m.rowPad, vertical = m.dividerPad), thickness = 1.dp, color = shellColors.divider)
}

/** A group's heading: 11 semibold in the secondary color, the chevron after it, and its count at the right while folded. */
@Composable
private fun GroupHeading(label: String, open: Boolean, count: Int, dense: Boolean, tag: String, onClick: (() -> Unit)?) {
  val m = com.aglyn.ui.shellMetrics
  val turn by androidx.compose.animation.core.animateFloatAsState(if (open) 90f else 0f, ShellMotion.fold(), label = "chevron")
  Row(
    Modifier.fillMaxWidth().padding(vertical = 1.dp).clip(RoundedCornerShape(if (dense) m.pillRadius else 8.dp))
      .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
      .heightIn(min = if (dense) m.groupHeader else 36.dp)
      .padding(horizontal = if (dense) m.rowPad else 10.dp)
      .testTag(tag)
      .semantics { heading(); if (onClick != null) { role = Role.Button; stateDescription = if (open) "Open" else "Folded" } },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    Text(label, fontSize = 11.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    if (onClick != null) {
      Icon(AglynIcons.named("chevron_right"), null, Modifier.size(m.groupChevron).rotate(turn), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Spacer(Modifier.weight(1f))
    if (!open && count > 0) {
      Text(
        count.toString(),
        fontSize = 12.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.clip(RoundedCornerShape(9.dp)).padding(horizontal = 6.dp, vertical = 1.dp).testTag("$tag-count"),
      )
    }
  }
}

@Composable
internal fun NavRow(row: NavItem, selected: Boolean, dense: Boolean, badge: Int = 0, indented: Boolean = false, onClick: () -> Unit) {
  NavLine(row.label, row.icon, selected, dense, badge, tag = "nav-${row.listId.raw}-${row.rowId}", chevron = !dense && row.opensSettings == null, indented = indented, onClick = onClick)
}

@Composable
private fun StarRow(item: StarredItem, selectedKey: String, dense: Boolean, indented: Boolean, onClick: () -> Unit) {
  val dot = starDotColor(item)
  NavLine(item.label, null, selectedKey == NavKeys.of(item.screen, item.params), dense, 0, tag = "nav-star-${accountItemKey(item)}", dot = dot, indented = indented, onClick = onClick)
}

/** A starred item's dot: its picked color from the picker's colors, the primary blue when it has none. */
@Composable
internal fun starDotColor(item: StarredItem): Color = shellColors.picks[starPickIndex(item.color)]

/** Where each star color sits among the picker's colors. */
internal fun starPickIndex(color: com.aglyn.contracts.StarColor?): Int = when (color) {
  com.aglyn.contracts.StarColor.BLUE, null, com.aglyn.contracts.StarColor.UNKNOWN -> 0
  com.aglyn.contracts.StarColor.PURPLE -> 1
  com.aglyn.contracts.StarColor.PINK -> 2
  com.aglyn.contracts.StarColor.GREEN -> 3
  com.aglyn.contracts.StarColor.ORANGE -> 4
  com.aglyn.contracts.StarColor.RED -> 5
  com.aglyn.contracts.StarColor.YELLOW -> 6
  com.aglyn.contracts.StarColor.GREY -> 7
}

/**
 * One line of a nav list (Figma Sidebar/Row): icon (or a star's dot), label, an optional count of what waits. A row inside a
 * group sits [ShellMetrics.groupIndent] further in. The selection is the list's one moving pill; a line outside a list
 * draws its own.
 */
@Composable
internal fun NavLine(
  label: String,
  icon: String?,
  selected: Boolean,
  dense: Boolean,
  badge: Int,
  tag: String,
  dot: Color? = null,
  chevron: Boolean = false,
  indented: Boolean = false,
  /** More's chevron after its label, turned this many degrees (90 while open); null for none. */
  trailingChevron: Float? = null,
  onClick: () -> Unit,
) {
  val shell = shellColors
  val density = com.aglyn.ui.LocalUiDensity.current
  val m = com.aglyn.ui.shellMetrics
  val pill = LocalSelectionPill.current
  val origin = LocalPillOrigin.current
  // The sidebar (dense) takes the window's Size metrics, a little tighter at Compact density; the phone's Menu its own.
  val height = if (dense) (if (density.compact) m.row - 4.dp else m.row) else density.phoneRow.dp
  val lead = (if (dense) m.rowPad else 10.dp) + if (indented) m.groupIndent else 0.dp
  if (pill != null) {
    androidx.compose.runtime.DisposableEffect(pill, tag, selected) {
      onDispose { if (pill.owner == tag) { pill.owner = null; pill.bounds = null } }
    }
  }
  Row(
    Modifier
      .fillMaxWidth()
      .padding(vertical = 1.dp)
      .then(
        if (pill != null && selected) {
          Modifier.onGloballyPositioned { c ->
            val o = origin ?: return@onGloballyPositioned
            if (!o.isAttached || !c.isAttached) return@onGloballyPositioned
            val at = o.localPositionOf(c, androidx.compose.ui.geometry.Offset.Zero)
            pill.owner = tag
            pill.bounds = androidx.compose.ui.geometry.Rect(at, androidx.compose.ui.geometry.Size(c.size.width.toFloat(), c.size.height.toFloat()))
          }
        } else Modifier,
      )
      .clip(RoundedCornerShape(if (dense) m.pillRadius else 8.dp))
      .background(if (selected && pill == null) shell.selected else Color.Transparent)
      .clickable(onClick = onClick)
      .heightIn(min = height)
      .padding(start = lead, end = if (dense) m.rowPad else 10.dp)
      .testTag(tag)
      .semantics(mergeDescendants = true) { role = Role.Button; this.selected = selected },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(if (dense) m.rowGap else 12.dp),
  ) {
    // Rows read in the primary text color with line icons in that color; the selected row is a filled pill whose icon
    // takes the accent (as Figma draws the sidebar).
    val ink = MaterialTheme.colorScheme.onSurface
    val iconSize = if (dense) m.rowIcon else 20.dp
    // The phone's Menu in the bold look: the icon on an accent tile, a dot in the tile's 30 dp slot (AGL-3990).
    val tile = !dense && com.aglyn.ui.LocalPhoneBold.current
    when {
      dot != null -> Box(Modifier.size(if (tile) 30.dp else iconSize + 2.dp), contentAlignment = Alignment.Center) { Box(Modifier.size(8.dp).clip(CircleShape).background(dot)) }
      icon != null && tile -> com.aglyn.ui.PhoneRowTile(icon, Modifier.testTag("$tag-icon"))
      icon != null -> Icon(AglynIcons.named(icon), null, Modifier.size(iconSize).testTag("$tag-icon"), tint = if (selected) MaterialTheme.colorScheme.primary else ink)
    }
    Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
      Text(
        label,
        style = if (dense) MaterialTheme.typography.bodyMedium.copy(fontSize = m.rowText) else MaterialTheme.typography.bodyLarge,
        color = ink,
        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.weight(1f, fill = trailingChevron == null),
      )
      if (trailingChevron != null) {
        val turn by androidx.compose.animation.core.animateFloatAsState(trailingChevron, ShellMotion.fold(), label = "more-chevron")
        Icon(AglynIcons.named("chevron_right"), null, Modifier.size(m.groupChevron).rotate(turn), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    if (badge > 0) {
      Box(Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.primary).padding(horizontal = 7.dp, vertical = 1.dp)) {
        Text(badge.toString(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimary)
      }
    }
    if (chevron) Icon(AglynIcons.named("chevron_right"), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
