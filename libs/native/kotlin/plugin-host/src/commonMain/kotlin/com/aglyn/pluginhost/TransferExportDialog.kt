package com.aglyn.pluginhost

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.TransferApi
import com.aglyn.core.TransferExportChoice
import com.aglyn.core.TransferFieldCatalog
import com.aglyn.core.TransferFields
import com.aglyn.core.TransferFormat
import com.aglyn.core.TransferSavedPreset
import com.aglyn.core.json
import com.aglyn.core.jsonValue
import com.aglyn.core.moveTransferField
import com.aglyn.core.nowMillis
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.LocalFileExporter
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.space

/** `n thing` or `n things`, as the console's `countOf`. */
private fun count(n: Int, noun: String) = "$n ${if (n == 1) noun else noun + "s"}"

/**
 * The export dialog every list uses, as the console's export dialog works: a preset (Everything, Re-importable, Minimal, the
 * resource's own, the ones the person saved, or a hand-picked list), the fields to pick and put in order, which records, the
 * format and a byte-order mark for a CSV, then the file handed to the device ([LocalFileExporter]: the share sheet, or Save).
 * The choice is remembered for the next export of the resource. [scope] says which records the list stands for
 * (`{kind: 'all'}` or `{kind: 'filter', filter}`); [selection] the records the person selected, when there are some.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransferExportDialog(
  context: NativePluginContext,
  resource: String,
  title: String,
  hostId: String?,
  scope: Map<String, Any?>,
  fileStem: String,
  filter: Map<String, Any?>? = null,
  selection: List<String> = emptyList(),
  filterLabel: String? = null,
  preset: String? = null,
  onDone: (String?) -> Unit,
) {
  val coroutines = rememberCoroutineScope()
  val runner = remember { ActionRunner(coroutines) }
  val exporter = LocalFileExporter.current
  val transfer = remember(context.api, context.orgId) { TransferApi(context.api, context.orgId) }
  var info by remember { mutableStateOf<TransferFields?>(null) }
  var catalog by remember { mutableStateOf<TransferFieldCatalog?>(null) }
  var choice by remember { mutableStateOf<TransferExportChoice?>(null) }
  var saved by remember { mutableStateOf(emptyList<TransferSavedPreset>()) }
  var presetName by remember { mutableStateOf("") }
  var query by remember { mutableStateOf("") }
  val prefsPath = "users/${context.uid}/transferPrefs/$resource"
  val hasFilter = scope["kind"] == "filter"
  LaunchedEffect(resource, hostId) {
    runner.run {
      val loaded = transfer.fields(resource, hostId, filter)
      val built = TransferFieldCatalog(loaded.fields, loaded.groups)
      info = loaded
      catalog = built
      saved = loaded.savedPresets
      choice = TransferExportChoice.opening(loaded, built, selection.size, hasFilter, preset)
    }
  }
  val current = choice
  ActionDialog(
    title = title,
    body = if (exporter == null) "Exporting is not available on this device." else null,
    icon = "download",
    confirmLabel = "Export ${count(current?.fieldIds?.size ?: 0, "field")}",
    confirmEnabled = exporter != null && current != null && current.fieldIds.isNotEmpty(),
    busy = runner.busy,
    error = runner.error,
    dismissLabel = "Cancel",
    onDismiss = { onDone(null) },
    onConfirm = {
      val chosen = choice ?: return@ActionDialog
      val loaded = info ?: return@ActionDialog
      runner.run {
        val records: Map<String, Any?> = when (chosen.scope) {
          "selection" -> mapOf("kind" to "selection", "ids" to selection)
          "filter" -> scope
          else -> mapOf("kind" to "all")
        }
        val file = transfer.export(resource, hostId, chosen.fieldIds, records, chosen.format, chosen.bom, chosen.headers(loaded))
        val name = file.name ?: "$fileStem.${chosen.format.wire}"
        val rows = file.headers["X-Aglyn-Export-Rows"]
        if (exporter?.export(name, file.contentType, file.bytes) == true) {
          // The choice is remembered for next time; a refusal to remember it never spoils the file.
          runCatching { context.writer.merge(prefsPath, mapOf("export" to jsonValue(chosen.prefs.json()))) }
          onDone(rows?.let { "Exported $it rows." } ?: "Exported.")
        }
      }
    },
    modifier = Modifier.testTag("export-dialog"),
  ) {
    val loaded = info
    val built = catalog
    if (loaded == null || built == null || current == null) {
      SkeletonList(rows = 3)
      return@ActionDialog
    }
    Column(Modifier.fillMaxWidth().heightIn(max = 460.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      // Preset.
      val options = TransferExportChoice.presetOptions(loaded, saved)
      var presetOpen by remember { mutableStateOf(false) }
      ExposedDropdownMenuBox(expanded = presetOpen, onExpandedChange = { presetOpen = it }) {
        OutlinedTextField(
          value = options.firstOrNull { it.id == current.presetId }?.label ?: "Hand-picked",
          onValueChange = {},
          readOnly = true,
          label = { Text("Preset") },
          supportingText = { Text(options.firstOrNull { it.id == current.presetId }?.description.orEmpty()) },
          trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(presetOpen) },
          modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).testTag("export-preset"),
        )
        ExposedDropdownMenu(expanded = presetOpen, onDismissRequest = { presetOpen = false }) {
          for (option in options) {
            DropdownMenuItem(
              text = { Text(option.label) },
              onClick = { choice = current.choose(option.id, built, loaded, saved); presetOpen = false },
            )
          }
        }
      }
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(
          presetName, { presetName = it }, Modifier.weight(1f).testTag("export-preset-name"),
          label = { Text("Save these fields as") }, singleLine = true,
        )
        TextButton(
          enabled = !runner.busy && current.saving(presetName, "x") != null,
          onClick = {
            val preset = current.saving(presetName, "preset-${nowMillis().toString(36)}") ?: return@TextButton
            runner.run {
              val all = (saved + preset).take(50)
              context.writer.merge(prefsPath, mapOf("presets" to all.map { jsonValue(it.json()) }))
              saved = all
              choice = current.copy(presetId = preset.id)
              presetName = ""
            }
          },
          modifier = Modifier.testTag("export-preset-save"),
        ) { Text("Save preset") }
      }
      if (current.unknown.isNotEmpty()) {
        NoticeBanner(
          "${count(current.unknown.size, "field")} in this choice no longer ${if (current.unknown.size == 1) "exists and is" else "exist and are"} left out: ${current.unknown.joinToString(", ")}.",
          StatusTone.INFO,
        )
      }
      // Fields: searchable, grouped, with the kind of each.
      OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().testTag("export-search"), label = { Text("Search fields") }, singleLine = true)
      val matching = built.search(query).map { it.id }
      val chosen = current.fieldIds.toSet()
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        TextButton({ choice = current.pick(current.fieldIds + matching.filter { it !in chosen }) }) { Text(if (query.isEmpty()) "Select all" else "Select shown") }
        TextButton({ val shown = matching.toSet(); choice = current.pick(current.fieldIds.filter { it !in shown }) }) { Text(if (query.isEmpty()) "Select none" else "Clear shown") }
      }
      val groups = built.grouped(matching)
      if (groups.isEmpty()) Text("No field matches “$query”.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      for ((group, fields) in groups) {
        Text(group.label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        for (field in fields) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(
              field.id in chosen,
              { on -> choice = current.pick(if (on) current.fieldIds + field.id else current.fieldIds.filter { it != field.id }) },
              Modifier.testTag("export-field-${field.id}"),
            )
            Text(listOfNotNull(field.label, field.kind).joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
          }
        }
      }
      // The order of the columns.
      Text("Columns in the file (${current.fieldIds.size})", style = MaterialTheme.typography.titleSmall)
      if (current.fieldIds.isEmpty()) Text("Choose at least one field.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      current.fieldIds.forEachIndexed { index, id ->
        val name = built.field(id)?.label ?: id
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text("${index + 1}. $name", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
          WithTooltip("Move $name up") { IconButton(
            { choice = current.pick(moveTransferField(current.fieldIds, index, index - 1)) },
            Modifier.semantics { contentDescription = "Move $name up" }.testTag("export-up-$id"),
            enabled = index > 0,
          ) { Icon(AglynIcons.named("arrow_upward"), contentDescription = null) } }
          WithTooltip("Move $name down") { IconButton(
            { choice = current.pick(moveTransferField(current.fieldIds, index, index + 1)) },
            Modifier.semantics { contentDescription = "Move $name down" }.testTag("export-down-$id"),
            enabled = index < current.fieldIds.size - 1,
          ) { Icon(AglynIcons.named("arrow_downward"), contentDescription = null) } }
        }
      }
      // Which records.
      val label = loaded.resourceLabel?.lowercase() ?: "records"
      val offered = buildList {
        if (selection.isNotEmpty()) add("selection" to "The ${count(selection.size, "selected record")}")
        if (hasFilter) add("filter" to ("The current filter" + (filterLabel?.let { ": $it" } ?: "")))
        add("all" to "All $label")
      }
      if (offered.size > 1) {
        Text("Records", style = MaterialTheme.typography.titleSmall)
        for ((kind, words) in offered) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            RadioButton(current.scope == kind, { choice = current.copy(scope = kind) }, Modifier.testTag("export-scope-$kind"))
            Text(words, style = MaterialTheme.typography.bodyMedium)
          }
        }
      }
      // Format.
      Text("Format", style = MaterialTheme.typography.titleSmall)
      for (format in loaded.formats) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          RadioButton(current.format == format, { choice = current.copy(format = format) }, Modifier.testTag("export-format-${format.wire}"))
          Text(format.label, style = MaterialTheme.typography.bodyMedium)
        }
      }
      if (current.format == TransferFormat.CSV) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Checkbox(current.bom, { choice = current.copy(bom = it) }, Modifier.testTag("export-bom"))
          Text("Start with a byte-order mark (for Excel)", style = MaterialTheme.typography.bodyMedium)
        }
      }
    }
  }
}
