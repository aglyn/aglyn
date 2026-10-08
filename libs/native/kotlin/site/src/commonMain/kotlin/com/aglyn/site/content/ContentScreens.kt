package com.aglyn.site.content

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.site.pages.livePageUrl
import com.aglyn.site.pages.SiteRouting
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChipsField
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.CountedTextField
import com.aglyn.ui.DateTimeField
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.FormCard
import com.aglyn.ui.ListHeader
import com.aglyn.ui.LoadContent
import com.aglyn.ui.LoadMoreEffect
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.RefreshableBox
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.formatDateTime
import com.aglyn.ui.space

const val SITE_CONTENT_SCREEN = "site.content"

/** Roles that may write entries and collections (`hostRoleCanWrite`); publishing needs [PUBLISH_ROLES]. */
private val WRITE_ROLES = setOf("admin", "editor", "author")
private val PUBLISH_ROLES = setOf("admin", "editor")

/** What the content screen's dialog is asking for. */
private sealed interface ContentDialog {
  data object NewCollection : ContentDialog
  data class Settings(val collection: ContentCollection) : ContentDialog
  data class Categories(val collection: ContentCollection) : ContentDialog
  data class DeleteCollection(val collection: ContentCollection) : ContentDialog
  data class NewEntry(val collection: ContentCollection) : ContentDialog
  data class Schedule(val collectionId: String, val entry: ContentEntry) : ContentDialog
  data class PublishedDate(val collectionId: String, val entry: ContentEntry) : ContentDialog
  data class DeleteEntry(val collectionId: String, val entry: ContentEntry) : ContentDialog
}

/**
 * A site's content as the console's Content page shows it: pick a
 * collection, then its entries beside the picked one on wide windows —
 * search, the status filter, create, edit every field, publish, schedule,
 * re-date, view on the site and delete — and the collection's own settings,
 * categories and pages.
 */
@Composable
fun ContentScreen(context: NativePluginContext, initialCollection: String? = null, initialEntry: String? = null) {
  val hostId = context.hostId ?: return
  val collectionsLive by remember(hostId, context.firestore) { context.firestore.observe(FirestoreQuery("hosts/$hostId/collections", limit = 50)) }.collectAsState(Live.Loading)
  val host by remember(hostId, context.firestore) { context.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading)
  val scope = rememberCoroutineScope()
  val runner = remember(hostId) { ActionRunner(scope, roleHint = "an author, editor or admin") }
  val api = remember(hostId, context.api, context.writer, context.firestore) { ContentApi(context.api, context.writer, context.firestore, hostId) }
  var dialog by remember { mutableStateOf<ContentDialog?>(null) }
  var picked by rememberSaveable(initialCollection) { mutableStateOf(initialCollection) }
  var entriesVersion by remember { mutableStateOf(0) }
  val canWrite = context.siteRole in WRITE_ROLES
  val canPublish = context.siteRole in PUBLISH_ROLES

  when (val live = collectionsLive) {
    Live.Loading -> SkeletonList(rows = 8, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this site's content", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val collections = sortedCollections(live.value)
      val collection = collections.firstOrNull { it.id == picked || it.slug == picked } ?: collections.firstOrNull()
      if (collection == null) {
        EmptyState(
          "No collections yet",
          body = "A collection holds posts or articles, each with its own page on your site.",
          icon = AglynIcons.named("article"),
          action = { Button(onClick = { dialog = ContentDialog.NewCollection }, enabled = canWrite, modifier = Modifier.testTag("add-collection")) { Text("New collection") } },
        )
      } else {
        val routing = SiteRouting.from((host as? Live.Ready)?.value)
        CollectionEntries(context, hostId, collection, collections, api, runner, canWrite, canPublish, routing, initialEntry, entriesVersion, { picked = it }) { dialog = it }
      }
    }
  }

  ContentDialogs(context, hostId, dialog, api, runner, canPublish, onCollection = { picked = it }, onEntriesChanged = { entriesVersion += 1 }) { dialog = null }
}

@Composable
private fun CollectionEntries(
  context: NativePluginContext,
  hostId: String,
  collection: ContentCollection,
  collections: List<ContentCollection>,
  api: ContentApi,
  runner: ActionRunner,
  canWrite: Boolean,
  canPublish: Boolean,
  routing: SiteRouting,
  initialEntry: String?,
  entriesVersion: Int,
  pick: (String) -> Unit,
  open: (ContentDialog) -> Unit,
) {
  val scope = rememberCoroutineScope()
  val model = remember(hostId, collection.id) { EntryListModel(hostId, collection.id, context.firestore, scope) }
  LaunchedEffect(model) { model.reload() }
  LaunchedEffect(model, entriesVersion) { if (entriesVersion > 0) model.reload(keep = true) }
  val isAdmin = context.siteRole == "admin"
  AglynListDetail(
    initialSelected = initialEntry,
    list = { selected, onSelect ->
      val listState = rememberLazyListState()
      LoadMoreEffect(listState, model.hasMore, onLoadMore = model::loadMore)
      Column(Modifier.fillMaxSize()) {
        ListHeader("Content") {
          OverflowMenu(
            listOf(
              MenuAction("new-collection", "New collection", "add", enabled = canWrite) { open(ContentDialog.NewCollection) },
              MenuAction("settings", "Collection settings", "settings", enabled = canWrite) { open(ContentDialog.Settings(collection)) },
              MenuAction("categories", "Categories", "label", enabled = canWrite) { open(ContentDialog.Categories(collection)) },
              MenuAction("delete-collection", "Delete collection", "delete", destructive = true, enabled = isAdmin) { open(ContentDialog.DeleteCollection(collection)) },
            ),
          )
          Button(onClick = { open(ContentDialog.NewEntry(collection)) }, enabled = canWrite, modifier = Modifier.testTag("add-entry")) {
            Icon(AglynIcons.named("add"), contentDescription = null)
            Text("New entry", Modifier.padding(start = space(1f)))
          }
        }
        Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          SelectField(
            "Collection",
            collections.map { SelectOption(it.id, "${it.name} (/${it.slug})") },
            collection.id,
            { it?.let(pick) },
            modifier = Modifier.testTag("collection-picker"),
          )
          SearchField(model.search, model::type, placeholder = "Search titles")
          ChoiceChipRow(
            listOf(ChipOption("all", "All")) + Contracts.entryStatusOptions.map { ChipOption(it.value, it.label) },
            model.status ?: "all",
            { model.pick(it.takeIf { key -> key != "all" }) },
          )
          runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
          runner.notice?.let { message -> NoticeBanner(message, StatusTone.SUCCESS, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
        }
        RefreshableBox(model.refreshing, model::refresh) {
          LoadContent(model.rows, onRetry = { model.reload() }, failedTitle = "Could not load entries") { rows ->
            if (rows.isEmpty()) {
              EmptyState(
                if (model.search.isBlank() && model.status == null) "No entries yet" else "No entries match",
                body = if (model.search.isBlank()) "Write the first ${collection.name.lowercase()} entry." else "Try another search.",
                icon = AglynIcons.named("article"),
              )
            } else {
              val now = remember(rows) { nowMillis() }
              LazyColumn(Modifier.fillMaxSize().testTag("entries-list"), state = listState) {
                items(rows, key = { it.id }) { entry ->
                  AglynListItem(
                    title = entry.title,
                    supporting = listOfNotNull(
                      "/${collection.slug}/${entry.slug}",
                      entry.updatedAt?.let { "edited " + relativeTime(it.epochMillis, now) },
                    ).joinToString(" · "),
                    icon = AglynIcons.named("article"),
                    selected = entry.id == selected,
                    trailing = { StatusChip(entryStatusLabel(entry.status), entryTone(entry.status)) },
                    onClick = { onSelect(entry.id) },
                    modifier = Modifier.testTag("entry-${entry.id}"),
                  )
                }
                if (model.hasMore) item { SkeletonList(rows = 2) }
              }
            }
          }
        }
      }
    },
    detail = { selected ->
      if (selected == null) {
        EmptyState("Pick an entry to edit it here", icon = AglynIcons.named("article"))
      } else {
        EntryEditor(context, hostId, collection, selected, api, runner, canWrite, canPublish, routing, model, open)
      }
    },
  )
}

private fun entryTone(status: String) = when (status) {
  "published" -> StatusTone.SUCCESS
  "scheduled" -> StatusTone.INFO
  else -> StatusTone.NEUTRAL
}

@Composable
private fun EntryEditor(
  context: NativePluginContext,
  hostId: String,
  collection: ContentCollection,
  entryId: String,
  api: ContentApi,
  runner: ActionRunner,
  canWrite: Boolean,
  canPublish: Boolean,
  routing: SiteRouting,
  model: EntryListModel,
  open: (ContentDialog) -> Unit,
) {
  val live by remember(hostId, collection.id, entryId, context.firestore) {
    context.firestore.observeDoc("hosts/$hostId/collections/${collection.id}/entries/$entryId")
  }.collectAsState(Live.Loading)
  val authorsLive by remember(hostId, context.firestore) { context.firestore.observe(FirestoreQuery("hosts/$hostId/authors", limit = 100)) }.collectAsState(Live.Loading)
  val authors = (authorsLive as? Live.Ready)?.value.orEmpty().map(::contentAuthorOf).sortedBy { it.name.lowercase() }
  val uri = LocalUriHandler.current
  when (val doc = live) {
    Live.Loading -> SkeletonList(rows = 8, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this entry", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val entry = doc.value?.let(ContentEntry::from) ?: return EmptyState("This entry is gone", icon = AglynIcons.named("article"))
      val stored = remember(entry) { EntryDraft.of(entry) }
      var draft by remember(stored) { mutableStateOf(stored) }
      val saverScope = rememberCoroutineScope()
      val saver = remember(entry.id) { ActionRunner(saverScope, roleHint = "an author, editor or admin") }
      val now = remember(entry.updatedAt) { nowMillis() }
      val titleError = if (draft.title.isBlank()) "Required" else null
      val slugError = if (draft.effectiveSlug.isEmpty()) "Add a title or an address" else null
      Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("entry-editor"),
        verticalArrangement = Arrangement.spacedBy(space(2f)),
      ) {
        SectionCard(null) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
              Text(entry.title, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
              Text("/${collection.slug}/${entry.slug}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            OverflowMenu(
              buildList {
                add(MenuAction("schedule", "Schedule…", "schedule", enabled = canPublish && entry.status != "published") { open(ContentDialog.Schedule(collection.id, entry)) })
                add(MenuAction("published-date", "Edit published date…", "event", enabled = canPublish && entry.publishedAt != null) { open(ContentDialog.PublishedDate(collection.id, entry)) })
                add(MenuAction("delete", "Delete", "delete", destructive = true, enabled = canWrite) { open(ContentDialog.DeleteEntry(collection.id, entry)) })
              },
            )
          }
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
            StatusChip(entryStatusLabel(entry.status), entryTone(entry.status))
            entry.publishAt?.takeIf { entry.status == "scheduled" }?.let { StatusChip("Goes live ${formatDateTime(it.epochMillis, withTime = true)} UTC", StatusTone.INFO) }
          }
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
            if (entry.status == "published") {
              OutlinedButton(
                onClick = { runner.run("Entry unpublished.") { api.setPublished(collection.id, entry, false); api.announce(collection.id, listOf(entry.slug)); model.reload(keep = true) } },
                enabled = canPublish && !runner.busy,
                modifier = Modifier.testTag("entry-unpublish"),
              ) { Text("Unpublish") }
              val liveUrl = livePageUrl(routing, "/${collection.slug}/${entry.slug}")
              if (liveUrl != null) {
                OutlinedButton(onClick = { uri.openUri(liveUrl) }) {
                  Icon(AglynIcons.named("open_in_new"), contentDescription = null)
                  Text("View on site", Modifier.padding(start = space(1f)))
                }
              }
            } else {
              Button(
                onClick = {
                  if (!entry.hasByline) runner.error = ENTRY_BYLINE_REQUIRED_MESSAGE
                  else runner.run("Entry published.") { api.setPublished(collection.id, entry, true); api.announce(collection.id, listOf(entry.slug)); model.reload(keep = true) }
                },
                enabled = canPublish && !runner.busy && stored == draft,
                modifier = Modifier.testTag("entry-publish"),
              ) { Text(if (entry.status == "scheduled") "Publish now" else "Publish") }
            }
          }
          if (!canPublish) Text("Publishing needs the editor or admin role; you can save drafts.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          if (stored != draft) Text("Save your changes before publishing.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        FormCard(
          title = "Entry",
          dirty = draft != stored,
          canSave = canWrite && titleError == null && slugError == null,
          busy = saver.busy,
          error = saver.error,
          notice = saver.notice,
          onDiscard = { draft = stored; saver.clear() },
          onSave = {
            saver.run("Saved.") {
              val slug = draft.effectiveSlug
              if (api.slugTaken(collection.id, slug, entry.id)) error("Another entry already uses /${collection.slug}/$slug")
              api.saveEntry(collection.id, entry.id, draft)
              if (entry.isLive) api.announce(collection.id, listOf(entry.slug, slug).distinct())
              model.reload(keep = true)
            }
          },
        ) {
          CountedTextField("Title", draft.title, { title ->
            // The address follows the title until it is published or typed.
            val follow = entry.publishedAt == null && (draft.slug.isEmpty() || draft.slug == contentSlug(draft.title))
            draft = draft.copy(title = title, slug = if (follow) contentSlug(title) else draft.slug)
          }, required = true, enabled = canWrite, modifier = Modifier.testTag("entry-title"))
          CountedTextField("Address", draft.slug, { draft = draft.copy(slug = it) }, enabled = canWrite, error = slugError, supporting = "/${collection.slug}/${draft.effectiveSlug}")
          CountedTextField("Excerpt", draft.excerpt, { draft = draft.copy(excerpt = it) }, multiline = true, minLines = 2, enabled = canWrite, supporting = "The summary lists and search results show")
          SelectField(
            "Category",
            collection.categories.map { SelectOption(it.id, it.name) },
            draft.categoryId,
            { draft = draft.copy(categoryId = it) },
            enabled = canWrite,
            noneLabel = "No category",
            supporting = entry.legacyCategory?.takeIf { draft.categoryId == null }?.let { "Was \"$it\" — pick its category" },
          )
          ChipsField("Tags", draft.tags, { draft = draft.copy(tags = it) }, enabled = canWrite)
          SelectField(
            "Author",
            authors.map { SelectOption(it.id, it.name) },
            draft.authorId,
            { id -> draft = draft.copy(authorId = id, authorName = if (id != null) authors.firstOrNull { it.id == id }?.name.orEmpty() else draft.authorName) },
            enabled = canWrite,
            noneLabel = "Custom byline",
          )
          if (draft.authorId == null) CountedTextField("Byline", draft.authorName, { draft = draft.copy(authorName = it) }, enabled = canWrite, supporting = "The name published under this entry")
          CountedTextField("Body", draft.body, { draft = draft.copy(body = it) }, Modifier.heightIn(min = 200.dp), multiline = true, minLines = 8, enabled = canWrite, supporting = "Markdown: # headings, **bold**, [links](https://…)")
        }
        SectionCard("Media") {
          CountedTextField("Cover image", draft.coverImage, { draft = draft.copy(coverImage = it) }, enabled = canWrite, keyboardType = KeyboardType.Uri, placeholder = "https://… or media:{id}")
          CountedTextField("Cover image description", draft.coverImageAlt, { draft = draft.copy(coverImageAlt = it) }, enabled = canWrite && draft.coverImage.isNotBlank())
          CountedTextField("Cover video", draft.coverVideo, { draft = draft.copy(coverVideo = it) }, enabled = canWrite, keyboardType = KeyboardType.Uri, placeholder = "https://… or media:{id}")
          CountedTextField("Video length (seconds)", draft.coverVideoDuration, { draft = draft.copy(coverVideoDuration = it.filter(Char::isDigit)) }, enabled = canWrite && draft.coverVideo.isNotBlank(), keyboardType = KeyboardType.Number)
          Text("Save the entry card to keep media changes.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        SectionCard("Search") {
          CountedTextField("SEO title", draft.seoTitle, { draft = draft.copy(seoTitle = it) }, enabled = canWrite, error = if (draft.seoTitle.length > ENTRY_SEO_TITLE_WARN) "Search results cut titles past $ENTRY_SEO_TITLE_WARN characters" else null, supporting = "${draft.seoTitle.length}/$ENTRY_SEO_TITLE_WARN; empty uses the title")
          CountedTextField("SEO description", draft.seoDescription, { draft = draft.copy(seoDescription = it) }, multiline = true, minLines = 2, enabled = canWrite, error = if (draft.seoDescription.length > ENTRY_SEO_DESCRIPTION_WARN) "Search results cut descriptions past $ENTRY_SEO_DESCRIPTION_WARN characters" else null, supporting = "${draft.seoDescription.length}/$ENTRY_SEO_DESCRIPTION_WARN; empty uses the excerpt")
        }
        SectionCard("Details") {
          DetailRow("Published", entry.publishedAt?.let { formatDateTime(it.epochMillis, withTime = true) + " UTC" }, placeholder = "Not published")
          DetailRow("Updated", entry.updatedAt?.let { relativeTime(it.epochMillis, now) })
          DetailRow("Entry id", entry.id)
        }
      }
    }
  }
}

@Composable
private fun ContentDialogs(
  context: NativePluginContext,
  hostId: String,
  dialog: ContentDialog?,
  api: ContentApi,
  runner: ActionRunner,
  canPublish: Boolean,
  onCollection: (String) -> Unit,
  onEntriesChanged: () -> Unit,
  close: () -> Unit,
) {
  val screensLive by remember(hostId, context.firestore) { context.firestore.observe(FirestoreQuery("hosts/$hostId/screens", limit = 200)) }.collectAsState(Live.Loading)
  val screens = templateScreensOf((screensLive as? Live.Ready)?.value.orEmpty())
  val screenOptions = screens.map { SelectOption(it.id, it.name, if (it.kind == "template") "Entry template" else null) }
  when (dialog) {
    null -> Unit
    ContentDialog.NewCollection -> {
      var name by remember { mutableStateOf("") }
      var slug by remember { mutableStateOf("") }
      var listScreen by remember { mutableStateOf<String?>(null) }
      var entryScreen by remember { mutableStateOf<String?>(null) }
      val effective = contentSlug(slug).ifEmpty { contentSlug(name) }
      ActionDialog(
        title = "New collection",
        body = "Its entries live at /${effective.ifEmpty { "address" }}/… on your site.",
        icon = "article",
        confirmLabel = "Create",
        confirmEnabled = name.isNotBlank() && COLLECTION_SLUG_PATTERN.matches(effective),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = { runner.run("${name.trim()} was created.", onDone = close) { onCollection(api.createCollection(name, effective, listScreen, entryScreen)) } },
      ) {
        OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("collection-name"))
        OutlinedTextField(slug, { slug = it }, label = { Text("Address") }, placeholder = { Text(contentSlug(name).ifEmpty { "blog" }) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        SelectField("List page", screenOptions, listScreen, { listScreen = it }, noneLabel = "None yet")
        SelectField("Entry page", screenOptions, entryScreen, { entryScreen = it }, noneLabel = "None yet")
      }
    }
    is ContentDialog.Settings -> {
      val c = dialog.collection
      var name by remember(dialog) { mutableStateOf(c.name) }
      var slug by remember(dialog) { mutableStateOf(c.slug) }
      ActionDialog(
        title = "${c.name} settings",
        icon = "settings",
        confirmLabel = "Save name and address",
        confirmEnabled = name.isNotBlank() && COLLECTION_SLUG_PATTERN.matches(slug) && (name != c.name || slug != c.slug),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = { runner.run("Saved.") { api.renameCollection(c.id, name, slug) } },
        dismissLabel = "Close",
      ) {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          OutlinedTextField(name, { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
          OutlinedTextField(slug, { slug = contentSlug(it).ifEmpty { it.lowercase() } }, label = { Text("Address") }, prefix = { Text("/") }, singleLine = true, modifier = Modifier.fillMaxWidth())
          SelectField("List page", screenOptions, c.listScreenId, { id -> runner.run("List page saved.") { api.setListScreen(c.id, id) } }, noneLabel = "None", enabled = !runner.busy)
          SelectField("Entry page", screenOptions, c.entryScreenId, { id -> runner.run("Entry page saved.") { api.setEntryScreen(c.id, id) } }, noneLabel = "None", enabled = !runner.busy, supporting = "Each entry renders through this page")
          SelectField(
            "Structured data type",
            Contracts.contentSchemaTypeOptions.map { SelectOption(it.value, it.label, it.description) },
            c.schemaType ?: Contracts.contentSchemaTypeDefault.raw,
            { type -> type?.let { runner.run("Saved.") { api.setSchemaType(c.id, it) } } },
            enabled = !runner.busy,
          )
          SwitchRow(
            "Keep entries out of site search",
            c.excludeFromSearch,
            { on -> runner.run("Saved.") { api.setExcludeFromSearch(c.id, on) } },
            enabled = !runner.busy,
          )
          runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS) }
        }
      }
    }
    is ContentDialog.Categories -> {
      val c = dialog.collection
      val categories = remember(dialog) { mutableStateListOf<ContentCategory>().apply { addAll(c.categories) } }
      var newName by remember(dialog) { mutableStateOf("") }
      ActionDialog(
        title = "Categories",
        body = "Entries can be filed under one category each.",
        icon = "label",
        confirmLabel = "Save",
        confirmEnabled = categories.toList() != c.categories && categories.all { it.name.isNotBlank() },
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = { runner.run("Categories saved.", onDone = close) { api.setCategories(c.id, categories.toList()) } },
      ) {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          categories.forEachIndexed { index, category ->
            Row(verticalAlignment = Alignment.CenterVertically) {
              OutlinedTextField(category.name, { categories[index] = category.copy(name = it) }, label = { Text(category.id) }, singleLine = true, modifier = Modifier.weight(1f))
              IconButton(onClick = { categories.removeAt(index) }) { Icon(AglynIcons.named("delete"), contentDescription = "Remove ${category.name}") }
            }
          }
          Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(newName, { newName = it }, label = { Text("New category") }, singleLine = true, modifier = Modifier.weight(1f).testTag("new-category"))
            IconButton(
              onClick = {
                categories.add(ContentCategory(newCategoryId(newName, categories), newName.trim()))
                newName = ""
              },
              enabled = newName.isNotBlank() && categories.size < COLLECTION_CATEGORIES_MAX,
            ) { Icon(AglynIcons.named("add"), contentDescription = "Add category") }
          }
        }
      }
    }
    is ContentDialog.DeleteCollection -> ActionDialog(
      title = "Delete ${dialog.collection.name}?",
      body = "A collection can only be deleted once it holds no entries and no published page uses it.",
      icon = "delete",
      confirmLabel = "Delete collection",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = close,
      onConfirm = { runner.run("${dialog.collection.name} was deleted.", onDone = close) { api.deleteCollection(dialog.collection.id) } },
    )
    is ContentDialog.NewEntry -> {
      var title by remember(dialog) { mutableStateOf("") }
      val slug = contentSlug(title)
      ActionDialog(
        title = "New ${dialog.collection.name} entry",
        body = "It starts as a draft at /${dialog.collection.slug}/${slug.ifEmpty { "…" }}.",
        icon = "article",
        confirmLabel = "Create draft",
        confirmEnabled = slug.isNotEmpty(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = {
          runner.run("Draft created.", onDone = close) {
            if (api.slugTaken(dialog.collection.id, slug, null)) error("Another entry already uses /${dialog.collection.slug}/$slug")
            val id = api.createEntry(dialog.collection.id, title, slug)
            onEntriesChanged()
            context.navigate(SITE_CONTENT_SCREEN, mapOf("collectionSlug" to dialog.collection.slug, "entryId" to id))
          }
        },
      ) {
        OutlinedTextField(title, { title = it }, label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("entry-new-title"))
      }
    }
    is ContentDialog.Schedule -> {
      var at by remember(dialog) { mutableStateOf<Long?>(null) }
      val entry = dialog.entry
      ActionDialog(
        title = "Schedule ${entry.title}",
        body = "It goes live on its own at that time (times are UTC). Scheduled publishing is part of the Business plan.",
        icon = "schedule",
        confirmLabel = "Schedule",
        confirmEnabled = at?.let { isFuture(it) } == true && canPublish,
        busy = runner.busy,
        error = runner.error ?: if (!entry.hasByline) ENTRY_BYLINE_REQUIRED_MESSAGE else null,
        onDismiss = close,
        onConfirm = {
          val time = at ?: return@ActionDialog
          if (!entry.hasByline) return@ActionDialog
          runner.run("Scheduled for ${formatDateTime(time, withTime = true)} UTC.", onDone = close) {
            api.schedule(dialog.collectionId, entry, time)
            api.announce(dialog.collectionId, listOf(entry.slug))
            onEntriesChanged()
          }
        },
      ) {
        DateTimeField("Goes live", at, { at = it }, withTime = true, supporting = if (at != null && !isFuture(at!!)) "Pick a future time" else null)
      }
    }
    is ContentDialog.PublishedDate -> {
      val entry = dialog.entry
      var at by remember(dialog) { mutableStateOf(entry.publishedAt?.epochMillis) }
      ActionDialog(
        title = "Published date",
        body = "The date the entry shows. It cannot be in the future — schedule it instead.",
        icon = "event",
        confirmLabel = "Save",
        confirmEnabled = at?.let { !isFuture(it) } == true && canPublish,
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = { at?.let { time -> runner.run("Published date saved.", onDone = close) {
          api.setPublishedDate(dialog.collectionId, entry, time)
          if (entry.isLive) api.announce(dialog.collectionId, listOf(entry.slug))
          onEntriesChanged()
        } } },
      ) {
        DateTimeField("Published", at, { at = it }, withTime = true)
      }
    }
    is ContentDialog.DeleteEntry -> ActionDialog(
      title = "Delete this entry?",
      body = "\"${dialog.entry.title}\" will be permanently deleted.",
      icon = "delete",
      confirmLabel = "Delete",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = close,
      onConfirm = {
        runner.run("Entry deleted.", onDone = close) {
          api.deleteEntry(dialog.collectionId, dialog.entry.id)
          if (dialog.entry.isLive) api.announce(dialog.collectionId, listOf(dialog.entry.slug))
          onEntriesChanged()
        }
      },
    )
  }
}
