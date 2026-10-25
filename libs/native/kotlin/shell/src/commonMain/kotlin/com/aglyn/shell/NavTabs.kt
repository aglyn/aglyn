package com.aglyn.shell

import com.aglyn.ui.sheetEntrance
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.core.WorkspaceStore
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.TextButton
import com.aglyn.ui.shellColors

/** One tab: its own place (a navigator), and the workspace and site it stands in. */
@Stable
internal class ShellTab(val id: Int, val navigator: ShellNavigator, orgId: String?, hostId: String?) {
  var orgId by mutableStateOf(orgId)
  var hostId by mutableStateOf(hostId)
  /** What the tab shows, as its title bar says it ("Bakery — Orders"). */
  var title by mutableStateOf("Home")
  /** The screen's own icon (a Material Symbols name: the bag for Orders), shown on the tab. */
  var icon by mutableStateOf<String?>(null)
  /** The pinned Home tab: first, never closed. */
  val pinned: Boolean get() = id == 0
}

/**
 * The window's tabs (desktop and Android tablets): a pinned Home tab first, then any the person opens, each keeping its
 * own workspace, site and place; Ctrl/⌘T, Ctrl/⌘W, Ctrl/⌘⇧T, and an overview with search and the recently closed.
 * Compose Desktop draws its own strip: a Compose window has no system window tabs to join (AppKit's are Apple's).
 */
@Stable
internal class ShellTabs(root: ShellNavigator) {
  val tabs = mutableStateListOf(ShellTab(0, root, null, null))
  var activeId by mutableIntStateOf(0)
    private set
  val closed = mutableStateListOf<ShellTab>()
  private var nextId = 1
  var overview by mutableStateOf(false)

  val active: ShellTab get() = tabs.firstOrNull { it.id == activeId } ?: tabs.first()

  /**
   * Leaves the tab on screen where it stands and brings [tab] on screen with its own workspace and site (or its whole
   * workspace): each tab keeps its scope, so navigating in one never moves another.
   */
  fun activate(tab: ShellTab, store: WorkspaceStore, currentOrg: String?, currentHost: String?) {
    if (tab.id == activeId) return
    active.orgId = currentOrg
    active.hostId = currentHost
    activeId = tab.id
    tab.orgId?.let { org -> expecting = org to tab.hostId; store.selectScope(org, tab.hostId) }
  }

  /** The scope a tab switch asked for, until the store has it on screen (so the old scope is never tracked onto it). */
  private var expecting: Pair<String, String?>? = null

  /** The tab on screen follows its scope as it changes (a workspace or site picked inside it). */
  fun track(currentOrg: String?, currentHost: String?) {
    if (currentOrg == null) return
    // The asked-for workspace on screen ends the wait (its site may have resolved to another, which then counts).
    expecting?.let { want -> if (want.first == currentOrg) expecting = null else return }
    active.orgId = currentOrg
    active.hostId = currentHost
  }

  /** A new tab at [key] (Home by default), in the workspace and site on screen. */
  fun open(store: WorkspaceStore, currentOrg: String?, currentHost: String?, key: String = ShellNavigator.HOME): ShellTab {
    val tab = ShellTab(nextId++, ShellNavigator(key), currentOrg, currentHost)
    tabs += tab
    activate(tab, store, currentOrg, currentHost)
    return tab
  }

  fun close(tab: ShellTab, store: WorkspaceStore, currentOrg: String?, currentHost: String?) {
    if (tab.pinned) return
    val index = tabs.indexOf(tab)
    if (tab.id == activeId) {
      tab.orgId = currentOrg
      tab.hostId = currentHost
    }
    tabs.remove(tab)
    closed.add(0, tab)
    while (closed.size > 10) closed.removeAt(closed.lastIndex)
    if (tab.id == activeId) {
      val next = tabs.getOrNull(index) ?: tabs.getOrNull(index - 1) ?: tabs.first()
      activeId = next.id
      next.orgId?.let { org -> expecting = org to next.hostId; store.selectScope(org, next.hostId) }
    }
  }

  /** Ctrl/⌘⇧T: the last closed tab, back where it was. */
  fun reopen(store: WorkspaceStore, currentOrg: String?, currentHost: String?) {
    val tab = closed.firstOrNull() ?: return
    closed.removeAt(0)
    tabs += tab
    activate(tab, store, currentOrg, currentHost)
  }
}

/** The tab overview: every open tab with search, and the recently closed. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TabOverview(tabs: ShellTabs, onSelect: (ShellTab) -> Unit, onReopen: (ShellTab) -> Unit) {
  var query by remember { mutableStateOf("") }
  AlertDialog(
    onDismissRequest = { tabs.overview = false },
    modifier = Modifier.widthIn(min = 520.dp).sheetEntrance(com.aglyn.ui.SheetEntrance.GROW).testTag("tab-overview-dialog"),
    title = { Text("Tabs") },
    text = {
      Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(query, { query = it }, placeholder = { Text("Search tabs") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("tab-search"))
        Text("Open tabs · ${tabs.tabs.size}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          for (tab in tabs.tabs.filter { query.isBlank() || it.title.contains(query, ignoreCase = true) }) {
            Surface(
              onClick = { tabs.overview = false; onSelect(tab) },
              shape = RoundedCornerShape(12.dp),
              color = if (tab.id == tabs.activeId) shellColors.selected else MaterialTheme.colorScheme.surfaceContainerHigh,
              modifier = Modifier.width(150.dp).testTag("overview-tab-${tab.id}"),
            ) {
              Column(Modifier.padding(12.dp)) {
                Icon(AglynIcons.named(if (tab.pinned) "home" else "tab"), null)
                Text(if (tab.pinned) "Home" else tab.title, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
              }
            }
          }
        }
        if (tabs.closed.isNotEmpty()) {
          Text("Recently closed", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          for (tab in tabs.closed.filter { query.isBlank() || it.title.contains(query, ignoreCase = true) }) {
            Row(
              Modifier.fillMaxWidth().clickable { tabs.overview = false; onReopen(tab) }.padding(vertical = 6.dp).testTag("closed-tab-${tab.id}"),
              verticalAlignment = Alignment.CenterVertically,
              horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
              Icon(AglynIcons.named("history"), null, Modifier.size(18.dp))
              Text(tab.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
          }
        }
      }
    },
    confirmButton = { TextButton(onClick = { tabs.overview = false }) { Text("Done") } },
  )
}
