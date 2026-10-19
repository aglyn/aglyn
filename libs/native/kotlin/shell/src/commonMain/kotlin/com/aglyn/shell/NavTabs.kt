package com.aglyn.shell

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
import androidx.compose.material3.TextButton
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
import com.aglyn.ui.shellColors

/** One tab: its own place (a navigator), and the workspace and site it stands in. */
@Stable
internal class ShellTab(val id: Int, val navigator: ShellNavigator, orgId: String?, hostId: String?) {
  var orgId by mutableStateOf(orgId)
  var hostId by mutableStateOf(hostId)
  /** What the tab shows, as its title bar says it ("Bakery — Orders"). */
  var title by mutableStateOf("Home")
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

  /** Leaves the tab on screen where it stands and brings [tab] (and its workspace and site) on screen. */
  fun activate(tab: ShellTab, store: WorkspaceStore, currentOrg: String?, currentHost: String?) {
    if (tab.id == activeId) return
    active.orgId = currentOrg
    active.hostId = currentHost
    activeId = tab.id
    tab.orgId?.let { org -> store.select(org, tab.hostId) }
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
      next.orgId?.let { org -> store.select(org, next.hostId) }
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

/** The tab strip over the title bar, shown once there is more than the Home tab. */
@Composable
internal fun TabStrip(tabs: ShellTabs, onSelect: (ShellTab) -> Unit, onClose: (ShellTab) -> Unit, onNew: () -> Unit) {
  Row(
    Modifier.fillMaxWidth().background(shellColors.rail).height(40.dp).padding(horizontal = 8.dp).testTag("tab-strip"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(4.dp),
  ) {
    Row(Modifier.weight(1f, fill = false).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
      for (tab in tabs.tabs) {
        val selected = tab.id == tabs.activeId
        Surface(
          onClick = { onSelect(tab) },
          shape = RoundedCornerShape(8.dp),
          color = if (selected) MaterialTheme.colorScheme.surfaceContainerLowest else androidx.compose.ui.graphics.Color.Transparent,
          modifier = Modifier.heightIn(min = 32.dp).widthIn(max = 240.dp).testTag("tab-${tab.id}").semantics { this.selected = selected; role = Role.Tab },
        ) {
          Row(Modifier.padding(start = 10.dp, end = if (tab.pinned) 10.dp else 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Icon(AglynIcons.named(if (tab.pinned) "home" else "tab"), null, Modifier.size(16.dp))
            Text(if (tab.pinned) "Home" else tab.title, style = MaterialTheme.typography.labelLarge, fontWeight = if (selected) FontWeight.SemiBold else null, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 180.dp))
            if (!tab.pinned) {
              IconButton(onClick = { onClose(tab) }, modifier = Modifier.size(24.dp).testTag("tab-close-${tab.id}").semantics { contentDescription = "Close ${tab.title}" }) {
                Icon(AglynIcons.named("close"), null, Modifier.size(14.dp))
              }
            }
          }
        }
      }
    }
    TitleBarButton("New tab  ${shortcutText("T")}", "add", "tab-new", onClick = onNew)
    TitleBarButton("All tabs", "grid_view", "tab-overview") { tabs.overview = true }
  }
}

/** The tab overview: every open tab with search, and the recently closed. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TabOverview(tabs: ShellTabs, onSelect: (ShellTab) -> Unit, onReopen: (ShellTab) -> Unit) {
  var query by remember { mutableStateOf("") }
  AlertDialog(
    onDismissRequest = { tabs.overview = false },
    modifier = Modifier.widthIn(min = 520.dp).testTag("tab-overview-dialog"),
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
