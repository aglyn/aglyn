package com.aglyn.plugins.data

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.DatasetFieldDefinition
import com.aglyn.contracts.DatasetFieldType
import com.aglyn.contracts.DatasetModel
import com.aglyn.contracts.ListFilterField
import com.aglyn.contracts.ListFilterKind
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryDeclaration
import com.aglyn.contracts.ListQueryDeclarationSearch
import com.aglyn.contracts.ListQueryPlan
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.contracts.ListQuerySort
import com.aglyn.contracts.ListQuerySortDirection
import com.aglyn.core.listquery.LIST_QUERY_ID_PATH
import com.aglyn.core.listquery.ListQueryNormalizers
import com.aglyn.core.listquery.planListQuery
import com.aglyn.pluginhost.jsNumber
import com.aglyn.pluginhost.FilterRefusal
import com.aglyn.ui.InputChoice
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * The records table is one query (AGL-3321), planned exactly as the console
 * plans it: `datasetRecordFilter` turns a model into a list declaration over
 * the records' `filterValues` and `filterKeys`, and `planDatasetRecordQuery`
 * (libs/plugins/data/src/lib/components/dataset-record-filter.ts) puts the
 * clauses and the search word on it through the shared planner. Ported once;
 * DataCasesTest replays the console's plans.
 */

private val PREFIX_MAX: Int get() = Contracts.datasetFilterPrefixMax.toInt()
private const val VALUE_MAX = 64
private const val WORDS_MAX = 40
private const val TOKENS_PATH = "filterKeys"

/** The grid column a field is shown in (`recordColumn`). */
fun recordColumn(fieldId: String) = "values.$fieldId"

private fun fieldIdOf(column: String) = column.removePrefix("values.")

/** Code points, as `Array.from` splits a string. */
private fun codePoints(text: String): List<String> {
  val out = mutableListOf<String>()
  var i = 0
  while (i < text.length) {
    val pair = text[i].isHighSurrogate() && i + 1 < text.length && text[i + 1].isLowSurrogate()
    out += text.substring(i, if (pair) i + 2 else i + 1)
    i += if (pair) 2 else 1
  }
  return out
}

private fun clip(text: String, max: Int) = codePoints(text).take(max).joinToString("")

private val WORD_BREAK = Regex("[^\\p{L}\\p{N}]+")

/** A text value's words: lower-cased, split on non-letters/digits, the first 40 (`datasetFilterWords`). */
fun datasetFilterWords(text: String): List<String> = text.lowercase().split(WORD_BREAK).filter { it.isNotEmpty() }.take(WORDS_MAX)

/** Plain text as its stored key (`datasetFilterTextKey`). */
fun datasetFilterTextKey(value: String): String = clip(value.trim().lowercase(), VALUE_MAX)

/** The quick-search token for a word, or null (`datasetSearchToken`). */
fun datasetSearchToken(word: String): String? = datasetFilterWords(word).firstOrNull()?.let { "s:" + clip(it, PREFIX_MAX) }

private val FILTER_VALUE_ID = Regex("^[^.~*/\\[\\]`]+$")
private val DUNDER = Regex("^__.*__$")

/** The `filterValues.<id>` path, or null for an id no path can name (`datasetFilterValuePath`). */
fun datasetFilterValuePath(fieldId: String): String? =
  if (FILTER_VALUE_ID.matches(fieldId) && !DUNDER.matches(fieldId)) "filterValues.$fieldId" else null

private fun isEnum(field: DatasetFieldDefinition) = field.type == DatasetFieldType.TEXT && !field.validation?.options.isNullOrEmpty()

private fun isNumeric(field: DatasetFieldDefinition) =
  field.type == DatasetFieldType.INT32 || field.type == DatasetFieldType.INT64 || field.type == DatasetFieldType.FLOAT

private fun numberKey(value: String): String? {
  val trimmed = value.trim()
  if (trimmed.isEmpty()) return null
  val number = trimmed.toDoubleOrNull()?.takeIf { it.isFinite() } ?: return null
  return jsNumber(number)
}

private fun boolKey(value: String): String? = if (value == "true" || value == "false") value else null

/** The `filterKeys` token a word-level clause asks for, or null (`datasetFilterToken`). */
fun datasetFilterToken(model: DatasetModel, fieldId: String, op: String, value: String): String? {
  val field = model.fields?.get(fieldId) ?: return null
  if (value.isBlank()) return null
  val equals = op == "equals" || op == "=" || op == "is"
  return when {
    field.type == DatasetFieldType.TEXT && isEnum(field) -> if (equals) "f:$fieldId=$value" else null
    field.type == DatasetFieldType.TEXT -> when {
      equals -> "f:$fieldId=${datasetFilterTextKey(value)}"
      op == "contains" -> datasetFilterWords(value).firstOrNull()?.let { "f:$fieldId^${clip(it, PREFIX_MAX)}" }
      else -> null
    }
    field.type == DatasetFieldType.BOOL -> boolKey(value.trim())?.takeIf { equals }?.let { "f:$fieldId=$it" }
    isNumeric(field) -> numberKey(value)?.takeIf { equals }?.let { "f:$fieldId=$it" }
    field.type == DatasetFieldType.SORTED -> if (equals || op == "contains") "f:$fieldId=${value.trim()}" else null
    else -> null
  }
}

/** How the records' filter fields were normalized, so the planner asks for what was stored. */
object DatasetRecordNormalizers : ListQueryNormalizers {
  override fun key(value: String) = datasetFilterTextKey(value)
  override fun token(value: String) = datasetSearchToken(value) ?: ""
  override fun reversed(value: String) = value
  override val maxPrefix: Int get() = PREFIX_MAX
}

/** What the records list offers for one model (`DatasetRecordFilter`). */
data class DatasetRecordFilter(
  val declaration: ListQueryDeclaration,
  val options: Map<String, List<InputChoice>>,
  val headers: Map<String, String>,
  val selectFields: List<String>,
) {
  val fields: List<ListFilterField> get() = declaration.fields
}

private val BOOLEAN_OPTIONS = listOf(InputChoice("true", "True"), InputChoice("false", "False"))

/** The model's fields as query fields (`datasetRecordFilter`). */
fun datasetRecordFilter(model: DatasetModel): DatasetRecordFilter {
  val fields = mutableListOf<ListFilterField>()
  val options = linkedMapOf<String, List<InputChoice>>()
  val headers = linkedMapOf<String, String>()
  val selectFields = mutableListOf<String>()
  for (fieldId in model.order.orEmpty()) {
    val field = model.fields?.get(fieldId) ?: continue
    val column = recordColumn(fieldId)
    val valuePath = datasetFilterValuePath(fieldId)
    val choices = if (field.type == DatasetFieldType.TEXT) field.validation?.options.orEmpty() else emptyList()
    val declared: ListFilterField? = when {
      field.type == DatasetFieldType.TEXT && choices.isNotEmpty() -> valuePath?.let {
        options[column] = choices.map { choice -> InputChoice(choice, choice) }
        ListFilterField(column = column, kind = ListFilterKind.EXACT, path = it, operators = listOf("equals", "isAnyOf"))
      }
      field.type == DatasetFieldType.TEXT -> ListFilterField(
        column = column,
        kind = ListFilterKind.TEXT,
        path = valuePath ?: column,
        tokensPath = TOKENS_PATH,
        verbatimTokens = true,
        lowerPath = valuePath,
        operators = if (valuePath != null) listOf("contains", "equals", "isAnyOf") else listOf("contains"),
      )
      field.type == DatasetFieldType.BOOL -> valuePath?.let {
        options[column] = BOOLEAN_OPTIONS
        ListFilterField(column = column, kind = ListFilterKind.BOOLEAN, path = it, operators = listOf("equals"))
      }
      isNumeric(field) -> valuePath?.let { ListFilterField(column = column, kind = ListFilterKind.NUMBER, path = it, operators = listOf("=")) }
      field.type == DatasetFieldType.SORTED -> ListFilterField(
        column = column,
        kind = ListFilterKind.TEXT,
        path = column,
        tokensPath = TOKENS_PATH,
        verbatimTokens = true,
        operators = listOf("contains"),
      )
      else -> null
    }
    if (declared == null) continue
    fields += declared
    headers[column] = field.name?.takeIf { it.isNotEmpty() } ?: fieldId
    if (options.containsKey(column)) selectFields += column
  }
  return DatasetRecordFilter(
    declaration = ListQueryDeclaration(
      fields = fields,
      search = ListQueryDeclarationSearch(tokensPath = TOKENS_PATH),
      sorts = listOf(ListQuerySort(path = LIST_QUERY_ID_PATH, direction = ListQuerySortDirection.ASC)),
    ),
    options = options,
    headers = headers,
    selectFields = selectFields,
  )
}

/** The records query and what it says to the reader (`DatasetRecordPlan`). */
data class DatasetRecordPlan(
  val plan: ListQueryPlan,
  val refused: List<FilterRefusal>,
  val notices: List<String>,
  val filter: DatasetRecordFilter,
)

private fun ListFilterRequest.json() = JsonObject(mapOf("field" to JsonPrimitive(field), "op" to JsonPrimitive(op), "value" to JsonPrimitive(value)))

/** The clauses and search words as one records query (`planDatasetRecordQuery`). */
fun planDatasetRecordQuery(model: DatasetModel, clauses: List<ListFilterRequest>, searchWords: List<String>): DatasetRecordPlan {
  val filter = datasetRecordFilter(model)
  val queryClauses = clauses.map { clause ->
    if (clause.op != "contains") {
      clause
    } else {
      clause.copy(value = datasetFilterToken(model, fieldIdOf(clause.field), "contains", clause.value) ?: "")
    }
  }
  val plan = planListQuery(filter.declaration, ListQueryRequest(clauses = queryClauses, search = searchWords), DatasetRecordNormalizers)
  val refused = plan.refused.map { entry ->
    val at = queryClauses.indexOfFirst { it.json() == entry.clause }
    FilterRefusal(if (at >= 0) clauses[at] else null, entry.reason)
  }
  val notices = mutableListOf<String>()
  fun oneWord(label: String, text: String) {
    val words = datasetFilterWords(text)
    if (words.size > 1) notices += "$label matches one word at a time: showing records with a word starting \"${clip(words[0], PREFIX_MAX)}\"."
    if (words.any { codePoints(it).size > PREFIX_MAX }) notices += "$label reads the first $PREFIX_MAX letters of a word."
  }
  if (plan.searched != null) oneWord("Search", searchWords.joinToString(" "))
  for (served in plan.served) {
    val at = queryClauses.indexOfFirst { it === served }.takeIf { it >= 0 } ?: queryClauses.indexOf(served)
    val clause = clauses.getOrNull(at) ?: continue
    if (clause.op != "contains") continue
    if (model.fields?.get(fieldIdOf(clause.field))?.type != DatasetFieldType.TEXT) continue
    oneWord("${filter.headers[clause.field] ?: clause.field} contains", clause.value)
  }
  return DatasetRecordPlan(plan, refused, notices, filter)
}
