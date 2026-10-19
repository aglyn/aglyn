package com.aglyn.shell

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aglyn.contracts.railWorkspaces
import com.aglyn.core.AccountPreferences
import com.aglyn.core.AuthUser
import com.aglyn.core.PinAnswer
import com.aglyn.core.WorkspaceState
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.WorkspaceTile
import com.aglyn.ui.readableOn
import com.aglyn.ui.shellColors
import com.aglyn.ui.workspaceInitials
import kotlin.math.roundToInt

/** What a rail tile's menu and the rail's own buttons do. */
internal class RailActions(
  val open: (orgId: String) -> Unit,
  val all: () -> Unit,
  val create: () -> Unit,
  val admin: (() -> Unit)?,
  val account: () -> Unit,
  val color: (orgId: String) -> Unit,
  val settings: (orgId: String) -> Unit,
  /** A pin the full list refused: "Pinned is full. Replace one?". */
  val pinFull: (orgId: String) -> Unit,
)


/**
 * The workspace rail (Mac, iPad, Android tablet, desktop): up to five pinned workspaces in the person's order (drag to
 * reorder), a divider, up to three recent ones, then "All workspaces" with the total; an account with eight workspaces
 * or fewer sees them all and no All tile. At the foot: Create new, Admin for staff, and the person's photo.
 */
@Composable
internal fun WorkspaceRail(
  services: ShellServices,
  workspace: WorkspaceState,
  prefs: AccountPreferences,
  user: AuthUser?,
  unread: Map<String, Int>,
  actions: RailActions,
  modifier: Modifier = Modifier,
) {
  val shell = shellColors
  val m = com.aglyn.ui.shellMetrics
  val rail = railWorkspaces(workspace.orgs.map { it.id }, prefs.pinned, prefs.recentOrgs)
  val byId = workspace.orgs.associateBy { it.id }
  Column(
    // PINNED starts the rail at the gap between its sections (17, Figma Rail 12:338); the brand's mark is the Home tab.
    modifier.width(m.railWidth).fillMaxHeight().background(shell.rail).padding(top = 17.dp, bottom = 12.dp).testTag("workspace-rail"),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Column(
      Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(m.tileGap - 4.dp),
    ) {
      if (rail.pinned.isNotEmpty()) {
        RailLabel("Pinned")
        PinnedTiles(services, workspace, prefs, rail.pinned, unread, actions)
      }
      val after = if (rail.allTile) rail.recent else rail.rest
      if (after.isNotEmpty()) {
        if (rail.pinned.isNotEmpty()) RailDivider()
        if (rail.allTile) RailLabel("Recent")
        for (orgId in after) {
          val org = byId[orgId] ?: continue
          RailTile(services, workspace, prefs, orgId, org.name, pinned = false, index = -1, count = 0, unread[orgId] ?: 0, actions)
        }
      }
      if (rail.allTile) {
        RailDivider()
        AllWorkspacesTile(rail.total.toInt(), actions.all)
      }
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(m.tileGap + 4.dp)) {
      WithTooltip("Create new") {
        Surface(
          onClick = actions.create,
          shape = RoundedCornerShape(m.utilityRadius),
          color = MaterialTheme.colorScheme.primary,
          contentColor = MaterialTheme.colorScheme.onPrimary,
          modifier = Modifier.size(m.utility).testTag("rail-create").semantics { contentDescription = "Create new" },
        ) { Box(contentAlignment = Alignment.Center) { Icon(AglynIcons.named("add"), null, Modifier.size(m.rowIcon)) } }
      }
      actions.admin?.let { admin ->
        WithTooltip("Admin") {
          Surface(
            onClick = admin,
            shape = RoundedCornerShape(m.utilityRadius),
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.size(m.utility).testTag("rail-admin").semantics { contentDescription = "Admin" },
          ) { Box(contentAlignment = Alignment.Center) { Icon(AglynIcons.named("admin_panel_settings"), null, Modifier.size(m.rowIcon)) } }
        }
      }
      AccountAvatar(user, size = m.avatar.value.toInt(), onClick = actions.account, modifier = Modifier.testTag("rail-account"))
    }
  }
}

@Composable
private fun RailLabel(text: String) {
  Text(
    text.uppercase(),
    style = MaterialTheme.typography.labelSmall,
    fontSize = com.aglyn.ui.shellMetrics.railLabel,
    letterSpacing = androidx.compose.ui.unit.TextUnit(0.06f, androidx.compose.ui.unit.TextUnitType.Em),
    color = shellColors.onRail,
    fontWeight = FontWeight.SemiBold,
    modifier = Modifier.padding(top = 4.dp, bottom = 2.dp),
  )
}

@Composable
private fun RailDivider() {
  HorizontalDivider(Modifier.width(com.aglyn.ui.shellMetrics.tile).padding(vertical = 6.dp), color = shellColors.divider)
}

/** The pinned tiles, which a vertical drag puts in a new order (saved as the account's pins, the console's too). */
@Composable
private fun PinnedTiles(
  services: ShellServices,
  workspace: WorkspaceState,
  prefs: AccountPreferences,
  pinned: List<String>,
  unread: Map<String, Int>,
  actions: RailActions,
) {
  val byId = workspace.orgs.associateBy { it.id }
  val m = com.aglyn.ui.shellMetrics
  val slot = with(LocalDensity.current) { (m.tile + 8.dp + m.tileGap).toPx() }
  var dragging by remember { mutableStateOf<String?>(null) }
  var offset by remember { mutableFloatStateOf(0f) }
  for ((index, orgId) in pinned.withIndex()) {
    val org = byId[orgId] ?: continue
    val shift = if (dragging == orgId) offset.roundToInt() else 0
    Box(
      Modifier
        .offset { IntOffset(0, shift) }
        .pointerInput(pinned) {
          detectDragGestures(
            onDragStart = { dragging = orgId; offset = 0f },
            onDragEnd = {
              val to = (index + (offset / slot).roundToInt()).coerceIn(0, pinned.lastIndex)
              if (to != index) services.accountPrefs.reorderPins(pinned.toMutableList().apply { removeAt(index); add(to, orgId) })
              dragging = null
              offset = 0f
            },
            onDragCancel = { dragging = null; offset = 0f },
          ) { change, amount -> change.consume(); offset += amount.y }
        },
    ) {
      RailTile(services, workspace, prefs, orgId, org.name, pinned = true, index = index, count = pinned.size, unread[orgId] ?: 0, actions)
    }
  }
}

/** One workspace's tile: a click opens it; a right-click or a long press opens its menu. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RailTile(
  services: ShellServices,
  workspace: WorkspaceState,
  prefs: AccountPreferences,
  orgId: String,
  name: String,
  pinned: Boolean,
  index: Int,
  count: Int,
  unread: Int,
  actions: RailActions,
) {
  var menu by remember { mutableStateOf(false) }
  val (color) = rememberWorkspaceColor(orgId, workspace, prefs, services.api.origin)
  val (light, dark) = orgLogoUrls(workspace, orgId, services.api.origin)
  val selected = workspace.org?.id == orgId
  val m = com.aglyn.ui.shellMetrics
  Box(Modifier.width(m.railWidth), contentAlignment = Alignment.Center) {
    // The selected workspace's 3 dp bar at the rail's edge, beside its ring.
    if (selected) Box(Modifier.align(Alignment.CenterStart).width(3.dp).height(m.selectionBar).clip(RoundedCornerShape(topEnd = 2.dp, bottomEnd = 2.dp)).background(shellColors.ring))
    WithTooltip(if (index in 0..4) "$name  ${shortcutLabel(index + 1)}" else name) {
      Box(
        Modifier
          .clip(RoundedCornerShape(m.tileRadius + 4.dp))
          .pointerInput(orgId) {
            awaitPointerEventScope {
              while (true) {
                val event = awaitPointerEvent()
                if (event.type == PointerEventType.Press && event.buttons.isSecondaryPressed) {
                  event.changes.forEach { it.consume() }
                  menu = true
                }
              }
            }
          }
          .combinedClickable(onClick = { actions.open(orgId) }, onLongClick = { menu = true })
          .semantics {
            role = Role.Button
            contentDescription = if (unread > 0) "$name, $unread unread" else name
            this.selected = selected
          }
          .padding(2.dp)
          .testTag("rail-tile-$orgId"),
      ) {
        WorkspaceTile(name, light, dark, color, size = m.tile, selected = selected, badge = unread, cornerRadius = m.tileRadius, badgeSize = m.badge, ringBox = m.ringBox, ringRadius = m.ringRadius, initialSize = m.tileInitial)
      }
    }
    DropdownMenu(menu, onDismissRequest = { menu = false }) {
      if (pinned) {
        MenuRow("Unpin", "keep_off") { menu = false; services.accountPrefs.unpin(orgId) }
        if (index > 0) MenuRow("Move up", "arrow_upward") { menu = false; services.accountPrefs.movePin(orgId, -1) }
        if (index in 0 until count - 1) MenuRow("Move down", "arrow_downward") { menu = false; services.accountPrefs.movePin(orgId, 1) }
      } else {
        MenuRow("Pin", "keep") {
          menu = false
          if (services.accountPrefs.pin(orgId) == PinAnswer.FULL) actions.pinFull(orgId)
        }
      }
      HorizontalDivider()
      MenuRow("Workspace color", "palette") { menu = false; actions.color(orgId) }
      MenuRow("Workspace settings", "settings") { menu = false; actions.settings(orgId) }
    }
  }
}

@Composable
internal fun MenuRow(label: String, icon: String?, trailing: String? = null, enabled: Boolean = true, tag: String? = null, onClick: () -> Unit) {
  val m = com.aglyn.ui.shellMetrics
  // Compact (desktop) menus are Figma's Menu/Row (10:96): 30 tall, padding 10, a 16 icon, 13 text, radius 6, inset 6 in
  // the menu; touch keeps the platform's menu rows.
  DropdownMenuItem(
    text = { Text(label, fontSize = if (m.compact) 13.sp else androidx.compose.ui.unit.TextUnit.Unspecified) },
    leadingIcon = icon?.let { { Icon(AglynIcons.named(it), null, if (m.compact) Modifier.size(16.dp) else Modifier) } },
    trailingIcon = trailing?.let { { Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) } },
    enabled = enabled,
    onClick = onClick,
    contentPadding = if (m.compact) androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp) else androidx.compose.material3.MenuDefaults.DropdownMenuItemContentPadding,
    modifier = (if (m.compact) Modifier.padding(horizontal = 6.dp).height(30.dp).clip(RoundedCornerShape(6.dp)) else Modifier)
      .then(if (tag != null) Modifier.testTag(tag) else Modifier),
  )
}

/** The last tile: every workspace, with the total under it; opens the workspace picker. */
@Composable
private fun AllWorkspacesTile(total: Int, onClick: () -> Unit) {
  val m = com.aglyn.ui.shellMetrics
  WithTooltip("All workspaces") {
    Column(
      Modifier.clip(RoundedCornerShape(m.tileRadius)).combinedClickableCompat(onClick).padding(4.dp).testTag("rail-all")
        .semantics { contentDescription = "All workspaces, $total" },
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Box(
        Modifier.size(m.tile).clip(RoundedCornerShape(m.tileRadius)).background(MaterialTheme.colorScheme.surfaceContainerHigh),
        contentAlignment = Alignment.Center,
      ) { Icon(AglynIcons.named("grid_view"), null, Modifier.size(m.rowIcon), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
      Spacer(Modifier.height(2.dp))
      Text(total.toString(), style = MaterialTheme.typography.labelMedium, fontSize = m.railLabel * 1.2f, color = shellColors.onRail)
    }
  }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableCompat(onClick: () -> Unit) = this.combinedClickable(onClick = onClick)

/** The person's photo (their initials until the profile has one): opens the account menu. */
@Composable
internal fun AccountAvatar(user: AuthUser?, size: Int, onClick: (() -> Unit)?, modifier: Modifier = Modifier) {
  val fill = MaterialTheme.colorScheme.tertiary
  val name = user?.displayName?.takeIf { it.isNotBlank() } ?: user?.email ?: "?"
  val content: @Composable () -> Unit = {
    Box(Modifier.size(size.dp).clip(CircleShape).background(fill), contentAlignment = Alignment.Center) {
      Text(workspaceInitials(name), color = readableOn(fill), style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
  }
  if (onClick == null) {
    Box(modifier) { content() }
  } else {
    WithTooltip("Your account") {
      Surface(onClick = onClick, shape = CircleShape, modifier = modifier.semantics { contentDescription = "Your account" }) { content() }
    }
  }
}

/** Whether keyboard shortcuts are shown beside what they do: on wide windows (a keyboard is likely), never on a phone. */
internal val LocalShowShortcuts = androidx.compose.runtime.staticCompositionLocalOf { true }

/** ⌘1 on a Mac, Ctrl+1 elsewhere. */
internal fun shortcutLabel(n: Int): String = shortcutText(n.toString())

/** A shortcut's words with the platform's command key: ⌘K, Ctrl+K. */
internal fun shortcutText(key: String, shift: Boolean = false): String =
  (if (isMacPlatform) "⌘" + (if (shift) "⇧" else "") else "Ctrl+" + (if (shift) "Shift+" else "")) + key
