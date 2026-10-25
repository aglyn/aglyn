package com.aglyn.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.core.TransferEncoding
import com.aglyn.core.TransferFileReader
import com.aglyn.core.TransferFormat
import com.aglyn.core.TransferParsedFile
import com.aglyn.core.TransferUploadDraft
import com.aglyn.core.TransferUploadLimits
import com.aglyn.core.transferDelimiters
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.LocalMediaPicker
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.PickSource
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * What the import takes, from an `upload` field's `maxBytes`, `maxRows` and `formats` templates over the loaded resource: the
 * resource's own limits, else the console's ceiling and a CSV.
 */
internal fun FieldSpec.uploadLimits(context: JsonElement): TransferUploadLimits {
  fun resolved(key: String): JsonElement? = config.str(key)?.let { ScreenValues.resolve(it, context) }
  val maxBytes = (resolved("maxBytes") as? JsonPrimitive)?.doubleOrNull?.toInt() ?: TransferUploadLimits.DEFAULT_MAX_BYTES
  val maxRows = (resolved("maxRows") as? JsonPrimitive)?.doubleOrNull?.toInt()
  val formats = (resolved("formats") as? JsonArray)?.mapNotNull { item -> TransferFormat.entries.firstOrNull { it.wire == (item as? JsonPrimitive)?.content } }
  return TransferUploadLimits(maxBytes, maxRows, formats ?: listOf(TransferFormat.CSV))
}

/**
 * The import's Upload step as one field (`kind: "upload"`), as the console's step reads a file: a chosen file or pasted rows,
 * read here to show how they read, the format, encoding, separator and header row guessed and changeable, the first rows as
 * a preview, and the file refused before anything is sent when it is larger, or longer, than the import takes. Its value
 * ([held], JSON text) is what the upload sends, empty until nothing blocks it.
 */
@Composable
internal fun UploadFieldInput(field: FieldSpec, context: JsonElement, held: String, onValue: (String) -> Unit) {
  val limits = remember(field, context) { field.uploadLimits(context) }
  var draft by remember { mutableStateOf<TransferUploadDraft?>(null) }
  var paste by remember { mutableStateOf("") }
  var reading by remember { mutableStateOf(false) }
  var readError by remember { mutableStateOf<String?>(null) }
  val picker = LocalMediaPicker.current
  val scope = rememberCoroutineScope()

  fun publish(next: TransferUploadDraft) = onValue(next.value(limits)?.toString().orEmpty())

  // Reads off the main thread (a file may be megabytes), then shows it and publishes what the upload would send.
  fun adopt(make: () -> TransferUploadDraft) {
    reading = true
    scope.launch {
      val next = withContext(Dispatchers.Default) { make() }
      draft = next
      reading = false
      publish(next)
    }
  }

  // A form that is read again (after a save) starts its fields over; what was chosen stays chosen.
  LaunchedEffect(held) { if (held.isEmpty()) draft?.let(::publish) }

  Column(Modifier.fillMaxWidth().testTag("upload-field"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text(field.label, style = MaterialTheme.typography.titleSmall)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedButton(
        enabled = picker != null,
        onClick = {
          scope.launch {
            readError = null
            picker?.pick(PickSource.FILES, multiple = false)?.firstOrNull()?.let { file -> adopt { TransferUploadDraft.file(file.name, file.bytes, limits.maxBytes) } }
          }
        },
        modifier = Modifier.testTag("upload-choose"),
      ) { Text(if (draft == null || draft?.fileName == TransferUploadDraft.PASTED_NAME) "Choose a file" else "Choose a different file") }
      Text(
        "At most ${TransferFileReader.formatBytes(limits.maxBytes)}${limits.maxRows?.let { " and $it rows" } ?: ""}.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
    OutlinedTextField(paste, { paste = it }, Modifier.fillMaxWidth().testTag("upload-paste"), label = { Text("Or paste rows") }, minLines = 3, maxLines = 8)
    TextButton(onClick = { adopt { TransferUploadDraft.pasted(paste) } }, enabled = paste.isNotBlank(), modifier = Modifier.testTag("upload-read")) { Text("Read pasted rows") }
    if (reading) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
    readError?.let { NoticeBanner(it, StatusTone.ERROR) }
    draft?.let { current -> UploadDetails(current, limits) { transform -> adopt { transform(current) } } }
  }
}

@Composable
private fun UploadDetails(draft: TransferUploadDraft, limits: TransferUploadLimits, change: ((TransferUploadDraft) -> TransferUploadDraft) -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text(draft.summary, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("upload-summary"))
    if (!draft.unread) {
      Text("Format", style = MaterialTheme.typography.labelMedium)
      ChoiceChipRow(
        TransferFormat.entries.map { ChipOption(it.name, TransferUploadDraft.formatName(it) + if (it in limits.formats) "" else " (not taken here)") },
        draft.settings.format.name,
        { name -> change { it.changing(TransferFormat.valueOf(name)) } },
        wrap = true,
      )
      if (draft.raw != null) {
        Text("Encoding", style = MaterialTheme.typography.labelMedium)
        ChoiceChipRow(
          TransferEncoding.entries.map { ChipOption(it.name, it.label) },
          draft.settings.encoding.name,
          { name -> change { it.changing(TransferEncoding.valueOf(name)) } },
          wrap = true,
        )
      }
      if (draft.settings.format == TransferFormat.CSV) {
        Text("Separator", style = MaterialTheme.typography.labelMedium)
        ChoiceChipRow(transferDelimiters.map { ChipOption(it.first, it.second) }, draft.settings.delimiter, { value -> change { it.changing(value) } }, wrap = true)
        SwitchRow("The first row names the columns", draft.settings.headerRow, { on -> change { it.changingHeaderRow(on) } })
      }
      draft.parsed?.takeIf { it.error == null && it.headers.isNotEmpty() }?.let { UploadPreview(it) }
    }
    for (blocker in draft.blockers(limits)) NoticeBanner(blocker, StatusTone.WARNING)
  }
}

/** The first rows as the file reads, a cell as one line. */
@Composable
private fun UploadPreview(parsed: TransferParsedFile) {
  Column(Modifier.horizontalScroll(rememberScrollState()).testTag("upload-preview"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    Row(horizontalArrangement = Arrangement.spacedBy(space(2f))) {
      for (header in parsed.headers) Text(header, Modifier.width(140.dp), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    for (row in parsed.shown) {
      Row(horizontalArrangement = Arrangement.spacedBy(space(2f))) {
        for (cell in row) Text(cell, Modifier.width(140.dp), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
    }
  }
}
