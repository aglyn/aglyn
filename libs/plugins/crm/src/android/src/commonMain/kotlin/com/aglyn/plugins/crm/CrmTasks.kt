package com.aglyn.plugins.crm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.contracts.ListQuerySort
import com.aglyn.contracts.ListQuerySortDirection
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.Busy
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldOption
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.LiveListPane
import com.aglyn.ui.LiveQueryList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.isoDayMillis
import com.aglyn.ui.isoDayOf
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive

/*
 * THE CRM'S TASKS (the console's Tasks section and every record's task card).
 *
 * The views are the console's (`crmTaskViewPlan`): Mine, Overdue, Today,
 * Upcoming, Open and Done, each the plan's base clauses on `crmTasks` over
 * TASK_LIST_DECLARATION, by due date. A task is saved and completed through
 * the console's task routes, which stamp the scope and tell the assignee;
 * reopening and deleting are the console's own client writes.
 */

data class CrmTask(
  val id: String,
  val title: String,
  val kind: String,
  val priority: String,
  val status: String,
  val dueAtMs: Long?,
  val assigneeUid: String?,
  val notes: String,
  val contactId: String?,
  val companyId: String?,
  val dealId: String?,
  val leadId: String?,
) {
  val links: Map<String, String?> get() = mapOf("contactId" to contactId, "companyId" to companyId, "dealId" to dealId)
  val draft: TaskDraft get() = TaskDraft(title, kind, priority, dueAtMs, assigneeUid, notes, contactId, companyId, dealId)
}

fun taskOf(doc: FirestoreDoc) = CrmTask(
  id = doc.id,
  title = doc.string("title") ?: "Task",
  kind = doc.string("kind") ?: "todo",
  priority = doc.string("priority") ?: "normal",
  status = doc.string("status") ?: "open",
  dueAtMs = millisOf(doc.data["dueAtMs"]),
  assigneeUid = doc.string("assigneeUid"),
  notes = doc.string("notes").orEmpty(),
  contactId = doc.string("contactId"),
  companyId = doc.string("companyId"),
  dealId = doc.string("dealId"),
  leadId = doc.string("leadId"),
)

enum class TaskView(val key: String, val label: String) {
  MINE("mine", "Mine"), OVERDUE("overdue", "Overdue"), TODAY("today", "Today"), UPCOMING("upcoming", "Upcoming"), OPEN("open", "All open"), DONE("done", "Done")
}

/** The view's plan (`crmTaskViewPlan`): status, assignee, a due range, and the order. */
data class TaskViewPlan(val status: String, val assigneeUid: String? = null, val dueFrom: Long? = null, val dueBefore: Long? = null, val descending: Boolean = false)

fun taskViewPlan(view: TaskView, nowMs: Long, uid: String, startOfDay: (Long) -> Long = ::startOfLocalDay): TaskViewPlan {
  val today = startOfDay(nowMs)
  val tomorrow = startOfDay(today + 36 * 3_600_000L)
  return when (view) {
    TaskView.MINE -> TaskViewPlan("open", assigneeUid = uid)
    TaskView.OVERDUE -> TaskViewPlan("open", dueBefore = today)
    TaskView.TODAY -> TaskViewPlan("open", dueFrom = today, dueBefore = tomorrow)
    TaskView.UPCOMING -> TaskViewPlan("open", dueFrom = tomorrow)
    TaskView.OPEN -> TaskViewPlan("open")
    TaskView.DONE -> TaskViewPlan("done", descending = true)
  }
}

/** Midnight of the device's day, as the console reads "today" in the browser's zone. */
expect fun startOfLocalDay(nowMs: Long): Long

fun tasksQuery(scope: CrmScope, plan: TaskViewPlan, search: String, limit: Int) = planListQuery(
  Contracts.taskListDeclaration,
  ListQueryRequest(
    base = scopeBase(scope) + listOfNotNull(
      ListQueryFilter(ListQueryOp.EQUAL, "status", JsonPrimitive(plan.status)),
      plan.assigneeUid?.let { ListQueryFilter(ListQueryOp.EQUAL, "assigneeUid", JsonPrimitive(it)) },
      plan.dueFrom?.let { ListQueryFilter(ListQueryOp.GREATER_THAN_OR_EQUAL, "dueAtMs", JsonPrimitive(it)) },
      plan.dueBefore?.let { ListQueryFilter(ListQueryOp.LESS_THAN, "dueAtMs", JsonPrimitive(it)) },
    ),
    clauses = emptyList(),
    search = search.trim().ifEmpty { null }?.let { listOf(it) },
    sort = ListQuerySort(direction = if (plan.descending) ListQuerySortDirection.DESC else ListQuerySortDirection.ASC, path = "dueAtMs"),
  ),
).toFirestoreQuery(crmPath(scope.orgId, "crmTasks"), limit)

private fun kindLabel(kind: String) = Contracts.crmTaskKindLabels[kind] ?: kind

/** One task: a tick, its title, when it is due and whose it is. */
@Composable
fun TaskRow(task: CrmTask, reference: CrmReference, onToggle: (() -> Unit)?, onClick: (() -> Unit)? = null) {
  val now = remember { nowMillis() }
  val overdue = task.status == "open" && task.dueAtMs != null && task.dueAtMs < startOfLocalDay(now)
  AglynListItem(
    title = task.title,
    supporting = listOfNotNull(
      kindLabel(task.kind),
      task.dueAtMs?.let { "Due ${isoDayOf(it)}" },
      reference.memberLabel(task.assigneeUid),
    ).joinToString(" · "),
    emphasized = task.status == "open",
    trailing = {
      Row(verticalAlignment = Alignment.CenterVertically) {
        if (overdue) StatusChip("Overdue", StatusTone.ERROR)
        if (task.priority == "high") StatusChip("High", StatusTone.WARNING)
        if (onToggle != null) {
          Checkbox(
            checked = task.status == "done",
            onCheckedChange = { onToggle() },
            modifier = Modifier.testTag("task-done-${task.id}").semantics { contentDescription = if (task.status == "done") "Reopen ${task.title}" else "Complete ${task.title}" },
          )
        }
      }
    },
    onClick = onClick,
    modifier = Modifier.testTag("task-${task.id}"),
  )
}

/** The task form: what it is, when it is due, whose it is and what it is about. */
@Composable
fun TaskDialog(title: String, initial: TaskDraft, reference: CrmReference, busy: Busy, onDismiss: () -> Unit, onDelete: (() -> Unit)? = null, onSave: (TaskDraft) -> Unit) {
  var draft by remember { mutableStateOf(initial) }
  ActionDialog(
    title = title,
    icon = "task",
    confirmLabel = "Save",
    confirmEnabled = draft.title.isNotBlank(),
    busy = busy.busy,
    error = busy.error,
    onDismiss = onDismiss,
    dismissLabel = "Cancel",
    onConfirm = { onSave(draft) },
  ) {
    OutlinedTextField(draft.title, { draft = draft.copy(title = it.take(200)) }, label = { Text("Task") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("task-title"))
    ChoiceChipRow(Contracts.crmTaskKindLabels.map { ChipOption(it.key, it.value) }, draft.kind, { draft = draft.copy(kind = it) })
    ChoiceChipRow(listOf("low" to "Low", "normal" to "Normal", "high" to "High").map { ChipOption(it.first, it.second) }, draft.priority, { draft = draft.copy(priority = it) })
    FieldEditor(FieldSpec("due", "Due date", FieldKind.DATE), draft.dueAtMs?.let(::isoDayOf).orEmpty(), { day ->
      // A new day keeps the time of day the task was due at, or 9 AM where the person is.
      val time = draft.dueAtMs?.let { it - startOfLocalDay(it) } ?: (9 * 3_600_000L)
      draft = draft.copy(dueAtMs = isoDayMillis(day)?.let { startOfLocalDay(it + 12 * 3_600_000L) + time })
    })
    FieldEditor(
      FieldSpec("assignee", "Assigned to", FieldKind.SELECT, options = reference.members.map { FieldOption(it.uid, it.label) }, emptyLabel = "Nobody"),
      draft.assigneeUid.orEmpty(),
      { draft = draft.copy(assigneeUid = it.ifEmpty { null }) },
    )
    FieldEditor(FieldSpec("company", "Company", FieldKind.SELECT, options = reference.companies, emptyLabel = "None"), draft.companyId.orEmpty(), { draft = draft.copy(companyId = it.ifEmpty { null }) })
    FieldEditor(FieldSpec("contact", "Contact", FieldKind.SELECT, options = reference.contacts, emptyLabel = "None"), draft.contactId.orEmpty(), { draft = draft.copy(contactId = it.ifEmpty { null }) })
    OutlinedTextField(draft.notes, { draft = draft.copy(notes = it.take(4000)) }, label = { Text("Notes") }, minLines = 2, modifier = Modifier.fillMaxWidth())
    if (onDelete != null) {
      androidx.compose.material3.TextButton(onClick = onDelete, enabled = !busy.busy) { Text("Delete this task", color = MaterialTheme.colorScheme.error) }
    }
  }
}

/** The Tasks section: the console's views, a search, a tick to complete, a press to edit. */
@Composable
fun TasksSection(context: NativePluginContext, scope: CrmScope, api: CrmApi, reference: CrmReference) {
  val coroutines = rememberCoroutineScope()
  var view by rememberSaveable { mutableStateOf(TaskView.MINE) }
  var search by rememberSaveable { mutableStateOf("") }
  var asked by rememberSaveable { mutableStateOf("") }
  var editing by remember { mutableStateOf<CrmTask?>(null) }
  var creating by remember { mutableStateOf(false) }
  val list = remember(scope, context.firestore) { LiveQueryList(context.firestore, coroutines, 25, ::taskOf) }
  LaunchedEffect(list, view, asked) {
    val plan = taskViewPlan(view, nowMillis(), scope.uid)
    list.show { limit -> tasksQuery(scope, plan, asked, limit) }
  }
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(Modifier.widthIn(max = 920.dp).fillMaxSize()) {
      Column(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          com.aglyn.ui.SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = "Search tasks", modifier = Modifier.weight(1f), onSearch = { asked = search })
          if (scope.canWrite) {
            FilledTonalButton(onClick = { creating = true }, modifier = Modifier.testTag("crm-new-task")) {
              Icon(AglynIcons.named("add"), contentDescription = null)
              Text("New", Modifier.padding(start = space(0.5f)))
            }
          }
        }
        ChoiceChipRow(TaskView.entries.map { ChipOption(it.key, it.label) }, view.key, { key -> view = TaskView.entries.first { it.key == key } })
      }
      LiveListPane(
        list,
        key = { it.id },
        failed = "Could not load tasks",
        empty = { EmptyState(if (view == TaskView.DONE) "Nothing done yet" else "Nothing to do here", body = "Tasks you and your team add show up here.", icon = AglynIcons.named("task")) },
      ) { task ->
        TaskRow(
          task,
          reference,
          onToggle = if (scope.canWrite) ({
            coroutines.launch { runCatching { if (task.status == "done") api.reopenTask(task.id, task.links) else api.completeTask(task.id) } }
          }) else null,
          onClick = if (scope.canWrite) ({ editing = task }) else null,
        )
      }
    }
  }
  val busy = remember(editing, creating) { Busy() }
  if (creating) {
    TaskDialog("New task", TaskDraft(title = "", assigneeUid = scope.uid), reference, busy, onDismiss = { creating = false }) { draft ->
      busy.run(coroutines, { creating = false }) { api.saveTask(null, draft) }
    }
  }
  editing?.let { task ->
    TaskDialog(
      "Edit task",
      task.draft,
      reference,
      busy,
      onDismiss = { editing = null },
      onDelete = { busy.run(coroutines, { editing = null }) { api.deleteTask(task.id, task.links) } },
    ) { draft -> busy.run(coroutines, { editing = null }) { api.saveTask(task.id, draft) } }
  }
}
