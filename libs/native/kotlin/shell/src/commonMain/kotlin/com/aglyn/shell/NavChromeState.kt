package com.aglyn.shell

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import com.aglyn.contracts.NativeNavListId
import com.aglyn.contracts.resolveWorkspaceColor
import com.aglyn.core.AccountPreferences
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.KeyValueStore
import com.aglyn.core.Live
import com.aglyn.core.WorkspaceOrg
import com.aglyn.core.WorkspaceState
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.ui.colorOfHex
import com.aglyn.ui.rememberLogoColor
import com.aglyn.ui.toHex

/** The settings-mode value that stands for the staff list (the rail's Admin button), which the manifest does not hold. */
internal val STAFF_MODE = NativeNavListId.UNKNOWN

/** The two steps of the scope picker: a workspace, then one of its sites (or the whole workspace). */
enum class PickerStep { WORKSPACE, SITE }

/**
 * What the shell's chrome has open: the settings mode, the picker, a menu or dialog, and the folded groups and hidden
 * panes it remembers on this device.
 */
@Stable
internal class NavChromeState(private val device: KeyValueStore) {
  /** The settings list swapped in for the sidebar ("‹ Juniper Street Co. settings"), null for the everyday list. */
  var settingsMode by mutableStateOf<NativeNavListId?>(null)
  var picker by mutableStateOf<PickerStep?>(null)
  /** The AI panel, docked right on wide windows and a sheet on phones; whether it is open is remembered on this device. */
  var aiPanel by mutableStateOf(device.get("aglyn.nav.aiPanel") == "1")
    private set

  fun toggleAiPanel(open: Boolean = !aiPanel) {
    aiPanel = open
    device.set("aglyn.nav.aiPanel", if (open) "1" else null)
  }

  /** The keyboard shortcuts sheet (Help → Keyboard shortcuts). */
  var shortcuts by mutableStateOf(false)

  /** The one box (Ctrl/⌘K, "Search or jump to"). */
  var oneBox by mutableStateOf(false)
  var accountMenu by mutableStateOf(false)
  var workspaceMenu by mutableStateOf(false)
  var createMenu by mutableStateOf(false)
  /** The phone's area switcher: every area as tiles, from an area's title ▾ (AGL-4006). */
  var areaSwitcher by mutableStateOf(false)
  /** The phone's Tab bar sheet: the pinned areas to remove, reorder and add (AGL-4006). */
  var tabBarSheet by mutableStateOf(false)
  /** The workspace waiting on "Pinned is full. Replace one?". */
  var pinFullFor by mutableStateOf<String?>(null)
  /** The workspace whose color picker is open. */
  var colorFor by mutableStateOf<String?>(null)
  /** Whether "Keep which 5 pins?" was dismissed this session (it comes back next launch until answered). */
  var keepPinsLater by mutableStateOf(false)

  var sidebarHidden by mutableStateOf(device.get(SIDEBAR_HIDDEN) == "1")
    private set
  var railHidden by mutableStateOf(device.get(RAIL_HIDDEN) == "1")
    private set

  fun toggleSidebar() {
    sidebarHidden = !sidebarHidden
    device.set(SIDEBAR_HIDDEN, if (sidebarHidden) "1" else null)
  }

  fun toggleRail() {
    railHidden = !railHidden
    device.set(RAIL_HIDDEN, if (railHidden) "1" else null)
  }

  /** Each group the person opened (true) or folded (false), by "<list>.<group>", remembered on this device. */
  private val groupStates = mutableStateOf(parseGroupStates(device.get(OPEN_GROUPS)))

  /**
   * Whether a group shows its rows ("we need to remember the expanded state, if we navigate it
   * collapses the others"). A group the person opened or folded stays that way in its scope's list, across launches;
   * navigating never folds another group. Until the person chooses, Starred is open (Figma Sidebar 12:703) and any other
   * group is open while it holds the screen in use ([reveal] then remembers it open).
   */
  fun isOpen(listId: NativeNavListId, groupId: String, holdsCurrent: Boolean): Boolean =
    groupStates.value["${listId.raw}.$groupId"] ?: (groupId == "starred" || holdsCurrent)

  /** The person opens or folds a group; every other group keeps its state. */
  fun toggle(listId: NativeNavListId, groupId: String, open: Boolean) {
    val next = groupStates.value + ("${listId.raw}.$groupId" to open)
    groupStates.value = next
    device.set(OPEN_GROUPS, formatGroupStates(next))
  }

  /** Opening a destination opens its own group when that is folded, and nothing else. */
  fun reveal(listId: NativeNavListId, groupId: String) {
    if (groupStates.value["${listId.raw}.$groupId"] != true) toggle(listId, groupId, true)
  }

  fun closeMenus() {
    accountMenu = false
    workspaceMenu = false
    createMenu = false
  }

  companion object {
    private const val SIDEBAR_HIDDEN = "aglyn.nav.sidebarHidden"
    private const val RAIL_HIDDEN = "aglyn.nav.railHidden"
    private const val OPEN_GROUPS = "aglyn.nav.openGroups"
  }
}

/**
 * The accent a workspace lends the app while you are in it (decision 5, 2026-10-18): none when the person picked
 * an accent of their own ([pickedAccent] is not "theme"), since theirs wins; else a white-label workspace's brand color
 * (`brandingProfile.primaryColor`, read only when the workspace has the `whiteLabel` feature, from
 * `/api/orgs/entitlements`, as the console's branding does) while "Use each workspace's brand" is on; otherwise none, so
 * the account theme's own accent stays. The same order as Apple's `ThemeApplier.accent`. A color the person picked for
 * the workspace, or one taken from its logo, only colors the workspace's tile, never the accent and never a surface
 * (AGL-4000).
 */
internal fun workspaceAccent(brandColor: String?, whiteLabel: Boolean, useWorkspaceBrand: Boolean, pickedAccent: String = "theme"): String? =
  brandColor?.takeIf { pickedAccent == "theme" && whiteLabel && useWorkspaceBrand && com.aglyn.contracts.isAccountColor(it) }

/**
 * Whether the sidebar takes a 5% wash of the accent: only when the person picked Tinted, and never on the Aglyn theme,
 * whose sidebar is always the neutral surface (Apple's `AglynColor.sidebar`: `sidebarTinted` and a theme other than
 * "aglyn"; an unknown style counts as Tinted and an unknown theme as Aglyn's, as there). Plain is the default (AGL-3990).
 */
internal fun sidebarTinted(theme: com.aglyn.contracts.AppThemePrefs): Boolean =
  theme.sidebarStyle != com.aglyn.contracts.AppSidebarStyle.PLAIN &&
    theme.theme != com.aglyn.contracts.AppThemeName.AGLYN && theme.theme != com.aglyn.contracts.AppThemeName.UNKNOWN

/**
 * The remembered group states: "<list>.<group>=1" (open) or "=0" (folded), comma-separated. The older one-open-group form
 * ("site.website" open, "site.starred.folded") reads as the same choices.
 */
internal fun parseGroupStates(raw: String?): Map<String, Boolean> =
  raw.orEmpty().split(',').filter { it.isNotBlank() }.associate { entry ->
    when {
      '=' in entry -> entry.substringBefore('=') to (entry.substringAfter('=') == "1")
      entry.endsWith(".starred.folded") -> entry.removeSuffix(".folded") to false
      else -> entry to true
    }
  }

internal fun formatGroupStates(states: Map<String, Boolean>): String =
  states.entries.joinToString(",") { (key, open) -> "$key=${if (open) 1 else 0}" }

/** A workspace's logo as a URL the image loader reads, light and dark. */
internal fun orgLogoUrls(workspace: WorkspaceState, orgId: String, origin: String): Pair<String?, String?> {
  val logo = workspace.orgLogos[orgId]
  return mediaPreviewUrl(logo?.light, origin, null, 160) to mediaPreviewUrl(logo?.dark, origin, null, 160)
}

/**
 * A workspace's color as its tile draws it (the rail, the pickers, the menus, the header's avatar): the person's pick,
 * else its brand color, else a color taken from its logo, else its stable color from its id (the contract's
 * `workspaceStableColor`, so two workspaces with the same initial still differ), and the contract's `tintsApp`. It colors
 * the tile only; no surface wears a wash of it (AGL-4000).
 */
@Composable
internal fun rememberWorkspaceColor(
  orgId: String,
  workspace: WorkspaceState,
  prefs: AccountPreferences,
  origin: String,
): Pair<Color?, Boolean> {
  val resolved = rememberResolvedWorkspaceColor(orgId, workspace, prefs, origin)
  return colorOfHex(resolved.color) to resolved.tintsApp
}

/** [rememberWorkspaceColor] with where the color came from (picked, brand, logo, stable or none). */
@Composable
internal fun rememberResolvedWorkspaceColor(
  orgId: String,
  workspace: WorkspaceState,
  prefs: AccountPreferences,
  origin: String,
): com.aglyn.contracts.WorkspaceColor {
  val logo = rememberLogoColor(orgLogoUrls(workspace, orgId, origin).first)
  return resolveWorkspaceColor(
    prefs.workspaceColors[orgId],
    workspace.orgLogos[orgId]?.brandColor,
    logo?.toHex(),
    prefs.theme.useWorkspaceBrand,
    orgId = orgId,
  )
}

/** The site's own document, live, for the plugins it runs. */
@Composable
internal fun liveHostDoc(services: ShellServices, hostId: String?): FirestoreDoc? {
  if (hostId == null) return null
  val flow = remember(hostId) { services.firestore.observeDoc("hosts/$hostId") }
  val live by flow.collectAsState(Live.Loading)
  return (live as? Live.Ready)?.value
}

/** The workspace's role in words ("Owner"). */
internal fun roleLabel(role: String): String = role.replaceFirstChar { it.uppercase() }

/** The detail line under a workspace in a picker: its role and plan. */
internal fun orgDetail(org: WorkspaceOrg, workspace: WorkspaceState): String =
  listOfNotNull(roleLabel(org.role).ifEmpty { null }, workspace.orgLogos[org.id]?.plan?.replaceFirstChar { it.uppercase() }).joinToString(" · ")
