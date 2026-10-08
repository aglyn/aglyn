package com.aglyn.plugins.inbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
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
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.TransferExportDialog
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.ListHeader
import com.aglyn.ui.LoadContent
import com.aglyn.ui.LoadMoreEffect
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.RefreshableBox
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

const val INBOX_SUBMISSIONS_SCREEN = "inbox.submissions"
const val INBOX_SUBMISSION_SCREEN = "inbox.submission"

private val CONTENT_ROLES = setOf("admin", "editor", "author")

/**
 * A site's form submissions, or one form's ([formId]), the opened one beside
 * the list on wide windows: the read filter, search, export, and each
 * submission's fields with read or unread, reply and delete.
 */
@Composable
fun SubmissionsScreen(context: NativePluginContext, formId: String?, formName: String?, initialSubmissionId: String?) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val model = remember(hostId, formId, context.firestore) { SubmissionsModel(hostId, formId, context.firestore, scope) }
  LaunchedEffect(model) { model.reload() }
  val api = remember(hostId, context.api, context.writer) { SubmissionsApi(context.api, context.writer, hostId) }
  val runner = remember(hostId) { ActionRunner(scope) }
  var exporting by remember { mutableStateOf(false) }
  val canEdit = context.siteRole in CONTENT_ROLES

  AglynListDetail(
    initialSelected = initialSubmissionId,
    list = { selected, onSelect ->
      val listState = rememberLazyListState()
      LoadMoreEffect(listState, model.hasMore, onLoadMore = model::loadMore)
      Column(Modifier.fillMaxSize()) {
        ListHeader(formName?.let { "Submissions · $it" } ?: "Submissions") {
          OutlinedButton(onClick = { exporting = true }, modifier = Modifier.testTag("submissions-export")) {
            Icon(AglynIcons.named("download"), contentDescription = null)
            Text("Export", Modifier.padding(start = space(1f)))
          }
        }
        Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
          runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
          SearchField(model.search, model::type, placeholder = "Search submissions")
          ChoiceChipRow(readChoices().map { (value, label) -> ChipOption(value ?: "all", label) }, model.read ?: "all", { model.pick(it.takeIf { key -> key != "all" }) })
        }
        RefreshableBox(model.refreshing, model::refresh) {
          LoadContent(model.rows, onRetry = { model.reload() }, failedTitle = "Could not load submissions") { rows ->
            if (rows.isEmpty()) {
              EmptyState(
                if (model.search.isBlank() && model.read == null) "No submissions yet" else "No submissions match",
                body = if (model.search.isBlank() && model.read == null) "What visitors send through your forms shows up here." else "Try another filter or search.",
                icon = AglynIcons.named("inbox"),
              )
            } else {
              val now = remember(rows) { nowMillis() }
              LazyColumn(Modifier.fillMaxSize().testTag("submissions-list"), state = listState) {
                items(rows, key = { it.id }) { row ->
                  AglynListItem(
                    title = row.from,
                    supporting = listOfNotNull(if (formId == null) row.formName else null, row.preview.ifBlank { null }).joinToString(" — "),
                    icon = AglynIcons.named(if (row.read) "mark_email_read" else "mark_email_unread"),
                    emphasized = !row.read,
                    selected = row.id == selected,
                    trailing = { row.createdAt?.let { Text(relativeTime(it.epochMillis, now), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) } },
                    onClick = { onSelect(row.id) },
                    modifier = Modifier.testTag("submission-${row.id}"),
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
        EmptyState("Pick a submission to read it", icon = AglynIcons.named("inbox"))
      } else {
        SubmissionDetail(context, hostId, selected, api, runner, canEdit, model)
      }
    },
  )

  if (exporting) {
    TransferExportDialog(
      context,
      resource = "forms.submissions",
      title = formName?.let { "Export $it submissions" } ?: "Export submissions",
      hostId = hostId,
      scope = buildMap<String, Any?> {
        val filter = buildMap<String, Any?> {
          formId?.let { put("formId", it) }
          model.read?.let { put("read", it == "true") }
        }
        if (filter.isEmpty()) put("kind", "all") else { put("kind", "filter"); put("filter", filter) }
      },
      fileStem = "submissions",
      filter = formId?.let { mapOf("formId" to it) },
    ) { message ->
      exporting = false
      if (message != null) runner.notice = message
    }
  }
}

@Composable
private fun SubmissionDetail(context: NativePluginContext, hostId: String, id: String, api: SubmissionsApi, runner: ActionRunner, canEdit: Boolean, model: SubmissionsModel) {
  val live by remember(hostId, id, context.firestore) { context.firestore.observeDoc("${submissionsPath(hostId)}/$id") }.collectAsState(Live.Loading)
  var replying by remember(id) { mutableStateOf(false) }
  var deleting by remember(id) { mutableStateOf(false) }
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this submission", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val doc = value.value
      if (doc == null) {
        EmptyState("This submission is gone", body = "It may have been deleted.", icon = AglynIcons.named("inbox"))
        return
      }
      val submission = Submission.from(doc)
      // Opening an unread submission marks it read, as the console's dialog does.
      LaunchedEffect(submission.id, submission.read) {
        if (!submission.read && canEdit) runCatching { api.setRead(submission.id, true) }.onSuccess { model.patch(submission.id, read = true) }
      }
      val now = remember(submission.id) { nowMillis() }
      // The form's own question labels, where the form still declares them.
      val form by remember(hostId, submission.formId, context.firestore) {
        context.firestore.observeDoc("hosts/$hostId/forms/${submission.formId ?: "-"}")
      }.collectAsState(Live.Loading)
      val labels = ((form as? Live.Ready)?.value?.data?.get("fields") as? List<*>)?.mapNotNull { entry ->
        val field = entry as? Map<*, *> ?: return@mapNotNull null
        (field["fieldName"] as? String)?.let { name -> name to ((field["label"] as? String)?.ifBlank { null } ?: name) }
      }?.toMap().orEmpty()
      Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("submission-detail"),
        verticalArrangement = Arrangement.spacedBy(space(2f)),
      ) {
        SectionCard(null) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
              Text(submission.from, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
              submission.sender.email?.takeIf { it != submission.from }?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            OverflowMenu(
              listOf(
                MenuAction("toggle-read", if (submission.read) "Mark as unread" else "Mark as read", if (submission.read) "mark_email_unread" else "mark_email_read", enabled = canEdit) {
                  val next = !submission.read
                  runner.run { api.setRead(submission.id, next); model.patch(submission.id, read = next) }
                },
                MenuAction("delete", "Delete", "delete", destructive = true, enabled = canEdit) { deleting = true },
              ),
            )
          }
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
            StatusChip(submission.formName, StatusTone.INFO)
            if (submission.repliedAtMs != null) StatusChip("Replied", StatusTone.SUCCESS)
            submission.capturedKind?.let { StatusChip(if (it == "lead") "Became a lead" else "Became a contact", StatusTone.NEUTRAL) }
          }
          Text(
            listOfNotNull(submission.createdAt?.let { "Received " + relativeTime(it.epochMillis, now) }, submission.path?.let { "from $it" }).joinToString(" "),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          if (submission.sender.email != null) {
            Button(onClick = { replying = true }, enabled = canEdit, modifier = Modifier.testTag("submission-reply")) {
              Icon(AglynIcons.named("reply"), contentDescription = null)
              Text("Reply", Modifier.padding(start = space(1f)))
            }
          }
        }
        SectionCard("What they sent") {
          if (submission.fields.isEmpty()) Text("This submission carried no fields.", color = MaterialTheme.colorScheme.onSurfaceVariant)
          SelectionContainer {
            Column {
              submission.fields.forEachIndexed { index, (key, text) ->
                if (index > 0) HorizontalDivider()
                DetailRow(labels[key] ?: key, text)
              }
            }
          }
        }
      }
      if (replying) ReplyDialog(submission, api, runner) { replying = false }
      if (deleting) {
        ActionDialog(
          title = "Delete this submission?",
          body = "It is removed for everyone. The form's counts are refreshed.",
          icon = "delete",
          confirmLabel = "Delete",
          destructive = true,
          busy = runner.busy,
          error = runner.error,
          onDismiss = { deleting = false },
          onConfirm = {
            runner.run("Submission deleted.", onDone = { deleting = false }) {
              api.delete(submission)
              model.patch(submission.id, removed = true)
            }
          },
        )
      }
    }
  }
}

@Composable
private fun ReplyDialog(submission: Submission, api: SubmissionsApi, runner: ActionRunner, close: () -> Unit) {
  var subject by remember { mutableStateOf("Re: ${submission.formName}") }
  var message by remember { mutableStateOf("") }
  ActionDialog(
    title = "Reply to ${submission.from}",
    body = submission.sender.email?.let { "Sent to $it from your site's address." },
    icon = "reply",
    confirmLabel = "Send reply",
    confirmEnabled = subject.isNotBlank() && message.isNotBlank(),
    busy = runner.busy,
    error = runner.error,
    onDismiss = close,
    onConfirm = { runner.run("Reply sent.", onDone = close) { api.reply(submission.id, subject.trim(), message.trim()) } },
  ) {
    OutlinedTextField(subject, { subject = it }, label = { Text("Subject") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("reply-subject"))
    OutlinedTextField(message, { message = it }, label = { Text("Message") }, minLines = 5, modifier = Modifier.fillMaxWidth().testTag("reply-message"))
  }
}
