package com.aglyn.plugins.inbox

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.firestoreJson
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

/*
 * A SITE'S INBOX, AS THE CONSOLE'S INBOX READS AND WRITES IT.
 *
 * Submissions are `hosts/{hostId}/formSubmissions`, listed by the console's
 * own SUBMISSION_LIST_QUERY through the shared planner, newest first: the
 * Unread / Read chips and the form pick are its `read` and `formId` clauses,
 * a typed word its search. Read and unread are the one field the rules let
 * a site writer change on a submission, written as the console writes it;
 * delete is the console's delete, then its form-stats refresh. A reply and
 * a marketing-list add go to the console's own routes, which hold the
 * sending rules and the roles.
 */

const val SUBMISSIONS_PAGE_SIZE = 25
const val INBOX_REPLY_ROUTE = "/api/inbox/reply"
const val INBOX_LIST_OPTIONS_ROUTE = "/api/inbox/list-options"
const val INBOX_ASSIGN_LIST_ROUTE = "/api/inbox/assign-list"
const val FORM_STATS_ROUTE = "/api/forms/stats"
const val MEMBER_REMOVE_ROUTE = "/api/membership/admin-remove"

fun submissionsPath(hostId: String) = "hosts/$hostId/formSubmissions"
fun repliesPath(hostId: String, submissionId: String) = "${submissionsPath(hostId)}/$submissionId/replies"
fun siteMembersPath(hostId: String) = "hosts/$hostId/siteMembers"
fun leadsPath(orgId: String) = "orgs/$orgId/leads"

/** The chips over the list: every message, or the stored `read` boolean by its words. */
enum class ReadFilter(val label: String, val value: String?) {
  ALL("All", null),
  UNREAD(Contracts.submissionReadOptions.firstOrNull { it.value == "false" }?.label ?: "Unread", "false"),
  READ(Contracts.submissionReadOptions.firstOrNull { it.value == "true" }?.label ?: "Read", "true"),
}

/** The list's request: the chip, the form pick and the typed words, as the console's filter panel asks them. */
fun submissionsRequest(read: ReadFilter, formId: String?, search: String): ListQueryRequest = ListQueryRequest(
  clauses = listOfNotNull(
    read.value?.let { ListFilterRequest("read", "equals", it) },
    formId?.takeIf { it.isNotBlank() }?.let { ListFilterRequest("formId", "equals", it) },
  ),
  search = search.trim().ifEmpty { null }?.let { listOf(it) },
)

/**
 * A site's submissions. [scopedForm] is a form's own card
 * (FORM_SCOPED_SUBMISSION_LIST_QUERY): that form is the list's base, which no
 * clause can widen; otherwise [formId] is the Form pick.
 */
fun submissionsQuery(
  hostId: String,
  read: ReadFilter,
  formId: String?,
  search: String,
  limit: Int,
  scopedForm: String? = null,
): FirestoreQuery =
  if (!scopedForm.isNullOrEmpty()) {
    planListQuery(
      Contracts.formScopedSubmissionListQuery,
      submissionsRequest(read, null, search).copy(base = listOf(ListQueryFilter(ListQueryOp.EQUAL, "formId", JsonPrimitive(scopedForm)))),
    ).toFirestoreQuery(submissionsPath(hostId), limit)
  } else {
    planListQuery(Contracts.submissionListQuery, submissionsRequest(read, formId, search)).toFirestoreQuery(submissionsPath(hostId), limit)
  }

/**
 * The site's forms for the Form pick, by document id as the console reads
 * them (an `orderBy` on a name would drop a form saved without one).
 */
fun formsQuery(hostId: String): FirestoreQuery =
  FirestoreQuery("hosts/$hostId/forms", orderBy = listOf(FirestoreOrder("__name__")), limit = 51)

/** A form's name as the console shows it: `displayName`, then `name`, then its id. */
fun formName(doc: FirestoreDoc): String =
  listOf(doc.string("displayName"), doc.string("name")).firstOrNull { !it.isNullOrEmpty() } ?: doc.id

/** A site's members, newest first, by the console's Site users declaration. */
fun siteMembersQuery(hostId: String, search: String, limit: Int): FirestoreQuery =
  planListQuery(
    Contracts.siteMemberListQuery,
    ListQueryRequest(clauses = emptyList(), search = search.trim().ifEmpty { null }?.let { listOf(it) }),
  ).toFirestoreQuery(siteMembersPath(hostId), limit)

/**
 * The leads this site may see, newest first: the console's LEAD_LIST_QUERY
 * over `orgs/{orgId}/leads` with its `visibleTo` scope clause (`leadListBase`):
 * the organization's own token and the site's.
 */
fun siteLeadsQuery(orgId: String, hostId: String, search: String, limit: Int): FirestoreQuery =
  planListQuery(
    Contracts.leadListQuery,
    ListQueryRequest(
      base = listOf(ListQueryFilter(ListQueryOp.ARRAY_CONTAINS_ANY, "visibleTo", JsonArray(listOf(JsonPrimitive("org"), JsonPrimitive("host:$hostId"))))),
      clauses = emptyList(),
      search = search.trim().ifEmpty { null }?.let { listOf(it) },
    ),
  ).toFirestoreQuery(leadsPath(orgId), limit)

/*---------- who wrote in: `messageSender` and `submissionSender`, replayed from the console's cases ----------*/

private val SENDER_NAME_KEYS = listOf("name", "fullname", "yourname", "firstname", "contactname")
private val SENDER_EMAIL_KEYS = listOf("email", "emailaddress")

private fun textOf(value: Any?): String = when (value) {
  is String -> value
  is Boolean -> value.toString()
  is Long, is Int -> value.toString()
  is Double -> if (value.isFinite()) (if (value % 1.0 == 0.0 && kotlin.math.abs(value) < 1e15) value.toLong().toString() else value.toString()) else ""
  is Number -> value.toString()
  is List<*> -> value.map(::textOf).filter { it.isNotEmpty() }.joinToString(" ")
  else -> ""
}

data class MessageSender(val name: String? = null, val email: String? = null)

/** Who wrote in, by the field-name convention: the first non-empty name-like and address-like values. */
fun messageSender(fields: Map<String, Any?>?): MessageSender {
  val reduced = LinkedHashMap<String, String>()
  for ((key, value) in fields.orEmpty()) {
    val text = textOf(value).trim()
    if (text.isEmpty()) continue
    val at = key.lowercase().replace(Regex("[^a-z0-9]"), "")
    if (at !in reduced) reduced[at] = text
  }
  return MessageSender(
    name = SENDER_NAME_KEYS.firstNotNullOfOrNull { reduced[it] },
    email = SENDER_EMAIL_KEYS.firstNotNullOfOrNull { reduced[it] },
  )
}

data class SubmissionSender(val label: String, val email: String?, val initials: String)

/** Up to two initials; an address falls back to its local part. */
fun initialsOf(label: String): String {
  val trimmed = label.trim()
  val source = if ('@' in trimmed) trimmed.substringBefore('@') else trimmed
  val words = source.split(Regex("[\\s._-]+")).map { it.trim() }.filter { it.isNotEmpty() }
  val letters = words.take(2).joinToString("") { it.take(1) }
  return letters.ifEmpty { source.take(1) }.ifEmpty { "?" }.uppercase()
}

fun submissionSender(fields: Map<String, Any?>?, fallback: String = "Someone"): SubmissionSender {
  val sender = messageSender(fields)
  val label = sender.name ?: sender.email ?: fallback
  return SubmissionSender(label, sender.email, initialsOf(label))
}

/** `Re: your message to …`: the site leads, then the form, cut to the route's subject limit. */
fun defaultReplySubject(siteName: String?, formName: String?): String {
  val site = siteName.orEmpty().trim()
  val form = formName.orEmpty().trim()
  val topic = site.ifEmpty { form }.ifEmpty { "your message" }
  return "Re: your message to $topic".take(Contracts.replySubjectMax.toInt())
}

enum class ChipColor { SUCCESS, INFO, WARNING, DEFAULT }

data class RoutingChip(val label: String, val color: ChipColor)

/** The chips under the fields: Saved to Inbox, then what the form's dataset did with it. */
fun routingChips(routing: Map<String, Any?>?): List<RoutingChip> {
  val chips = mutableListOf(RoutingChip("Saved to Inbox", ChipColor.SUCCESS))
  @Suppress("UNCHECKED_CAST") val dataset = routing?.get("dataset") as? Map<String, Any?>
  val recordId = dataset?.get("recordId") as? String
  if (!recordId.isNullOrEmpty()) {
    val name = (dataset["name"] as? String)?.takeIf { it.isNotEmpty() }
    chips += RoutingChip(if (name != null) "Added to “$name” dataset" else "Added to a dataset", ChipColor.INFO)
  }
  @Suppress("UNCHECKED_CAST") val refused = routing?.get("datasetRefused") as? Map<String, Any?>
  if (refused != null && recordId.isNullOrEmpty()) {
    @Suppress("UNCHECKED_CAST") val reasons = (refused["errors"] as? Map<String, Any?>).orEmpty().values
      .filterIsInstance<String>().filter { it.isNotEmpty() }
    val name = (refused["name"] as? String)?.takeIf { it.isNotEmpty() }
    val where = if (name != null) "“$name” dataset" else "the dataset"
    chips += RoutingChip(
      if (reasons.isNotEmpty()) "Not added to $where: ${reasons.joinToString("; ")}" else "Not added to $where",
      ChipColor.WARNING,
    )
  }
  return chips
}

/*---------- rows ----------*/

fun timestampMillis(value: Any?): Long? = when (value) {
  is FirestoreTimestamp -> value.epochMillis
  is Number -> value.toLong()
  else -> null
}

/** One submission as the list and the reader show it. */
data class Submission(
  val id: String,
  val formId: String?,
  val formName: String,
  val sender: SubmissionSender,
  /** The fields in the order they arrived. */
  val fields: List<Pair<String, String>>,
  val read: Boolean,
  val receivedAtMs: Long?,
  val repliedAtMs: Long?,
  val path: String?,
  val chips: List<RoutingChip>,
  val capturedKind: String?,
  val capturedId: String?,
) {
  /** The row's second line: each field as `key: value`. */
  val preview: String get() = fields.joinToString(" · ") { (key, value) -> "$key: $value" }
}

@Suppress("UNCHECKED_CAST")
fun submissionOf(doc: FirestoreDoc): Submission {
  val fields = (doc.data["fields"] as? Map<String, Any?>).orEmpty()
  val formName = (doc.data["formName"] as? String)?.takeIf { it.isNotBlank() } ?: "Form"
  val captured = doc.data["capturedRecord"] as? Map<String, Any?>
  return Submission(
    id = doc.id,
    formId = doc.data["formId"] as? String,
    formName = formName,
    sender = submissionSender(fields, formName),
    fields = fields.entries.map { (key, value) -> key to textOf(value) }.filter { it.second.isNotBlank() },
    read = doc.data["read"] == true,
    receivedAtMs = timestampMillis(doc.data["createdAt"]),
    repliedAtMs = timestampMillis(doc.data["repliedAtMs"]),
    path = doc.data["path"] as? String,
    chips = routingChips(doc.data["routing"] as? Map<String, Any?>),
    capturedKind = captured?.get("kind") as? String,
    capturedId = captured?.get("id") as? String,
  )
}

data class SentReply(val id: String, val to: String, val subject: String, val message: String, val sentAtMs: Long?)

fun sentReplyOf(doc: FirestoreDoc) = SentReply(
  id = doc.id,
  to = doc.string("to").orEmpty(),
  subject = doc.string("subject").orEmpty(),
  message = doc.string("message").orEmpty(),
  sentAtMs = timestampMillis(doc.data["sentAtMs"]),
)

fun sentRepliesQuery(hostId: String, submissionId: String) =
  FirestoreQuery(repliesPath(hostId, submissionId), orderBy = listOf(com.aglyn.core.FirestoreOrder("sentAtMs", descending = true)), limit = 10)

/** What the member may do, by their role on the site: the console's own split. */
data class InboxPermissions(val canWrite: Boolean, val canReply: Boolean) {
  companion object {
    fun of(role: String?) = InboxPermissions(
      canWrite = role in setOf("owner", "admin", "editor", "author"),
      canReply = role in setOf("owner", "admin", "editor"),
    )
  }
}

data class SiteMemberRow(val id: String, val name: String, val email: String, val joinedAtMs: Long?)

fun siteMemberOf(doc: FirestoreDoc): SiteMemberRow {
  val email = doc.string("email").orEmpty()
  val name = listOf("displayName", "name").firstNotNullOfOrNull { doc.string(it)?.takeIf(String::isNotBlank) } ?: email.ifEmpty { "Member" }
  return SiteMemberRow(doc.id, name, email, timestampMillis(doc.data["createdAt"]))
}

data class LeadRow(val id: String, val name: String, val email: String, val status: String?, val statusLabel: String?, val company: String?)

fun leadRowOf(doc: FirestoreDoc) = LeadRow(
  id = doc.id,
  name = doc.string("name")?.takeIf { it.isNotBlank() } ?: doc.string("email").orEmpty(),
  email = doc.string("email").orEmpty(),
  status = doc.string("status"),
  statusLabel = doc.string("statusLabel"),
  company = doc.string("company"),
)

/*---------- writes ----------*/

data class ListOption(val id: String, val name: String)

data class ListOptions(
  val to: String?,
  val lists: List<ListOption>,
  val truncated: Boolean,
  val enrollable: Boolean,
  val requiresAttestation: Boolean,
  val summary: String?,
)

/** The Inbox's writes, as the console makes them. Each refuses the app exactly when it refuses the console. */
interface InboxActions {
  suspend fun setRead(submissionId: String, read: Boolean)
  suspend fun delete(submission: Submission)
  suspend fun reply(submissionId: String, subject: String, message: String): String?
  suspend fun listOptions(submissionId: String): ListOptions
  suspend fun assignList(submissionId: String, listId: String, attestConsent: Boolean): String?
  suspend fun removeMember(memberId: String)
}

class ConsoleInboxActions(
  private val api: ConsoleApiClient,
  private val writer: FirestoreWriter,
  private val hostId: String,
) : InboxActions {
  private fun body(vararg pairs: Pair<String, Any?>): JsonElement =
    firestoreJson((listOf("hostId" to hostId) + pairs).filter { it.second != null }.toMap())

  override suspend fun setRead(submissionId: String, read: Boolean) {
    writer.merge("${submissionsPath(hostId)}/$submissionId", mapOf("read" to read))
  }

  override suspend fun delete(submission: Submission) {
    writer.delete("${submissionsPath(hostId)}/${submission.id}")
    // The console's best-effort refresh of the form's counts.
    submission.formId?.let { formId ->
      runCatching { api.request(FORM_STATS_ROUTE, ApiMethod.POST, body("formIds" to listOf(formId))) }
    }
  }

  override suspend fun reply(submissionId: String, subject: String, message: String): String? {
    val answer = api.request(INBOX_REPLY_ROUTE, ApiMethod.POST, body("submissionId" to submissionId, "subject" to subject, "message" to message))
    return (answer as? JsonObject)?.get("to")?.let { (it as? JsonPrimitive)?.contentOrNull }
  }

  override suspend fun listOptions(submissionId: String): ListOptions {
    val answer = api.request(INBOX_LIST_OPTIONS_ROUTE, ApiMethod.POST, body("submissionId" to submissionId))?.jsonObject ?: JsonObject(emptyMap())
    fun str(key: String) = (answer[key] as? JsonPrimitive)?.contentOrNull
    fun bool(key: String) = (answer[key] as? JsonPrimitive)?.booleanOrNull == true
    return ListOptions(
      to = str("to"),
      lists = (answer["lists"] as? JsonArray).orEmpty().mapNotNull { entry ->
        val item = entry as? JsonObject ?: return@mapNotNull null
        val id = (item["id"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
        ListOption(id, (item["name"] as? JsonPrimitive)?.contentOrNull ?: id)
      },
      truncated = bool("listsTruncated"),
      enrollable = bool("enrollable"),
      requiresAttestation = bool("requiresAttestation"),
      summary = str("summary"),
    )
  }

  override suspend fun assignList(submissionId: String, listId: String, attestConsent: Boolean): String? {
    val answer = api.request(
      INBOX_ASSIGN_LIST_ROUTE,
      ApiMethod.POST,
      body("submissionId" to submissionId, "listId" to listId, "attestConsent" to attestConsent),
    )?.jsonObject
    return (answer?.get("listName") as? JsonPrimitive)?.contentOrNull
  }

  override suspend fun removeMember(memberId: String) {
    api.request(MEMBER_REMOVE_ROUTE, ApiMethod.POST, body("memberId" to memberId))
  }
}

internal fun JsonArray?.orEmpty(): List<JsonElement> = this?.jsonArray ?: emptyList()

internal fun JsonElement?.long(): Long? = (this as? JsonPrimitive)?.longOrNull
