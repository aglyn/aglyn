package com.aglyn.plugins.email

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.AmountRow
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldOption
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.LiveListPane
import com.aglyn.ui.LiveQueryList
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.PropertyRow
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

const val EMAIL_MESSAGES_SCREEN = "email.messages"
const val EMAIL_MESSAGE_SCREEN = "email.message"

internal fun problemText(error: Throwable) = error.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."

fun sendTone(state: String): StatusTone = when (state) {
  "sent" -> StatusTone.SUCCESS
  "sending", "pending" -> StatusTone.INFO
  "held" -> StatusTone.WARNING
  "stopped" -> StatusTone.ERROR
  else -> StatusTone.NEUTRAL
}

/** Whether the member may send from this site: an admin or editor of it, as the route asks. */
@Composable
internal fun rememberCanSend(context: NativePluginContext): Boolean {
  val hostId = context.hostId ?: return false
  val live = remember(hostId, context.firestore) { context.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading).value
  @Suppress("UNCHECKED_CAST")
  val role = ((live as? Live.Ready)?.value?.data?.get("memberRoles") as? Map<String, Any?>)?.get(context.uid)
  return role == "admin" || role == "editor" || role == "owner"
}

/** A site's emails: Status chips and a subject search, newest first; the picked email beside the list on wide windows. */
@Composable
fun EmailsScreen(context: NativePluginContext, initial: String? = null, composeCampaign: String? = null) {
  val orgId = context.orgId ?: return
  val hostId = context.hostId ?: return
  val coroutines = rememberCoroutineScope()
  val list = remember(orgId, hostId, context.firestore) { LiveQueryList(context.firestore, coroutines, EMAILS_PAGE_SIZE, ::emailSendOf) }
  var status by rememberSaveable { mutableStateOf("all") }
  var search by rememberSaveable { mutableStateOf("") }
  var asked by rememberSaveable { mutableStateOf("") }
  var composing by remember(composeCampaign) { mutableStateOf(composeCampaign != null) }
  val canSend = rememberCanSend(context)
  LaunchedEffect(list, status, asked) { list.show { emailsQuery(orgId, hostId, status, asked, it) } }
  val now = remember { nowMillis() }
  AglynListDetail(
    initialSelected = initial,
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = "Search subjects", modifier = Modifier.weight(1f), onSearch = { asked = search })
            if (canSend) {
              FilledTonalButton(onClick = { composing = true }, modifier = Modifier.testTag("email-compose")) {
                Icon(AglynIcons.named("edit"), contentDescription = null)
                Text("Write", Modifier.padding(start = space(0.5f)))
              }
            }
          }
          ChoiceChipRow(SEND_STATUS_FILTERS.map { ChipOption(it.first, it.second) }, status, { status = it })
        }
        LiveListPane(
          list,
          key = { it.id },
          failed = "Could not load emails",
          empty = { EmptyState(if (status == "all" && asked.isBlank()) "No emails yet" else "No emails match", body = "Emails you write to your audiences show up here, with how each one did.", icon = AglynIcons.named("mail")) },
        ) { send ->
          AglynListItem(
            title = send.subject,
            supporting = listOfNotNull(audienceLabel(send), (send.sendAtMs ?: send.createdAtMs)?.let { relativeTime(it, now) }).joinToString(" · "),
            icon = AglynIcons.named("mail"),
            selected = send.id == selected,
            trailing = { StatusChip(if (send.display.state in setOf("draft", "held")) send.display.label else send.display.state.replaceFirstChar { it.uppercase() }, sendTone(send.display.state)) },
            onClick = { onSelect(send.id) },
            modifier = Modifier.testTag("email-${send.id}"),
          )
        }
      }
    },
    detail = { selected ->
      if (selected == null) EmptyState("Pick an email to see how it did", icon = AglynIcons.named("mail"))
      else EmailDetail(context, orgId, hostId, selected, canSend)
    },
  )
  if (composing) ComposeDialog(context, null, onDismiss = { composing = false }, campaignId = composeCampaign)
}

private enum class SendDialog { SEND_NOW, FOLLOW_UP, CANCEL, TEST, RENAME, EDIT }

/** One email: its state, who it went to, its report and its links, and what can be done with it. */
@Composable
fun EmailDetail(context: NativePluginContext, orgId: String, hostId: String, sendId: String, canSend: Boolean) {
  val path = "${campaignSendsPath(orgId)}/$sendId"
  val live by remember(path, context.firestore) { context.firestore.observeDoc(path) }.collectAsState(Live.Loading)
  val links by remember(path, context.firestore) { context.firestore.observeDoc("$path/reports/links") }.collectAsState(Live.Loading)
  val api = remember(hostId, context.api) { CampaignSendApi(context.api, hostId) }
  val coroutines = rememberCoroutineScope()
  var dialog by remember(sendId) { mutableStateOf<SendDialog?>(null) }
  var notice by remember(sendId) { mutableStateOf<String?>(null) }
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this email", body = value.error.message, icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val doc = value.value ?: run {
        EmptyState("This email is gone", body = "A draft that was discarded leaves no trace.", icon = AglynIcons.named("mail"))
        return
      }
      val send = emailSendOf(doc)
      @Suppress("UNCHECKED_CAST") val report = campaignReport(doc.data["stats"] as? Map<String, Any?>)
      val linkReport = sendLinkReport((links as? Live.Ready)?.value?.data)
      Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
          Modifier.widthIn(max = 920.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("email-detail"),
          verticalArrangement = Arrangement.spacedBy(space(2f)),
        ) {
          notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } }) }
          if (send.held) NoticeBanner("This email is held for review before it sends. Our team reviews it, and it sends automatically if it is approved or is canceled if it is not. Nothing has been sent or counted.", StatusTone.WARNING)
          SectionCard(null, Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
              Text(send.subject, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
              StatusChip(send.display.label, sendTone(send.display.state))
            }
            Text(
              listOfNotNull(
                audienceLabel(send),
                send.sendAtMs?.takeIf { send.status == "scheduled" }?.let { "Scheduled for ${formatReceiptTime(it)}" },
                send.createdAtMs?.let { "Written ${formatReceiptTime(it)}" },
              ).joinToString(" · "),
              style = MaterialTheme.typography.bodyMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (canSend) {
              FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
                if (send.canSendNow) Button(onClick = { dialog = SendDialog.SEND_NOW }, modifier = Modifier.testTag("email-send-now")) { Text("Send now") }
                if (send.canFollowUp) Button(onClick = { dialog = SendDialog.FOLLOW_UP }) { Text("Send to more") }
                if (send.canCompose) OutlinedButton(onClick = { dialog = SendDialog.EDIT }, modifier = Modifier.testTag("email-edit")) { Text("Edit") }
                if (send.canCompose) OutlinedButton(onClick = { dialog = SendDialog.TEST }, modifier = Modifier.testTag("email-test")) { Text("Send a test") }
                if (send.canStop) OutlinedButton(onClick = { dialog = SendDialog.CANCEL }) { Text("Stop sending") }
                if (send.canCancel) OutlinedButton(onClick = { dialog = SendDialog.CANCEL }) { Text("Cancel send") }
                OutlinedButton(onClick = { dialog = SendDialog.RENAME }) { Text("Rename") }
              }
            }
          }
          SectionCard("Sent as", Modifier.fillMaxWidth()) {
            PropertyRow("From", listOfNotNull((doc.data["sentAs"] as? Map<*, *>)?.get("fromName") as? String ?: doc.string("fromName"), (doc.data["sentAs"] as? Map<*, *>)?.get("from") as? String).joinToString(" · ").ifBlank { null })
            PropertyRow("Reply to", ((doc.data["sentAs"] as? Map<*, *>)?.get("replyTo") as? String) ?: doc.string("replyTo"))
            PropertyRow("Preview text", doc.string("preheader"))
            PropertyRow("Design", if (doc.string("templateScreenId") != null) "Designed email" else "Plain message")
          }
          if (send.status != "draft") {
            SectionCard("Delivery", Modifier.fillMaxWidth()) {
              AmountRow("Sent", grouped(report.sent), emphasized = true)
              AmountRow("Addressed", grouped(report.recipients), muted = true)
              AmountRow("Delivered", report.delivered?.let { "${grouped(it)} · ${percent(report.rates["delivery"])}" } ?: "Not recorded", muted = true)
              AmountRow("Bounced", "${grouped(report.bounced)} · ${percent(report.rates["bounce"])}", muted = true)
              AmountRow("Complaints", "${grouped(report.complained)} · ${percent(report.rates["complaint"])}", muted = true)
            }
            SectionCard("Engagement", Modifier.fillMaxWidth()) {
              AmountRow("Opened", "${report.uniqueOpens?.let(::grouped) ?: "—"} · ${percent(report.rates["open"])}", emphasized = true)
              AmountRow("Clicked", "${report.uniqueClicks?.let(::grouped) ?: "—"} · ${percent(report.rates["click"])}", muted = true)
              AmountRow("Click to open", percent(report.rates["clickToOpen"]), muted = true)
              AmountRow("All opens", grouped(report.opens), muted = true)
              AmountRow("All clicks", grouped(report.clicks), muted = true)
              AmountRow("Unsubscribed", "${grouped(report.unsubscribes)} · ${percent(report.rates["unsubscribe"])}", muted = true)
            }
            if (report.populations.isNotEmpty()) {
              SectionCard("Who was left out", Modifier.fillMaxWidth()) {
                report.populations.forEach { AmountRow(it.label, "${grouped(it.count)} of ${grouped(it.of)} ${it.ofLabel}", muted = true) }
              }
            }
            if (linkReport.rows.isNotEmpty()) {
              SectionCard("Links", Modifier.fillMaxWidth()) {
                linkReport.rows.forEach { AmountRow(it.url, "${grouped(it.clicks)} · ${percent(it.share)}", muted = true) }
                if (linkReport.truncated) Text("Only the most-clicked links are listed.", style = MaterialTheme.typography.bodySmall)
              }
            }
            report.caveats.forEach { NoticeBanner(it.message, StatusTone.INFO) }
          }
        }
      }
      SendDialogs(context, api, send, dialog, onClose = { dialog = null }, onNotice = { notice = it })
    }
  }
}

@Composable
private fun SendDialogs(context: NativePluginContext, api: CampaignSendApi, send: EmailSend, dialog: SendDialog?, onClose: () -> Unit, onNotice: (String) -> Unit) {
  val coroutines = rememberCoroutineScope()
  var busy by remember(dialog) { mutableStateOf(false) }
  var error by remember(dialog) { mutableStateOf<String?>(null) }
  var reaching by remember(dialog) { mutableStateOf<Long?>(null) }
  fun run(done: String, block: suspend () -> Unit) {
    busy = true
    error = null
    coroutines.launch {
      try {
        block()
        onClose()
        onNotice(done)
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = problemText(failure)
      } finally {
        busy = false
      }
    }
  }
  fun people(n: Long) = "${grouped(n)} ${if (n == 1L) "person" else "people"}"
  when (dialog) {
    null -> Unit
    SendDialog.SEND_NOW -> {
      LaunchedEffect(send.id) { reaching = runCatching { api.sendNowCount(send.id) }.getOrNull() ?: 0 }
      ActionDialog(
        title = "Send this email now?",
        body = reaching?.let { "This sends it to ${people(it)} straight away${if (send.status == "scheduled") ", instead of at the time it is scheduled for." else "."} It cannot be taken back once it goes." } ?: "Counting who it reaches…",
        icon = "send",
        confirmLabel = "Send now",
        confirmEnabled = (reaching ?: 0) > 0,
        busy = busy,
        error = error ?: if (reaching == 0L) "Nobody in this audience can be sent to right now." else null,
        onDismiss = onClose,
        onConfirm = { run("It is on its way.") { api.sendNow(send.id) } },
      )
    }
    SendDialog.FOLLOW_UP -> {
      LaunchedEffect(send.id) { reaching = runCatching { api.followUpCount(send.id) }.getOrNull() ?: 0 }
      ActionDialog(
        title = "Send this email to more people?",
        body = reaching?.let { "This sends the same email to ${people(it)} more in the same audience. The ${grouped(send.display.progress.reached)} who already received it are not sent it again, and its report adds the new figures." } ?: "Counting who is new…",
        icon = "send",
        confirmLabel = "Send",
        confirmEnabled = (reaching ?: 0) > 0,
        busy = busy,
        error = error ?: if (reaching == 0L) "Everyone in the audience has it already." else null,
        onDismiss = onClose,
        onConfirm = { run("It is on its way to the rest.") { api.followUp(send.id) } },
      )
    }
    SendDialog.CANCEL -> ActionDialog(
      title = if (send.midFlight) "Stop sending this email?" else "Cancel this scheduled email?",
      body = if (send.midFlight) {
        "It has reached ${people(send.display.progress.reached)} so far, and stopping it leaves ${grouped(send.display.progress.remaining)} unaddressed. What has gone out cannot be taken back. A stopped send cannot be resumed."
      } else {
        "It will not be sent at the time it is scheduled for. The email is kept, but a canceled email cannot be put back on the schedule."
      },
      icon = "cancel",
      confirmLabel = if (send.midFlight) "Stop sending" else "Cancel send",
      dismissLabel = "Keep it",
      destructive = true,
      busy = busy,
      error = error,
      onDismiss = onClose,
      onConfirm = { run(if (send.midFlight) "Sending stopped." else "Canceled.") { api.cancel(send.id) } },
    )
    SendDialog.RENAME -> {
      var name by remember { mutableStateOf((send.data["displayName"] as? String) ?: send.subject) }
      ActionDialog(
        title = "Rename this email",
        body = "The name is what your lists show; recipients see the subject.",
        confirmLabel = "Save",
        confirmEnabled = name.isNotBlank(),
        busy = busy,
        error = error,
        onDismiss = onClose,
        onConfirm = { run("Renamed.") { api.rename(send.id, name.trim()) } },
      ) { OutlinedTextField(name, { name = it.take(120) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth()) }
    }
    SendDialog.TEST -> {
      var proofs by remember { mutableStateOf<Proofs?>(null) }
      var to by remember { mutableStateOf("") }
      var persona by remember { mutableStateOf("") }
      LaunchedEffect(send.id) {
        proofs = runCatching { api.proofOptions() }.getOrElse { Proofs(emptyList(), emptyList()) }
        to = proofs?.recipients?.firstOrNull().orEmpty()
      }
      ActionDialog(
        title = "Send a test",
        body = "A test goes to one of these addresses only, and records nothing.",
        icon = "mail",
        confirmLabel = "Send test",
        confirmEnabled = to.isNotBlank(),
        busy = busy,
        error = error,
        onDismiss = onClose,
        onConfirm = { run("Test sent to $to.") { api.test(testMessageOf(send), to, persona.ifEmpty { null }) } },
      ) {
        val loaded = proofs
        if (loaded == null) SkeletonList(rows = 2) else {
          FieldEditor(FieldSpec("to", "Send to", FieldKind.SELECT, required = true, options = loaded.recipients.map { FieldOption(it, it) }, emptyLabel = null), to, { to = it })
          FieldEditor(
            FieldSpec("persona", "Show it as", FieldKind.SELECT, options = loaded.personas.map { FieldOption(it.first, it.second) }, emptyLabel = "Nobody in particular", help = "Whose details fill the email. They are sent nothing."),
            persona,
            { persona = it },
          )
        }
      }
    }
    SendDialog.EDIT -> ComposeDialog(context, send, onDismiss = onClose)
  }
}
