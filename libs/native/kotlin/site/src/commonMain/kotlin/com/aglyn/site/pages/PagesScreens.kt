package com.aglyn.site.pages

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.ListHeader
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

const val SITE_PAGES_SCREEN = "site.pages"

/** Roles the rules let change a page's document; the routing map needs [PUBLISH_ROLES]. */
private val CONTENT_ROLES = setOf("admin", "editor", "author")
private val PUBLISH_ROLES = setOf("admin", "editor")

/** The site's pages, live: the screens window and the host's routing map. */
class PagesLive(val rows: Live<List<PageTreeRow>>, val pages: List<PageNode>, val routing: SiteRouting, val truncated: Boolean)

@Composable
fun sitePages(context: NativePluginContext, hostId: String): PagesLive {
  val host by remember(hostId, context.firestore) { context.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading)
  val window by remember(hostId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/screens", orderBy = listOf(FirestoreOrder("__name__")), limit = PAGES_WINDOW + 1))
  }.collectAsState(Live.Loading)
  val routing = SiteRouting.from((host as? Live.Ready)?.value)
  return when (val live = window) {
    Live.Loading -> PagesLive(Live.Loading, emptyList(), routing, false)
    is Live.Failed -> PagesLive(live, emptyList(), routing, false)
    is Live.Ready -> {
      val pages = live.value.take(PAGES_WINDOW).mapNotNull(PageNode::from)
      PagesLive(Live.Ready(pageTree(pages, routing)), pages, routing, live.value.size > PAGES_WINDOW)
    }
  }
}

/** What a page dialog is asking for. */
private sealed interface PageDialog {
  data object NewPage : PageDialog
  data object NewGroup : PageDialog
  data class Rename(val page: PageNode) : PageDialog
  data class Publish(val page: PageNode, val currentSlug: String) : PageDialog
  data class Unpublish(val page: PageNode) : PageDialog
  data class Duplicate(val page: PageNode) : PageDialog
  data class Move(val page: PageNode) : PageDialog
  data class Delete(val page: PageNode, val livePath: String?) : PageDialog
}

/**
 * The site's pages as the console's Pages hub lists them, the picked page
 * beside the list on wide windows: add a page or a group, open a page in the
 * Besigner, publish it at an address, unpublish, rename, duplicate, move,
 * make a saved version live, and delete.
 */
@Composable
fun PagesScreen(context: NativePluginContext, initialPageId: String? = null) {
  val hostId = context.hostId ?: return
  val live = sitePages(context, hostId)
  val scope = rememberCoroutineScope()
  val runner = remember(hostId) { ActionRunner(scope) }
  val api = remember(hostId, context.api, context.writer) { PagesApi(context.api, context.writer, hostId) }
  var dialog by remember { mutableStateOf<PageDialog?>(null) }
  val canEdit = context.siteRole in CONTENT_ROLES
  val canPublish = context.siteRole in PUBLISH_ROLES

  AglynListDetail(
    initialSelected = initialPageId,
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        ListHeader("Pages") {
          OverflowMenu(listOf(MenuAction("new-group", "New group", "folder", enabled = canEdit) { dialog = PageDialog.NewGroup }))
          Button(onClick = { dialog = PageDialog.NewPage }, enabled = canEdit, modifier = Modifier.testTag("add-page")) {
            Icon(AglynIcons.named("add"), contentDescription = null)
            Text("New page", Modifier.padding(start = space(1f)))
          }
        }
        if (dialog == null) {
          runner.error?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.padding(horizontal = space(2f))) }
          runner.notice?.let { message ->
            NoticeBanner(message, StatusTone.SUCCESS, Modifier.padding(horizontal = space(2f)), action = { TextButton(onClick = runner::clear) { Text("Dismiss") } })
          }
        }
        when (val rows = live.rows) {
          Live.Loading -> SkeletonList(rows = 6)
          is Live.Failed -> EmptyState("Could not load this site's pages", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
          is Live.Ready -> if (rows.value.isEmpty()) {
            EmptyState("No pages yet", body = "Add a page, then design it in the Besigner.", icon = AglynIcons.named("description"))
          } else {
            LazyColumn(Modifier.fillMaxSize().testTag("pages-list")) {
              if (live.truncated) {
                item { NoticeBanner("This site has more than $PAGES_WINDOW pages; the first $PAGES_WINDOW are listed.", StatusTone.WARNING, Modifier.padding(horizontal = space(2f)).testTag("pages-truncated")) }
              }
              items(rows.value, key = { it.page.id }) { row ->
                PageRowItem(row, selected = row.page.id == selected) { onSelect(row.page.id) }
              }
            }
          }
        }
      }
    },
    detail = { selected ->
      val row = (live.rows as? Live.Ready)?.value?.firstOrNull { it.page.id == selected }
      if (row == null) {
        EmptyState("Pick a page to see it here", icon = AglynIcons.named("description"))
      } else {
        PageDetail(context, hostId, row, live.routing, api, runner, canEdit, canPublish) { dialog = it }
      }
    },
  )

  PageDialogs(dialog, live, api, runner, onSelectNew = { id -> context.navigate(SITE_PAGES_SCREEN, mapOf("page" to id)) }) { dialog = null }
}

@Composable
private fun PageRowItem(row: PageTreeRow, selected: Boolean, onClick: () -> Unit) {
  val status = pageStatus(row)
  Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Spacer(Modifier.width((row.depth * 20).dp))
    AglynListItem(
      title = row.page.name,
      supporting = when {
        row.page.isGroup -> if (row.childCount == 1) "1 page" else "${row.childCount} pages"
        row.livePath != null -> row.livePath
        else -> row.page.slug?.let { "/$it · not published" } ?: "No address yet"
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
  open: (PageDialog) -> Unit,
) {
  val page = row.page
  val uri = LocalUriHandler.current
  val now = remember(page.updatedAt) { nowMillis() }
  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("page-detail"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    SectionCard(null) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(page.name, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
        val actions = buildList {
          add(MenuAction("rename", if (page.isGroup) "Rename group" else "Rename", "edit", enabled = canEdit) { open(PageDialog.Rename(page)) })
          if (!page.isGroup) {
            add(MenuAction("duplicate", "Duplicate", "content_copy", enabled = canEdit) { open(PageDialog.Duplicate(page)) })
            add(MenuAction("move", "Move", "drive_file_move", enabled = canPublish) { open(PageDialog.Move(page)) })
            if (row.livePath != null) add(MenuAction("unpublish", "Unpublish", "visibility_off", enabled = canPublish) { open(PageDialog.Unpublish(page)) })
          }
          add(MenuAction("delete", if (page.isGroup) "Delete group" else "Delete", "delete", destructive = true, enabled = canPublish) { open(PageDialog.Delete(page, row.livePath)) })
        }
        OverflowMenu(actions)
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        val status = pageStatus(row)
        if (row.home) StatusChip("Home page", StatusTone.INFO)
        StatusChip(status.label, if (status.live) StatusTone.SUCCESS else StatusTone.NEUTRAL)
      }
      page.description?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      if (!page.isGroup) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          Button(
            onClick = { page.versionId?.let { context.openBesigner(BesignerPaths.screen(page.id, it), ConsoleScope.SITE) } },
            enabled = page.versionId != null,
            modifier = Modifier.testTag("page-edit-besigner"),
          ) {
            Icon(AglynIcons.named("design_services"), contentDescription = null)
            Text("Edit in the Besigner", Modifier.padding(start = space(1f)))
          }
          OutlinedButton(
            onClick = { open(PageDialog.Publish(page, if (row.home) "/" else page.slug.orEmpty())) },
            enabled = canPublish && page.kind != SCREEN_KIND_TEMPLATE,
            modifier = Modifier.testTag("page-publish"),
          ) { Text(if (row.livePath != null) "Change address" else "Publish") }
          val liveUrl = row.livePath?.let { livePageUrl(routing, it) }
          if (liveUrl != null) {
            OutlinedButton(onClick = { uri.openUri(liveUrl) }, modifier = Modifier.testTag("page-open-live")) {
              Icon(AglynIcons.named("open_in_new"), contentDescription = null)
              Text("Open live page", Modifier.padding(start = space(1f)))
            }
          }
        }
      }
    }
    if (!page.isGroup) {
      SectionCard("Details") {
        DetailRow("Address", row.livePath ?: page.slug?.let { "/$it (not published)" }, placeholder = "No address yet")
        DetailRow("Published", page.publishedAt?.let { relativeTime(it.epochMillis, now) }, placeholder = "Not published")
        DetailRow("Updated", page.updatedAt?.let { relativeTime(it.epochMillis, now) })
        DetailRow("Page id", page.id)
      }
      PageVersions(context, hostId, page, api, runner, canPublish)
    }
  }
}

@Composable
private fun PageVersions(context: NativePluginContext, hostId: String, page: PageNode, api: PagesApi, runner: ActionRunner, canPublish: Boolean) {
  val versions by remember(hostId, page.id, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/screens/${page.id}/versions", orderBy = listOf(FirestoreOrder("createdAt", descending = true)), limit = 20))
  }.collectAsState(Live.Loading)
  SectionCard("Versions") {
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
                    onClick = { runner.run("This version is now the page's working version.") { api.makeVersionLive(page.id, version.id) } },
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
private fun PageDialogs(dialog: PageDialog?, live: PagesLive, api: PagesApi, runner: ActionRunner, onSelectNew: (String) -> Unit, close: () -> Unit) {
  val done = { close() }
  when (dialog) {
    null -> Unit
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
        onConfirm = { runner.run("${name.trim()} was added as a draft.", onDone = done) { api.createPage(name, description) } },
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
          runner.run("Group ${name.trim()} added.", onDone = done) { api.createGroup(name, top) }
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
        onConfirm = { runner.run("Saved.", onDone = done) { api.rename(dialog.page.id, name, if (dialog.page.isGroup) null else description) } },
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
            runner.notice = "Published at ${path ?: "/" + slug.trim('/')}"
          }
        },
      ) {
        OutlinedTextField(slug, { slug = it }, label = { Text("Address") }, prefix = { Text(if (slug.startsWith("/")) "" else "/") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("publish-slug"))
      }
    }
    is PageDialog.Unpublish -> ActionDialog(
      title = "Unpublish ${dialog.page.name}?",
      body = "Visitors can no longer reach it. Pages inside it keep their addresses.",
      icon = "visibility_off",
      confirmLabel = "Unpublish",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = close,
      onConfirm = { runner.run("Page unpublished.", onDone = done) { api.unpublish(dialog.page.id) } },
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
          runner.run("Copy added as a draft.", onDone = done) { api.duplicate(dialog.page.id, name)?.let(onSelectNew) }
        },
      ) {
        OutlinedTextField(name, { name = it.take(PAGE_NAME_MAX) }, label = { Text("Name of the copy") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      }
    }
    is PageDialog.Move -> {
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
          runner.run("Moved.", onDone = done) { api.move(dialog.page.id, parent, siblings) }
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
        listOfNotNull(dialog.livePath?.let { "It is live at $it and stops answering there." }, "Pages inside it keep their addresses.").joinToString(" ")
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
