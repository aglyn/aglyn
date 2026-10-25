package com.aglyn.site.media

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.backhandler.BackHandler
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.isCtrlPressed
import androidx.compose.ui.input.pointer.isMetaPressed
import androidx.compose.ui.input.pointer.isShiftPressed
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import com.aglyn.ui.AglynIconButton
import com.aglyn.ui.CompactButton
import com.aglyn.ui.Load
import com.aglyn.ui.LocalPageStar
import com.aglyn.ui.LocalShellMetrics
import com.aglyn.ui.WidthClass
import com.aglyn.ui.contentInset
import com.aglyn.ui.controlShape
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.rememberRemoteBitmap
import com.aglyn.ui.shellColors
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.MediaSort
import com.aglyn.contracts.mediaOriginalSrc
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.OrgAccess
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.RunnerBanners
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.CloseWhenGone
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.CountedTextField
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.LocalImageLoader
import com.aglyn.ui.LoadContent
import com.aglyn.ui.LocalMediaPicker
import com.aglyn.ui.LocalVideoProbe
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.PickSource
import com.aglyn.ui.PickedFile
import com.aglyn.ui.RefreshableBox
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SkeletonGrid
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.TextButton
import com.aglyn.ui.pickSourceLabel
import com.aglyn.ui.space
import com.aglyn.ui.mediaMetrics
import com.aglyn.ui.OnMediaScrim
import com.aglyn.ui.AglynTokens
import kotlinx.coroutines.launch

const val SITE_MEDIA_SCREEN = "site.media"

private val CONTENT_ROLES = setOf("admin", "editor", "author")

/** The reader's scope clause for an org library: none for an org-wide member, their tokens otherwise. */
@Composable
private fun orgScopeTokens(context: NativePluginContext, scope: MediaScope.Org): Live<List<String>?> {
  if (scope.forHostId != null) return Live.Ready(listOf(OrgAccess.ORG_SCOPE_TOKEN, OrgAccess.hostScopeToken(scope.forHostId)))
  val member by remember(scope.orgId, context.uid) { context.firestore.observeDoc("orgs/${scope.orgId}/members/${context.uid}") }.collectAsState(Live.Loading)
  return when (val live = member) {
    Live.Loading -> Live.Loading
    is Live.Failed -> Live.Ready(null)
    is Live.Ready -> OrgAccess.fromMember(live.value).let { access -> Live.Ready(if (access.orgWide) null else access.tokens) }
  }
}

/** Resolves who may read what in a library before it loads, then shows [content] with the reader's scope clause. */
@Composable
internal fun MediaScopeGate(context: NativePluginContext, scope: MediaScope, content: @Composable (scopeTokens: List<String>?) -> Unit) {
  val tokens = if (scope is MediaScope.Org) orgScopeTokens(context, scope) else Live.Ready(null)
  when (tokens) {
    Live.Loading -> SkeletonGrid(tiles = 9)
    is Live.Failed -> EmptyState("Could not load this library", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
    is Live.Ready -> content(tokens.value)
  }
}

/**
 * The media library as a file browser (Figma "Media · file browser", AGL-4004): at rest the grid fills the content,
 * folders first, then files; picking a file splits the view and opens its details on the right (a phone opens them in
 * its place, the system back returns). The site's library and the workspace's (as this site sees it), folders and
 * subfolders, search, one Filter (type, sort, more), grid or list, upload, several files at once (move, tag, delete),
 * and each file's details, privacy, move, replace and delete.
 */
@Composable
fun MediaScreen(context: NativePluginContext, params: Map<String, String>) {
  val orgId = context.orgId
  val hostId = context.hostId
  // The workspace's own library page (`/{org}/media`) shows it whole; a site's shows both libraries.
  val orgOnly = hostId == null || params["library"] == "org" || (params.containsKey("orgSlug") && !params.containsKey("hostSlug"))
  var tab by remember { mutableStateOf(if (params["tab"] == "org" || orgOnly) 1 else 0) }
  val scope: MediaScope? = when {
    tab == 0 && hostId != null -> MediaScope.Site(hostId)
    orgId != null -> MediaScope.Org(orgId, if (orgOnly) null else hostId)
    else -> null
  }
  if (scope == null) {
    EmptyState("Pick a workspace first", icon = AglynIcons.named("photo_library"))
    return
  }
  MediaScopeGate(context, scope) { tokens ->
    key(scope) { MediaLibrary(context, scope, tokens, params["media"], library = if (orgOnly) null else LibraryPick(tab) { tab = it }) }
  }
}

/** The library a site's page shows (0 this site, 1 the workspace), and how to switch it. */
private class LibraryPick(val index: Int, val pick: (Int) -> Unit)

/** Grid or list (the console's view toggle). */
private enum class MediaView { GRID, LIST }

@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
private fun MediaLibrary(context: NativePluginContext, scope: MediaScope, scopeTokens: List<String>?, initialMediaId: String?, library: LibraryPick?) {
  val coroutines = rememberCoroutineScope()
  val model = remember(scope, context.firestore) { MediaListModel(scope, context.firestore, coroutines) }
  LaunchedEffect(model, scopeTokens) { model.start(scopeTokens) }
  val videoProbe = LocalVideoProbe.current
  val api = remember(scope, context.api, videoProbe) { MediaApi(context.api, scope, videoProbe) }
  val runner = remember(scope) { ActionRunner(coroutines) }
  val folders by remember(scope, scopeTokens, context.firestore) {
    context.firestore.observe(
      FirestoreQuery(
        "${scope.path}/mediaFolders",
        filters = scopeTokens?.let { listOf(FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, it)) }.orEmpty(),
        limit = 500,
      ),
    )
  }.collectAsState(Live.Loading)
  val folderList = sortedFolders((folders as? Live.Ready)?.value?.map(::mediaFolderOf).orEmpty())
  val foldersById = folderList.associateBy { it.id }
  val canEdit = scope is MediaScope.Org && context.orgRole in setOf("owner", "admin", "editor") || scope is MediaScope.Site && context.siteRole in CONTENT_ROLES
  val origin = context.api.origin
  val phone = currentWidthClass() == WidthClass.COMPACT && !LocalShellMetrics.current.compact
  val compact = LocalShellMetrics.current.compact
  val edge = contentInset()
  val metrics = mediaMetrics(phone)
  val uri = LocalUriHandler.current
  val clipboard = LocalClipboardManager.current
  val windowInfo = LocalWindowInfo.current
  var dialog by remember { mutableStateOf<MediaDialog?>(null) }
  var filtersOpen by remember { mutableStateOf(false) }
  val picker = LocalMediaPicker.current
  var uploading by remember { mutableStateOf<Triple<Int, Int, String>?>(null) }
  var undo by remember { mutableStateOf<Pair<List<String>, List<String>>?>(null) }
  var disabled by remember(scope) { mutableStateOf<Map<String, MediaQuarantineNotice>>(emptyMap()) }
  var audioBatch by remember { mutableStateOf<List<PickedFile>?>(null) }
  var selection by remember { mutableStateOf<Set<String>>(emptySet()) }
  var anchor by remember { mutableStateOf<String?>(null) }
  var focusedFolder by remember { mutableStateOf<String?>(null) }
  var selecting by remember { mutableStateOf(false) }
  var phoneFile by rememberSaveable { mutableStateOf<String?>(null) }
  var includeSubfolders by remember { mutableStateOf(false) }
  var view by rememberSaveable { mutableStateOf(MediaView.GRID) }
  var counts by remember(scope) { mutableStateOf<Map<String, Long>>(emptyMap()) }
  var countsVersion by remember { mutableStateOf(0) }
  var bulkTag by remember { mutableStateOf<Boolean?>(null) }
  var bulkDeleting by remember { mutableStateOf(false) }
  var columns by remember { mutableStateOf(4) }
  val focus = remember { FocusRequester() }

  val currentFolderId = (model.folder as? FolderPick.One)?.id
  val crumbs = remember(currentFolderId, foldersById) {
    buildList {
      var current = currentFolderId?.let(foldersById::get)
      val seen = mutableSetOf<String>()
      while (current != null && seen.add(current.id)) {
        add(0, current)
        current = current.parentId?.let(foldersById::get)
      }
    }
  }
  val visibleFolders = if (model.search.isBlank() && model.folder != FolderPick.Root) folderList.filter { it.parentId == currentFolderId } else emptyList()
  val items = (model.rows as? Load.Ready)?.value.orEmpty()
  val selectedItems = items.filter { it.id in selection }
  val filtering = model.search.isNotBlank() || model.type != null || model.filters.count > 0

  LaunchedEffect(includeSubfolders, currentFolderId, folderList) {
    model.include(if (includeSubfolders && currentFolderId != null) mediaFolderSubtree(currentFolderId, folderList) else emptyList())
  }
  LaunchedEffect(model.folder) { selection = emptySet(); focusedFolder = null }
  LaunchedEffect(visibleFolders.map { it.id }, countsVersion) {
    for (folder in visibleFolders) mediaFolderCount(context.firestore, scope, folder.id, scopeTokens)?.let { counts = counts + (folder.id to it) }
  }
  LaunchedEffect(items.map { it.id }) {
    disabled = api.quarantine(items.map { it.id })
    if (!phone && selection.isEmpty() && initialMediaId != null && items.any { it.id == initialMediaId }) selection = setOf(initialMediaId)
  }

  fun open(folderId: String?) = model.open(folderId?.let { FolderPick.One(it) } ?: FolderPick.All)

  fun sendFiles(files: List<PickedFile>, rightsConfirmed: Boolean) {
    val folderId = currentFolderId
    runner.run(success = if (files.size == 1) "${files[0].name} uploaded." else "${files.size} files uploaded.", onDone = { uploading = null; model.refresh(); countsVersion++ }) {
      try {
        files.forEachIndexed { index, file ->
          uploading = Triple(index, files.size, file.name)
          api.upload(file, folderId, rightsConfirmed)
        }
      } finally {
        uploading = null
        model.refresh()
      }
    }
  }

  fun uploadFrom(source: PickSource) {
    val device = picker ?: return
    coroutines.launch {
      val files = runCatching { device.pick(source, multiple = source != PickSource.CAMERA) }.getOrDefault(emptyList())
      if (files.isEmpty()) return@launch
      // An audio file needs its uploader's rights confirmation first (AGL-3716).
      if (files.any(::isAudioFile)) audioBatch = files else sendFiles(files, false)
    }
  }

  fun move(ids: List<String>, folderId: String?) {
    if (!canEdit || ids.isEmpty()) return
    val leaving = model.folder != FolderPick.All && currentFolderId != folderId && folderId !in model.subtree
    runner.run("Moved.", onDone = { countsVersion++ }) {
      api.move(ids, folderId)
      if (leaving) model.drop(ids.toSet())
      selection = selection - ids.toSet()
    }
  }

  fun click(item: MediaItem) {
    focusedFolder = null
    if (selecting) {
      selection = if (item.id in selection) selection - item.id else selection + item.id
      return
    }
    if (phone) {
      phoneFile = item.id
      return
    }
    runCatching { focus.requestFocus() }
    val mods = windowInfo.keyboardModifiers
    val range = mods.isShiftPressed
    selection = mediaSelection(selection, anchor, item.id, toggle = mods.isMetaPressed || mods.isCtrlPressed, range = range, order = items.map { it.id })
    if (!range) anchor = item.id
  }

  fun openFile(item: MediaItem) {
    if (item.private && scope is MediaScope.Org) runner.run { api.signedLink(item.id)?.let(uri::openUri) } else item.src(origin)?.let(uri::openUri)
  }

  val keyOrder = visibleFolders.map { "f:${it.id}" } + items.map { it.id }
  fun step(move: MediaGridMove) {
    val current = focusedFolder?.let { "f:$it" } ?: selection.singleOrNull()
    val next = mediaGridStep(keyOrder, current, columns, move) ?: return
    if (next.startsWith("f:")) { focusedFolder = next.removePrefix("f:"); selection = emptySet() } else { focusedFolder = null; selection = setOf(next); anchor = next }
  }

  fun deleteSelection() {
    val picked = items.filter { it.id in selection }
    runner.run(onDone = { bulkDeleting = false; countsVersion++ }) {
      val gone = mutableListOf<String>()
      val restorable = mutableListOf<Pair<String, String>>()
      val failed = mutableListOf<String>()
      for (item in picked) {
        try {
          if (api.delete(item.id)) restorable += item.id to item.fileName
          gone += item.id
        } catch (error: Throwable) {
          if (error is kotlinx.coroutines.CancellationException) throw error
          failed += item.fileName
        }
      }
      model.drop(gone.toSet())
      selection = emptySet()
      if (restorable.isNotEmpty()) undo = restorable.map { it.first } to restorable.map { it.second }
      if (failed.isNotEmpty()) {
        throw IllegalStateException(
          if (failed.size == 1) "Could not delete \"${failed[0]}\" — it is still in the library" else "Could not delete ${failed.size} files — they are still in the library",
        )
      }
    }
  }

  fun applyTag(tag: String, add: Boolean) {
    val normalized = tag.trim().lowercase()
    if (normalized.isEmpty()) return
    val picked = items.filter { it.id in selection }
    runner.run(if (add) "Tagged ${mediaFilesCount(picked.size)}" else "Untagged ${mediaFilesCount(picked.size)}", onDone = { bulkTag = null; model.refresh() }) {
      for (item in picked) {
        val tags = if (add) (if (normalized in item.tags) item.tags else item.tags + normalized) else item.tags.filter { it != normalized }
        if (tags != item.tags) api.setTags(item.id, tags)
      }
    }
  }

  // A phone opens a file in the library's place; the system back returns to the grid, or up a folder.
  BackHandler(enabled = phone && phoneFile != null) { phoneFile = null }
  BackHandler(enabled = phone && phoneFile == null && (selecting || currentFolderId != null)) {
    if (selecting) { selecting = false; selection = emptySet() } else open(crumbs.dropLast(1).lastOrNull()?.id)
  }

  val onDeleted: (String, String, Boolean) -> Unit = { id, name, restorable ->
    model.drop(id)
    selection = selection - id
    if (phoneFile == id) phoneFile = null
    undo = if (restorable) listOf(id) to listOf(name) else null
    if (!restorable) runner.notice = "${mediaDeletedMessage(listOf(name))}."
  }

  val phoneDetail = phoneFile
  if (phone && phoneDetail != null) {
    Column(Modifier.fillMaxSize()) {
      Column(Modifier.padding(horizontal = edge), verticalArrangement = Arrangement.spacedBy(space(1f))) { RunnerBanners(runner) }
      MediaDetail(context, scope, phoneDetail, api, runner, folderList, foldersById, canEdit, onDeleted = onDeleted, onChanged = { model.refresh() })
    }
  } else {
    Column(Modifier.fillMaxSize().testTag("media-screen")) {
      MediaHead(phone, compact, edge, canEdit && !runner.busy, onNewFolder = { runner.clear(); dialog = MediaDialog.NewFolder(currentFolderId) }, sources = picker?.sources.orEmpty(), onUpload = ::uploadFrom)
      Row(Modifier.weight(1f).fillMaxWidth()) {
        Column(Modifier.weight(1f).fillMaxHeight()) {
          MediaToolbar(model, edge, onMoreFilters = { filtersOpen = true }, filtering = filtering, onClear = { model.type(""); model.pick(null); model.filter(MediaFilters()) })
          MediaPathRow(
            library, crumbs, phone, edge, onOpen = ::open, includeSubfolders, { includeSubfolders = it }, view, { view = it },
            selecting, { selecting = it; if (!it) selection = emptySet() },
          )
          val notices = listOfNotNull(Contracts.mediaScopedSearchNotice.takeIf { scopeTokens != null && model.search.isNotBlank() }) + model.notices
          notices.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = edge).testTag("media-filter-notice")) }
          RefreshableBox(model.refreshing, model::refresh, Modifier.weight(1f)) {
            LoadContent(model.rows, onRetry = { model.reload() }, failedTitle = "Could not load the library", skeleton = { SkeletonGrid(tiles = 12) }) { rows ->
              if (rows.isEmpty() && visibleFolders.isEmpty()) {
                if (filtering) {
                  EmptyState(
                    "No media matches these filters",
                    body = "Try a different search, folder, or type — or clear the filters to see everything in this library.",
                    icon = AglynIcons.named("filter_list"),
                    action = { TextButton(onClick = { model.type(""); model.pick(null); model.filter(MediaFilters()) }, modifier = Modifier.testTag("media-clear-filters")) { Text("Clear filters") } },
                  )
                } else {
                  val emptyAction: (@Composable () -> Unit)? = if (canEdit && picker != null) {
                    { Button(onClick = { picker.sources.firstOrNull()?.let(::uploadFrom) }, modifier = Modifier.testTag("media-empty-upload")) { Text("Upload media") } }
                  } else null
                  EmptyState(
                    "No media here yet",
                    body = "Upload images, video, PDFs and documents to use on your site. Drop them here or use Upload media above.",
                    icon = AglynIcons.named("folder"),
                    action = emptyAction,
                  )
                }
              } else if (view == MediaView.LIST && !phone) {
                MediaListView(rows, visibleFolders, counts, selection, disabled, origin, edge, onFolder = { open(it) }, onFile = ::click)
              } else {
                BoxWithConstraints(
                  Modifier.fillMaxSize()
                    .focusRequester(focus)
                    .focusable()
                    .onPreviewKeyEvent { event ->
                      if (phone || event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                      when (event.key) {
                        Key.DirectionLeft -> { step(MediaGridMove.LEFT); true }
                        Key.DirectionRight -> { step(MediaGridMove.RIGHT); true }
                        Key.DirectionUp -> { step(MediaGridMove.UP); true }
                        Key.DirectionDown -> { step(MediaGridMove.DOWN); true }
                        Key.Enter -> { focusedFolder?.let { open(it) } ?: selectedItems.singleOrNull()?.let(::openFile); true }
                        Key.Escape -> { selection = emptySet(); true }
                        else -> false
                      }
                    },
                ) {
                  val width = maxWidth - edge * 2
                  val across = if (phone) 3 else ((width + metrics.gap) / (metrics.tileMinWidth + metrics.gap)).toInt().coerceAtLeast(1)
                  LaunchedEffect(across) { columns = across }
                  MediaGrid(
                    rows, visibleFolders, counts, across, phone, edge, selection, selecting, focusedFolder, disabled, origin, model.hasMore,
                    onLoadMore = model::loadMore, onFolder = { open(it) }, onFile = ::click,
                    folderMenu = { folder ->
                      if (canEdit) listOf(
                        MenuAction("new-subfolder", "New subfolder", "create_new_folder") { dialog = MediaDialog.NewFolder(folder.id) },
                        MenuAction("rename-folder", "Rename", "edit") { dialog = MediaDialog.RenameFolder(folder) },
                        MenuAction("delete-folder", "Delete", "delete", destructive = true) { dialog = MediaDialog.DeleteFolder(folder) },
                      ) else emptyList()
                    },
                  )
                }
              }
            }
          }
          MediaBanners(runner, uploading, undo, dialogOpen = dialog != null || bulkTag != null, edge, onUndo = { ids, names ->
            undo = null
            runner.run(mediaRestoredMessage(names), onDone = { model.refresh() }) { ids.forEach { api.restore(it) } }
          }, onDismissUndo = { undo = null })
          if (phone && selecting && selection.isNotEmpty()) {
            PhoneBulkBar(selection.size, folderList, foldersById, enabled = canEdit && !runner.busy, edge,
              onMove = { move(items.map { it.id }.filter { id -> id in selection }, it) }, onTag = { bulkTag = it }, onDelete = { bulkDeleting = true })
          }
        }
        if (!phone && selection.isNotEmpty()) {
          VerticalDivider()
          Box(Modifier.width(metrics.inspectorWidth).fillMaxHeight()) {
            if (selection.size == 1) {
              key(selection.first()) {
                MediaDetail(
                  context, scope, selection.first(), api, runner, folderList, foldersById, canEdit, onDeleted = onDeleted,
                  onChanged = { model.refresh() }, onClose = { selection = emptySet() },
                )
              }
            } else {
              MediaBulkPanel(
                selectedItems, origin, folderList, foldersById, enabled = canEdit && !runner.busy,
                onMove = { move(items.map { it.id }.filter { id -> id in selection }, it) },
                onTag = { runner.clear(); bulkTag = it }, onDelete = { bulkDeleting = true }, onClear = { selection = emptySet() },
              )
            }
          }
        }
      }
    }
  }

  MediaDialogs(dialog, api, runner, foldersById, onChanged = { model.refresh(); countsVersion++ }) { dialog = null }
  if (filtersOpen) {
    MediaFiltersDialog(context, model.filters, scoped = scopeTokens != null, onApply = { model.filter(it); filtersOpen = false }, onDismiss = { filtersOpen = false })
  }
  bulkTag?.let { add ->
    var tag by remember(add) { mutableStateOf("") }
    ActionDialog(
      title = if (add) "Add a tag to ${mediaFilesCount(selection.size)}" else "Remove a tag from ${mediaFilesCount(selection.size)}",
      icon = "label",
      confirmLabel = "Apply",
      confirmEnabled = tag.isNotBlank(),
      busy = runner.busy,
      error = runner.error,
      onDismiss = { bulkTag = null },
      onConfirm = { applyTag(tag, add) },
    ) {
      OutlinedTextField(tag, { tag = it }, label = { Text("Tag") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("media-bulk-tag"))
    }
  }
  if (bulkDeleting) {
    ActionDialog(
      title = "Delete ${mediaFilesCount(selection.size)}?",
      body = "The files are removed from storage, and pages that show them stop showing them. You can undo this right after.",
      icon = "delete",
      confirmLabel = "Delete",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = { bulkDeleting = false },
      onConfirm = ::deleteSelection,
    )
  }
  audioBatch?.let { files ->
    AudioRightsDialog(files) { confirmed ->
      audioBatch = null
      if (confirmed) sendFiles(files, true)
    }
  }
}

/**
 * The library's head (Figma Media 283:22621 / iPhone 285:7360): the title with its ☆, then New folder and the filled
 * Upload media; on a phone, both as 40 square buttons.
 */
@Composable
private fun MediaHead(phone: Boolean, compact: Boolean, edge: Dp, enabled: Boolean, onNewFolder: () -> Unit, sources: List<PickSource>, onUpload: (PickSource) -> Unit) {
  val star = LocalPageStar.current
  if (star != null) {
    DisposableEffect(star) {
      star.claimed = true
      onDispose { star.claimed = false }
    }
  }
  var sourcesOpen by remember { mutableStateOf(false) }
  val metrics = mediaMetrics(phone)
  Row(
    Modifier.fillMaxWidth().padding(start = edge, end = edge, top = space(1f), bottom = space(1.5f)),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(1f)),
  ) {
    Text(
      "Media",
      style = if (phone) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.headlineSmall.copy(fontSize = metrics.headTitle, lineHeight = metrics.headTitleLine),
      fontWeight = FontWeight.Bold,
      modifier = Modifier.semantics { heading() },
    )
    star?.star?.invoke()
    Box(Modifier.weight(1f))
    val upload = { if (sources.size == 1) onUpload(sources[0]) else sourcesOpen = true }
    if (phone) {
      SquareAction("create_new_folder", "New folder", filled = false, enabled = enabled, onClick = onNewFolder, modifier = Modifier.testTag("media-new-folder"))
      Box {
        SquareAction("upload", "Upload media", filled = true, enabled = enabled && sources.isNotEmpty(), onClick = upload, modifier = Modifier.testTag("media-upload"))
        UploadSources(sourcesOpen, sources, { sourcesOpen = false }, onUpload)
      }
    } else {
      CompactButton("New folder", "create_new_folder", onNewFolder, Modifier.testTag("media-new-folder"), enabled = enabled, tall = true)
      Box {
        CompactButton("Upload media", "upload", upload, Modifier.testTag("media-upload"), enabled = enabled && sources.isNotEmpty(), filled = true, tall = true)
        UploadSources(sourcesOpen, sources, { sourcesOpen = false }, onUpload)
      }
    }
  }
}

@Composable
private fun UploadSources(open: Boolean, sources: List<PickSource>, close: () -> Unit, onPick: (PickSource) -> Unit) {
  DropdownMenu(expanded = open, onDismissRequest = close) {
    for (source in sources) {
      val (label, icon) = pickSourceLabel(source)
      DropdownMenuItem(
        text = { Text(label) },
        leadingIcon = { Icon(AglynIcons.named(icon), null) },
        onClick = { close(); onPick(source) },
        modifier = Modifier.testTag("media-upload-${source.name.lowercase()}"),
      )
    }
  }
}

/** A phone title row's 40 square button (Figma 22:499): the upload filled with the accent, New folder bordered. */
@Composable
private fun SquareAction(icon: String, label: String, filled: Boolean, enabled: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
  val scheme = MaterialTheme.colorScheme
  val metrics = mediaMetrics(phone = true)
  val shape = RoundedCornerShape(LocalShellMetrics.current.controlRadius)
  Box(
    modifier.size(metrics.squareAction).alpha(if (enabled) 1f else metrics.disabledAlpha).clip(shape)
      .background(if (filled) scheme.primary else scheme.surface)
      .then(if (filled) Modifier else Modifier.border(metrics.hairline, scheme.outlineVariant, shape))
      .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
      .semantics { contentDescription = label },
    contentAlignment = Alignment.Center,
  ) {
    Icon(AglynIcons.named(icon), null, Modifier.size(metrics.squareIcon), tint = if (filled) scheme.onPrimary else scheme.onSurface)
  }
}

/** The list toolbar (Figma Toolbar/List): the search field and ONE Filter holding the type, the sort and More filters. */
@Composable
private fun MediaToolbar(model: MediaListModel, edge: Dp, onMoreFilters: () -> Unit, filtering: Boolean, onClear: () -> Unit) {
  val compactHead = LocalShellMetrics.current.compact || currentWidthClass() != WidthClass.COMPACT
  val metrics = mediaMetrics(phone = false)
  var open by remember { mutableStateOf(false) }
  val typeLabel = model.type?.let { type -> mediaTypeChoices().firstOrNull { it.first == type }?.second }
  val more = model.filters.count
  val active = when {
    more > 0 -> "Filters · ${more + if (typeLabel != null) 1 else 0}"
    typeLabel != null -> typeLabel
    else -> null
  }
  Row(
    Modifier.fillMaxWidth().padding(horizontal = edge).padding(bottom = space(1f)),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(1f)),
  ) {
    SearchField(model.search, model::type, placeholder = "Search files", modifier = Modifier.weight(1f).testTag("media-search"))
    Box {
      if (compactHead) {
        CompactButton(active ?: "Filter", "filter_list", { open = true }, Modifier.testTag("media-filter"))
      } else {
        OutlinedButton(onClick = { open = true }, shape = controlShape(), modifier = Modifier.testTag("media-filter")) {
          Icon(AglynIcons.named("filter_list"), contentDescription = null, Modifier.size(metrics.buttonIcon))
          Text(active ?: "Filter", Modifier.padding(start = space(0.75f)))
        }
      }
      DropdownMenu(open, onDismissRequest = { open = false }, modifier = Modifier.testTag("media-filter-menu")) {
        Text("Type", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = space(2f), vertical = space(0.75f)))
        for ((value, label) in mediaTypeChoices()) {
          DropdownMenuItem(
            text = { Text(label) },
            trailingIcon = { if (model.type == value) Icon(AglynIcons.named("check"), null) },
            onClick = { open = false; model.pick(value) },
            modifier = Modifier.testTag("media-type-${value ?: "all"}"),
          )
        }
        HorizontalDivider()
        Text("Sort", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = space(2f), vertical = space(0.75f)))
        for (sort in Contracts.mediaSorts.filter { it != MediaSort.UNKNOWN }) {
          DropdownMenuItem(
            text = { Text(Contracts.mediaSortLabels[sort.raw] ?: sort.raw) },
            trailingIcon = { if (model.sort == sort) Icon(AglynIcons.named("check"), null) },
            onClick = { open = false; model.order(sort) },
          )
        }
        HorizontalDivider()
        DropdownMenuItem(text = { Text(if (more == 0) "More filters…" else "More filters ($more)…") }, onClick = { open = false; onMoreFilters() }, modifier = Modifier.testTag("media-filters"))
        if (filtering) DropdownMenuItem(text = { Text("Clear filters") }, onClick = { open = false; onClear() })
      }
    }
  }
}

/**
 * The row over the grid (Figma Media · Path row): the library picker on a site's library, Back and the folder crumbs
 * ("All files › Catering"), Include subfolders inside a folder, Select on a touch screen, and Grid / List.
 */
@Composable
private fun MediaPathRow(
  library: LibraryPick?,
  crumbs: List<MediaFolder>,
  phone: Boolean,
  edge: Dp,
  onOpen: (String?) -> Unit,
  includeSubfolders: Boolean,
  onInclude: (Boolean) -> Unit,
  view: MediaView,
  onView: (MediaView) -> Unit,
  selecting: Boolean,
  onSelecting: (Boolean) -> Unit,
) {
  val compact = LocalShellMetrics.current.compact
  val metrics = mediaMetrics(phone)
  val height = metrics.button
  val shape = RoundedCornerShape(LocalShellMetrics.current.controlRadius)
  val scheme = MaterialTheme.colorScheme
  Row(
    Modifier.fillMaxWidth().padding(horizontal = edge).padding(bottom = space(1.5f)).heightIn(min = height),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(1f)),
  ) {
    if (library != null) {
      var open by remember { mutableStateOf(false) }
      Box {
        Row(
          Modifier.height(height).clip(shape).background(scheme.surface).border(metrics.hairline, scheme.outlineVariant, shape)
            .clickable(role = Role.Button) { open = true }.padding(start = space(1.25f), end = space(1f)).testTag("media-library"),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(space(0.5f)),
        ) {
          Text(if (library.index == 0) "This site" else "Workspace", fontSize = metrics.control, fontWeight = FontWeight.Medium)
          Icon(AglynIcons.named("expand_more"), null, Modifier.size(metrics.icon), tint = scheme.onSurfaceVariant)
        }
        DropdownMenu(open, onDismissRequest = { open = false }) {
          DropdownMenuItem(text = { Text("This site") }, trailingIcon = { if (library.index == 0) Icon(AglynIcons.named("check"), null) }, onClick = { open = false; library.pick(0) }, modifier = Modifier.testTag("media-tab-site"))
          DropdownMenuItem(text = { Text("Workspace") }, trailingIcon = { if (library.index == 1) Icon(AglynIcons.named("check"), null) }, onClick = { open = false; library.pick(1) }, modifier = Modifier.testTag("media-tab-org"))
        }
      }
    }
    if (crumbs.isNotEmpty() && !phone) {
      Box(
        Modifier.size(height).clip(shape).background(scheme.surface).border(metrics.hairline, scheme.outlineVariant, shape)
          .clickable(role = Role.Button) { onOpen(crumbs.dropLast(1).lastOrNull()?.id) }.semantics { contentDescription = "Back" }.testTag("media-back"),
        contentAlignment = Alignment.Center,
      ) { Icon(AglynIcons.named("chevron_left"), null, Modifier.size(metrics.icon)) }
    }
    Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(0.75f))) {
      val all = listOf<MediaFolder?>(null) + crumbs
      all.forEachIndexed { index, folder ->
        if (index > 0) Icon(AglynIcons.named("chevron_right"), null, Modifier.size(metrics.crumbChevron), tint = scheme.onSurfaceVariant)
        val last = index == all.lastIndex
        Text(
          folder?.name ?: "All files",
          fontSize = metrics.control,
          fontWeight = if (last) FontWeight.SemiBold else FontWeight.Medium,
          color = if (last) scheme.onSurface else scheme.onSurfaceVariant,
          maxLines = 1,
          modifier = Modifier.clickable(enabled = !last) { onOpen(folder?.id) }.testTag("media-crumb-${folder?.id ?: "all"}"),
        )
      }
    }
    if (crumbs.isNotEmpty() && !phone) {
      Row(Modifier.clickable { onInclude(!includeSubfolders) }.testTag("media-subfolders"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(0.75f))) {
        Checkbox(includeSubfolders, onInclude, Modifier.size(metrics.includeBox))
        Text("Include subfolders", fontSize = metrics.control)
      }
    }
    if (!compact) {
      TextButton(onClick = { onSelecting(!selecting) }, modifier = Modifier.testTag("media-select")) { Text(if (selecting) "Done" else "Select") }
    }
    if (!phone) {
      Row(Modifier.clip(shape).background(scheme.surfaceVariant).border(metrics.hairline, scheme.outlineVariant, shape).padding(metrics.ring), horizontalArrangement = Arrangement.spacedBy(metrics.ring)) {
        for ((mode, icon, label) in listOf(Triple(MediaView.GRID, "grid_view", "Grid"), Triple(MediaView.LIST, "view_list", "List"))) {
          val on = view == mode
          Box(
            Modifier.size(metrics.segment).clip(RoundedCornerShape(AglynTokens.RADIUS.dp))
              .background(if (on) scheme.surface else Color.Transparent).clickable { onView(mode) }
              .semantics { contentDescription = label; this.selected = on }.testTag("media-view-${label.lowercase()}"),
            contentAlignment = Alignment.Center,
          ) { Icon(AglynIcons.named(icon), null, Modifier.size(metrics.icon), tint = if (on) scheme.onSurface else scheme.onSurfaceVariant) }
        }
      }
    }
  }
}

/** The grid: the folders at this level, then the files, in [across] columns (folders two across on a phone). */
@Composable
private fun MediaGrid(
  rows: List<MediaItem>,
  folders: List<MediaFolder>,
  counts: Map<String, Long>,
  across: Int,
  phone: Boolean,
  edge: Dp,
  selection: Set<String>,
  selecting: Boolean,
  focusedFolder: String?,
  disabled: Map<String, MediaQuarantineNotice>,
  origin: String,
  hasMore: Boolean,
  onLoadMore: () -> Unit,
  onFolder: (String) -> Unit,
  onFile: (MediaItem) -> Unit,
  folderMenu: (MediaFolder) -> List<MenuAction>,
) {
  val metrics = mediaMetrics(phone)
  val gap = metrics.gap
  val grid = rememberLazyGridState()
  val nearEnd by remember(grid) { derivedStateOf { (grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= grid.layoutInfo.totalItemsCount - 6 } }
  LaunchedEffect(nearEnd, hasMore) { if (nearEnd && hasMore) onLoadMore() }
  // Folders take two of a phone's six tracks (two across) and one of three elsewhere's tracks; files one of three.
  val tracks = if (phone) 6 else across
  val folderSpan = if (phone) 3 else 1
  val fileSpan = if (phone) 2 else 1
  LazyVerticalGrid(
    GridCells.Fixed(tracks),
    Modifier.fillMaxSize().testTag("media-grid"),
    state = grid,
    contentPadding = PaddingValues(start = edge, end = edge, bottom = space(3f)),
    horizontalArrangement = Arrangement.spacedBy(gap),
    verticalArrangement = Arrangement.spacedBy(gap),
  ) {
    if (folders.isNotEmpty()) {
      item(span = { GridItemSpan(maxLineSpan) }) { GroupLabel("Folders", phone) }
      items(folders, key = { "folder:${it.id}" }, span = { GridItemSpan(folderSpan) }) { folder ->
        MediaFolderTile(folder.name, counts[folder.id], selected = focusedFolder == folder.id, phone = phone, menu = folderMenu(folder)) { onFolder(folder.id) }
      }
    }
    if (rows.isNotEmpty()) {
      item(span = { GridItemSpan(maxLineSpan) }) { GroupLabel("Files", phone, Modifier.padding(top = if (folders.isEmpty()) 0.dp else space(1f))) }
      items(rows, key = { it.id }, span = { GridItemSpan(fileSpan) }) { item ->
        val state = when {
          selecting -> if (item.id in selection) TileSelection.CHECKED else TileSelection.UNCHECKED
          selection.size > 1 -> if (item.id in selection) TileSelection.CHECKED else TileSelection.NONE
          item.id in selection -> TileSelection.SELECTED
          else -> TileSelection.NONE
        }
        MediaFileTile(item, item.thumbnail(origin), state, disabled = item.id in disabled, phone = phone) { onFile(item) }
      }
    }
    if (hasMore) item(span = { GridItemSpan(maxLineSpan) }) { SkeletonList(rows = 1) }
  }
}

@Composable
private fun GroupLabel(title: String, phone: Boolean, modifier: Modifier = Modifier) {
  Text(title, modifier.semantics { heading() }, fontSize = mediaMetrics(phone).groupLabel, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** How a file tile shows its selection (Figma Media/File tile, State). */
private enum class TileSelection { NONE, SELECTED, CHECKED, UNCHECKED }

/** A folder in the grid (Figma Media/Folder tile): the folder glyph, its name and how many files it holds. */
@Composable
private fun MediaFolderTile(name: String, count: Long?, selected: Boolean, phone: Boolean, menu: List<MenuAction>, onClick: () -> Unit) {
  val metrics = mediaMetrics(phone)
  val scheme = MaterialTheme.colorScheme
  val shape = RoundedCornerShape(metrics.tileRadius)
  Row(
    Modifier.fillMaxWidth().height(metrics.folderHeight).clip(shape).background(scheme.surface)
      .border(if (selected) metrics.ring else metrics.hairline, if (selected) scheme.primary else scheme.outlineVariant, shape)
      .clickable(role = Role.Button, onClick = onClick).padding(start = space(1.5f), end = space(0.5f)).testTag("media-folder-$name"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(1.25f)),
  ) {
    Icon(AglynIcons.named("folder_filled"), null, Modifier.size(metrics.folderSymbol), tint = scheme.primary)
    Column(Modifier.weight(1f)) {
      Text(name, fontSize = metrics.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(count?.let { mediaFilesCount(it.toInt()) } ?: " ", fontSize = metrics.caption, color = scheme.onSurfaceVariant, maxLines = 1)
    }
    if (menu.isNotEmpty() && !phone) OverflowMenu(menu, contentDescription = "Folder actions")
  }
}

/** A file in the grid (Figma Media/File tile): its whole preview on the sunken tile, then its name and "TYPE · size". */
@Composable
private fun MediaFileTile(item: MediaItem, thumbnail: String?, selection: TileSelection, disabled: Boolean, phone: Boolean, onClick: () -> Unit) {
  val metrics = mediaMetrics(phone)
  val scheme = MaterialTheme.colorScheme
  val shape = RoundedCornerShape(metrics.tileRadius)
  val ring = selection == TileSelection.SELECTED || selection == TileSelection.CHECKED
  Column(
    Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick)
      .semantics(mergeDescendants = true) { this.selected = ring }.testTag("media-${item.id}"),
  ) {
    Box(
      Modifier.fillMaxWidth().aspectRatio(metrics.previewAspect)
        .then(if (ring) Modifier.border(metrics.ring, scheme.primary, RoundedCornerShape(metrics.tileRadius + metrics.ring)).padding(metrics.ring) else Modifier)
        .clip(shape).border(metrics.hairline, scheme.outlineVariant, shape),
    ) {
      MediaPreview(item, thumbnail, Modifier.fillMaxSize())
      if (item.private || disabled) {
        Column(Modifier.align(Alignment.TopEnd).padding(space(0.75f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          // Not serving to anyone, so an error and not the Private advisory.
          if (disabled) StatusChip("Disabled", StatusTone.ERROR, Modifier.testTag("media-disabled-${item.id}")) else StatusChip("Private", StatusTone.WARNING)
        }
      }
      if (selection == TileSelection.CHECKED || selection == TileSelection.UNCHECKED) {
        Icon(
          AglynIcons.named(if (selection == TileSelection.CHECKED) "check_box" else "check_box_outline_blank"), null,
          Modifier.align(Alignment.TopStart).padding(space(0.75f)).size(metrics.checkbox).background(scheme.surface, RoundedCornerShape(AglynTokens.RADIUS.dp)),
          tint = if (selection == TileSelection.CHECKED) scheme.primary else scheme.onSurfaceVariant,
        )
      }
    }
    Text(
      item.fileName,
      Modifier.padding(top = metrics.nameGap),
      fontSize = metrics.name,
      fontWeight = FontWeight.Medium,
      maxLines = 1,
      overflow = TextOverflow.MiddleEllipsis,
    )
    Text(item.caption, fontSize = metrics.caption, color = scheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

/**
 * A file's preview, whole (fitted) on the sunken ground; the file's type icon and label while there is none, while it
 * loads, or when it cannot. A film with a poster carries a play badge.
 */
@Composable
internal fun MediaPreview(item: MediaItem, url: String?, modifier: Modifier = Modifier, glyph: Dp = mediaMetrics(phone = false).glyphTile) {
  val scheme = MaterialTheme.colorScheme
  val metrics = mediaMetrics(phone = false)
  val bitmap = rememberRemoteBitmap(url)
  Box(modifier.background(scheme.surfaceVariant), contentAlignment = Alignment.Center) {
    if (bitmap != null) {
      Image(bitmap, item.alt.ifBlank { item.fileName }, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
    } else {
      val (icon, label) = mediaFileType(item.contentType)
      Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        Icon(AglynIcons.named(icon), null, Modifier.size(glyph), tint = scheme.onSurfaceVariant)
        if (glyph >= metrics.labelledGlyph) Text(label, fontSize = metrics.typeLabel, fontWeight = FontWeight.SemiBold, letterSpacing = metrics.typeTracking, color = scheme.onSurfaceVariant)
      }
    }
    if (item.kind == "video" && url != null) {
      Box(Modifier.size(metrics.playBadge).clip(CircleShape).background(scheme.scrim.copy(alpha = metrics.scrimAlpha)), contentAlignment = Alignment.Center) {
        Icon(AglynIcons.named("play_arrow"), null, Modifier.size(metrics.playIcon), tint = OnMediaScrim)
      }
    }
  }
}

/** The list view (the console's List view): folders, then a row per file with its type, size and when it was added. */
@Composable
private fun MediaListView(
  rows: List<MediaItem>,
  folders: List<MediaFolder>,
  counts: Map<String, Long>,
  selection: Set<String>,
  disabled: Map<String, MediaQuarantineNotice>,
  origin: String,
  edge: Dp,
  onFolder: (String) -> Unit,
  onFile: (MediaItem) -> Unit,
) {
  val scheme = MaterialTheme.colorScheme
  val metrics = mediaMetrics(phone = false)
  val now = remember { nowMillis() }
  val rowShape = RoundedCornerShape(metrics.rowRadius)
  LazyColumn(Modifier.fillMaxSize().testTag("media-list"), contentPadding = PaddingValues(start = edge - space(1f), end = edge - space(1f), bottom = space(3f))) {
    item {
      Row(Modifier.fillMaxWidth().padding(horizontal = space(1f), vertical = space(0.5f)), horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
        Text("Name", Modifier.weight(1f).padding(start = metrics.rowThumb.width + space(1.5f)), fontSize = metrics.groupLabel, fontWeight = FontWeight.SemiBold, color = scheme.onSurfaceVariant)
        Text("Type", Modifier.width(metrics.typeColumn), fontSize = metrics.groupLabel, fontWeight = FontWeight.SemiBold, color = scheme.onSurfaceVariant)
        Text("Size", Modifier.width(metrics.sizeColumn), fontSize = metrics.groupLabel, fontWeight = FontWeight.SemiBold, color = scheme.onSurfaceVariant, textAlign = TextAlign.End)
        Text("Added", Modifier.width(metrics.addedColumn), fontSize = metrics.groupLabel, fontWeight = FontWeight.SemiBold, color = scheme.onSurfaceVariant, textAlign = TextAlign.End)
      }
    }
    items(folders, key = { "folder:${it.id}" }) { folder ->
      Row(Modifier.fillMaxWidth().heightIn(min = metrics.rowHeight).clip(rowShape).clickable { onFolder(folder.id) }.padding(horizontal = space(1f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
        Box(Modifier.size(metrics.rowThumb), contentAlignment = Alignment.Center) { Icon(AglynIcons.named("folder_filled"), null, Modifier.size(metrics.rowFolderSymbol), tint = scheme.primary) }
        Text(folder.name, Modifier.weight(1f), fontSize = metrics.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(counts[folder.id]?.let { mediaFilesCount(it.toInt()) }.orEmpty(), fontSize = metrics.caption, color = scheme.onSurfaceVariant)
      }
    }
    items(rows, key = { it.id }) { item ->
      val selected = item.id in selection
      Row(
        Modifier.fillMaxWidth().heightIn(min = metrics.rowHeight).clip(rowShape)
          .background(if (selected) shellColors.selected else Color.Transparent)
          .clickable { onFile(item) }.padding(horizontal = space(1f)).testTag("media-${item.id}"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(space(1.5f)),
      ) {
        MediaPreview(item, item.thumbnail(origin, metrics.cdnRow), Modifier.size(metrics.rowThumb).clip(RoundedCornerShape(metrics.rowThumbRadius)), glyph = metrics.glyphRow)
        Text(item.fileName, Modifier.weight(1f), fontSize = metrics.name, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
        if (item.id in disabled) StatusChip("Disabled", StatusTone.ERROR) else if (item.private) StatusChip("Private", StatusTone.WARNING)
        Text(item.typeLabel, Modifier.width(metrics.typeColumn), fontSize = metrics.caption, color = scheme.onSurfaceVariant)
        Text(formatBytes(item.sizeBytes ?: 0), Modifier.width(metrics.sizeColumn), fontSize = metrics.caption, color = scheme.onSurfaceVariant, textAlign = TextAlign.End)
        Text(item.createdAt?.let { relativeTime(it.epochMillis, now) } ?: "—", Modifier.width(metrics.addedColumn), fontSize = metrics.caption, color = scheme.onSurfaceVariant, textAlign = TextAlign.End)
      }
    }
  }
}

/** What the panel shows while several files are selected (the console's selection bar). */
@Composable
private fun MediaBulkPanel(
  items: List<MediaItem>,
  origin: String,
  folders: List<MediaFolder>,
  byId: Map<String, MediaFolder>,
  enabled: Boolean,
  onMove: (String?) -> Unit,
  onTag: (Boolean) -> Unit,
  onDelete: () -> Unit,
  onClear: () -> Unit,
) {
  var moving by remember { mutableStateOf(false) }
  val metrics = mediaMetrics(phone = false)
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = space(3f), end = space(3f), bottom = space(3f)).testTag("media-bulk"), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text("${items.size} selected", Modifier.weight(1f).semantics { heading() }, fontSize = metrics.panelTitle, fontWeight = FontWeight.SemiBold)
      AglynIconButton(AglynIcons.named("close"), "Clear", onClick = onClear, modifier = Modifier.testTag("media-bulk-clear"))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      items.take(3).forEach { item ->
        MediaPreview(item, item.thumbnail(origin), Modifier.weight(1f).aspectRatio(metrics.previewAspect).clip(RoundedCornerShape(LocalShellMetrics.current.controlRadius)), glyph = metrics.glyphBulk)
      }
      repeat(3 - items.take(3).size) { Box(Modifier.weight(1f)) }
    }
    Box {
      OutlinedButton(onClick = { moving = true }, enabled = enabled, shape = controlShape(), modifier = Modifier.fillMaxWidth().testTag("media-bulk-move")) {
        Icon(AglynIcons.named("drive_file_move"), null, Modifier.size(metrics.icon)); Text("Move to folder…", Modifier.padding(start = space(0.75f)))
      }
      DropdownMenu(moving, onDismissRequest = { moving = false }) {
        DropdownMenuItem(text = { Text("No folder") }, onClick = { moving = false; onMove(null) })
        if (folders.isNotEmpty()) HorizontalDivider()
        for (folder in folders.sortedBy { folderPath(it, byId).lowercase() }) {
          DropdownMenuItem(text = { Text(folderPath(folder, byId)) }, onClick = { moving = false; onMove(folder.id) })
        }
      }
    }
    OutlinedButton(onClick = { onTag(true) }, enabled = enabled, shape = controlShape(), modifier = Modifier.fillMaxWidth().testTag("media-bulk-add-tag")) {
      Icon(AglynIcons.named("label"), null, Modifier.size(metrics.icon)); Text("Add tag…", Modifier.padding(start = space(0.75f)))
    }
    OutlinedButton(onClick = { onTag(false) }, enabled = enabled, shape = controlShape(), modifier = Modifier.fillMaxWidth().testTag("media-bulk-remove-tag")) {
      Icon(AglynIcons.named("label_off"), null, Modifier.size(metrics.icon)); Text("Remove tag…", Modifier.padding(start = space(0.75f)))
    }
    Button(
      onClick = onDelete, enabled = enabled, shape = controlShape(),
      colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
      modifier = Modifier.fillMaxWidth().testTag("media-bulk-delete"),
    ) {
      Icon(AglynIcons.named("delete"), null, Modifier.size(metrics.icon)); Text("Delete…", Modifier.padding(start = space(0.75f)))
    }
  }
}

/** A phone's bulk actions while picking several: how many, and the console's actions in one menu. */
@Composable
private fun PhoneBulkBar(count: Int, folders: List<MediaFolder>, byId: Map<String, MediaFolder>, enabled: Boolean, edge: Dp, onMove: (String?) -> Unit, onTag: (Boolean) -> Unit, onDelete: () -> Unit) {
  var open by remember { mutableStateOf(false) }
  var moving by remember { mutableStateOf(false) }
  val metrics = mediaMetrics(phone = true)
  Surface(
    Modifier.fillMaxWidth().padding(horizontal = edge, vertical = space(1f)), shape = RoundedCornerShape(LocalShellMetrics.current.cardRadius),
    color = MaterialTheme.colorScheme.surface, border = BorderStroke(metrics.hairline, MaterialTheme.colorScheme.outlineVariant),
  ) {
    Row(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalAlignment = Alignment.CenterVertically) {
      Text("$count selected", Modifier.weight(1f), fontSize = metrics.panelTitle, fontWeight = FontWeight.SemiBold)
      Box {
        TextButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.testTag("media-bulk-menu")) { Text("Actions") }
        DropdownMenu(open, onDismissRequest = { open = false }) {
          DropdownMenuItem(text = { Text("Move to folder…") }, onClick = { open = false; moving = true })
          DropdownMenuItem(text = { Text("Add tag…") }, onClick = { open = false; onTag(true) })
          DropdownMenuItem(text = { Text("Remove tag…") }, onClick = { open = false; onTag(false) })
          HorizontalDivider()
          DropdownMenuItem(text = { Text("Delete…", color = MaterialTheme.colorScheme.error) }, onClick = { open = false; onDelete() })
        }
        DropdownMenu(moving, onDismissRequest = { moving = false }) {
          DropdownMenuItem(text = { Text("No folder") }, onClick = { moving = false; onMove(null) })
          for (folder in folders.sortedBy { folderPath(it, byId).lowercase() }) {
            DropdownMenuItem(text = { Text(folderPath(folder, byId)) }, onClick = { moving = false; onMove(folder.id) })
          }
        }
      }
    }
  }
}

/** Under the grid: the upload's progress, the undo after a delete, and the runner's error or notice. */
@Composable
private fun MediaBanners(
  runner: ActionRunner,
  uploading: Triple<Int, Int, String>?,
  undo: Pair<List<String>, List<String>>?,
  dialogOpen: Boolean,
  edge: Dp,
  onUndo: (List<String>, List<String>) -> Unit,
  onDismissUndo: () -> Unit,
) {
  Column(Modifier.padding(horizontal = edge).padding(bottom = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    uploading?.let { (done, total, name) ->
      Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(mediaMetrics(phone = false).tileRadius)).background(shellColors.selected)
          .padding(horizontal = space(1.75f), vertical = space(1.25f)).testTag("media-uploading"),
        verticalArrangement = Arrangement.spacedBy(space(1f)),
      ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          Icon(AglynIcons.named("upload"), null, Modifier.size(mediaMetrics(phone = false).icon))
          Text(if (total == 1) "Uploading $name…" else "Uploading ${done + 1} of $total…", fontSize = mediaMetrics(phone = false).control, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        LinearProgressIndicator(progress = { done.toFloat() / total.coerceAtLeast(1) }, Modifier.fillMaxWidth())
      }
    }
    undo?.let { (ids, names) ->
      NoticeBanner(mediaDeletedMessage(names), StatusTone.NEUTRAL, Modifier.testTag("media-undo"), action = {
        Row {
          TextButton(onClick = { onUndo(ids, names) }) { Text("Undo") }
          TextButton(onClick = onDismissUndo) { Text("Dismiss") }
        }
      })
    }
    if (!dialogOpen) {
      runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
      runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
    }
  }
}

/**
 * The rights confirmation an audio upload needs (AGL-3716), asked once for a batch: every audio file in it is named, and
 * the one sentence the uploader ticks is the sentence the server stores beside who ticked it and when. Upload stays off
 * until it is ticked, and the box starts unticked every time.
 */
@Composable
internal fun AudioRightsDialog(files: List<PickedFile>, onAnswer: (Boolean) -> Unit) {
  val names = files.filter(::isAudioFile).map { it.name }
  var confirmed by remember(files) { mutableStateOf(false) }
  ActionDialog(
    title = "Confirm your rights to this audio",
    body = (if (names.size == 1) "You are uploading \"${names[0]}\"." else "You are uploading ${names.size} audio files: ${names.joinToString(", ")}.") +
      " Only upload music you made, or have a license to publish. Tracks by other artists cannot be played on your site without their permission, and are taken down when the rights holder reports them.",
    icon = "music_note",
    confirmLabel = "Upload",
    confirmEnabled = confirmed,
    dismissLabel = "Cancel",
    onDismiss = { onAnswer(false) },
    onConfirm = { onAnswer(true) },
    modifier = Modifier.testTag("audio-rights"),
  ) {
    SwitchRow(AUDIO_RIGHTS_STATEMENT, confirmed, { confirmed = it }, Modifier.testTag("audio-rights-confirm"))
  }
}

/**
 * The library's other filters, the console's Filters panel in a dialog:
 * orientation, alt text, a tag (not for a reader limited to some sites, whose
 * scope holds the query's one array clause) and a size range in megabytes.
 */
@Composable
private fun MediaFiltersDialog(context: NativePluginContext, filters: MediaFilters, scoped: Boolean, onApply: (MediaFilters) -> Unit, onDismiss: () -> Unit) {
  var draft by remember { mutableStateOf(filters) }
  val uploaders by produceState(emptyList<UploaderOption>(), context.orgId) { value = context.orgId?.let { uploaderOptions(context.api, it) }.orEmpty() }
  ActionDialog(
    title = "Filters",
    icon = "filter_list",
    confirmLabel = "Apply",
    dismissLabel = "Cancel",
    onConfirm = { onApply(draft) },
    onDismiss = onDismiss,
  ) {
    SelectField(
      Contracts.mediaFilterHeaders["orientation"] ?: "Orientation",
      Contracts.mediaOrientationOptions.map { SelectOption(it.value, it.label) },
      draft.orientation,
      { draft = draft.copy(orientation = it) },
      noneLabel = "Any",
    )
    SelectField(
      Contracts.mediaFilterHeaders["alt"] ?: "Alt text",
      Contracts.mediaAltOptions.map { SelectOption(it.value, it.label) },
      draft.alt,
      { draft = draft.copy(alt = it) },
      noneLabel = "Any",
    )
    if (!scoped) {
      CountedTextField(
        Contracts.mediaFilterHeaders["tags"]?.removeSuffix("s") ?: "Tag",
        draft.tag,
        { draft = draft.copy(tag = it) },
        max = Contracts.mediaTagMaxLength.toInt(),
        supporting = "Files with this tag.",
        modifier = Modifier.testTag("media-filter-tag"),
      )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      CountedTextField("At least (MB)", draft.minMegabytes, { draft = draft.copy(minMegabytes = megabytesInput(it)) }, keyboardType = KeyboardType.Decimal, modifier = Modifier.weight(1f).testTag("media-filter-min"))
      CountedTextField("At most (MB)", draft.maxMegabytes, { draft = draft.copy(maxMegabytes = megabytesInput(it)) }, keyboardType = KeyboardType.Decimal, modifier = Modifier.weight(1f).testTag("media-filter-max"))
    }
    FieldEditor(FieldSpec("uploadedAfter", "Uploaded on or after", FieldKind.DATE), draft.uploadedAfter, { draft = draft.copy(uploadedAfter = it) })
    FieldEditor(FieldSpec("uploadedBefore", "Uploaded on or before", FieldKind.DATE), draft.uploadedBefore, { draft = draft.copy(uploadedBefore = it) })
    // Anyone who uploaded something, from the workspace's members; a key's uploads and a former member's are kept as they were asked.
    val choices = (uploaders.map { SelectOption(it.uid, it.label) } + listOfNotNull(draft.uploadedBy?.takeIf { id -> uploaders.none { it.uid == id } }?.let { SelectOption(it, if (it.startsWith("api:")) "API key" else it) }))
    SelectField(Contracts.mediaFilterHeaders["uploadedBy"] ?: "Uploaded by", choices, draft.uploadedBy, { draft = draft.copy(uploadedBy = it) }, noneLabel = "Anyone")
    TextButton(onClick = { draft = MediaFilters() }, enabled = draft.count > 0) { Text("Clear all") }
  }
}

@Composable
internal fun MediaTile(item: MediaItem, origin: String, selected: Boolean, disabled: Boolean = false, onClick: () -> Unit) {
  Surface(
    Modifier.clip(MaterialTheme.shapes.medium).clickable(onClick = onClick).testTag("media-${item.id}"),
    shape = MaterialTheme.shapes.medium,
    color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow,
    tonalElevation = if (selected) 2.dp else 0.dp,
  ) {
    Column {
      Box {
        RemoteImage(item.thumbnail(origin), item.alt.ifBlank { item.fileName }, Modifier.fillMaxWidth().aspectRatio(1f), icon = mediaKindIcon(item.kind))
        if (item.private || disabled) {
          Column(Modifier.padding(space(0.5f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
            if (item.private) StatusChip("Private", StatusTone.WARNING)
            // Not serving to anyone, so an error and not the Private advisory beside it.
            if (disabled) StatusChip("Disabled", StatusTone.ERROR, Modifier.testTag("media-disabled-${item.id}"))
          }
        }
      }
      Text(
        item.fileName,
        Modifier.padding(horizontal = space(1f), vertical = space(0.75f)),
        style = MaterialTheme.typography.labelMedium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
}

private sealed interface MediaDialog {
  data class NewFolder(val parentId: String?) : MediaDialog
  data class RenameFolder(val folder: MediaFolder) : MediaDialog
  data class DeleteFolder(val folder: MediaFolder) : MediaDialog
}

@Composable
private fun MediaDialogs(dialog: MediaDialog?, api: MediaApi, runner: ActionRunner, byId: Map<String, MediaFolder>, onChanged: () -> Unit, close: () -> Unit) {
  val max = Contracts.mediaFolderNameMaxLength.toInt()
  when (dialog) {
    null -> Unit
    is MediaDialog.NewFolder -> {
      var name by remember { mutableStateOf("") }
      ActionDialog(
        title = "New folder",
        body = dialog.parentId?.let { byId[it] }?.let { "Inside ${folderPath(it, byId)}." },
        icon = "folder",
        confirmLabel = "Create folder",
        confirmEnabled = name.isNotBlank(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = { runner.run("Folder ${name.trim()} added.", onDone = close) { api.createFolder(name.trim(), dialog.parentId) } },
      ) {
        OutlinedTextField(name, { name = it.take(max) }, label = { Text("Folder name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("folder-name"))
      }
    }
    is MediaDialog.RenameFolder -> {
      var name by remember(dialog) { mutableStateOf(dialog.folder.name) }
      ActionDialog(
        title = "Rename folder",
        icon = "edit",
        confirmLabel = "Save",
        confirmEnabled = name.isNotBlank() && name.trim() != dialog.folder.name,
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = { runner.run("Folder renamed.", onDone = { close(); onChanged() }) { api.renameFolder(dialog.folder.id, name.trim()) } },
      ) {
        OutlinedTextField(name, { name = it.take(max) }, label = { Text("Folder name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      }
    }
    is MediaDialog.DeleteFolder -> ActionDialog(
      title = "Delete ${dialog.folder.name}?",
      body = "Its files and folders move up a level. No file is deleted.",
      icon = "delete",
      confirmLabel = "Delete folder",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = close,
      onConfirm = { runner.run("Folder deleted.", onDone = { close(); onChanged() }) { api.deleteFolder(dialog.folder.id) } },
    )
  }
}

/** One file's details: preview, facts, the editable fields, and its actions. */
@Composable
private fun MediaDetail(
  context: NativePluginContext,
  scope: MediaScope,
  mediaId: String,
  api: MediaApi,
  runner: ActionRunner,
  folders: List<MediaFolder>,
  foldersById: Map<String, MediaFolder>,
  canEdit: Boolean,
  onDeleted: (id: String, name: String, restorable: Boolean) -> Unit,
  onChanged: () -> Unit,
  /** Closes the details beside the grid; null where they fill the screen. */
  onClose: (() -> Unit)? = null,
) {
  val live by remember(scope, mediaId, context.firestore) { context.firestore.observeDoc("${scope.path}/media/$mediaId") }.collectAsState(Live.Loading)
  // A deleted file closes its detail; the library already dropped it and offers the undo.
  CloseWhenGone((live as? Live.Ready)?.let { ready -> ready.value?.let(MediaItem::from) != null })
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this file", body = "Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
    is Live.Ready -> {
      val item = value.value?.let(MediaItem::from)
      if (item == null) {
        EmptyState("This file is gone", body = "It may have been deleted.", icon = AglynIcons.named("photo_library"))
      } else {
        MediaDetailBody(context, scope, item, api, runner, folders, foldersById, canEdit, onDeleted, onChanged, onClose)
      }
    }
  }
}

@Composable
private fun MediaDetailBody(
  context: NativePluginContext,
  scope: MediaScope,
  item: MediaItem,
  api: MediaApi,
  runner: ActionRunner,
  folders: List<MediaFolder>,
  foldersById: Map<String, MediaFolder>,
  canEdit: Boolean,
  onDeleted: (id: String, name: String, restorable: Boolean) -> Unit,
  onChanged: () -> Unit,
  onClose: (() -> Unit)? = null,
) {
  val origin = context.api.origin
  val clipboard = LocalClipboardManager.current
  val uri = LocalUriHandler.current
  val picker = LocalMediaPicker.current
  val imageLoader = LocalImageLoader.current
  val coroutines = rememberCoroutineScope()
  var editingImage by remember(item.id) { mutableStateOf(false) }
  var fileName by remember(item.id, item.fileName) { mutableStateOf(item.fileName) }
  var alt by remember(item.id, item.alt) { mutableStateOf(item.alt) }
  var description by remember(item.id, item.description) { mutableStateOf(item.description) }
  var tags by remember(item.id, item.tags) { mutableStateOf(item.tags.joinToString(", ")) }
  var moving by remember(item.id) { mutableStateOf(false) }
  var audioReplacement by remember(item.id) { mutableStateOf<PickedFile?>(null) }
  var deleting by remember(item.id) { mutableStateOf(false) }
  var references by remember(item.id) { mutableStateOf<List<MediaReference>?>(null) }
  val altMax = Contracts.mediaAltMaxLength.toInt()
  val dirty = fileName.trim() != item.fileName || alt.trim() != item.alt || description.trim() != item.description ||
    tags.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() } != item.tags
  val now = remember(item.updatedAt) { nowMillis() }
  val orgWideEditor = scope !is MediaScope.Org || context.orgRole in setOf("owner", "admin")
  val disabled by produceState<MediaQuarantineNotice?>(null, api, item.id) { value = api.quarantine(listOf(item.id))[item.id] }

  val actions = listOf(
    MenuAction("move", "Move to folder", "drive_file_move", enabled = canEdit) { moving = true },
    MenuAction("delete", "Delete file", "delete", destructive = true, enabled = canEdit) { deleting = true },
  )
  // Beside the grid the details pad to the panel's 24; filling the screen, to the column's content edge.
  val metrics = mediaMetrics(phone = false)
  val side = if (onClose != null) space(3f) else contentInset()
  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = side, end = side, top = if (onClose != null) 0.dp else space(2f), bottom = space(3f)).testTag("media-detail"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    if (onClose != null) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(0.75f))) {
        Text(item.fileName, Modifier.weight(1f).semantics { heading() }, fontSize = metrics.panelTitle, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
        OverflowMenu(actions, boxed = true)
        AglynIconButton(AglynIcons.named("close"), "Close", onClick = onClose, modifier = Modifier.testTag("media-close"))
      }
    }
    disabled?.let { NoticeBanner("${it.title}. ${it.message}", StatusTone.ERROR, Modifier.testTag("media-quarantine")) }
    Column(verticalArrangement = Arrangement.spacedBy(space(2f))) {
      MediaPreview(
        item, item.thumbnail(origin, metrics.cdnInspector),
        Modifier.fillMaxWidth().aspectRatio(metrics.previewAspect).clip(RoundedCornerShape(metrics.tileRadius))
          .border(metrics.hairline, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(metrics.tileRadius)),
        glyph = metrics.glyphInspector,
      )
      if (onClose == null) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text(item.fileName, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
          OverflowMenu(actions)
        }
      }
      Text(
        listOfNotNull(formatBytes(item.sizeBytes), if (item.width != null && item.height != null) "${item.width} × ${item.height} px" else null, item.contentType.ifBlank { null }, item.createdAt?.let { "Added " + relativeTime(it.epochMillis, now) }).joinToString(" · "),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        if (!item.private) {
          item.src(origin)?.let { src ->
            OutlinedButton(onClick = { clipboard.setText(AnnotatedString(src)); runner.notice = "Link copied." }, modifier = Modifier.testTag("media-copy-link")) {
              Icon(AglynIcons.named("link"), contentDescription = null)
              Text("Copy link", Modifier.padding(start = space(1f)))
            }
          }
        }
        OutlinedButton(
          onClick = {
            if (item.private && scope is MediaScope.Org) {
              runner.run { api.signedLink(item.id)?.let(uri::openUri) }
            } else {
              (item.src(origin))?.let(uri::openUri)
            }
          },
          modifier = Modifier.testTag("media-open"),
        ) {
          Icon(AglynIcons.named("download"), contentDescription = null)
          Text("Open file", Modifier.padding(start = space(1f)))
        }
        if (picker != null) {
          OutlinedButton(
            onClick = {
              coroutines.launch {
                val picked = runCatching { picker.pick(PickSource.FILES, multiple = false) }.getOrDefault(emptyList()).firstOrNull() ?: return@launch
                // An audio file needs its uploader's rights confirmation first (AGL-3716).
                if (isAudioFile(picked)) audioReplacement = picked else runner.run("File replaced. Everywhere it is used now shows the new file.", onDone = onChanged) { api.replace(item, picked) }
              }
            },
            enabled = canEdit && !runner.busy,
            modifier = Modifier.testTag("media-replace"),
          ) { Text("Replace file") }
        }
        // Rotate, flip, crop and shrink are for pictures only: there is nothing to crop in a PDF.
        if (item.contentType.startsWith("image/")) {
          OutlinedButton(onClick = { runner.clear(); editingImage = true }, enabled = canEdit && !runner.busy, modifier = Modifier.testTag("media-edit-image")) {
            Icon(AglynIcons.named("edit"), contentDescription = null)
            Text("Edit image", Modifier.padding(start = space(1f)))
          }
        }
      }
      if (orgWideEditor) {
        SwitchRow(
          "Private",
          item.private,
          { next -> runner.run(if (next) "Only signed-in members can open it now." else "Anyone with the link can open it now.") { api.setPrivate(item.id, next) } },
          supporting = "A private file has no public link; pages cannot show it.",
          enabled = canEdit && !runner.busy,
          modifier = Modifier.testTag("media-private"),
        )
      }
    }
    if (editingImage) {
      ImageEditorDialog(
        fileName = item.fileName,
        // The file itself, not the display copy the library shows: "Replace original" must not save a shrunken copy over it.
        loadOriginal = {
          val url = if (item.private && scope is MediaScope.Org) api.signedLink(item.id) else item.src(origin)?.let(::mediaOriginalSrc)
          url?.let { imageLoader?.load(it) }
        },
        busy = runner.busy,
        error = runner.error,
        onDismiss = { editingImage = false },
        onSave = { file, asCopy ->
          if (asCopy) {
            runner.run("Saved an edited copy.", onDone = { editingImage = false; onChanged() }) { api.upload(file, item.folderId) }
          } else {
            runner.run("Image replaced. Everywhere it is used now shows the edited image.", onDone = { editingImage = false; onChanged() }) { api.replace(item, file) }
          }
        },
      )
    }
    audioReplacement?.let { file ->
      AudioRightsDialog(listOf(file)) { confirmed ->
        audioReplacement = null
        if (confirmed) runner.run("File replaced. Everywhere it is used now shows the new file.", onDone = onChanged) { api.replace(item, file, rightsConfirmed = true) }
      }
    }
    HorizontalDivider()
    Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      Text("Details", Modifier.semantics { heading() }, fontSize = metrics.groupLabel, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
      OutlinedTextField(fileName, { fileName = it.take(200) }, label = { Text("File name") }, supportingText = { Text("Display name only — the link stays the same.") }, singleLine = true, enabled = canEdit, modifier = Modifier.fillMaxWidth().testTag("media-file-name"))
      OutlinedTextField(alt, { alt = it.take(altMax) }, label = { Text("Alt text") }, supportingText = { Text("Describes the image for screen readers and search. ${alt.length}/$altMax") }, enabled = canEdit, modifier = Modifier.fillMaxWidth().testTag("media-alt"))
      OutlinedTextField(description, { description = it }, label = { Text("Description") }, enabled = canEdit, modifier = Modifier.fillMaxWidth())
      OutlinedTextField(tags, { tags = it }, label = { Text("Tags") }, supportingText = { Text("Separate tags with commas.") }, singleLine = true, enabled = canEdit, modifier = Modifier.fillMaxWidth().testTag("media-tags"))
      Row(
        Modifier.fillMaxWidth().clickable(enabled = canEdit) { moving = true }.padding(vertical = space(0.5f)).testTag("media-folder"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(space(1f)),
      ) {
        Text("Folder", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(item.folderId?.let { foldersById[it] }?.let { folderPath(it, foldersById) } ?: "Not in a folder", maxLines = 1, overflow = TextOverflow.Ellipsis)
        Icon(AglynIcons.named("chevron_right"), null, Modifier.size(metrics.icon), tint = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Button(
          onClick = {
            runner.run("Details saved.") {
              api.saveDetails(item.id, fileName.trim(), alt.trim(), description.trim(), tags.split(',').map { it.trim() }.filter { it.isNotEmpty() })
            }
          },
          enabled = canEdit && dirty && fileName.isNotBlank() && !runner.busy,
          modifier = Modifier.testTag("media-save"),
        ) { Text("Save") }
        if (dirty) TextButton(onClick = { fileName = item.fileName; alt = item.alt; description = item.description; tags = item.tags.joinToString(", ") }) { Text("Discard") }
      }
    }
    HorizontalDivider()
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Used on", Modifier.weight(1f).semantics { heading() }, fontSize = metrics.groupLabel, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = { runner.run { references = api.references(item.id) } }, enabled = !runner.busy, modifier = Modifier.testTag("media-references")) {
          Text(if (references == null) "Check" else "Check again")
        }
      }
      when (val found = references) {
        null -> Text("See which pages and components show this file.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> if (found.isEmpty()) {
          Text("Nothing uses this file yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
          found.forEach { reference ->
            AglynListItem(
              title = reference.name,
              supporting = reference.kind.replaceFirstChar { it.uppercase() },
              icon = AglynIcons.named("description"),
              trailing = { if (reference.live) StatusChip("Live", StatusTone.SUCCESS) },
            )
          }
        }
      }
    }
  }

  if (moving) {
    var target by remember { mutableStateOf(item.folderId) }
    ActionDialog(
      title = "Move to folder",
      icon = "drive_file_move",
      confirmLabel = "Move",
      confirmEnabled = target != item.folderId,
      busy = runner.busy,
      error = runner.error,
      onDismiss = { moving = false },
      onConfirm = { runner.run("Moved.", onDone = { moving = false; onChanged() }) { api.move(listOf(item.id), target) } },
    ) {
      LazyColumn(Modifier.fillMaxWidth().heightIn(max = metrics.pickerMaxHeight)) {
        item { AglynListItem("Not in a folder", icon = AglynIcons.named("folder_open"), trailing = { RadioButton(target == null, null) }, onClick = { target = null }) }
        items(folders.sortedBy { folderPath(it, foldersById).lowercase() }, key = { it.id }) { folder ->
          AglynListItem(folderPath(folder, foldersById), icon = AglynIcons.named("folder"), trailing = { RadioButton(target == folder.id, null) }, onClick = { target = folder.id })
        }
      }
    }
  }
  if (deleting) {
    ActionDialog(
      title = "Delete ${item.fileName}?",
      body = "Pages that show it stop showing it. You can undo this right after.",
      icon = "delete",
      confirmLabel = "Delete",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = { deleting = false },
      onConfirm = {
        runner.run(onDone = { deleting = false }) {
          val restorable = api.delete(item.id)
          onDeleted(item.id, item.fileName, restorable)
        }
      },
    )
  }
}

