package com.aglyn.plugins.forms

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.field
import com.aglyn.core.firestoreNow
import com.aglyn.core.jsonBody
import com.aglyn.core.listquery.displayNameSearchFields
import com.aglyn.core.listquery.nameSearchTokens
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.core.newDocumentId
import com.aglyn.core.nowMillis
import com.aglyn.ui.Load
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * A site's forms as the console's Forms page lists and changes them
 * (`hosts/{hostId}/forms`): FORM_LIST_QUERY, forms in use as its base unless
 * the status chip asks otherwise, the search on the form's search tokens.
 * A form is created and duplicated through the quota-enforcing resources
 * route, its design is the Besigner's, its published version goes through
 * the promote route, and its details, CRM routing and retirement are the
 * same document updates the form's page makes.
 */

const val FORMS_PAGE_SIZE = 30

/** The plugin's document segment in Besigner URLs (`FORMS_DOCUMENT_SEGMENT`). */
const val FORMS_DOCUMENT_SEGMENT = "forms"

/** The forms plugin's bundle id, which a form's root element names (`BUNDLE_ID`). */
const val FORMS_BUNDLE_ID = "forms"

/** The canvas root id (`CANVAS_ROOT_ELEMENT_ID`). */
const val FORM_CANVAS_ROOT = "_@_"

/** The longest form slug (`FORM_SLUG_MAX_LENGTH`). */
const val FORM_SLUG_MAX_LENGTH = 64

fun formsPath(hostId: String) = "hosts/$hostId/forms"

/** A declared question of a form (`FormFieldDecl`). */
data class FormFieldDecl(val name: String, val label: String, val type: String, val required: Boolean, val role: String?, val options: List<String>)

/** One form, as the list and its detail read it. */
data class FormRow(
  val id: String,
  val name: String,
  val slug: String?,
  val fields: List<FormFieldDecl>,
  val routing: Map<String, Any?>,
  val consentFieldName: String?,
  val retired: Boolean,
  val versionId: String?,
  val submissions: Long?,
  val leads: Long?,
  val views: Long?,
  val lastSubmissionAtMs: Long?,
  val updatedAt: FirestoreTimestamp?,
  val campaignCount: Int,
) {
  val routesLeads: Boolean get() = routing["lead"] == true

  companion object {
    fun from(doc: FirestoreDoc): FormRow {
      val stats = doc.data["stats"] as? Map<*, *>
      fun stat(key: String) = (stats?.get(key) as? Number)?.toLong()
      return FormRow(
        id = doc.id,
        name = doc.string("displayName")?.ifBlank { null } ?: doc.id,
        slug = doc.string("slug")?.ifBlank { null },
        fields = (doc.data["fields"] as? List<*>)?.mapNotNull { entry ->
          val field = entry as? Map<*, *> ?: return@mapNotNull null
          val name = field["fieldName"] as? String ?: return@mapNotNull null
          FormFieldDecl(
            name = name,
            label = (field["label"] as? String)?.ifBlank { null } ?: name,
            type = field["fieldType"] as? String ?: "text",
            required = field["required"] == true,
            role = field["role"] as? String,
            options = (field["options"] as? List<*>)?.mapNotNull { it?.toString() }.orEmpty(),
          )
        }.orEmpty(),
        routing = (doc.data["routing"] as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value }.orEmpty(),
        consentFieldName = doc.string("consentFieldName")?.ifBlank { null },
        retired = doc.bool("retired") == true || doc.data["archivedAt"] != null,
        versionId = doc.string("versionId")?.ifBlank { null },
        submissions = stat("submissions"),
        leads = stat("leads"),
        views = stat("views"),
        lastSubmissionAtMs = stat("lastSubmissionAtMs"),
        updatedAt = doc.data["updatedAt"] as? FirestoreTimestamp,
        campaignCount = (doc.data["campaignIds"] as? List<*>)?.size ?: 0,
      )
    }
  }
}

/** The chips above the list: forms in use (the console's default), retired ones, or all. */
enum class FormStatusFilter(val label: String) { IN_USE("In use"), RETIRED("Retired"), ALL("All") }

fun formsRequest(status: FormStatusFilter, search: String): ListQueryRequest = ListQueryRequest(
  base = if (status == FormStatusFilter.IN_USE) listOf(Contracts.formInUse) else null,
  clauses = if (status == FormStatusFilter.RETIRED) listOf(ListFilterRequest("status", "equals", "true")) else emptyList(),
  search = search.trim().ifEmpty { null }?.let { listOf(it) },
)

fun formsQuery(hostId: String, status: FormStatusFilter, search: String, after: List<Any?>? = null) =
  planListQuery(Contracts.formListQuery, formsRequest(status, search)).toFirestoreQuery(formsPath(hostId), FORMS_PAGE_SIZE, after)

/** The list keys a form's name and slug are found by (`formListFields`). */
fun formListFields(id: String, name: String, slug: String?): Map<String, Any?> = displayNameSearchFields(name) + mapOf(
  "searchTokens" to LinkedHashSet<String>().apply {
    addAll(nameSearchTokens(name))
    addAll(nameSearchTokens((slug ?: "").replace(Regex("-+"), " ")))
    addAll(nameSearchTokens(id))
  }.toList(),
)

/** A slug from a name (`normalizeFormSlug`). */
fun normalizeFormSlug(input: String): String = input.trim().lowercase()
  .replace(Regex("[^a-z0-9]+"), "-")
  .trim('-')
  .take(FORM_SLUG_MAX_LENGTH)
  .trimEnd('-')

class FormsModel(private val hostId: String, private val firestore: FirestoreReader, private val scope: CoroutineScope) {
  var status by mutableStateOf(FormStatusFilter.IN_USE)
    private set
  var search by mutableStateOf("")
    private set
  var rows by mutableStateOf<Load<List<FormRow>>>(Load.Loading)
    private set
  var hasMore by mutableStateOf(false)
    private set
  var refreshing by mutableStateOf(false)
    private set
  private var cursor: List<Any?>? = null
  private var job: Job? = null

  fun pick(next: FormStatusFilter) { if (next != status) { status = next; reload() } }
  fun type(next: String) { if (next != search) { search = next; reload(debounce = true) } }
  fun refresh() { refreshing = true; reload(keep = true) }

  fun reload(debounce: Boolean = false, keep: Boolean = false) {
    job?.cancel()
    if (!keep && !debounce) rows = Load.Loading
    job = scope.launch {
      if (debounce) delay(300)
      if (!keep) rows = Load.Loading
      rows = try {
        val page = firestore.page(formsQuery(hostId, status, search))
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        Load.Ready(page.docs.map(FormRow::from))
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        hasMore = false
        Load.Failed("Forms could not be loaded. Check the connection and try again.")
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
      runCatching { firestore.page(formsQuery(hostId, status, search, after)) }.onSuccess { page ->
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        rows = Load.Ready(shown + page.docs.map(FormRow::from).filter { row -> shown.none { it.id == row.id } })
      }
    }
  }
}

/** A promote refused by the form's contract: what to go and fix in the Besigner. */
class FormPromoteRefused(message: String, val violations: List<String>) : Exception(message)

class FormsApi(private val api: ConsoleApiClient, private val writer: FirestoreWriter, private val hostId: String) {
  private fun path(id: String) = "${formsPath(hostId)}/$id"

  /** A new form with the form element its Besigner opens on; answers its id. */
  suspend fun create(name: String): String {
    val id = newDocumentId()
    api.request(
      "/api/hosts/resources",
      ApiMethod.POST,
      jsonBody(
        "hostId" to hostId,
        "resource" to "form",
        "id" to id,
        "data" to mapOf(
          "displayName" to name.trim(),
          "slug" to normalizeFormSlug(name).ifEmpty { id },
          "fields" to emptyList<Any>(),
          "rootId" to FORM_CANVAS_ROOT,
          "nodes" to mapOf(
            FORM_CANVAS_ROOT to mapOf("\$id" to FORM_CANVAS_ROOT, "componentId" to "div", "nodes" to listOf("formRoot")),
            "formRoot" to mapOf(
              "\$id" to "formRoot",
              "componentId" to "form",
              "pluginId" to FORMS_BUNDLE_ID,
              "parentId" to FORM_CANVAS_ROOT,
              "props" to mapOf("formId" to id, "formName" to name.trim()),
              "nodes" to emptyList<Any>(),
            ),
          ),
        ),
      ),
    )
    return id
  }

  suspend fun duplicate(sourceId: String, name: String): String? = api.request(
    "/api/hosts/resources",
    ApiMethod.POST,
    jsonBody("hostId" to hostId, "resource" to "form", "action" to "duplicate", "sourceId" to sourceId, "name" to name.trim().ifEmpty { null }, "attemptKey" to newDocumentId()),
  ).field("id")

  suspend fun rename(form: FormRow, name: String) {
    writer.update(path(form.id), mapOf("displayName" to name.trim()) + formListFields(form.id, name.trim(), form.slug) + ("updatedAt" to firestoreNow()))
  }

  /** Retires a form (kept, out of the list) or brings it back, as the list's own switch does. */
  suspend fun setRetired(id: String, retired: Boolean) {
    writer.update(path(id), mapOf("archivedAt" to if (retired) nowMillis() else null, "retired" to retired, "updatedAt" to firestoreNow()))
  }

  /** The CRM routing: the lead switch and the consent field together, then the counters recounted. */
  suspend fun saveRouting(form: FormRow, lead: Boolean, consentFieldName: String?) {
    writer.update(
      path(form.id),
      mapOf("routing" to form.routing + ("lead" to lead), "consentFieldName" to (consentFieldName ?: "").trim(), "updatedAt" to firestoreNow()),
    )
    if (lead != form.routesLeads) recount(form.id)
  }

  suspend fun recount(formId: String) {
    runCatching { api.request("/api/forms/stats", ApiMethod.POST, jsonBody("hostId" to hostId, "formIds" to listOf(formId))) }
  }

  /** Makes [versionId] the form's published version, or answers what the contract refused. */
  suspend fun promote(formId: String, versionId: String) {
    try {
      api.request("/api/forms/promote", ApiMethod.POST, jsonBody("hostId" to hostId, "formId" to formId, "versionId" to versionId))
    } catch (error: ConsoleApiError) {
      val violations = ((error.body as? JsonObject)?.get("violations") as? JsonArray)?.mapNotNull { entry ->
        (entry as? JsonPrimitive)?.content ?: ((entry as? JsonObject)?.get("message") as? JsonPrimitive)?.content
      }.orEmpty()
      if (violations.isNotEmpty()) throw FormPromoteRefused(error.message, violations)
      throw error
    }
  }

  /** The version to open in the Besigner: [preferred], else a first one minted for a form that has none. */
  suspend fun versionToOpen(form: FormRow, preferred: String?): String {
    preferred?.let { return it }
    form.versionId?.let { return it }
    val versionId = newDocumentId()
    api.request(
      "/api/hosts/versions",
      ApiMethod.POST,
      jsonBody(
        "hostId" to hostId,
        "kind" to "form",
        "parentId" to form.id,
        "id" to versionId,
        "data" to mapOf(
          "formId" to form.id,
          "hostId" to hostId,
          "displayName" to "Initial version",
          "rootId" to FORM_CANVAS_ROOT,
          "nodes" to mapOf(FORM_CANVAS_ROOT to mapOf("\$id" to FORM_CANVAS_ROOT, "componentId" to "div", "nodes" to emptyList<Any>())),
        ),
      ),
    )
    writer.update(path(form.id), mapOf("versionId" to versionId, "updatedAt" to firestoreNow()))
    return versionId
  }
}

/** The Besigner page for one version of a form, under the picked site. */
fun formBesignerPath(formId: String, versionId: String) = "/$FORMS_DOCUMENT_SEGMENT/$formId/versions/$versionId/besigner"
