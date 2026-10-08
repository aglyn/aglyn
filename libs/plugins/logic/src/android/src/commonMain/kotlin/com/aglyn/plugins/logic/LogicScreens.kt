package com.aglyn.plugins.logic

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.HostVariableType
import com.aglyn.contracts.WhereUsedResult
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.Live
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.parseUtcDay
import com.aglyn.pluginhost.utcDay
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.ChoiceField
import com.aglyn.ui.DateField
import com.aglyn.ui.EmptyState
import com.aglyn.ui.InputChoice
import com.aglyn.ui.ListHeader
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space

const val LOGIC_PAGE_SCREEN = "logic.page"
const val LOGIC_FUNCTION_SCREEN = "logic.function"

/** Roles the rules let change a site's logic: the publishing roles. */
internal val LOGIC_WRITE_ROLES = setOf("admin", "editor")

private enum class LogicTab(val label: String) { VARIABLES("Variables"), FUNCTIONS("Functions") }

/** A variable being edited; [id] null for a new one. */
internal data class VariableDraft(
  val id: String?,
  val name: String = "",
  val type: HostVariableType = HostVariableType.TEXT,
  val value: String = "",
  val workflowId: String = "",
  val workflowName: String = "",
)

private sealed interface LogicDialog {
  data class EditVariable(val draft: VariableDraft) : LogicDialog
  data class Delete(val kind: String, val id: String, val name: String, val scan: WhereUsedResult?) : LogicDialog
  data class Usage(val name: String, val scan: WhereUsedResult?) : LogicDialog
}

/**
 * A site's Functions & Variables: the variables (typed values bound into
 * text with `{{name}}`) and the no-code functions, each with where it is
 * used, edit and delete; a new one of either. A function opens in its own
 * editor screen.
 */
@Composable
fun LogicScreen(context: NativePluginContext, initialTab: String? = null) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val api = remember(hostId, context.api, context.writer) { LogicApi(context.api, context.writer, hostId) }
  val runner = remember(hostId) { ActionRunner(scope) }
  var tab by remember { mutableStateOf(if (initialTab == "functions") LogicTab.FUNCTIONS else LogicTab.VARIABLES) }
  var dialog by remember { mutableStateOf<LogicDialog?>(null) }
  val canEdit = context.siteRole in LOGIC_WRITE_ROLES
  val variablesLive by remember(hostId, context.firestore) { context.firestore.observe(ceilingQuery(variablesPath(hostId))) }.collectAsState(Live.Loading)
  val functionsLive by remember(hostId, context.firestore) { context.firestore.observe(ceilingQuery(functionsPath(hostId))) }.collectAsState(Live.Loading)
  val variables = (variablesLive as? Live.Ready)?.value?.let { docs -> liveWindow(docs, VariableRow::from) { it.name } }
  val functions = (functionsLive as? Live.Ready)?.value?.let { docs -> liveWindow(docs, FunctionRow::from) { it.name } }

  fun scanThen(kind: String, id: String, name: String, open: (WhereUsedResult) -> LogicDialog) {
    runner.run { dialog = open(api.whereUsed(kind, id, name)) }
  }

  Column(Modifier.fillMaxSize()) {
    ListHeader("Functions & Variables") {
      Button(
        onClick = {
          if (tab == LogicTab.VARIABLES) dialog = LogicDialog.EditVariable(VariableDraft(null)) else context.navigate(LOGIC_FUNCTION_SCREEN)
        },
        enabled = canEdit,
        modifier = Modifier.testTag("logic-add"),
      ) {
        Icon(AglynIcons.named("add"), contentDescription = null)
        Text(if (tab == LogicTab.VARIABLES) "Add variable" else "Add function", Modifier.padding(start = space(1f)))
      }
    }
    Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      if (dialog == null) {
        runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
        runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
      }
      ChoiceChipRow(LogicTab.entries.map { ChipOption(it.name, it.label, if (it == LogicTab.VARIABLES) "data_object" else "functions") }, tab.name, { tab = LogicTab.valueOf(it) })
      val window = if (tab == LogicTab.VARIABLES) variables?.second else functions?.second
      if (window == true) NoticeBanner("Showing the first $LOGIC_CEILING. Delete ones you no longer use to see the rest.", StatusTone.INFO)
    }
    val failed = (if (tab == LogicTab.VARIABLES) variablesLive else functionsLive) is Live.Failed
    when {
      failed -> EmptyState("Could not load this list", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
      tab == LogicTab.VARIABLES && variables == null -> SkeletonList(rows = 5, modifier = Modifier.padding(space(2f)))
      tab == LogicTab.FUNCTIONS && functions == null -> SkeletonList(rows = 5, modifier = Modifier.padding(space(2f)))
      tab == LogicTab.VARIABLES -> VariableList(variables!!.first, canEdit, onEdit = { row ->
        dialog = LogicDialog.EditVariable(VariableDraft(row.id, row.name, row.type, row.value, row.workflowId, row.workflowName))
      }, onUsage = { row -> scanThen("variable", row.id, row.name) { LogicDialog.Usage(row.name, it) } }) { row ->
        scanThen("variable", row.id, row.name) { LogicDialog.Delete("variable", row.id, row.name, it) }
      }
      else -> FunctionList(functions!!.first, canEdit, onEdit = { row -> context.navigate(LOGIC_FUNCTION_SCREEN, mapOf("function" to row.id)) }, onUsage = { row ->
        scanThen("function", row.id, row.name) { LogicDialog.Usage(row.name, it) }
      }) { row -> scanThen("function", row.id, row.name) { LogicDialog.Delete("function", row.id, row.name, it) } }
    }
  }

  when (val open = dialog) {
    null -> Unit
    is LogicDialog.EditVariable -> VariableEditor(context, hostId, open.draft, variables?.first.orEmpty(), api, runner) { dialog = null }
    is LogicDialog.Usage -> UsageDialog(context, open.name, open.scan) { dialog = null }
    is LogicDialog.Delete -> {
      val used = open.scan?.total ?: 0L
      ActionDialog(
        title = if (open.kind == "variable") "Delete this variable?" else "Delete this function?",
        body = if (used > 0) {
          "\"${open.name}\" is used in ${summarizeDependents(open.scan!!)}" +
            if (open.kind == "variable") ". Those bindings will render as empty or literal tokens after the next publish." else " — those references will stop resolving after the next publish."
        } else {
          "\"${open.name}\" is not referenced by any published page, layout, or workflow."
        },
        icon = "delete",
        confirmLabel = "Delete",
        destructive = true,
        busy = runner.busy,
        error = runner.error,
        onDismiss = { dialog = null },
        onConfirm = {
          val path = (if (open.kind == "variable") variablesPath(hostId) else functionsPath(hostId)) + "/" + open.id
          runner.run(if (open.kind == "variable") "Variable deleted." else "Function deleted.", onDone = { dialog = null }) { api.delete(path) }
        },
      )
    }
  }
}

@Composable
private fun VariableList(rows: List<VariableRow>, canEdit: Boolean, onEdit: (VariableRow) -> Unit, onUsage: (VariableRow) -> Unit, onDelete: (VariableRow) -> Unit) {
  if (rows.isEmpty()) {
    return EmptyState(
      "No variables yet",
      body = "A variable is a value you bind into any text with {{name}}: a phone number, a price, an opening date. Change it once and every page follows.",
      icon = AglynIcons.named("data_object"),
    )
  }
  LazyColumn(Modifier.fillMaxSize().testTag("variables-list")) {
    items(rows, key = { it.id }) { row ->
      AglynListItem(
        title = row.name,
        supporting = "${Contracts.hostVariableTypeLabels[row.type.raw] ?: row.type.raw} · ${formatVariableValue(row.type, row.value).ifEmpty { "—" }}",
        icon = AglynIcons.named("data_object"),
        trailing = {
          OverflowMenu(
            listOf(
              MenuAction("usage-${row.id}", "Where it's used", "travel_explore") { onUsage(row) },
              MenuAction("edit-${row.id}", "Edit", "edit", enabled = canEdit) { onEdit(row) },
              MenuAction("delete-${row.id}", "Delete", "delete", destructive = true, enabled = canEdit) { onDelete(row) },
            ),
            contentDescription = "More for ${row.name}",
          )
        },
        onClick = if (canEdit) ({ onEdit(row) }) else null,
        modifier = Modifier.testTag("variable-${row.id}"),
      )
    }
  }
}

@Composable
private fun FunctionList(rows: List<FunctionRow>, canEdit: Boolean, onEdit: (FunctionRow) -> Unit, onUsage: (FunctionRow) -> Unit, onDelete: (FunctionRow) -> Unit) {
  if (rows.isEmpty()) {
    return EmptyState(
      "No functions yet",
      body = "Build no-code logic: parameters in, conditional operations, a value out. Wire functions into components and workflows as the builder grows.",
      icon = AglynIcons.named("functions"),
    )
  }
  LazyColumn(Modifier.fillMaxSize().testTag("functions-list")) {
    items(rows, key = { it.id }) { row ->
      AglynListItem(
        title = row.name.ifEmpty { row.id },
        supporting = row.signature,
        icon = AglynIcons.named("functions"),
        trailing = {
          OverflowMenu(
            listOf(
              MenuAction("usage-${row.id}", "Where it's used", "travel_explore") { onUsage(row) },
              MenuAction("edit-${row.id}", "Edit", "edit", enabled = canEdit) { onEdit(row) },
              MenuAction("delete-${row.id}", "Delete", "delete", destructive = true, enabled = canEdit) { onDelete(row) },
            ),
            contentDescription = "More for ${row.name}",
          )
        },
        onClick = { onEdit(row) },
        modifier = Modifier.testTag("function-${row.id}"),
      )
    }
  }
}

/** The where-used scan laid out: each page, layout or record that references it, and a page's Besigner. */
@Composable
private fun UsageDialog(context: NativePluginContext, name: String, scan: WhereUsedResult?, close: () -> Unit) {
  val dependents = scan?.dependents.orEmpty()
  ActionDialog(
    title = "Where \"$name\" is used",
    body = if (dependents.isEmpty()) "Nothing published references it." else summarizeDependents(scan!!),
    icon = "travel_explore",
    confirmLabel = "Done",
    dismissLabel = "Close",
    onDismiss = close,
    onConfirm = close,
  ) {
    if ((scan?.legacyCount ?: 0L) > 0) NoticeBanner("Some places use it by its name; renaming it breaks those.", StatusTone.WARNING)
    Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
      dependents.forEachIndexed { index, dependent ->
        if (index > 0) HorizontalDivider()
        val path = dependentBesignerPath(dependent.type, dependent.id, dependent.versionId)
        AglynListItem(
          title = dependent.name?.ifEmpty { null } ?: dependent.id.orEmpty(),
          supporting = (if (dependent.type == "screen") "page" else dependent.type.orEmpty()) +
            if (dependent.via.orEmpty().any { it.raw == "name" }) " · legacy token" else "",
          icon = AglynIcons.named(if (dependent.type == "screen") "description" else if (dependent.type == "layout") "view_quilt" else "bolt"),
          trailing = path?.let { { TextButton(onClick = { context.openBesigner(it, ConsoleScope.SITE) }) { Text("Open") } } },
        )
      }
    }
  }
}

@Composable
private fun VariableEditor(
  context: NativePluginContext,
  hostId: String,
  start: VariableDraft,
  variables: List<VariableRow>,
  api: LogicApi,
  runner: ActionRunner,
  close: () -> Unit,
) {
  var draft by remember(start) { mutableStateOf(start) }
  val validName = isVariableName(draft.name)
  val nameTaken = variables.any { it.name.lowercase() == draft.name.trim().lowercase() && it.id != draft.id }
  val workflows by remember(hostId, context.firestore) { context.firestore.observe(ceilingQuery("hosts/$hostId/workflows")) }.collectAsState(Live.Loading)
  val workflowChoices = ((workflows as? Live.Ready)?.value).orEmpty().take(LOGIC_CEILING)
    .filter { it.data["deletedAt"] == null && !it.string("name").isNullOrBlank() }
    .map { doc: FirestoreDoc -> InputChoice(doc.id, doc.string("name")!!.trim()) }
    .sortedBy { it.label.lowercase() }
  ActionDialog(
    title = if (draft.id == null) "New variable" else "Edit variable",
    icon = "data_object",
    confirmLabel = "Save",
    confirmEnabled = validName && !nameTaken,
    busy = runner.busy,
    error = runner.error,
    onDismiss = { runner.error = null; close() },
    onConfirm = {
      runner.run("Saved — use {{${draft.name}}} in any text to bind it", onDone = close) {
        api.saveVariable(draft.id, draft.name, draft.type, draft.value, draft.workflowId, draft.workflowName)
      }
    },
    modifier = Modifier.testTag("variable-editor"),
  ) {
    Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedTextField(
        draft.name,
        { draft = draft.copy(name = it.filter { ch -> ch.isLetterOrDigit() && ch.code < 128 || ch == '_' }) },
        label = { Text("Name") },
        isError = draft.name.isNotEmpty() && (!validName || nameTaken),
        supportingText = {
          Text(
            when {
              nameTaken -> "A variable with this name already exists"
              draft.name.isNotEmpty() && !validName -> "Start with a letter or _; letters, numbers and _ only, up to 40"
              else -> "Bind it with {{${draft.name.ifEmpty { "name" }}}}"
            },
          )
        },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("variable-name"),
      )
      ChoiceField(
        "Type",
        draft.type.raw,
        HostVariableType.entries.filter { it != HostVariableType.UNKNOWN }.map { InputChoice(it.raw, Contracts.hostVariableTypeLabels[it.raw] ?: it.raw) },
        { raw -> HostVariableType.entries.firstOrNull { it.raw == raw }?.let { if (it != draft.type) draft = draft.copy(type = it, value = "") } },
        allowEmpty = false,
      )
      VariableValueInput(draft.type, draft.value) { draft = draft.copy(value = it) }
      ChoiceField(
        "Filled by workflow",
        draft.workflowId,
        workflowChoices,
        { id -> draft = draft.copy(workflowId = id, workflowName = workflowChoices.firstOrNull { it.value == id }?.label.orEmpty()) },
        supporting = "Optional: a workflow that computes the value; the value above is its fallback",
        emptyLabel = "None",
      )
    }
  }
}

/** The value input for a variable's type, as the card's editor draws it. */
@Composable
private fun VariableValueInput(type: HostVariableType, value: String, onChange: (String) -> Unit) {
  val modifier = Modifier.fillMaxWidth().testTag("variable-value")
  when (type) {
    HostVariableType.BOOLEAN -> SwitchRow("Value", value == "true", { onChange(if (it) "true" else "false") }, modifier, supporting = if (value == "true") "True" else "False")
    HostVariableType.DATE -> DateField("Value", value, onChange, toMillis = ::parseUtcDay, fromMillis = ::utcDay, modifier = modifier)
    HostVariableType.TIME -> OutlinedTextField(value, onChange, label = { Text("Value") }, placeholder = { Text("HH:mm") }, singleLine = true, modifier = modifier)
    HostVariableType.NUMBER -> OutlinedTextField(
      value,
      { onChange(it.filter { ch -> ch.isDigit() || ch in ".eE+-" }) },
      label = { Text("Value") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
      modifier = modifier,
    )
    HostVariableType.DICTIONARY -> OutlinedTextField(value, onChange, label = { Text("Value") }, placeholder = { Text("{\"key\": \"value\"}") }, minLines = 3, modifier = modifier)
    HostVariableType.COLLECTION -> OutlinedTextField(value, onChange, label = { Text("Value") }, placeholder = { Text("[\"a\", \"b\"]") }, minLines = 3, modifier = modifier)
    else -> OutlinedTextField(value, onChange, label = { Text("Value") }, minLines = 2, modifier = modifier)
  }
}
