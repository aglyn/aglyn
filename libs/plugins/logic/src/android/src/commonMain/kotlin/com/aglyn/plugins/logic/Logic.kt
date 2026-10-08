package com.aglyn.plugins.logic

import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.FunctionComparator
import com.aglyn.contracts.FunctionConditionalOperation
import com.aglyn.contracts.FunctionConditionalOperationIf
import com.aglyn.contracts.FunctionSetOperation
import com.aglyn.contracts.FunctionValueType
import com.aglyn.contracts.HostFunction
import com.aglyn.contracts.HostFunctionParameter
import com.aglyn.contracts.HostFunctionParameterOption
import com.aglyn.contracts.HostFunctionVariable
import com.aglyn.contracts.HostVariableType
import com.aglyn.contracts.WhereUsedResult
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.decode
import com.aglyn.core.firestoreNow
import com.aglyn.core.jsonBody
import com.aglyn.core.plainJson
import com.aglyn.pluginhost.jsString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/*
 * A site's variables and no-code functions (`hosts/{hostId}/variables`,
 * `hosts/{hostId}/functions`) as the console's Functions & Variables page
 * reads and changes them: the first 100 of each by document id, the deleted
 * ones hidden; a new one through the quota-enforcing resources route, an
 * edit as the same merge the cards make and a delete as their soft delete,
 * each followed by the site's cache drop. Where a variable or function is
 * used is the console's own scan (`/api/hosts/where-used`).
 */

/** The cards' window: at most this many rows are read, and a fuller collection says so. */
const val LOGIC_CEILING = 100

fun variablesPath(hostId: String) = "hosts/$hostId/variables"

fun functionsPath(hostId: String) = "hosts/$hostId/functions"

/** The cards' read: the first rows by document id, one past the ceiling to know it was cut. */
fun ceilingQuery(path: String) = FirestoreQuery(path, orderBy = listOf(FirestoreOrder("__name__")), limit = LOGIC_CEILING + 1)

/** A variable as its card lists it. */
data class VariableRow(
  val id: String,
  val name: String,
  val type: HostVariableType,
  val value: String,
  val workflowId: String,
  val workflowName: String,
  val updatedAt: FirestoreTimestamp?,
) {
  companion object {
    fun from(doc: FirestoreDoc): VariableRow = VariableRow(
      id = doc.id,
      name = doc.string("name").orEmpty(),
      type = HostVariableType.entries.firstOrNull { it.raw == doc.string("type") } ?: HostVariableType.TEXT,
      value = doc.string("value").orEmpty(),
      workflowId = doc.string("workflowId").orEmpty(),
      workflowName = doc.string("workflowName").orEmpty(),
      updatedAt = doc.data["updatedAt"] as? FirestoreTimestamp,
    )
  }
}

/** A function as its card lists it, with the definition its editor opens. */
data class FunctionRow(val id: String, val definition: HostFunction) {
  val name: String get() = definition.name.orEmpty()

  /** "P1, P2 → result", as the card's caption reads. */
  val signature: String
    get() = (definition.parameters.orEmpty().mapNotNull { it.name }.joinToString(", ").ifEmpty { "no parameters" }) +
      " → " + (definition.returnValue?.ifEmpty { null } ?: "—")

  companion object {
    fun from(doc: FirestoreDoc): FunctionRow = FunctionRow(doc.id, doc.decode(HostFunction.serializer()) ?: HostFunction(name = doc.string("name")))
  }
}

/** The live rows of a card's window: deleted ones hidden, the rest by name; and whether the window was cut. */
fun <T> liveWindow(docs: List<FirestoreDoc>, read: (FirestoreDoc) -> T, name: (T) -> String): Pair<List<T>, Boolean> {
  val truncated = docs.size > LOGIC_CEILING
  val rows = docs.take(LOGIC_CEILING).filter { it.data["deletedAt"] == null }.map(read).sortedBy { name(it).lowercase() }
  return rows to truncated
}

/* ---- Ports of the console's pure helpers (LogicCasesTest replays their answers). ---- */

private val VARIABLE_NAME = Regex("^[a-zA-Z_][a-zA-Z0-9_]{0,39}$")

/** Whether a name may name a variable or a parameter (`isVariableName`). */
fun isVariableName(name: String): Boolean = VARIABLE_NAME.matches(name)

private val MONTHS = listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
private val DAY_OR_INSTANT = Regex("^(\\d{4})-(\\d{2})-(\\d{2})(?:T(\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})?)?$")

/** A variable's value as text binding renders it (`formatVariableValue`); a date in UTC, as `March 1, 2026`. */
fun formatVariableValue(type: HostVariableType, raw: String): String = when (type) {
  HostVariableType.BOOLEAN -> if (raw == "true") "true" else "false"
  HostVariableType.NUMBER -> {
    val trimmed = raw.trim()
    val number = if (trimmed.isEmpty()) 0.0 else trimmed.toDoubleOrNull()
    number?.takeIf { it.isFinite() }?.let { com.aglyn.pluginhost.jsNumber(it) } ?: ""
  }
  HostVariableType.DATE -> DAY_OR_INSTANT.matchEntire(raw.trim())?.let { match ->
    val (year, month, day) = match.destructured
    val m = month.toInt()
    if (m in 1..12 && day.toInt() in 1..31) "${MONTHS[m - 1]} ${day.toInt()}, ${year.toInt()}" else null
  } ?: raw
  HostVariableType.DICTIONARY, HostVariableType.COLLECTION -> runCatching { plainJson(Json.parseToJsonElement(raw)) }.getOrNull().let { parsed ->
    when (parsed) {
      is List<*> -> parsed.joinToString(", ") { jsString(it) }
      is Map<*, *> -> parsed.entries.joinToString(", ") { (key, value) -> "$key: ${jsString(value)}" }
      else -> raw
    }
  }
  else -> raw
}

/** "value: Label, value" → the options, duplicates dropped (`parseFunctionParameterOptions`). */
fun parseFunctionParameterOptions(text: String?): List<HostFunctionParameterOption> {
  val options = mutableListOf<HostFunctionParameterOption>()
  val seen = HashSet<String>()
  for (part in (text ?: "").split(',')) {
    val colon = part.indexOf(':')
    val value = (if (colon < 0) part else part.substring(0, colon)).trim()
    if (value.isEmpty() || !seen.add(value)) continue
    val label = if (colon < 0) "" else part.substring(colon + 1).trim()
    options += if (label.isNotEmpty() && label != value) HostFunctionParameterOption(label = label, value = value) else HostFunctionParameterOption(value = value)
  }
  return options
}

/** The options as their one line of text (`formatFunctionParameterOptions`). */
fun formatFunctionParameterOptions(options: List<HostFunctionParameterOption>?): String =
  options.orEmpty().joinToString(", ") { option -> if (!option.label.isNullOrEmpty() && option.label != option.value) "${option.value}: ${option.label}" else option.value }

/** `2 pages, 1 workflow` (`summarizeDependents`). */
fun summarizeDependents(result: WhereUsedResult): String {
  val counts = LinkedHashMap<String, Int>()
  for (dependent in result.dependents.orEmpty()) {
    val label = if (dependent.type == "screen") "page" else dependent.type.orEmpty()
    counts[label] = (counts[label] ?: 0) + 1
  }
  return counts.entries.joinToString(", ") { (label, count) -> "$count $label${if (count == 1) "" else "s"}" }
}

/* ---- The function editor's starting points (`emptyDraft`). ---- */

fun newOperation() = FunctionConditionalOperation(
  `if` = FunctionConditionalOperationIf(comparator = FunctionComparator.LESS_THAN_OR_EQUAL, left = "", right = ""),
  then = listOf(FunctionSetOperation(set = "", expression = "")),
  otherwise = emptyList(),
)

fun emptyFunction() = HostFunction(
  name = "",
  parameters = listOf(HostFunctionParameter(name = "P1", type = FunctionValueType.NUMBER, required = true)),
  variables = listOf(HostFunctionVariable(name = "P3", type = FunctionValueType.NUMBER)),
  operations = listOf(newOperation()),
  returnValue = "",
)

/** The names a SET row and the return value may pick: the parameters' and variables' valid names. */
fun HostFunction.assignableNames(): List<String> =
  (parameters.orEmpty().mapNotNull { it.name } + variables.orEmpty().mapNotNull { it.name }).filter(::isVariableName)

/** The definition a save writes: the name trimmed and cut to 60, every list present. */
@Suppress("UNCHECKED_CAST")
fun functionSaveFields(definition: HostFunction): Map<String, Any?> {
  val clean = definition.copy(
    name = definition.name.orEmpty().trim().take(60),
    parameters = definition.parameters.orEmpty(),
    variables = definition.variables.orEmpty(),
    operations = definition.operations.orEmpty(),
    returnValue = definition.returnValue.orEmpty(),
  )
  return plainJson(ContractJsonFormat.encodeToJsonElement(HostFunction.serializer(), clean)) as Map<String, Any?>
}

class LogicApi(private val api: ConsoleApiClient, private val writer: FirestoreWriter, private val hostId: String) {
  /** A new variable or function through the quota-enforcing resources route. */
  suspend fun create(resource: String, data: Map<String, Any?>) {
    api.request("/api/hosts/resources", ApiMethod.POST, jsonBody("hostId" to hostId, "resource" to resource, "data" to data))
  }

  suspend fun saveVariable(id: String?, name: String, type: HostVariableType, value: String, workflowId: String, workflowName: String) {
    val fields = mapOf("name" to name, "type" to type.raw, "value" to value, "workflowId" to workflowId.trim(), "workflowName" to workflowName.trim())
    if (id == null) create("variable", fields) else change("${variablesPath(hostId)}/$id", fields + ("updatedAt" to firestoreNow()))
  }

  suspend fun saveFunction(id: String?, definition: HostFunction) {
    val fields = functionSaveFields(definition)
    if (id == null) create("function", fields) else change("${functionsPath(hostId)}/$id", fields + ("updatedAt" to firestoreNow()))
  }

  /** The cards' soft delete: the row stays, marked deleted, and leaves every list. */
  suspend fun delete(path: String) = change(path, mapOf("deletedAt" to firestoreNow()))

  /** Where a variable or function is used, failing open as the console's client does. */
  suspend fun whereUsed(kind: String, id: String, name: String): WhereUsedResult = runCatching {
    val answer = api.request("/api/hosts/where-used", ApiMethod.POST, jsonBody("hostId" to hostId, "kind" to kind, "id" to id, "name" to name))
    ContractJsonFormat.decodeFromJsonElement(WhereUsedResult.serializer(), answer ?: JsonObject(emptyMap()))
  }.getOrElse { WhereUsedResult(dependents = emptyList(), total = 0, legacyCount = 0) }

  /**
   * A change a published page renders, as `writeSiteWideChange` makes it:
   * the write, then the site's cache dropped (`/api/screens/revalidate`,
   * every page). The outbox entry the browser stages beside it carries a
   * server timestamp the app cannot write, which is the console's own
   * fallback when that entry is refused: the write alone, then the drop.
   */
  private suspend fun change(path: String, fields: Map<String, Any?>) {
    writer.merge(path, fields)
    runCatching { api.request("/api/screens/revalidate", ApiMethod.POST, jsonBody("hostId" to hostId, "entireHost" to true)) }
  }
}

/** A dependent's Besigner page, for a published page or layout the scan names. */
fun dependentBesignerPath(type: String?, id: String?, versionId: String?): String? {
  if (id.isNullOrEmpty() || versionId.isNullOrEmpty()) return null
  return when (type) {
    "screen" -> "/screens/$id/versions/$versionId/besigner"
    "layout" -> "/layouts/$id/versions/$versionId/besigner"
    else -> null
  }
}
