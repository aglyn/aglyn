package com.aglyn.plugins.workflows

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.draftPlaceholderIn
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

/*
 * What every Automation screen shares: live reads, the plan, the notice a
 * finished edit leaves for the list it returns to, and the editor's frame.
 */

/** A live query, or loading while there is nothing to ask. */
@Composable
fun liveQuery(context: NativePluginContext, query: FirestoreQuery?): Live<List<FirestoreDoc>> {
  if (query == null) return Live.Loading
  val flow = remember(query, context.firestore) { context.firestore.observe(query) }
  val live by flow.collectAsState(Live.Loading)
  return live
}

@Composable
fun liveDoc(context: NativePluginContext, path: String?): Live<FirestoreDoc?> {
  if (path == null) return Live.Loading
  val flow = remember(path, context.firestore) { context.firestore.observeDoc(path) }
  val live by flow.collectAsState(Live.Loading)
  return live
}

fun Live<List<FirestoreDoc>>.docsOrEmpty(): List<FirestoreDoc> = (this as? Live.Ready)?.value ?: emptyList()

/** A notice that outlives the screen that set it: an editor that saved and went back leaves its word for the list. */
object AutomationNotice {
  var current by mutableStateOf<Pair<String, StatusTone>?>(null)

  fun post(message: String, tone: StatusTone = StatusTone.SUCCESS) {
    current = message to tone
  }
}

/** The posted notice, dismissible, where the screen draws its notices. */
@Composable
fun AutomationNoticeBanner(modifier: Modifier = Modifier) {
  AutomationNotice.current?.let { (message, tone) ->
    NoticeBanner(
      message,
      tone,
      modifier.testTag("automation-notice"),
      action = { TextButton(onClick = { AutomationNotice.current = null }) { Text("Dismiss") } },
    )
  }
}

/** The plan, as the entitlements route answers it; null until it has, or when it could not be asked. */
@Composable
fun rememberEntitlements(context: NativePluginContext, hostId: String?, orgId: String?): Entitlements? {
  var entitlements by remember(hostId, orgId) { mutableStateOf<Entitlements?>(null) }
  LaunchedEffect(hostId, orgId) {
    if (hostId == null && orgId == null) return@LaunchedEffect
    entitlements = runCatching { AutomationApi(context.api, context.writer).entitlements(hostId, orgId) }.getOrNull()
  }
  return entitlements
}

/** `312 workflow runs this month · 1,000 included`, once the counter and the plan have both answered. */
@Composable
fun RunQuotaLine(context: NativePluginContext, counter: RunCounter, orgId: String?, hostId: String?, entitlements: Entitlements?) {
  val path = runCounterPath(counter, orgId, hostId)
  val live = liveDoc(context, path)
  val ready = live as? Live.Ready ?: return
  if (entitlements == null) return
  val month = remember { utcMonthKey(nowMillis()) }
  val used = (ready.value?.data?.get(month) as? Number)?.toLong() ?: 0L
  Text(
    runQuotaLine(counter, used, entitlements.limit(counter.quota)),
    style = MaterialTheme.typography.bodySmall,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    modifier = Modifier.testTag("run-quota-${counter.key}"),
  )
}

/** The refusal an edit gets when its seed was never confirmed by the server. */
fun staleSeedMessage(subject: String): String =
  "We could not confirm your $subject with the server, so what is on screen may be out of date — saving now could overwrite newer values. Check your connection and reload."

/** A friendlier word for a rules refusal. */
fun failureMessage(error: Throwable): String {
  val message = error.message.orEmpty()
  return when {
    message.contains("PERMISSION_DENIED", ignoreCase = true) || message.contains("insufficient permissions", ignoreCase = true) ->
      "You do not have permission to do that."
    message.isBlank() -> "An error has occurred"
    else -> message
  }
}

/**
 * An editor's frame: its title, a scrolling column of fields held to a
 * readable width, and Cancel beside the save button at the foot.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EditorFrame(
  title: String,
  saveLabel: String,
  onSave: () -> Unit,
  onCancel: () -> Unit,
  modifier: Modifier = Modifier,
  saveEnabled: Boolean = true,
  busy: Boolean = false,
  error: String? = null,
  content: @Composable ColumnScope.() -> Unit,
) {
  Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 760.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(2f)),
      verticalArrangement = Arrangement.spacedBy(space(1.5f)),
    ) {
      Text(title, Modifier.semantics { heading() }, style = MaterialTheme.typography.titleLarge)
      content()
      error?.let { NoticeBanner(it, StatusTone.WARNING, Modifier.testTag("editor-error")) }
      FlowRow(
        Modifier.fillMaxWidth().padding(top = space(1f)),
        horizontalArrangement = Arrangement.spacedBy(space(1f), Alignment.End),
        verticalArrangement = Arrangement.spacedBy(space(1f)),
      ) {
        TextButton(onClick = onCancel, enabled = !busy, modifier = Modifier.testTag("editor-cancel")) { Text("Cancel") }
        Button(onClick = onSave, enabled = saveEnabled && !busy, modifier = Modifier.heightIn(min = 44.dp).testTag("editor-save")) {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
            Text(saveLabel)
          }
        }
      }
    }
  }
}

/** A small, muted heading inside an editor ("Steps", "Trigger"). */
@Composable
fun Overline(text: String, modifier: Modifier = Modifier) {
  Text(text.uppercase(), modifier.padding(top = space(1f)), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** A muted caption under a field or a step. */
@Composable
fun Caption(text: String, modifier: Modifier = Modifier, color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurfaceVariant) {
  Text(text, modifier, style = MaterialTheme.typography.bodySmall, color = color)
}

/** A text field as the console's: a label, a placeholder, helper text that turns into the error. */
@Composable
fun Field(
  label: String,
  value: String,
  onChange: (String) -> Unit,
  modifier: Modifier = Modifier,
  placeholder: String? = null,
  helper: String? = null,
  error: Boolean = false,
  multiline: Boolean = false,
  number: Boolean = false,
  readOnly: Boolean = false,
  enabled: Boolean = true,
  trailing: (@Composable () -> Unit)? = null,
) {
  OutlinedTextField(
    value = value,
    onValueChange = onChange,
    label = { Text(label) },
    placeholder = placeholder?.let { { Text(it) } },
    supportingText = helper?.let { { Text(it) } },
    isError = error,
    singleLine = !multiline,
    minLines = if (multiline) 2 else 1,
    maxLines = if (multiline) 6 else 1,
    readOnly = readOnly,
    enabled = enabled,
    trailingIcon = trailing,
    keyboardOptions = if (number) KeyboardOptions(keyboardType = KeyboardType.Number) else KeyboardOptions.Default,
    modifier = modifier.fillMaxWidth(),
  )
}

/** A field that holds a `[placeholder]` shows it as an error with what to do. */
fun placeholderHelp(value: Any?, help: String): String? = if (draftPlaceholderIn(value) != null) help else null

/** A picker over records: the stored id selects, a placeholder name with no id says what the draft asked for. */
@Composable
fun RecordPicker(
  label: String,
  options: List<PickOption>,
  selectedId: String?,
  onPick: (PickOption) -> Unit,
  modifier: Modifier = Modifier,
  placeholderName: Any? = null,
  noun: String = label.lowercase(),
  emptyLabel: String? = null,
) {
  val words = if (selectedId.isNullOrBlank()) draftPlaceholderIn(placeholderName) else null
  val items = if (options.isEmpty() && emptyLabel != null) listOf(SelectOption("", emptyLabel, enabled = false)) else options.map { SelectOption(it.id, it.name) }
  SelectField(
    label = label,
    options = items,
    selected = selectedId,
    onSelect = { id -> options.firstOrNull { it.id == id }?.let(onPick) },
    supporting = words?.let { "Pick the $noun — the draft asked for “$it”" },
    isError = words != null,
    modifier = modifier.fillMaxWidth().testTag("picker-${label.lowercase().replace(' ', '-')}"),
  )
}

/** A list row's trailing remove button. */
@Composable
fun RemoveButton(description: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
  IconButton(onClick = onClick, modifier = modifier) { Icon(AglynIcons.named("close"), contentDescription = description) }
}
