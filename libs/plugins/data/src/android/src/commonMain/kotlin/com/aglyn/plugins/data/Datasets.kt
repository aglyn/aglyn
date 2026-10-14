package com.aglyn.plugins.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.DatasetFieldDefinition
import com.aglyn.contracts.DatasetFieldDefinitionReference
import com.aglyn.contracts.DatasetFieldDefinitionReferenceOnDelete
import com.aglyn.contracts.DatasetFieldType
import com.aglyn.contracts.DatasetModel
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.field
import com.aglyn.core.jsonBody
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.core.plainJson
import com.aglyn.ui.Load
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * The workspace's datasets (`orgs/{orgId}/datasets`, records under each) as
 * the console's Data card reads and changes them: the list a member can see
 * (their scope tokens unless they reach every site), a dataset's records one
 * query at a time (`planDatasetRecordQuery`), creates and record edits and
 * deletes through `/api/orgs/datasets`, a dataset's delete through the erase
 * route, and its schema as the same document update the Schema dialog makes.
 */

const val RECORDS_PAGE_SIZE = 25

/** The picker's window: the console lists at most this many datasets. */
const val DATASETS_LIMIT = 100

fun datasetsPath(orgId: String) = "orgs/$orgId/datasets"

fun recordsPath(orgId: String, datasetId: String) = "${datasetsPath(orgId)}/$datasetId/records"

/** The sentence that says who a new dataset is shared with (`newDatasetSharingNote`). */
fun newDatasetSharingNote(siteOnly: Boolean): String = if (siteOnly) {
  "Datasets belong to your organization. Your default sharing starts a new one on this site only — use Schema to share it with more."
} else {
  "Datasets belong to your organization. A new one is shared with every site — use Schema to narrow that."
}

/** One dataset as the list and its pages read it. */
data class DatasetRow(
  val id: String,
  val name: String,
  val model: DatasetModel,
  /** The stored model's field maps, kept so a schema save never drops a key this app does not edit. */
  val rawFields: Map<String, Map<String, Any?>>,
  val singular: String,
  val plural: String,
  /** The sharing scope as stored; null when the document stores none. */
  val visibleTo: List<String>?,
  val updatedAt: FirestoreTimestamp?,
) {
  /** The other datasets' reference fields that point here. */
  fun referencedBy(others: List<DatasetRow>): List<Pair<DatasetRow, String>> = others.flatMap { other ->
    other.model.orderedFields().filter { (_, field) -> field.type == DatasetFieldType.REFERENCE && field.reference?.datasetId == id }.map { other to it.first }
  }

  companion object {
    fun from(doc: FirestoreDoc): DatasetRow {
      val names = doc.data["names"] as? Map<*, *>
      @Suppress("UNCHECKED_CAST")
      val rawFields = ((doc.data["model"] as? Map<*, *>)?.get("fields") as? Map<*, *>)
        ?.entries?.mapNotNull { (key, value) -> (value as? Map<String, Any?>)?.let { key.toString() to it } }?.toMap().orEmpty()
      return DatasetRow(
        id = doc.id,
        name = datasetDisplayName(doc.data).ifEmpty { doc.id },
        model = effectiveDatasetModel(doc.data),
        rawFields = rawFields,
        singular = names?.get("singular") as? String ?: "",
        plural = (names?.get("plural") as? String)?.ifEmpty { null } ?: datasetDisplayName(doc.data),
        visibleTo = (doc.data["visibleTo"] as? List<*>)?.filterIsInstance<String>()?.takeIf { it.isNotEmpty() },
        updatedAt = doc.data["updatedAt"] as? FirestoreTimestamp,
      )
    }
  }
}

/** One record: its stored values and when it last changed. */
data class RecordRow(val id: String, val values: Map<String, Any?>, val updatedAt: FirestoreTimestamp?, val createdAt: FirestoreTimestamp?) {
  /** The record's title in a list: the first field with a value, else its id. */
  fun title(model: DatasetModel): String =
    model.orderedFields().firstNotNullOfOrNull { (id, field) -> formatDatasetValue(field, values[id]).takeIf { it.isNotBlank() } } ?: id

  /** A line under the title: the next two fields with values. */
  fun supporting(model: DatasetModel): String? = model.orderedFields()
    .mapNotNull { (id, field) -> formatDatasetValue(field, values[id]).takeIf { it.isNotBlank() }?.let { "${field.label(id)}: $it" } }
    .drop(1).take(2).joinToString(" · ").ifEmpty { null }

  companion object {
    fun from(doc: FirestoreDoc): RecordRow {
      @Suppress("UNCHECKED_CAST")
      return RecordRow(doc.id, (doc.data["values"] as? Map<String, Any?>).orEmpty(), doc.data["updatedAt"] as? FirestoreTimestamp, doc.data["createdAt"] as? FirestoreTimestamp)
    }
  }
}

/** The datasets a member can list: everything for an org-wide member, their scope's otherwise (the rules refuse an unfiltered list). */
fun datasetsQuery(orgId: String, scopeTokens: List<String>?): FirestoreQuery = FirestoreQuery(
  datasetsPath(orgId),
  filters = scopeTokens?.let { listOf(FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, it)) }.orEmpty(),
  limit = DATASETS_LIMIT,
)

/** One page of a dataset's records under [clauses] and [search]. */
fun recordsQuery(orgId: String, datasetId: String, model: DatasetModel, clauses: List<ListFilterRequest>, search: String, after: List<Any?>? = null): FirestoreQuery =
  planDatasetRecordQuery(model, clauses, searchWords(search)).plan.toFirestoreQuery(recordsPath(orgId, datasetId), RECORDS_PAGE_SIZE, after)

/** The quick search's words, as the grid splits what was typed. */
fun searchWords(search: String): List<String> = search.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }

/** A dataset's records, one query at a time, as the records table pages them. */
class RecordsModel(
  private val orgId: String,
  private val dataset: DatasetRow,
  private val firestore: FirestoreReader,
  private val scope: CoroutineScope,
) {
  var search by mutableStateOf("")
    private set
  var clauses by mutableStateOf<List<ListFilterRequest>>(emptyList())
    private set
  var rows by mutableStateOf<Load<List<RecordRow>>>(Load.Loading)
    private set
  var hasMore by mutableStateOf(false)
    private set
  var refreshing by mutableStateOf(false)
    private set
  /** What the reader asked that the query could not hold, and what it served differently. */
  var plan by mutableStateOf(planDatasetRecordQuery(dataset.model, emptyList(), emptyList()))
    private set
  private var cursor: List<Any?>? = null
  private var job: Job? = null

  val filtering: Boolean get() = clauses.isNotEmpty() || search.isNotBlank()

  fun type(next: String) { if (next != search) { search = next; reload(debounce = true) } }
  fun setFilters(next: List<ListFilterRequest>) { if (next != clauses) { clauses = next; reload() } }
  fun refresh() { refreshing = true; reload(keep = true) }

  fun reload(debounce: Boolean = false, keep: Boolean = false) {
    job?.cancel()
    plan = planDatasetRecordQuery(dataset.model, clauses, searchWords(search))
    if (!keep && !debounce) rows = Load.Loading
    job = scope.launch {
      if (debounce) delay(300)
      if (!keep) rows = Load.Loading
      rows = try {
        val page = firestore.page(recordsQuery(orgId, dataset.id, dataset.model, clauses, search))
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        Load.Ready(page.docs.map(RecordRow::from))
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        hasMore = false
        Load.Failed("Records could not be loaded. Check the connection and try again.")
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
      runCatching { firestore.page(recordsQuery(orgId, dataset.id, dataset.model, clauses, search, after)) }.onSuccess { page ->
        cursor = page.nextCursor
        hasMore = page.nextCursor != null
        rows = Load.Ready(shown + page.docs.map(RecordRow::from).filter { row -> shown.none { it.id == row.id } })
      }
    }
  }
}

/** A record the route refused field by field: each field's error, keyed by field id. */
class RecordInvalid(message: String, val errors: Map<String, String>) : Exception(message)

/** A reference field's choices: the target dataset's first records, labelled by its display field. */
data class ReferenceChoice(val id: String, val label: String)

/** The plain JSON a write sends for [model]. */
@Suppress("UNCHECKED_CAST")
fun modelJson(model: DatasetModel): Map<String, Any?> =
  plainJson(ContractJsonFormat.encodeToJsonElement(DatasetModel.serializer(), model)) as Map<String, Any?>

/** The keys of a field the schema editor owns; any other stored key is kept as it is. */
private val EDITED_FIELD_KEYS = setOf("name", "type", "required", "description", "validation", "reference", "default")

/** [model] as stored, each field's edited keys laid over what the document already held. */
@Suppress("UNCHECKED_CAST")
fun schemaModelJson(model: DatasetModel, rawFields: Map<String, Map<String, Any?>>): Map<String, Any?> {
  val encoded = modelJson(model)
  val fields = (encoded["fields"] as? Map<String, Any?>).orEmpty().mapValues { (id, value) ->
    (rawFields[id].orEmpty() - EDITED_FIELD_KEYS) + (value as? Map<String, Any?>).orEmpty()
  }
  return mapOf("fields" to fields, "order" to model.order.orEmpty())
}

/** A join collection's model: a required reference into each side (`handleCreateJoin`). */
fun joinModel(a: DatasetRow, b: DatasetRow): DatasetModel {
  fun side(target: DatasetRow) = DatasetFieldDefinition(
    name = target.name,
    type = DatasetFieldType.REFERENCE,
    required = true,
    reference = DatasetFieldDefinitionReference(datasetId = target.id, displayFieldId = target.model.order?.firstOrNull(), onDelete = DatasetFieldDefinitionReferenceOnDelete.SET_NULL),
  )
  return DatasetModel(fields = mapOf("aRef" to side(a), "bRef" to side(b)), order = listOf("aRef", "bRef"))
}

class DataApi(private val api: ConsoleApiClient, private val writer: FirestoreWriter, private val orgId: String) {
  private suspend fun call(vararg fields: Pair<String, Any?>) = try {
    api.request("/api/orgs/datasets", ApiMethod.POST, jsonBody("orgId" to orgId, *fields))
  } catch (error: ConsoleApiError) {
    val errors = ((error.body as? JsonObject)?.get("errors") as? JsonObject)?.mapValues { (it.value as? JsonPrimitive)?.content ?: "" }
    if (!errors.isNullOrEmpty()) throw RecordInvalid(error.message, errors)
    throw error
  }

  /** A new dataset from a name and comma-separated column names; answers its id. [hostId] is the site it is made from. */
  suspend fun createDataset(name: String, columns: String, hostId: String?): String {
    val entries = parseDatasetFieldEntries(columns)
    return call(
      "action" to "create-dataset",
      "displayName" to name.trim(),
      "fields" to entries.map { it.id },
      "model" to modelJson(modelFromFieldEntries(entries)),
      "hostId" to hostId,
    ).field("id") ?: error("The dataset was not created.")
  }

  suspend fun createJoin(a: DatasetRow, b: DatasetRow, hostId: String?): String = call(
    "action" to "create-dataset",
    "displayName" to "${a.name} ↔ ${b.name}",
    "fields" to listOf("aRef", "bRef"),
    "model" to modelJson(joinModel(a, b)),
    "hostId" to hostId,
  ).field("id") ?: error("The join collection was not created.")

  /** A new record from its inputs' text; the route coerces and validates it against the model. */
  suspend fun createRecord(datasetId: String, values: Map<String, String>): String? =
    call("action" to "create-record", "datasetId" to datasetId, "values" to values).field("id")

  suspend fun updateRecord(datasetId: String, recordId: String, values: Map<String, String>) {
    call("action" to "update-record", "datasetId" to datasetId, "recordId" to recordId, "values" to values)
  }

  /** Deletes a record, stripping or refusing on the references to it as the console does. */
  suspend fun deleteRecord(datasetId: String, recordId: String) {
    call("action" to "delete-record", "datasetId" to datasetId, "recordId" to recordId)
  }

  /** Deletes a dataset and its records through the erase route; [hostId] names the site it was asked from. */
  suspend fun deleteDataset(datasetId: String, hostId: String?) {
    api.request(
      "/api/resources/erase",
      ApiMethod.POST,
      jsonBody("scope" to "orgs", "scopeId" to orgId, "kind" to "datasets", "id" to datasetId, "hostId" to hostId),
    )
  }

  /** The Schema dialog's save: the model, its names and (for an org-wide member) the sharing scope. */
  suspend fun saveSchema(dataset: DatasetRow, model: DatasetModel, singular: String, plural: String, visibleTo: List<String>?) {
    val data = linkedMapOf<String, Any?>(
      "model" to schemaModelJson(model, dataset.rawFields),
      "names" to mapOf("singular" to singular.trim(), "plural" to plural.trim()),
      "fields" to model.order.orEmpty(),
    )
    if (plural.isNotBlank()) data["displayName"] = plural.trim()
    if (visibleTo != null) data["visibleTo"] = visibleTo
    writer.update("${datasetsPath(orgId)}/${dataset.id}", data)
  }
}
