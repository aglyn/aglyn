package com.aglyn.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aglyn.contracts.AccountItemRef
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.OneBoxGroup
import com.aglyn.contracts.OneBoxRow
import com.aglyn.contracts.OneBoxScope
import com.aglyn.contracts.isSearchableQuery
import com.aglyn.contracts.rankedNavScreens
import com.aglyn.contracts.scoreMatch
import com.aglyn.core.AccountPreferences
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.WorkspaceState
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.BrandPicture
import com.aglyn.ui.WorkspaceTile
import com.aglyn.ui.shellColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** One line the box can open: a server or local row, under its group's heading. */
internal data class OneBoxLine(val group: String, val heading: String, val row: OneBoxRow)

/** The headings the box gives its own groups (the route's groups bring theirs). */
private const val PINNED_GROUP = "pinned"
private const val RECENT_ORGS_GROUP = "recentWorkspaces"
private const val RECENTS_GROUP = "recents"

/** A kind of result's icon, by its group id. */
internal fun oneBoxIcon(group: String): String = when (group) {
  "pages", "page" -> "description"
  "orders", "order" -> "shopping_basket"
  "contacts", "contact" -> "contact_mail"
  "leads", "lead" -> "person_add"
  "companies", "company" -> "business"
  "deals", "deal" -> "handshake"
  "tasks", "task" -> "task"
  "activities" -> "history"
  "emails", "email" -> "mail"
  "components" -> "widgets"
  "layouts" -> "dashboard"
  "templates" -> "web"
  "content" -> "article"
  "authors" -> "person"
  "products", "product" -> "sell"
  "services" -> "design_services"
  "redirects" -> "alt_route"
  "workflows" -> "bolt"
  Contracts.oneBoxScreensGroup, "screen" -> "settings"
  else -> "search"
}

/**
 * The one box (Ctrl/⌘K, "Search or jump to"; Zach 2026-10-18): one place that switches workspaces and sites and finds
 * pages, orders, contacts, emails, components, layouts, templates, plugin records and the app's own screens and
 * settings. Before typing it lists the pins, the recent workspaces and what was opened recently; typing asks the server
 * (`/api/search`) and shows the screens-and-settings matches at once. Keyboard first: ↑↓ move, ↵ opens, Esc closes,
 * Ctrl/⌘1–5 jump to the pins.
 */
@Composable
internal fun OneBox(
  services: ShellServices,
  workspace: WorkspaceState,
  prefs: AccountPreferences,
  enabledPlugins: Collection<String>,
  hostAdmin: Boolean,
  fullScreen: Boolean,
  onOpen: (OneBoxLine) -> Unit,
  onClose: () -> Unit,
) {
  var query by remember { mutableStateOf("") }
  var server by remember { mutableStateOf<List<OneBoxGroup>>(emptyList()) }
  var loading by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var index by remember { mutableIntStateOf(0) }
  val search = remember(services.api) { com.aglyn.core.OneBoxSearch(services.api) }
  val scope = rememberCoroutineScope()
  val orgId = workspace.org?.id
  val hostId = workspace.site?.id
  LaunchedEffect(query, orgId, hostId) {
    error = null
    if (!isSearchableQuery(query)) { server = emptyList(); loading = false; return@LaunchedEffect }
    delay(220)
    loading = true
    try {
      server = search.search(query, orgId, hostId)?.groups.orEmpty()
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      error = if ((failure as? ConsoleApiError)?.status == 429) "Too many searches in a minute. Wait a moment." else "Search could not reach the server. Screens and workspaces still show."
    } finally {
      loading = false
    }
  }
  val byOrg = workspace.orgs.associateBy { it.id }
  val lines: List<OneBoxLine> = buildList {
    if (query.isBlank()) {
      prefs.pinned.mapNotNull { byOrg[it] }.forEach { org ->
        add(OneBoxLine(PINNED_GROUP, "Pinned ${prefs.pinned.size} of ${Contracts.pinnedOrgsMax}", OneBoxRow(group = Contracts.oneBoxWorkspacesGroup, id = org.id, label = org.name, detail = orgDetail(org, workspace), orgId = org.id)))
      }
      prefs.recentOrgs.filter { it !in prefs.pinned }.mapNotNull { byOrg[it] }.take(3).forEach { org ->
        add(OneBoxLine(RECENT_ORGS_GROUP, "Recent workspaces", OneBoxRow(group = Contracts.oneBoxWorkspacesGroup, id = org.id, label = org.name, detail = orgDetail(org, workspace), orgId = org.id)))
      }
      prefs.recents.take(8).forEach { item ->
        val where = listOfNotNull(byOrg[item.orgId]?.name).joinToString()
        add(OneBoxLine(RECENTS_GROUP, "Opened recently", OneBoxRow(group = item.kind, id = item.id, label = item.label, detail = where.ifEmpty { null }, orgId = item.orgId, hostId = item.hostId, screen = item.screen, params = item.params)))
      }
    } else {
      // The workspaces the app holds answer at once; the server's list (every membership) replaces them when it lands.
      val serverWorkspaces = server.firstOrNull { it.group == Contracts.oneBoxWorkspacesGroup }
      if (serverWorkspaces == null) {
        workspace.orgs.mapNotNull { org -> scoreMatch(org.name, listOf(org.slug), query)?.let { it to org } }
          .sortedByDescending { it.first }.take(5).forEach { (_, org) ->
            add(OneBoxLine(Contracts.oneBoxWorkspacesGroup, "Workspaces", OneBoxRow(group = Contracts.oneBoxWorkspacesGroup, id = org.id, label = org.name, detail = "Workspace · " + orgDetail(org, workspace), orgId = org.id)))
          }
      }
      for (group in server) group.rows.forEach { add(OneBoxLine(group.group, group.heading, it)) }
      val inSite = hostId != null
      rankedNavScreens(query, if (inSite) OneBoxScope.SITE else if (orgId != null) OneBoxScope.WORKSPACE else OneBoxScope.ACCOUNT, enabledPlugins, hostAdmin)
        .filter { row -> row.screen?.let { it.startsWith("shell.") || services.registry.screen(it) != null } == true }
        .take(6)
        .forEach { add(OneBoxLine(Contracts.oneBoxScreensGroup, "Screens & settings", it)) }
    }
  }
  LaunchedEffect(lines.size, query) { index = index.coerceIn(0, (lines.size - 1).coerceAtLeast(0)) }
  val listState = rememberLazyListState()
  LaunchedEffect(index) { if (lines.isNotEmpty()) runCatching { listState.animateScrollToItem(index) } }
  val focus = remember { FocusRequester() }
  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

  Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = !fullScreen)) {
    Surface(
      shape = if (fullScreen) RoundedCornerShape(0.dp) else RoundedCornerShape(16.dp),
      color = MaterialTheme.colorScheme.surfaceContainerLowest,
      tonalElevation = 6.dp,
      shadowElevation = 12.dp,
      modifier = (if (fullScreen) Modifier.fillMaxSize() else Modifier.widthIn(min = 520.dp, max = 640.dp).heightIn(max = 560.dp)).testTag("one-box"),
    ) {
      Column {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          Icon(AglynIcons.named("search"), null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
          Box(Modifier.weight(1f)) {
            if (query.isEmpty()) {
              Text("Find a workspace, site, page, order or contact", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            BasicTextField(
              query,
              onValueChange = { query = it; index = 0 },
              singleLine = true,
              textStyle = TextStyle.Default.merge(MaterialTheme.typography.bodyLarge).copy(color = MaterialTheme.colorScheme.onSurface),
              cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
              modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag("one-box-field")
                .semantics { contentDescription = "Search or jump to" }
                .onPreviewKeyEvent { event ->
                  if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                  val command = if (isMacPlatform) event.isMetaPressed else event.isCtrlPressed
                  val pin = listOf(Key.One, Key.Two, Key.Three, Key.Four, Key.Five).indexOf(event.key)
                  when {
                    command && pin >= 0 -> prefs.pinned.getOrNull(pin)?.let { id ->
                      byOrg[id]?.let { onOpen(OneBoxLine(PINNED_GROUP, "", OneBoxRow(group = Contracts.oneBoxWorkspacesGroup, id = it.id, label = it.name, orgId = it.id))) }
                      true
                    } ?: false
                    event.key == Key.DirectionDown -> { index = (index + 1).coerceAtMost((lines.size - 1).coerceAtLeast(0)); true }
                    event.key == Key.DirectionUp -> { index = (index - 1).coerceAtLeast(0); true }
                    event.key == Key.Enter || event.key == Key.NumPadEnter -> { lines.getOrNull(index)?.let(onOpen); true }
                    event.key == Key.Escape -> { onClose(); true }
                    else -> false
                  }
                },
            )
          }
          if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
          if (fullScreen) TextButton(onClick = onClose, modifier = Modifier.testTag("one-box-cancel")) { Text("Cancel") }
          else KeyCap("esc")
        }
        HorizontalDivider(color = shellColors.divider)
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
        LazyColumn(Modifier.weight(1f, fill = false).fillMaxWidth(), state = listState) {
          var last: String? = null
          lines.forEachIndexed { i, line ->
            val heading = line.heading
            if (heading != last && heading.isNotEmpty()) {
              item(key = "h-$i-$heading") {
                Text(heading, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp).semantics { heading() })
              }
            }
            last = heading
            item(key = "r-$i-${line.group}-${line.row.id}") { OneBoxResult(services, workspace, prefs, line, i == index) { onOpen(line) } }
            val group = server.firstOrNull { it.group == line.group }
            if (group?.nextCursor != null && lines.getOrNull(i + 1)?.group != line.group) {
              item(key = "more-${line.group}") {
                TextButton(
                  onClick = {
                    scope.launch {
                      runCatching { search.more(query, orgId, hostId, group) }.getOrNull()?.let { next ->
                        server = server.map { if (it.group == group.group) it.copy(rows = it.rows + next.rows, nextCursor = next.nextCursor) else it }
                      }
                    }
                  },
                  modifier = Modifier.padding(start = 8.dp).testTag("one-box-more-${line.group}"),
                ) { Text("Show more ${group.noun}") }
              }
            }
          }
          if (lines.isEmpty() && query.isNotBlank() && !loading) {
            item { Text(if (isSearchableQuery(query)) "Nothing matches “$query”." else "Type one more letter to search.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
          }
        }
        if (!fullScreen) {
          HorizontalDivider(color = shellColors.divider)
          Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerLow).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            KeyCap("↑↓"); Hint("to move"); KeyCap("↵"); Hint("to open"); KeyCap(shortcutText("1–5")); Hint("pins")
            Box(Modifier.weight(1f))
            Hint(if (hostId != null) "Searching ${workspace.site?.name} and everywhere you work" else "Searching everywhere you work")
          }
        }
      }
    }
  }
}

@Composable
private fun KeyCap(text: String) {
  Text(
    text,
    style = MaterialTheme.typography.labelSmall,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    modifier = Modifier.border(1.dp, shellColors.divider, RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
  )
}

@Composable
private fun Hint(text: String) {
  Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun OneBoxResult(services: ShellServices, workspace: WorkspaceState, prefs: AccountPreferences, line: OneBoxLine, selected: Boolean, onClick: () -> Unit) {
  val row = line.row
  Row(
    Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 1.dp)
      .background(if (selected) shellColors.selected else androidx.compose.ui.graphics.Color.Transparent, RoundedCornerShape(10.dp))
      .clickable(onClick = onClick)
      .padding(horizontal = 10.dp, vertical = 8.dp)
      .testTag("one-box-${line.group}-${row.id}")
      .semantics(mergeDescendants = true) { this.selected = selected },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    when (row.group) {
      Contracts.oneBoxWorkspacesGroup -> {
        val (light, dark) = orgLogoUrls(workspace, row.id, services.api.origin)
        val (color) = rememberWorkspaceColor(row.id, workspace, prefs, services.api.origin)
        WorkspaceTile(row.label, light, dark, color, size = 32.dp)
      }
      "sites" -> BrandPicture(mediaPreviewUrl(workspace.sites.firstOrNull { it.id == row.id }?.favicon, services.api.origin, row.id, 96), null, 32.dp, RoundedCornerShape(8.dp)) {
        WorkspaceTile(row.label, null, null, null, size = 32.dp)
      }
      else -> Box(Modifier.size(32.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
        Icon(AglynIcons.named(oneBoxIcon(row.group)), null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    Column(Modifier.weight(1f)) {
      Text(row.label, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
      row.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
    if (line.group == PINNED_GROUP) {
      val at = prefs.pinned.indexOf(row.id)
      if (at in 0..4 && LocalShowShortcuts.current) KeyCap(shortcutLabel(at + 1))
    } else if (selected && LocalShowShortcuts.current) {
      KeyCap("↵")
    }
  }
}

/** The account item a one-box line opens, for Recents: its kind, place, words and the native screen it lands on. */
internal fun recentRefOf(line: OneBoxLine, screen: String, params: Map<String, String>?, fallbackOrg: String?): AccountItemRef? {
  val orgId = line.row.orgId ?: fallbackOrg ?: return null
  return AccountItemRef(hostId = line.row.hostId, id = line.row.id, kind = line.row.group.removeSuffix("s"), label = line.row.label, orgId = orgId, params = params, screen = screen)
}
