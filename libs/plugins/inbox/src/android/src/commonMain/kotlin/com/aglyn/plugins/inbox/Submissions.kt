package com.aglyn.plugins.inbox

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.jsonBody
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.ui.Load
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/*
 * A site's form submissions as the console's submissions card reads and
 * changes them (`hosts/{hostId}/formSubmissions`): the site's list
 * (SUBMISSION_LIST_QUERY) or one form's (FORM_SCOPED_SUBMISSION_LIST_QUERY,
 * the form as its base), newest first, with the read filter and the search
 * as clauses on the one query. A submission is opened (which marks it read),
 * marked read or unread, replied to, deleted and exported, each the way the
 * console does it.
 */

const val SUBMISSIONS_PAGE_SIZE = 30

fun submissionsPath(hostId: String) = "hosts/$hostId/formSubmissions"

/** The sender, found by field name the way the console finds it (`messageSender`). */
data class Sender(val name: String? = null, val email: String? = null)

private val SENDER_NAME_KEYS = listOf("name", "fullname", "yourname", "firstname", "contactname")
private val SENDER_EMAIL_KEYS = listOf("email", "emailaddress")

private fun textOf(value: Any?): String = when (value) {
  is String -> value
  is Long, is Int -> value.toString()
  is Double -> if (!value.isFinite()) "" else if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
  is Boolean -> value.toString()
  is List<*> -> value.map(::textOf).filter { it.isNotEmpty() }.joinToString(" ")
  else -> ""
}

fun messageSender(fields: Map<String, Any?>?): Sender {
  val reduced = LinkedHashMap<String, String>()
  for ((key, value) in fields.orEmpty()) {
    val text = textOf(value).trim()
    if (text.isEmpty()) continue
    val at = key.lowercase().replace(Regex("[^a-z0-9]"), "")
    if (!reduced.containsKey(at)) reduced[at] = text
  }
  return Sender(SENDER_NAME_KEYS.firstNotNullOfOrNull { reduced[it] }, SENDER_EMAIL_KEYS.firstNotNullOfOrNull { reduced[it] })
}

/** One submission, as the list and its detail read it. */
data class Submission(
  val id: String,
  val formId: String?,
  val formName: String,
  val path: String?,
  /** Field name to the value the visitor sent, in the order they arrived. */
  val fields: List<Pair<String, String>>,
  val read: Boolean,
  val createdAt: FirestoreTimestamp?,
  val repliedAtMs: Long?,
  val sender: Sender,
  /** The lead or contact the submission made, when it made one. */
  val capturedKind: String?,
) {
  /** Who it is from, as the list's From column names it. */
  val from: String get() = sender.name ?: sender.email ?: "Someone"

  /** The list's second line: what they wrote, the sender's own name and address left out. */
  val preview: String get() = fields.map { it.second }.filter { it != sender.name && it != sender.email }.joinToString(" · ")

  companion object {
    fun from(doc: FirestoreDoc): Submission {
      val fields = (doc.data["fields"] as? Map<*, *>)?.entries
        ?.map { (key, value) -> key.toString() to textOf(value) }
        .orEmpty()
      return Submission(
        id = doc.id,
        formId = doc.string("formId")?.ifBlank { null },
        formName = doc.string("formName")?.ifBlank { null } ?: "Form",
        path = doc.string("path")?.ifBlank { null },
        fields = fields,
        read = doc.bool("read") == true,
        createdAt = doc.data["createdAt"] as? FirestoreTimestamp,
        repliedAtMs = doc.long("repliedAtMs"),
        sender = messageSender(fields.toMap()),
        capturedKind = ((doc.data["capturedRecord"] as? Map<*, *>)?.get("kind") as? String),
      )
    }
  }
}

/** The read chips above the list: every submission, then the Read filter's own options. */
fun readChoices(): List<Pair<String?, String>> = listOf<Pair<String?, String>>(null to "All") + Contracts.submissionReadOptions.map { it.value to it.label }

fun submissionsRequest(formId: String?, read: String?, search: String): ListQueryRequest = ListQueryRequest(
  base = formId?.let { listOf(ListQueryFilter(ListQueryOp.EQUAL, "formId", JsonPrimitive(it))) },
  clauses = listOfNotNull(read?.let { ListFilterRequest("read", "equals", it) }),
  search = search.trim().ifEmpty { null }?.let { listOf(it) },
)

fun submissionsQuery(hostId: String, formId: String?, read: String?, search: String, after: List<Any?>? = null) =
  planListQuery(if (formId != null) Contracts.formScopedSubmissionListQuery else Contracts.submissionListQuery, submissionsRequest(formId, read, search))
    .toFirestoreQuery(submissionsPath(hostId), SUBMISSIONS_PAGE_SIZE, after)

/** One list of submissions: the filter, the search and the rows read so far. */
class SubmissionsModel(
  private val hostId: String,
  private val formId: String?,
  private val firestore: FirestoreReader,
  private val scope: CoroutineScope,
) {
  var read by mutableStateOf<String?>(null)
    private set
  var search by mutableStateOf("")
    private set
  var rows by mutableStateOf<Load<List<Submission>>>(Load.Loading)
    private set
  var hasMore by mutableStateOf(false)
    private set
  var refreshing by mutableStateOf(false)
    private set
  private var cursor: List<Any?>? = null
  private var job: Job? = null

  fun pick(next: String?) { if (next != read) { read = next; reload() } }
  fun type(next: String) { if (next != search) { search = next; reload(debounce = true) } }
  fun refresh() { refreshing = true; reload(keep = true) }

  fun reload(debounce: Boolean = false, keep: Boolean = false) {
    job?.cancel()
    if (!keep && !debounce) rows = Load.Loading
    job = scope.launch {
      if (debounce) delay(300)
      if (!keep) rows = Load.Loading
      rows = try {
        val page = firestore.page(submissionsQuery(hostId, formId, read, search))
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        Load.Ready(page.docs.map(Submission::from))
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        hasMore = false
        Load.Failed("Submissions could not be loaded. Check the connection and try again.")
      } finally {
        refreshing = false
      }
    }
  }

  fun loadMore() {
    val after = cursor ?: return
    val shown = (rows as? Load.Ready)?.value ?: return
    if (job?.isActive == true) return
    job = scope.launch {
      runCatching { firestore.page(submissionsQuery(hostId, formId, read, search, after)) }.onSuccess { page ->
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        rows = Load.Ready(shown + page.docs.map(Submission::from).filter { row -> shown.none { it.id == row.id } })
      }
    }
  }

  /** Mirrors a read change or a delete on the rows shown, while the write lands. */
  fun patch(id: String, read: Boolean? = null, removed: Boolean = false) {
    val shown = (rows as? Load.Ready)?.value ?: return
    rows = Load.Ready(if (removed) shown.filterNot { it.id == id } else shown.map { if (it.id == id && read != null) it.copy(read = read) else it })
  }
}

/**
 * The submission writes, as the console's card makes them: read state as the
 * one field the rules let change, a delete then the form's recount, a reply
 * through the inbox reply route. The export is the platform's
 * (`TransferExportDialog`, resource `forms.submissions`).
 */
class SubmissionsApi(private val api: ConsoleApiClient, private val writer: FirestoreWriter, private val hostId: String) {
  suspend fun setRead(id: String, read: Boolean) = writer.update("${submissionsPath(hostId)}/$id", mapOf("read" to read))

  suspend fun delete(submission: Submission) {
    writer.delete("${submissionsPath(hostId)}/${submission.id}")
    submission.formId?.let { formId ->
      runCatching { api.request("/api/forms/stats", ApiMethod.POST, jsonBody("hostId" to hostId, "formIds" to listOf(formId))) }
    }
  }

  suspend fun reply(id: String, subject: String, message: String) {
    api.request("/api/inbox/reply", ApiMethod.POST, jsonBody("hostId" to hostId, "submissionId" to id, "subject" to subject, "message" to message))
  }
}
