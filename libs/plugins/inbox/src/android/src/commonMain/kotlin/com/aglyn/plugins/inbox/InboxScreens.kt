package com.aglyn.plugins.inbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldOption
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.LiveListPane
import com.aglyn.ui.LiveQueryList
import com.aglyn.ui.MetricCard
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.PropertyRow
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

const val INBOX_SCREEN = "inbox.submissions"
const val INBOX_PEOPLE_SCREEN = "inbox.people"
const val INBOX_SUBMISSION_SCREEN = "inbox.submission"

/** The site's own document: its name (the reply's default subject) and the member's role on it. */
data class InboxSite(val name: String?, val role: String?)

@Composable
private fun rememberInboxSite(context: NativePluginContext): Live<InboxSite> {
  val hostId = context.hostId ?: return Live.Ready(InboxSite(null, null))
  val flow = remember(hostId, context.firestore) { context.firestore.observeDoc("hosts/$hostId") }
  return when (val live = flow.collectAsState(Live.Loading).value) {
    Live.Loading -> Live.Loading
    is Live.Failed -> Live.Ready(InboxSite(null, null))
    is Live.Ready -> {
      @Suppress("UNCHECKED_CAST") val roles = live.value?.data?.get("memberRoles") as? Map<String, Any?>
      Live.Ready(InboxSite(live.value?.string("displayName") ?: live.value?.string("name"), roles?.get(context.uid) as? String))
    }
  }
}

private fun messageError(error: Throwable): String = error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."

/**
 * A site's form submissions: Unread / Read chips, a form pick and a search
 * over the list, newest first; the picked message beside the list on wide
 * windows. `submission` opens one, as a notification or a link does.
 */
@Composable
fun SubmissionsScreen(context: NativePluginContext, initialSubmission: String? = null, scopedForm: String? = null) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val list = remember(hostId, context.firestore) { LiveQueryList(context.firestore, scope, SUBMISSIONS_PAGE_SIZE, ::submissionOf) }
  var read by rememberSaveable { mutableStateOf(ReadFilter.ALL) }
  var formId by rememberSaveable { mutableStateOf<String?>(null) }
  var search by rememberSaveable { mutableStateOf("") }
  var asked by rememberSaveable { mutableStateOf("") }
  LaunchedEffect(list, read, formId, asked, scopedForm) {
    list.show { limit -> submissionsQuery(hostId, read, formId, asked, limit, scopedForm) }
  }
  val forms = remember(hostId, context.firestore, scopedForm) {
    if (scopedForm != null) kotlinx.coroutines.flow.flowOf(Live.Ready(emptyList())) else context.firestore.observe(formsQuery(hostId))
  }.collectAsState(Live.Loading).value
  val formOptions = (forms as? Live.Ready)?.value.orEmpty().map { ChipOption(it.id, formName(it)) }.sortedBy { it.label.lowercase() }
  val site = rememberInboxSite(context)
  val permissions = InboxPermissions.of((site as? Live.Ready)?.value?.role)

  AglynListDetail(
    initialSelected = initialSubmission,
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = "Search messages", onSearch = { asked = search })
          ChoiceChipRow(ReadFilter.entries.map { ChipOption(it.name, it.label) }, read.name, { read = ReadFilter.valueOf(it) })
          if (formOptions.size > 1) {
            ChoiceChipRow(listOf(ChipOption("", "Every form")) + formOptions, formId ?: "", { formId = it.ifEmpty { null } })
          }
        }
        LiveListPane(
          list,
          key = { it.id },
          failed = "Could not load the Inbox",
          empty = {
            val filtered = read != ReadFilter.ALL || formId != null || asked.isNotBlank()
            EmptyState(
              if (filtered) "No messages match" else "No messages yet",
              body = if (filtered) "Try another filter or search." else "What visitors send through your forms arrives here.",
              icon = AglynIcons.named("inbox"),
            )
          },
        ) { row -> SubmissionRow(row, row.id == selected) { onSelect(row.id) } }
      }
    },
    detail = { selected ->
      if (selected == null) {
        EmptyState("Pick a message to read it here", icon = AglynIcons.named("inbox"))
      } else {
        SubmissionDetail(context, hostId, selected, (site as? Live.Ready)?.value, permissions)
      }
    },
  )
}

@Composable
private fun SubmissionRow(row: Submission, selected: Boolean, onClick: () -> Unit) {
  val now = remember { nowMillis() }
  AglynListItem(
    title = row.sender.label,
    supporting = listOf(row.formName, row.preview).filter { it.isNotBlank() }.joinToString(" · "),
    icon = AglynIcons.named(if (row.read) "drafts" else "mail"),
    selected = selected,
    emphasized = !row.read,
    trailing = {
      Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        row.receivedAtMs?.let { Text(relativeTime(it, now), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (!row.read) {
          Box(Modifier.size(10.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).semantics { contentDescription = "Unread" })
        } else if (row.repliedAtMs != null) {
          Icon(AglynIcons.named("reply"), contentDescription = "Replied", Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    },
    onClick = onClick,
    modifier = Modifier.testTag("submission-${row.id}"),
  )
}

/**
 * One message on its own (`inbox.submission`), as a form's screen or a
 * notification opens it: the same detail the Inbox shows beside its list.
 */
@Composable
fun SubmissionScreen(context: NativePluginContext, submissionId: String?) {
  val hostId = context.hostId ?: return
  if (submissionId.isNullOrEmpty()) {
    SubmissionsScreen(context)
    return
  }
  val site = rememberInboxSite(context)
  SubmissionDetail(context, hostId, submissionId, (site as? Live.Ready)?.value, InboxPermissions.of((site as? Live.Ready)?.value?.role))
}

/** One message: who sent it, every field, what the site did with it, the reply and the list add. Opening it marks it read. */
@Composable
fun SubmissionDetail(context: NativePluginContext, hostId: String, submissionId: String, site: InboxSite?, permissions: InboxPermissions) {
  val flow = remember(hostId, submissionId, context.firestore) { context.firestore.observeDoc("${submissionsPath(hostId)}/$submissionId") }
  val live by flow.collectAsState(Live.Loading)
  val scope = rememberCoroutineScope()
  val actions = remember(hostId, context.api, context.writer) { ConsoleInboxActions(context.api, context.writer, hostId) }
  var notice by remember(submissionId) { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var confirmDelete by remember(submissionId) { mutableStateOf(false) }
  var deleting by remember(submissionId) { mutableStateOf(false) }
  var deleteError by remember(submissionId) { mutableStateOf<String?>(null) }
  var markedOnOpen by remember(submissionId) { mutableStateOf(false) }

  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this message", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val doc = value.value
      if (doc == null) {
        EmptyState("That message is no longer in the Inbox", body = "It may have been deleted.", icon = AglynIcons.named("inbox"))
        return
      }
      val row = submissionOf(doc)
      LaunchedEffect(row.id, row.read) {
        if (!row.read && permissions.canWrite && !markedOnOpen) {
          markedOnOpen = true
          runCatching { actions.setRead(row.id, true) }
        }
      }
      Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("submission-detail"),
        verticalArrangement = Arrangement.spacedBy(space(2f)),
      ) {
        notice?.let { (message, tone) -> NoticeBanner(message, tone, action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } }) }
        SectionCard(null, Modifier.fillMaxWidth()) {
          Text(row.sender.label, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
          row.sender.email?.takeIf { it != row.sender.label }?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
          Text(
            listOfNotNull(row.formName, row.receivedAtMs?.let { formatReceiptTime(it) }).joinToString(" · "),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          if (permissions.canWrite) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
              OutlinedButton(
                onClick = { scope.launch { runCatching { actions.setRead(row.id, !row.read) }.onFailure { notice = messageError(it) to StatusTone.ERROR } } },
                modifier = Modifier.testTag("submission-toggle-read"),
              ) {
                Icon(AglynIcons.named(if (row.read) "mark_unread" else "drafts"), contentDescription = null)
                Text(if (row.read) "Mark unread" else "Mark read", Modifier.padding(start = space(1f)))
              }
              OutlinedButton(onClick = { confirmDelete = true }, modifier = Modifier.testTag("submission-delete")) {
                Icon(AglynIcons.named("delete"), contentDescription = null)
                Text("Delete", Modifier.padding(start = space(1f)))
              }
            }
          }
        }
        SectionCard("Message", Modifier.fillMaxWidth()) {
          if (row.fields.isEmpty()) Text("This message has no fields.", color = MaterialTheme.colorScheme.onSurfaceVariant)
          row.fields.forEach { (key, value) -> PropertyRow(key, value) }
          row.path?.takeIf { it.isNotBlank() }?.let { PropertyRow("Sent from", it) }
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
            row.chips.forEach { chip ->
              StatusChip(chip.label, when (chip.color) {
                ChipColor.SUCCESS -> StatusTone.SUCCESS
                ChipColor.INFO -> StatusTone.INFO
                ChipColor.WARNING -> StatusTone.WARNING
                ChipColor.DEFAULT -> StatusTone.NEUTRAL
              })
            }
          }
          if (row.capturedKind != null && row.capturedId != null) {
            TextButton(
              onClick = { context.navigate(if (row.capturedKind == "lead") "crm.lead" else "crm.contact", mapOf(row.capturedKind to row.capturedId)) },
              modifier = Modifier.testTag("submission-open-record"),
            ) { Text(if (row.capturedKind == "lead") "Open the lead in the CRM" else "Open the contact in the CRM") }
          }
        }
        if (permissions.canReply) {
          ReplyCard(context, hostId, row, site, actions) { notice = it }
          ListAssignmentCard(row, actions) { notice = it }
        }
      }
      if (confirmDelete) {
        ActionDialog(
          title = "Delete this message?",
          body = "It leaves the Inbox for everyone on the site. This cannot be undone.",
          icon = "delete",
          confirmLabel = "Delete",
          destructive = true,
          busy = deleting,
          error = deleteError,
          onDismiss = { confirmDelete = false; deleteError = null },
          onConfirm = {
            deleting = true
            scope.launch {
              try {
                actions.delete(row)
                confirmDelete = false
              } catch (error: Throwable) {
                if (error is CancellationException) throw error
                deleteError = messageError(error)
              } finally {
                deleting = false
              }
            }
          },
        )
      }
    }
  }
}

@Composable
private fun ReplyCard(
  context: NativePluginContext,
  hostId: String,
  row: Submission,
  site: InboxSite?,
  actions: InboxActions,
  onNotice: (Pair<String, StatusTone>) -> Unit,
) {
  val scope = rememberCoroutineScope()
  var subject by rememberSaveable(row.id) { mutableStateOf(defaultReplySubject(site?.name, row.formName)) }
  var message by rememberSaveable(row.id) { mutableStateOf("") }
  var sending by remember(row.id) { mutableStateOf(false) }
  var error by remember(row.id) { mutableStateOf<String?>(null) }
  val replies = remember(hostId, row.id, context.firestore) { context.firestore.observe(sentRepliesQuery(hostId, row.id)) }
    .collectAsState(Live.Loading).value
  val subjectMax = Contracts.replySubjectMax.toInt()
  val bodyMax = Contracts.replyBodyMax.toInt()
  SectionCard("Reply", Modifier.fillMaxWidth()) {
    if (row.sender.email == null) {
      Text("This message has no email address to answer.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else {
      Text("To ${row.sender.email}. Their answer comes to your own email.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      OutlinedTextField(
        subject,
        { subject = it.take(subjectMax) },
        label = { Text("Subject") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("reply-subject"),
      )
      OutlinedTextField(
        message,
        { message = it.take(bodyMax) },
        label = { Text("Message") },
        minLines = 4,
        supportingText = { Text("Your reply quotes their message below it.") },
        modifier = Modifier.fillMaxWidth().testTag("reply-message"),
      )
      error?.let { NoticeBanner(it, StatusTone.ERROR) }
      Button(
        onClick = {
          sending = true
          error = null
          scope.launch {
            try {
              val to = actions.reply(row.id, subject.trim(), message.trim())
              message = ""
              onNotice("Your reply is on its way to ${to ?: row.sender.email}." to StatusTone.SUCCESS)
            } catch (failure: Throwable) {
              if (failure is CancellationException) throw failure
              error = messageError(failure)
            } finally {
              sending = false
            }
          }
        },
        enabled = !sending && subject.isNotBlank() && message.isNotBlank(),
        modifier = Modifier.testTag("reply-send"),
      ) {
        Icon(AglynIcons.named("send"), contentDescription = null)
        Text(if (sending) "Sending…" else "Send reply", Modifier.padding(start = space(1f)))
      }
    }
    val sent = (replies as? Live.Ready)?.value.orEmpty().map(::sentReplyOf)
    if (sent.isNotEmpty()) {
      HorizontalDivider()
      Text("Sent replies", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
      sent.forEach { reply ->
        AglynListItem(
          title = reply.subject.ifBlank { "Reply" },
          supporting = listOfNotNull(reply.to.ifBlank { null }, reply.sentAtMs?.let { formatReceiptTime(it) }, reply.message.take(140).ifBlank { null }).joinToString(" · "),
          icon = AglynIcons.named("reply"),
        )
      }
    }
  }
}

@Composable
private fun ListAssignmentCard(row: Submission, actions: InboxActions, onNotice: (Pair<String, StatusTone>) -> Unit) {
  val scope = rememberCoroutineScope()
  var open by remember(row.id) { mutableStateOf(false) }
  var options by remember(row.id) { mutableStateOf<ListOptions?>(null) }
  var loadError by remember(row.id) { mutableStateOf<String?>(null) }
  var listId by remember(row.id) { mutableStateOf("") }
  var attest by remember(row.id) { mutableStateOf(false) }
  var busy by remember(row.id) { mutableStateOf(false) }
  var error by remember(row.id) { mutableStateOf<String?>(null) }
  SectionCard("Add to a marketing list", Modifier.fillMaxWidth()) {
    Text("Put this sender on one of your email lists.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedButton(onClick = {
      open = true
      options = null
      loadError = null
      scope.launch {
        try { options = actions.listOptions(row.id) } catch (failure: Throwable) {
          if (failure is CancellationException) throw failure
          loadError = messageError(failure)
        }
      }
    }, modifier = Modifier.testTag("submission-add-to-list")) {
      Icon(AglynIcons.named("list"), contentDescription = null)
      Text("Choose a list", Modifier.padding(start = space(1f)))
    }
  }
  if (!open) return
  val loaded = options
  ActionDialog(
    title = "Add to a marketing list",
    body = loaded?.summary ?: loaded?.to?.let { "Adds $it." },
    icon = "list",
    confirmLabel = "Add",
    confirmEnabled = loaded != null && loaded.enrollable && listId.isNotEmpty() && (!loaded.requiresAttestation || attest),
    busy = busy,
    error = error ?: loadError,
    onDismiss = { open = false; error = null },
    onConfirm = {
      busy = true
      error = null
      scope.launch {
        try {
          val name = actions.assignList(row.id, listId, attest)
          open = false
          onNotice("Added to ${name ?: "the list"}." to StatusTone.SUCCESS)
        } catch (failure: Throwable) {
          if (failure is CancellationException) throw failure
          error = messageError(failure)
        } finally {
          busy = false
        }
      }
    },
  ) {
    when {
      loaded == null && loadError == null -> SkeletonList(rows = 2)
      loaded == null -> Unit
      loaded.lists.isEmpty() -> Text("There are no lists yet. Make one under Email, Audiences.")
      !loaded.enrollable -> Text(loaded.summary ?: "This sender cannot be added to a list.")
      else -> {
        FieldEditor(
          FieldSpec("list", "List", FieldKind.SELECT, required = true, options = loaded.lists.map { FieldOption(it.id, it.name) }, emptyLabel = null),
          listId,
          { listId = it },
        )
        if (loaded.truncated) Text("Showing the first ${loaded.lists.size} lists.", style = MaterialTheme.typography.bodySmall)
        if (loaded.requiresAttestation) {
          SwitchRow("They agreed to hear from us", attest, { attest = it }, supporting = "Required to add someone who has not opted in on the form.")
        }
      }
    }
  }
}

/** The site's members and the leads it may see; a lead opens in the CRM. */
@Composable
fun PeopleScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val orgId = context.orgId
  val scope = rememberCoroutineScope()
  var tab by rememberSaveable { mutableStateOf("members") }
  var search by rememberSaveable { mutableStateOf("") }
  var asked by rememberSaveable { mutableStateOf("") }
  val members = remember(hostId, context.firestore) { LiveQueryList(context.firestore, scope, 25, ::siteMemberOf) }
  val leads = remember(hostId, context.firestore) { LiveQueryList(context.firestore, scope, 25, ::leadRowOf) }
  LaunchedEffect(tab, asked) {
    if (tab == "members") members.show { siteMembersQuery(hostId, asked, it) }
    else leads.show { limit -> orgId?.let { siteLeadsQuery(it, hostId, asked, limit) } }
  }
  val site = rememberInboxSite(context)
  val canRemove = (site as? Live.Ready)?.value?.role in setOf("owner", "admin")
  val actions = remember(hostId, context.api, context.writer) { ConsoleInboxActions(context.api, context.writer, hostId) }
  var removing by remember { mutableStateOf<SiteMemberRow?>(null) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val now = remember { nowMillis() }

  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(Modifier.widthIn(max = 840.dp).fillMaxSize()) {
      Column(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        ChoiceChipRow(listOf(ChipOption("members", "Site members"), ChipOption("leads", "Leads")), tab, { tab = it; search = ""; asked = "" })
        SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = if (tab == "members") "Search members" else "Search leads", onSearch = { asked = search })
      }
      if (tab == "members") {
        LiveListPane(
          members,
          key = { it.id },
          empty = { EmptyState("No members yet", body = "People who sign up on the site show up here.", icon = AglynIcons.named("group")) },
        ) { member ->
          AglynListItem(
            title = member.name,
            supporting = listOfNotNull(member.email.takeIf { it != member.name }, member.joinedAtMs?.let { "Joined ${relativeTime(it, now)}" }).joinToString(" · "),
            icon = AglynIcons.named("person"),
            trailing = if (canRemove) ({
              TextButton(onClick = { removing = member }, modifier = Modifier.testTag("member-remove-${member.id}")) { Text("Remove") }
            }) else null,
          )
        }
      } else {
        LiveListPane(
          leads,
          key = { it.id },
          empty = { EmptyState("No leads yet", body = "People your forms capture as leads show up here.", icon = AglynIcons.named("person_add")) },
        ) { lead ->
          AglynListItem(
            title = lead.name,
            supporting = listOfNotNull(lead.email.takeIf { it != lead.name }, lead.company).joinToString(" · "),
            icon = AglynIcons.named("person_add"),
            trailing = lead.statusLabel?.let { { StatusChip(it) } },
            onClick = { context.navigate("crm.lead", mapOf("lead" to lead.id)) },
            modifier = Modifier.testTag("lead-${lead.id}"),
          )
        }
      }
    }
  }
  removing?.let { member ->
    ActionDialog(
      title = "Remove ${member.name}?",
      body = "They lose their account on this site. Their past orders and messages stay.",
      icon = "delete",
      confirmLabel = "Remove",
      destructive = true,
      busy = busy,
      error = error,
      onDismiss = { removing = null; error = null },
      onConfirm = {
        busy = true
        scope.launch {
          try {
            actions.removeMember(member.id)
            removing = null
          } catch (failure: Throwable) {
            if (failure is CancellationException) throw failure
            error = messageError(failure)
          } finally {
            busy = false
          }
        }
      },
    )
  }
}

/** Home's Inbox card: unread among the newest messages, as the console's glance card counts them. */
@Composable
fun InboxGlanceWidget(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val flow = remember(hostId, context.firestore) { context.firestore.observe(submissionsQuery(hostId, ReadFilter.ALL, null, "", 4)) }
  val live by flow.collectAsState(Live.Loading)
  val rows = (live as? Live.Ready)?.value?.map(::submissionOf)
  val unread = rows?.take(3)?.count { !it.read }
  MetricCard(
    title = "Inbox",
    value = unread?.toString(),
    caption = when {
      rows == null -> null
      rows.isEmpty() -> "No messages yet"
      unread == 0 -> "All caught up"
      rows.size > 3 -> "unread here, more in the Inbox"
      else -> if (unread == 1) "unread message" else "unread messages"
    },
    icon = "inbox",
    actionLabel = "Open the Inbox",
    modifier = Modifier.fillMaxSize().testTag("inbox-glance"),
    loading = live is Live.Loading,
    error = if (live is Live.Failed) "Could not load the Inbox." else null,
    onClick = { context.navigate(INBOX_SCREEN) },
  )
}
