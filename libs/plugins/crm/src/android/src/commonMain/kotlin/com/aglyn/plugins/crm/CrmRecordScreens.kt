package com.aglyn.plugins.crm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.FormSheet
import com.aglyn.ui.Busy
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldForm
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldOption
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.LiveListPane
import com.aglyn.ui.LiveQueryList
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.PropertyRow
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.fieldDisplay
import com.aglyn.ui.fieldProblems
import com.aglyn.ui.isoDayMillis
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

internal fun problemText(error: Throwable) = error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."

/**
 * One object's list (search, the console's chips, a page at a time) beside
 * the picked record on wide windows, with New in the list's header.
 */
@Composable
fun RecordsSection(context: NativePluginContext, kind: CrmKind, scope: CrmScope, api: CrmApi, reference: CrmReference, initial: String?) {
  val coroutines = rememberCoroutineScope()
  val filters = remember(kind, scope) { crmFilters(kind, scope) }
  var filterKey by rememberSaveable(kind) { mutableStateOf(filters.first().key) }
  var search by rememberSaveable(kind) { mutableStateOf("") }
  var asked by rememberSaveable(kind) { mutableStateOf("") }
  var creating by remember(kind) { mutableStateOf(false) }
  val list = remember(kind, scope, context.firestore) {
    LiveQueryList(context.firestore, coroutines, 25) { doc -> crmRow(kind, doc, scope) }
  }
  LaunchedEffect(list, filterKey, asked) {
    val filter = filters.firstOrNull { it.key == filterKey } ?: filters.first()
    list.show { limit -> crmListQuery(kind, scope, filter, asked, limit) }
  }
  var picked by rememberSaveable(kind) { mutableStateOf(initial) }
  AglynListDetail(
    initialSelected = picked,
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = "Search ${kind.plural.lowercase()}", modifier = Modifier.weight(1f), onSearch = { asked = search })
            if (scope.canWrite) {
              FilledTonalButton(onClick = { creating = true }, modifier = Modifier.testTag("crm-new-${kind.collection}")) {
                Icon(AglynIcons.named("add"), contentDescription = null)
                Text("New", Modifier.padding(start = space(0.5f)))
              }
            }
          }
          ChoiceChipRow(filters.map { ChipOption(it.key, it.label) }, filterKey, { filterKey = it })
        }
        LiveListPane(
          list,
          key = { it.id },
          failed = "Could not load ${kind.plural.lowercase()}",
          empty = {
            EmptyState(
              if (asked.isNotBlank() || filterKey != filters.first().key) "No ${kind.plural.lowercase()} match" else "No ${kind.plural.lowercase()} yet",
              body = if (asked.isNotBlank()) "Try another search or filter." else "${kind.plural} you add, and the ones your forms capture, show up here.",
              icon = AglynIcons.named(kind.icon),
            )
          },
        ) { row ->
          AglynListItem(
            title = row.title,
            supporting = row.subtitle.ifBlank { null },
            icon = AglynIcons.named(kind.icon),
            selected = row.id == selected,
            trailing = row.chip?.let { { StatusChip(it, chipTone(kind, row)) } },
            onClick = { picked = row.id; onSelect(row.id) },
            modifier = Modifier.testTag("crm-row-${row.id}"),
          )
        }
      }
    },
    detail = { selected ->
      if (selected == null) {
        EmptyState("Pick a ${kind.singular.lowercase()} to see it here", icon = AglynIcons.named(kind.icon))
      } else {
        RecordDetail(context, kind, selected, scope, api, reference)
      }
    },
  )
  if (creating) {
    CreateRecordDialog(kind, scope, api, reference, onDismiss = { creating = false }) { id -> creating = false; picked = id }
  }
}

internal fun chipTone(kind: CrmKind, row: CrmRow): StatusTone = when (kind) {
  CrmKind.LEAD -> when (row.data["status"]) {
    "qualified" -> StatusTone.SUCCESS
    "unqualified" -> StatusTone.NEUTRAL
    "working" -> StatusTone.INFO
    "nurturing" -> StatusTone.WARNING
    else -> StatusTone.INFO
  }
  CrmKind.DEAL -> if (row.data["status"] == "won") StatusTone.SUCCESS else if (row.data["status"] == "lost") StatusTone.ERROR else StatusTone.NEUTRAL
  CrmKind.CONTACT -> if (row.data["lifecycleStage"] == "customer") StatusTone.SUCCESS else StatusTone.INFO
  CrmKind.COMPANY -> StatusTone.NEUTRAL
}

/** What a record's screen offers, by object and by the member's role. */
private enum class RecordDialog { EDIT, DELETE, LOG, EMAIL, TASK, STATUS, UNQUALIFY, CONVERT, STAGE, MOVE, WON, LOST }

/**
 * One record: its header and actions, its properties (standard and custom),
 * what it is linked to, its open tasks and its activity timeline.
 */
@Composable
fun RecordDetail(context: NativePluginContext, kind: CrmKind, id: String, scope: CrmScope, api: CrmApi, reference: CrmReference) {
  val flow = remember(kind, id, scope.orgId, context.firestore) { context.firestore.observeDoc("${crmPath(scope.orgId, kind.collection)}/$id") }
  val live by flow.collectAsState(Live.Loading)
  var dialog by remember(id) { mutableStateOf<RecordDialog?>(null) }
  var notice by remember(id) { mutableStateOf<String?>(null) }
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 8, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this ${kind.singular.lowercase()}", body = value.error.message, icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val doc = value.value
      if (doc == null) {
        EmptyState("This ${kind.singular.lowercase()} is gone", body = "It may have been deleted or converted.", icon = AglynIcons.named(kind.icon))
        return
      }
      val stages = reference.pipeline(doc.string("pipelineId")).stages.associate { it.id to it.name }
      val row = crmRow(kind, doc, scope, stages)
      val fields = reference.fields(kind)
      val values = formValues(fields, row.data)
      Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
          Modifier.widthIn(max = 920.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("crm-detail"),
          verticalArrangement = Arrangement.spacedBy(space(2f)),
        ) {
          notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } }) }
          SectionCard(null, Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
              Column(Modifier.weight(1f)) {
                Text(row.title, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
                if (row.subtitle.isNotBlank()) Text(row.subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
              }
              row.chip?.let { StatusChip(it, chipTone(kind, row)) }
            }
            if (kind == CrmKind.DEAL) DealStagePath(reference.pipeline(doc.string("pipelineId")), doc.string("stageId"), doc.string("status"))
            if (scope.canWrite) RecordActions(kind, row) { dialog = it }
          }
          SectionCard("Details", Modifier.fillMaxWidth()) {
            // The fields that hold something; Edit holds every one.
            val shown = fields.mapNotNull { field ->
              val display = when {
                field.spec.key == "ownerUid" -> reference.memberLabel(values[field.spec.key]?.ifBlank { null })
                else -> fieldDisplay(field.spec, values[field.spec.key])
              }
              display?.takeIf { it.isNotBlank() }?.let { field to it }
            }
            shown.forEach { (field, display) -> PropertyRow(field.spec.label, display, Modifier.testTag("property-${field.spec.key}")) }
            if (shown.size < fields.size) {
              Text("${fields.size - shown.size} more fields are empty. Edit to fill them in.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            (row.data["createdAt"]?.let(::millisOf))?.let { PropertyRow("Created", formatReceiptTime(it)) }
          }
          RelatedCard(context, kind, id, row, scope, reference)
          RecordTasksCard(context, kind, id, scope, api, reference)
          TimelineCard(context, kind, id, scope, api)
        }
      }
      RecordDialogs(kind, id, row, fields, values, scope, api, reference, dialog, onClose = { dialog = null }, onNotice = { notice = it })
    }
  }
}

@Composable
private fun RecordActions(kind: CrmKind, row: CrmRow, open: (RecordDialog) -> Unit) {
  val actions = buildList {
    add(Triple("Edit", "edit", RecordDialog.EDIT))
    add(Triple("Log activity", "sticky_note", RecordDialog.LOG))
    if (kind != CrmKind.COMPANY && row.data["email"] != null || kind == CrmKind.DEAL) add(Triple("Email", "mail", RecordDialog.EMAIL))
    add(Triple("New task", "task", RecordDialog.TASK))
    when (kind) {
      CrmKind.LEAD -> {
        add(Triple("Status", "label", RecordDialog.STATUS))
        if (row.data["convertedContactId"] == null) add(Triple("Convert", "arrow_forward", RecordDialog.CONVERT))
        if (row.data["status"] != "unqualified") add(Triple("Unqualify", "cancel", RecordDialog.UNQUALIFY))
      }
      CrmKind.CONTACT -> add(Triple("Lifecycle stage", "label", RecordDialog.STAGE))
      CrmKind.DEAL -> if (row.data["status"] == "open" || row.data["status"] == null) {
        add(Triple("Move stage", "view_kanban", RecordDialog.MOVE))
        add(Triple("Won", "check_circle", RecordDialog.WON))
        add(Triple("Lost", "cancel", RecordDialog.LOST))
      }
      CrmKind.COMPANY -> Unit
    }
    add(Triple(if (kind == CrmKind.CONTACT) "Remove" else "Delete", "delete", RecordDialog.DELETE))
  }
  FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    actions.forEachIndexed { index, (label, icon, dialog) ->
      val tag = Modifier.testTag("crm-action-${dialog.name.lowercase()}")
      if (index == 0) {
        Button(onClick = { open(dialog) }, modifier = tag) {
          Icon(AglynIcons.named(icon), contentDescription = null)
          Text(label, Modifier.padding(start = space(1f)))
        }
      } else {
        OutlinedButton(onClick = { open(dialog) }, modifier = tag) {
          Icon(AglynIcons.named(icon), contentDescription = null)
          Text(label, Modifier.padding(start = space(1f)))
        }
      }
    }
  }
}

/** A deal's stages as a path: done, current, ahead. */
@Composable
private fun DealStagePath(pipeline: Pipeline, stageId: String?, status: String?) {
  val open = pipeline.stages.filter { it.kind == "open" }
  val at = open.indexOfFirst { it.id == stageId }
  FlowRow(horizontalArrangement = Arrangement.spacedBy(space(0.5f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    open.forEachIndexed { index, stage ->
      StatusChip(
        stage.name,
        when {
          status == "won" -> StatusTone.SUCCESS
          status == "lost" -> StatusTone.NEUTRAL
          index < at -> StatusTone.SUCCESS
          index == at -> StatusTone.INFO
          else -> StatusTone.NEUTRAL
        },
      )
    }
  }
}

/** What the record is linked to: a company's people and deals, a contact's deals, a deal's contact and company. */
@Composable
private fun RelatedCard(context: NativePluginContext, kind: CrmKind, id: String, row: CrmRow, scope: CrmScope, reference: CrmReference) {
  // The console's own linked reads (`useDealsByLink`, the company contacts card).
  val queries = remember(kind, id, scope) {
    when (kind) {
      CrmKind.COMPANY -> listOf(
        CrmKind.CONTACT to com.aglyn.core.FirestoreQuery(
          crmPath(scope.orgId, "contacts"),
          filters = listOf(FirestoreFilter("companyIds", FilterOp.ARRAY_CONTAINS, id)),
          orderBy = listOf(FirestoreOrder("updatedAt", descending = true)),
          limit = 25,
        ),
        CrmKind.DEAL to scopedQuery(scope, "deals", listOf(FirestoreFilter("companyId", FilterOp.EQ, id)), listOf(FirestoreOrder("updatedAt", true)), 25),
      )
      CrmKind.CONTACT -> listOf(
        CrmKind.DEAL to scopedQuery(scope, "deals", listOf(FirestoreFilter("contactId", FilterOp.EQ, id)), listOf(FirestoreOrder("updatedAt", true)), 25),
      )
      else -> emptyList()
    }
  }
  val links = buildList {
    (row.data["companyId"] as? String)?.takeIf { it.isNotEmpty() && kind != CrmKind.COMPANY }?.let { company ->
      add(Triple(CrmKind.COMPANY, company, reference.companies.firstOrNull { it.value == company }?.label ?: (row.data["companyName"] as? String) ?: "Company"))
    }
    if (kind == CrmKind.DEAL) {
      (row.data["contactId"] as? String)?.takeIf { it.isNotEmpty() }?.let { contact ->
        add(Triple(CrmKind.CONTACT, contact, reference.contacts.firstOrNull { it.value == contact }?.label ?: "Contact"))
      }
    }
    if (kind == CrmKind.LEAD) {
      (row.data["convertedContactId"] as? String)?.let { add(Triple(CrmKind.CONTACT, it, "Converted contact")) }
      (row.data["dealId"] as? String)?.let { add(Triple(CrmKind.DEAL, it, "Deal from this lead")) }
    }
  }
  if (links.isEmpty() && queries.isEmpty()) return
  val related = queries.map { (relatedKind, query) ->
    relatedKind to remember(query) { context.firestore.observe(query) }.collectAsState(Live.Loading).value
  }
  SectionCard("Related", Modifier.fillMaxWidth()) {
    links.forEach { (linkKind, linkId, label) ->
      AglynListItem(label, supporting = linkKind.singular, icon = AglynIcons.named(linkKind.icon), onClick = { context.navigate(linkKind.detailScreen, mapOf(linkKind.param to linkId)) })
    }
    related.forEach { (relatedKind, live) ->
      val rows = (live as? Live.Ready)?.value.orEmpty().map { crmRow(relatedKind, it, scope) }
      Text(if (relatedKind == CrmKind.CONTACT) "People" else relatedKind.plural, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (live is Live.Loading) SkeletonList(rows = 2)
      if (live is Live.Failed) Text("Could not load these.", color = MaterialTheme.colorScheme.error)
      if (rows.isEmpty() && live is Live.Ready) Text("None yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      rows.forEach { item ->
        AglynListItem(
          item.title,
          supporting = item.subtitle.ifBlank { null },
          icon = AglynIcons.named(relatedKind.icon),
          trailing = item.chip?.let { { StatusChip(it, chipTone(relatedKind, item)) } },
          onClick = { context.navigate(relatedKind.detailScreen, mapOf(relatedKind.param to item.id)) },
        )
      }
    }
  }
}

/** The record's open tasks, newest due first, with a tick to complete one. */
@Composable
private fun RecordTasksCard(context: NativePluginContext, kind: CrmKind, id: String, scope: CrmScope, api: CrmApi, reference: CrmReference) {
  if (kind == CrmKind.LEAD) return
  val query = remember(kind, id, scope) {
    scopedQuery(scope, "crmTasks", listOf(FirestoreFilter(kind.linkField, FilterOp.EQ, id), FirestoreFilter("status", FilterOp.EQ, "open")), listOf(FirestoreOrder("dueAtMs")), 25)
  }
  val live = remember(query) { context.firestore.observe(query) }.collectAsState(Live.Loading).value
  val tasks = (live as? Live.Ready)?.value.orEmpty().map(::taskOf)
  val coroutines = rememberCoroutineScope()
  SectionCard("Open tasks", Modifier.fillMaxWidth()) {
    if (live is Live.Loading) SkeletonList(rows = 2)
    if (live is Live.Failed) Text("Could not load tasks.", color = MaterialTheme.colorScheme.error)
    if (tasks.isEmpty() && live is Live.Ready) Text("Nothing to do on this ${kind.singular.lowercase()}.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    tasks.forEach { task ->
      TaskRow(task, reference, onToggle = if (scope.canWrite) ({ coroutines.launch { runCatching { api.completeTask(task.id) } } }) else null)
    }
  }
}

/** The record's activity, newest first: notes, calls, meetings and emails. */
@Composable
private fun TimelineCard(context: NativePluginContext, kind: CrmKind, id: String, scope: CrmScope, api: CrmApi) {
  val query = remember(kind, id, scope) {
    scopedQuery(scope, "crmActivities", listOf(FirestoreFilter(kind.linkField, FilterOp.EQ, id)), listOf(FirestoreOrder("atMs", descending = true)), 25)
  }
  val live = remember(query) { context.firestore.observe(query) }.collectAsState(Live.Loading).value
  val coroutines = rememberCoroutineScope()
  var deleting by remember(id) { mutableStateOf<String?>(null) }
  val now = remember { nowMillis() }
  SectionCard("Activity", Modifier.fillMaxWidth()) {
    if (live is Live.Loading) SkeletonList(rows = 3)
    if (live is Live.Failed) Text("Could not load the activity.", color = MaterialTheme.colorScheme.error)
    val rows = (live as? Live.Ready)?.value.orEmpty()
    if (rows.isEmpty() && live is Live.Ready) Text("Nothing logged yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    rows.forEach { doc ->
      val activityKind = doc.string("kind") ?: "note"
      val at = millisOf(doc.data["atMs"])
      AglynListItem(
        title = doc.string("subject")?.takeIf { it.isNotBlank() } ?: (Contracts.crmActivityKindLabels[activityKind] ?: activityKind),
        supporting = listOfNotNull(
          doc.string("body")?.take(240),
          listOfNotNull(doc.string("byName"), at?.let { relativeTime(it, now) }, doc.string("outcome"), (doc.data["durationMinutes"] as? Number)?.let { "${it.toLong()} min" }).joinToString(" · ").ifBlank { null },
        ).joinToString("\n"),
        icon = AglynIcons.named(when (activityKind) { "call" -> "call"; "email" -> "mail"; "meeting" -> "groups"; else -> "sticky_note" }),
        trailing = if (scope.canWrite && doc.string("byUid") == scope.uid && activityKind != "email") ({
          IconButton(onClick = { deleting = doc.id }) { Icon(AglynIcons.named("delete"), contentDescription = "Delete this entry") }
        }) else null,
      )
    }
  }
  deleting?.let { activityId ->
    val busy = remember(activityId) { Busy() }
    ActionDialog(
      title = "Delete this entry?",
      body = "It leaves the record's activity for everyone.",
      confirmLabel = "Delete",
      destructive = true,
      busy = busy.busy,
      error = busy.error,
      onDismiss = { deleting = null },
      onConfirm = { busy.run(coroutines, { deleting = null }) { api.deleteActivity(activityId) } },
    )
  }
}

/** Every dialog a record's actions open. */
@Composable
private fun RecordDialogs(
  kind: CrmKind,
  id: String,
  row: CrmRow,
  fields: List<CrmField>,
  values: Map<String, String>,
  scope: CrmScope,
  api: CrmApi,
  reference: CrmReference,
  dialog: RecordDialog?,
  onClose: () -> Unit,
  onNotice: (String) -> Unit,
) {
  val coroutines = rememberCoroutineScope()
  val busy = remember(dialog) { Busy() }
  when (dialog) {
    null -> Unit
    RecordDialog.EDIT -> EditSheet(
      title = "Edit ${kind.singular.lowercase()}",
      fields = fields.filter { it.editable },
      initial = values,
      busy = busy,
      onDismiss = onClose,
    ) { edited ->
      busy.run(coroutines, { onClose(); onNotice("${kind.singular} saved.") }) {
        val changes = changedFields(fields, values, edited)
        when (kind) {
          CrmKind.CONTACT -> api.updateContact(id, contactSet(changes))
          else -> api.updateRecord(kind, id, changes)
        }
      }
    }
    RecordDialog.DELETE -> ActionDialog(
      title = if (kind == CrmKind.CONTACT) "Remove ${row.title}?" else "Delete ${row.title}?",
      body = when (kind) {
        CrmKind.CONTACT -> "They leave this site's CRM. If no other site holds them, the contact is deleted; marketing refusals they gave are kept."
        CrmKind.COMPANY -> "Its contacts are unlinked first, then the company is deleted."
        else -> "This cannot be undone."
      },
      icon = "delete",
      confirmLabel = if (kind == CrmKind.CONTACT) "Remove" else "Delete",
      destructive = true,
      busy = busy.busy,
      error = busy.error,
      onDismiss = onClose,
      onConfirm = {
        busy.run(coroutines, { onClose(); onNotice("${row.title} is gone.") }) {
          when (kind) {
            CrmKind.CONTACT -> api.removeContact(id)
            CrmKind.COMPANY -> api.deleteCompany(id)
            else -> api.deleteRecord(kind, id)
          }
        }
      },
    )
    RecordDialog.LOG -> LogActivityDialog(busy, onClose) { activityKind, body, outcome, minutes, direction ->
      busy.run(coroutines, { onClose(); onNotice("Logged.") }) {
        api.logActivity(activityKind, body, activityLinks(kind, id, row), byName = null, outcome = outcome, durationMinutes = minutes, direction = direction)
      }
    }
    RecordDialog.EMAIL -> EmailDialog(row, busy, onClose) { subject, message ->
      busy.run(coroutines, { onClose(); onNotice("Email sent.") }) { api.sendEmail(subject, message, mapOf(kind.linkField to id)) }
    }
    RecordDialog.TASK -> TaskDialog(
      title = "New task",
      initial = TaskDraft(title = "", assigneeUid = scope.uid).withLink(kind, id, row),
      reference = reference,
      busy = busy,
      onDismiss = onClose,
    ) { draft -> busy.run(coroutines, { onClose(); onNotice("Task added.") }) { api.saveTask(null, draft) } }
    RecordDialog.STATUS -> {
      var status by remember { mutableStateOf(row.data["status"] as? String ?: "new") }
      ActionDialog(
        title = "Lead status",
        confirmLabel = "Save",
        busy = busy.busy,
        error = busy.error,
        onDismiss = onClose,
        onConfirm = {
          busy.run(coroutines, { onClose(); onNotice("Status saved.") }) {
            api.setLeadStatus(id, status, leadStatusLabel(reference, status))
          }
        },
      ) {
        val options = Contracts.nativeCrmLeadStatuses.filter { it != "unqualified" && it != "qualified" }
        ChoiceChipRow(options.map { ChipOption(it, leadStatusLabel(reference, it)) }, status, { status = it }, wrap = true)
        Text("Qualified comes with converting a lead, and Unqualified asks why.", style = MaterialTheme.typography.bodySmall)
      }
    }
    RecordDialog.UNQUALIFY -> {
      var reason by remember { mutableStateOf("") }
      ActionDialog(
        title = "Unqualify ${row.title}?",
        body = "The lead stays, marked Unqualified, and leaves the open views.",
        confirmLabel = "Unqualify",
        busy = busy.busy,
        error = busy.error,
        onDismiss = onClose,
        onConfirm = {
          busy.run(coroutines, { onClose(); onNotice("Unqualified.") }) { api.setLeadStatus(id, "unqualified", leadStatusLabel(reference, "unqualified"), reason) }
        },
      ) {
        OutlinedTextField(reason, { reason = it.take(500) }, label = { Text("Why (optional)") }, modifier = Modifier.fillMaxWidth())
      }
    }
    RecordDialog.CONVERT -> ConvertDialog(row, scope, reference, busy, onClose) { draft ->
      busy.run(coroutines, { onClose(); onNotice("${row.title} is converted.") }) { api.convertLead(id, draft) }
    }
    RecordDialog.STAGE -> {
      var stage by remember { mutableStateOf(row.data["lifecycleStage"] as? String ?: "") }
      ActionDialog(
        title = "Lifecycle stage",
        confirmLabel = "Save",
        busy = busy.busy,
        error = busy.error,
        onDismiss = onClose,
        onConfirm = { busy.run(coroutines, { onClose(); onNotice("Stage saved.") }) { api.setContactStage(id, stage.ifEmpty { null }) } },
      ) {
        ChoiceChipRow(listOf(ChipOption("", "None")) + Contracts.contactLifecycleStageLabels.map { ChipOption(it.key, it.value) }, stage, { stage = it }, wrap = true)
      }
    }
    RecordDialog.MOVE -> {
      val pipeline = reference.pipeline(row.data["pipelineId"] as? String)
      var stageId by remember { mutableStateOf(row.data["stageId"] as? String ?: "") }
      ActionDialog(
        title = "Move ${row.title}",
        confirmLabel = "Move",
        confirmEnabled = stageId.isNotEmpty() && stageId != row.data["stageId"],
        busy = busy.busy,
        error = busy.error,
        onDismiss = onClose,
        onConfirm = { busy.run(coroutines, { onClose(); onNotice("Moved.") }) { api.moveDeal(id, stageId) } },
      ) {
        ChoiceChipRow(pipeline.stages.filter { it.kind == "open" }.map { ChipOption(it.id, it.name) }, stageId, { stageId = it }, wrap = true)
      }
    }
    RecordDialog.WON -> ActionDialog(
      title = "Mark ${row.title} won?",
      body = "It moves to the pipeline's won stage and counts as closed today.",
      icon = "check_circle",
      confirmLabel = "Mark won",
      busy = busy.busy,
      error = busy.error,
      onDismiss = onClose,
      onConfirm = { busy.run(coroutines, { onClose(); onNotice("Won. Nice work.") }) { api.closeDeal(id, true) } },
    )
    RecordDialog.LOST -> {
      var reason by remember { mutableStateOf("") }
      ActionDialog(
        title = "Mark ${row.title} lost?",
        confirmLabel = "Mark lost",
        destructive = true,
        busy = busy.busy,
        error = busy.error,
        onDismiss = onClose,
        onConfirm = { busy.run(coroutines, { onClose(); onNotice("Marked lost.") }) { api.closeDeal(id, false, reason) } },
      ) {
        OutlinedTextField(reason, { reason = it.take(500) }, label = { Text("Why (optional)") }, modifier = Modifier.fillMaxWidth())
      }
    }
  }
}

internal fun leadStatusLabel(reference: CrmReference, status: String): String =
  Contracts.crmLeadStatusLabels[status] ?: status

/** The links an activity on this record carries: the record, and for a deal its contact and company too. */
internal fun activityLinks(kind: CrmKind, id: String, row: CrmRow): Map<String, String> = buildMap {
  put(kind.linkField, id)
  if (kind == CrmKind.DEAL || kind == CrmKind.CONTACT) (row.data["companyId"] as? String)?.takeIf { it.isNotEmpty() }?.let { put("companyId", it) }
  if (kind == CrmKind.DEAL) (row.data["contactId"] as? String)?.takeIf { it.isNotEmpty() }?.let { put("contactId", it) }
}

internal fun TaskDraft.withLink(kind: CrmKind, id: String, row: CrmRow): TaskDraft = when (kind) {
  CrmKind.CONTACT -> copy(contactId = id, companyId = row.data["companyId"] as? String)
  CrmKind.COMPANY -> copy(companyId = id)
  CrmKind.DEAL -> copy(dealId = id, contactId = row.data["contactId"] as? String, companyId = row.data["companyId"] as? String)
  CrmKind.LEAD -> this
}

/** A contact edit as `contact-update` takes it: the changed keys, `custom` nested. */
internal fun contactSet(changes: Map<String, Any?>): Map<String, Any?> = changes

/** A record's fields in a full-height sheet: the form, then Save. */
@Composable
internal fun EditSheet(
  title: String,
  fields: List<CrmField>,
  initial: Map<String, String>,
  busy: Busy,
  onDismiss: () -> Unit,
  confirmLabel: String = "Save",
  header: (@Composable () -> Unit)? = null,
  onSave: (Map<String, String>) -> Unit,
) {
  var values by remember { mutableStateOf(initial) }
  var tried by remember { mutableStateOf(false) }
  val problems = fieldProblems(fields.map { it.spec }, values)
  FormSheet(
    title = title,
    busy = busy,
    onDismiss = onDismiss,
    confirmLabel = confirmLabel,
    modifier = Modifier.testTag("crm-edit-sheet"),
    onConfirm = {
      tried = true
      if (problems.isEmpty()) onSave(values)
    },
  ) {
    header?.invoke()
    FieldForm(fields.map { it.spec }, values, { key, value -> values = values + (key to value) }, errors = if (tried) problems else emptyMap(), enabled = !busy.busy)
  }
}

/** The fields a new record is created with: what the console's create drawer asks. */
internal fun createFields(kind: CrmKind, reference: CrmReference): List<CrmField> {
  val all = reference.fields(kind)
  fun pick(vararg keys: String) = keys.mapNotNull { key -> all.firstOrNull { it.spec.key == key } }
  return when (kind) {
    CrmKind.CONTACT -> pick("email", "name", "phone", "jobTitle", "companyId", "leadSource", "ownerUid").map { it.copy(editable = true) } +
      CrmField(FieldSpec("lifecycleStage", "Lifecycle stage", FieldKind.SELECT, options = Contracts.contactLifecycleStageLabels.map { FieldOption(it.key, it.value) }))
    CrmKind.LEAD -> pick("email", "name", "company", "jobTitle", "phone", "website", "leadSource", "ownerUid", "notes").map { it.copy(editable = true) }
    CrmKind.COMPANY -> all.filter { it.editable }
    CrmKind.DEAL -> all.filter { it.editable }
  } + if (kind == CrmKind.CONTACT || kind == CrmKind.LEAD) customFields(kind, reference.customFields) else emptyList()
}

@Composable
private fun CreateRecordDialog(kind: CrmKind, scope: CrmScope, api: CrmApi, reference: CrmReference, onDismiss: () -> Unit, onCreated: (String) -> Unit) {
  val coroutines = rememberCoroutineScope()
  val busy = remember { Busy() }
  val fields = remember(kind, reference) { createFields(kind, reference) }
  var pipelineId by remember { mutableStateOf(reference.pipeline(null).id) }
  var stageId by remember { mutableStateOf(reference.pipeline(null).stages.firstOrNull { it.kind == "open" }?.id ?: "") }
  val initial = remember { if (kind == CrmKind.CONTACT || kind == CrmKind.LEAD || kind == CrmKind.DEAL) mapOf("ownerUid" to scope.uid) else mapOf("ownerUid" to scope.uid) }
  EditSheet(
    title = "New ${kind.singular.lowercase()}",
    fields = fields,
    initial = initial,
    busy = busy,
    confirmLabel = "Create",
    onDismiss = onDismiss,
    header = if (kind == CrmKind.DEAL) ({
      val pipeline = reference.pipeline(pipelineId)
      if (reference.activePipelines.size > 1) {
        FieldEditor(FieldSpec("pipelineId", "Pipeline", FieldKind.SELECT, required = true, options = reference.activePipelines.map { FieldOption(it.id, it.name) }, emptyLabel = null), pipelineId, {
          pipelineId = it
          stageId = reference.pipeline(it).stages.firstOrNull { stage -> stage.kind == "open" }?.id ?: ""
        })
      }
      FieldEditor(FieldSpec("stageId", "Stage", FieldKind.SELECT, required = true, options = pipeline.stages.filter { it.kind == "open" }.map { FieldOption(it.id, it.name) }, emptyLabel = null), stageId, { stageId = it })
    }) else null,
  ) { values ->
    busy.run(coroutines) {
      val created = createdFields(fields, values)
      val id = when (kind) {
        CrmKind.CONTACT -> api.createContact(created)
        CrmKind.LEAD -> api.createLead(created)
        CrmKind.COMPANY -> api.createRecord(kind, created + mapOf("contactsCount" to 0L))
        CrmKind.DEAL -> {
          val pipeline = reference.pipeline(pipelineId)
          val stage = pipeline.stages.firstOrNull { it.id == stageId }
          val contact = created["contactId"] as? String
          api.createRecord(
            kind,
            created,
            mapOf(
              "pipelineId" to pipeline.id,
              "stageId" to stageId,
              "status" to "open",
              "currency" to "usd",
              "stageChangedAtMs" to nowMillis(),
            ) + (stage?.forecastCategory?.let { mapOf("forecastCategory" to it) } ?: emptyMap()) +
              (if (created["probability"] == null && stage != null) mapOf("probability" to stage.probability) else emptyMap()) +
              (contact?.let { mapOf("contactRoles" to listOf(mapOf("contactId" to it, "primary" to true))) } ?: emptyMap()),
          )
        }
      }
      id?.let(onCreated) ?: onDismiss()
    }
  }
}

@Composable
private fun LogActivityDialog(busy: Busy, onDismiss: () -> Unit, onLog: (kind: String, body: String, outcome: String?, minutes: Long?, direction: String?) -> Unit) {
  var kind by remember { mutableStateOf("note") }
  var body by remember { mutableStateOf("") }
  var outcome by remember { mutableStateOf("") }
  var minutes by remember { mutableStateOf("") }
  var direction by remember { mutableStateOf("") }
  val directions = Contracts.nativeCrmActivityDirections[kind].orEmpty()
  ActionDialog(
    title = "Log activity",
    icon = "sticky_note",
    confirmLabel = "Log",
    confirmEnabled = body.isNotBlank(),
    busy = busy.busy,
    error = busy.error,
    onDismiss = onDismiss,
    onConfirm = { onLog(kind, body, outcome.trim().ifEmpty { null }, minutes.toLongOrNull(), direction.ifEmpty { null }) },
  ) {
    ChoiceChipRow(
      Contracts.crmActivityKindLabels.filterKeys { it != "email" }.map { ChipOption(it.key, it.value) },
      kind,
      { kind = it; direction = "" },
      wrap = true,
    )
    OutlinedTextField(body, { body = it.take(10_000) }, label = { Text(if (kind == "note") "Note" else "What happened") }, minLines = 3, modifier = Modifier.fillMaxWidth().testTag("activity-body"))
    if (kind == "call" || kind == "meeting") {
      OutlinedTextField(minutes, { minutes = it.filter(Char::isDigit).take(4) }, label = { Text("Minutes") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    }
    if (kind == "call") OutlinedTextField(outcome, { outcome = it.take(80) }, label = { Text("Outcome") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    if (directions.isNotEmpty()) {
      ChoiceChipRow(directions.map { ChipOption(it, Contracts.crmActivityDirectionLabels[it] ?: it) }, direction, { direction = it })
    }
  }
}

@Composable
private fun EmailDialog(row: CrmRow, busy: Busy, onDismiss: () -> Unit, onSend: (String, String) -> Unit) {
  var subject by remember { mutableStateOf("") }
  var message by remember { mutableStateOf("") }
  ActionDialog(
    title = "Email ${row.title}",
    body = (row.data["email"] as? String)?.let { "To $it. The email is logged on the record." },
    icon = "mail",
    confirmLabel = "Send",
    confirmEnabled = subject.isNotBlank() && message.isNotBlank(),
    busy = busy.busy,
    error = busy.error,
    onDismiss = onDismiss,
    onConfirm = { onSend(subject, message) },
  ) {
    OutlinedTextField(subject, { subject = it.take(Contracts.crmEmailSubjectMax.toInt()) }, label = { Text("Subject") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(message, { message = it.take(Contracts.crmEmailBodyMax.toInt()) }, label = { Text("Message") }, minLines = 5, modifier = Modifier.fillMaxWidth())
  }
}

@Composable
private fun ConvertDialog(row: CrmRow, scope: CrmScope, reference: CrmReference, busy: Busy, onDismiss: () -> Unit, onConvert: (ConvertDraft) -> Unit) {
  var owner by remember { mutableStateOf((row.data["ownerUid"] as? String) ?: scope.uid) }
  var companyMode by remember { mutableStateOf(if (row.data["company"] != null) "new" else "none") }
  var companyId by remember { mutableStateOf("") }
  var companyName by remember { mutableStateOf(row.data["company"] as? String ?: "") }
  var withDeal by remember { mutableStateOf(false) }
  var dealTitle by remember { mutableStateOf("${row.title} deal") }
  var amount by remember { mutableStateOf("") }
  val pipeline = reference.pipeline(null)
  var stageId by remember { mutableStateOf(pipeline.stages.firstOrNull { it.kind == "open" }?.id ?: "") }
  ActionDialog(
    title = "Convert ${row.title}",
    body = "The lead becomes a contact, with a company and a deal if you want them.",
    icon = "arrow_forward",
    confirmLabel = "Convert",
    busy = busy.busy,
    error = busy.error,
    onDismiss = onDismiss,
    onConfirm = {
      onConvert(
        ConvertDraft(
          ownerUid = owner.ifEmpty { null },
          companyId = companyId.takeIf { companyMode == "existing" && it.isNotEmpty() },
          createCompanyName = companyName.takeIf { companyMode == "new" },
          dealTitle = dealTitle.takeIf { withDeal },
          dealAmountCents = amount.removePrefix("$").replace(",", "").toDoubleOrNull()?.let { kotlin.math.round(it * 100).toLong() },
          dealStageId = stageId.ifEmpty { null },
        ),
      )
    },
  ) {
    FieldEditor(FieldSpec("owner", "Owner", FieldKind.SELECT, options = reference.members.map { FieldOption(it.uid, it.label) }, emptyLabel = "No owner"), owner, { owner = it })
    ChoiceChipRow(listOf(ChipOption("new", "New company"), ChipOption("existing", "Existing company"), ChipOption("none", "No company")), companyMode, { companyMode = it })
    when (companyMode) {
      "new" -> OutlinedTextField(companyName, { companyName = it }, label = { Text("Company name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      "existing" -> FieldEditor(FieldSpec("company", "Company", FieldKind.SELECT, options = reference.companies, emptyLabel = "Choose"), companyId, { companyId = it })
    }
    com.aglyn.ui.SwitchRow("Create a deal", withDeal, { withDeal = it })
    if (withDeal) {
      OutlinedTextField(dealTitle, { dealTitle = it }, label = { Text("Deal name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      OutlinedTextField(amount, { amount = it }, label = { Text("Amount") }, prefix = { Text("$") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      FieldEditor(FieldSpec("stage", "Stage", FieldKind.SELECT, options = pipeline.stages.filter { it.kind == "open" }.map { FieldOption(it.id, it.name) }, emptyLabel = null), stageId, { stageId = it })
    }
  }
}
