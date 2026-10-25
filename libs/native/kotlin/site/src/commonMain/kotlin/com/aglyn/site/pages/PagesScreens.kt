package com.aglyn.site.pages

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.BesignerPaths
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.ListCreateZone
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.SlotPlacement
import com.aglyn.pluginhost.SlotWidgets
import com.aglyn.site.artifacts.ArtifactRow
import com.aglyn.site.artifacts.SaveAsTemplateDialog
import com.aglyn.site.artifacts.TemplateGalleryDialog
import com.aglyn.site.artifacts.UseTemplateDialog
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.CloseWhenGone
import com.aglyn.pluginhost.RunnerBanners
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.ListHeader
import com.aglyn.ui.LoadMoreEffect
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectionPlaceholder
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.space
import kotlinx.coroutines.launch

const val SITE_PAGES_SCREEN = "site.pages"

/** Roles the rules let change a page's document; the routing map needs [PUBLISH_ROLES]. */
private val CONTENT_ROLES = setOf("admin", "editor", "author")
private val PUBLISH_ROLES = setOf("admin", "editor")

/** The site's pages as far as the list has read them ([PagesTreeLoader]), the tree they make, and the host's routing map. */
class PagesLive(val rows: Live<List<PageTreeRow>>, val pages: List<PageNode>, val routing: SiteRouting, val loader: PagesTreeLoader)

@Composable
fun sitePages(context: NativePluginContext, hostId: String): PagesLive {
  val host by remember(hostId, context.firestore) { context.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading)
  val loader = remember(hostId, context.firestore) { PagesTreeLoader(context.firestore, hostId) }
  LaunchedEffect(loader) { loader.loadMore() }
  val routing = SiteRouting.from((host as? Live.Ready)?.value)
  val pages = loader.drawable()
  val rows = when {
    !loader.started -> Live.Loading
    loader.error != null && loader.pages.isEmpty() -> Live.Failed(IllegalStateException(loader.error))
    else -> Live.Ready(pageTree(pages, routing))
  }
  return PagesLive(rows, pages, routing, loader)
}

/** What a page dialog is asking for. */
private sealed interface PageDialog {
  data object NewPage : PageDialog
  data object NewGroup : PageDialog
  data class Rename(val page: PageNode) : PageDialog
  data class Publish(val page: PageNode, val currentSlug: String) : PageDialog
  data class Unpublish(val page: PageNode, val hasChildren: Boolean = false) : PageDialog
  data class Duplicate(val page: PageNode) : PageDialog
  data class Move(val page: PageNode) : PageDialog
  data class Delete(val page: PageNode, val livePath: String?, val hasChildren: Boolean = false) : PageDialog
  /** The page templates to start a new page from. */
  data object Gallery : PageDialog
  data class UseTemplate(val row: ArtifactRow) : PageDialog
  data class SaveTemplate(val page: PageNode) : PageDialog
}

/**
 * The site's pages as the console's Pages hub lists them, the picked page
 * beside the list on wide windows: add a page or a group, open a page in the
 * Besigner, publish it at an address, unpublish, rename, duplicate, move,
 * make a saved version live, and delete.
 */
@Composable
fun PagesScreen(context: NativePluginContext, initialPageId: String? = null, startNew: Boolean = false) {
  val hostId = context.hostId ?: return
  val live = sitePages(context, hostId)
  val scope = rememberCoroutineScope()
  val runner = remember(hostId) { ActionRunner(scope) }
  val api = remember(hostId, context.api, context.writer) { PagesApi(context.api, context.writer, hostId) }
  // Opened from Create new: the new-page form comes up at once.
  var dialog by remember { mutableStateOf<PageDialog?>(if (startNew) PageDialog.NewPage else null) }
  val canEdit = context.siteRole in CONTENT_ROLES
  val canPublish = context.siteRole in PUBLISH_ROLES

  AglynListDetail(
    initialSelected = initialPageId,
    detailBanner = { if (dialog == null) RunnerBanners(runner) },
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        ListHeader("Pages") {
          OverflowMenu(
            listOf(
              MenuAction("new-group", "New group", "folder", enabled = canEdit) { dialog = PageDialog.NewGroup },
              MenuAction("page-from-template", "From a template", "widgets", enabled = canEdit) { dialog = PageDialog.Gallery },
            ),
          )
          com.aglyn.ui.ListHeaderAction("New page", "add", { dialog = PageDialog.NewPage }, Modifier.testTag("add-page"), enabled = canEdit)
          // Create with AI and anything else a plugin puts beside New page (the console's `hostScreens` zone).
          SlotWidgets(context, ListCreateZone.PAGES, SlotPlacement.HEADER)
        }
        if (dialog == null) {
          Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) { RunnerBanners(runner) }
        }
        // "Start from a template", until it is dismissed on this device; the ⋯ menu keeps the way in.
        val stripKey = "aglyn.pages.templateStrip.dismissed.$hostId"
        var stripShown by remember(hostId) { mutableStateOf(context.deviceStore.get(stripKey) == null) }
        if (stripShown && canEdit) {
          com.aglyn.ui.TemplateStrip(
            "Start a page from one of this site's templates.",
            "Browse templates",
            onOpen = { dialog = PageDialog.Gallery },
            onDismiss = { context.deviceStore.set(stripKey, "1"); stripShown = false },
            modifier = Modifier.padding(horizontal = space(2f), vertical = space(0.5f)),
          )
        }
        // Collapsed like the console's hub; what is open is kept per site for as long as the app runs.
        var expanded by remember(hostId) { mutableStateOf(PagesTreeMemory.expanded(hostId)) }
        var query by remember(hostId) { mutableStateOf("") }
        fun setExpanded(ids: Set<String>) {
          expanded = ids
          PagesTreeMemory.remember(hostId, ids)
        }
        // A link or a new page lands on its row: its parents open (reading its chain if it is not in hand yet).
        LaunchedEffect(initialPageId) {
          val id = initialPageId ?: return@LaunchedEffect
          live.loader.reveal(id)
        }
        val tree = (live.rows as? Live.Ready)?.value
        LaunchedEffect(initialPageId, tree?.any { it.page.id == initialPageId }) {
          val id = initialPageId ?: return@LaunchedEffect
          if (tree != null) pageAncestors(tree, id).takeIf { it.isNotEmpty() && !expanded.containsAll(it) }?.let { setExpanded(expanded + it) }
        }
        // A search finds any page, so it reads the windows the list has not reached yet.
        LaunchedEffect(query.isNotBlank()) { if (query.isNotBlank()) live.loader.loadAll() }
        SearchField(query, { query = it }, placeholder = "Search pages", modifier = Modifier.padding(horizontal = space(2f), vertical = space(1f)))
        when (val rows = live.rows) {
          Live.Loading -> SkeletonList(rows = 6)
          is Live.Failed -> EmptyState("Could not load this site's pages", body = "Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
          is Live.Ready -> if (rows.value.isEmpty() && live.loader.ended) {
            EmptyState(
              "No pages yet",
              body = "Add a page, then design it in the Besigner.",
              icon = AglynIcons.named("description"),
              action = if (context.slotWidgets(ListCreateZone.PAGES).isNotEmpty()) {
                { SlotWidgets(context, ListCreateZone.PAGES) }
              } else {
                null
              },
            )
          } else {
            val visible = visiblePageRows(rows.value, expanded, Int.MAX_VALUE, query)
            val listState = rememberLazyListState()
            LoadMoreEffect(listState, hasMore = query.isBlank() && !live.loader.ended && !live.loader.loading) { scope.launch { live.loader.loadMore() } }
            LazyColumn(Modifier.fillMaxSize().testTag("pages-list"), state = listState) {
              if (query.isNotBlank() && visible.rows.isEmpty() && live.loader.ended) {
                item { EmptyState("No page matches “${query.trim()}”", icon = AglynIcons.named("search")) }
              }
              items(visible.rows, key = { it.page.id }) { row ->
                val open = row.page.id in expanded
                PageRowItem(
                  row,
                  selected = row.page.id == selected,
                  expanded = if (query.isBlank() && row.childCount > 0) open else null,
                  onToggle = {
                    if (open) {
                      setExpanded(expanded - row.page.id)
                    } else {
                      setExpanded(expanded + row.page.id)
                      scope.launch { live.loader.expand(row.page.id) }
                    }
                  },
                ) { onSelect(row.page.id) }
              }
              if (live.loader.loading && live.loader.started) item { SkeletonList(rows = 2) }
            }
          }
        }
      }
    },
    detail = { selected ->
      val rows = (live.rows as? Live.Ready)?.value
      val row = rows?.firstOrNull { it.page.id == selected }
      // A deleted page leaves the list, and its detail closes with it.
      CloseWhenGone(rows?.let { row != null })
      if (row == null) {
        SelectionPlaceholder("Pick a page to see it here", icon = AglynIcons.named("description"))
      } else {
        PageDetail(context, hostId, row, live.routing, api, runner, canEdit, canPublish, live.loader) { dialog = it }
      }
    },
  )

  PageDialogs(context, hostId, dialog, live, api, runner, onSelectNew = { id -> context.navigate(SITE_PAGES_SCREEN, mapOf("page" to id)) }, onOpen = { dialog = it }) { dialog = null }
}

@Composable
private fun PageRowItem(row: PageTreeRow, selected: Boolean, expanded: Boolean?, onToggle: () -> Unit, onClick: () -> Unit) {
  val status = pageStatus(row)
  val count = if (row.childCount == 1) "1 page" else "${row.childCount} pages"
  Row(Modifier.fillMaxWidth().padding(start = (row.depth * 24).dp), verticalAlignment = Alignment.CenterVertically) {
    // The chevron opens the row's children in place; a row with none keeps the same indent.
    Box(Modifier.padding(start = space(1f)).size(40.dp), contentAlignment = Alignment.Center) {
      if (expanded != null) {
        val label = if (expanded) "Collapse ${row.page.name}" else "Expand ${row.page.name}"
        WithTooltip(label) {
          IconButton(onClick = onToggle, modifier = Modifier.testTag("page-toggle-${row.page.id}")) {
            Icon(
              AglynIcons.named("chevron_right"),
              contentDescription = label,
              modifier = Modifier.rotate(if (expanded) 90f else 0f),
              tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
      }
    }
    AglynListItem(
      title = row.page.name,
      supporting = when {
        row.page.isGroup -> count
        row.livePath != null -> if (row.childCount > 0) "${row.livePath} · $count" else row.livePath
        else -> (row.page.slug?.let { "/$it · not published" } ?: "No address yet") + if (row.childCount > 0) " · $count" else ""
      },
      icon = AglynIcons.named(if (row.page.isGroup) "folder" else if (row.home) "home" else "description"),
      selected = selected,
      trailing = {
        Row(horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
          if (row.home) StatusChip("Home", StatusTone.INFO)
          if (!row.page.isGroup) StatusChip(status.label, if (status.live) StatusTone.SUCCESS else StatusTone.NEUTRAL)
        }
      },
      onClick = onClick,
      modifier = Modifier.weight(1f).testTag("page-${row.page.id}"),
    )
  }
}

@Composable
private fun PageDetail(
  context: NativePluginContext,
  hostId: String,
  row: PageTreeRow,
  routing: SiteRouting,
  api: PagesApi,
  runner: ActionRunner,
  canEdit: Boolean,
  canPublish: Boolean,
  loader: PagesTreeLoader,
  open: (PageDialog) -> Unit,
) {
  val page = row.page
  val uri = LocalUriHandler.current
  val now = remember(page.updatedAt) { nowMillis() }
  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("page-detail"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    val liveUrl = row.livePath?.let { livePageUrl(routing, it) }
    val canPublishHere = canPublish && page.kind != SCREEN_KIND_TEMPLATE
    val edit = com.aglyn.ui.RecordAction("page-edit-besigner", "Edit in the Besigner", "design_services", enabled = page.versionId != null) {
      page.versionId?.let { context.openBesigner(BesignerPaths.screen(page.id, it), ConsoleScope.SITE) }
    }
    val publish = com.aglyn.ui.RecordAction("page-publish", if (row.livePath != null) "Change address" else "Publish", "publish", enabled = canPublishHere) {
      open(PageDialog.Publish(page, if (row.home) "/" else page.slug.orEmpty()))
    }
    // The next step for the page: a page nobody can visit yet is published; a live one is edited.
    val primary = when {
      page.isGroup -> null
      row.livePath == null && canPublishHere -> publish
      else -> edit
    }
    val more = buildList {
      if (!page.isGroup) {
        if (primary != edit) add(edit)
        if (primary != publish) add(publish)
        liveUrl?.let { url -> add(com.aglyn.ui.RecordAction("page-open-live", "Open live page", "open_in_new") { uri.openUri(url) }) }
      }
      if (!page.isGroup) {
        add(com.aglyn.ui.RecordAction("duplicate", "Duplicate", "content_copy", enabled = canEdit) { open(PageDialog.Duplicate(page)) })
        add(com.aglyn.ui.RecordAction("save-template", "Save as template", "bookmark", enabled = canEdit) { open(PageDialog.SaveTemplate(page)) })
        if (row.livePath != null) add(com.aglyn.ui.RecordAction("unpublish", "Unpublish", "visibility_off", enabled = canPublish) { open(PageDialog.Unpublish(page, row.childCount > 0)) })
      }
      add(com.aglyn.ui.RecordAction("delete", if (page.isGroup) "Delete group" else "Delete", "delete", destructive = true, enabled = canPublish) { open(PageDialog.Delete(page, row.livePath, row.childCount > 0)) })
    }
    com.aglyn.ui.RecordHeader(
      page.name,
      status = {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          val status = pageStatus(row)
          if (row.home) StatusChip("Home page", StatusTone.INFO)
          StatusChip(status.label, if (status.live) StatusTone.SUCCESS else StatusTone.NEUTRAL)
        }
      },
      primary = primary,
      more = more,
      // The page's own settings, from its title ▾: its name and where it sits.
      settings = buildList {
        add(com.aglyn.ui.RecordAction("rename", if (page.isGroup) "Rename group" else "Rename", "edit", enabled = canEdit) { open(PageDialog.Rename(page)) })
        if (!page.isGroup) add(com.aglyn.ui.RecordAction("move", "Move", "drive_file_move", enabled = canPublish) { open(PageDialog.Move(page)) })
      },
    )
    page.description?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    if (!page.isGroup) {
      com.aglyn.ui.PlainSection(null) {
        DetailRow("Address", row.livePath ?: page.slug?.let { "/$it (not published)" }, placeholder = "No address yet")
        DetailRow("Published", page.publishedAt?.let { relativeTime(it.epochMillis, now) }, placeholder = "Not published")
        DetailRow("Updated", page.updatedAt?.let { relativeTime(it.epochMillis, now) })
      }
      PageVersions(context, hostId, page, api, runner, canPublish, loader)
      // What the page is doing, then who touched it (the console's page view, AGL-4011): its traffic above its activity.
      com.aglyn.site.analytics.PageTrafficCard(context.firestore, context.api, hostId, page.id, upgrade = { context.navigate("core.billing.plans") })
      com.aglyn.site.analytics.SiteActivityCard(context.firestore, context.api, hostId, targetId = page.id, title = "Page Activity")
    }
  }
}

@Composable
private fun PageVersions(context: NativePluginContext, hostId: String, page: PageNode, api: PagesApi, runner: ActionRunner, canPublish: Boolean, loader: PagesTreeLoader) {
  val versions by remember(hostId, page.id, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/screens/${page.id}/versions", orderBy = listOf(FirestoreOrder("createdAt", descending = true)), limit = 20))
  }.collectAsState(Live.Loading)
  com.aglyn.ui.FoldedSection("Versions", count = (versions as? Live.Ready)?.value?.size, tag = "page-fold-versions") {
    when (val live = versions) {
      Live.Loading -> SkeletonList(rows = 2)
      is Live.Failed -> Text("Versions could not be loaded.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      is Live.Ready -> {
        val rows = live.value.map(::pageVersionOf)
        if (rows.isEmpty()) Text("No saved versions yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        val now = remember(rows.size) { nowMillis() }
        rows.forEachIndexed { index, version ->
          if (index > 0) HorizontalDivider()
          val current = version.id == page.versionId
          AglynListItem(
            title = version.name ?: "Version ${rows.size - index}",
            supporting = version.createdAt?.let { "Saved " + relativeTime(it.epochMillis, now) },
            icon = AglynIcons.named("history"),
            trailing = {
              if (current) {
                StatusChip("Current", StatusTone.SUCCESS)
              } else {
                Row {
                  TextButton(onClick = { context.openBesigner(BesignerPaths.screen(page.id, version.id), ConsoleScope.SITE) }) { Text("Open") }
                  TextButton(
                    onClick = { runner.run("This version is now the page's working version.") {
                      api.makeVersionLive(page.id, version.id)
                      loader.patch(page.id)
                    } },
                    enabled = canPublish && !runner.busy,
                  ) { Text("Use") }
                }
              }
            },
            modifier = Modifier.testTag("page-version-${version.id}"),
          )
        }
      }
    }
  }
}

@Composable
private fun PageDialogs(context: NativePluginContext, hostId: String, dialog: PageDialog?, live: PagesLive, api: PagesApi, runner: ActionRunner, onSelectNew: (String) -> Unit, onOpen: (PageDialog) -> Unit, close: () -> Unit) {
  val done = { close() }
  when (dialog) {
    null -> Unit
    PageDialog.Gallery -> TemplateGalleryDialog(context, hostId, "page", onChoose = { onOpen(PageDialog.UseTemplate(it)) }, onDismiss = close)
    is PageDialog.UseTemplate -> UseTemplateDialog(context, hostId, dialog.row, onDone = { _, id -> close(); onSelectNew(id) }, onDismiss = close)
    is PageDialog.SaveTemplate -> SaveAsTemplateDialog(
      context,
      hostId,
      kind = "page",
      defaultName = dialog.page.name,
      load = { templates -> templates.pageSource(dialog.page.id, dialog.page.versionId) },
      onSaved = { message ->
        runner.notice = message
        close()
      },
      onDismiss = close,
    )
    PageDialog.NewPage -> {
      var name by remember { mutableStateOf("") }
      var description by remember { mutableStateOf("") }
      ActionDialog(
        title = "New page",
        body = "It starts as a draft; publish it at an address when it is ready.",
        icon = "description",
        confirmLabel = "Create page",
        confirmEnabled = name.isNotBlank(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = { runner.run("${name.trim()} was added as a draft.", onDone = done) { live.loader.patch(api.createPage(name, description).first) } },
      ) {
        OutlinedTextField(name, { name = it.take(PAGE_NAME_MAX) }, label = { Text("Name") }, singleLine = true, supportingText = { Text("${name.length}/$PAGE_NAME_MAX") }, modifier = Modifier.fillMaxWidth().testTag("page-name"))
        OutlinedTextField(description, { description = it.take(PAGE_DESCRIPTION_MAX) }, label = { Text("Description (optional)") }, supportingText = { Text("${description.length}/$PAGE_DESCRIPTION_MAX") }, modifier = Modifier.fillMaxWidth())
      }
    }
    PageDialog.NewGroup -> {
      var name by remember { mutableStateOf("") }
      ActionDialog(
        title = "New group",
        body = "A group holds pages together in this list. It has no address of its own.",
        icon = "folder",
        confirmLabel = "Create group",
        confirmEnabled = name.isNotBlank(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = {
          val top = live.pages.filter { it.parentId == null }.mapNotNull { it.order }.minOrNull() ?: 0.0
          runner.run("Group ${name.trim()} added.", onDone = done) { live.loader.patch(api.createGroup(name, top)) }
        },
      ) {
        OutlinedTextField(name, { name = it.take(PAGE_NAME_MAX) }, label = { Text("Group name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("group-name"))
      }
    }
    is PageDialog.Rename -> {
      var name by remember(dialog) { mutableStateOf(dialog.page.name) }
      var description by remember(dialog) { mutableStateOf(dialog.page.description.orEmpty()) }
      ActionDialog(
        title = if (dialog.page.isGroup) "Rename group" else "Rename page",
        icon = "edit",
        confirmLabel = "Save",
        confirmEnabled = name.isNotBlank(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = { runner.run("Saved.", onDone = done) {
          api.rename(dialog.page.id, name, if (dialog.page.isGroup) null else description)
          live.loader.patch(dialog.page.id)
        } },
      ) {
        OutlinedTextField(name, { name = it.take(PAGE_NAME_MAX) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("rename-name"))
        if (!dialog.page.isGroup) {
          OutlinedTextField(description, { description = it.take(PAGE_DESCRIPTION_MAX) }, label = { Text("Description") }, modifier = Modifier.fillMaxWidth())
        }
      }
    }
    is PageDialog.Publish -> {
      var slug by remember(dialog) { mutableStateOf(dialog.currentSlug) }
      ActionDialog(
        title = if (live.routing.routes.containsKey(dialog.page.id)) "Change this page's address" else "Publish this page",
        body = "Visitors reach it at this address. Use / for the home page.",
        icon = "public",
        confirmLabel = "Publish",
        confirmEnabled = slug.isNotBlank(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = {
          runner.run(onDone = done) {
            val path = api.publish(dialog.page.id, slug)
            live.loader.patch(dialog.page.id)
            runner.notice = "Published at ${path ?: "/" + slug.trim('/')}"
          }
        },
      ) {
        OutlinedTextField(slug, { slug = it }, label = { Text("Address") }, prefix = { Text(if (slug.startsWith("/")) "" else "/") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("publish-slug"))
      }
    }
    is PageDialog.Unpublish -> ActionDialog(
      title = "Unpublish ${dialog.page.name}?",
      body = pageUnpublishBody(dialog.hasChildren),
      icon = "visibility_off",
      confirmLabel = "Unpublish",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = close,
      onConfirm = { runner.run("Page unpublished.", onDone = done) {
        api.unpublish(dialog.page.id)
        live.loader.patch(dialog.page.id)
      } },
    )
    is PageDialog.Duplicate -> {
      var name by remember(dialog) { mutableStateOf("${dialog.page.name} copy".take(PAGE_NAME_MAX)) }
      ActionDialog(
        title = "Duplicate ${dialog.page.name}",
        body = "The copy is a draft with its own address to set.",
        icon = "content_copy",
        confirmLabel = "Duplicate",
        confirmEnabled = name.isNotBlank(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = {
          runner.run("Copy added as a draft.", onDone = done) { api.duplicate(dialog.page.id, name)?.let { id -> live.loader.patch(id); onSelectNew(id) } }
        },
      ) {
        OutlinedTextField(name, { name = it.take(PAGE_NAME_MAX) }, label = { Text("Name of the copy") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      }
    }
    is PageDialog.Move -> {
      // Every group and page can be the new parent, so the whole site is read first.
      LaunchedEffect(dialog) { live.loader.loadAll() }
      val choices = remember(dialog, live.pages) { movableParents(live.pages, dialog.page.id) }
      var parent by remember(dialog) { mutableStateOf(dialog.page.parentId) }
      ActionDialog(
        title = "Move ${dialog.page.name}",
        body = "Inside a page, its address starts with that page's. A group changes no address.",
        icon = "drive_file_move",
        confirmLabel = "Move",
        confirmEnabled = parent != dialog.page.parentId,
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = {
          val siblings = live.pages.count { it.parentId == parent && it.id != dialog.page.id }
          runner.run("Moved.", onDone = done) {
            api.move(dialog.page.id, parent, siblings)
            live.loader.patch(dialog.page.id)
          }
        },
      ) {
        LazyColumn(Modifier.fillMaxWidth().padding(top = space(0.5f)).testTag("move-choices")) {
          item { MoveChoice("Top level", "home", parent == null) { parent = null } }
          items(choices, key = { it.id }) { choice ->
            MoveChoice(choice.name, if (choice.isGroup) "folder" else "description", parent == choice.id) { parent = choice.id }
          }
        }
      }
    }
    is PageDialog.Delete -> ActionDialog(
      title = if (dialog.page.isGroup) "Delete group ${dialog.page.name}?" else "Delete ${dialog.page.name}?",
      body = if (dialog.page.isGroup) {
        "Its pages move up a level and keep their addresses."
      } else {
        pageDeleteBody(dialog.livePath, dialog.hasChildren)
      },
      icon = "delete",
      confirmLabel = "Delete",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = close,
      onConfirm = {
        runner.run(if (dialog.page.isGroup) "Group deleted." else "Page deleted.", onDone = done) {
          if (dialog.page.isGroup) api.deleteGroup(dialog.page.id) else api.delete(dialog.page.id)
          live.loader.patch(dialog.page.id)
        }
      },
    )
  }
}

@Composable
private fun MoveChoice(label: String, icon: String, selected: Boolean, onClick: () -> Unit) {
  AglynListItem(
    title = label,
    icon = AglynIcons.named(icon),
    trailing = { RadioButton(selected = selected, onClick = null) },
    onClick = onClick,
  )
}

/** What unpublishing a page does; the pages inside it are named only when it has some. */
internal fun pageUnpublishBody(hasChildren: Boolean): String =
  "Visitors can no longer reach it." + if (hasChildren) " Pages inside it keep their addresses." else ""

/** What deleting a page does: where it stops answering, and its pages only when it has some. */
internal fun pageDeleteBody(livePath: String?, hasChildren: Boolean): String =
  listOfNotNull(livePath?.let { "It is live at $it and stops answering there." }, "Pages inside it keep their addresses.".takeIf { hasChildren })
    .joinToString(" ")
    .ifEmpty { "It is not published, so no address stops working." }
