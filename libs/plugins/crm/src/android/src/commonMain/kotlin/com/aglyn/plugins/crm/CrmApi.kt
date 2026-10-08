package com.aglyn.plugins.crm

import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.firestoreJson
import com.aglyn.core.firestoreNow
import com.aglyn.core.nowMillis
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlin.random.Random

/*
 * THE CRM'S WRITES, AS THE CONSOLE MAKES THEM.
 *
 * Where the console posts to a route the app posts to the same one with
 * the same body: contacts (create, edit, stage, remove), a lead created or
 * converted, a company deleted, a deal moved, a task saved or completed.
 * Where the console writes a record itself (a lead's fields and status, a
 * company or a deal, a note), the app makes the same write as the signed-in
 * member under the same rules, then asks the console's own follow-up routes
 * what the console's browser asks them: `crm/list-fields` restamps the list
 * fields the record is found by, `crm/sharing` re-evaluates the org's sharing
 * rules. Neither route does anything the member could not; both hold the
 * write lane's own gate.
 */

object CrmRoutes {
  const val CONTACTS_CREATE = "/api/crm/contacts-create"
  const val CONTACT_UPDATE = "/api/crm/contact-update"
  const val CONTACT_STAGE = "/api/crm/contact-stage"
  const val CONTACT_REMOVE = "/api/crm/contact-remove"
  const val COMPANY_DELETE = "/api/crm/company-delete"
  const val LEADS_CREATE = "/api/crm/leads-create"
  const val LEAD_CONVERT = "/api/crm/lead-convert"
  const val DEAL_STAGE = "/api/crm/deal-stage"
  const val TASK_SAVE = "/api/crm/task-save"
  const val TASK_COMPLETE = "/api/crm/task-complete"
  const val NEXT_ACTIVITY = "/api/crm/next-activity"
  const val LIST_FIELDS = "/api/crm/list-fields"
  const val SHARING = "/api/crm/sharing"
  const val EMAIL_SEND = "/api/crm/email-send"
  const val PICKLIST_VALUES = "/api/crm/picklist-values"
  const val MEMBERS = "/api/orgs/members"
}

/** A new document id, as `createResourceUid` mints them: twenty URL-safe characters. */
fun newRecordId(): String {
  val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  return (1..20).map { alphabet[Random.nextInt(alphabet.length)] }.joinToString("")
}

data class TaskDraft(
  val title: String,
  val kind: String = "todo",
  val priority: String = "normal",
  val dueAtMs: Long? = null,
  val assigneeUid: String? = null,
  val notes: String = "",
  val contactId: String? = null,
  val companyId: String? = null,
  val dealId: String? = null,
)

data class ConvertDraft(
  val ownerUid: String?,
  val companyId: String?,
  val createCompanyName: String?,
  val dealTitle: String?,
  val dealAmountCents: Long?,
  val dealStageId: String?,
)

class CrmApi(private val api: ConsoleApiClient, private val writer: FirestoreWriter, val scope: CrmScope) {
  private fun body(vararg pairs: Pair<String, Any?>): kotlinx.serialization.json.JsonElement =
    firestoreJson((scope.routeScope + pairs).filterValues { it != null })

  /** The site scope alone, which the task routes take. */
  private fun taskBody(vararg pairs: Pair<String, Any?>): kotlinx.serialization.json.JsonElement =
    firestoreJson((mapOf("hostId" to scope.hostId) + pairs).filterValues { it != null })

  private suspend fun quietly(block: suspend () -> Unit) {
    try { block() } catch (error: Throwable) { if (error is CancellationException) throw error }
  }

  private fun path(kind: CrmKind, id: String) = "${crmPath(scope.orgId, kind.collection)}/$id"

  /** The follow-ups the console's browser owes a record it wrote itself. */
  suspend fun afterClientWrite(kind: CrmKind, id: String) {
    quietly { api.request(CrmRoutes.LIST_FIELDS, ApiMethod.POST, body("collection" to kind.collection, "ids" to listOf(id))) }
    if (kind != CrmKind.CONTACT) {
      quietly { api.request(CrmRoutes.SHARING, ApiMethod.POST, body("action" to "evaluate", "object" to kind.collection, "ids" to listOf(id))) }
    }
  }

  /*---------- create ----------*/

  suspend fun createContact(fields: Map<String, Any?>): String? {
    val answer = api.request(CrmRoutes.CONTACTS_CREATE, ApiMethod.POST, body(*fields.toList().toTypedArray()))?.jsonObject
    return (answer?.get("contactId") as? JsonPrimitive)?.contentOrNull ?: (answer?.get("id") as? JsonPrimitive)?.contentOrNull
  }

  suspend fun createLead(fields: Map<String, Any?>): String? {
    val answer = api.request(CrmRoutes.LEADS_CREATE, ApiMethod.POST, body(*fields.toList().toTypedArray()))?.jsonObject
    return (answer?.get("leadId") as? JsonPrimitive)?.contentOrNull ?: (answer?.get("id") as? JsonPrimitive)?.contentOrNull
  }

  /** A company or a deal, as the console's drawer creates it: the scope stamp and provenance on the plain fields. */
  suspend fun createRecord(kind: CrmKind, fields: Map<String, Any?>, extra: Map<String, Any?> = emptyMap()): String {
    val id = newRecordId()
    val now = firestoreNow()
    writer.merge(
      path(kind, id),
      fields + extra + mapOf(
        "visibleTo" to scope.createTokens,
        "hostId" to scope.hostId,
        "createdByUid" to scope.uid,
        "nextTaskAtMs" to null,
        "createdAt" to now,
        "updatedAt" to now,
      ),
    )
    afterClientWrite(kind, id)
    return id
  }

  /*---------- edit ----------*/

  /** An edit of a lead, a company or a deal: the changed fields and `updatedAt`. */
  suspend fun updateRecord(kind: CrmKind, id: String, changes: Map<String, Any?>) {
    if (changes.isEmpty()) return
    writer.merge(path(kind, id), changes + ("updatedAt" to firestoreNow()))
    afterClientWrite(kind, id)
  }

  /** A contact's edit: its holder's fields, through `crm/contact-update`. */
  suspend fun updateContact(id: String, set: Map<String, Any?>) {
    if (set.isEmpty()) return
    // The route takes `null` for a cleared field, and a custom key under `custom`.
    val plain = set.mapValues { (_, value) ->
      when (value) {
        com.aglyn.core.FirestoreDelete -> null
        is Map<*, *> -> value.mapValues { if (it.value == com.aglyn.core.FirestoreDelete) null else it.value }
        else -> value
      }
    }
    api.request(CrmRoutes.CONTACT_UPDATE, ApiMethod.POST, body("contactIds" to listOf(id), "set" to plain))
  }

  suspend fun setContactStage(id: String, stage: String?) {
    api.request(CrmRoutes.CONTACT_STAGE, ApiMethod.POST, firestoreJson(scope.routeScope + mapOf("contactId" to id, "lifecycleStage" to stage)))
  }

  suspend fun removeContact(id: String): String? {
    val answer = api.request(CrmRoutes.CONTACT_REMOVE, ApiMethod.POST, body("contactIds" to listOf(id)))?.jsonObject
    return (answer?.get("removed") as? JsonPrimitive)?.contentOrNull
  }

  /** A lead's status, as the console's status menu writes it: the meaning and its label. */
  suspend fun setLeadStatus(id: String, status: String, label: String, reason: String? = null) {
    updateRecord(
      CrmKind.LEAD,
      id,
      mapOf("status" to status, "statusLabel" to label) +
        if (status == "unqualified") mapOf("unqualifiedReason" to (reason?.trim()?.ifEmpty { null } ?: com.aglyn.core.FirestoreDelete)) else emptyMap(),
    )
  }

  suspend fun convertLead(id: String, draft: ConvertDraft): Map<String, String?> {
    val deal = draft.dealTitle?.trim()?.ifEmpty { null }?.let { title ->
      mapOf("title" to title, "amountCents" to draft.dealAmountCents, "currency" to "usd", "stageId" to draft.dealStageId).filterValues { it != null }
    }
    val answer = api.request(
      CrmRoutes.LEAD_CONVERT,
      ApiMethod.POST,
      body(
        "leadId" to id,
        "ownerUid" to draft.ownerUid,
        "companyId" to draft.companyId,
        "createCompany" to draft.createCompanyName?.trim()?.ifEmpty { null }?.let { mapOf("name" to it) },
        "deal" to deal,
      ),
    )?.jsonObject
    return listOf("contactId", "companyId", "dealId").associateWith { (answer?.get(it) as? JsonPrimitive)?.contentOrNull }
  }

  /** Deletes a lead or a deal, as the console's delete does: the record itself, under the rules. */
  suspend fun deleteRecord(kind: CrmKind, id: String) {
    writer.delete(path(kind, id))
  }

  suspend fun deleteCompany(id: String) {
    api.request(CrmRoutes.COMPANY_DELETE, ApiMethod.POST, body("companyId" to id))
  }

  suspend fun moveDeal(id: String, stageId: String) {
    api.request(CrmRoutes.DEAL_STAGE, ApiMethod.POST, body("dealId" to id, "stageId" to stageId))
  }

  suspend fun closeDeal(id: String, won: Boolean, lostReason: String? = null) {
    api.request(
      CrmRoutes.DEAL_STAGE,
      ApiMethod.POST,
      body("dealId" to id, "status" to if (won) "won" else "lost", "lostReason" to lostReason?.trim()?.ifEmpty { null }),
    )
  }

  /*---------- tasks ----------*/

  suspend fun saveTask(taskId: String?, draft: TaskDraft): String? {
    val task = mapOf(
      "title" to draft.title.trim(),
      "kind" to draft.kind,
      "priority" to draft.priority,
      "dueAtMs" to draft.dueAtMs,
      "assigneeUid" to draft.assigneeUid,
      "notes" to draft.notes.trim(),
      "contactId" to draft.contactId,
      "companyId" to draft.companyId,
      "dealId" to draft.dealId,
    )
    val answer = api.request(CrmRoutes.TASK_SAVE, ApiMethod.POST, taskBody("taskId" to taskId, "task" to task))?.jsonObject
    return (answer?.get("taskId") as? JsonPrimitive)?.contentOrNull
  }

  suspend fun completeTask(taskId: String) {
    api.request(CrmRoutes.TASK_COMPLETE, ApiMethod.POST, taskBody("taskId" to taskId))
  }

  /** Reopens a done task, as the console's checkbox does: the status back to open, then the next-activity refresh. */
  suspend fun reopenTask(taskId: String, links: Map<String, String?>) {
    writer.merge(
      "${crmPath(scope.orgId, "crmTasks")}/$taskId",
      mapOf("status" to "open", "completedAtMs" to com.aglyn.core.FirestoreDelete, "completedByUid" to com.aglyn.core.FirestoreDelete, "updatedAt" to firestoreNow()),
    )
    refreshNextActivity(links)
  }

  suspend fun deleteTask(taskId: String, links: Map<String, String?>) {
    writer.delete("${crmPath(scope.orgId, "crmTasks")}/$taskId")
    refreshNextActivity(links)
  }

  private suspend fun refreshNextActivity(links: Map<String, String?>) {
    val link = links.filterKeys { it in setOf("contactId", "companyId", "dealId") }.filterValues { !it.isNullOrEmpty() }
    if (link.isEmpty()) return
    quietly { api.request(CrmRoutes.NEXT_ACTIVITY, ApiMethod.POST, taskBody("links" to listOf(link))) }
  }

  /*---------- activity ----------*/

  /** Logs a note, a call, a meeting or an email on a record, as the console's log dialog adds it. */
  suspend fun logActivity(
    kind: String,
    body: String,
    links: Map<String, String>,
    byName: String?,
    outcome: String? = null,
    durationMinutes: Long? = null,
    direction: String? = null,
    atMs: Long = nowMillis(),
  ): String {
    val id = newRecordId()
    val now = firestoreNow()
    writer.merge(
      "${crmPath(scope.orgId, "crmActivities")}/$id",
      linkedMapOf<String, Any?>(
        "kind" to kind,
        "body" to body.trim(),
        "atMs" to atMs,
        "visibleTo" to scope.createTokens,
        "hostId" to scope.hostId,
        "byUid" to scope.uid,
        "createdAt" to now,
      ).apply {
        putAll(links)
        byName?.let { put("byName", it) }
        outcome?.let { put("outcome", it) }
        durationMinutes?.let { put("durationMinutes", it) }
        direction?.let { put("direction", it) }
      },
    )
    return id
  }

  suspend fun editActivity(id: String, body: String) {
    writer.merge("${crmPath(scope.orgId, "crmActivities")}/$id", mapOf("body" to body.trim(), "updatedAt" to firestoreNow()))
  }

  suspend fun deleteActivity(id: String) {
    writer.delete("${crmPath(scope.orgId, "crmActivities")}/$id")
  }

  /** One email to one person from a record, through the console's route (which logs it as activity). */
  suspend fun sendEmail(subject: String, message: String, links: Map<String, String>) {
    api.request(CrmRoutes.EMAIL_SEND, ApiMethod.POST, body(*(links + mapOf("subject" to subject.trim(), "body" to message.trim())).toList().toTypedArray()))
  }

  /*---------- the team ----------*/

  suspend fun members(): List<CrmMember> {
    val answer = api.request(CrmRoutes.MEMBERS, ApiMethod.GET, query = mapOf("orgId" to scope.orgId))?.jsonObject ?: return emptyList()
    return (answer["members"] as? JsonArray).orEmpty().mapNotNull { entry ->
      val member = entry as? JsonObject ?: return@mapNotNull null
      val uid = (member["\$id"] as? JsonPrimitive)?.contentOrNull ?: (member["uid"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
      val email = (member["email"] as? JsonPrimitive)?.contentOrNull
      val name = (member["displayName"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
      CrmMember(uid, name ?: email ?: uid, email)
    }
  }
}

private fun JsonArray?.orEmpty(): List<kotlinx.serialization.json.JsonElement> = this ?: emptyList()
