package com.aglyn.plugins.data

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.DatasetFieldDefinition
import com.aglyn.contracts.DatasetFieldType
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.OrgAccess
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.ORG_WRITER_ROLES
import com.aglyn.pluginhost.TransferExportDialog
import com.aglyn.pluginhost.describeScope
import com.aglyn.pluginhost.listScopeTokens
import com.aglyn.pluginhost.rememberOrgAccess
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChoiceField
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.InputChoice
import com.aglyn.ui.ListHeader
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatTile
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

const val DATA_DATASETS_SCREEN = "data.datasets"
const val DATA_RECORDS_SCREEN = "data.records"
const val DATA_SCHEMA_SCREEN = "data.schema"

/** The transfer resource a dataset's records export as (`datasetTransferResourceKey`). */
fun datasetTransferResource(datasetId: String) = "data.dataset:$datasetId"

/** A field's type as the Schema dialog names it. */
fun typeLabel(field: DatasetFieldDefinition): String =
  field.type?.let { Contracts.datasetFieldTypeLabels[it.raw] ?: it.raw } ?: "Text"

private sealed interface DatasetDialog {
  data object Create : DatasetDialog
  data object Join : DatasetDialog
  data class Delete(val dataset: DatasetRow, val records: Long?) : DatasetDialog
  data class Export(val dataset: DatasetRow) : DatasetDialog
}

/** The datasets a member can see, live, sorted by name; null while the member row or the list loads. */
@Composable
internal fun rememberDatasets(context: NativePluginContext, orgId: String): Pair<Live<OrgAccess>, Live<List<DatasetRow>>> {
  val access = rememberOrgAccess(context, orgId)
  val tokens = (access as? Live.Ready)?.value?.listScopeTokens()
  val ready = access is Live.Ready && (tokens == null || tokens.isNotEmpty())
  val live by remember(orgId, ready, tokens, context.firestore) {
    if (ready) context.firestore.observe(datasetsQuery(orgId, tokens)) else kotlinx.coroutines.flow.flowOf(Live.Loading)
  }.collectAsState(Live.Loading)
  val rows: Live<List<DatasetRow>> = when (val value = live) {
    Live.Loading -> if (access is Live.Ready && !ready) Live.Ready(emptyList()) else Live.Loading
    is Live.Failed -> value
    is Live.Ready -> Live.Ready(value.value.map(DatasetRow::from).sortedBy { it.name.lowercase() })
  }
  return access to rows
}

/**
 * The workspace's datasets, the picked one beside the list on wide windows:
 * who a new one is shared with, create (and a join collection between two),
 * and each dataset's records count, fields, sharing and what references it,
 * with its records, schema, export and delete.
 */
@Composable
fun DatasetsScreen(context: NativePluginContext, initialDatasetId: String? = null) {
  val orgId = context.orgId ?: return EmptyState("Pick a workspace to see its data", icon = AglynIcons.named("dataset"))
  val scope = rememberCoroutineScope()
  val api = remember(orgId, context.api, context.writer) { DataApi(context.api, context.writer, orgId) }
  val runner = remember(orgId) { ActionRunner(scope, roleHint = "an owner, admin or editor") }
  var dialog by remember { mutableStateOf<DatasetDialog?>(null) }
  val canWrite = context.orgRole in ORG_WRITER_ROLES
  val (access, datasets) = rememberDatasets(context, orgId)

  AglynListDetail(
    initialSelected = initialDatasetId,
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        ListHeader("Datasets") {
          Button(onClick = { dialog = DatasetDialog.Create }, enabled = canWrite, modifier = Modifier.testTag("add-dataset")) {
            Icon(AglynIcons.named("add"), contentDescription = null)
            Text("New dataset", Modifier.padding(start = space(1f)))
          }
        }
        Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          if (dialog == null) {
            runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
            runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
          }
          // The org Data page's note: a dataset made here names no site, so it starts on All sites.
          NoticeBanner(newDatasetSharingNote(siteOnly = false), StatusTone.NEUTRAL)
        }
        when (val live = datasets) {
          Live.Loading -> SkeletonList(rows = 5, modifier = Modifier.padding(space(2f)))
          is Live.Failed -> EmptyState("Could not load datasets", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
          is Live.Ready -> if (live.value.isEmpty()) {
            val scoped = (access as? Live.Ready)?.value?.let { !it.orgWide && it.tokens.isEmpty() } == true
            EmptyState(
              if (scoped) "No datasets are shared with you" else "No datasets yet",
              body = if (scoped) "Ask an owner or admin to share a dataset with one of your sites." else "Create a dataset (e.g. Products) and repeat a component over its records with {{item.field}} bindings.",
              icon = AglynIcons.named("dataset"),
            )
          } else {
            LazyColumn(Modifier.fillMaxSize().testTag("datasets-list")) {
              items(live.value, key = { it.id }) { row ->
                AglynListItem(
                  title = row.name,
                  supporting = listOf(
                    row.model.order.orEmpty().size.let { if (it == 1) "1 field" else "$it fields" },
                    describeScope(row.visibleTo),
                  ).joinToString(" · "),
                  icon = AglynIcons.named("dataset"),
                  selected = row.id == selected,
                  onClick = { onSelect(row.id) },
                  modifier = Modifier.testTag("dataset-${row.id}"),
                )
              }
              if (live.value.size >= 2) {
                item {
                  TextButton(onClick = { dialog = DatasetDialog.Join }, enabled = canWrite, modifier = Modifier.padding(horizontal = space(1f)).testTag("add-join")) {
                    Text("Add join collection")
                  }
                }
              }
            }
          }
        }
      }
    },
    detail = { selected ->
      val rows = (datasets as? Live.Ready)?.value
      val dataset = rows?.firstOrNull { it.id == selected }
      when {
        selected == null -> EmptyState("Pick a dataset to see it here", icon = AglynIcons.named("dataset"))
        rows == null -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
        dataset == null -> EmptyState("This dataset is gone", body = "It was deleted, or it is no longer shared with you.", icon = AglynIcons.named("dataset"))
        else -> DatasetDetail(context, orgId, dataset, rows, canWrite) { dialog = it }
      }
    },
  )

  DatasetDialogs(context, orgId, dialog, (datasets as? Live.Ready)?.value.orEmpty(), api, runner) { dialog = null }
}

@Composable
private fun DatasetDetail(
  context: NativePluginContext,
  orgId: String,
  dataset: DatasetRow,
  all: List<DatasetRow>,
  canWrite: Boolean,
  open: (DatasetDialog) -> Unit,
) {
  var records by remember(dataset.id) { mutableStateOf<Long?>(null) }
  LaunchedEffect(dataset.id, dataset.updatedAt) {
    records = runCatching { context.firestore.count(FirestoreQuery(recordsPath(orgId, dataset.id))) }.getOrNull()
  }
  val now = remember(dataset.updatedAt) { nowMillis() }
  val referencedBy = dataset.referencedBy(all.filter { it.id != dataset.id })
  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("dataset-detail"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    SectionCard(null) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text(dataset.name, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
          if (dataset.singular.isNotBlank()) {
            Text("One record is a ${dataset.singular}", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
          }
        }
        OverflowMenu(
          listOf(
            MenuAction("schema", "Edit schema", "table_chart", enabled = canWrite) { context.navigate(DATA_SCHEMA_SCREEN, mapOf("dataset" to dataset.id)) },
            MenuAction("export", "Export records", "download", enabled = (records ?: 1L) > 0) { open(DatasetDialog.Export(dataset)) },
            MenuAction("delete", "Delete dataset", "delete", destructive = true, enabled = canWrite) { open(DatasetDialog.Delete(dataset, records)) },
          ),
        )
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        StatusChip("Shared with ${describeScope(dataset.visibleTo)}", if (dataset.visibleTo == null) StatusTone.WARNING else StatusTone.INFO)
        if (referencedBy.isNotEmpty()) StatusChip(if (referencedBy.size == 1) "Referenced by 1 field" else "Referenced by ${referencedBy.size} fields")
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        Button(onClick = { context.navigate(DATA_RECORDS_SCREEN, mapOf("dataset" to dataset.id)) }, modifier = Modifier.testTag("dataset-records")) {
          Icon(AglynIcons.named("table_chart"), contentDescription = null)
          Text("Records", Modifier.padding(start = space(1f)))
        }
        OutlinedButton(
          onClick = { context.navigate(DATA_RECORDS_SCREEN, mapOf("dataset" to dataset.id, "new" to "1")) },
          enabled = canWrite,
          modifier = Modifier.testTag("dataset-add-record"),
        ) {
          Icon(AglynIcons.named("add"), contentDescription = null)
          Text("Add record", Modifier.padding(start = space(1f)))
        }
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      StatTile("Records", records?.toString() ?: "—", Modifier.weight(1f), "In the whole dataset")
      StatTile("Fields", dataset.model.order.orEmpty().size.toString(), Modifier.weight(1f), dataset.updatedAt?.let { "Changed " + relativeTime(it.epochMillis, now) })
    }
    SectionCard("Fields", action = { if (canWrite) TextButton(onClick = { context.navigate(DATA_SCHEMA_SCREEN, mapOf("dataset" to dataset.id)) }) { Text("Edit") } }) {
      val fields = dataset.model.orderedFields()
      if (fields.isEmpty()) Text("This dataset has no fields yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      fields.forEachIndexed { index, (id, field) ->
        if (index > 0) HorizontalDivider()
        AglynListItem(
          title = field.label(id),
          supporting = fieldSummary(id, field, all),
          icon = AglynIcons.named(fieldIcon(field)),
          trailing = { if (field.required == true) StatusChip("Required", StatusTone.INFO) },
        )
      }
    }
    if (referencedBy.isNotEmpty()) {
      SectionCard("Referenced by") {
        referencedBy.forEach { (other, fieldId) ->
          AglynListItem(
            title = other.name,
            supporting = "Its ${other.model.fields?.get(fieldId)?.label(fieldId) ?: fieldId} field points here",
            icon = AglynIcons.named("link"),
            onClick = { context.navigate(DATA_DATASETS_SCREEN, mapOf("dataset" to other.id)) },
          )
        }
      }
    }
    SectionCard("Details") {
      DetailRow("Dataset id", dataset.id)
      DetailRow("Plural name", dataset.plural.ifBlank { null })
      DetailRow("Singular name", dataset.singular.ifBlank { null })
    }
  }
}

/** A field's line in the Fields card: its type and what constrains it. */
internal fun fieldSummary(id: String, field: DatasetFieldDefinition, all: List<DatasetRow>): String = buildList {
  add(if (field.customType != null) "${typeLabel(field)} (${field.customType})" else typeLabel(field))
  add("id $id")
  field.validation?.options?.takeIf { it.isNotEmpty() }?.let { add("one of " + it.joinToString(", ")) }
  field.reference?.let { reference ->
    val target = all.firstOrNull { it.id == reference.datasetId }?.name ?: reference.datasetId
    add((if (reference.multiple == true) "many in " else "one in ") + target)
  }
  field.description?.takeIf { it.isNotBlank() }?.let { add(it) }
}.joinToString(" · ")

internal fun fieldIcon(field: DatasetFieldDefinition): String = when (field.type) {
  DatasetFieldType.BOOL -> "check_circle"
  DatasetFieldType.INT32, DatasetFieldType.INT64, DatasetFieldType.FLOAT -> "percent"
  DatasetFieldType.TIMESTAMP -> "event"
  DatasetFieldType.COORDINATES -> "location_on"
  DatasetFieldType.SORTED -> "label"
  DatasetFieldType.REFERENCE -> "link"
  DatasetFieldType.MAP -> "data_object"
  else -> "title"
}

@Composable
private fun DatasetDialogs(
  context: NativePluginContext,
  orgId: String,
  dialog: DatasetDialog?,
  datasets: List<DatasetRow>,
  api: DataApi,
  runner: ActionRunner,
  close: () -> Unit,
) {
  when (dialog) {
    null -> Unit
    DatasetDialog.Create -> {
      var name by remember { mutableStateOf("") }
      var columns by remember { mutableStateOf("") }
      val entries = remember(columns) { parseDatasetFieldEntries(columns) }
      ActionDialog(
        title = "New dataset",
        body = newDatasetSharingNote(siteOnly = false),
        icon = "dataset",
        confirmLabel = "Create",
        confirmEnabled = name.isNotBlank() && entries.isNotEmpty(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = {
          runner.run("Dataset \"${name.trim()}\" created.", onDone = close) {
            val id = api.createDataset(name, columns, hostId = null)
            context.navigate(DATA_DATASETS_SCREEN, mapOf("dataset" to id))
          }
        },
      ) {
        OutlinedTextField(name, { name = it.take(80) }, label = { Text("Name") }, supportingText = { Text("e.g. Products, Team, FAQ") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("dataset-name"))
        OutlinedTextField(
          columns,
          { columns = it },
          label = { Text("Fields") },
          supportingText = {
            Text(if (entries.isEmpty()) "Comma-separated column names, e.g. Title, Unit price" else "Columns: " + entries.joinToString(", ") { it.name })
          },
          modifier = Modifier.fillMaxWidth().testTag("dataset-fields"),
        )
      }
    }
    DatasetDialog.Join -> {
      var a by remember { mutableStateOf("") }
      var b by remember { mutableStateOf("") }
      val choices = datasets.map { InputChoice(it.id, it.name) }
      ActionDialog(
        title = "New join collection",
        body = "Links two collections many-to-many; each row pairs one document from each side.",
        icon = "link",
        confirmLabel = "Create",
        confirmEnabled = a.isNotEmpty() && b.isNotEmpty() && a != b,
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = {
          val first = datasets.firstOrNull { it.id == a } ?: return@ActionDialog
          val second = datasets.firstOrNull { it.id == b } ?: return@ActionDialog
          runner.run("Join collection created.", onDone = close) {
            val id = api.createJoin(first, second, hostId = null)
            context.navigate(DATA_DATASETS_SCREEN, mapOf("dataset" to id))
          }
        },
      ) {
        ChoiceField("First collection", a, choices, { a = it }, allowEmpty = false)
        ChoiceField("Second collection", b, choices, { b = it }, allowEmpty = false)
      }
    }
    is DatasetDialog.Delete -> ActionDialog(
      title = "Delete this collection?",
      body = "\"${dialog.dataset.name}\"" +
        (dialog.records?.takeIf { it > 0 }?.let { " and its $it document${if (it == 1L) "" else "s"}" } ?: "") +
        " stop resolving in repeatable components and bindings that reference it.",
      icon = "delete",
      confirmLabel = "Delete",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = close,
      onConfirm = {
        runner.run("Dataset deleted.", onDone = close) {
          // The org Data page's delete: it names no site, so it is the workspace-wide one.
          api.deleteDataset(dialog.dataset.id, hostId = null)
        }
      },
    )
    is DatasetDialog.Export -> TransferExportDialog(
      context,
      resource = datasetTransferResource(dialog.dataset.id),
      title = "Export ${dialog.dataset.name}",
      hostId = null,
      scope = mapOf("kind" to "all"),
      fileStem = dialog.dataset.name.ifBlank { dialog.dataset.id },
    ) { message ->
      close()
      if (message != null) runner.notice = message
    }
  }
}
