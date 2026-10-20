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

  private val openGroups = mutableStateOf(device.get(OPEN_GROUPS)?.split(',')?.filter { it.isNotEmpty() }?.toSet().orEmpty())

  /**
   * A foldable group is open when the person opened it, or when it holds the screen in use; only one group per list stays
   * open, remembered on this device.
   */
  /**
   * Whether a group shows its rows. Starred is open at rest (Figma Sidebar 12:703, as on Apple) until the person folds it;
   * the other groups open with the place in use, or once the person opens them, one at a time.
   */
  fun isOpen(listId: NativeNavListId, groupId: String, holdsCurrent: Boolean): Boolean =
    if (groupId == "starred") "${listId.raw}.starred.folded" !in openGroups.value
    else holdsCurrent || "${listId.raw}.$groupId" in openGroups.value

  fun toggle(listId: NativeNavListId, groupId: String, open: Boolean) {
    val next = if (groupId == "starred") {
      val folded = "${listId.raw}.starred.folded"
      if (open) openGroups.value - folded else openGroups.value + folded
    } else {
      val key = "${listId.raw}.$groupId"
      val others = openGroups.value.filterNot { it.startsWith("${listId.raw}.") && !it.startsWith("${listId.raw}.starred") }
      if (open) others + key else openGroups.value - key
    }
    openGroups.value = next.toSet()
    device.set(OPEN_GROUPS, next.joinToString(","))
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
 * The accent a workspace lends the app while you are in it (Zach, decision 5, 2026-10-18): a white-label workspace's brand
 * color (`brandingProfile.primaryColor`, read only when the workspace has the `whiteLabel` feature, from
 * `/api/orgs/entitlements`, as the console's branding does) while "Use each workspace's brand" is on; otherwise none, so the account theme's
 * own accent stays (Aglyn blue unless the person picked one). A color the person picked, or one taken from the logo, only
 * colors the workspace's tile, never the accent and never a surface (AGL-4000).
 */
internal fun workspaceAccent(brandColor: String?, whiteLabel: Boolean, useWorkspaceBrand: Boolean): String? =
  brandColor?.takeIf { whiteLabel && useWorkspaceBrand && com.aglyn.contracts.isAccountColor(it) }

/** A workspace's logo as a URL the image loader reads, light and dark. */
internal fun orgLogoUrls(workspace: WorkspaceState, orgId: String, origin: String): Pair<String?, String?> {
  val logo = workspace.orgLogos[orgId]
  return mediaPreviewUrl(logo?.light, origin, null, 160) to mediaPreviewUrl(logo?.dark, origin, null, 160)
}

/**
 * A workspace's color as its tile draws it (the rail, the pickers, the menus): the person's pick, else its brand color,
 * else a color taken from its logo (Zach, 2026-10-18), and the contract's `tintsApp`. It colors the tile only; no surface
 * wears a wash of it (AGL-4000).
 */
@Composable
internal fun rememberWorkspaceColor(
  orgId: String,
  workspace: WorkspaceState,
  prefs: AccountPreferences,
  origin: String,
): Pair<Color?, Boolean> {
  val logo = rememberLogoColor(orgLogoUrls(workspace, orgId, origin).first)
  val resolved = resolveWorkspaceColor(
    prefs.workspaceColors[orgId],
    workspace.orgLogos[orgId]?.brandColor,
    logo?.toHex(),
    prefs.theme.useWorkspaceBrand,
  )
  return colorOfHex(resolved.color) to resolved.tintsApp
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
