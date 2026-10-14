package com.aglyn.plugins.data

import com.aglyn.pluginhost.parseUtcMinute
import com.aglyn.pluginhost.utcMinute
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.DatasetFieldDefinition
import com.aglyn.contracts.DatasetFieldType
import com.aglyn.contracts.DatasetModel
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.plainJson
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.jsString
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.ClauseFilterBar
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.ORG_WRITER_ROLES
import com.aglyn.pluginhost.TransferExportDialog
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChoiceField
import com.aglyn.ui.DateTimeField
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.InputChoice
import com.aglyn.ui.ListHeader
import com.aglyn.ui.LoadContent
import com.aglyn.ui.LoadMoreEffect
import com.aglyn.ui.MenuAction
import com.aglyn.ui.MultiChoiceField
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.RefreshableBox
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

private sealed interface RecordDialog {
  /** [recordId] null: a new record. [values] are the inputs' text. */
  data class Edit(val recordId: String?, val values: Map<String, String>) : RecordDialog
  data class Delete(val record: RecordRow) : RecordDialog
  data object Export : RecordDialog
}

/** The inputs' text for a new record: each field's default, as the editor pre-fills it. */
internal fun newRecordInputs(model: DatasetModel): Map<String, String> = model.orderedFields().mapNotNull { (id, field) ->
  plainJson(field.default)?.let { id to jsString(it) }
}.toMap()

/** The inputs' text for an existing record (`datasetValueToInput`). */
internal fun recordInputs(model: DatasetModel, values: Map<String, Any?>): Map<String, String> =
  model.orderedFields().associate { (id, field) -> id to datasetValueToInput(field, values[id]) }

/**
 * What an input's text is sent as: a timestamp's `YYYY-MM-DDTHH:mm` gains its
 * zone, since the editor shows UTC, and the route reads it in the server's.
 */
internal fun inputsForWrite(model: DatasetModel, inputs: Map<String, String>): Map<String, String> = inputs.mapValues { (id, text) ->
  if (model.fields?.get(id)?.type == DatasetFieldType.TIMESTAMP && parseUtcMinute(text) != null && !text.trim().endsWith("Z")) text.trim() + "Z" else text
}

/** Each reference field's choices: the target's first 200 records, by its display field (`refOptions`). */
@Composable
internal fun rememberReferenceChoices(firestore: FirestoreReader, orgId: String, model: DatasetModel): Map<String, List<InputChoice>> {
  var choices by remember(model) { mutableStateOf<Map<String, List<InputChoice>>>(emptyMap()) }
  LaunchedEffect(model) {
    val loaded = mutableMapOf<String, List<InputChoice>>()
    for ((id, field) in model.orderedFields()) {
      val reference = field.reference?.takeIf { field.type == DatasetFieldType.REFERENCE } ?: continue
      runCatching {
        val target = firestore.get("${datasetsPath(orgId)}/${reference.datasetId}")?.data.orEmpty()
        val display = reference.displayFieldId ?: effectiveDatasetModel(target).order?.firstOrNull()
        firestore.page(FirestoreQuery(recordsPath(orgId, reference.datasetId), limit = 200)).docs.map { doc ->
          val values = doc.data["values"] as? Map<*, *>
          InputChoice(doc.id, values?.get(display ?: "")?.let(::jsString) ?: doc.id)
        }
      }.onSuccess { loaded[id] = it }
    }
    choices = loaded
  }
  return choices
}

/**
 * A dataset's records, the picked one beside the list on wide windows: the
 * quick search and the filters as one query, a page at a time, and each
 * record's values with edit, delete and export of what the list shows.
 */
@Composable
fun RecordsScreen(context: NativePluginContext, datasetId: String, initialRecordId: String? = null, startNew: Boolean = false) {
  val orgId = context.orgId ?: return EmptyState("Pick a workspace to see its data", icon = AglynIcons.named("dataset"))
  val live by remember(orgId, datasetId, context.firestore) { context.firestore.observeDoc("${datasetsPath(orgId)}/$datasetId") }.collectAsState(Live.Loading)
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this dataset", body = "It may no longer be shared with you.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val doc = value.value ?: return EmptyState("This dataset is gone", icon = AglynIcons.named("dataset"))
      Records(context, orgId, DatasetRow.from(doc), initialRecordId, startNew)
    }
  }
}

@Composable
private fun Records(context: NativePluginContext, orgId: String, dataset: DatasetRow, initialRecordId: String?, startNew: Boolean) {
  val scope = rememberCoroutineScope()
  val model = remember(dataset.id, dataset.model) { RecordsModel(orgId, dataset, context.firestore, scope) }
  LaunchedEffect(model) { model.reload() }
  val api = remember(orgId, context.api, context.writer) { DataApi(context.api, context.writer, orgId) }
  val runner = remember(dataset.id) { ActionRunner(scope, roleHint = "an owner, admin or editor") }
  val canWrite = context.orgRole in ORG_WRITER_ROLES
  val references = rememberReferenceChoices(context.firestore, orgId, dataset.model)
  var dialog by remember { mutableStateOf<RecordDialog?>(if (startNew && canWrite) RecordDialog.Edit(null, newRecordInputs(dataset.model)) else null) }
  val noun = dataset.singular.ifBlank { "record" }.lowercase()

  AglynListDetail(
    initialSelected = initialRecordId,
    list = { selected, onSelect ->
      val listState = rememberLazyListState()
      LoadMoreEffect(listState, model.hasMore, onLoadMore = model::loadMore)
      Column(Modifier.fillMaxSize()) {
        ListHeader(dataset.plural.ifBlank { dataset.name }) {
          OverflowMenu(listOf(MenuAction("export", "Export records", "download") { dialog = RecordDialog.Export }))
          Button(
            onClick = { dialog = RecordDialog.Edit(null, newRecordInputs(dataset.model)) },
            enabled = canWrite,
            modifier = Modifier.testTag("add-record"),
          ) {
            Icon(AglynIcons.named("add"), contentDescription = null)
            Text("Add $noun", Modifier.padding(start = space(1f)))
          }
        }
        Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          if (dialog == null) {
            runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
            runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
          }
          SearchField(model.search, model::type, placeholder = "Search ${dataset.name}")
          ClauseFilterBar(
            fields = model.plan.filter.fields,
            headers = model.plan.filter.headers,
            choices = model.plan.filter.options,
            clauses = model.clauses,
            onChange = model::setFilters,
            refused = model.plan.refused,
            notices = model.plan.notices,
          )
        }
        RefreshableBox(model.refreshing, model::refresh) {
          LoadContent(model.rows, onRetry = { model.reload() }, failedTitle = "Could not load records") { rows ->
            if (rows.isEmpty()) {
              EmptyState(
                if (model.filtering) "No records match these filters" else "No records yet",
                body = if (model.filtering) "Try another search or remove a filter." else "Add the first $noun.",
                icon = AglynIcons.named("table_chart"),
              )
            } else {
              LazyColumn(Modifier.fillMaxSize().testTag("records-list"), state = listState) {
                items(rows, key = { it.id }) { row ->
                  AglynListItem(
                    title = row.title(dataset.model),
                    supporting = row.supporting(dataset.model),
                    icon = AglynIcons.named("article"),
                    selected = row.id == selected,
                    onClick = { onSelect(row.id) },
                    modifier = Modifier.testTag("record-${row.id}"),
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
        EmptyState("Pick a $noun to see it here", icon = AglynIcons.named("article"))
      } else {
        RecordDetail(context, orgId, dataset, selected, references, canWrite) { dialog = it }
      }
    },
  )

  when (val open = dialog) {
    null -> Unit
    is RecordDialog.Edit -> RecordEditor(dataset, open, references, api, runner, onSaved = { model.refresh() }) { dialog = null }
    is RecordDialog.Delete -> ActionDialog(
      title = "Delete this $noun?",
      body = "It stops showing on every page that repeats over ${dataset.name}. Records in other datasets that point at it lose the reference, unless one blocks the delete.",
      icon = "delete",
      confirmLabel = "Delete",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = { dialog = null },
      onConfirm = { runner.run("Record deleted.", onDone = { dialog = null; model.refresh() }) { api.deleteRecord(dataset.id, open.record.id) } },
    )
    RecordDialog.Export -> TransferExportDialog(
      context,
      resource = datasetTransferResource(dataset.id),
      title = "Export ${dataset.name}",
      hostId = null,
      // The list's own query, re-planned on the server the way the list plans it.
      scope = if (model.filtering) {
        mapOf("kind" to "filter", "filter" to mapOf("clauses" to model.clauses.map { mapOf("field" to it.field, "op" to it.op, "value" to it.value) }, "search" to searchWords(model.search)))
      } else {
        mapOf("kind" to "all")
      },
      fileStem = dataset.name.ifBlank { dataset.id },
    ) { message ->
      dialog = null
      if (message != null) runner.notice = message
    }
  }
}

@Composable
private fun RecordDetail(
  context: NativePluginContext,
  orgId: String,
  dataset: DatasetRow,
  recordId: String,
  references: Map<String, List<InputChoice>>,
  canWrite: Boolean,
  open: (RecordDialog) -> Unit,
) {
  val live by remember(orgId, dataset.id, recordId, context.firestore) { context.firestore.observeDoc("${recordsPath(orgId, dataset.id)}/$recordId") }.collectAsState(Live.Loading)
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this record", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val doc = value.value ?: return EmptyState("This record is gone", icon = AglynIcons.named("article"))
      val record = RecordRow.from(doc)
      val now = remember(record.updatedAt) { nowMillis() }
      Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("record-detail"),
        verticalArrangement = Arrangement.spacedBy(space(2f)),
      ) {
        SectionCard(null) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
              Text(record.title(dataset.model), Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
              Text(dataset.name, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
            OverflowMenu(listOf(MenuAction("delete", "Delete", "delete", destructive = true, enabled = canWrite) { open(RecordDialog.Delete(record)) }))
          }
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            Button(
              onClick = { open(RecordDialog.Edit(record.id, recordInputs(dataset.model, record.values))) },
              enabled = canWrite,
              modifier = Modifier.testTag("record-edit"),
            ) {
              Icon(AglynIcons.named("edit"), contentDescription = null)
              Text("Edit", Modifier.padding(start = space(1f)))
            }
          }
        }
        SectionCard("Values") {
          dataset.model.orderedFields().forEachIndexed { index, (id, field) ->
            if (index > 0) HorizontalDivider()
            DetailRow(field.label(id), recordValueText(field, record.values[id], references[id]))
          }
        }
        SectionCard("Details") {
          DetailRow("Record id", record.id)
          DetailRow("Created", record.createdAt?.let { relativeTime(it.epochMillis, now) })
          DetailRow("Updated", record.updatedAt?.let { relativeTime(it.epochMillis, now) })
        }
      }
    }
  }
}

/** A value as the record view shows it: a reference by its target's label, or its id when that resolves to nothing loaded. */
internal fun recordValueText(field: DatasetFieldDefinition, value: Any?, choices: List<InputChoice>?): String? {
  if (field.type == DatasetFieldType.REFERENCE) {
    val ids = when (value) {
      null -> emptyList()
      is List<*> -> value.mapNotNull { it?.toString() }
      else -> listOf(value.toString())
    }
    return ids.joinToString(", ") { id -> choices?.firstOrNull { it.value == id }?.label ?: "$id (not found)" }.ifEmpty { null }
  }
  return formatDatasetValue(field, value).ifEmpty { null }
}

/** The record editor: one typed input per field, as the console's record dialog draws them. */
@Composable
private fun RecordEditor(
  dataset: DatasetRow,
  open: RecordDialog.Edit,
  references: Map<String, List<InputChoice>>,
  api: DataApi,
  runner: ActionRunner,
  onSaved: () -> Unit,
  close: () -> Unit,
) {
  var inputs by remember(open) { mutableStateOf(open.values) }
  var errors by remember(open) { mutableStateOf<Map<String, String>>(emptyMap()) }
  val isNew = open.recordId == null
  val noun = dataset.singular.ifBlank { "record" }.lowercase()
  ActionDialog(
    title = if (isNew) "New $noun" else "Edit $noun",
    icon = if (isNew) "add" else "edit",
    confirmLabel = if (isNew) "Add" else "Save",
    busy = runner.busy,
    error = runner.error?.takeIf { errors.isEmpty() },
    onDismiss = { runner.error = null; close() },
    onConfirm = {
      errors = emptyMap()
      val values = inputsForWrite(dataset.model, inputs)
      runner.run(if (isNew) "Record added." else "Record saved.", onDone = { close(); onSaved() }) {
        try {
          if (isNew) api.createRecord(dataset.id, values) else api.updateRecord(dataset.id, open.recordId!!, values)
        } catch (invalid: RecordInvalid) {
          errors = invalid.errors
          throw invalid
        }
      }
    },
    modifier = Modifier.testTag("record-editor"),
  ) {
    Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      if (errors.isNotEmpty()) NoticeBanner("Fix the highlighted fields.", StatusTone.ERROR)
      for ((id, field) in dataset.model.orderedFields()) {
        RecordInput(
          id = id,
          field = field,
          value = inputs[id].orEmpty(),
          error = errors[id],
          choices = references[id].orEmpty(),
          onChange = { next -> inputs = inputs + (id to next); errors = errors - id },
        )
      }
    }
  }
}

@Composable
private fun RecordInput(id: String, field: DatasetFieldDefinition, value: String, error: String?, choices: List<InputChoice>, onChange: (String) -> Unit) {
  val label = field.label(id) + if (field.required == true) " *" else ""
  val hint = error ?: field.description
  val modifier = Modifier.fillMaxWidth().testTag("record-input-$id")
  when {
    field.customType != null -> OutlinedTextField(value, onChange, label = { Text(label) }, isError = error != null, supportingText = hint?.let { { Text(it) } }, singleLine = true, modifier = modifier)
    field.type == DatasetFieldType.BOOL -> ChoiceField(label, value, listOf(InputChoice("true", "Yes"), InputChoice("false", "No")), onChange, modifier, hint, error != null)
    field.type == DatasetFieldType.TEXT && !field.validation?.options.isNullOrEmpty() ->
      ChoiceField(label, value, field.validation!!.options!!.map { InputChoice(it, it) }, onChange, modifier, hint, error != null)
    field.type == DatasetFieldType.REFERENCE && field.reference?.multiple == true -> MultiChoiceField(
      label,
      value.split(',').map { it.trim() }.filter { it.isNotEmpty() },
      choices,
      { onChange(it.joinToString(", ")) },
      modifier,
      hint,
      error != null,
    )
    field.type == DatasetFieldType.REFERENCE -> ChoiceField(label, value, choices, onChange, modifier, hint, error != null)
    field.type == DatasetFieldType.INT32 || field.type == DatasetFieldType.INT64 || field.type == DatasetFieldType.FLOAT -> OutlinedTextField(
      value,
      onChange,
      label = { Text(label) },
      isError = error != null,
      supportingText = hint?.let { { Text(it) } },
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = if (field.type == DatasetFieldType.FLOAT) KeyboardType.Decimal else KeyboardType.Number),
      modifier = modifier,
    )
    field.type == DatasetFieldType.TIMESTAMP -> DateTimeField(
      label,
      value.removeSuffix("Z"),
      onChange,
      toMillis = ::parseUtcMinute,
      fromMillis = ::utcMinute,
      modifier = modifier,
      supporting = hint?.let { "$it · UTC" },
      isError = error != null,
    )
    field.type == DatasetFieldType.COORDINATES -> OutlinedTextField(value, onChange, label = { Text(label) }, isError = error != null, supportingText = { Text(hint ?: "lat, lon") }, singleLine = true, modifier = modifier)
    field.type == DatasetFieldType.SORTED -> OutlinedTextField(value, onChange, label = { Text(label) }, isError = error != null, supportingText = { Text(hint ?: "Comma-separated list") }, modifier = modifier)
    field.type == DatasetFieldType.MAP -> OutlinedTextField(value, onChange, label = { Text(label) }, isError = error != null, supportingText = { Text(hint ?: "JSON, e.g. {\"key\": \"value\"}") }, minLines = 2, modifier = modifier)
    else -> OutlinedTextField(value, onChange, label = { Text(label) }, isError = error != null, supportingText = hint?.let { { Text(it) } }, modifier = modifier)
  }
}
