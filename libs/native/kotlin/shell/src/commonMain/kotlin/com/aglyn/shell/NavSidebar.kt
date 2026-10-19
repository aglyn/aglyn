package com.aglyn.shell

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
import com.aglyn.ui.AglynLogo
import com.aglyn.ui.SidebarWidth
import com.aglyn.ui.WorkspaceTile
import com.aglyn.ui.shellColors

/** What the sidebar shows: the scope's everyday list, a settings list, or the staff list. */
internal data class SidebarContent(
  val groups: List<NavGroupItem>,
  /** "‹ Juniper Street Co. settings" over a settings or staff list; null over the everyday list. */
  val modeTitle: String?,
  val onExitMode: () -> Unit,
)

/**
 * The sidebar for the scope on screen (tablet, desktop): the brand at the top, then the scope's header (the workspace and
 * its menu, or "‹ workspace" over the site picker), then the manifest's groups, folded except the one in use.
 */
@Composable
internal fun NavSidebar(
  services: ShellServices,
  workspace: WorkspaceState,
  chrome: NavChromeState,
  content: SidebarContent,
  selectedKey: String,
  starred: List<StarredItem>,
  tint: Color?,
  onRow: (NavItem) -> Unit,
  onStar: (StarredItem) -> Unit,
  modifier: Modifier = Modifier,
  /** What sits at the sidebar's foot, below the lists (the plan card while a limit is close). */
  foot: @Composable () -> Unit = {},
) {
  val shell = shellColors
  Column(modifier.width(SidebarWidth).fillMaxHeight().background(tint ?: shell.sidebar).testTag("nav-sidebar")) {
    // The logo kit's lockup with the mark's height of clear space around it.
    AglynLogo(Modifier.padding(horizontal = 20.dp, vertical = 18.dp).height(24.dp).semantics { heading() }, contentDescription = services.config.brandName)
    HorizontalDivider(color = shell.divider)
    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 10.dp)) {
      if (content.modeTitle != null) {
        BackLink(content.modeTitle, tag = "settings-mode-back", onClick = content.onExitMode)
        Spacer(Modifier.height(4.dp))
      } else {
        ScopeHeader(services, workspace, chrome)
        Spacer(Modifier.height(8.dp))
      }
      NavGroupsList(
        groups = content.groups,
        listOrder = content.groups,
        chrome = chrome,
        selectedKey = selectedKey,
        starred = starred,
        onRow = onRow,
        onStar = onStar,
        dense = true,
      )
    }
    foot()
  }
}

/**
 * The scope's header. The whole workspace: its tile, name and plan, opening the workspace menu. Inside a site: "‹" back to
 * the whole workspace, then the site's picker.
 */
@Composable
internal fun ScopeHeader(services: ShellServices, workspace: WorkspaceState, chrome: NavChromeState) {
  val org = workspace.org ?: return
  val prefs = services.accountPrefs.state.collectAsState().value
  val (light, dark) = orgLogoUrls(workspace, org.id, services.api.origin)
  val (color) = rememberWorkspaceColor(org.id, workspace, prefs, services.api.origin)
  val site = workspace.site
  if (site == null) {
    Surface(
      onClick = { chrome.workspaceMenu = true },
      shape = RoundedCornerShape(10.dp),
      color = Color.Transparent,
      modifier = Modifier.fillMaxWidth().testTag("workspace-menu-button").semantics { contentDescription = "${org.name} menu" },
    ) {
      Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        WorkspaceTile(org.name, light, dark, color, size = 32.dp)
        Column(Modifier.weight(1f)) {
          Text(org.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
          workspace.orgLogo?.plan?.let { PlanChip(it) }
        }
        Icon(AglynIcons.named("expand_more"), null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    workspaceMenuAnchor(services, workspace, chrome)
    if (workspace.sites.isNotEmpty()) {
      Spacer(Modifier.height(4.dp))
      SiteButton(services, workspace, null) { chrome.picker = PickerStep.SITE }
    }
  } else {
    BackLink(org.name, tag = "scope-back-to-workspace") { services.workspace.selectWholeWorkspace() }
    SiteButton(services, workspace, site.id) { chrome.picker = PickerStep.SITE }
  }
}

/** The workspace menu, anchored under the header that opens it. */
@Composable
private fun workspaceMenuAnchor(services: ShellServices, workspace: WorkspaceState, chrome: NavChromeState) {
  Box { WorkspaceMenu(services, workspace, chrome) }
}

/** The site on screen (or "Choose a site" in the whole workspace), opening the site picker. */
@Composable
private fun SiteButton(services: ShellServices, workspace: WorkspaceState, hostId: String?, onClick: () -> Unit) {
  val site = workspace.sites.firstOrNull { it.id == hostId }
  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(10.dp),
    color = MaterialTheme.colorScheme.surfaceContainerHigh,
    modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp).testTag("site-picker-button")
      .semantics { contentDescription = site?.let { "Site: ${it.name}. Switch site" } ?: "Choose a site" },
  ) {
    Row(Modifier.padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      if (site != null) {
        com.aglyn.ui.BrandPicture(com.aglyn.core.mediaPreviewUrl(site.favicon, services.api.origin, site.id, 96), null, 20.dp, RoundedCornerShape(5.dp)) {
          WorkspaceTile(site.name, null, null, null, size = 20.dp)
        }
      } else {
        Icon(AglynIcons.named("public"), null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      Text(
        site?.name ?: "Choose a site",
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = if (site != null) FontWeight.SemiBold else null,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.weight(1f),
      )
      Icon(AglynIcons.named("unfold_more"), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
internal fun PlanChip(plan: String) {
  Text(
    plan.replaceFirstChar { it.uppercase() },
    style = MaterialTheme.typography.labelSmall,
    color = MaterialTheme.colorScheme.onPrimaryContainer,
    modifier = Modifier.padding(top = 2.dp).clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.primaryContainer).padding(horizontal = 6.dp, vertical = 1.dp),
  )
}

/** "‹ Name": a step back out of a scope or a mode. */
@Composable
internal fun BackLink(label: String, tag: String, onClick: () -> Unit) {
  Row(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(onClick = onClick).padding(horizontal = 8.dp, vertical = 8.dp).testTag(tag)
      .semantics { role = Role.Button; contentDescription = "Back to $label" },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    Icon(AglynIcons.named("chevron_left"), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

/**
 * The groups of one list, drawn the same way in the sidebar and in the phone's Menu: a heading per group (a fold toggle
 * with its row count when foldable), the starred items in the Starred group, then the rows.
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
) {
  var first = true
  for (group in groups) {
    val rows = group.rows
    val isStarred = group.dynamic == "starred"
    if (isStarred && starred.isEmpty()) continue
    val listId = rows.firstOrNull()?.listId ?: listOrder.flatMap { it.rows }.firstOrNull()?.listId ?: com.aglyn.contracts.NativeNavListId.SITE
    val holdsCurrent = rows.any { selectedKey in it.keys }
    // A heading-less group after another is set apart by a rule, as the design separates the settings row.
    if (!first && group.label == null && group.foldable.not() && group.id != "top") {
      HorizontalDivider(Modifier.padding(vertical = 6.dp, horizontal = 8.dp), color = shellColors.divider)
    }
    first = false
    val open = !group.foldable || chrome.isOpen(listId, group.id, holdsCurrent)
    if (group.label != null) {
      if (group.foldable) {
        Row(
          Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
            .clickable { chrome.toggle(listId, group.id, !open) }
            .padding(horizontal = 8.dp, vertical = 6.dp)
            .testTag("nav-group-${group.id}")
            .semantics { role = Role.Button; stateDescription = if (open) "Open" else "Folded"; heading() },
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
          Icon(AglynIcons.named(if (open) "expand_more" else "chevron_right"), null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
          Text(group.label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
          if (!open) {
            val count = if (isStarred) starred.size else rows.size
            Text(count.toString(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      } else {
        Text(
          group.label,
          style = MaterialTheme.typography.labelLarge,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.padding(start = 8.dp, top = 12.dp, bottom = 4.dp).semantics { heading() },
        )
      }
    }
    if (!open) continue
    if (isStarred) {
      for (item in starred) StarRow(item, selectedKey, dense) { onStar(item) }
    }
    for (row in rows) NavRow(row, selected = selectedKey in row.keys, dense = dense) { onRow(row) }
  }
}

@Composable
internal fun NavRow(row: NavItem, selected: Boolean, dense: Boolean, badge: Int = 0, onClick: () -> Unit) {
  NavLine(row.label, row.icon, selected, dense, badge, tag = "nav-${row.listId.raw}-${row.rowId}", chevron = !dense && row.opensSettings == null, onClick = onClick)
}

@Composable
private fun StarRow(item: StarredItem, selectedKey: String, dense: Boolean, onClick: () -> Unit) {
  val dot = starDotColor(item)
  NavLine(item.label, null, selectedKey == NavKeys.of(item.screen, item.params), dense, 0, tag = "nav-star-${accountItemKey(item)}", dot = dot, onClick = onClick)
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

/** One line of a nav list: icon (or a star's dot), label, an optional count of what waits, and selection. */
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
  onClick: () -> Unit,
) {
  val shell = shellColors
  val density = com.aglyn.ui.LocalUiDensity.current
  Row(
    Modifier
      .fillMaxWidth()
      .padding(vertical = 1.dp)
      .clip(RoundedCornerShape(8.dp))
      .background(if (selected) shell.selected else Color.Transparent)
      .clickable(onClick = onClick)
      .heightIn(min = if (dense) density.row.dp else density.phoneRow.dp)
      .padding(horizontal = 10.dp)
      .testTag(tag)
      .semantics(mergeDescendants = true) { role = Role.Button; this.selected = selected },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    val ink = if (selected) shell.onSelected else MaterialTheme.colorScheme.onSurface
    when {
      dot != null -> Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) { Box(Modifier.size(8.dp).clip(CircleShape).background(dot)) }
      icon != null -> Icon(AglynIcons.named(icon), null, Modifier.size(20.dp), tint = if (selected) shell.onSelected else MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Text(
      label,
      style = if (dense) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge,
      color = ink,
      fontWeight = if (selected) FontWeight.SemiBold else null,
      maxLines = 1,
      overflow = TextOverflow.Ellipsis,
      modifier = Modifier.weight(1f),
    )
    if (badge > 0) {
      Box(Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.primary).padding(horizontal = 7.dp, vertical = 1.dp)) {
        Text(badge.toString(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimary)
      }
    }
    if (chevron) Icon(AglynIcons.named("chevron_right"), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
