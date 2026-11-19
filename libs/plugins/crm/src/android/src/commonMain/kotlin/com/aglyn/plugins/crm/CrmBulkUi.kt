package com.aglyn.plugins.crm

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.Busy
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.isoDayMillis
import com.aglyn.ui.isoDayOf
import com.aglyn.ui.FormSheet
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay

/** The bar over a list while rows are ticked (`CrmBulkBarFrame`): how many, the list's acts, Clear. */
@Composable
internal fun CrmBulkBar(
  count: Int,
  actions: List<CrmBulkAction>,
  busy: Boolean,
  enabled: (CrmBulkAction) -> Boolean,
  onPick: (CrmBulkAction) -> Unit,
  onClear: () -> Unit,
) {
  var open by remember { mutableStateOf(false) }
  Surface(
    Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface,
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
  ) {
    Row(Modifier.padding(horizontal = space(2f), vertical = space(0.5f)), verticalAlignment = Alignment.CenterVertically) {
      Text("${formatCount(count)} selected", Modifier.weight(1f).testTag("crm-bulk-count"), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      if (busy) CircularProgressIndicator(Modifier.padding(end = space(1f)).padding(2.dp), strokeWidth = 2.dp)
      Box {
        TextButton(onClick = { open = true }, enabled = !busy, modifier = Modifier.testTag("crm-bulk-menu")) { Text("Actions") }
        DropdownMenu(open, onDismissRequest = { open = false }) {
          for (action in actions.filter { !it.destructive }) {
            DropdownMenuItem(text = { Text(action.label) }, enabled = enabled(action), onClick = { open = false; onPick(action) }, modifier = Modifier.testTag("crm-bulk-${action.name.lowercase()}"))
          }
          val destructive = actions.filter { it.destructive }
          if (destructive.isNotEmpty()) {
            HorizontalDivider()
            for (action in destructive) {
              DropdownMenuItem(
                text = { Text(action.label, color = MaterialTheme.colorScheme.error) }, enabled = enabled(action),
                onClick = { open = false; onPick(action) }, modifier = Modifier.testTag("crm-bulk-${action.name.lowercase()}"),
              )
            }
          }
        }
      }
      TextButton(onClick = onClear, enabled = !busy, modifier = Modifier.testTag("crm-bulk-clear")) { Text("Clear") }
    }
  }
}

/** What the last act said, and every row it left, by name, until dismissed. */
@Composable
internal fun CrmBulkNotices(result: CrmBulkResult?, onDismiss: () -> Unit) {
  result ?: return
  val report = result.report
  if (report != null) {
    NoticeBanner(
      (listOf(report.heading) + report.lines).joinToString("\n"), StatusTone.WARNING, Modifier.testTag("crm-bulk-report"),
      action = { TextButton(onClick = onDismiss) { Text("Dismiss") } },
    )
  } else {
    NoticeBanner(result.sentence, if (result.outcome.done > 0) StatusTone.SUCCESS else StatusTone.WARNING, Modifier.testTag("crm-bulk-notice"))
    LaunchedEffect(result) {
      delay(6_000)
      onDismiss()
    }
  }
}

/** A row while picking several: a tick beside it, and a tap ticks it. */
@Composable
internal fun CrmPickRow(picked: Boolean, label: String, onToggle: () -> Unit, content: @Composable (Modifier) -> Unit) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Checkbox(picked, { onToggle() }, Modifier.padding(start = space(1f)).semantics { contentDescription = if (picked) "Untick $label" else "Tick $label" })
    content(Modifier.weight(1f))
  }
}

/** Select / Done beside a list's filters: picking several is opt-in, as the console's ticked rows are. */
@Composable
internal fun CrmSelectToggle(selecting: Boolean, onChange: (Boolean) -> Unit) {
  TextButton(onClick = { onChange(!selecting) }, modifier = Modifier.testTag("crm-select")) { Text(if (selecting) "Done" else "Select") }
}

/**
 * The one small dialog a value-taking act opens (`CrmBulkValueDialog`): what it applies to, the field, Cancel and Apply.
 * [pipeline] is the selected deals' one pipeline, null when they span more than one.
 */
@Composable
internal fun CrmBulkDialog(
  action: CrmBulkAction,
  kind: CrmKind?,
  count: Int,
  reference: CrmReference,
  pipeline: Pipeline?,
  initialDue: Long?,
  busy: Busy,
  onDismiss: () -> Unit,
  onApply: (CrmBulkValue) -> Unit,
) {
  var text by remember(action) { mutableStateOf("") }
  var due by remember(action) { mutableStateOf(initialDue) }
  val noun = kind?.let(CrmBulkNoun::of) ?: CrmBulkNoun.TASK
  val canApply = when (action) {
    CrmBulkAction.ADD_TAG, CrmBulkAction.REMOVE_TAG -> crmBulkTag(text) != null
    CrmBulkAction.STAGE -> text.isNotEmpty() && (kind != CrmKind.DEAL || pipeline != null)
    CrmBulkAction.STATUS -> text.isNotEmpty()
    CrmBulkAction.UNQUALIFY -> text.isNotBlank()
    else -> true
  }
  val title = if (action == CrmBulkAction.LOST) (if (count == 1) "Mark this deal lost?" else "Mark $count deals lost?") else crmBulkSheetTitle(action, kind)
  val help = when (action) {
    CrmBulkAction.ADD_TAG -> if (kind == CrmKind.COMPANY) "Lowercased, like the tags on a company" else "Lowercased, like the tags on a profile"
    CrmBulkAction.REMOVE_TAG -> "Removed wherever it is present"
    CrmBulkAction.COMPANY -> "Leave it empty to unlink the selected contacts from their companies."
    CrmBulkAction.STATUS -> "Closing a lead goes through Unqualify, which asks why."
    CrmBulkAction.UNQUALIFY -> "One reason for every selected lead, kept on each so it can be counted later."
    CrmBulkAction.LOST -> if (count == 1) "Optional. Kept on the deal and sent with the dealLost event." else "Optional. Kept on each deal and sent with each dealLost event."
    CrmBulkAction.ASSIGN -> "Somebody other than you is told, as the task form tells them"
    CrmBulkAction.DUE -> "Leave it empty to clear the due date"
    CrmBulkAction.STAGE -> if (kind == CrmKind.DEAL) pipeline?.let { "${it.name} — each move fires its event, as a drag does" } else null
    else -> null
  }
  FormSheet(
    title, busy, onDismiss, { onApply(CrmBulkValue(text, due)) },
    confirmLabel = when (action) { CrmBulkAction.UNQUALIFY -> "Unqualify"; CrmBulkAction.LOST -> "Mark lost"; else -> "Apply" },
    confirmEnabled = canApply, destructive = action == CrmBulkAction.LOST, workingLabel = "Applying…",
  ) {
    Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      Text(
        when {
          action == CrmBulkAction.LOST && count > 1 -> "$count deals move to Lost and leave the open pipeline, each with the reason below. Any can be reopened from its page."
          action == CrmBulkAction.LOST -> "The deal moves to Lost and leaves the open pipeline. It can be reopened from its page."
          else -> "Applies to ${noun.count(count)} selected."
        },
        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      when (action) {
        CrmBulkAction.ADD_TAG, CrmBulkAction.REMOVE_TAG -> OutlinedTextField(
          text, { text = it }, label = { Text("Tag") }, placeholder = { Text(if (kind == CrmKind.COMPANY) "enterprise" else "vip") },
          singleLine = true, supportingText = help?.let { { Text(it) } }, modifier = Modifier.fillMaxWidth().testTag("crm-bulk-tag"),
        )
        CrmBulkAction.OWNER, CrmBulkAction.ASSIGN -> SelectField(
          if (action == CrmBulkAction.OWNER) "Owner" else "Assignee",
          listOf(SelectOption("", if (action == CrmBulkAction.OWNER) "Nobody — clear the owner" else "Nobody — clear the assignee")) +
            reference.members.map { SelectOption(it.uid, it.label) },
          text, { text = it.orEmpty() }, Modifier.fillMaxWidth().testTag("crm-bulk-member"), supporting = help,
        )
        CrmBulkAction.STAGE -> if (kind == CrmKind.CONTACT) {
          SelectField(
            "Lifecycle stage", Contracts.nativeContactLifecycleStages.map { SelectOption(it, stageLabel(it) ?: it) }, text.ifEmpty { null },
            { text = it.orEmpty() }, Modifier.fillMaxWidth().testTag("crm-bulk-stage"),
          )
        } else if (pipeline != null) {
          SelectField(
            "Stage", crmBulkDealStages(pipeline).map { SelectOption(it.id, it.name) }, text.ifEmpty { null }, { text = it.orEmpty() },
            Modifier.fillMaxWidth().testTag("crm-bulk-stage"), supporting = help,
          )
        } else {
          Text(
            "The selected deals are in different pipelines, so there is no one list of stages to move them to. Select deals from one pipeline.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        CrmBulkAction.COMPANY -> SelectField(
          "Company", listOf(SelectOption("", "No company")) + reference.companies.map { SelectOption(it.value, it.label) }, text,
          { text = it.orEmpty() }, Modifier.fillMaxWidth().testTag("crm-bulk-company"), supporting = help,
        )
        CrmBulkAction.STATUS -> SelectField(
          "Status", Contracts.nativeCrmLeadOpenStatuses.map { SelectOption(it, crmLeadStatusText(it)) }, text.ifEmpty { null },
          { text = it.orEmpty() }, Modifier.fillMaxWidth().testTag("crm-bulk-status"), supporting = help,
        )
        CrmBulkAction.UNQUALIFY, CrmBulkAction.LOST -> OutlinedTextField(
          text, { text = it.take(CRM_BULK_REASON_MAX) }, label = { Text("Reason") }, minLines = 2,
          supportingText = help?.let { { Text(it) } }, modifier = Modifier.fillMaxWidth().testTag("crm-bulk-reason"),
        )
        CrmBulkAction.DUE -> Column(Modifier.testTag("crm-bulk-due")) {
          // The task form's day field: a new day keeps the time of day the first task was due at, or 9 AM where the person is.
          FieldEditor(FieldSpec("due", "Due date", FieldKind.DATE), due?.let(::isoDayOf).orEmpty(), { day ->
            val time = due?.let { it - startOfLocalDay(it) } ?: (9 * 3_600_000L)
            due = isoDayMillis(day)?.let { startOfLocalDay(it + 12 * 3_600_000L) + time }
          })
          Text(help.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        else -> Unit
      }
    }
  }
}

/** A destructive act's question, word for word the console's. */
@Composable
internal fun CrmBulkConfirmDialog(confirm: CrmBulkConfirm, busy: Boolean, onDismiss: () -> Unit, onConfirm: () -> Unit) {
  ActionDialog(
    confirm.title, confirm.button, onConfirm, onDismiss, Modifier.testTag("crm-bulk-confirm-dialog"), body = confirm.message, busy = busy,
    destructive = true,
  )
}

/** The bulk state a list keeps while rows are ticked. */
internal class CrmBulkState {
  var selecting by mutableStateOf(false)
  var picked by mutableStateOf(setOf<String>())
  var action by mutableStateOf<CrmBulkAction?>(null)
  var confirming by mutableStateOf<CrmBulkAction?>(null)
  var running by mutableStateOf(false)
  var result by mutableStateOf<CrmBulkResult?>(null)
  val busy = Busy()

  fun toggle(id: String) {
    picked = if (id in picked) picked - id else picked + id
  }

  fun pick(action: CrmBulkAction, runNow: (CrmBulkAction) -> Unit) {
    result = null
    when {
      action.confirms -> confirming = action
      action.immediate -> runNow(action)
      else -> this.action = action
    }
  }

  /** Runs an act; the rows a destructive act could not remove stay ticked so the reader sees which. */
  fun run(scope: CoroutineScope, keepPicked: Boolean, job: suspend () -> CrmBulkResult) {
    running = true
    busy.run(scope, onDone = { action = null; confirming = null }) {
      try {
        val done = job()
        result = done
        if (keepPicked) picked = done.keep.toSet()
      } finally {
        running = false
      }
    }
  }
}
