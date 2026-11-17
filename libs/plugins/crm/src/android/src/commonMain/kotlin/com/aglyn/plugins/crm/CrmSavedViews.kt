// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.crm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQuerySort
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.Busy
import com.aglyn.ui.FormSheet
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space

/*
 * Saved views on a CRM list (`crm-views-control.tsx`, `use-crm-saved-view.ts`, AGL-3669): the views menu beside the
 * filters. A view is `orgs/{orgId}/crmViews/{id}`, a named set of filter clauses with the visible columns and one sort;
 * the reader's own views and the shared ones are listed, opening one runs its clauses and sort through the list's own
 * query, and the reader's default view (on their profile) opens first.
 *
 * A phone list is rows, not a grid, so a view's columns are kept as saved and never changed here.
 */

const val CRM_VIEWS_COLLECTION = "crmViews"

/** `CRM_VIEWS_LIMIT`: the views one section's menu reads. */
const val CRM_VIEWS_LIMIT = 100

/** A view's key among the list's filters. */
const val CRM_VIEW_FILTER_PREFIX = "view:"

/** The section a view belongs to (`CrmViewSection`). */
val CrmKind.viewSection: String get() = collection

data class CrmViewClause(val field: String, val op: String, val value: String, val label: String? = null)

data class CrmViewSort(val field: String, val direction: String)

/** `CrmViewState`: the part of a view a list reads. */
data class CrmViewState(val filters: List<CrmViewClause> = emptyList(), val columns: List<String> = emptyList(), val sort: CrmViewSort? = null)

data class CrmSavedView(
  val id: String,
  val name: String,
  val ownerUid: String,
  val createdByUid: String,
  val shared: Boolean,
  val state: CrmViewState,
)

private fun viewText(value: Any?, max: Int): String = (value as? String)?.trim()?.take(max).orEmpty()

/** `normalizeCrmViewState`: a stored document's filters, columns and sort, held to their shapes. */
fun normalizeCrmViewState(data: Map<String, Any?>?): CrmViewState {
  val filters = mutableListOf<CrmViewClause>()
  for (raw in data?.get("filters") as? List<*> ?: emptyList<Any?>()) {
    val entry = raw as? Map<*, *> ?: emptyMap<Any?, Any?>()
    val field = viewText(entry["field"], 80)
    val op = viewText(entry["op"], 40)
    val value = viewText(entry["value"], 500)
    if (field.isEmpty() || op.isEmpty()) continue
    // A valued operator with no value would match nothing: dropped, as the console drops it.
    if (value.isEmpty() && op != "isEmpty" && op != "isNotEmpty") continue
    filters += CrmViewClause(field, op, value, viewText(entry["label"], 120).ifEmpty { null })
    if (filters.size >= Contracts.crmViewMaxFilters) break
  }
  val columns = LinkedHashSet<String>()
  for (raw in data?.get("columns") as? List<*> ?: emptyList<Any?>()) {
    viewText(raw, 80).takeIf { it.isNotEmpty() }?.let { columns += it }
    if (columns.size >= Contracts.crmViewMaxColumns) break
  }
  val sort = (data?.get("sort") as? Map<*, *>)?.let { entry ->
    viewText(entry["field"], 80).takeIf { it.isNotEmpty() }?.let { CrmViewSort(it, if (entry["direction"] == "desc") "desc" else "asc") }
  }
  return CrmViewState(filters, columns.toList(), sort)
}

/** `crmViewIsListed`: the reader's own view, or one somebody shared. */
fun crmViewIsListed(shared: Boolean, ownerUid: String, uid: String?): Boolean = shared || (!uid.isNullOrEmpty() && ownerUid == uid)

/** `crmDefaultViewId`: the view this reader opens a section on in this workspace, off their profile. */
fun crmDefaultViewId(profile: Map<String, Any?>?, orgId: String?, section: String): String? {
  if (profile == null || orgId.isNullOrEmpty()) return null
  val byOrg = profile[Contracts.crmDefaultViewsField] as? Map<*, *> ?: return null
  val bySection = byOrg[orgId] as? Map<*, *> ?: return null
  return (bySection[section] as? String)?.takeIf { it.isNotBlank() }
}

/** `crmDefaultViewPatch`: the merged write that sets (or clears, with null) the default. */
fun crmDefaultViewPatch(orgId: String, section: String, viewId: String?): Map<String, Any?> =
  mapOf(Contracts.crmDefaultViewsField to mapOf(orgId to mapOf(section to viewId)))

fun crmSavedView(doc: FirestoreDoc): CrmSavedView = CrmSavedView(
  doc.id, doc.data["name"] as? String ?: "", doc.data["ownerUid"] as? String ?: "", doc.data["createdByUid"] as? String ?: "",
  doc.data["shared"] == true, normalizeCrmViewState(doc.data),
)

/** The menu's views: named ones this reader may list, theirs first, then the shared ones (the menu's two halves). */
fun crmListedViews(docs: List<FirestoreDoc>, uid: String): Pair<List<CrmSavedView>, List<CrmSavedView>> {
  val views = docs.map(::crmSavedView).filter { it.name.isNotEmpty() && crmViewIsListed(it.shared, it.ownerUid, uid) }
  return views.filter { it.ownerUid == uid } to views.filter { it.ownerUid != uid }
}

/** `crmViewQuerySort`: the list's own order for the view's sort, or null when the list declares none for it. */
fun crmViewQuerySort(sorts: List<ListQuerySort>, sort: CrmViewSort?): ListQuerySort? =
  sort?.let { wanted -> sorts.firstOrNull { it.column == wanted.field && it.direction.raw == wanted.direction } }

/** A view as one of the list's filters: its clauses, and its sort when the list can serve it. */
fun crmViewFilter(view: CrmSavedView, kind: CrmKind): CrmFilter = CrmFilter(
  CRM_VIEW_FILTER_PREFIX + view.id, view.name, view.state.filters.map { ListFilterRequest(it.field, it.op, it.value) },
  sort = crmViewQuerySort(kind.declaration.sorts, view.state.sort),
)

/** The clauses a filter carries, as a view stores them. */
fun crmViewClauses(filter: CrmFilter): List<Map<String, Any?>> = filter.clauses.map { mapOf("field" to it.field, "op" to it.op, "value" to it.value) }

/** Who may change a view: its creator, or a member who reaches every site (`canEdit`). */
fun crmCanEditView(view: CrmSavedView, scope: CrmScope): Boolean = scope.uid.isNotEmpty() && (view.createdByUid == scope.uid || scope.orgWide)

/** The line under a view in the menu: shared, the reader's default, or both (as the console's menu says it). */
fun crmViewMenuDetail(view: CrmSavedView, uid: String, defaultId: String?): String? {
  val isDefault = view.id == defaultId
  if (view.ownerUid == uid && view.shared) return if (isDefault) "Shared · your default" else "Shared"
  return if (isDefault) "Your default" else null
}

/** A section's saved views and the reader's default view, live; null while either loads. */
class CrmViewsLive(val mine: List<CrmSavedView>, val shared: List<CrmSavedView>, val defaultId: String?) {
  val all: List<CrmSavedView> get() = mine + shared
}

@Composable
internal fun rememberCrmViews(context: NativePluginContext, scope: CrmScope, kind: CrmKind): CrmViewsLive? {
  val views = remember(scope.orgId, scope.hostId, kind, context.firestore) {
    context.firestore.observe(
      scopedQuery(
        scope, CRM_VIEWS_COLLECTION, filters = listOf(FirestoreFilter("section", FilterOp.EQ, kind.viewSection)),
        orderBy = listOf(FirestoreOrder("name")), limit = CRM_VIEWS_LIMIT,
      ),
    )
  }
  val profile = remember(scope.uid, context.firestore) { context.firestore.observeDoc("users/${scope.uid}") }
  val liveViews by views.collectAsState(Live.Loading)
  val liveProfile by profile.collectAsState(Live.Loading)
  val docs = (liveViews as? Live.Ready)?.value ?: return null
  val profileDoc = when (val live = liveProfile) {
    is Live.Ready -> live.value
    is Live.Failed -> null
    Live.Loading -> return null
  }
  val (mine, shared) = crmListedViews(docs, scope.uid)
  return CrmViewsLive(mine, shared, crmDefaultViewId(profileDoc?.data, scope.orgId, kind.viewSection))
}

private sealed interface CrmViewNaming {
  data object Create : CrmViewNaming
  data class Rename(val view: CrmSavedView) : CrmViewNaming
}

/** The views menu (`CrmViewsControl`): the views to open, then what the reader may do to the open one. */
@Composable
internal fun CrmViewsMenu(
  kind: CrmKind,
  scope: CrmScope,
  api: CrmApi,
  views: CrmViewsLive?,
  current: CrmFilter,
  onOpen: (String) -> Unit,
  onOpenAll: () -> Unit,
) {
  val coroutines = rememberCoroutineScope()
  var open by remember { mutableStateOf(false) }
  var naming by remember { mutableStateOf<CrmViewNaming?>(null) }
  var deleting by remember { mutableStateOf<CrmSavedView?>(null) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  val busy = remember(naming, deleting) { Busy() }
  val section = kind.viewSection
  val allLabel = "All ${kind.plural.lowercase()}"
  val openView = views?.all?.firstOrNull { CRM_VIEW_FILTER_PREFIX + it.id == current.key }
  val defaultId = views?.defaultId
  fun act(done: String, failed: String, work: suspend () -> Unit) {
    Busy().run(coroutines) {
      notice = try {
        work()
        done to StatusTone.SUCCESS
      } catch (error: Exception) {
        failed to StatusTone.ERROR
      }
    }
  }
  Column {
    Box {
      TextButton(onClick = { open = true }, modifier = Modifier.testTag("crm-views")) {
        Icon(AglynIcons.named("bookmark"), null)
        Text(openView?.name ?: "Views", maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      DropdownMenu(open, onDismissRequest = { open = false }) {
        if (!views?.mine.isNullOrEmpty()) {
          Text("My views", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = space(2f), vertical = space(1f)))
          for (view in views!!.mine) CrmViewMenuItem(view, openView?.id == view.id, crmViewMenuDetail(view, scope.uid, defaultId)) { open = false; onOpen(view.id) }
        }
        if (!views?.shared.isNullOrEmpty()) {
          Text("Shared with the team", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = space(2f), vertical = space(1f)))
          for (view in views!!.shared) CrmViewMenuItem(view, openView?.id == view.id, crmViewMenuDetail(view, scope.uid, defaultId)) { open = false; onOpen(view.id) }
        }
        if (!views?.all.isNullOrEmpty()) HorizontalDivider()
        DropdownMenuItem(
          text = { Text(if (openView == null) "Save as view…" else "Save as new view…") }, enabled = scope.uid.isNotEmpty(),
          onClick = { open = false; naming = CrmViewNaming.Create }, modifier = Modifier.testTag("crm-view-save-as"),
        )
        if (openView != null && crmCanEditView(openView, scope)) {
          DropdownMenuItem(text = { Text("Rename…") }, onClick = { open = false; naming = CrmViewNaming.Rename(openView) }, modifier = Modifier.testTag("crm-view-rename"))
          DropdownMenuItem(
            text = { Text(if (openView.shared) "Stop sharing" else "Share with the team") }, modifier = Modifier.testTag("crm-view-share"),
            onClick = {
              open = false
              act(if (openView.shared) "The view is yours alone again" else "The view is shared with the team", "The view could not be changed.") {
                api.shareView(openView.id, !openView.shared)
              }
            },
          )
        }
        if (openView != null) {
          val isDefault = defaultId == openView.id
          DropdownMenuItem(
            text = { Text(if (isDefault) "Clear default" else "Set as default") }, modifier = Modifier.testTag("crm-view-default"),
            onClick = {
              open = false
              act(if (isDefault) "$allLabel opens first again" else "“${openView.name}” opens first from now on", "The default could not be changed.") {
                api.setDefaultView(section, if (isDefault) null else openView.id)
              }
            },
          )
        } else if (defaultId != null) {
          DropdownMenuItem(
            text = { Text("Make ${allLabel.lowercase()} the default") }, modifier = Modifier.testTag("crm-view-default"),
            onClick = { open = false; act("$allLabel opens first again", "The default could not be changed.") { api.setDefaultView(section, null) } },
          )
        }
        if (openView != null && crmCanEditView(openView, scope)) {
          DropdownMenuItem(
            text = { Text("Delete view…", color = MaterialTheme.colorScheme.error) },
            onClick = { open = false; deleting = openView }, modifier = Modifier.testTag("crm-view-delete"),
          )
        }
      }
    }
    notice?.let { (text, tone) -> NoticeBanner(text, tone, Modifier.testTag("crm-view-notice")) }
  }
  naming?.let { mode ->
    val creating = mode is CrmViewNaming.Create
    var name by remember(mode) { mutableStateOf((mode as? CrmViewNaming.Rename)?.view?.name.orEmpty()) }
    var shared by remember(mode) { mutableStateOf(false) }
    FormSheet(
      if (creating) "Save as view" else "Rename view", busy, { naming = null },
      {
        val trimmed = name.trim().take(Contracts.crmViewNameMax.toInt())
        busy.run(coroutines, { naming = null }) {
          when (mode) {
            CrmViewNaming.Create -> {
              val id = api.createView(section, trimmed, shared, crmViewClauses(current), openView?.state?.columns.orEmpty(), openView?.state?.sort)
              notice = "View “$trimmed” saved" to StatusTone.SUCCESS
              onOpen(id)
            }
            is CrmViewNaming.Rename -> {
              api.renameView(mode.view.id, trimmed)
              notice = "Renamed to “$trimmed”" to StatusTone.SUCCESS
            }
          }
        }
      },
      confirmLabel = if (creating) "Save view" else "Rename", confirmEnabled = name.isNotBlank(),
    ) {
      Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
        if (creating) Text("The filters and sort as they are now, under a name you can open from the views menu.")
        OutlinedTextField(
          name, { name = it.take(Contracts.crmViewNameMax.toInt()) }, label = { Text("Name") }, singleLine = true,
          modifier = Modifier.fillMaxWidth().testTag("crm-view-name"),
        )
        if (creating) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Share with the team", Modifier.weight(1f))
            Switch(shared, { shared = it }, Modifier.testTag("crm-view-shared"))
          }
        }
      }
    }
  }
  deleting?.let { view ->
    ActionDialog(
      "Delete the view “${view.name}”?", "Delete view",
      {
        busy.run(coroutines, { deleting = null }) {
          api.deleteView(view.id)
          // A default pointing at nothing would open every visit on a missing view.
          if (defaultId == view.id) api.setDefaultView(section, null)
          notice = "View “${view.name}” deleted" to StatusTone.SUCCESS
          onOpenAll()
        }
      },
      { deleting = null },
      Modifier.testTag("crm-view-delete-confirm"),
      body = if (view.shared) "Everyone on the team who opens it will lose it; the ${kind.plural.lowercase()} themselves are untouched."
      else "The ${kind.plural.lowercase()} themselves are untouched.",
      busy = busy.busy, error = busy.error, destructive = true,
    )
  }
}

/** One view in the menu: a check on the open one, and the line saying it is shared or the reader's default. */
@Composable
private fun CrmViewMenuItem(view: CrmSavedView, picked: Boolean, detail: String?, onClick: () -> Unit) {
  DropdownMenuItem(
    text = {
      Column {
        Text(view.name)
        detail?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
      }
    },
    leadingIcon = { if (picked) Icon(AglynIcons.named("check"), null) },
    onClick = onClick, modifier = Modifier.testTag("crm-view-${view.id}"),
  )
}
