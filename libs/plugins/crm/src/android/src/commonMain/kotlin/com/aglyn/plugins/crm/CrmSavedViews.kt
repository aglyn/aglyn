// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.crm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
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

/**
 * A view as one of the list's filters: its clauses as the list's query asks them ([ask], the list's translation), the
 * ones it cannot ask named with why, and its sort when the list can serve it.
 */
fun crmViewFilter(view: CrmSavedView, kind: CrmKind, ask: (ListFilterRequest) -> CrmClauseAsked = { CrmClauseAsked.Asked(it) }): CrmFilter {
  val stored = view.state.filters.map { ListFilterRequest(it.field, it.op, it.value) }
  val asked = mutableListOf<ListFilterRequest>()
  val refused = mutableListOf<CrmViewRefusal>()
  stored.zip(view.state.filters).forEach { (clause, saved) ->
    when (val one = ask(clause)) {
      is CrmClauseAsked.Asked -> asked += one.clause
      is CrmClauseAsked.Refused -> refused += CrmViewRefusal(ListFilterRequest(saved.field, saved.op, saved.label ?: saved.value), one.reason)
    }
  }
  return CrmFilter(
    CRM_VIEW_FILTER_PREFIX + view.id, view.name, asked, sort = crmViewQuerySort(kind.declaration.sorts, view.state.sort),
    stored = stored, refused = refused,
  )
}

/** The clauses a filter carries, as a view stores them: the reader's own (a chip's or a view's), never the translation its query asks. */
fun crmViewClauses(filter: CrmFilter): List<Map<String, Any?>> =
  (filter.stored ?: filter.clauses).map { mapOf("field" to it.field, "op" to it.op, "value" to it.value) }

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
internal fun rememberCrmViews(context: NativePluginContext, scope: CrmScope, section: String): CrmViewsLive? {
  val views = remember(scope.orgId, scope.hostId, section, context.firestore) {
    context.firestore.observe(
      scopedQuery(
        scope, CRM_VIEWS_COLLECTION, filters = listOf(FirestoreFilter("section", FilterOp.EQ, section)),
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
  return CrmViewsLive(mine, shared, crmDefaultViewId(profileDoc?.data, scope.orgId, section))
}

private sealed interface CrmViewNaming {
  data object Create : CrmViewNaming
  data class Rename(val view: CrmSavedView) : CrmViewNaming
}

/** The views menu (`CrmViewsControl`): the views to open, then what the reader may do to the open one. */
@Composable
internal fun CrmViewsMenu(
  /** The section the views belong to (`contacts`, … `tasks`) and what its records are called ("Tasks"). */
  section: String,
  plural: String,
  scope: CrmScope,
  api: CrmApi,
  views: CrmViewsLive?,
  current: CrmFilter,
  onOpen: (String) -> Unit,
  /** What an act came to ("View … saved"), which the list shows under its filters. */
  onNotice: (String, StatusTone) -> Unit,
  onOpenAll: () -> Unit,
) {
  val coroutines = rememberCoroutineScope()
  var open by remember { mutableStateOf(false) }
  var naming by remember { mutableStateOf<CrmViewNaming?>(null) }
  var deleting by remember { mutableStateOf<CrmSavedView?>(null) }
  val busy = remember(naming, deleting) { Busy() }
  val allLabel = "All ${plural.lowercase()}"
  val openView = views?.all?.firstOrNull { CRM_VIEW_FILTER_PREFIX + it.id == current.key }
  val defaultId = views?.defaultId
  fun act(done: String, failed: String, work: suspend () -> Unit) {
    Busy().run(coroutines) {
      try {
        work()
        onNotice(done, StatusTone.SUCCESS)
      } catch (error: Exception) {
        onNotice(failed, StatusTone.ERROR)
      }
    }
  }
  Box {
    TextButton(onClick = { open = true }, modifier = Modifier.widthIn(max = space(22f)).testTag("crm-views")) {
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
              onNotice("View “$trimmed” saved", StatusTone.SUCCESS)
              onOpen(id)
            }
            is CrmViewNaming.Rename -> {
              api.renameView(mode.view.id, trimmed)
              onNotice("Renamed to “$trimmed”", StatusTone.SUCCESS)
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
          onNotice("View “${view.name}” deleted", StatusTone.SUCCESS)
          onOpenAll()
        }
      },
      { deleting = null },
      Modifier.testTag("crm-view-delete-confirm"),
      body = if (view.shared) "Everyone on the team who opens it will lose it; the ${plural.lowercase()} themselves are untouched."
      else "The ${plural.lowercase()} themselves are untouched.",
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

/** The section saved views of tasks belong to. */
const val CRM_TASK_VIEW_SECTION = "tasks"

/**
 * A saved view of tasks as the list opens it (`tasks-section.tsx`): the task view its `view` clause holds ("My
 * tasks" without one), the rest of its clauses on the query, and its sort when the list declares it.
 */
data class CrmTaskViewOpen(val view: TaskView, val clauses: List<ListFilterRequest>, val sort: ListQuerySort?)

fun crmTaskViewOpen(saved: CrmSavedView): CrmTaskViewOpen {
  val value = saved.state.filters.firstOrNull { it.field == "view" }?.value
  return CrmTaskViewOpen(
    TaskView.entries.firstOrNull { it.key == value } ?: TaskView.MINE,
    saved.state.filters.filter { it.field != "view" }.map { ListFilterRequest(it.field, it.op, it.value) },
    crmViewQuerySort(Contracts.taskListDeclaration.sorts, saved.state.sort),
  )
}

/** What a task list saves as a view: its task view (none for "My tasks", which no clause reads as), then the open view's other clauses. */
fun crmTaskViewFilter(view: TaskView, open: CrmSavedView?): CrmFilter = CrmFilter(
  open?.let { CRM_VIEW_FILTER_PREFIX + it.id } ?: "task:${view.key}", open?.name ?: view.label,
  (if (view == TaskView.MINE) emptyList() else listOf(ListFilterRequest("view", "equals", view.key))) + (open?.let { crmTaskViewOpen(it).clauses } ?: emptyList()),
)

/*
 * A stored clause as the list's query asks it (`crm-list-query.ts`, `contact-filters.ts`, `deal-filters.ts`,
 * `lead-filters.ts`): a view keeps the clauses a reader set; each list translates them into the fields its records keep.
 */

/** How one stored clause is asked: a query clause, or why it cannot be (`CrmClauseAsked`). */
sealed interface CrmClauseAsked {
  data class Asked(val clause: ListFilterRequest) : CrmClauseAsked
  data class Refused(val reason: String) : CrmClauseAsked
}

/** `crmClauseValues`: the comma-separated values of an `isAnyOf`, or the one value of anything else. */
fun crmClauseValues(clause: ListFilterRequest): List<String> =
  (if (clause.op == "isAnyOf") clause.value.split(",") else listOf(clause.value)).map { it.trim() }.filter { it.isNotEmpty() }.distinct()

/** `crmAnyOf`: one value as `equals`, several as `isAnyOf`. */
fun crmAnyOf(field: String, values: List<String>): CrmClauseAsked {
  val unique = values.distinct()
  if (unique.isEmpty()) return CrmClauseAsked.Refused("no value yet")
  return CrmClauseAsked.Asked(
    if (unique.size == 1) ListFilterRequest(field, "equals", unique[0]) else ListFilterRequest(field, "isAnyOf", unique.joinToString(",")),
  )
}

private const val CRM_LIMITED_ACCESS =
  "your access is limited to specific sites, which this filter cannot be combined with — an organization administrator can use it"

/** A picklist filter's "None" (`LEAD_SOURCE_FILTER_NONE`). */
const val CRM_PICKLIST_FILTER_NONE = "\u0000none"

/** A number as JavaScript's `String(number)` spells the whole ones. */
private fun jsNumber(value: Double): String =
  if (value == kotlin.math.floor(value) && kotlin.math.abs(value) < 1e15) value.toLong().toString() else value.toString()

private val CONTACT_AS_STORED = setOf("name", "email", "formIds", "hostId", "createdAt", "updatedAt", "nextTaskAtMs")
private val CONTACT_FACETS = mapOf(
  "ownerUid" to "owner", "lifecycleStage" to "stage", "source" to "source", "companyId" to "company", "tags" to "tag",
  "ordersCount" to "orders", "ltvCents" to "ltv", "leadSource" to "leadSource",
)

/** `contactQueryClause`: a Contacts clause as its query asks it — a holder's field as that holder's facet key. */
fun contactQueryClause(clause: ListFilterRequest, groupId: String?, foldsScope: Boolean): CrmClauseAsked {
  if (clause.field in CONTACT_AS_STORED) {
    if (clause.field == "formIds" && !foldsScope) return CrmClauseAsked.Refused(CRM_LIMITED_ACCESS)
    return CrmClauseAsked.Asked(clause)
  }
  val verdicts = Contracts.nativeEmailStateStatuses
  if (clause.field == "emailState") {
    if (clause.op == "isEmpty") return CrmClauseAsked.Asked(ListFilterRequest("emailStatus", "equals", "none"))
    if (clause.op == "isNotEmpty") return crmAnyOf("emailStatus", verdicts)
    val values = crmClauseValues(clause)
    if (values.any { it !in verdicts }) return CrmClauseAsked.Refused("pick one of the choices")
    return crmAnyOf("emailStatus", values)
  }
  val facet = CONTACT_FACETS[clause.field]
    ?: clause.field.takeIf { it.startsWith("custom_") && it.length > 7 }?.let { "custom.${it.removePrefix("custom_")}" }
    ?: return CrmClauseAsked.Refused("this list does not filter by that")
  if (!foldsScope) return CrmClauseAsked.Refused(CRM_LIMITED_ACCESS)
  val group = groupId?.ifEmpty { null } ?: "*"
  if (clause.op == "isNotEmpty") return CrmClauseAsked.Asked(ListFilterRequest("facetKeys", "contains", "$group:$facet"))
  val keys = mutableListOf<String>()
  for (value in crmClauseValues(clause)) {
    val key = if (clause.op == "=") {
      val number = value.toDoubleOrNull()?.takeIf { it.isFinite() } ?: return CrmClauseAsked.Refused("no value yet")
      jsNumber(number)
    } else {
      facetKeyValue(value).ifEmpty { return CrmClauseAsked.Refused("no value yet") }
    }
    keys += "$group:$facet=$key"
  }
  // One key is an `array-contains`; several, an `array-contains-any`.
  return when (val asked = crmAnyOf("facetKeys", keys)) {
    is CrmClauseAsked.Asked -> if (asked.clause.op == "equals") CrmClauseAsked.Asked(asked.clause.copy(op = "contains")) else asked
    is CrmClauseAsked.Refused -> asked
  }
}

/** `dealQueryClause`: a Type or a Lead source by its key ("None" as `isEmpty`), every other clause as stored. */
fun dealQueryClause(clause: ListFilterRequest): CrmClauseAsked {
  val key = mapOf("type" to "typeKey", "leadSource" to "leadSourceKey")[clause.field] ?: return CrmClauseAsked.Asked(clause)
  val values = crmClauseValues(clause)
  if (clause.op == "isEmpty" || values == listOf(CRM_PICKLIST_FILTER_NONE)) return CrmClauseAsked.Asked(ListFilterRequest(key, "isEmpty", ""))
  if (CRM_PICKLIST_FILTER_NONE in values) return CrmClauseAsked.Refused("\"None\" cannot be picked beside a value")
  return crmAnyOf(key, values.mapNotNull { crmPicklistKey(it) })
}

/** `leadQueryClause`: a Leads clause as its query asks it; a value the list does not know is refused by name. */
fun leadQueryClause(clause: ListFilterRequest, scopeTokens: List<String>?, foldsScope: Boolean): CrmClauseAsked {
  val values = crmClauseValues(clause)
  return when (clause.field) {
    "status" -> {
      val statuses = mutableListOf<String>()
      for (value in values) {
        when {
          value == "open" -> statuses += Contracts.nativeCrmLeadOpenStatuses
          value in Contracts.nativeCrmLeadStatuses -> statuses += value
          else -> return CrmClauseAsked.Refused("$value is not a lead status")
        }
      }
      crmAnyOf("status", statuses)
    }
    "emailState" -> {
      val keys = mutableListOf<String>()
      for (value in values) {
        when {
          value == "problem" -> keys += Contracts.nativeEmailStateStatuses.filter { it != "ok" }
          value == "none" -> keys += "none"
          value in Contracts.nativeEmailStateStatuses -> keys += value
          else -> return CrmClauseAsked.Refused("$value is not an email verdict")
        }
      }
      crmAnyOf("emailStatus", keys)
    }
    "leadSource" -> when {
      clause.op == "isEmpty" || values == listOf(CRM_PICKLIST_FILTER_NONE) -> CrmClauseAsked.Asked(ListFilterRequest("leadSourceKey", "isEmpty", ""))
      CRM_PICKLIST_FILTER_NONE in values -> CrmClauseAsked.Refused("\"No lead source\" cannot be picked beside a value")
      else -> crmAnyOf("leadSourceKey", values.mapNotNull { crmPicklistKey(it) })
    }
    "leadSourceDirection" -> values.firstOrNull { it !in Contracts.nativeCrmLeadSourceDirections }
      ?.let { CrmClauseAsked.Refused("$it is not a lead source direction") } ?: crmAnyOf("leadSourceDirection", values)
    "ownerUid" -> crmAnyOf("ownerUid", values)
    "industry", "rating" -> crmAnyOf(if (clause.field == "industry") "industryKey" else "ratingKey", values.mapNotNull { crmPicklistKey(it) })
    "campaignIds" -> when {
      values.size != 1 -> CrmClauseAsked.Refused("pick one campaign")
      scopeTokens == null -> CrmClauseAsked.Asked(ListFilterRequest("campaignIds", "contains", values[0]))
      !foldsScope -> CrmClauseAsked.Refused(CRM_LIMITED_ACCESS)
      else -> CrmClauseAsked.Asked(ListFilterRequest("scopedCampaignIds", "isAnyOf", scopeTokens.joinToString(",") { "$it~${values[0]}" }))
    }
    else -> CrmClauseAsked.Refused("this list does not filter by that")
  }
}

/** A stored clause through its list's translation (companies keep theirs as stored). */
fun crmAskClause(kind: CrmKind, clause: ListFilterRequest, scope: CrmScope): CrmClauseAsked {
  val folds = scope.workspaceWide || scope.orgWide
  return when (kind) {
    CrmKind.CONTACT -> contactQueryClause(clause, if (scope.workspaceWide) null else scope.groupId, folds)
    CrmKind.DEAL -> dealQueryClause(clause)
    CrmKind.LEAD -> leadQueryClause(clause, if (scope.workspaceWide) null else scope.readTokens, folds)
    CrmKind.COMPANY -> CrmClauseAsked.Asked(clause)
  }
}

/** A clause the list could not apply, said as the filter bar says it: "“Stage is Customer” was not applied: why." */
data class CrmViewRefusal(val clause: ListFilterRequest, val reason: String) {
  val sentence: String get() = "“${com.aglyn.pluginhost.clauseLabel(clause, emptyMap(), emptyMap())}” was not applied: $reason."
}
