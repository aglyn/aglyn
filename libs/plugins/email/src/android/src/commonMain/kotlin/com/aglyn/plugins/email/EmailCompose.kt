package com.aglyn.plugins.email

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
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
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.localDateTimeMillis
import com.aglyn.core.localDayAndTime
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.Busy
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldOption
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.FormSheet
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.PropertyRow
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull

/*
 * WRITING AN EMAIL (the Apple plugin's `ComposeSheet`), as the console's
 * campaign composer posts it to `POST /api/campaigns/send`: one audience pick
 * packing kind and id, split once so the count and the send ask for the same
 * people; the count is the route's own `preview` dry run; a designed email
 * names its Besigner design and sends no body; Save draft is `draft` on an
 * existing email; Send is a send, or `schedule` with `sendAtMs`.
 */

/** The audience pick, as the composer stores it: `leads`, `members`, `list:{id}` or `segment:{id}`. */
data class AudiencePick(val raw: String) {
  val kind: String get() = when {
    raw.startsWith("segment:") -> "segment"
    raw.startsWith("list:") -> "list"
    else -> raw
  }
  val listId: String? get() = raw.takeIf { it.startsWith("list:") }?.removePrefix("list:")
  val segmentId: String? get() = raw.takeIf { it.startsWith("segment:") }?.removePrefix("segment:")

  /** What the confirm names a person in this audience. */
  val personLabel: String get() = when (kind) {
    "leads" -> "lead"
    "members" -> "site member"
    "list" -> "list subscriber"
    else -> "contact in the segment"
  }

  companion object {
    fun stored(data: Map<String, Any?>): AudiencePick? {
      val audience = (data["audience"] as? String)?.takeIf { it.isNotEmpty() } ?: return null
      val list = (data["listId"] as? String)?.takeIf { it.isNotEmpty() }
      val segment = (data["segmentId"] as? String)?.takeIf { it.isNotEmpty() }
      return when {
        audience == "list" && list != null -> AudiencePick("list:$list")
        audience == "segment" && segment != null -> AudiencePick("segment:$segment")
        else -> AudiencePick(audience)
      }
    }
  }
}

/** The dry run's answer: who this send reaches. */
data class AudiencePreview(
  val sendable: Long = 0,
  val audienceSize: Long = 0,
  val audienceTruncated: Boolean = false,
  val suppressed: Long = 0,
  val consentWithheld: Long = 0,
  val blocking: Boolean = false,
  val error: String? = null,
)

data class ComposeDraft(
  val subject: String = "",
  val preheader: String = "",
  val fromName: String = "",
  val replyTo: String = "",
  val senderId: String = "",
  val topicId: String = "",
  val audience: AudiencePick = AudiencePick("leads"),
  val designed: Boolean = false,
  val templateScreenId: String = "",
  val body: String = "",
  val schedule: Boolean = false,
  val sendDay: String = "",
  val sendTime: String = "09:00",
  val campaignId: String = "",
) {
  val messageReady: Boolean get() = if (designed) templateScreenId.isNotEmpty() else body.isNotBlank()
  val canSend: Boolean get() = subject.isNotBlank() && messageReady
  val sendAtMs: Long? get() = if (schedule) localDateTimeMillis(sendDay, sendTime) else null

  /** The fields every request that resolves the audience carries. */
  fun audienceFields(): Map<String, Any?> = buildMap {
    put("audience", audience.kind)
    audience.listId?.let { put("listId", it) }
    audience.segmentId?.let { put("segmentId", it) }
    if (topicId.isNotEmpty()) put("topicId", topicId)
    if (senderId.isNotEmpty()) put("senderId", senderId)
  }

  /** The message itself, as `draft`, `send` and `schedule` post it. */
  fun messageFields(): Map<String, Any?> = audienceFields() + buildMap {
    put("subject", subject.trim())
    put("body", if (designed) "" else body.trim())
    if (designed && templateScreenId.isNotEmpty()) put("templateScreenId", templateScreenId)
    if (campaignId.isNotEmpty()) put("emailCampaignId", campaignId)
    put("fromName", fromName.trim())
    put("replyTo", replyTo.trim())
    put("preheader", preheader.trim())
  }

  companion object {
    fun of(send: EmailSend): ComposeDraft {
      fun text(key: String) = (send.data[key] as? String).orEmpty()
      val template = text("templateScreenId")
      val scheduled = send.status == "scheduled" && send.sendAtMs != null
      val (day, time) = send.sendAtMs?.let(::localDayAndTime) ?: ("" to "09:00")
      return ComposeDraft(
        subject = text("subject"),
        preheader = text("preheader"),
        fromName = text("fromName"),
        replyTo = text("replyTo"),
        senderId = text("senderId"),
        topicId = text("topicId"),
        audience = AudiencePick.stored(send.data) ?: AudiencePick("leads"),
        designed = template.isNotEmpty(),
        templateScreenId = template,
        body = text("body"),
        schedule = scheduled,
        sendDay = if (scheduled) day else "",
        sendTime = if (scheduled) time else "09:00",
        campaignId = text("emailCampaignId"),
      )
    }
  }
}

/** What the confirm says: how many, of how many, or that the count could not be read. */
fun composeConfirmText(draft: ComposeDraft, preview: AudiencePreview?): String {
  val quoted = "“${draft.subject.trim()}”"
  val whenText = if (draft.schedule) " on ${draft.sendDay} at ${draft.sendTime}" else ""
  if (preview == null || preview.error != null) {
    val reason = preview?.error?.let { " ($it)" }.orEmpty()
    return "$quoted goes to every ${draft.audience.personLabel} who hasn't unsubscribed$whenText. The recipient count could not be read$reason, so how many that is is not known."
  }
  val people = if (preview.sendable == 1L) draft.audience.personLabel else "${draft.audience.personLabel}s"
  return if (preview.sendable < preview.audienceSize) {
    "$quoted goes to ${grouped(preview.sendable)} of ${grouped(preview.audienceSize)} $people$whenText. The rest are not sent this email."
  } else {
    "$quoted goes to ${grouped(preview.sendable)} $people$whenText."
  }
}

private fun JsonObject?.long(key: String): Long = (this?.get(key) as? JsonPrimitive)?.longOrNull ?: 0L

/** The route's `preview` dry run for this draft's audience. */
suspend fun CampaignSendApi.preview(draft: ComposeDraft): AudiencePreview = try {
  val answer = composeRaw(draft.audienceFields() + ("action" to "preview"))
  AudiencePreview(
    sendable = answer.long("sendable"),
    audienceSize = answer.long("audienceSize"),
    audienceTruncated = (answer?.get("audienceTruncated") as? JsonPrimitive)?.booleanOrNull == true,
    suppressed = answer.long("suppressed"),
    consentWithheld = answer.long("consentWithheld"),
  )
} catch (error: ConsoleApiError) {
  AudiencePreview(blocking = error.status == 409, error = error.message)
} catch (error: Exception) {
  if (error is kotlinx.coroutines.CancellationException) throw error
  AudiencePreview(error = problemText(error))
}

private fun nameOf(doc: FirestoreDoc, key: String): String = doc.string(key)?.takeIf { it.isNotEmpty() } ?: doc.id

/** Writes a new email, or edits a draft or scheduled one, the way the console's composer does. */
@Composable
fun ComposeDialog(context: NativePluginContext, send: EmailSend?, onDismiss: () -> Unit, siteName: String? = null) {
  val orgId = context.orgId ?: return
  val hostId = context.hostId ?: return
  val coroutines = rememberCoroutineScope()
  val busy = remember { Busy() }
  val api = remember(hostId, context.api) { CampaignSendApi(context.api, hostId) }
  var draft by remember {
    mutableStateOf(send?.let(ComposeDraft::of) ?: ComposeDraft(fromName = siteName.orEmpty()))
  }
  var preview by remember { mutableStateOf<AudiencePreview?>(null) }
  var confirming by remember { mutableStateOf(false) }

  fun observe(path: String, limit: Int) = context.firestore.observe(FirestoreQuery(path, limit = limit))
  val designs by remember(hostId) { observe("hosts/$hostId/screens", 200) }.collectAsState(Live.Loading)
  var senders by remember { mutableStateOf<List<SenderRow>>(emptyList()) }
  LaunchedEffect(orgId, hostId) {
    senders = runCatching { EmailActions(context, orgId, hostId).identity().senders }.getOrDefault(emptyList())
  }
  val lists by remember(orgId) { observe("orgs/$orgId/lists", 50) }.collectAsState(Live.Loading)
  val segments by remember(orgId) { observe("orgs/$orgId/contactSegments", 50) }.collectAsState(Live.Loading)
  val topics by remember(orgId) { observe("orgs/$orgId/emailTopics", 50) }.collectAsState(Live.Loading)
  fun rows(live: Live<List<FirestoreDoc>>) = (live as? Live.Ready)?.value.orEmpty()

  val emailDesigns = rows(designs).filter { it.string("kind") == "email" && it.data["deletedAt"] == null }
    .sortedBy { (it.string("displayName") ?: "").lowercase() }
  val audienceOptions = listOf(FieldOption("leads", "Leads"), FieldOption("members", "Site members")) +
    rows(lists).sortedBy { nameOf(it, "name").lowercase() }.map { FieldOption("list:${it.id}", "List: ${nameOf(it, "name")}") } +
    rows(segments).sortedBy { nameOf(it, "name").lowercase() }.map { FieldOption("segment:${it.id}", "Segment: ${nameOf(it, "name")}") }
  val topicOptions = rows(topics).filter { it.data["archived"] != true }.sortedBy { nameOf(it, "name").lowercase() }
  val senderOptions = senders.map { sender ->
    val label = listOfNotNull(sender.fromName, sender.from).filter { it.isNotEmpty() }.joinToString(" · ")
    FieldOption(sender.id, label.ifEmpty { sender.localPart })
  }

  LaunchedEffect(draft.audience, draft.topicId, draft.senderId) {
    preview = null
    delay(350)
    preview = api.preview(draft)
  }

  fun fields(action: String?): Map<String, Any?> = draft.messageFields() + buildMap {
    if (action != null) put("action", action)
    if (send != null) put("campaignId", send.id)
  }

  FormSheet(
    title = if (send == null) "Write an email" else "Edit email",
    busy = busy,
    onDismiss = onDismiss,
    confirmLabel = if (draft.schedule) "Schedule" else "Send",
    confirmEnabled = draft.canSend && preview?.blocking != true,
    modifier = Modifier.testTag("email-compose"),
    secondary = if (send != null) ({
      OutlinedButton(
        onClick = { busy.run(coroutines, onDone = onDismiss) { api.compose("draft", fields(null)) } },
        enabled = !busy.busy,
        modifier = Modifier.testTag("compose-save-draft"),
      ) { Text("Save draft") }
    }) else null,
    onConfirm = {
      val at = draft.sendAtMs
      if (draft.schedule && (at == null || at <= nowMillis())) busy.error = "Pick a future send time." else confirming = true
    },
  ) {
    FieldEditor(FieldSpec("subject", "Subject", required = true), draft.subject, { draft = draft.copy(subject = it) })
    FieldEditor(FieldSpec("preheader", "Preview text"), draft.preheader, { draft = draft.copy(preheader = it) })
    ChoiceChipRow(listOf(ChipOption("plain", "Plain message"), ChipOption("designed", "Designed email")), if (draft.designed) "designed" else "plain", {
      draft = draft.copy(designed = it == "designed")
    })
    if (draft.designed) {
      FieldEditor(
        FieldSpec("design", "Design", FieldKind.SELECT, options = emailDesigns.map { FieldOption(it.id, it.string("displayName") ?: "Untitled email") }, emptyLabel = "Choose a design"),
        draft.templateScreenId,
        { draft = draft.copy(templateScreenId = it) },
      )
      val chosen = emailDesigns.firstOrNull { it.id == draft.templateScreenId }
      val version = chosen?.string("versionId")
      if (chosen != null && version != null) {
        OutlinedButton(onClick = { context.openBesigner("/screens/${chosen.id}/versions/$version/besigner") }) { Text("Edit design") }
      }
      if (emailDesigns.isEmpty()) {
        Text("This site has no email designs yet. Make one under Templates.", style = MaterialTheme.typography.bodySmall)
      }
    } else {
      FieldEditor(FieldSpec("body", "Message", FieldKind.MULTILINE, required = true), draft.body, { draft = draft.copy(body = it) })
    }
    FieldEditor(
      FieldSpec("audience", "Send to", FieldKind.SELECT, options = audienceOptions, emptyLabel = null),
      draft.audience.raw,
      { draft = draft.copy(audience = AudiencePick(it)) },
    )
    if (topicOptions.isNotEmpty()) {
      FieldEditor(
        FieldSpec("topic", "Topic", FieldKind.SELECT, options = topicOptions.map { FieldOption(it.id, nameOf(it, "name")) }, emptyLabel = "Marketing"),
        draft.topicId,
        { draft = draft.copy(topicId = it) },
      )
    }
    val reach = preview
    when {
      reach == null -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        CircularProgressIndicator()
        Text("Counting who it reaches…")
      }
      reach.error != null -> NoticeBanner(reach.error, if (reach.blocking) StatusTone.ERROR else StatusTone.INFO)
      else -> {
        PropertyRow("Reaches", "${grouped(reach.sendable)} of ${grouped(reach.audienceSize)}${if (reach.audienceTruncated) "+" else ""}", Modifier.testTag("compose-reach"))
        if (reach.suppressed > 0) PropertyRow("Suppressed", grouped(reach.suppressed))
        if (reach.consentWithheld > 0) PropertyRow("No consent basis", grouped(reach.consentWithheld))
      }
    }
    if (senderOptions.isNotEmpty()) {
      FieldEditor(
        FieldSpec("sender", "Sender", FieldKind.SELECT, options = senderOptions, emptyLabel = "The site's default"),
        draft.senderId,
        { draft = draft.copy(senderId = it) },
      )
    }
    FieldEditor(FieldSpec("fromName", "From name"), draft.fromName, { draft = draft.copy(fromName = it) })
    FieldEditor(FieldSpec("replyTo", "Reply to", FieldKind.EMAIL), draft.replyTo, { draft = draft.copy(replyTo = it) })
    SwitchRow("Schedule it", draft.schedule, { on ->
      val tomorrow = localDayAndTime(nowMillis() + 86_400_000L).first
      draft = draft.copy(schedule = on, sendDay = draft.sendDay.ifEmpty { tomorrow })
    })
    if (draft.schedule) {
      FieldEditor(FieldSpec("sendDay", "Send on", FieldKind.DATE, required = true), draft.sendDay, { draft = draft.copy(sendDay = it) })
      FieldEditor(FieldSpec("sendTime", "At", FieldKind.TIME, required = true), draft.sendTime, { draft = draft.copy(sendTime = it) })
    }
    Text(
      "Who it reaches is counted the way the send counts it: after consent, suppressions and the monthly allowance.",
      style = MaterialTheme.typography.bodySmall,
    )
  }

  if (confirming) {
    com.aglyn.ui.ActionDialog(
      title = if (draft.schedule) "Schedule this campaign?" else "Send this campaign?",
      body = composeConfirmText(draft, preview),
      confirmLabel = if (draft.schedule) "Schedule" else "Send",
      busy = busy.busy,
      error = busy.error,
      onDismiss = { confirming = false },
      onConfirm = {
        val all = fields(if (draft.schedule) "schedule" else null) + (draft.sendAtMs?.let { mapOf("sendAtMs" to it) } ?: emptyMap())
        busy.run(coroutines, onDone = { confirming = false; onDismiss() }) { api.composeRaw(all) }
      },
    )
  }
}
