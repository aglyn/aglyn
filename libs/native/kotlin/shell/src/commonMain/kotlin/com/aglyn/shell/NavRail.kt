package com.aglyn.shell

import com.aglyn.ui.fastTooltipEdge
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.graphics.Color
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
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aglyn.contracts.railWorkspaces
import com.aglyn.contracts.workspaceInitial
import com.aglyn.core.AccountPreferences
import com.aglyn.core.AuthUser
import com.aglyn.core.PinAnswer
import com.aglyn.core.WorkspaceState
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.fastTooltip
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
 * The workspace rail (Mac, iPad, Android tablet, desktop), Figma Rail 12:338 "Many workspaces" for every account however
 * few workspaces it has (AGL-3996 / AGL-4000): up to five pinned workspaces in the person's order (drag to reorder), a
 * divider, up to three recent under "Recent", a divider, then "All workspaces" with the total, which opens the picker
 * where pins are edited. At the foot: Admin for staff, Create new, and the person's photo. Every gap is 8.
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
  // Every rail target names itself fast on hover, one bubble for the whole column, kept clear of the rail.
  val tips = com.aglyn.ui.rememberFastTooltipState()
  androidx.compose.runtime.CompositionLocalProvider(LocalRailTooltips provides tips) {
  Column(
    // PINNED starts the rail at the gap between its sections (17, Figma Rail 12:338); the brand's mark is the Home tab.
    modifier.width(m.railWidth).fillMaxHeight().background(shell.rail).fastTooltipEdge(tips).padding(top = 17.dp, bottom = m.railFoot).testTag("workspace-rail"),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(RailGap),
  ) {
    Column(
      Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(RailGap),
    ) {
      if (rail.pinned.isNotEmpty()) {
        RailLabel("Pinned")
        PinnedTiles(services, workspace, prefs, rail.pinned, unread, actions)
      }
      if (rail.recent.isNotEmpty()) {
        if (rail.pinned.isNotEmpty()) RailDivider()
        RailLabel("Recent")
        for (orgId in rail.recent) {
          val org = byId[orgId] ?: continue
          RailTile(services, workspace, prefs, orgId, org.name, pinned = false, index = -1, count = 0, unread[orgId] ?: 0, actions)
        }
      }
      if (rail.allTile) {
        if (rail.pinned.isNotEmpty() || rail.recent.isNotEmpty()) RailDivider()
        AllWorkspacesTile(rail.total.toInt(), actions.all)
      }
    }
    // The foot (Figma Rail, Staff = Yes): Admin (Figma's bare outline shield, Icon/admin 3:142) above Create new, then the
    // account, each in a utility box.
    actions.admin?.let { admin ->
      Surface(
        onClick = admin,
        shape = RoundedCornerShape(m.utilityRadius),
        color = Color.Transparent,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.size(m.utility).railTooltip("Admin").testTag("rail-admin").semantics { contentDescription = "Admin" },
      ) { Box(contentAlignment = Alignment.Center) { Icon(AglynIcons.named("shield"), null, Modifier.size(m.utilityIcon)) } }
    }
    Surface(
      onClick = actions.create,
      shape = RoundedCornerShape(m.utilityRadius),
      color = MaterialTheme.colorScheme.primary,
      contentColor = MaterialTheme.colorScheme.onPrimary,
      modifier = Modifier.size(m.utility).railTooltip("Create new").testTag("rail-create").semantics { contentDescription = "Create new" },
    ) { Box(contentAlignment = Alignment.Center) { Icon(AglynIcons.named("add"), null, Modifier.size(m.utilityIcon)) } }
    Box(Modifier.size(m.utility), contentAlignment = Alignment.Center) {
      AccountAvatar(user, size = m.avatar.value.toInt(), onClick = actions.account, modifier = Modifier.testTag("rail-account"), tooltip = tips)
      // The bubble is a popup placed in window coordinates beside its target; it sits here only so it adds no gap.
      com.aglyn.ui.FastTooltipHost(tips)
    }
  }
  }
}

/** The rail's one name bubble, for the targets inside it. */
private val LocalRailTooltips = androidx.compose.runtime.staticCompositionLocalOf<com.aglyn.ui.FastTooltipState?> { null }

/** This rail target's name in the rail's bubble (hover only; touch has its long-press menu header). */
@Composable
private fun Modifier.railTooltip(label: String, hint: String? = null): Modifier =
  LocalRailTooltips.current?.let { this.then(Modifier.fastTooltip(it, label, hint)) } ?: this

/** The rail's one rhythm: 8 between its tiles, captions, dividers and foot buttons (Figma Rail's auto layout). */
private val RailGap = 8.dp

/**
 * A one-line text's full line height, as Figma lays it out: Compose's default trims the leading above the first line
 * and below the last, which made each rail caption 1.5–3.5 dp short and pulled every tile under it up (AGL-4000).
 */
private val FullLineBox = androidx.compose.ui.text.style.LineHeightStyle(
  androidx.compose.ui.text.style.LineHeightStyle.Alignment.Center, androidx.compose.ui.text.style.LineHeightStyle.Trim.None,
)

@Composable
private fun RailLabel(text: String) {
  val m = com.aglyn.ui.shellMetrics
  Text(
    text.uppercase(),
    // The caption's whole line box (Figma: 12 Compact / 16 Touch), never trimmed to the glyphs, so the tiles under it
    // sit where Figma puts them.
    style = MaterialTheme.typography.labelSmall.copy(lineHeightStyle = FullLineBox),
    fontSize = m.railLabel,
    lineHeight = m.railLabelLine,
    letterSpacing = m.railLabelTracking,
    // Figma's text/tertiary.
    color = com.aglyn.ui.LocalThemeSurfaces.current?.textTertiary ?: shellColors.onRail,
    fontWeight = FontWeight.SemiBold,
    maxLines = 1,
    modifier = Modifier.testTag("rail-label-${text.lowercase()}"),
  )
}

/** Between the rail's sections: a 24/28 hairline in border/strong, which reads on the rail's ground. */
@Composable
private fun RailDivider() {
  Box(Modifier.width(com.aglyn.ui.shellMetrics.railDivider).height(1.dp).background(MaterialTheme.colorScheme.outline).testTag("rail-divider"))
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
  val slot = with(LocalDensity.current) { (m.ringBox + RailGap).toPx() }
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
  Box(Modifier.width(m.railWidth).height(m.ringBox), contentAlignment = Alignment.Center) {
    // The selected workspace's 3 dp bar at the rail's edge, beside its ring.
    if (selected) Box(Modifier.align(Alignment.CenterStart).width(3.dp).height(m.selectionBar).clip(RoundedCornerShape(topEnd = 2.dp, bottomEnd = 2.dp)).background(shellColors.ring))
    // Every tile keeps its ring's box, so the column keeps Figma's 8 between boxes; the badge sits off the corner as
    // Figma's Badge does, drawn unclipped so it is never cut. Measured on Rail 254:20207 / 254:20162, selected or not:
    // the fill's top is the ring box's top, its right edge 2 past the ring box (Compact) or 2 inside it (Touch); the
    // 2 dp cut-out around it in the rail's ground is what this offset places.
    val badgeAt = if (m.compact) DpOffset(4.dp, (-2).dp) else DpOffset(0.dp, (-2).dp)
    WorkspaceTile(
      name, light, dark, color, size = m.tile, selected = selected, badge = unread, cornerRadius = m.tileRadius, badgeSize = m.badge,
      ringBox = m.ringBox, ringRadius = m.ringRadius, initialSize = m.tileInitial, initials = workspaceInitial(name), reserveRing = true,
      badgeRing = shellColors.rail, badgeOffset = badgeAt,
    )
    // The tile's press target over it: the ring's box, its ripple clipped to the ring's corners. Hovering it names the
    // workspace in full at once (a pin carries its shortcut as the hint).
    Box(
        Modifier
          .size(m.ringBox)
          .railTooltip(name, if (index in 0..4 && LocalShowShortcuts.current) shortcutLabel(index + 1) else null)
          .clip(RoundedCornerShape(m.ringRadius))
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
          .testTag("rail-tile-$orgId"),
      )
    // A long press (touch) or right-click opens the menu, headed by the workspace's full name.
    DropdownMenu(menu, onDismissRequest = { menu = false }) {
      Text(
        name,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 2,
        modifier = Modifier.padding(horizontal = if (m.compact) 16.dp else 12.dp, vertical = 8.dp).widthIn(max = 280.dp).testTag("rail-menu-name"),
      )
      HorizontalDivider()
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

/**
 * The last tile: every workspace, with the total under it; opens the workspace picker, where pins are edited (Figma Rail
 * All workspaces 97:14737 / 12:279): the grid on the sunken ground inside a border/subtle hairline, the total in the
 * secondary text, in a box 66 tall.
 */
@Composable
private fun AllWorkspacesTile(total: Int, onClick: () -> Unit) {
  val m = com.aglyn.ui.shellMetrics
  val shape = RoundedCornerShape(m.tileRadius)
  Column(
    Modifier.width(m.ringBox).height(m.allTileHeight).railTooltip("All workspaces").clip(RoundedCornerShape(m.ringRadius)).combinedClickableCompat(onClick).testTag("rail-all")
      .semantics { contentDescription = "All workspaces, $total" },
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(m.allTileGap, Alignment.CenterVertically),
  ) {
    Box(
      Modifier.size(m.tile).clip(shape).background(MaterialTheme.colorScheme.surfaceVariant).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape),
      contentAlignment = Alignment.Center,
    ) { Icon(AglynIcons.named("grid_view"), null, Modifier.size(m.allTileIcon), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
    Text(
      total.toString(),
      style = MaterialTheme.typography.labelMedium.copy(lineHeightStyle = FullLineBox),
      fontSize = m.allTileTotal,
      lineHeight = if (m.compact) 12.sp else 16.sp,
      fontWeight = if (m.allTileTotalBold) FontWeight.Bold else FontWeight.SemiBold,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      maxLines = 1,
      modifier = Modifier.testTag("rail-all-total"),
    )
  }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableCompat(onClick: () -> Unit) = this.combinedClickable(onClick = onClick)

/** The person's photo (their initials until the profile has one): opens the account menu. */
@Composable
internal fun AccountAvatar(
  user: AuthUser?,
  size: Int,
  onClick: (() -> Unit)?,
  modifier: Modifier = Modifier,
  tooltip: com.aglyn.ui.FastTooltipState? = null,
  photoUrl: String? = null,
) {
  // The person on screen draws the face the console draws (AGL-4010); another account its photo as last shown.
  val identity = LocalAccountIdentity.current?.takeIf { it.uid != null && it.uid == user?.uid }
  val name = identity?.name ?: user?.displayName?.takeIf { it.isNotBlank() } ?: user?.email ?: "?"
  val content: @Composable () -> Unit = {
    com.aglyn.ui.PersonAvatar(workspaceInitials(name), photoUrl ?: identity?.photoUrl, size.dp)
  }
  if (onClick == null) {
    Box(modifier) { content() }
  } else if (tooltip != null) {
    // On the rail: the person's own name in the rail's bubble, so a second signed-in account is told apart at a glance.
    Surface(onClick = onClick, shape = CircleShape, modifier = modifier.fastTooltip(tooltip, name).semantics { contentDescription = "Your account" }) { content() }
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
