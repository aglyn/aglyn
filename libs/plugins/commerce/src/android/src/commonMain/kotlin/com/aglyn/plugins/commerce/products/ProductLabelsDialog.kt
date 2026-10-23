package com.aglyn.plugins.commerce.products

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.hardware.PrintableDocument
import com.aglyn.hardware.SystemPrintResult
import com.aglyn.hardware.SystemPrinter
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.LocalFileExporter
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.launch

/**
 * Labels for one product (the console's Labels dialog): the label size, how many of each variant, then the print sheet
 * or a ZPL file for a Zebra.
 */
@Composable
fun ProductLabelsDialog(productName: String, initial: List<ProductLabelRow>, printer: SystemPrinter?, onDismiss: () -> Unit) {
  var rows by remember(initial) { mutableStateOf(initial) }
  var sizeId by remember { mutableStateOf(Contracts.labelSizes.firstOrNull()?.id) }
  var busy by remember { mutableStateOf(false) }
  var problem by remember { mutableStateOf<String?>(null) }
  var note by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val exporter = LocalFileExporter.current
  val labels = rows.map { it.label }
  val total = labelCopiesTotal(labels)
  ActionDialog(
    title = "Labels — $productName",
    confirmLabel = if (total == 1L) "Print 1 label" else "Print $total labels",
    onConfirm = {
      if (printer == null) {
        problem = "This device has no print sheet. Save ZPL to send the labels to a Zebra."
      } else {
        busy = true
        problem = null
        scope.launch {
          val result = printer.printDocument(PrintableDocument.Labels(labelSheet(labels, sizeId)), "Labels — $productName")
          busy = false
          if (result is SystemPrintResult.Failed) problem = result.message
        }
      }
    },
    onDismiss = onDismiss,
    icon = "barcode",
    busy = busy,
    error = problem,
    confirmEnabled = total > 0,
    dismissLabel = "Close",
    modifier = Modifier.testTag("labels-dialog"),
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      note?.let { NoticeBanner(it, StatusTone.SUCCESS) }
      SelectField(
        label = "Label size",
        options = Contracts.labelSizes.map { SelectOption(it.id, it.label) },
        selected = sizeId,
        onSelect = { sizeId = it },
        modifier = Modifier.fillMaxWidth().testTag("labels-size"),
      )
      rows.forEach { row ->
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(2f))) {
          Column(Modifier.weight(1f)) {
            Text(row.label.detail ?: row.label.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
              row.label.code.ifEmpty { "Add a barcode or SKU to print a label" },
              style = MaterialTheme.typography.bodySmall,
              color = if (row.label.code.isEmpty()) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
          }
          OutlinedTextField(
            value = if (row.label.code.isEmpty()) "0" else row.label.copies.toString(),
            onValueChange = { typed ->
              val copies = labelCopiesFromInput(typed)
              rows = rows.map { if (it.variantId == row.variantId) it.copy(label = it.label.copy(copies = copies)) else it }
            },
            label = { Text("Copies") },
            enabled = row.label.code.isNotEmpty(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.width(96.dp).testTag("labels-copies-${row.variantId}"),
          )
        }
      }
      Text(
        "Print to a label printer at 100% scale, or save ZPL to send straight to a Zebra.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      if (exporter != null) {
        OutlinedButton(
          onClick = {
            scope.launch {
              val zpl = productLabelsZpl(printableLabels(labels), sizeId)
              if (exporter.export(labelsZplFileName(productName), "text/plain", zpl.encodeToByteArray())) note = "ZPL saved."
            }
          },
          enabled = total > 0 && !busy,
          modifier = Modifier.testTag("labels-zpl"),
        ) { Text("Save ZPL") }
      }
    }
  }
}
