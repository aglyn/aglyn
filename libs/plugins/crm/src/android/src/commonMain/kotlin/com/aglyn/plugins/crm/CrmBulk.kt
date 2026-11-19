package com.aglyn.plugins.crm

import com.aglyn.contracts.Contracts
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreDelete
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/*
 * THE BAR OVER A CRM LIST (the Apple `CrmBulk.swift`; the console's
 * `contacts-bulk-bar.tsx`, `leads-`, `companies-`, `deals-` and
 * `tasks-bulk-bar.tsx` over `crm-bulk-writes.ts`): one act over every ticked
 * row, sent where the console sends it, and whatever was left alone or refused
 * named row by row under the bar, never only counted.
 */

/** One act the bar offers. Each list offers the console's own, in the console's order. */
enum class CrmBulkAction(val label: String) {
  ADD_TAG("Add tag"),
  REMOVE_TAG("Remove tag"),
  OWNER("Set owner"),
  STAGE("Set stage"),
  COMPANY("Set company"),
  STATUS("Set status"),
  UNQUALIFY("Unqualify"),
  LOST("Mark lost"),
  COMPLETE("Complete"),
  ASSIGN("Assign"),
  DUE("Set due"),
  REMOVE_FROM_SITE("Remove from this site"),
  DELETE("Delete"),
  ;

  val destructive: Boolean get() = this == REMOVE_FROM_SITE || this == DELETE
  /** Done at once, asked nothing: Complete. */
  val immediate: Boolean get() = this == COMPLETE
  /** Confirmed in a dialog, with nothing to fill in. */
  val confirms: Boolean get() = destructive
}

/** What a bar names its rows: "1 company", "3 deals". */
data class CrmBulkNoun(val singular: String, val plural: String) {
  /** `countNoun`: "1 contact" or "3 contacts". */
  fun count(count: Int): String = if (count == 1) "1 $singular" else "${formatCount(count)} $plural"

  companion object {
    val TASK = CrmBulkNoun("task", "tasks")
    fun of(kind: CrmKind) = CrmBulkNoun(kind.singular.lowercase(), kind.plural.lowercase())
  }
}

/** A whole number with thousands separators, as `toLocaleString` writes it. */
internal fun formatCount(count: Int): String = count.toString().reversed().chunked(3).joinToString(",").reversed()

/** The bar's acts for a record list (the console's buttons, in order). */
fun crmBulkActions(kind: CrmKind, workspaceWide: Boolean): List<CrmBulkAction> = when (kind) {
  CrmKind.CONTACT -> listOf(CrmBulkAction.ADD_TAG, CrmBulkAction.REMOVE_TAG, CrmBulkAction.OWNER, CrmBulkAction.STAGE, CrmBulkAction.COMPANY) +
    if (workspaceWide) emptyList() else listOf(CrmBulkAction.REMOVE_FROM_SITE)
  CrmKind.LEAD -> listOf(CrmBulkAction.OWNER, CrmBulkAction.STATUS, CrmBulkAction.UNQUALIFY)
  CrmKind.COMPANY -> listOf(CrmBulkAction.ADD_TAG, CrmBulkAction.REMOVE_TAG, CrmBulkAction.OWNER, CrmBulkAction.DELETE)
  CrmKind.DEAL -> listOf(CrmBulkAction.STAGE, CrmBulkAction.OWNER, CrmBulkAction.LOST, CrmBulkAction.DELETE)
}

/** The task list's acts (`tasks-bulk-bar.tsx`). */
val CRM_BULK_TASK_ACTIONS = listOf(CrmBulkAction.COMPLETE, CrmBulkAction.ASSIGN, CrmBulkAction.DUE, CrmBulkAction.DELETE)

/** The value dialog's title (`ACTION_TITLES`). */
fun crmBulkSheetTitle(action: CrmBulkAction, kind: CrmKind?): String = when (action) {
  CrmBulkAction.ADD_TAG -> "Add a tag"
  CrmBulkAction.REMOVE_TAG -> "Remove a tag"
  CrmBulkAction.OWNER -> "Set the owner"
  CrmBulkAction.STAGE -> if (kind == CrmKind.CONTACT) "Set the lifecycle stage" else "Set the stage"
  CrmBulkAction.COMPANY -> "Set the company"
  CrmBulkAction.STATUS -> "Set the status"
  CrmBulkAction.UNQUALIFY -> "Unqualify"
  CrmBulkAction.ASSIGN -> "Assign to"
  CrmBulkAction.DUE -> "Set the due date"
  else -> action.label
}

/** A row an act left alone on purpose, or one the store or the route refused, with why. */
data class CrmBulkSkip(val label: String, val reason: String)

/** What one act did: how many rows it reached, and every row it left, by name. */
data class CrmBulkOutcome(val done: Int = 0, val refused: List<CrmBulkSkip> = emptyList())

/** The report under the bar: the head line, then one line per row (`CrmBulkBarFrame`). */
data class CrmBulkReport(val heading: String, val lines: List<String>) {
  companion object {
    fun of(left: List<CrmBulkSkip>, noun: CrmBulkNoun): CrmBulkReport? = if (left.isEmpty()) null else CrmBulkReport(
      if (left.size == 1) "One ${noun.singular} was not changed:" else "${left.size} ${noun.plural} were not changed:",
      left.map { "${it.label} — ${it.reason}" },
    )
  }
}

/** The record pages' cap on tags, which a bulk add never slips past (`CONTACT_TAGS_CAP`, `COMPANY_TAGS_CAP`). */
const val CRM_BULK_TAGS_CAP = 20
/** The longest reason a lead is unqualified or a deal lost with (`UNQUALIFY_REASON_MAX`, `LOST_REASON_MAX`). */
const val CRM_BULK_REASON_MAX = 500
/** How many contacts one `crm/contact-update` or `crm/contact-remove` request names (`CRM_CONTACT_UPDATE_MAX`). */
const val CRM_BULK_CONTACT_ROUTE_MAX = 200

/** `normalizeBulkTag`: trimmed, lowercased, at most 60 characters; null for nothing. */
fun crmBulkTag(input: String): String? = input.trim().lowercase().take(60).ifEmpty { null }

/** What the bar reads off a row. */
data class CrmBulkRow(
  val id: String,
  /** What a report names it by: a contact's address, a lead's name, a company's name, a deal's title, a task's title. */
  val label: String,
  val tags: List<String> = emptyList(),
  val companyId: String? = null,
  val status: String? = null,
  val statusLabel: String? = null,
  val converted: Boolean = false,
  val pipelineId: String? = null,
  /** The site a contact's stage is moved on: a site of the holder whose facet the row was read through. */
  val site: String? = null,
  /** Whether some site holds the contact: a row nobody holds has no facet to write. */
  val held: Boolean = true,
)

/** The site of a holder: the holder itself when it is a site, a declared group's first site, null for the organization's own facet or none. */
fun crmHolderSite(holder: String, org: Map<String, Any?>?): String? {
  if (holder.isEmpty() || holder == ORG_CONTACT_HOLDER_ID) return null
  return consentGroupNamed(org, holder)?.hostIds?.firstOrNull() ?: holder
}

/** A record list's row as the bar reads it, through the facet the list shows it by. */
fun crmBulkRow(row: CrmRow, scope: CrmScope): CrmBulkRow {
  fun s(key: String) = (row.data[key] as? String)?.takeIf { it.isNotBlank() }
  val tags = (row.data["tags"] as? List<*>).orEmpty().filterIsInstance<String>()
  return when (row.kind) {
    CrmKind.CONTACT -> {
      // `contactBulkAddressOf`: the address, else the id. The row's data is already the holder's view.
      val holder = scope.groupId.ifEmpty { crmContactPrimaryHolder(row.data, scope.org) }
      CrmBulkRow(
        row.id, s("email") ?: row.id, tags = tags, companyId = s("companyId"),
        site = if (scope.workspaceWide) crmHolderSite(holder, scope.org) else scope.hostId,
        held = !scope.workspaceWide || !(holder.isEmpty() || holder == ORG_CONTACT_HOLDER_ID),
      )
    }
    CrmKind.LEAD -> CrmBulkRow(row.id, s("name") ?: s("email") ?: row.id, status = s("status"), statusLabel = s("statusLabel"), converted = s("convertedContactId") != null)
    CrmKind.COMPANY -> CrmBulkRow(row.id, s("name") ?: row.id, tags = tags)
    CrmKind.DEAL -> CrmBulkRow(row.id, s("title") ?: "Untitled deal", status = s("status"), pipelineId = s("pipelineId"))
  }
}

/** A task as the bar reads it. */
fun crmBulkRow(task: CrmTask): CrmBulkRow = CrmBulkRow(task.id, task.title.ifEmpty { task.id }, status = task.status)

/** The rows a plan reaches, and the rows it leaves out by name. */
data class CrmBulkPlan(val rows: List<CrmBulkRow> = emptyList(), val skipped: List<CrmBulkSkip> = emptyList())

/** `planAddTag` / `planCompanyAddTag`: a row that carries the tag is left out silently; one already at the cap is left out and named. */
fun crmBulkPlanAddTag(rows: List<CrmBulkRow>, tag: String): CrmBulkPlan {
  val reached = mutableListOf<CrmBulkRow>()
  val skipped = mutableListOf<CrmBulkSkip>()
  for (row in rows) {
    val held = row.tags.map { it.lowercase() }
    if (tag in held) continue
    if (held.size >= CRM_BULK_TAGS_CAP) {
      skipped += CrmBulkSkip(row.label, "already has $CRM_BULK_TAGS_CAP tags")
      continue
    }
    reached += row
  }
  return CrmBulkPlan(reached, skipped)
}

/** `planRemoveTag`: the rows that carry it. */
fun crmBulkPlanRemoveTag(rows: List<CrmBulkRow>, tag: String) = CrmBulkPlan(rows.filter { row -> tag in row.tags.map { it.lowercase() } })

/** `planSetCompany`: a contact already filed under the company is left alone. */
fun crmBulkPlanSetCompany(rows: List<CrmBulkRow>, companyId: String?) = CrmBulkPlan(rows.filter { it.companyId != companyId })

/** The leads Set status reaches: a converted lead's status is its conversion, and one already at the asked status is left alone. */
fun crmBulkPlanLeadStatus(rows: List<CrmBulkRow>, status: String, label: String): CrmBulkPlan {
  val reached = mutableListOf<CrmBulkRow>()
  val skipped = mutableListOf<CrmBulkSkip>()
  for (row in rows) {
    when {
      row.converted -> skipped += CrmBulkSkip(row.label, "was converted")
      row.status == status && (row.statusLabel ?: crmLeadStatusText(status)) == label -> skipped += CrmBulkSkip(row.label, "already $label")
      else -> reached += row
    }
  }
  return CrmBulkPlan(reached, skipped)
}

/** The leads Unqualify reaches: open ones that were not converted. */
fun crmBulkPlanUnqualify(rows: List<CrmBulkRow>): CrmBulkPlan {
  val open = Contracts.nativeCrmLeadOpenStatuses.toSet()
  val reached = mutableListOf<CrmBulkRow>()
  val skipped = mutableListOf<CrmBulkSkip>()
  for (row in rows) {
    when {
      row.converted -> skipped += CrmBulkSkip(row.label, "was converted")
      (row.status ?: "new") !in open -> skipped += CrmBulkSkip(row.label, "is already closed")
      else -> reached += row
    }
  }
  return CrmBulkPlan(reached, skipped)
}

/** A lead status's label, as the record's status sheet names it. */
fun crmLeadStatusText(status: String): String = Contracts.crmLeadStatusLabels[status] ?: status

/** Whether the selected deals are in one pipeline, and which (null for a deal with none); a selection over two has no list of stages. */
data class CrmBulkPipeline(val one: Boolean, val id: String?)

fun crmBulkPipeline(rows: List<CrmBulkRow>): CrmBulkPipeline {
  val ids = rows.map { it.pipelineId.orEmpty() }.toSet()
  return if (ids.size == 1) CrmBulkPipeline(true, ids.first().ifEmpty { null }) else CrmBulkPipeline(false, null)
}

/** The stages Set stage offers a pipeline's deals: its open stages, then its won stage. */
fun crmBulkDealStages(pipeline: Pipeline): List<Stage> = pipeline.stages.filter { it.kind == "open" } + pipeline.stages.filter { it.kind == "won" }.take(1)

/** How a finished act reads (`doneSentence`), given how many rows it reached and what it set. */
fun crmBulkDoneSentence(action: CrmBulkAction, noun: CrmBulkNoun, count: Int, cleared: Boolean = false, named: String? = null): String {
  val rows = noun.count(count)
  return when (action) {
    CrmBulkAction.ADD_TAG -> "Tagged $rows"
    CrmBulkAction.REMOVE_TAG -> "Removed the tag from $rows"
    CrmBulkAction.OWNER -> if (cleared && noun.singular == "lead") "Owner cleared on $rows" else "Owner set on $rows"
    CrmBulkAction.STAGE -> named?.let { "Moved $rows to $it" } ?: "Stage set on $rows"
    CrmBulkAction.COMPANY -> "Company set on $rows"
    CrmBulkAction.STATUS -> "Status set on $rows"
    CrmBulkAction.UNQUALIFY -> "Marked $rows unqualified"
    CrmBulkAction.LOST -> "Marked $rows lost"
    CrmBulkAction.COMPLETE -> "Completed $rows"
    CrmBulkAction.ASSIGN -> "Assigned $rows to ${named ?: "nobody"}"
    CrmBulkAction.DUE -> if (cleared) "Due date cleared on $rows" else "Due date set on $rows"
    CrmBulkAction.REMOVE_FROM_SITE -> "$rows removed from this site"
    CrmBulkAction.DELETE -> "Deleted $rows"
  }
}

/** The sentence a finished act shows: what it did, else that it changed nothing (`useCrmBulkApply`). */
fun crmBulkSentence(outcome: CrmBulkOutcome, attempted: Int, done: (Int) -> String): String =
  if (outcome.done > 0) done(outcome.done) else if (attempted > 0) "Nothing was changed" else "Nothing to change"

/** The dialog a destructive act asks first (the console's confirms, word for word). */
data class CrmBulkConfirm(val title: String, val message: String, val button: String)

fun crmBulkConfirm(action: CrmBulkAction, noun: CrmBulkNoun, count: Int): CrmBulkConfirm? {
  val one = count == 1
  return when {
    action == CrmBulkAction.REMOVE_FROM_SITE -> CrmBulkConfirm(
      if (one) "Remove this contact?" else "Remove $count contacts?",
      "${if (one) "This person is" else "These $count people are"} removed from this site's Contacts, along with their notes, tags and " +
        "timeline. Other sites that captured the same people keep their own records. Their form submissions, orders, bookings, and " +
        "membership records are separate — delete those from their own pages if the request covers them.",
      if (one) "Remove contact" else "Remove contacts",
    )
    action == CrmBulkAction.DELETE && noun.singular == "company" -> CrmBulkConfirm(
      if (one) "Delete this company?" else "Delete $count companies?",
      "${if (one) "It is" else "They are"} removed from Companies and unlinked from every contact at them. The contacts themselves are " +
        "kept, and so is anything else filed against the companies.",
      if (one) "Delete company" else "Delete companies",
    )
    action == CrmBulkAction.DELETE && noun.singular == "deal" -> CrmBulkConfirm(
      if (one) "Delete this deal?" else "Delete $count deals?",
      "${if (one) "It is" else "They are"} removed from the pipeline along with their notes. The contacts and the companies they name " +
        "are not touched.",
      if (one) "Delete deal" else "Delete deals",
    )
    action == CrmBulkAction.DELETE && noun.singular == "task" -> CrmBulkConfirm(
      if (one) "Delete this task?" else "Delete $count tasks?",
      "${if (one) "It is" else "They are"} removed for everyone who can see them. A finished task is better ticked done, which keeps it " +
        "in the Done view.",
      if (one) "Delete task" else "Delete tasks",
    )
    else -> null
  }
}

/** `bulkRefusalReason`: whatever the store or the route threw, as one sentence a report can carry. */
fun crmBulkRefusal(error: Throwable): String {
  if (error is ConsoleApiError) {
    return error.message.ifBlank { if (error.status == 403) "not permitted" else if (error.status == 404) "no longer exists" else "the write failed" }
  }
  val text = error.message.orEmpty()
  val lowered = text.lowercase()
  return when {
    "permission" in lowered -> "not permitted"
    "not found" in lowered || "no document" in lowered -> "no longer exists"
    text.isBlank() -> "the write failed"
    else -> text
  }
}

/** `runCrmBulkCalls`: one request per row, in order, each refusal named by the row. */
suspend fun crmBulkEach(rows: List<CrmBulkRow>, call: suspend (CrmBulkRow) -> Unit): CrmBulkOutcome {
  var done = 0
  val refused = mutableListOf<CrmBulkSkip>()
  for (row in rows) {
    try {
      call(row)
      done += 1
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      refused += CrmBulkSkip(row.label, crmBulkRefusal(error))
    }
  }
  return CrmBulkOutcome(done, refused)
}

/** One route's answer for one row. */
data class CrmBulkAnswer(val id: String, val ok: Boolean, val error: String? = null)

/**
 * `runCrmBulkBatch`: one request per piece of the selection, answered per row. A row the answer does not mention was not
 * written; a request refused whole is every row it carried refused with its one sentence.
 */
suspend fun crmBulkBatch(rows: List<CrmBulkRow>, chunk: Int = CRM_BULK_CONTACT_ROUTE_MAX, call: suspend (List<String>) -> List<CrmBulkAnswer>): CrmBulkOutcome {
  var done = 0
  val refused = mutableListOf<CrmBulkSkip>()
  for (piece in rows.chunked(chunk)) {
    val answers = try {
      call(piece.map { it.id })
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      val reason = crmBulkRefusal(error)
      refused += piece.map { CrmBulkSkip(it.label, reason) }
      continue
    }
    val byId = answers.associateBy { it.id }
    for (row in piece) {
      val answer = byId[row.id]
      if (answer?.ok == true) done += 1 else refused += CrmBulkSkip(row.label, answer?.error?.ifBlank { null } ?: "the write failed")
    }
  }
  return CrmBulkOutcome(done, refused)
}

/** A contact route's per-contact answers (`results: [{ contactId, ok, error? }]`). */
fun crmBulkAnswers(answer: JsonElement?): List<CrmBulkAnswer> =
  ((answer as? JsonObject)?.get("results") as? JsonArray).orEmpty().mapNotNull { entry ->
    val result = entry as? JsonObject ?: return@mapNotNull null
    fun s(key: String) = (result[key] as? JsonPrimitive)?.contentOrNull
    val id = s("contactId") ?: s("taskId") ?: s("id") ?: return@mapNotNull null
    CrmBulkAnswer(id, (result["ok"] as? JsonPrimitive)?.booleanOrNull == true, s("error"))
  }

private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()

/** The value an act was given in its dialog. */
data class CrmBulkValue(
  /** A tag, an owner's or assignee's uid (empty for nobody), a stage, a company (empty for none), a status, a reason. */
  val text: String = "",
  /** A task's due time; null clears it. */
  val dueAtMs: Long? = null,
)

/** What one act did, said, and left. */
data class CrmBulkResult(
  val sentence: String,
  val report: CrmBulkReport?,
  val outcome: CrmBulkOutcome,
  /** The picked rows a destructive act could not remove, which stay ticked so the reader can see them. */
  val keep: List<String> = emptyList(),
)

/** One act over a record list's ticked rows, sent where the console sends it. */
suspend fun CrmApi.bulk(action: CrmBulkAction, kind: CrmKind, picked: List<CrmBulkRow>, value: CrmBulkValue, reference: CrmReference): CrmBulkResult {
  val noun = CrmBulkNoun.of(kind)
  var plan = CrmBulkPlan(picked)
  var named: String? = null
  var loggedByRoute = false
  val cleared = value.text.isEmpty()
  val nothing = CrmBulkResult("Nothing to change", null, CrmBulkOutcome())
  val job: suspend (CrmBulkPlan) -> CrmBulkOutcome = when {
    kind == CrmKind.CONTACT -> {
      // A row no site holds has no facet to write: at the workspace's level it is left out and says so.
      plan = CrmBulkPlan(picked.filter { it.held }, picked.filter { !it.held }.map { CrmBulkSkip(it.label, "no site holds this contact yet") })
      fun update(set: Map<String, Any?>): suspend (CrmBulkPlan) -> CrmBulkOutcome = { p -> crmBulkBatch(p.rows) { ids -> updateContacts(ids, set) } }
      when (action) {
        CrmBulkAction.ADD_TAG, CrmBulkAction.REMOVE_TAG -> {
          val tag = crmBulkTag(value.text) ?: return nothing
          val reached = if (action == CrmBulkAction.ADD_TAG) crmBulkPlanAddTag(plan.rows, tag) else crmBulkPlanRemoveTag(plan.rows, tag)
          plan = CrmBulkPlan(reached.rows, plan.skipped + reached.skipped)
          update(mapOf((if (action == CrmBulkAction.ADD_TAG) "addTag" else "removeTag") to tag))
        }
        CrmBulkAction.OWNER -> update(mapOf("ownerUid" to value.text))
        CrmBulkAction.COMPANY -> {
          val company = value.text.ifEmpty { null }
          plan = CrmBulkPlan(crmBulkPlanSetCompany(plan.rows, company).rows, plan.skipped)
          update(mapOf("companyId" to company))
        }
        // One row at a time through the one writer of a contact's stage, on the site that holds the row.
        CrmBulkAction.STAGE -> planJob { p ->
          crmBulkEach(p.rows) { row ->
            val site = row.site ?: throw ConsoleApiError("no site holds this contact yet", 400, null)
            setContactStage(row.id, value.text, site)
          }
        }
        CrmBulkAction.REMOVE_FROM_SITE -> planJob { p -> crmBulkBatch(p.rows) { ids -> removeContacts(ids) } }
        else -> planJob { _ -> CrmBulkOutcome() }
      }
    }
    action == CrmBulkAction.OWNER -> planJob { p ->
      crmBulkEach(p.rows) { row -> updateRecord(kind, row.id, mapOf("ownerUid" to (value.text.ifEmpty { null } ?: FirestoreDelete))) }
    }
    kind == CrmKind.LEAD && action == CrmBulkAction.STATUS -> {
      val label = crmLeadStatusText(value.text)
      plan = crmBulkPlanLeadStatus(picked, value.text, label)
      val job: suspend (CrmBulkPlan) -> CrmBulkOutcome = { p ->
        crmBulkEach(p.rows) { row ->
          // Reopening an unqualified lead clears its reason, as the row does.
          updateRecord(
            CrmKind.LEAD, row.id,
            mapOf("status" to value.text, "statusLabel" to label) + if (row.status == "unqualified") mapOf("unqualifiedReason" to FirestoreDelete) else emptyMap(),
          )
        }
      }
      job
    }
    kind == CrmKind.LEAD && action == CrmBulkAction.UNQUALIFY -> {
      plan = crmBulkPlanUnqualify(picked)
      val reason = value.text.trim().take(CRM_BULK_REASON_MAX)
      val job: suspend (CrmBulkPlan) -> CrmBulkOutcome = { p ->
        crmBulkEach(p.rows) { row ->
          updateRecord(CrmKind.LEAD, row.id, mapOf("status" to "unqualified", "statusLabel" to crmLeadStatusText("unqualified"), "unqualifiedReason" to reason))
        }
      }
      job
    }
    kind == CrmKind.COMPANY && (action == CrmBulkAction.ADD_TAG || action == CrmBulkAction.REMOVE_TAG) -> {
      val tag = crmBulkTag(value.text) ?: return nothing
      plan = if (action == CrmBulkAction.ADD_TAG) crmBulkPlanAddTag(picked, tag) else crmBulkPlanRemoveTag(picked, tag)
      val job: suspend (CrmBulkPlan) -> CrmBulkOutcome = { p ->
        crmBulkEach(p.rows) { row ->
          val held = row.tags.filter { it.lowercase() != tag }
          updateRecord(CrmKind.COMPANY, row.id, mapOf("tags" to if (action == CrmBulkAction.ADD_TAG) held + tag else held))
        }
      }
      job
    }
    kind == CrmKind.COMPANY && action == CrmBulkAction.DELETE -> planJob { p -> crmBulkEach(p.rows) { row -> deleteCompany(row.id) } }
    kind == CrmKind.DEAL && action == CrmBulkAction.STAGE -> {
      named = reference.pipeline(crmBulkPipeline(picked).id).stages.firstOrNull { it.id == value.text }?.name
      loggedByRoute = true
      val job: suspend (CrmBulkPlan) -> CrmBulkOutcome = { p -> crmBulkEach(p.rows) { row -> moveDeal(row.id, value.text) } }
      job
    }
    kind == CrmKind.DEAL && action == CrmBulkAction.LOST -> {
      loggedByRoute = true
      val reason = value.text.trim().take(CRM_BULK_REASON_MAX)
      val job: suspend (CrmBulkPlan) -> CrmBulkOutcome = { p -> crmBulkEach(p.rows) { row -> closeDeal(row.id, false, reason) } }
      job
    }
    kind == CrmKind.DEAL && action == CrmBulkAction.DELETE -> planJob { p -> crmBulkEach(p.rows) { row -> deleteRecord(CrmKind.DEAL, row.id) } }
    else -> planJob { _ -> CrmBulkOutcome() }
  }
  val outcome = job(plan)
  val sentence = crmBulkSentence(outcome, plan.rows.size) { crmBulkDoneSentence(action, noun, it, cleared, named) }
  if (!loggedByRoute) logBulk(sentence, kind.name.lowercase(), outcome.done)
  val refused = outcome.refused.map { it.label }.toSet()
  return CrmBulkResult(
    sentence, CrmBulkReport.of(plan.skipped + outcome.refused, noun), outcome,
    if (action.destructive) picked.filter { it.label in refused }.map { it.id } else emptyList(),
  )
}

/**
 * One act over the ticked tasks (`tasks-bulk-bar.tsx`): Complete and Assign through their routes, the due date and the
 * delete client-direct, then the linked records' next activity.
 */
suspend fun CrmApi.bulkTasks(action: CrmBulkAction, tasks: List<CrmTask>, value: CrmBulkValue, reference: CrmReference): CrmBulkResult {
  val noun = CrmBulkNoun.TASK
  val byId = tasks.associateBy { it.id }
  var rows = tasks.map { crmBulkRow(it) }
  var named: String? = null
  var loggedByRoute = false
  val job: suspend (List<CrmBulkRow>) -> CrmBulkOutcome = when (action) {
    CrmBulkAction.COMPLETE -> {
      rows = rows.filter { it.status != "done" }
      val job: suspend (List<CrmBulkRow>) -> CrmBulkOutcome = { r -> crmBulkEach(r) { row -> completeTask(row.id) } }
      job
    }
    CrmBulkAction.ASSIGN -> {
      val assignee = value.text.ifEmpty { null }
      named = assignee?.let { reference.memberLabel(it) } ?: "nobody"
      val job: suspend (List<CrmBulkRow>) -> CrmBulkOutcome = { r ->
        crmBulkEach(r) { row -> byId[row.id]?.let { saveTask(row.id, it.draft.copy(assigneeUid = assignee)) } }
      }
      job
    }
    CrmBulkAction.DUE -> taskJob { r -> crmBulkEach(r) { row -> byId[row.id]?.let { setTaskDue(it, value.dueAtMs) } } }
    CrmBulkAction.DELETE -> taskJob { r -> crmBulkEach(r) { row -> byId[row.id]?.let { deleteTask(it.id, it.links) } } }
    else -> {
      loggedByRoute = true
      val job: suspend (List<CrmBulkRow>) -> CrmBulkOutcome = { CrmBulkOutcome() }
      job
    }
  }
  val outcome = job(rows)
  val sentence = crmBulkSentence(outcome, rows.size) { crmBulkDoneSentence(action, noun, it, value.dueAtMs == null, named) }
  if (!loggedByRoute) logBulk(sentence, "task", outcome.done)
  val refused = outcome.refused.map { it.label }.toSet()
  return CrmBulkResult(
    sentence, CrmBulkReport.of(outcome.refused, noun), outcome,
    if (action == CrmBulkAction.DELETE) tasks.filter { crmBulkRow(it).label in refused }.map { it.id } else emptyList(),
  )
}

/** A plan's job, as a `when` branch names it (a bare lambda there would read as a block). */
private fun planJob(block: suspend (CrmBulkPlan) -> CrmBulkOutcome) = block

/** A task act's job, likewise. */
private fun taskJob(block: suspend (List<CrmBulkRow>) -> CrmBulkOutcome) = block
