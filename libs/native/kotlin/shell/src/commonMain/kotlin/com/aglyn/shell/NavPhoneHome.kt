package com.aglyn.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.core.Live
import com.aglyn.core.PinAnswer
import com.aglyn.core.WorkspaceState
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AreaGroupHeader
import com.aglyn.ui.AreaTile
import com.aglyn.ui.SearchField
import com.aglyn.ui.space
import kotlin.math.roundToInt

/*
 * The phone's Home, its area switcher and its Tab bar sheet (AGL-4006; Figma Phone 2:7: Android Home
 * 22:775, Android · area switcher, Tab bar sheet, Pin an area, First open). The rules are the shared contract's
 * (`phoneHomeGroups`, `tabBarLayout`, `pinTabArea`, `autoPinTabArea`), so the Apple phone draws the same.
 */

/** The device's note that the one-time "Pin areas to your tab bar" tip was dismissed. */
private const val PIN_TIP_SEEN = "aglyn.phone.pinTipSeen"

/** Home on a phone: every area of the scope as the same tile, four to a row, grouped as in the sidebar. */
@Composable
internal fun PhoneHome(
  services: ShellServices,
  context: ShellPluginContext?,
  groups: List<NavGroupItem>,
  tabScope: String?,
  pinned: List<String>,
  loaded: Boolean,
  onOpen: (NavItem) -> Unit,
  onEditTabBar: () -> Unit,
  header: @Composable () -> Unit = {},
  stats: @Composable () -> Unit = {},
) {
  var tipSeen by remember { mutableStateOf(services.prefs.get(PIN_TIP_SEEN) == "1") }
  Column(Modifier.fillMaxSize()) {
    Column(
      Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
        .padding(horizontal = space(2f)).padding(bottom = space(2f)).testTag("home"),
      verticalArrangement = Arrangement.spacedBy(space(3f)),
    ) {
      header()
      AreaTiles(services, context, groups, tabScope, pinned, current = null, onOpen = onOpen, onEditTabBar = onEditTabBar)
      // The tiles are the body; the numbers (AGL-4011) follow them, the same cards a tablet's Home draws.
      stats()
    }
    if (loaded && pinned.isEmpty() && !tipSeen) {
      PinAreasTip { services.prefs.set(PIN_TIP_SEEN, "1"); tipSeen = true }
    }
  }
}

/** The workspace's proposed plan, above a workspace Home's tiles (AGL-4011). */
@Composable
internal fun PhoneHomeHeader(services: ShellServices, context: ShellPluginContext, workspace: WorkspaceState) {
  if (workspace.site != null) return
  val org = (orgDocLive(services, workspace.org?.id) as? Live.Ready)?.value?.data
  HomeUpgradeProposal(services, context, org, workspace.org?.name, workspace.org?.slug, Contracts.platformBrandName)
}

/** The numbers under a phone Home's tiles (AGL-4011): a site's Traffic, its cards and its activity; the workspace's cards. */
@Composable
internal fun PhoneHomeStats(services: ShellServices, context: ShellPluginContext, workspace: WorkspaceState, openAnalytics: () -> Unit) {
  val site = workspace.site
  if (site != null) {
    HomeSiteStats(services, context, site.id, openAnalytics)
  } else {
    workspace.org?.id?.let { HomeOrgGlance(services, context, it) }
  }
}

/** Every area as tiles, with a long-press menu on each (Add to tab bar or Remove from tab bar, Star, Edit tab bar…). */
@Composable
private fun AreaTiles(
  services: ShellServices,
  context: ShellPluginContext?,
  groups: List<NavGroupItem>,
  tabScope: String?,
  pinned: List<String>,
  current: String?,
  onOpen: (NavItem) -> Unit,
  onEditTabBar: () -> Unit,
) {
  var fullFor by remember { mutableStateOf<NavItem?>(null) }
  for (group in groups) {
    group.label?.let { AreaGroupHeader(it, Modifier.testTag("home-group-${group.id}")) }
    group.rows.chunked(4).forEach { row ->
      Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (item in row) {
          var menu by remember(item.rowId) { mutableStateOf(false) }
          Box(Modifier.weight(1f)) {
            AreaTile(
              item.label, item.icon, onClick = { onOpen(item) },
              modifier = Modifier.fillMaxWidth().testTag("home-tile-${item.rowId}"),
              current = current != null && current in item.keys,
              onLongPress = { menu = true },
              badgeSlot = context?.let { ctx -> ctx.slotWidgets("sidebarCount.${item.rowId}").takeIf { it.isNotEmpty() }?.let { widgets -> { for (w in widgets) w.content(ctx) } } },
            )
            DropdownMenu(menu, onDismissRequest = { menu = false }, modifier = Modifier.testTag("tile-menu-${item.rowId}")) {
              if (com.aglyn.contracts.isTabPinnable(item.screen) && tabScope != null) {
                if (item.rowId in pinned) {
                  MenuRow("Remove from tab bar", "keep_off", tag = "tile-unpin-${item.rowId}") {
                    menu = false
                    services.accountPrefs.unpinTab(item.rowId, tabScope)
                  }
                } else {
                  MenuRow("Add to tab bar", "keep", tag = "tile-pin-${item.rowId}") {
                    menu = false
                    if (services.accountPrefs.pinTab(item.rowId, tabScope) == PinAnswer.FULL) fullFor = item
                  }
                }
              }
              MenuRow("Edit tab bar…", "tab", tag = "tile-edit-tab-bar") { menu = false; onEditTabBar() }
            }
          }
        }
        repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
      }
    }
  }
  fullFor?.let { item ->
    AlertDialog(
      onDismissRequest = { fullFor = null },
      title = { Text("Your tab bar is full") },
      text = { Text("It holds four areas beside Home. Remove one to add ${item.label}.") },
      confirmButton = { TextButton(onClick = { fullFor = null; onEditTabBar() }) { Text("Edit tab bar") } },
      dismissButton = { TextButton(onClick = { fullFor = null }) { Text("Not now") } },
      modifier = Modifier.testTag("tab-bar-full"),
    )
  }
}

/** The one-time tip on a fresh tab bar (Figma First open), kept on the device. */
@Composable
private fun PinAreasTip(onDismiss: () -> Unit) {
  Surface(
    shape = RoundedCornerShape(16.dp),
    color = MaterialTheme.colorScheme.surface,
    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp).testTag("pin-tip"),
  ) {
    Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      Icon(AglynIcons.named("keep"), null, Modifier.size(22.dp), tint = com.aglyn.ui.aglynAccentText)
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Pin areas to your tab bar", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text(
          "Long-press any tile and choose Add to tab bar, up to ${Contracts.tabBarAreasMax}. The first areas you open take the free spots and stay; remove them anytime in your account → Tab bar.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      IconButton(onClick = onDismiss, modifier = Modifier.size(28.dp).testTag("pin-tip-dismiss")) {
        Icon(AglynIcons.named("close"), contentDescription = "Dismiss", Modifier.size(18.dp))
      }
    }
  }
}

/** The area switcher (Figma Android · area switcher): every area of the scope as tiles in a modal bottom sheet, with a field to find one. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AreaSwitcherSheet(
  services: ShellServices,
  context: ShellPluginContext?,
  groups: List<NavGroupItem>,
  current: String,
  onOpen: (NavItem) -> Unit,
  onEditTabBar: () -> Unit,
  onClose: () -> Unit,
) {
  var query by remember { mutableStateOf("") }
  val shown = groups.mapNotNull { group ->
    val rows = if (query.isBlank()) group.rows else group.rows.filter { row ->
      com.aglyn.contracts.scoreMatch(row.label, row.keywords + listOfNotNull(row.description), query) != null
    }
    if (rows.isEmpty()) null else group.copy(rows = rows)
  }
  ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), modifier = Modifier.testTag("area-switcher")) {
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = 16.dp).padding(bottom = 16.dp)) {
      Text("Go to", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 8.dp))
      SearchField(query, { query = it }, placeholder = "Find an area", modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp).testTag("area-switcher-find"))
      AreaTiles(services, context, shown, null, emptyList(), current = current, onOpen = onOpen, onEditTabBar = onEditTabBar)
      if (shown.isEmpty()) Text("No area matches.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp).testTag("area-switcher-empty"))
    }
  }
}

/**
 * The Tab bar sheet (Figma Tab bar sheet): a preview of the bar, the pinned areas to remove and drag into order, the others
 * to add. Home is always first; four areas at most, and with four Create moves to the top bar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TabBarSheet(
  groups: List<NavGroupItem>,
  pinnable: List<String>,
  pinned: List<String>,
  onDone: (List<String>) -> Unit,
  onCancel: () -> Unit,
) {
  val items = groups.flatMap { it.rows }.associateBy { it.rowId }
  val draft = remember { mutableStateListOf<String>().apply { addAll(pinned.filter { it in items }) } }
  val max = Contracts.tabBarAreasMax.toInt()
  ModalBottomSheet(onDismissRequest = onCancel, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), modifier = Modifier.testTag("tab-bar-sheet")) {
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 16.dp)) {
      Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onCancel, modifier = Modifier.testTag("tab-bar-cancel")) { Text("Cancel") }
        Text("Tab bar", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        TextButton(onClick = { onDone(draft.toList()) }, modifier = Modifier.testTag("tab-bar-done")) { Text("Done", fontWeight = FontWeight.SemiBold) }
      }
      TabBarPreview(draft, pinnable, items)
      Text(
        "Home is always first. Pick up to $max areas; drag to reorder. With $max, + Create moves to the top bar.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
      )
      AreaGroupHeader("In your tab bar · ${draft.size} of $max", Modifier.padding(horizontal = 16.dp))
      draft.toList().forEachIndexed { index, id ->
        items[id]?.let { item -> PinnedRow(item, index, draft) }
      }
      if (draft.isEmpty()) {
        Text("Nothing pinned yet. The first areas you open take the free spots.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
      }
      AreaGroupHeader("Add an area", Modifier.padding(horizontal = 16.dp))
      for (id in pinnable.filter { it !in draft }) {
        val item = items[id] ?: continue
        val full = draft.size >= max
        Row(
          Modifier.fillMaxWidth().clickable(enabled = !full) { draft.add(id) }.padding(horizontal = 16.dp, vertical = 10.dp).testTag("tab-bar-add-$id"),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
          Icon(AglynIcons.named("add_circle"), null, Modifier.size(22.dp), tint = if (full) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.primary)
          com.aglyn.ui.PhoneRowTile(item.icon)
          Text(item.label, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
      }
    }
  }
}

/** A pinned area in the Tab bar sheet: remove on the left, drag (long-press the handle) to reorder; move up and down for TalkBack. */
@Composable
private fun PinnedRow(item: NavItem, index: Int, draft: androidx.compose.runtime.snapshots.SnapshotStateList<String>) {
  var drag by remember(item.rowId) { mutableFloatStateOf(0f) }
  val rowHeight = 52.dp
  Row(
    Modifier.fillMaxWidth().height(rowHeight).offset { IntOffset(0, drag.roundToInt()) }
      .padding(horizontal = 16.dp).testTag("tab-bar-pinned-${item.rowId}")
      .semantics {
        customActions = listOf(
          CustomAccessibilityAction("Move up") { move(draft, item.rowId, -1) },
          CustomAccessibilityAction("Move down") { move(draft, item.rowId, 1) },
        )
      },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Box(
      Modifier.size(22.dp).clip(CircleShape).background(MaterialTheme.colorScheme.error).clickable { draft.remove(item.rowId) }
        .semantics { contentDescription = "Remove ${item.label}" }.testTag("tab-bar-remove-${item.rowId}"),
      contentAlignment = Alignment.Center,
    ) { Box(Modifier.size(width = 10.dp, height = 2.dp).background(MaterialTheme.colorScheme.onError)) }
    com.aglyn.ui.PhoneRowTile(item.icon)
    Text(item.label, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
    val step = with(androidx.compose.ui.platform.LocalDensity.current) { rowHeight.toPx() }
    Icon(
      AglynIcons.named("drag_handle"), contentDescription = "Reorder ${item.label}",
      modifier = Modifier.size(24.dp).testTag("tab-bar-handle-${item.rowId}").pointerInput(item.rowId) {
        detectDragGesturesAfterLongPress(
          onDragEnd = { drag = 0f },
          onDragCancel = { drag = 0f },
        ) { change, amount ->
          change.consume()
          drag += amount.y
          if (drag > step / 2 && move(draft, item.rowId, 1)) drag -= step
          if (drag < -step / 2 && move(draft, item.rowId, -1)) drag += step
        }
      },
      tint = MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}

/** Moves one pinned area a place up or down; false at an end. */
private fun move(draft: androidx.compose.runtime.snapshots.SnapshotStateList<String>, id: String, offset: Int): Boolean {
  val from = draft.indexOf(id)
  val to = from + if (offset < 0) -1 else 1
  if (from == -1 || to < 0 || to >= draft.size) return false
  draft[from] = draft[to]
  draft[to] = id
  return true
}

/** The bar as it will be: Home, the areas, and Create where it will sit. */
@Composable
private fun TabBarPreview(draft: List<String>, pinnable: List<String>, items: Map<String, NavItem>) {
  val layout = com.aglyn.contracts.tabBarLayout(draft, pinnable)
  Row(
    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).clip(RoundedCornerShape(14.dp))
      .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(14.dp)).padding(vertical = 8.dp).testTag("tab-bar-preview"),
    horizontalArrangement = Arrangement.SpaceEvenly,
    verticalAlignment = Alignment.CenterVertically,
  ) {
    for (slot in layout.slots) {
      Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
        when (slot) {
          Contracts.tabBarCreate -> com.aglyn.ui.PhoneCreateTile()
          else -> {
            val item = items[slot]
            Icon(AglynIcons.named(item?.icon ?: "home"), null, Modifier.size(22.dp), tint = if (slot == Contracts.tabBarHome) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            Text(item?.label ?: "Home", style = MaterialTheme.typography.labelSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
          }
        }
      }
    }
  }
}
