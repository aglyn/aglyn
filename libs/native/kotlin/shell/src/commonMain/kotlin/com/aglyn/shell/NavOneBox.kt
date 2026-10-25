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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
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
import com.aglyn.ui.TextButton
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
  "orders", "order" -> "shopping_bag"
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

/** The line that opens the full results ("See all results for “ro”", Figma 118:15773). */
internal const val SEE_ALL_GROUP = "seeAll"
private const val STARRED_GROUP = "starred"

/** What the box shows for a query: its lines (grouped), whether the server is still asked, and its error. */
@androidx.compose.runtime.Stable
internal class OneBoxResults(
  val lines: List<OneBoxLine>,
  val loading: Boolean,
  val error: String?,
  val server: List<OneBoxGroup>,
  val more: (OneBoxGroup) -> Unit,
)

/**
 * The one box's answer for [query] (Zach 2026-10-18): before typing, Recent places and Starred (Figma 118:15883); typing
 * asks the server (`/api/search`) and shows the workspaces the app holds and the screens-and-settings matches at once,
 * grouped (Workspaces, Sites, Pages, Orders, Contacts, Screens & settings), then "See all results" ([seeAll]).
 */
@Composable
internal fun rememberOneBoxResults(
  services: ShellServices,
  workspace: WorkspaceState,
  prefs: AccountPreferences,
  enabledPlugins: Collection<String>,
  hostAdmin: Boolean,
  query: String,
  seeAll: Boolean,
): OneBoxResults {
  var server by remember { mutableStateOf<List<OneBoxGroup>>(emptyList()) }
  var loading by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
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
      prefs.recents.take(5).forEach { item ->
        val where = listOfNotNull(workspace.sites.firstOrNull { it.id == item.hostId }?.name ?: byOrg[item.orgId]?.name).joinToString()
        add(OneBoxLine(RECENTS_GROUP, "Recent places", OneBoxRow(group = item.kind, id = item.id, label = item.label, detail = where.ifEmpty { null }, orgId = item.orgId, hostId = item.hostId, screen = item.screen, params = item.params)))
      }
      prefs.starred.take(5).forEach { item ->
        val where = listOfNotNull(workspace.sites.firstOrNull { it.id == item.hostId }?.name ?: byOrg[item.orgId]?.name).joinToString()
        add(OneBoxLine(STARRED_GROUP, "Starred", OneBoxRow(group = item.kind, id = item.id, label = item.label, detail = where.ifEmpty { null }, orgId = item.orgId, hostId = item.hostId, screen = item.screen, params = item.params)))
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
      if (seeAll && isSearchableQuery(query)) {
        add(OneBoxLine(SEE_ALL_GROUP, "", OneBoxRow(group = SEE_ALL_GROUP, id = "see-all", label = "See all results for “${query.trim()}”", detail = "Opens the full results, grouped, with filters")))
      }
    }
  }
  return OneBoxResults(lines, loading, error, server) { group ->
    scope.launch {
      runCatching { search.more(query, orgId, hostId, group) }.getOrNull()?.let { next ->
        server = server.map { if (it.group == group.group) it.copy(rows = it.rows + next.rows, nextCursor = next.nextCursor) else it }
      }
    }
  }
}

/** The box's keys on its field: ↑↓ move, ↵ opens, Esc closes, Ctrl/⌘1–5 jump to the pins. */
internal fun oneBoxKey(
  event: androidx.compose.ui.input.key.KeyEvent,
  lines: List<OneBoxLine>,
  index: Int,
  setIndex: (Int) -> Unit,
  prefs: AccountPreferences,
  workspace: WorkspaceState,
  onOpen: (OneBoxLine) -> Unit,
  onClose: () -> Unit,
): Boolean {
  if (event.type != KeyEventType.KeyDown) return false
  val command = if (isMacPlatform) event.isMetaPressed else event.isCtrlPressed
  val pin = listOf(Key.One, Key.Two, Key.Three, Key.Four, Key.Five).indexOf(event.key)
  val byOrg = workspace.orgs.associateBy { it.id }
  return when {
    command && pin >= 0 -> prefs.pinned.getOrNull(pin)?.let { id ->
      byOrg[id]?.let { onOpen(OneBoxLine(PINNED_GROUP, "", OneBoxRow(group = Contracts.oneBoxWorkspacesGroup, id = it.id, label = it.name, orgId = it.id))) }
      true
    } ?: false
    event.key == Key.DirectionDown -> { setIndex((index + 1).coerceAtMost((lines.size - 1).coerceAtLeast(0))); true }
    event.key == Key.DirectionUp -> { setIndex((index - 1).coerceAtLeast(0)); true }
    event.key == Key.Enter || event.key == Key.NumPadEnter -> { lines.getOrNull(index)?.let(onOpen); true }
    event.key == Key.Escape -> { onClose(); true }
    else -> false
  }
}

/** The grouped result lines: a heading per group, the rows, "Show more" where the server has more. */
@Composable
internal fun OneBoxList(
  services: ShellServices,
  workspace: WorkspaceState,
  prefs: AccountPreferences,
  results: OneBoxResults,
  query: String,
  index: Int,
  onOpen: (OneBoxLine) -> Unit,
  modifier: Modifier = Modifier,
) {
  val lines = results.lines
  val listState = rememberLazyListState()
  LaunchedEffect(index) { if (lines.isNotEmpty()) runCatching { listState.animateScrollToItem(index) } }
  LazyColumn(modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp), state = listState) {
    var last: String? = null
    lines.forEachIndexed { i, line ->
      val heading = line.heading
      if (line.group == SEE_ALL_GROUP) {
        item(key = "see-all-divider") { HorizontalDivider(Modifier.padding(horizontal = 10.dp, vertical = 4.dp), color = shellColors.divider) }
      } else if (heading != last && heading.isNotEmpty()) {
        item(key = "h-$i-$heading") {
          // Figma's group label: 28 tall, 8 above and 4 below 12/16 semibold.
          Text(heading, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 10.dp, end = 10.dp, top = 8.dp, bottom = 4.dp).semantics { heading() })
        }
      }
      last = heading
      item(key = "r-$i-${line.group}-${line.row.id}") { OneBoxResult(services, workspace, prefs, line, i == index) { onOpen(line) } }
      val group = results.server.firstOrNull { it.group == line.group }
      if (group?.nextCursor != null && lines.getOrNull(i + 1)?.group != line.group) {
        item(key = "more-${line.group}") {
          TextButton(onClick = { results.more(group) }, modifier = Modifier.padding(start = 4.dp).testTag("one-box-more-${line.group}")) { Text("Show more ${group.noun}") }
        }
      }
    }
    if (lines.isEmpty() && query.isNotBlank() && !results.loading) {
      item { Text(if (isSearchableQuery(query)) "Nothing matches “$query”." else "Type one more letter to search.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    if (lines.isEmpty() && query.isBlank()) {
      item { Text("Places you open and star show up here.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
  }
}

/** The hint footer (Figma: ↑↓ to move, ↵ to open, esc to close, then what is searched). */
@Composable
internal fun OneBoxFooter(workspace: WorkspaceState, typing: Boolean) {
  HorizontalDivider(color = shellColors.divider)
  Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerLow).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
    KeyCap("↑↓"); Hint("to move"); Box(Modifier.size(10.dp)); KeyCap("↵"); Hint("to open"); Box(Modifier.size(10.dp)); KeyCap("esc"); Hint("to close")
    Box(Modifier.weight(1f))
    Hint(
      when {
        !typing -> "Type to search everywhere you work"
        workspace.site != null -> "Searching ${workspace.site?.name} and everywhere you work"
        else -> "Searching everywhere you work"
      },
    )
  }
}

/**
 * The one box as its own screen: the phone's search (full screen from the top bar), and the fallback where there is no
 * title bar. Keyboard first, as the inline field is.
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
  var index by remember { mutableIntStateOf(0) }
  val results = rememberOneBoxResults(services, workspace, prefs, enabledPlugins, hostAdmin, query, seeAll = true)
  val lines = results.lines
  LaunchedEffect(lines.size, query) { index = index.coerceIn(0, (lines.size - 1).coerceAtLeast(0)) }
  val focus = remember { FocusRequester() }
  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

  Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = !fullScreen)) {
    Surface(
      shape = if (fullScreen) RoundedCornerShape(0.dp) else RoundedCornerShape(12.dp),
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
                .onPreviewKeyEvent { event -> oneBoxKey(event, lines, index, { index = it }, prefs, workspace, onOpen, onClose) },
            )
          }
          if (results.loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
          if (fullScreen) TextButton(onClick = onClose, modifier = Modifier.testTag("one-box-cancel")) { Text("Cancel") }
          else KeyCap("esc")
        }
        HorizontalDivider(color = shellColors.divider)
        results.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
        OneBoxList(services, workspace, prefs, results, query, index, onOpen, Modifier.weight(1f, fill = false))
        if (!fullScreen) OneBoxFooter(workspace, typing = query.isNotBlank())
      }
    }
  }
}

/**
 * The title bar's search (Figma 8:90, Mac Focused 67:13286 / Typing 118:18960): a real text field, centered. A click or
 * Ctrl/⌘K puts the caret in it right there; the dropdown anchored under it (118:16068) lists Recent places and Starred,
 * then grouped results as you type. Esc, a click outside, or opening a result closes it; "See all results" opens the full
 * results in this tab.
 */
@Composable
internal fun InlineSearchField(
  services: ShellServices,
  workspace: WorkspaceState,
  chrome: NavChromeState,
  enabledPlugins: Collection<String>,
  hostAdmin: Boolean,
  onOpen: (OneBoxLine) -> Unit,
  onSeeAll: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val m = com.aglyn.ui.shellMetrics
  val prefs by services.accountPrefs.state.collectAsState()
  var query by remember { mutableStateOf("") }
  var index by remember { mutableIntStateOf(0) }
  val focus = remember { FocusRequester() }
  val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
  val open = chrome.oneBox
  val results = rememberOneBoxResults(services, workspace, prefs, enabledPlugins, hostAdmin, if (open) query else "", seeAll = true)
  val lines = results.lines
  LaunchedEffect(lines.size, query) { index = index.coerceIn(0, (lines.size - 1).coerceAtLeast(0)) }
  // Ctrl/⌘K (or Find) opens the box: the caret goes into this field.
  LaunchedEffect(open) { if (open) runCatching { focus.requestFocus() } }
  fun close() {
    chrome.oneBox = false
    query = ""
    index = 0
    focusManager.clearFocus()
  }
  val pick: (OneBoxLine) -> Unit = { line ->
    val typed = query.trim()
    close()
    if (line.group == SEE_ALL_GROUP) onSeeAll(typed) else onOpen(line)
  }
  Box(modifier) {
    Row(
      // Figma Titlebar/Search field: 28 tall at Compact.
      Modifier.fillMaxWidth().heightIn(min = if (m.compact) 28.dp else 36.dp).clip(RoundedCornerShape(m.controlRadius))
        .background(if (open) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceContainerHigh)
        .border(1.dp, if (open) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(m.controlRadius))
        .padding(horizontal = 10.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Icon(AglynIcons.named("search"), null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      Box(Modifier.weight(1f)) {
        if (query.isEmpty()) Text("Search or jump to", fontSize = m.rowText, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        BasicTextField(
          query,
          onValueChange = { query = it; index = 0; if (!chrome.oneBox) chrome.oneBox = true },
          singleLine = true,
          textStyle = TextStyle.Default.merge(MaterialTheme.typography.bodyMedium).copy(fontSize = m.rowText, color = MaterialTheme.colorScheme.onSurface),
          cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
          modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag("search-or-jump-field")
            .semantics { contentDescription = "Search or jump to" }
            .onFocusChanged { if (it.isFocused && !chrome.oneBox) chrome.oneBox = true }
            .onPreviewKeyEvent { event -> open && oneBoxKey(event, lines, index, { index = it }, prefs, workspace, pick) { close() } },
        )
      }
      if (open && results.loading) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
      KeyCap(if (open) "esc" else shortcutText("K"))
    }
    if (open) {
      androidx.compose.ui.window.Popup(
        popupPositionProvider = remember { CenteredBelow() },
        onDismissRequest = { close() },
        properties = androidx.compose.ui.window.PopupProperties(focusable = false, dismissOnClickOutside = true),
      ) {
        Surface(
          shape = RoundedCornerShape(12.dp),
          color = MaterialTheme.colorScheme.surfaceContainerLowest,
          shadowElevation = 12.dp,
          tonalElevation = 4.dp,
          border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
          modifier = Modifier.width(560.dp).heightIn(max = 540.dp).testTag("one-box"),
        ) {
          Column {
            results.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
            OneBoxList(services, workspace, prefs, results, query, index, pick, Modifier.weight(1f, fill = false))
            OneBoxFooter(workspace, typing = query.isNotBlank())
          }
        }
      }
    }
  }
}

/** Places a popup centered under its anchor, 6 below it, kept inside the window. */
private class CenteredBelow(private val gap: Int = 6) : androidx.compose.ui.window.PopupPositionProvider {
  override fun calculatePosition(
    anchorBounds: androidx.compose.ui.unit.IntRect,
    windowSize: androidx.compose.ui.unit.IntSize,
    layoutDirection: androidx.compose.ui.unit.LayoutDirection,
    popupContentSize: androidx.compose.ui.unit.IntSize,
  ): androidx.compose.ui.unit.IntOffset {
    val x = (anchorBounds.left + (anchorBounds.width - popupContentSize.width) / 2).coerceIn(0, (windowSize.width - popupContentSize.width).coerceAtLeast(0))
    return androidx.compose.ui.unit.IntOffset(x, anchorBounds.bottom + gap)
  }
}

/**
 * "See all results for “ro”": the full results in the tab, grouped, with a filter per group (chips), and every server
 * group's "Show more".
 */
@Composable
internal fun SearchResultsScreen(
  services: ShellServices,
  workspace: WorkspaceState,
  enabledPlugins: Collection<String>,
  hostAdmin: Boolean,
  initial: String,
  onOpen: (OneBoxLine) -> Unit,
) {
  val prefs by services.accountPrefs.state.collectAsState()
  var query by remember(initial) { mutableStateOf(initial) }
  var only by remember(initial) { mutableStateOf<String?>(null) }
  val results = rememberOneBoxResults(services, workspace, prefs, enabledPlugins, hostAdmin, query, seeAll = false)
  val groups = results.lines.map { it.group to it.heading }.distinct().filter { it.second.isNotEmpty() }
  val shown = OneBoxResults(results.lines.filter { only == null || it.group == only }, results.loading, results.error, results.server, results.more)
  Column(Modifier.fillMaxSize().testTag("search-results")) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
      CompactSearchField(query, "Search everywhere you work", "search-results-field", Modifier.weight(1f)) { query = it; only = null }
      if (results.loading) CircularProgressIndicator(Modifier.padding(start = 10.dp).size(16.dp), strokeWidth = 2.dp)
    }
    if (groups.size > 1) {
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        androidx.compose.material3.FilterChip(only == null, onClick = { only = null }, label = { Text("All") }, colors = com.aglyn.ui.aglynFilterChipColors(), modifier = Modifier.testTag("search-results-all"))
        for ((group, heading) in groups) {
          androidx.compose.material3.FilterChip(only == group, onClick = { only = if (only == group) null else group }, label = { Text(heading) }, colors = com.aglyn.ui.aglynFilterChipColors(), modifier = Modifier.testTag("search-results-$group"))
        }
      }
    }
    results.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
    OneBoxList(services, workspace, prefs, shown, query, -1, onOpen, Modifier.weight(1f).widthIn(max = 760.dp))
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
  // Figma 118:16068: 44 tall, a 28 tile (radius 8), 13 semibold title, 12 detail, radius 6, ↵ on the highlighted row.
  Row(
    Modifier.fillMaxWidth().padding(vertical = 0.dp)
      .background(if (selected) shellColors.selected else androidx.compose.ui.graphics.Color.Transparent, RoundedCornerShape(6.dp))
      .clip(RoundedCornerShape(6.dp))
      .clickable(onClick = onClick)
      .heightIn(min = 44.dp)
      .padding(horizontal = 10.dp, vertical = 4.dp)
      .testTag("one-box-${line.group}-${row.id}")
      .semantics(mergeDescendants = true) { this.selected = selected },
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    when (row.group) {
      Contracts.oneBoxWorkspacesGroup -> {
        val (light, dark) = orgLogoUrls(workspace, row.id, services.api.origin)
        val (color) = rememberWorkspaceColor(row.id, workspace, prefs, services.api.origin)
        WorkspaceTile(row.label, light, dark, color, size = 28.dp, cornerRadius = 8.dp)
      }
      "sites" -> BrandPicture(mediaPreviewUrl(workspace.sites.firstOrNull { it.id == row.id }?.favicon, services.api.origin, row.id, 96), null, 28.dp, RoundedCornerShape(8.dp)) {
        WorkspaceTile(row.label, null, null, null, size = 28.dp, cornerRadius = 8.dp)
      }
      else -> Box(Modifier.size(28.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
        // A result's glyph by its group, else by its heading's words (a server group id the app does not know yet).
        val glyph = if (row.group == SEE_ALL_GROUP) "search" else oneBoxIcon(row.group).takeUnless { it == "search" } ?: oneBoxIcon(line.heading.lowercase())
        Icon(AglynIcons.named(glyph), null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    Column(Modifier.weight(1f)) {
      Text(row.label, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
      row.detail?.let { Text(it, fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
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
