package com.aglyn.site.artifacts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.aglyn.contracts.ListQuerySort
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.RunnerBanners
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.SlotPlacement
import com.aglyn.pluginhost.SlotWidgets
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.CloseWhenGone
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.ListHeader
import com.aglyn.ui.Load
import com.aglyn.ui.LoadContent
import com.aglyn.ui.LoadMoreEffect
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.RefreshableBox
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SelectionPlaceholder
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space

/** Roles that may create and change a site's components, layouts and templates (`hostRoleCanWrite`). */
private val WRITE_ROLES = setOf("admin", "editor", "author")

/** The slot a plugin fills to publish a site's component or layout (the console's `hostArtifactPublish`). */
const val ARTIFACT_PUBLISH_SLOT = "hostArtifactPublish"

/** What a list's dialog is asking for. */
private sealed interface ArtifactDialog {
  data object Create : ArtifactDialog
  data class Details(val row: ArtifactRow) : ArtifactDialog
  data class Duplicate(val row: ArtifactRow) : ArtifactDialog
  data class Delete(val row: ArtifactRow, val siblings: List<ArtifactRow> = emptyList()) : ArtifactDialog
  data class DeleteBundle(val lead: ArtifactRow, val pages: List<ArtifactRow>) : ArtifactDialog
  /** The templates of this list's kind to start a new one from. */
  data object Gallery : ArtifactDialog
  /** Use this template: a page, component or layout (or a starter site's pages) made from it. */
  data class Use(val row: ArtifactRow) : ArtifactDialog
  data class SaveTemplate(val row: ArtifactRow) : ArtifactDialog
}

/**
 * A site's components, layouts or templates as the console lists them, the
 * picked one beside the list on wide windows: search, the kind filter,
 * create, edit the details (and a layout's parent), duplicate, delete, the
 * versions and what uses it, and the Besigner for the design itself.
 */
@Composable
fun ArtifactsScreen(context: NativePluginContext, kind: ArtifactKind, initialId: String? = null) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val model = remember(hostId, kind) { ArtifactListModel(kind, hostId, context.firestore, scope) }
  LaunchedEffect(model) { model.reload() }
  val quota = remember(hostId, kind, context.api, context.firestore) { ArtifactQuotaModel(kind, hostId, context.api, context.firestore) }
  LaunchedEffect(quota) { quota.loadPlan() }
  // The rows the window holds change when something is created or deleted, which is when the count is asked again.
  val rowsKey = (model.rows as? Load.Ready)?.value?.joinToString(",") { it.id }
  LaunchedEffect(quota, rowsKey) { quota.recount() }
  val runner = remember(hostId, kind) { ActionRunner(scope) }
  val api = remember(hostId, kind, context.api, context.writer) { ArtifactsApi(context.api, context.writer, hostId, kind) }
  var dialog by remember { mutableStateOf<ArtifactDialog?>(null) }
  val canEdit = context.siteRole in WRITE_ROLES

  AglynListDetail(
    initialSelected = initialId,
    onItemRemoved = { model.reload(keep = true) },
    // A phone shows one without the list, so it carries the list's banners.
    detailBanner = { if (dialog == null) RunnerBanners(runner) },
    list = { selected, onSelect ->
      val listState = rememberLazyListState()
      LoadMoreEffect(listState, model.hasMore, onLoadMore = model::loadMore)
      Column(Modifier.fillMaxSize()) {
        ListHeader(kind.title) {
          if (kind != ArtifactKind.TEMPLATE) {
            OutlinedButton(onClick = { dialog = ArtifactDialog.Gallery }, enabled = canEdit, modifier = Modifier.testTag("from-template-${kind.singular}")) { Text("From a template") }
          }
          com.aglyn.ui.ListHeaderAction("New ${kind.singular}", "add", { dialog = ArtifactDialog.Create }, Modifier.testTag("add-${kind.singular}"), enabled = canEdit)
          // Create with AI and anything else a plugin puts beside New (the console's zone for this list).
          SlotWidgets(context, kind.createZone, SlotPlacement.HEADER)
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = space(2f)), verticalAlignment = Alignment.CenterVertically) {
          val shown = quota.count ?: (model.rows as? Load.Ready)?.value?.size ?: 0
          Text(
            artifactQuotaReadout(shown, quota.limit, quota.ready, kind.singular),
            Modifier.weight(1f).testTag("${kind.singular}-quota"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          ArtifactSortMenu(kind, model.sort, model::order)
        }
        model.notices.forEach { notice ->
          Text(notice, Modifier.padding(horizontal = space(2f)).testTag("${kind.singular}-sort-notice"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          SearchField(model.search, model::type, placeholder = "Search ${kind.title.lowercase()}")
          if (kind.kindChoices.isNotEmpty()) {
            ChoiceChipRow(kind.kindChoices.map { ChipOption(it.first ?: "all", it.second) }, model.kindFilter ?: "all", { model.pick(it.takeIf { key -> key != "all" }) })
          }
          if (dialog == null) RunnerBanners(runner)
        }
        RefreshableBox(model.refreshing, model::refresh) {
          LoadContent(model.rows, onRetry = { model.reload() }, failedTitle = "Could not load ${kind.title.lowercase()}") { rows ->
            if (rows.isEmpty()) {
              val unfiltered = model.search.isBlank() && model.kindFilter == null
              EmptyState(
                if (unfiltered) "No ${kind.title.lowercase()} yet" else "No ${kind.title.lowercase()} match",
                body = if (model.search.isBlank()) emptyBody(kind) else "Try another search.",
                icon = AglynIcons.named(kind.icon),
                action = if (unfiltered && context.slotWidgets(kind.createZone).isNotEmpty()) {
                  { SlotWidgets(context, kind.createZone) }
                } else {
                  null
                },
              )
            } else {
              LazyColumn(Modifier.fillMaxSize().testTag("${kind.collection}-list"), state = listState) {
                items(rows, key = { it.id }) { row -> ArtifactListRow(kind, row, row.id == selected) { onSelect(row.id) } }
                if (model.hasMore) item { SkeletonList(rows = 2) }
              }
            }
          }
        }
      }
    },
    detail = { selected ->
      if (selected == null) {
        SelectionPlaceholder("Pick a ${kind.singular} to see it here", icon = AglynIcons.named(kind.icon))
      } else {
        ArtifactDetail(context, hostId, kind, selected, api, runner, canEdit) { dialog = it }
      }
    },
  )

  ArtifactDialogs(context, hostId, kind, dialog, api, runner, onCreated = { id ->
    model.reload()
    context.navigate(kind.screen, mapOf("id" to id))
  }, onDeleted = model::drop, onOpen = { dialog = it }) { dialog = null }
}

/** The header sorts the console's tables give each column, as one menu: the default walk, then every column in either direction. */
@Composable
private fun ArtifactSortMenu(kind: ArtifactKind, sort: ListQuerySort?, onSort: (ListQuerySort?) -> Unit) {
  var open by remember { mutableStateOf(false) }
  Box {
    TextButton(
      onClick = { open = true },
      modifier = Modifier.testTag("sort-${kind.collection}").semantics { contentDescription = "Sort: ${sort?.let(::artifactSortLabel) ?: "Default order"}" },
    ) {
      Icon(AglynIcons.named("sort"), contentDescription = null)
      Text(sort?.let(::artifactSortLabel) ?: "Sort", Modifier.padding(start = space(1f)))
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      DropdownMenuItem(
        text = { Text("Default order") },
        trailingIcon = { if (sort == null) Icon(AglynIcons.named("check"), null) },
        onClick = { open = false; onSort(null) },
      )
      for (choice in artifactSortChoices(kind)) {
        DropdownMenuItem(
          text = { Text(artifactSortLabel(choice)) },
          trailingIcon = { if (choice == sort) Icon(AglynIcons.named("check"), null) },
          onClick = { open = false; onSort(choice) },
          modifier = Modifier.testTag("sort-${kind.collection}-${choice.column}-${choice.direction.raw}"),
        )
      }
    }
  }
}

private fun emptyBody(kind: ArtifactKind) = when (kind) {
  ArtifactKind.COMPONENT -> "A component is a design you place on many pages and change in one place."
  ArtifactKind.LAYOUT -> "A layout wraps pages in a shared header and footer."
  ArtifactKind.TEMPLATE -> "Save a page, component or layout as a template to start new ones from it."
}

private fun rowSupporting(kind: ArtifactKind, row: ArtifactRow): String = listOfNotNull(
  when (kind) {
    ArtifactKind.COMPONENT -> "Used in ${componentPlacementLabel(row.kind).lowercase()}s"
    ArtifactKind.TEMPLATE -> templateKindLabel(row.kind)
    ArtifactKind.LAYOUT -> null
  },
  row.description,
).joinToString(" · ").ifEmpty { "No description" }

@Composable
private fun ArtifactListRow(kind: ArtifactKind, row: ArtifactRow, selected: Boolean, onClick: () -> Unit) {
  AglynListItem(
    title = if (row.isStarterBundle) row.starterName ?: row.name else row.name,
    supporting = rowSupporting(kind, row),
    icon = AglynIcons.named(kind.icon),
    selected = selected,
    trailing = {
      when {
        kind == ArtifactKind.TEMPLATE -> StatusChip(if (row.isStarterBundle) "Starter bundle" else templateSourceLabel(row.sourceType), StatusTone.NEUTRAL)
        row.versionId == null -> StatusChip("No version yet", StatusTone.NEUTRAL)
        else -> Unit
      }
    },
    onClick = onClick,
    modifier = Modifier.testTag("${kind.singular}-${row.id}"),
  )
}

@Composable
private fun ArtifactDetail(
  context: NativePluginContext,
  hostId: String,
  kind: ArtifactKind,
  id: String,
  api: ArtifactsApi,
  runner: ActionRunner,
  canEdit: Boolean,
  open: (ArtifactDialog) -> Unit,
) {
  val live by remember(hostId, kind, id, context.firestore) { context.firestore.observeDoc("hosts/$hostId/${kind.collection}/$id") }.collectAsState(Live.Loading)
  // A deleted one closes its detail and drops out of the list.
  CloseWhenGone((live as? Live.Ready)?.let { ready -> ready.value?.let(ArtifactRow::from) != null })
  when (val doc = live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this ${kind.singular}", body = "Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
    is Live.Ready -> {
      val row = doc.value?.let(ArtifactRow::from) ?: return EmptyState("This ${kind.singular} is gone", icon = AglynIcons.named(kind.icon))
      val versions = if (kind.versionKind != null) artifactVersions(context, hostId, kind, id) else Live.Ready(emptyList())
      val now = remember(row.updatedAt) { nowMillis() }
      Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("${kind.singular}-detail"),
        verticalArrangement = Arrangement.spacedBy(space(2f)),
      ) {
        val siblings = if (row.isStarterBundle) starterSiblings(context, hostId, row) else emptyList()
        SectionCard(null) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text(row.name, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
            OverflowMenu(
              buildList {
                add(MenuAction("details", "Edit details", "edit", enabled = canEdit) { open(ArtifactDialog.Details(row)) })
                if (!row.isStarterBundle) add(MenuAction("duplicate", "Duplicate", "content_copy", enabled = canEdit) { open(ArtifactDialog.Duplicate(row)) })
                if (kind != ArtifactKind.TEMPLATE) add(MenuAction("save-template", "Save as template", "bookmark", enabled = canEdit) { open(ArtifactDialog.SaveTemplate(row)) })
                // Publishing is the marketplace's (the console's `hostArtifactPublish` zone): offered only where a plugin fills the
                // zone, opening its form with what this is and what it is called.
                if (kind != ArtifactKind.TEMPLATE && context.slotWidgets(ARTIFACT_PUBLISH_SLOT).isNotEmpty()) {
                  add(
                    MenuAction("publish", "Publish to marketplace", "storefront") {
                      context.navigate(
                        if (kind == ArtifactKind.COMPONENT) "marketplace.publishComponent" else "marketplace.publishLayout",
                        mapOf("id" to row.id, "name" to row.name, "description" to row.description.orEmpty()),
                      )
                    },
                  )
                }
                add(
                  MenuAction("delete", if (row.isStarterBundle) "Delete bundle" else "Delete", "delete", destructive = true, enabled = canEdit) {
                    open(if (row.isStarterBundle) ArtifactDialog.DeleteBundle(row, siblings.ifEmpty { listOf(row) }) else ArtifactDialog.Delete(row))
                  },
                )
              },
            )
          }
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
            when (kind) {
              ArtifactKind.COMPONENT -> StatusChip("Used in ${componentPlacementLabel(row.kind).lowercase()}s", StatusTone.INFO)
              ArtifactKind.TEMPLATE -> {
                StatusChip(templateKindLabel(row.kind), StatusTone.INFO)
                StatusChip(templateSourceLabel(row.sourceType), StatusTone.NEUTRAL)
              }
              ArtifactKind.LAYOUT -> Unit
            }
          }
          row.description?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
            val readyVersions = (versions as? Live.Ready)?.value.orEmpty()
            Button(
              onClick = {
                when (kind) {
                  ArtifactKind.TEMPLATE -> context.openBesigner(artifactBesignerPath(kind, row.id, null)!!, ConsoleScope.SITE)
                  else -> runner.run {
                    val versionId = api.ensureVersion(row, readyVersions)
                    artifactBesignerPath(kind, row.id, versionId)?.let { context.openBesigner(it, ConsoleScope.SITE) }
                  }
                }
              },
              enabled = !runner.busy && (kind == ArtifactKind.TEMPLATE || versions is Live.Ready) && (canEdit || versionToOpen(row, readyVersions) != null),
              modifier = Modifier.testTag("artifact-edit-besigner"),
            ) {
              Icon(AglynIcons.named("design_services"), contentDescription = null)
              Text("Edit in the Besigner", Modifier.padding(start = space(1f)))
            }
            val previewPath = artifactBesignerPath(kind, row.id, row.versionId, preview = true)
            OutlinedButton(onClick = { previewPath?.let { context.openBesigner(it, ConsoleScope.SITE) } }, enabled = previewPath != null, modifier = Modifier.testTag("artifact-preview")) {
              Icon(AglynIcons.named("visibility"), contentDescription = null)
              Text("Preview", Modifier.padding(start = space(1f)))
            }
            if (kind == ArtifactKind.TEMPLATE) {
              Button(onClick = { open(ArtifactDialog.Use(row)) }, enabled = canEdit, modifier = Modifier.testTag("use-template")) {
                Icon(AglynIcons.named("add"), contentDescription = null)
                Text(if (row.isStarterBundle) "Use this starter site" else "Use this template", Modifier.padding(start = space(1f)))
              }
            }
          }
          if (kind == ArtifactKind.TEMPLATE) {
            Text(
              "Starting a page, component or layout from a template happens in the Besigner's template gallery.",
              style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
        SectionCard("Details") {
          if (kind == ArtifactKind.LAYOUT) {
            val parent = row.parentLayoutId?.let { parentId -> layoutName(context, hostId, parentId) }
            DetailRow("Renders inside", parent, placeholder = "Nothing — it is the outermost layout")
          }
          DetailRow("Updated", row.updatedAt?.let { relativeTime(it.epochMillis, now) })
          DetailRow("Created", row.createdAt?.let { relativeTime(it.epochMillis, now) })
          DetailRow("ID", row.id)
        }
        if (row.isStarterBundle) StarterBundleCard(context, kind, row, siblings, canEdit, open)
        if (kind.versionKind != null) {
          VersionsCard(context, kind, row, versions)
          UsedByCard(api, row)
        }
      }
    }
  }
}

@Composable
private fun artifactVersions(context: NativePluginContext, hostId: String, kind: ArtifactKind, id: String): Live<List<ArtifactVersion>> {
  val live by remember(hostId, kind, id, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/${kind.collection}/$id/versions", limit = 100))
  }.collectAsState(Live.Loading)
  return when (val value = live) {
    Live.Loading -> Live.Loading
    is Live.Failed -> value
    is Live.Ready -> Live.Ready(sortedVersions(value.value.map(::artifactVersionOf)))
  }
}

@Composable
private fun layoutName(context: NativePluginContext, hostId: String, layoutId: String): String {
  val live by remember(hostId, layoutId, context.firestore) { context.firestore.observeDoc("hosts/$hostId/layouts/$layoutId") }.collectAsState(Live.Loading)
  return ((live as? Live.Ready)?.value?.string("displayName")) ?: layoutId
}

/** The pages of a starter bundle, in the bundle's order. */
@Composable
private fun starterSiblings(context: NativePluginContext, hostId: String, row: ArtifactRow): List<ArtifactRow> {
  val starterId = row.starterId ?: return emptyList()
  val live by remember(hostId, starterId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/templates", filters = listOf(FirestoreFilter("source.starterId", FilterOp.EQ, starterId)), limit = 100))
  }.collectAsState(Live.Loading)
  return (live as? Live.Ready)?.value.orEmpty().mapNotNull(ArtifactRow::from).sortedBy { it.starterOrder ?: Long.MAX_VALUE }
}

@Composable
private fun StarterBundleCard(context: NativePluginContext, kind: ArtifactKind, lead: ArtifactRow, siblings: List<ArtifactRow>, canEdit: Boolean, open: (ArtifactDialog) -> Unit) {
  SectionCard("Starter bundle") {
    if (siblings.isEmpty()) Text("Loading the bundle's pages…", color = MaterialTheme.colorScheme.onSurfaceVariant)
    siblings.forEachIndexed { index, page ->
      if (index > 0) HorizontalDivider()
      AglynListItem(
        title = page.name,
        supporting = page.description,
        icon = AglynIcons.named("description"),
        trailing = {
          Row {
            TextButton(onClick = { artifactBesignerPath(kind, page.id, null)?.let { context.openBesigner(it, ConsoleScope.SITE) } }) { Text("Open") }
            TextButton(onClick = { open(ArtifactDialog.Delete(page, siblings)) }, enabled = canEdit) { Text("Delete") }
          }
        },
        modifier = Modifier.testTag("starter-page-${page.id}"),
      )
    }
    if (lead.starterName != null) Text("${siblings.size} pages from ${lead.starterName}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable
private fun VersionsCard(context: NativePluginContext, kind: ArtifactKind, row: ArtifactRow, versions: Live<List<ArtifactVersion>>) {
  SectionCard("Versions") {
    when (versions) {
      Live.Loading -> SkeletonList(rows = 2)
      is Live.Failed -> Text("Versions could not be loaded.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      is Live.Ready -> {
        val rows = versions.value
        if (rows.isEmpty()) Text("No saved versions yet. Edit it in the Besigner to make the first.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        val now = remember(rows.size) { nowMillis() }
        rows.forEachIndexed { index, version ->
          if (index > 0) HorizontalDivider()
          AglynListItem(
            title = version.name ?: "Version ${rows.size - index}",
            supporting = listOfNotNull(
              version.createdAt?.let { "Saved " + relativeTime(it.epochMillis, now) },
              version.updatedAt?.takeIf { it != version.createdAt }?.let { "edited " + relativeTime(it.epochMillis, now) },
            ).joinToString(" · "),
            icon = AglynIcons.named("history"),
            trailing = {
              Row(verticalAlignment = Alignment.CenterVertically) {
                if (version.id == row.versionId) StatusChip("Current", StatusTone.SUCCESS)
                TextButton(onClick = { artifactBesignerPath(kind, row.id, version.id)?.let { context.openBesigner(it, ConsoleScope.SITE) } }) { Text("Open") }
              }
            },
            modifier = Modifier.testTag("artifact-version-${version.id}"),
          )
        }
      }
    }
  }
}

@Composable
private fun UsedByCard(api: ArtifactsApi, row: ArtifactRow) {
  val usage by produceState<Load3>(Load3.Loading, row.id) {
    value = runCatching { api.usage(row) }.fold({ Load3.Ready(it) }, { Load3.Failed })
  }
  SectionCard("Used by") {
    when (val state = usage) {
      Load3.Loading -> SkeletonList(rows = 2)
      Load3.Failed -> Text("Where it is used could not be checked.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      is Load3.Ready -> {
        val found = state.usage?.dependents.orEmpty()
        if (found.isEmpty()) {
          Text(if (state.usage?.complete == true) "Nothing uses it yet." else "Nothing found so far; the check could not read everything.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        found.forEachIndexed { index, item ->
          if (index > 0) HorizontalDivider()
          AglynListItem(title = item.name, supporting = dependentLabel(item.type), icon = AglynIcons.named(if (item.type == "screen") "description" else "widgets"))
        }
      }
    }
  }
}

private sealed interface Load3 {
  data object Loading : Load3
  data object Failed : Load3
  data class Ready(val usage: ArtifactUsage?) : Load3
}

@Composable
private fun ArtifactDialogs(
  context: NativePluginContext,
  hostId: String,
  kind: ArtifactKind,
  dialog: ArtifactDialog?,
  api: ArtifactsApi,
  runner: ActionRunner,
  onCreated: (String) -> Unit,
  onDeleted: (String) -> Unit,
  onOpen: (ArtifactDialog) -> Unit,
  close: () -> Unit,
) {
  when (dialog) {
    null -> Unit
    ArtifactDialog.Gallery -> TemplateGalleryDialog(context, hostId, if (kind == ArtifactKind.LAYOUT) "layout" else "component", onChoose = { onOpen(ArtifactDialog.Use(it)) }, onDismiss = close)
    is ArtifactDialog.Use -> UseTemplateDialog(
      context,
      hostId,
      dialog.row,
      onDone = { usedKind, id ->
        close()
        val (screen, params) = templateUseDestination(usedKind, id)
        context.navigate(screen, params)
      },
      onDismiss = close,
    )
    is ArtifactDialog.SaveTemplate -> SaveAsTemplateDialog(
      context,
      hostId,
      kind = if (kind == ArtifactKind.LAYOUT) "layout" else "component",
      defaultName = dialog.row.name,
      load = { templates -> if (kind == ArtifactKind.LAYOUT) templates.layoutSource(dialog.row.id, dialog.row.versionId) else templates.componentSource(dialog.row.id) },
      onSaved = { message ->
        runner.notice = message
        close()
      },
      onDismiss = close,
    )
    ArtifactDialog.Create -> {
      var name by remember { mutableStateOf("") }
      var description by remember { mutableStateOf("") }
      var subKind by remember { mutableStateOf<String?>(if (kind == ArtifactKind.COMPONENT) "site" else if (kind == ArtifactKind.TEMPLATE) "page" else null) }
      var starter by remember { mutableStateOf("header") }
      ActionDialog(
        title = "New ${kind.singular}",
        body = when (kind) {
          ArtifactKind.COMPONENT -> "Design it in the Besigner. A block for emails can start as a Header or a Footer."
          ArtifactKind.LAYOUT -> "It starts with the slot pages appear in; design the rest in the Besigner."
          ArtifactKind.TEMPLATE -> "It starts blank; design it in the Besigner, then start new pages from it."
        },
        icon = kind.icon,
        confirmLabel = "Create",
        confirmEnabled = name.isNotBlank(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = {
          runner.run("${name.trim()} was created.", onDone = close) { onCreated(api.create(name, description, subKind, starter)) }
        },
      ) {
        OutlinedTextField(name, { name = it.take(ARTIFACT_NAME_MAX) }, label = { Text("Name") }, singleLine = true, supportingText = { Text("${name.length}/$ARTIFACT_NAME_MAX") }, modifier = Modifier.fillMaxWidth().testTag("artifact-name"))
        OutlinedTextField(description, { description = it.take(ARTIFACT_DESCRIPTION_MAX) }, label = { Text("Description (optional)") }, supportingText = { Text("${description.length}/$ARTIFACT_DESCRIPTION_MAX") }, modifier = Modifier.fillMaxWidth())
        when (kind) {
          ArtifactKind.COMPONENT -> {
            SelectField("Used in", listOf(SelectOption("site", "Pages"), SelectOption("email", "Emails")), subKind, { subKind = it ?: "site" })
            if (subKind == "email") {
              SelectField(
                "Start with",
                listOf(SelectOption("header", "Header — your logo and company name"), SelectOption("footer", "Footer — your address, and why people get your emails"), SelectOption("blank", "Blank — start with nothing")),
                starter,
                { starter = it ?: "header" },
                supporting = "Change anything you like after.",
              )
            }
          }
          ArtifactKind.TEMPLATE -> SelectField("Kind", com.aglyn.contracts.Contracts.templateKindOptions.map { SelectOption(it.value, it.label) }, subKind, { subKind = it ?: "page" })
          ArtifactKind.LAYOUT -> Unit
        }
      }
    }
    is ArtifactDialog.Details -> {
      var name by remember(dialog) { mutableStateOf(dialog.row.name) }
      var description by remember(dialog) { mutableStateOf(dialog.row.description.orEmpty()) }
      var parent by remember(dialog) { mutableStateOf(dialog.row.parentLayoutId) }
      var icon by remember(dialog) { mutableStateOf(dialog.row.icon) }
      var choosingIcon by remember(dialog) { mutableStateOf(false) }
      val parents = if (kind == ArtifactKind.LAYOUT) layoutChoices(context, hostId, dialog.row.id) else emptyList()
      ActionDialog(
        title = "Edit details",
        icon = "edit",
        confirmLabel = "Save",
        confirmEnabled = name.isNotBlank(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = {
          runner.run("Saved.", onDone = close) {
            api.saveDetails(
              dialog.row.id, name, description, parent, setParent = kind == ArtifactKind.LAYOUT && parent != dialog.row.parentLayoutId,
              icon = if (kind == ArtifactKind.COMPONENT && icon?.id != dialog.row.icon?.id) icon?.stored() ?: emptyMap() else null,
            )
          }
        },
      ) {
        OutlinedTextField(name, { name = it.take(ARTIFACT_NAME_MAX) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("details-name"))
        OutlinedTextField(description, { description = it.take(ARTIFACT_DESCRIPTION_MAX) }, label = { Text("Description") }, modifier = Modifier.fillMaxWidth())
        if (kind == ArtifactKind.COMPONENT) {
          ComponentIconField(icon, enabled = !runner.busy, onChoose = { choosingIcon = true }, onClear = { icon = null })
        }
        if (kind == ArtifactKind.LAYOUT) {
          SelectField(
            "Renders inside",
            parents.map { SelectOption(it.id, it.name) },
            parent,
            { parent = it },
            noneLabel = "Nothing (outermost layout)",
            supporting = "Pages using this layout are wrapped in that one too.",
          )
        }
      }
      if (choosingIcon) ComponentIconPicker(context.api, icon, { icon = it; choosingIcon = false }, { choosingIcon = false })
    }
    is ArtifactDialog.Duplicate -> {
      var name by remember(dialog) { mutableStateOf((DUPLICATE_NAME_PREFIX + dialog.row.name).take(DUPLICATE_NAME_MAX)) }
      ActionDialog(
        title = "Duplicate ${dialog.row.name}",
        icon = "content_copy",
        confirmLabel = "Duplicate",
        confirmEnabled = name.isNotBlank(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = { runner.run("Copy added.", onDone = close) { api.duplicate(dialog.row.id, name)?.let(onCreated) } },
      ) {
        OutlinedTextField(name, { name = it.take(DUPLICATE_NAME_MAX) }, label = { Text("Name of the copy") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      }
    }
    is ArtifactDialog.DeleteBundle -> ActionDialog(
      title = "Delete ${dialog.lead.starterName ?: dialog.lead.name}?",
      body = "All ${dialog.pages.size} pages of this starter bundle leave the library. Pages already made from them keep their design.",
      icon = "delete",
      confirmLabel = "Delete bundle",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = close,
      onConfirm = {
        runner.run("The bundle was deleted.", onDone = close) {
          api.deleteBundle(dialog.pages)
          onDeleted(dialog.lead.id)
        }
      },
    )
    is ArtifactDialog.Delete -> ActionDialog(
      title = "Delete ${dialog.row.name}?",
      body = when {
        dialog.siblings.size > 1 -> "This page leaves the starter bundle; the others stay."
        kind == ArtifactKind.TEMPLATE -> "Pages already made from it keep their design."
        else -> "Pages that use it stop showing it. Check \"Used by\" first."
      },
      icon = "delete",
      confirmLabel = "Delete",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = close,
      onConfirm = {
        runner.run("${dialog.row.name} was deleted.", onDone = close) {
          if (dialog.siblings.isNotEmpty()) {
            api.deleteBundlePage(dialog.row, dialog.siblings, wasLead = dialog.row.libraryRow)
          } else {
            api.delete(dialog.row.id)
          }
          onDeleted(dialog.row.id)
        }
      },
    )
  }
}

/** The layouts this one may render inside. */
@Composable
private fun layoutChoices(context: NativePluginContext, hostId: String, layoutId: String): List<ArtifactRow> {
  val live by remember(hostId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/layouts", orderBy = listOf(FirestoreOrder("__name__")), limit = 100))
  }.collectAsState(Live.Loading)
  return nestableParents(layoutId, (live as? Live.Ready)?.value.orEmpty().mapNotNull(ArtifactRow::from))
}
