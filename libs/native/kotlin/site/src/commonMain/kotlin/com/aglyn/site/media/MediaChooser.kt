package com.aglyn.site.media

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SecondaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aglyn.ui.TextButton
import kotlinx.coroutines.launch
import com.aglyn.contracts.hostQualifiedCdnPath
import com.aglyn.contracts.mediaNodeSrc
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.Load
import com.aglyn.ui.LocalMediaPicker
import com.aglyn.ui.LocalVideoProbe
import com.aglyn.ui.PickSource
import com.aglyn.ui.PickedFile
import com.aglyn.ui.pickSourceLabel
import com.aglyn.ui.LoadContent
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SearchField
import com.aglyn.ui.SkeletonGrid
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

/**
 * What a person picked in the chooser: the file and the library it came from.
 * [reference] is what the console's picker stores (`mediaNodeSrc`): the asset
 * by identity (`media:{scope}/{mediaId}`), so replacing or moving the file
 * never breaks what names it, and for a workspace file shared with only some
 * sites, the form that names this site (`hostQualifiedCdnPath`).
 */
data class ChosenMedia(val item: MediaItem, val scope: MediaScope) {
  private val hostId: String? get() = when (scope) {
    is MediaScope.Site -> scope.hostId
    is MediaScope.Org -> scope.forHostId
  }

  val reference: String
    get() = mediaNodeSrc(item.url, hostQualifiedCdnPath(item.cdnPath, item.visibleTo, hostId), item.private)
      ?: "media:${scope.cdnScope}/${item.id}"
}

/** Why a private file cannot be placed, as the console's picker says it. */
const val PRIVATE_FILE_REFUSAL = "That file is private, so it cannot be placed on a page. Turn off Private in the media library to use it here."

/**
 * The media library as a chooser, the native side of the console's media
 * picker: this site's files and the workspace's, filtered to one [kind], one
 * tap to choose. Upload adds a file from this device to the library being
 * shown, as the console picker's library does, and chooses it as soon as it
 * lands. Shown over whatever screen needs a file.
 */
@Composable
fun MediaChooserDialog(
  context: NativePluginContext,
  onChoose: (ChosenMedia) -> Unit,
  onDismiss: () -> Unit,
  kind: String? = "image",
  allowPrivate: Boolean = false,
  /** The workspace's library alone, whichever site is picked: a workspace setting (its logo, its favicon) is chosen from the workspace's files, as the console's org media browser does. */
  workspaceOnly: Boolean = false,
) {
  val hostId = context.hostId.takeIf { !workspaceOnly }
  val orgId = context.orgId
  var tab by remember { mutableStateOf(0) }
  val scope: MediaScope? = when {
    hostId != null && tab == 0 -> MediaScope.Site(hostId)
    orgId != null -> MediaScope.Org(orgId, hostId)
    else -> null
  }
  Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Surface(
      Modifier.widthIn(max = 640.dp).fillMaxWidth(0.96f).heightIn(max = 860.dp).testTag("media-chooser"),
      shape = MaterialTheme.shapes.extraLarge,
      color = MaterialTheme.colorScheme.surface,
    ) {
      Column {
        Row(Modifier.padding(horizontal = space(2f), vertical = space(1.5f)), verticalAlignment = Alignment.CenterVertically) {
          Text("Choose from media", Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
          TextButton(onClick = onDismiss) { Text("Cancel") }
        }
        HorizontalDivider()
        if (hostId != null) {
          SecondaryTabRow(selectedTabIndex = tab) {
            Tab(tab == 0, { tab = 0 }, text = { Text("This site") }, modifier = Modifier.testTag("chooser-tab-site"))
            Tab(tab == 1, { tab = 1 }, text = { Text("Workspace") }, modifier = Modifier.testTag("chooser-tab-org"))
          }
        }
        if (scope == null) {
          EmptyState("Pick a workspace first", icon = AglynIcons.named("photo_library"))
        } else {
          MediaScopeGate(context, scope) { tokens -> MediaChooserGrid(context, scope, tokens, kind, allowPrivate, onChoose) }
        }
      }
    }
  }
}

@Composable
private fun MediaChooserGrid(context: NativePluginContext, scope: MediaScope, scopeTokens: List<String>?, kind: String?, allowPrivate: Boolean, onChoose: (ChosenMedia) -> Unit) {
  val coroutines = rememberCoroutineScope()
  val model = remember(scope, context.firestore) { MediaListModel(scope, context.firestore, coroutines, initialType = kind) }
  LaunchedEffect(model, scopeTokens) { model.start(scopeTokens) }
  var refusal by remember { mutableStateOf<String?>(null) }
  val picker = LocalMediaPicker.current
  val videoProbe = LocalVideoProbe.current
  val api = remember(scope, context.api, videoProbe) { MediaApi(context.api, scope, videoProbe) }
  val runner = remember(scope) { ActionRunner(coroutines) }
  val canUpload = scope is MediaScope.Org && context.orgRole in setOf("owner", "admin", "editor") ||
    scope is MediaScope.Site && context.siteRole in setOf("admin", "editor", "author")
  var uploading by remember { mutableStateOf<String?>(null) }
  // The file just uploaded here, chosen once the library lists it.
  var uploaded by remember { mutableStateOf<String?>(null) }
  var audioBatch by remember { mutableStateOf<List<PickedFile>?>(null) }

  fun choose(item: MediaItem) {
    if (item.private && !allowPrivate) refusal = PRIVATE_FILE_REFUSAL else onChoose(ChosenMedia(item, scope))
  }

  fun send(files: List<PickedFile>, rightsConfirmed: Boolean) {
    refusal = null
    runner.run(onDone = { model.refresh() }) {
      try {
        var last: String? = null
        files.forEachIndexed { index, file ->
          uploading = if (files.size == 1) "Uploading ${file.name}…" else "Uploading ${index + 1} of ${files.size}…"
          last = api.upload(file, null, rightsConfirmed) ?: last
        }
        uploaded = last
      } finally {
        uploading = null
      }
    }
  }

  fun uploadFrom(source: PickSource) {
    val device = picker ?: return
    coroutines.launch {
      val files = runCatching { device.pick(source, multiple = false) }.getOrDefault(emptyList())
      if (files.isEmpty()) return@launch
      // An audio file needs its uploader's rights confirmation first (AGL-3716).
      if (files.any(::isAudioFile)) audioBatch = files else send(files, false)
    }
  }

  // The upload is chosen the moment the library lists it (a file of another kind never appears here).
  LaunchedEffect(uploaded, model.rows) {
    val id = uploaded ?: return@LaunchedEffect
    val item = (model.rows as? Load.Ready)?.value?.firstOrNull { it.id == id } ?: return@LaunchedEffect
    uploaded = null
    choose(item)
  }

  Column(Modifier.fillMaxSize()) {
    Row(Modifier.padding(space(2f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      SearchField(model.search, model::type, placeholder = "Search files", modifier = Modifier.weight(1f))
      ChooserUploadButton(picker?.sources.orEmpty(), enabled = canUpload && !runner.busy, onPick = ::uploadFrom)
    }
    refusal?.let { NoticeBanner(it, StatusTone.WARNING, Modifier.padding(horizontal = space(2f)).testTag("chooser-private-refusal")) }
    uploading?.let { NoticeBanner(it, StatusTone.INFO, Modifier.padding(horizontal = space(2f)).testTag("chooser-uploading")) }
      ?: runner.error?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.padding(horizontal = space(2f)).testTag("chooser-upload-error")) }
    LoadContent(model.rows, onRetry = { model.reload() }, failedTitle = "Could not load the library", skeleton = { SkeletonGrid(tiles = 12) }) { rows ->
      if (rows.isEmpty()) {
        EmptyState(
          if (model.search.isBlank()) "No files here yet" else "No files match",
          body = if (model.search.isBlank() && canUpload) "Upload a file from this device to choose it." else null,
          icon = AglynIcons.named("photo_library"),
        )
      } else {
        val grid = rememberLazyGridState()
        val nearEnd by remember(grid) {
          derivedStateOf { (grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= grid.layoutInfo.totalItemsCount - 6 }
        }
        LaunchedEffect(nearEnd, model.hasMore) { if (nearEnd && model.hasMore) model.loadMore() }
        LazyVerticalGrid(
          GridCells.Adaptive(110.dp),
          Modifier.fillMaxSize().testTag("media-chooser-grid"),
          state = grid,
          contentPadding = PaddingValues(space(2f)),
          horizontalArrangement = Arrangement.spacedBy(space(1f)),
          verticalArrangement = Arrangement.spacedBy(space(1f)),
        ) {
          items(rows, key = { it.id }) { item -> MediaTile(item, context.api.origin, selected = false) { choose(item) } }
          if (model.hasMore) item(span = { GridItemSpan(maxLineSpan) }) { SkeletonList(rows = 1) }
        }
      }
    }
  }
  audioBatch?.let { files ->
    AudioRightsDialog(files) { confirmed ->
      audioBatch = null
      if (confirmed) send(files, true)
    }
  }
}

/** Upload from the chooser: the device's sources, or the one it has. */
@Composable
private fun ChooserUploadButton(sources: List<PickSource>, enabled: Boolean, onPick: (PickSource) -> Unit) {
  var open by remember { mutableStateOf(false) }
  Box {
    TextButton(onClick = { if (sources.size == 1) onPick(sources[0]) else open = true }, enabled = enabled && sources.isNotEmpty(), modifier = Modifier.testTag("chooser-upload")) {
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
          modifier = Modifier.testTag("chooser-upload-${source.name.lowercase()}"),
        )
      }
    }
  }
}
