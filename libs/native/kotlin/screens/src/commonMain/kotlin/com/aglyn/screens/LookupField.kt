package com.aglyn.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonElement
import kotlin.coroutines.cancellation.CancellationException

/**
 * A `lookup` field: a button that opens a search over the kinds of record its groups name. Picking one fills the form's other
 * fields (the system email test's "Populate from").
 */
@Composable
internal fun LookupInput(
  field: FieldSpec,
  context: JsonElement,
  picked: String?,
  search: suspend (LookupGroup, String) -> List<JsonElement>,
  onPick: (LookupGroup, JsonElement) -> Unit,
) {
  var open by remember { mutableStateOf(false) }
  val label = ScreenValues.render(field.label, context)
  val help = field.help?.let { ScreenValues.render(it, context) }
  Column(Modifier.fillMaxWidth().testTag("field-${field.key}")) {
    OutlinedButton(onClick = { open = true }, modifier = Modifier.fillMaxWidth().testTag("lookup-${field.key}")) {
      Text("$label: ${picked ?: "Choose"}", maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    if (help != null) {
      Text(help, Modifier.padding(top = space(0.5f)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
  if (open) {
    LookupDialog(field, context, search, onPick = { group, row -> onPick(group, row); open = false }, onDismiss = { open = false })
  }
}

/** The search behind a `lookup` field: one section per kind of record, filled as words are typed. */
@Composable
private fun LookupDialog(
  field: FieldSpec,
  context: JsonElement,
  search: suspend (LookupGroup, String) -> List<JsonElement>,
  onPick: (LookupGroup, JsonElement) -> Unit,
  onDismiss: () -> Unit,
) {
  var words by remember { mutableStateOf("") }
  var found by remember { mutableStateOf<Map<String, List<JsonElement>>>(emptyMap()) }
  var failed by remember { mutableStateOf<List<String>>(emptyList()) }
  var loading by remember { mutableStateOf(true) }
  // A short wait after the last key, so a name typed quickly is one search and not one per letter.
  LaunchedEffect(words) {
    if (words.isNotEmpty()) delay(300)
    loading = true
    val next = mutableMapOf<String, List<JsonElement>>()
    val missed = mutableListOf<String>()
    for (group in field.groups) {
      try {
        next[group.id] = search(group, words)
      } catch (error: CancellationException) {
        throw error
      } catch (error: Throwable) {
        missed += group.label.lowercase()
      }
    }
    found = next
    failed = missed
    loading = false
  }
  AlertDialog(
    onDismissRequest = onDismiss,
    modifier = Modifier.testTag("lookup-dialog"),
    title = { Text(ScreenValues.render(field.label, context)) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(
          value = words,
          onValueChange = { words = it },
          placeholder = { Text("Search by name or email") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth().testTag("lookup-search"),
        )
        if (failed.isNotEmpty()) NoticeBanner("Could not search ${failed.joinToString(", ")}. Try again.", StatusTone.WARNING)
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 360.dp)) {
          for (group in field.groups) {
            val rows = found[group.id].orEmpty()
            item(key = "head-${group.id}") {
              Text(group.label, Modifier.padding(top = space(1f)), style = MaterialTheme.typography.titleSmall)
            }
            if (rows.isEmpty() && !loading) {
              item(key = "none-${group.id}") {
                Text(
                  if (words.isEmpty()) "Nothing yet." else "Nothing found.",
                  style = MaterialTheme.typography.bodyMedium,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
              }
            }
            items(rows.size, key = { "${group.id}-$it" }) { index ->
              val row = rows[index]
              Column(Modifier.fillMaxWidth().clickable { onPick(group, row) }.padding(vertical = space(1f)).testTag("lookup-${group.id}-$index")) {
                Text(group.heading(row, context), style = MaterialTheme.typography.bodyLarge)
                group.detail(row, context)?.let {
                  Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
              }
            }
          }
        }
      }
    },
    confirmButton = {},
    dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
  )
}
