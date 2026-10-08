package com.aglyn.plugins.outreach

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.firestoreJson
import com.aglyn.core.listquery.newResourceId
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.core.planFeatureCarried
import com.aglyn.core.releaseFlagOn
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/*
 * SEQUENCES (the Apple plugin's `Outreach.swift`). Internal only: shown where
 * the console shows them and nowhere else, which is three gates at once: the
 * `release_outreach` release flag, the workspace's `outreach` feature, and the
 * member's `outreach.use` permission. Reads are the console's own list
 * declarations over `orgs/{orgId}/outreach*`; every write is an
 * `/api/outreach/...` route, each naming its org.
 */

const val OUTREACH_SEQUENCES_SCREEN = "outreach.sequences"

enum class OutreachSection(val key: String, val label: String, val icon: String) {
  SEQUENCES("sequences", "All sequences", "timeline"),
  MAILBOXES("mailboxes", "Mailboxes", "inbox"),
  COMPLIANCE("compliance", "Compliance", "verified");

  val screen: String get() = "outreach.$key"
}

fun outreachRoute(name: String) = "/api/outreach/$name"

/**
 * `outreach.use`, resolved as the console's `resolveOrgPermissions`: the
 * role's default (owner and admin yes, editor and viewer no), then the
 * member's custom role, then the member's own override.
 */
@Suppress("UNCHECKED_CAST")
fun outreachPermitted(member: Map<String, Any?>?, role: Map<String, Any?>?): Boolean {
  val name = member?.get("role") as? String ?: "viewer"
  var allowed = name == "owner" || name == "admin"
  if (member?.get("roleId") is String) ((role?.get("permissions") as? Map<String, Any?>)?.get("outreach.use") as? Boolean)?.let { allowed = it }
  ((member?.get("permissions") as? Map<String, Any?>)?.get("outreach.use") as? Boolean)?.let { allowed = it }
  return allowed
}

/** The three gates the console applies before it shows the Outreach tab. */
fun outreachOpen(org: Map<String, Any?>?, orgId: String?, member: Map<String, Any?>?, role: Map<String, Any?>?, staff: Boolean): Boolean =
  releaseFlagOn("release_outreach", org, orgId, staff) && planFeatureCarried(org, "outreach") && outreachPermitted(member, role)

private fun words(text: String) = text.trim().ifEmpty { null }?.let { listOf(it) }

fun sequencesQuery(orgId: String, status: String, search: String, limit: Int): FirestoreQuery = planListQuery(
  Contracts.outreachSequenceListQuery,
  ListQueryRequest(clauses = if (status.isEmpty()) emptyList() else listOf(ListFilterRequest("status", "equals", status)), search = words(search)),
).toFirestoreQuery("orgs/$orgId/outreachSequences", limit)

fun enrollmentsQuery(orgId: String, sequenceId: String, limit: Int): FirestoreQuery = planListQuery(
  Contracts.outreachEnrollmentListQuery,
  ListQueryRequest(base = listOf(ListQueryFilter(ListQueryOp.EQUAL, "sequenceId", JsonPrimitive(sequenceId))), clauses = emptyList()),
).toFirestoreQuery("orgs/$orgId/outreachEnrollments", limit)

fun doNotContactDomainsQuery(orgId: String, limit: Int): FirestoreQuery =
  planListQuery(Contracts.outreachDoNotContactDomainListQuery, ListQueryRequest(clauses = emptyList())).toFirestoreQuery("orgs/$orgId/outreachDoNotContactDomains", limit)

val SEQUENCE_STATUS_LABELS = mapOf("draft" to "Draft", "active" to "Active", "paused" to "Paused", "archived" to "Archived")
val ENROLLMENT_STATUS_LABELS = mapOf(
  "active" to "Active", "paused" to "Paused", "finished" to "Finished", "replied" to "Replied", "bounced" to "Bounced",
  "opted_out" to "Opted out", "stopped" to "Stopped", "failed" to "Failed",
)
val TASK_KIND_LABELS = listOf("linkedin" to "LinkedIn", "call" to "Call", "todo" to "To-do")

fun millisOf(raw: Any?): Long? = when (raw) {
  is Number -> raw.toLong()
  is FirestoreTimestamp -> raw.seconds * 1000 + raw.nanos / 1_000_000
  else -> null
}

/*---------- steps ----------*/

data class SequenceStep(
  val id: String,
  val kind: String,
  val delayBusinessDays: Double,
  val subject: String = "",
  val replyInThread: Boolean = true,
  val body: String = "",
  val templateId: String? = null,
  val taskKind: String = "todo",
  val title: String = "",
) {
  val stored: Map<String, Any?> get() = if (kind == "email") {
    mapOf("id" to id, "kind" to "email", "delayBusinessDays" to delayStored, "subject" to subject, "replyInThread" to replyInThread, "body" to body, "templateId" to templateId)
  } else {
    mapOf("id" to id, "kind" to "task", "taskKind" to taskKind, "title" to title, "delayBusinessDays" to delayStored)
  }

  private val delayStored: Any get() = if (delayBusinessDays % 1.0 == 0.0) delayBusinessDays.toLong() else delayBusinessDays

  companion object {
    fun of(raw: Map<String, Any?>) = SequenceStep(
      raw["id"] as? String ?: "", raw["kind"] as? String ?: "email", (raw["delayBusinessDays"] as? Number)?.toDouble() ?: 0.0,
      raw["subject"] as? String ?: "", raw["replyInThread"] as? Boolean ?: true, raw["body"] as? String ?: "", raw["templateId"] as? String,
      raw["taskKind"] as? String ?: "todo", raw["title"] as? String ?: "",
    )

    /** A new step as the editor adds one: the first email waits 0 days, a later one 3, a task 1. */
    fun new(kind: String, after: List<SequenceStep>, taskKind: String = "todo"): SequenceStep {
      val firstEmail = kind == "email" && after.none { it.kind == "email" }
      return SequenceStep(
        "step-${newResourceId(6).lowercase()}", kind, if (kind == "email") (if (firstEmail) 0.0 else 3.0) else 1.0,
        taskKind = taskKind, title = when (taskKind) { "linkedin" -> "Connect on LinkedIn"; "call" -> "Call"; else -> "" },
      )
    }
  }
}

data class Issue(val path: String, val code: String, val message: String)

private fun grouped(value: Int) = value.toString().reversed().chunked(3).joinToString(",").reversed()

/**
 * The errors of the console's `validateOutreachSequence` a save is held on,
 * before the route checks everything again (its warnings, the send window
 * and the reply prefix are the route's to answer).
 */
fun validateSequence(name: String, mailboxId: String, steps: List<SequenceStep>): List<Issue> {
  val c = Contracts
  val issues = mutableListOf<Issue>()
  if (name.isBlank()) issues += Issue("name", "name_required", "Name the sequence.")
  else if (name.length > c.outreachSequenceNameMax) issues += Issue("name", "name_too_long", "Keep the name under ${c.outreachSequenceNameMax} characters.")
  if (steps.any { it.kind == "email" } && mailboxId.isBlank()) issues += Issue("mailboxId", "mailbox_required", "Choose the mailbox this sequence sends from.")
  if (steps.isEmpty()) {
    issues += Issue("steps", "steps_required", "Add at least one step.")
    return issues
  }
  if (steps.size > c.outreachMaxSteps) issues += Issue("steps", "too_many_steps", "A sequence holds at most ${c.outreachMaxSteps} steps.")
  if (steps.count { it.kind == "email" } > c.outreachMaxEmailSteps) issues += Issue("steps", "too_many_email_steps", "A sequence sends at most ${c.outreachMaxEmailSteps} emails to one person.")
  val firstEmail = steps.indexOfFirst { it.kind == "email" }
  val seen = mutableSetOf<String>()
  steps.forEachIndexed { index, step ->
    val path = "steps.$index"
    val id = step.id.trim()
    if (id.isEmpty()) issues += Issue("$path.id", "step_id_required", "Every step needs an id.")
    else if (id in seen) issues += Issue("$path.id", "duplicate_step_id", "Two steps share an id.")
    seen += id
    if (step.kind != "email" && step.kind != "task") {
      issues += Issue(path, "unknown_step_kind", "A step is an email or a task.")
      return@forEachIndexed
    }
    val followsAnEmail = step.kind == "email" && index > firstEmail
    val min = if (followsAnEmail) c.outreachMinEmailFollowUpBusinessDays.toDouble() else 0.0
    val max = c.outreachMaxStepDelayBusinessDays.toDouble()
    val delay = step.delayBusinessDays
    if (!(delay % 1.0 == 0.0 && delay >= min && delay <= max)) {
      issues += Issue(
        "$path.delayBusinessDays", "delay_invalid",
        if (min > 0) "Wait ${min.toInt()}–${max.toInt()} business days before this email." else "Wait 0–${max.toInt()} business days before this step.",
      )
    }
    if (step.kind == "email") {
      val startsThread = !(index > firstEmail && step.replyInThread)
      if (startsThread) {
        if (step.subject.isBlank()) {
          issues += Issue("$path.subject", "subject_required", if (index == firstEmail) "The first email needs a subject." else "An email that starts a new thread needs a subject.")
        }
        if (step.subject.length > c.crmEmailSubjectMax) issues += Issue("$path.subject", "subject_too_long", "Keep the subject under ${c.crmEmailSubjectMax} characters.")
      }
      val hasBody = step.body.isNotBlank()
      val hasTemplate = !step.templateId.isNullOrBlank()
      if (hasBody && hasTemplate) issues += Issue("$path.body", "body_and_template", "Write the email here or pick a template, not both.")
      else if (!hasBody && !hasTemplate) issues += Issue("$path.body", "body_required", "Write the email, or pick a template.")
      if (step.body.length > c.crmEmailBodyMax) issues += Issue("$path.body", "body_too_long", "Keep the email under ${grouped(c.crmEmailBodyMax.toInt())} characters.")
    } else {
      if (step.taskKind !in TASK_KIND_LABELS.map { it.first }) issues += Issue("$path.taskKind", "task_kind_invalid", "Pick LinkedIn, Call or To-do.")
      if (step.title.isBlank()) issues += Issue("$path.title", "task_title_required", "Give the task a title.")
      else if (step.title.length > c.outreachTaskTitleMax) issues += Issue("$path.title", "task_title_too_long", "Keep the title under ${c.outreachTaskTitleMax} characters.")
    }
  }
  return issues
}

/*---------- rows ----------*/

data class SequenceRow(val id: String, val name: String, val status: String, val mailboxId: String?, val hostId: String?, val steps: List<SequenceStep>, val data: Map<String, Any?>)

@Suppress("UNCHECKED_CAST")
fun sequenceRowOf(doc: FirestoreDoc) = SequenceRow(
  doc.id, doc.string("name")?.takeIf { it.isNotEmpty() } ?: "Untitled", doc.string("status") ?: "draft", doc.string("mailboxId"), doc.string("hostId"),
  (doc.data["steps"] as? List<Map<String, Any?>>).orEmpty().map(SequenceStep::of), doc.data,
)

data class EnrollmentRow(val id: String, val name: String, val email: String, val status: String, val stepIndex: Long, val nextDueAtMs: Long?, val stopReason: String?)

fun enrollmentRowOf(doc: FirestoreDoc) = EnrollmentRow(
  doc.id, doc.string("contactName") ?: doc.string("email") ?: doc.id, doc.string("email").orEmpty(), doc.string("status") ?: "active",
  doc.long("stepIndex") ?: 0, millisOf(doc.data["nextDueAtMs"]), doc.string("stopReason"),
)

data class MailboxRow(val id: String, val email: String, val sendAs: String?, val displayName: String?, val status: String, val dailyCap: Long?, val sentToday: Long?)

@Suppress("UNCHECKED_CAST")
fun mailboxRowOf(doc: FirestoreDoc) = MailboxRow(
  doc.id, doc.string("email") ?: doc.id, doc.string("sendAs"), doc.string("displayName"), doc.string("status") ?: "connected", doc.long("dailyCap"),
  ((doc.data["health"] as? Map<String, Any?>)?.get("sentToday") as? Number)?.toLong(),
)

/*---------- writes ----------*/

data class PreviewPerson(
  val personId: String,
  val contactId: String?,
  val leadId: String?,
  val name: String,
  val email: String,
  val status: String,
  val blocks: List<String>,
  val needsPersonalLine: Boolean,
  val attestations: List<String>,
)

private fun JsonElement?.obj() = this as? JsonObject
private fun JsonObject?.str(key: String) = (this?.get(key) as? JsonPrimitive)?.contentOrNull
private fun JsonObject?.bool(key: String) = (this?.get(key) as? JsonPrimitive)?.booleanOrNull == true
private fun JsonObject?.arr(key: String) = (this?.get(key) as? JsonArray).orEmpty()

/** Every Outreach write, as the console's routes take it. */
class OutreachApi(private val api: ConsoleApiClient, val orgId: String) {
  suspend fun post(name: String, fields: Map<String, Any?>): JsonObject? =
    api.request(outreachRoute(name), ApiMethod.POST, firestoreJson((fields + ("orgId" to orgId)).filterValues { it != null })).obj()

  suspend fun get(name: String): JsonObject? = api.request(outreachRoute(name), query = mapOf("orgId" to orgId)).obj()

  suspend fun save(sequenceId: String?, name: String, hostId: String, mailboxId: String, steps: List<SequenceStep>, settings: Map<String, Any?>, campaignIds: List<String>): String? {
    val answer = post(
      "sequences/save",
      mapOf(
        "sequenceId" to sequenceId,
        "sequence" to mapOf("name" to name, "hostId" to hostId, "mailboxId" to mailboxId, "steps" to steps.map { it.stored }, "settings" to settings, "campaignIds" to campaignIds),
      ),
    )
    return (answer?.get("sequence") as? JsonObject).str("id") ?: sequenceId
  }

  suspend fun setStatus(sequenceId: String, action: String) { post("sequences/status", mapOf("sequenceId" to sequenceId, "action" to action)) }
  suspend fun delete(sequenceId: String) { post("sequences/delete", mapOf("sequenceId" to sequenceId)) }
  suspend fun enrollmentAction(enrollmentId: String, action: String) { post("enrollments/action", mapOf("enrollmentId" to enrollmentId, "action" to action)) }

  suspend fun preview(sequenceId: String, kind: String, ids: List<String>): List<PreviewPerson> {
    val answer = post("enroll/preview", mapOf("sequenceId" to sequenceId, "source" to mapOf("kind" to kind, (if (kind == "contacts") "contactIds" else "leadIds") to ids)))
    return answer.arr("people").mapNotNull { element ->
      val p = element as? JsonObject ?: return@mapNotNull null
      val personId = p.str("personId") ?: return@mapNotNull null
      val requires = p["requires"] as? JsonObject
      PreviewPerson(
        personId, p.str("contactId"), p.str("leadId"), p.str("name").orEmpty(), p.str("email").orEmpty(), p.str("status") ?: "blocked",
        p.arr("blocks").mapNotNull { (it as? JsonObject).str("reason") }, requires.bool("personalLine"),
        requires.arr("attestations").mapNotNull { (it as? JsonPrimitive)?.contentOrNull },
      )
    }
  }

  suspend fun enroll(sequenceId: String, people: List<Map<String, Any?>>): Long =
    (post("enroll", mapOf("sequenceId" to sequenceId, "people" to people))?.get("enrolled") as? JsonPrimitive)?.longOrNull ?: 0L

  suspend fun mailboxStatus(id: String, paused: Boolean) { post("mailboxes/status", mapOf("mailboxId" to id, "paused" to paused)) }
  suspend fun mailboxSettings(id: String, fields: Map<String, Any?>) { post("mailboxes/settings", fields + ("mailboxId" to id)) }
  suspend fun mailboxTest(id: String): String? = post("mailboxes/test", mapOf("mailboxId" to id)).str("sentTo")
  suspend fun mailboxDisconnect(id: String) { post("mailboxes/disconnect", mapOf("mailboxId" to id)) }
  suspend fun doNotContactDomain(action: String, domain: String) { post("do-not-contact/domains", mapOf("action" to action, "domain" to domain)) }
  suspend fun linkDomain(action: String, domain: String) { post("link-domains", mapOf("domain" to domain, "action" to action)) }
}
