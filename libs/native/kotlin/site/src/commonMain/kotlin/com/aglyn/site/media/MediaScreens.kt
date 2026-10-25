package com.aglyn.site.media

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
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
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
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.CloseWhenGone
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.CountedTextField
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.ListHeader
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
import com.aglyn.ui.SelectionPlaceholder
import com.aglyn.ui.SkeletonGrid
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.TextButton
import com.aglyn.ui.pickSourceLabel
import com.aglyn.ui.space
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
 * The media library, a file's details beside the grid on wide windows: the
 * site's library and the workspace's (as this site sees it), folders,
 * search, type and order, upload from the photo library, the camera or
 * files, and each file's details, privacy, move, replace and delete.
 */
@Composable
fun MediaScreen(context: NativePluginContext, params: Map<String, String>) {
  val orgId = context.orgId
  val hostId = context.hostId
  // The workspace's own library page (`/{org}/media`) shows it whole; a site's shows both tabs.
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
  Column(Modifier.fillMaxSize()) {
    if (!orgOnly) {
      SecondaryTabRow(selectedTabIndex = tab) {
        Tab(tab == 0, { tab = 0 }, text = { Text("This site") }, modifier = Modifier.testTag("media-tab-site"))
        Tab(tab == 1, { tab = 1 }, text = { Text("Workspace") }, modifier = Modifier.testTag("media-tab-org"))
      }
    }
    MediaScopeGate(context, scope) { tokens -> MediaLibrary(context, scope, tokens, params["media"]) }
  }
}

@Composable
private fun MediaLibrary(context: NativePluginContext, scope: MediaScope, scopeTokens: List<String>?, initialMediaId: String?) {
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
  var dialog by remember { mutableStateOf<MediaDialog?>(null) }
  var filtersOpen by remember { mutableStateOf(false) }
  val picker = LocalMediaPicker.current
  var uploading by remember { mutableStateOf<String?>(null) }
  var undo by remember { mutableStateOf<Pair<String, String>?>(null) }
  // Files staff have disabled among those on screen (AGL-1612), asked of the console after each change of the page.
  var disabled by remember(scope) { mutableStateOf<Map<String, MediaQuarantineNotice>>(emptyMap()) }

  var audioBatch by remember { mutableStateOf<List<PickedFile>?>(null) }

  fun sendFiles(files: List<PickedFile>, rightsConfirmed: Boolean) {
    val folderId = (model.folder as? FolderPick.One)?.id
    runner.run(success = if (files.size == 1) "${files[0].name} uploaded." else "${files.size} files uploaded.", onDone = { uploading = null; model.refresh() }) {
      try {
        files.forEachIndexed { index, file ->
          uploading = if (files.size == 1) "Uploading ${file.name}…" else "Uploading ${index + 1} of ${files.size}…"
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

  AglynListDetail(
    // A phone shows a file without the library, so the file carries the library's banners.
    detailBanner = { if (dialog == null) RunnerBanners(runner) },
    initialSelected = initialMediaId,
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        ListHeader(if (scope is MediaScope.Org) "Workspace library" else "Site library") {
          val folderActions = buildList {
            add(MenuAction("new-folder", "New folder", "folder", enabled = canEdit) { dialog = MediaDialog.NewFolder((model.folder as? FolderPick.One)?.id) })
            (model.folder as? FolderPick.One)?.let { pick ->
              foldersById[pick.id]?.let { folder ->
                add(MenuAction("rename-folder", "Rename folder", "edit", enabled = canEdit) { dialog = MediaDialog.RenameFolder(folder) })
                add(MenuAction("delete-folder", "Delete folder", "delete", destructive = true, enabled = canEdit) { dialog = MediaDialog.DeleteFolder(folder) })
              }
            }
          }
          OverflowMenu(folderActions)
          UploadButton(picker?.sources.orEmpty(), enabled = canEdit && !runner.busy, onPick = ::uploadFrom)
        }
        Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          uploading?.let { NoticeBanner(it, StatusTone.INFO) }
          undo?.let { (id, name) ->
            NoticeBanner("$name deleted.", StatusTone.NEUTRAL, Modifier.testTag("media-undo"), action = {
              TextButton(onClick = { undo = null; runner.run("$name is back.", onDone = { model.refresh() }) { api.restore(id) } }) { Text("Undo") }
            })
          }
          if (dialog == null) {
            runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
            runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
          }
          com.aglyn.ui.ListToolbar(
            model.search, model::type, placeholder = "Search files", tag = "media",
            filterCount = model.filters.count, onFilters = { filtersOpen = true },
            sorts = Contracts.mediaSorts.map { com.aglyn.ui.SortOption(it.raw, Contracts.mediaSortLabels[it.raw] ?: it.raw) },
            sort = model.sort.raw,
            onSort = { key -> Contracts.mediaSorts.firstOrNull { it.raw == key }?.let(model::order) },
          )
          model.notices.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("media-filter-notice")) }
          if (scopeTokens != null && model.search.isNotBlank()) {
            Text(Contracts.mediaScopedSearchNotice, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          FolderPicker(model.folder, folderList, foldersById, model::open)
          ChoiceChipRow(
            mediaTypeChoices().map { (value, label) -> ChipOption(value ?: "all", label) },
            model.type ?: "all",
            { model.pick(it.takeIf { key -> key != "all" }) },
          )
        }
        RefreshableBox(model.refreshing, model::refresh) {
          LoadContent(model.rows, onRetry = { model.reload() }, failedTitle = "Could not load the library", skeleton = { SkeletonGrid(tiles = 12) }) { rows ->
            val shown = rows.map { it.id }
            LaunchedEffect(shown) { disabled = api.quarantine(shown) }
            if (rows.isEmpty()) {
              EmptyState(
                if (model.search.isBlank() && model.type == null && model.filters.count == 0) "No files here yet" else "No files match",
                body = if (canEdit) "Upload photos, videos and documents to use on your pages." else null,
                icon = AglynIcons.named("photo_library"),
              )
            } else {
              val grid = rememberLazyGridState()
              val nearEnd by remember(grid) {
                derivedStateOf { (grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= grid.layoutInfo.totalItemsCount - 6 }
              }
              LaunchedEffect(nearEnd, model.hasMore) { if (nearEnd && model.hasMore) model.loadMore() }
              LazyVerticalGrid(
                GridCells.Adaptive(120.dp),
                Modifier.fillMaxSize().testTag("media-grid"),
                state = grid,
                contentPadding = androidx.compose.foundation.layout.PaddingValues(space(2f)),
                horizontalArrangement = Arrangement.spacedBy(space(1f)),
                verticalArrangement = Arrangement.spacedBy(space(1f)),
              ) {
                items(rows, key = { it.id }) { item -> MediaTile(item, context.api.origin, item.id == selected, disabled = item.id in disabled) { onSelect(item.id) } }
                if (model.hasMore) item(span = { GridItemSpan(maxLineSpan) }) { SkeletonList(rows = 1) }
              }
            }
          }
        }
      }
    },
    detail = { selected ->
      if (selected == null) {
        SelectionPlaceholder("Pick a file to see its details", icon = AglynIcons.named("photo_library"))
      } else {
        MediaDetail(context, scope, selected, api, runner, folderList, foldersById, canEdit, onDeleted = { id, name, restorable -> model.drop(id); undo = if (restorable) id to name else null; if (!restorable) runner.notice = "$name deleted." }, onChanged = { model.refresh() })
      }
    },
  )

  MediaDialogs(dialog, api, runner, foldersById, onChanged = { model.refresh() }) { dialog = null }
  if (filtersOpen) {
    MediaFiltersDialog(context, model.filters, scoped = scopeTokens != null, onApply = { model.filter(it); filtersOpen = false }, onDismiss = { filtersOpen = false })
  }
  audioBatch?.let { files ->
    AudioRightsDialog(files) { confirmed ->
      audioBatch = null
      if (confirmed) sendFiles(files, true)
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

/** The Filters button, with how many are set. */
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
private fun UploadButton(sources: List<PickSource>, enabled: Boolean, onPick: (PickSource) -> Unit) {
  var open by remember { mutableStateOf(false) }
  Box {
    Button(onClick = { if (sources.size == 1) onPick(sources[0]) else open = true }, enabled = enabled && sources.isNotEmpty(), modifier = Modifier.testTag("media-upload")) {
      Icon(AglynIcons.named("upload"), contentDescription = null)
      Text("Upload", Modifier.padding(start = space(1f)))
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      for (source in sources) {
        val (label, icon) = pickSourceLabel(source)
        DropdownMenuItem(
          text = { Text(label) },
          leadingIcon = { Icon(AglynIcons.named(icon), null) },
          onClick = { open = false; onPick(source) },
          modifier = Modifier.testTag("media-upload-${source.name.lowercase()}"),
        )
      }
    }
  }
}

@Composable
private fun FolderPicker(folder: FolderPick, folders: List<MediaFolder>, byId: Map<String, MediaFolder>, onPick: (FolderPick) -> Unit) {
  var open by remember { mutableStateOf(false) }
  val label = when (folder) {
    FolderPick.All -> "All files"
    FolderPick.Root -> "Not in a folder"
    is FolderPick.One -> byId[folder.id]?.let { folderPath(it, byId) } ?: "Folder"
  }
  Box {
    OutlinedButton(onClick = { open = true }, modifier = Modifier.testTag("media-folder")) {
      Icon(AglynIcons.named("folder_open"), contentDescription = null)
      Text(label, Modifier.padding(start = space(1f)), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      DropdownMenuItem(text = { Text("All files") }, onClick = { open = false; onPick(FolderPick.All) })
      DropdownMenuItem(text = { Text("Not in a folder") }, onClick = { open = false; onPick(FolderPick.Root) })
      if (folders.isNotEmpty()) HorizontalDivider()
      for (entry in folders.sortedBy { folderPath(it, byId).lowercase() }) {
        DropdownMenuItem(
          text = { Text(folderPath(entry, byId)) },
          leadingIcon = { Icon(AglynIcons.named("folder"), null) },
          onClick = { open = false; onPick(FolderPick.One(entry.id)) },
          modifier = Modifier.testTag("media-folder-${entry.id}"),
        )
      }
    }
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
        MediaDetailBody(context, scope, item, api, runner, folders, foldersById, canEdit, onDeleted, onChanged)
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

  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("media-detail"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    disabled?.let { NoticeBanner("${it.title}. ${it.message}", StatusTone.ERROR, Modifier.testTag("media-quarantine")) }
    SectionCard(null) {
      RemoteImage(
        item.thumbnail(origin, 640),
        item.alt.ifBlank { item.fileName },
        Modifier.fillMaxWidth().height(260.dp).clip(MaterialTheme.shapes.medium),
        contentScale = ContentScale.Fit,
        icon = mediaKindIcon(item.kind),
      )
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(item.fileName, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
        OverflowMenu(
          listOf(
            MenuAction("move", "Move to folder", "drive_file_move", enabled = canEdit) { moving = true },
            MenuAction("delete", "Delete file", "delete", destructive = true, enabled = canEdit) { deleting = true },
          ),
        )
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
    SectionCard("Details") {
      OutlinedTextField(fileName, { fileName = it.take(200) }, label = { Text("File name") }, supportingText = { Text("Display name only — the link stays the same.") }, singleLine = true, enabled = canEdit, modifier = Modifier.fillMaxWidth().testTag("media-file-name"))
      OutlinedTextField(alt, { alt = it.take(altMax) }, label = { Text("Alt text") }, supportingText = { Text("Describes the image for screen readers and search. ${alt.length}/$altMax") }, enabled = canEdit, modifier = Modifier.fillMaxWidth().testTag("media-alt"))
      OutlinedTextField(description, { description = it }, label = { Text("Description") }, enabled = canEdit, modifier = Modifier.fillMaxWidth())
      OutlinedTextField(tags, { tags = it }, label = { Text("Tags") }, supportingText = { Text("Separate tags with commas.") }, singleLine = true, enabled = canEdit, modifier = Modifier.fillMaxWidth().testTag("media-tags"))
      DetailRow("Folder", item.folderId?.let { foldersById[it] }?.let { folderPath(it, foldersById) }, placeholder = "Not in a folder")
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
    SectionCard("Used on", action = {
      TextButton(onClick = { runner.run { references = api.references(item.id) } }, enabled = !runner.busy, modifier = Modifier.testTag("media-references")) {
        Text(if (references == null) "Check" else "Check again")
      }
    }) {
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
      LazyColumn(Modifier.fillMaxWidth().heightIn(max = 360.dp)) {
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

