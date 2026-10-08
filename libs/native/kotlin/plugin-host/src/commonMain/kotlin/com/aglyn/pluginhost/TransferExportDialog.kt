package com.aglyn.pluginhost

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.unit.dp
import com.aglyn.core.TransferApi
import com.aglyn.core.TransferFields
import com.aglyn.core.TransferFormat
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.LocalFileExporter
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.space

/**
 * The export dialog every list uses, as the console's export dialog works:
 * the resource's fields to pick (all of them to start), the format, then the
 * file handed to the device ([LocalFileExporter]: the share sheet, or Save).
 * [scope] says which records (`{kind: 'all'}` or `{kind: 'filter', filter}`).
 */
@Composable
fun TransferExportDialog(
  context: NativePluginContext,
  resource: String,
  title: String,
  hostId: String?,
  scope: Map<String, Any?>,
  fileStem: String,
  filter: Map<String, Any?>? = null,
  onDone: (String?) -> Unit,
) {
  val coroutines = rememberCoroutineScope()
  val runner = remember { ActionRunner(coroutines) }
  val exporter = LocalFileExporter.current
  val transfer = remember(context.api, context.orgId) { TransferApi(context.api, context.orgId) }
  var fields by remember { mutableStateOf<TransferFields?>(null) }
  var picked by remember { mutableStateOf(emptySet<String>()) }
  var format by remember { mutableStateOf(TransferFormat.CSV) }
  LaunchedEffect(resource, hostId) {
    runner.run {
      val loaded = transfer.fields(resource, hostId, filter)
      fields = loaded
      picked = loaded.fields.map { it.id }.toSet()
    }
  }
  ActionDialog(
    title = title,
    body = if (exporter == null) "Exporting is not available on this device." else "Pick the columns, then where the file goes.",
    icon = "download",
    confirmLabel = "Export",
    confirmEnabled = exporter != null && fields != null && picked.isNotEmpty(),
    busy = runner.busy,
    error = runner.error,
    onDismiss = { onDone(null) },
    onConfirm = {
      val loaded = fields ?: return@ActionDialog
      runner.run {
        val file = transfer.export(resource, hostId, loaded.fields.map { it.id }.filter { it in picked }, scope, format)
        val name = file.name ?: "$fileStem.${format.wire}"
        val rows = file.headers["X-Aglyn-Export-Rows"]
        if (exporter?.export(name, file.contentType, file.bytes) == true) {
          onDone(rows?.let { "Exported $it rows." } ?: "Exported.")
        }
      }
    },
    modifier = Modifier.testTag("export-dialog"),
  ) {
    ChoiceChipRow(TransferFormat.entries.map { ChipOption(it.name, it.label) }, format.name, { format = TransferFormat.valueOf(it) }, wrap = true)
    val loaded = fields
    if (loaded == null) {
      SkeletonList(rows = 3)
    } else {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Text("${picked.size} of ${loaded.fields.size} columns", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
        TextButton(onClick = { picked = loaded.fields.map { it.id }.toSet() }) { Text("All") }
        TextButton(onClick = { picked = emptySet() }) { Text("None") }
      }
      val groupLabel = loaded.groups.associate { it.id to it.label }
      LazyColumn(Modifier.fillMaxWidth().heightIn(max = 320.dp)) {
        items(loaded.fields, key = { it.id }) { field ->
          Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(field.id in picked, { on -> picked = if (on) picked + field.id else picked - field.id }, Modifier.testTag("export-field-${field.id}"))
            Text(
              listOfNotNull(field.label, field.group?.let { groupLabel[it] }?.takeIf { it != field.label }).joinToString(" · "),
              style = MaterialTheme.typography.bodyMedium,
            )
          }
        }
      }
    }
  }
}
