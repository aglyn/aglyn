package com.aglyn.plugins.outreach

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.Contracts
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.listquery.nameSearchToken
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.Busy
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldOption
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.FormSheet
import com.aglyn.ui.LiveListPane
import com.aglyn.ui.LiveQueryList
import com.aglyn.ui.MenuAction
import com.aglyn.ui.MetricCard
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.PropertyRow
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.problemMessage
import com.aglyn.ui.space
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/** Whether the console would show the Outreach tab to this member: null while it is still reading. */
@Composable
fun rememberOutreachOpen(context: NativePluginContext): Boolean? {
  val orgId = context.orgId ?: return false
  val org = remember(orgId) { context.firestore.observeDoc("orgs/$orgId") }.collectAsState(Live.Loading).value
  val member = remember(orgId) { context.firestore.observeDoc("orgs/$orgId/members/${context.uid}") }.collectAsState(Live.Loading).value
  val roleId = (member as? Live.Ready)?.value?.string("roleId")
  val role = remember(orgId, roleId) { context.firestore.observeDoc("orgs/$orgId/roles/${roleId ?: "-"}") }.collectAsState(Live.Loading).value
  val staff by produceState<Boolean?>(null, context) { value = (context.api.claims()["staff"] as? JsonPrimitive)?.booleanOrNull == true }
  if (org is Live.Loading || member is Live.Loading || staff == null) return null
  return outreachOpen((org as? Live.Ready)?.value?.data, orgId, (member as? Live.Ready)?.value?.data, if (roleId != null) (role as? Live.Ready)?.value?.data else null, staff == true)
}

/** The Outreach hub, behind the console's three gates; nothing of it shows where the console shows nothing. */
@Composable
fun OutreachHubScreen(context: NativePluginContext, initialSection: OutreachSection, initial: String?) {
  val orgId = context.orgId ?: return
  val open = rememberOutreachOpen(context)
  var section by rememberSaveable { mutableStateOf(initialSection) }
  val api = remember(orgId, context.api) { OutreachApi(context.api, orgId) }
  when (open) {
    null -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    false -> EmptyState("Not available", body = "This workspace does not have this area.", icon = AglynIcons.named("lock"))
    true -> Column(Modifier.fillMaxSize()) {
      ChoiceChipRow(OutreachSection.entries.map { ChipOption(it.name, it.label, it.icon) }, section.name, { section = OutreachSection.valueOf(it) }, Modifier.padding(horizontal = space(2f), vertical = space(1f)))
      when (section) {
        OutreachSection.SEQUENCES -> SequencesSection(context, api, initial)
        OutreachSection.MAILBOXES -> MailboxesSection(context, api)
        OutreachSection.COMPLIANCE -> ComplianceSection(context, api)
      }
    }
  }
}

/** Home's Sequences card, drawn only where the console shows the Outreach tab (nothing at all otherwise). */
@Composable
fun OutreachGlanceWidget(context: NativePluginContext) {
  val orgId = context.orgId ?: return
  if (rememberOutreachOpen(context) != true) return
  val active by remember(orgId) { context.firestore.observe(sequencesQuery(orgId, "active", "", 51)) }.collectAsState(Live.Loading)
  val rows = (active as? Live.Ready)?.value
  MetricCard("Sequences", rows?.let { if (it.size > 50) "50+" else it.size.toString() }, if (rows?.size == 1) "sequence sending" else "sequences sending", "timeline", "Open sequences", loading = rows == null) {
    context.navigate(OUTREACH_SEQUENCES_SCREEN)
  }
}

/*---------- sequences ----------*/

@Composable
fun SequencesSection(context: NativePluginContext, api: OutreachApi, initial: String?) {
  val scope = rememberCoroutineScope()
  val list = remember { LiveQueryList(context.firestore, scope, 25, ::sequenceRowOf) }
  val mailboxes = (remember { context.firestore.observe(FirestoreQuery("orgs/${api.orgId}/outreachMailboxes", limit = 50)) }.collectAsState(Live.Loading).value as? Live.Ready)?.value.orEmpty().map(::mailboxRowOf)
  var status by rememberSaveable { mutableStateOf("") }
  var search by rememberSaveable { mutableStateOf("") }
  var asked by rememberSaveable { mutableStateOf("") }
  var creating by remember { mutableStateOf(false) }
  LaunchedEffect(list, status, asked) { list.show { sequencesQuery(api.orgId, status, asked, it) } }
  AglynListDetail(
    initialSelected = initial,
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = space(2f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = "Search sequences", modifier = Modifier.weight(1f), onSearch = { asked = search })
          Button(onClick = { creating = true }, modifier = Modifier.testTag("sequence-new")) { Text("New sequence") }
        }
        ChoiceChipRow(listOf(ChipOption("", "All")) + SEQUENCE_STATUS_LABELS.map { ChipOption(it.key, it.value) }, status, { status = it }, Modifier.padding(space(2f)))
        LiveListPane(
          list,
          key = { it.id },
          failed = "Could not load sequences",
          empty = { EmptyState("No sequences yet", body = "A sequence sends a few one-to-one emails and tasks, spaced out, until someone replies.", icon = AglynIcons.named("timeline")) },
        ) { row ->
          val mailbox = mailboxes.firstOrNull { it.id == row.mailboxId }
          AglynListItem(
            title = row.name,
            supporting = "${row.steps.size} steps · ${mailbox?.sendAs ?: mailbox?.email ?: "No mailbox"}",
            icon = AglynIcons.named("timeline"),
            selected = row.id == selected,
            onClick = { onSelect(row.id) },
            trailing = { StatusChip(SEQUENCE_STATUS_LABELS[row.status] ?: row.status, if (row.status == "active") StatusTone.SUCCESS else if (row.status == "paused") StatusTone.WARNING else StatusTone.NEUTRAL) },
            modifier = Modifier.testTag("sequence-${row.id}"),
          )
        }
      }
    },
    detail = { selected ->
      if (selected == null) EmptyState("Pick a sequence", icon = AglynIcons.named("timeline")) else SequenceDetail(context, api, selected, mailboxes)
    },
  )
  if (creating) SequenceEditor(context, api, null, mailboxes) { creating = false }
}

@Composable
fun SequenceDetail(context: NativePluginContext, api: OutreachApi, sequenceId: String, mailboxes: List<MailboxRow>) {
  val scope = rememberCoroutineScope()
  val doc by remember(sequenceId) { context.firestore.observeDoc("orgs/${api.orgId}/outreachSequences/$sequenceId") }.collectAsState(Live.Loading)
  val enrollments = remember(sequenceId) { LiveQueryList(context.firestore, scope, 25, ::enrollmentRowOf) }
  var editing by remember { mutableStateOf(false) }
  var enrolling by remember { mutableStateOf(false) }
  var confirm by remember { mutableStateOf<Pair<String, String>?>(null) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var gone by remember(sequenceId) { mutableStateOf(false) }
  val busy = remember { Busy() }
  LaunchedEffect(enrollments) { enrollments.show { enrollmentsQuery(api.orgId, sequenceId, it) } }
  val value = doc
  if (gone || (value is Live.Ready && value.value == null)) {
    EmptyState("This sequence is gone", icon = AglynIcons.named("timeline"))
    return
  }
  val row = (value as? Live.Ready)?.value?.let(::sequenceRowOf) ?: return
  fun act(enrollmentId: String, action: String) = Busy().run(scope) {
    try {
      api.enrollmentAction(enrollmentId, action)
    } catch (failure: Exception) {
      if (failure is kotlinx.coroutines.CancellationException) throw failure
      notice = problemMessage(failure) to StatusTone.ERROR
    }
  }
  val now = remember { nowMillis() }
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(row.name, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
      StatusChip(SEQUENCE_STATUS_LABELS[row.status] ?: row.status, if (row.status == "active") StatusTone.SUCCESS else StatusTone.NEUTRAL)
      OverflowMenu(listOf(MenuAction("Edit") { editing = true }) + if (row.status == "draft") listOf(MenuAction("Delete", destructive = true) { confirm = "Delete this sequence?" to "delete" }) else emptyList())
    }
    notice?.let { NoticeBanner(it.first, it.second) }
    SectionCard(null) {
      PropertyRow("Sends from", mailboxes.firstOrNull { it.id == row.mailboxId }?.let { it.sendAs ?: it.email })
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        if (row.status == "draft" || row.status == "paused") Button(onClick = { confirm = "Activate this sequence?" to "activate" }) { Text("Activate") }
        if (row.status == "active") OutlinedButton(onClick = { confirm = "Pause this sequence?" to "pause" }) { Text("Pause") }
        if (row.status != "archived") OutlinedButton(onClick = { confirm = "Archive this sequence?" to "archive" }) { Text("Archive") }
        if (row.status == "active") OutlinedButton(onClick = { enrolling = true }, modifier = Modifier.testTag("sequence-enroll")) { Text("Enroll people") }
      }
    }
    SectionCard("Steps") {
      row.steps.forEachIndexed { index, step ->
        AglynListItem(
          title = if (step.kind == "email") step.subject.ifEmpty { "Reply in thread" } else step.title,
          supporting = "Step ${index + 1} · ${if (step.kind == "email") "Email" else TASK_KIND_LABELS.firstOrNull { it.first == step.taskKind }?.second ?: "Task"} · wait ${step.delayBusinessDays.toInt()} business days",
          icon = AglynIcons.named(if (step.kind == "email") "mail" else "check_circle"),
        )
      }
    }
    SectionCard("Enrollments") {
      val rows = (enrollments.rows as? Live.Ready)?.value.orEmpty()
      if (rows.isEmpty()) Text("Nobody is enrolled yet.", style = MaterialTheme.typography.bodyMedium)
      for (enrollment in rows) {
        AglynListItem(
          title = enrollment.name,
          supporting = listOfNotNull(enrollment.email.ifEmpty { null }, "step ${enrollment.stepIndex + 1}", enrollment.nextDueAtMs?.let { "next ${relativeTime(it, now)}" }, enrollment.stopReason).joinToString(" · "),
          icon = AglynIcons.named("person"),
          trailing = {
            Row(verticalAlignment = Alignment.CenterVertically) {
              StatusChip(ENROLLMENT_STATUS_LABELS[enrollment.status] ?: enrollment.status, StatusTone.NEUTRAL)
              OverflowMenu(buildList {
                if (enrollment.status == "active") add(MenuAction("Pause") { act(enrollment.id, "pause") })
                if (enrollment.status == "paused") add(MenuAction("Resume") { act(enrollment.id, "resume") })
                if (enrollment.status in listOf("active", "paused")) add(MenuAction("Stop", destructive = true) { act(enrollment.id, "stop") })
                add(MenuAction("Do not contact", destructive = true) { act(enrollment.id, "do_not_contact") })
              })
            }
          },
        )
      }
    }
  }
  if (editing) SequenceEditor(context, api, row, mailboxes) { editing = false }
  if (enrolling) EnrollSheet(context, api, sequenceId, { enrolling = false }) { notice = "Enrolled $it." to StatusTone.SUCCESS }
  confirm?.let { (title, action) ->
    ActionDialog(
      title = title,
      body = when (action) {
        "archive" -> "Everyone still enrolled is stopped. An archived sequence cannot be activated again."
        "pause" -> "Nobody is sent the next step until it is activated again."
        "delete" -> "It goes for good. Only a draft nobody was enrolled in can be deleted."
        else -> "Its steps start going out to the people enrolled."
      },
      confirmLabel = action.replaceFirstChar { it.uppercase() },
      destructive = action == "archive" || action == "delete",
      busy = busy.busy,
      error = busy.error,
      onDismiss = { confirm = null },
      onConfirm = {
        busy.run(scope, onDone = { confirm = null; if (action == "delete") gone = true }) {
          if (action == "delete") api.delete(sequenceId) else api.setStatus(sequenceId, action)
        }
      },
    )
  }
}

/** Write or edit a sequence: its name, mailbox and steps, checked as the console checks before the route does. */
@Composable
fun SequenceEditor(context: NativePluginContext, api: OutreachApi, sequence: SequenceRow?, mailboxes: List<MailboxRow>, onDismiss: () -> Unit) {
  val scope = rememberCoroutineScope()
  val busy = remember { Busy() }
  var name by remember { mutableStateOf(sequence?.name.orEmpty()) }
  var mailboxId by remember { mutableStateOf(sequence?.mailboxId ?: mailboxes.firstOrNull { it.status == "connected" }?.id.orEmpty()) }
  var steps by remember { mutableStateOf(sequence?.steps ?: listOf(SequenceStep.new("email", emptyList()))) }
  val countries by produceState(Contracts.outreachDefaultAllowedCountries) {
    val raw = (runCatching { api.get("settings") }.getOrNull()?.get("settings") as? JsonObject)?.get("allowedCountries") as? JsonArray
    raw?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }?.takeIf { it.isNotEmpty() }?.let { value = it }
  }
  val issues = validateSequence(name, mailboxId, steps)
  fun update(index: Int, change: (SequenceStep) -> SequenceStep) { steps = steps.toMutableList().also { it[index] = change(it[index]) } }
  val firstEmail = steps.indexOfFirst { it.kind == "email" }
  FormSheet(
    if (sequence == null) "New sequence" else "Edit sequence", busy, onDismiss,
    confirmEnabled = issues.isEmpty(),
    modifier = Modifier.testTag("sequence-editor"),
    onConfirm = {
      val hostId = sequence?.hostId ?: context.hostId
      if (hostId == null) {
        busy.error = "Pick a site first: a sequence sends for one of the workspace's sites."
      } else {
        @Suppress("UNCHECKED_CAST")
        val settings = sequence?.data?.get("settings") as? Map<String, Any?> ?: mapOf(
          "window" to null, "allowedCountries" to countries, "allowCustomers" to false, "trackClicks" to false, "countOpens" to false, "listUnsubscribe" to false,
        )
        @Suppress("UNCHECKED_CAST")
        val campaigns = (sequence?.data?.get("campaignIds") as? List<String>).orEmpty()
        busy.run(scope, onDone = onDismiss) { api.save(sequence?.id, name.trim(), hostId, mailboxId, steps, settings, campaigns) }
      }
    },
  ) {
    FieldEditor(FieldSpec("name", "Name", required = true), name, { name = it })
    FieldEditor(
      FieldSpec("mailbox", "Sends from", FieldKind.SELECT, options = mailboxes.filter { it.status != "disconnected" }.map { FieldOption(it.id, it.sendAs ?: it.email) }, emptyLabel = "Choose a mailbox"),
      mailboxId, { mailboxId = it },
    )
    steps.forEachIndexed { index, step ->
      Text("Step ${index + 1} · ${if (step.kind == "email") "Email" else "Task"}", style = MaterialTheme.typography.titleSmall)
      if (step.kind == "email") {
        if (index > firstEmail) SwitchRow("Reply in the same thread", step.replyInThread, { on -> update(index) { it.copy(replyInThread = on) } })
        FieldEditor(FieldSpec("subject-$index", "Subject"), step.subject, { v -> update(index) { it.copy(subject = v) } })
        FieldEditor(FieldSpec("body-$index", "Email", FieldKind.MULTILINE), step.body, { v -> update(index) { it.copy(body = v) } })
      } else {
        FieldEditor(FieldSpec("task-$index", "Task", FieldKind.SELECT, options = TASK_KIND_LABELS.map { FieldOption(it.first, it.second) }, emptyLabel = null), step.taskKind, { v -> update(index) { it.copy(taskKind = v) } })
        FieldEditor(FieldSpec("title-$index", "Title"), step.title, { v -> update(index) { it.copy(title = v) } })
      }
      FieldEditor(FieldSpec("delay-$index", "Wait (business days)", FieldKind.NUMBER), step.delayBusinessDays.toInt().toString(), { v -> v.toDoubleOrNull()?.let { d -> update(index) { it.copy(delayBusinessDays = d) } } })
      for (issue in issues.filter { it.path.startsWith("steps.$index.") }) Text(issue.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
      TextButton(onClick = { steps = steps.filterIndexed { i, _ -> i != index } }) { Text("Remove this step") }
    }
    if (steps.size < Contracts.outreachMaxSteps) {
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedButton(onClick = { steps = steps + SequenceStep.new("email", steps) }) { Text("Add an email") }
        for ((kind, label) in TASK_KIND_LABELS) TextButton(onClick = { steps = steps + SequenceStep.new("task", steps, kind) }) { Text(label) }
      }
    }
    Text(issues.firstOrNull { !it.path.startsWith("steps.") }?.message ?: "Use {{enrollment.personalLine}} in the first email for the line written for each person.", style = MaterialTheme.typography.bodySmall)
  }
}

/** Enroll CRM contacts or leads: search, pick, the route's preview of where each stands, then enroll. */
@Composable
fun EnrollSheet(context: NativePluginContext, api: OutreachApi, sequenceId: String, onDismiss: () -> Unit, onEnrolled: (Long) -> Unit) {
  val scope = rememberCoroutineScope()
  val busy = remember { Busy() }
  var kind by remember { mutableStateOf("contacts") }
  var search by remember { mutableStateOf("") }
  var asked by remember { mutableStateOf("") }
  var picked by remember { mutableStateOf(setOf<String>()) }
  var preview by remember { mutableStateOf<List<PreviewPerson>?>(null) }
  var lines by remember { mutableStateOf(mapOf<String, String>()) }
  var attested by remember { mutableStateOf(setOf<String>()) }
  val results by remember(kind, asked) {
    val token = nameSearchToken(asked)
    context.firestore.observe(FirestoreQuery("orgs/${api.orgId}/$kind", if (asked.isBlank()) emptyList() else listOf(FirestoreFilter("nameTokens", FilterOp.ARRAY_CONTAINS, token)), limit = 25))
  }.collectAsState(Live.Loading)
  val ready = preview.orEmpty().filter { p ->
    p.status != "blocked" && (!p.needsPersonalLine || !lines[p.personId].isNullOrBlank()) && (p.attestations.isEmpty() || p.personId in attested)
  }
  FormSheet(
    "Enroll people", busy, onDismiss,
    confirmLabel = if (preview == null) "Check" else "Enroll",
    confirmEnabled = if (preview == null) picked.isNotEmpty() && picked.size <= 50 else ready.isNotEmpty(),
    onConfirm = {
      if (preview == null) {
        busy.run(scope) { preview = api.preview(sequenceId, kind, picked.toList()) }
      } else {
        val people = ready.map { p ->
          buildMap<String, Any?> {
            p.contactId?.let { put("contactId", it) } ?: p.leadId?.let { put("leadId", it) }
            lines[p.personId]?.takeIf { it.isNotBlank() }?.let { put("personalLine", it) }
            if (p.attestations.isNotEmpty()) put("attestations", p.attestations)
          }
        }
        busy.run(scope, onDone = onDismiss) { onEnrolled(api.enroll(sequenceId, people)) }
      }
    },
  ) {
    val checked = preview
    if (checked == null) {
      ChoiceChipRow(listOf(ChipOption("contacts", "Contacts"), ChipOption("leads", "Leads")), kind, { kind = it; picked = emptySet() })
      SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = "Search by name", onSearch = { asked = search })
      for (doc in (results as? Live.Ready)?.value.orEmpty()) {
        SwitchRow(doc.string("name") ?: doc.string("email") ?: doc.id, doc.id in picked, { on -> picked = if (on) picked + doc.id else picked - doc.id }, supporting = doc.string("email"))
      }
    } else {
      for (p in checked) {
        PropertyRow(p.name.ifEmpty { p.email }, p.status.replace('_', ' '))
        for (block in p.blocks) Text(block, style = MaterialTheme.typography.bodySmall)
        if (p.status != "blocked") {
          if (p.needsPersonalLine) FieldEditor(FieldSpec("line-${p.personId}", "A line written for them"), lines[p.personId].orEmpty(), { v -> lines = lines + (p.personId to v.take(300)) })
          if (p.attestations.isNotEmpty()) {
            SwitchRow("I confirm: ${p.attestations.joinToString(", ") { it.replace('_', ' ') }}", p.personId in attested, { on -> attested = if (on) attested + p.personId else attested - p.personId })
          }
        }
      }
    }
  }
}

/*---------- mailboxes ----------*/

@Composable
fun MailboxesSection(context: NativePluginContext, api: OutreachApi) {
  val scope = rememberCoroutineScope()
  val list = remember { LiveQueryList(context.firestore, scope, 50, ::mailboxRowOf) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var editing by remember { mutableStateOf<MailboxRow?>(null) }
  var disconnecting by remember { mutableStateOf<MailboxRow?>(null) }
  val busy = remember { Busy() }
  LaunchedEffect(list) { list.show { FirestoreQuery("orgs/${api.orgId}/outreachMailboxes", limit = it) } }
  fun run(done: String, block: suspend () -> String?) = Busy().run(scope) {
    try {
      notice = (block() ?: done) to StatusTone.SUCCESS
    } catch (failure: Exception) {
      if (failure is kotlinx.coroutines.CancellationException) throw failure
      notice = problemMessage(failure) to StatusTone.ERROR
    }
  }
  Column(Modifier.fillMaxSize()) {
    NoticeBanner("Connecting a new mailbox goes through Google's or Microsoft's own sign-in, which the Aglyn app on iPhone, iPad and Mac opens. Every connected mailbox is managed here.", StatusTone.INFO, Modifier.padding(horizontal = space(2f)))
    notice?.let { NoticeBanner(it.first, it.second, Modifier.padding(space(2f))) }
    LiveListPane(
      list,
      key = { it.id },
      failed = "Could not load mailboxes",
      empty = { EmptyState("No mailboxes yet", body = "A sequence sends from a connected Google or Microsoft mailbox.", icon = AglynIcons.named("inbox")) },
    ) { mailbox ->
      AglynListItem(
        title = mailbox.sendAs ?: mailbox.email,
        supporting = listOfNotNull(mailbox.displayName, mailbox.dailyCap?.let { "${mailbox.sentToday ?: 0} of $it today" }).joinToString(" · "),
        icon = AglynIcons.named("inbox"),
        trailing = {
          Row(verticalAlignment = Alignment.CenterVertically) {
            StatusChip(mailbox.status.replace('_', ' ').replaceFirstChar { it.uppercase() }, if (mailbox.status == "connected") StatusTone.SUCCESS else StatusTone.WARNING)
            OverflowMenu(buildList {
              if (mailbox.status == "connected") add(MenuAction("Pause") { run("Paused.") { api.mailboxStatus(mailbox.id, true); null } })
              if (mailbox.status == "paused") add(MenuAction("Resume") { run("Resumed.") { api.mailboxStatus(mailbox.id, false); null } })
              add(MenuAction("Settings") { editing = mailbox })
              add(MenuAction("Send a test") { run("Sent.") { "A test went to ${api.mailboxTest(mailbox.id) ?: mailbox.email}." } })
              add(MenuAction("Disconnect", destructive = true) { disconnecting = mailbox })
            })
          }
        },
      )
    }
  }
  editing?.let { mailbox ->
    val sheetBusy = remember(mailbox) { Busy() }
    var displayName by remember(mailbox) { mutableStateOf(mailbox.displayName.orEmpty()) }
    var cap by remember(mailbox) { mutableStateOf((mailbox.dailyCap ?: 20L).toString()) }
    FormSheet("Mailbox settings", sheetBusy, { editing = null }, confirmEnabled = (cap.toLongOrNull() ?: 0) >= 1, onConfirm = {
      sheetBusy.run(scope, onDone = { editing = null }) { api.mailboxSettings(mailbox.id, mapOf("displayName" to displayName.trim(), "dailyCap" to (cap.toLongOrNull() ?: 20L))) }
    }) {
      FieldEditor(FieldSpec("displayName", "Display name"), displayName, { displayName = it })
      FieldEditor(FieldSpec("dailyCap", "Emails a day, at most", FieldKind.NUMBER), cap, { cap = it })
    }
  }
  disconnecting?.let { mailbox ->
    ActionDialog(
      title = "Disconnect this mailbox?",
      body = "Sequences sending from it stop sending until another mailbox is chosen.",
      confirmLabel = "Disconnect",
      destructive = true,
      busy = busy.busy,
      error = busy.error,
      onDismiss = { disconnecting = null },
      onConfirm = { busy.run(scope, onDone = { disconnecting = null }) { api.mailboxDisconnect(mailbox.id) } },
    )
  }
}

/*---------- compliance ----------*/

@Composable
fun ComplianceSection(context: NativePluginContext, api: OutreachApi) {
  val scope = rememberCoroutineScope()
  var legalName by remember { mutableStateOf("") }
  var brandName by remember { mutableStateOf("") }
  var postal by remember { mutableStateOf("") }
  var countries by remember { mutableStateOf("") }
  var loaded by remember { mutableStateOf(false) }
  var links by remember { mutableStateOf(listOf<Pair<String, String>>()) }
  var newDomain by remember { mutableStateOf("") }
  var newLink by remember { mutableStateOf("") }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  val domains by remember { context.firestore.observe(doNotContactDomainsQuery(api.orgId, 50)) }.collectAsState(Live.Loading)
  suspend fun loadLinks() {
    links = ((api.get("link-domains")?.get("domains") as? JsonArray).orEmpty()).mapNotNull { element ->
      val o = element as? JsonObject ?: return@mapNotNull null
      val domain = (o["domain"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
      domain to ((o["status"] as? JsonPrimitive)?.contentOrNull ?: "not-set-up")
    }
  }
  LaunchedEffect(Unit) {
    runCatching {
      val settings = api.get("settings")?.get("settings") as? JsonObject
      fun s(key: String) = (settings?.get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
      legalName = s("legalName"); brandName = s("brandName"); postal = s("postalAddress")
      countries = (settings?.get("allowedCountries") as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.joinToString(", ")
    }
    loaded = true
    runCatching { loadLinks() }
  }
  fun run(done: String, block: suspend () -> Unit) = Busy().run(scope) {
    try {
      block()
      notice = done to StatusTone.SUCCESS
    } catch (failure: Exception) {
      if (failure is kotlinx.coroutines.CancellationException) throw failure
      notice = problemMessage(failure) to StatusTone.ERROR
    }
  }
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    notice?.let { NoticeBanner(it.first, it.second) }
    SectionCard("Who the emails come from") {
      FieldEditor(FieldSpec("legalName", "Legal name"), legalName, { legalName = it })
      FieldEditor(FieldSpec("brandName", "Brand name"), brandName, { brandName = it })
      FieldEditor(FieldSpec("postal", "Postal address", FieldKind.MULTILINE), postal, { postal = it })
      FieldEditor(FieldSpec("countries", "Countries it may send to (US, CA…)"), countries, { countries = it })
      Button(onClick = {
        run("Saved.") {
          api.post("settings", mapOf("legalName" to legalName.trim(), "brandName" to brandName.trim(), "postalAddress" to postal.trim(), "allowedCountries" to countries.split(',').map { it.trim().uppercase() }.filter { it.isNotEmpty() }))
        }
      }, enabled = loaded) { Text("Save") }
    }
    SectionCard("Do not contact") {
      for (doc in (domains as? Live.Ready)?.value.orEmpty()) {
        val domain = doc.string("domain") ?: doc.id
        AglynListItem(title = domain, supporting = doc.string("reason"), icon = AglynIcons.named("block"), trailing = {
          TextButton(onClick = { run("Removed.") { api.doNotContactDomain("remove", domain) } }) { Text("Remove") }
        })
      }
      Row(verticalAlignment = Alignment.CenterVertically) {
        FieldEditor(FieldSpec("domain", "example.com"), newDomain, { newDomain = it }, Modifier.weight(1f))
        TextButton(onClick = { val d = newDomain.trim(); newDomain = ""; run("Nobody at $d is enrolled from now on.") { api.doNotContactDomain("add", d) } }, enabled = newDomain.isNotBlank()) { Text("Add") }
      }
    }
    SectionCard("Link domains") {
      for ((domain, status) in links) {
        AglynListItem(title = domain, supporting = status.replace('-', ' ').replaceFirstChar { it.uppercase() }, icon = AglynIcons.named("link"), trailing = {
          OverflowMenu(listOf(
            MenuAction("Check") { run("Checked.") { api.linkDomain("check", domain); loadLinks() } },
            MenuAction("Remove", destructive = true) { run("Removed.") { api.linkDomain("remove", domain); loadLinks() } },
          ))
        })
      }
      Row(verticalAlignment = Alignment.CenterVertically) {
        FieldEditor(FieldSpec("link", "links.example.com"), newLink, { newLink = it }, Modifier.weight(1f))
        TextButton(onClick = { val d = newLink.trim(); newLink = ""; run("Set up. Add the records it lists at your DNS provider.") { api.linkDomain("set-up", d); loadLinks() } }, enabled = newLink.isNotBlank()) { Text("Set up") }
      }
    }
  }
}
