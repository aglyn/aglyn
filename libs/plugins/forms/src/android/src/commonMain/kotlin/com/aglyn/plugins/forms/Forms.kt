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
  /** "This is a sign-up form": submitting it subscribes the person (`optInOnSubmit`). */
  val optInOnSubmit: Boolean = false,
  /** "This form asks for a quote" (`request.kind == 'quote'`, AGL-4098). */
  val asksForQuote: Boolean = false,
  /** "Email the person a confirmation" as stored; null follows the request's default. */
  val confirmationEmail: Boolean? = null,
  /** The month counters (`stats.periods`), `YYYY-MM` to each counter. */
  val periods: Map<String, Map<String, Double>> = emptyMap(),
) {
  val routesLeads: Boolean get() = routing["lead"] == true

  /** Whether a submission emails the person a confirmation (`formSendsConfirmation`): the stored choice, else on for a quote request. */
  fun sendsConfirmation(asksForQuote: Boolean = this.asksForQuote): Boolean = confirmationEmail ?: asksForQuote

  /** A field the published design draws can carry an email address (`formFieldsCanYieldAnEmail`). */
  val hasEmailField: Boolean get() = fields.any { it.type == "email" || it.name.contains("email", ignoreCase = true) }

  val hasFileField: Boolean get() = fields.any { it.type == "file" }

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
        optInOnSubmit = doc.data["optInOnSubmit"] == true,
        asksForQuote = (doc.data["request"] as? Map<*, *>)?.get("kind") == "quote",
        confirmationEmail = doc.data["confirmationEmail"] as? Boolean,
        periods = (stats?.get("periods") as? Map<*, *>)?.entries?.mapNotNull { (key, value) ->
          val month = value as? Map<*, *> ?: return@mapNotNull null
          key.toString() to month.entries.mapNotNull { (k, v) -> (v as? Number)?.let { k.toString() to it.toDouble() } }.toMap()
        }?.toMap().orEmpty(),
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
  suspend fun saveRouting(form: FormRow, lead: Boolean, consentFieldName: String?, optInOnSubmit: Boolean? = null) {
    writer.update(
      path(form.id),
      buildMap {
        put("routing", form.routing + ("lead" to lead))
        put("consentFieldName", (consentFieldName ?: "").trim())
        if (optInOnSubmit != null) put("optInOnSubmit", optInOnSubmit)
        put("updatedAt", firestoreNow())
      },
    )
    if (lead != form.routesLeads) recount(form.id)
  }

  /**
   * What happens after someone sends the form (AGL-4098): whether it asks for a quote, and whether the person is emailed
   * a confirmation; only what changed is written, as the console's card saves it.
   */
  suspend fun saveResponses(form: FormRow, asksForQuote: Boolean?, confirms: Boolean?) {
    writer.update(
      path(form.id),
      buildMap {
        if (asksForQuote != null) put("request", if (asksForQuote) mapOf("kind" to "quote") else null)
        if (confirms != null) put("confirmationEmail", confirms)
        put("updatedAt", firestoreNow())
      },
    )
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

  /**
   * The version to open in the Besigner: an existing one ([existingFormVersion]), else a first one minted for a form
   * that has none, which the form then points at.
   */
  suspend fun versionToOpen(form: FormRow, preferred: String?, newest: String? = null): String {
    existingFormVersion(form, preferred, newest)?.let { return it }
    val versionId = newDocumentId()
    api.request("/api/hosts/versions", ApiMethod.POST, formFirstVersionBody(hostId, form.id, versionId))
    writer.update(path(form.id), mapOf("versionId" to versionId, "updatedAt" to firestoreNow()))
    return versionId
  }
}

/**
 * The version the Besigner opens on without minting one, as the console's Design in the Besigner picks it
 * (`form-detail-card.tsx`): [preferred], else the published one, else the newest saved one (AGL-4002).
 */
fun existingFormVersion(form: FormRow, preferred: String? = null, newest: String? = null): String? =
  preferred ?: form.versionId ?: newest

/**
 * The versions-route body for a form's FIRST version. The route seeds it from the form's own stored design
 * (`seedFromParent`, as for a component), so the Besigner opens on the form element and its questions, never on an
 * empty canvas (AGL-4002).
 */
fun formFirstVersionBody(hostId: String, formId: String, versionId: String) =
  jsonBody("hostId" to hostId, "kind" to "form", "parentId" to formId, "id" to versionId, "seedFromParent" to true)

/** The Besigner page for one version of a form, under the picked site. */
fun formBesignerPath(formId: String, versionId: String, preview: Boolean = false) =
  "/$FORMS_DOCUMENT_SEGMENT/$formId/versions/$versionId/${if (preview) "preview" else "besigner"}"

/** One month of a form's history (`FormPeriodPoint`), every counter resolved to a number. */
data class FormPeriodPoint(val period: String, val views: Double, val starts: Double, val submissions: Double, val leads: Double)

private val FORM_PERIOD_KEY = Regex("^\\d{4}-(0[1-9]|1[0-2])$")

/** The month after `YYYY-MM`, or null for a key that is not one. */
private fun nextFormPeriod(period: String): String? {
  val parts = period.split("-")
  val year = parts.getOrNull(0)?.toIntOrNull() ?: return null
  val month = parts.getOrNull(1)?.toIntOrNull()?.takeIf { it in 1..12 } ?: return null
  return if (month == 12) "${year + 1}-01" else "$year-${(month + 1).toString().padStart(2, '0')}"
}

/**
 * The form's months from its first recorded one to its last, gaps filled with zeros, the latest [maxPeriods] kept
 * (`formPeriodSeries`): a month before the counter existed is never drawn as a zero.
 */
fun formPeriodSeries(periods: Map<String, Map<String, Double>>, maxPeriods: Int = 12): List<FormPeriodPoint> {
  val keys = periods.keys.filter { FORM_PERIOD_KEY.matches(it) }.sorted()
  if (keys.isEmpty()) return emptyList()
  val series = mutableListOf<FormPeriodPoint>()
  var cursor: String? = keys.first()
  var step = 0
  while (cursor != null && step <= 1200) {
    val month = periods[cursor].orEmpty()
    series += FormPeriodPoint(cursor, month["views"] ?: 0.0, month["starts"] ?: 0.0, month["submissions"] ?: 0.0, month["leads"] ?: 0.0)
    if (cursor == keys.last()) break
    cursor = nextFormPeriod(cursor)
    step++
  }
  return if (maxPeriods > 0 && series.size > maxPeriods) series.takeLast(maxPeriods) else series
}

/** The months a rate can be taken over (`formStatsWindow`): only those whose denominator ([over]) was recorded. */
data class FormStatsWindow(val periods: Int, val over: Double, val of: Double)

fun formStatsWindow(periods: Map<String, Map<String, Double>>, over: String, of: String): FormStatsWindow {
  var count = 0
  var total = 0.0
  var part = 0.0
  for (month in periods.values) {
    val denominator = month[over] ?: 0.0
    if (!denominator.isFinite() || denominator <= 0) continue
    count++
    total += denominator
    val numerator = month[of] ?: 0.0
    if (numerator.isFinite()) part += numerator
  }
  return FormStatsWindow(count, total, part)
}

/** A rate with what it was taken over (`measuredRate`). */
data class MeasuredRate(val value: Double, val numerator: Double, val denominator: Double, val denominatorLabel: String) {
  /** "42.5%" (`percent`). */
  val percent: String get() = "${kotlin.math.round(value * 1000) / 10}%"
  /** "17 of 40 views". */
  val detail: String get() = "${numerator.toLong()} of ${denominator.toLong()} $denominatorLabel"
}

fun measuredRate(numerator: Double?, denominator: Double?, label: String): MeasuredRate? {
  if (numerator == null || denominator == null || !numerator.isFinite() || !denominator.isFinite() || denominator <= 0) return null
  return MeasuredRate(numerator / denominator, numerator, denominator, label)
}

/** The rates the form's metrics card shows, as the console's `FormMetricsCard` takes them. */
data class FormRates(val completion: MeasuredRate?, val abandon: MeasuredRate?, val lead: MeasuredRate?) {
  companion object {
    fun of(form: FormRow): FormRates {
      val views = formStatsWindow(form.periods, "views", "submissions")
      val starts = formStatsWindow(form.periods, "starts", "submissions")
      return FormRates(
        completion = if (views.periods > 0) measuredRate(views.of, views.over, "views") else null,
        abandon = if (starts.periods > 0 && starts.over >= starts.of) measuredRate(starts.over - starts.of, starts.over, "starts") else null,
        lead = measuredRate(form.leads?.toDouble(), form.submissions?.toDouble(), "submissions"),
      )
    }
  }
}
