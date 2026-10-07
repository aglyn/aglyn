package com.aglyn.core.listquery

import com.aglyn.contracts.ListFilterField
import com.aglyn.contracts.ListFilterFieldPresence
import com.aglyn.contracts.ListFilterFieldStoredAs
import com.aglyn.contracts.ListFilterKind
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryDeclaration
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryPlan
import com.aglyn.contracts.ListQueryRefusal
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.contracts.ListQuerySort
import com.aglyn.contracts.ListQuerySortDirection
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * The console's list-query planner (libs/shared/util/tools list-query-plan.ts),
 * ported once. It turns a list declaration and a request (filter clauses, a
 * search, a sort) into Firestore filters and one order, refusing in words
 * whatever Firestore cannot answer. list-query-cases.generated.json holds the
 * plans the TypeScript makes, and the tests replay every one.
 *
 * A date value is `{ "$date": ISO }` in a plan, as the cases write it; a
 * `…AtMs` field compares as epoch milliseconds.
 */

const val LIST_QUERY_ID_PATH = "__name__"

/** Firestore's cap on the disjunctions one query may carry. */
const val LIST_QUERY_DISJUNCTIONS = 30

private const val HIGH = ""

private val INEQUALITIES = setOf(
  ListQueryOp.NOT_EQUAL, ListQueryOp.LESS_THAN, ListQueryOp.LESS_THAN_OR_EQUAL,
  ListQueryOp.GREATER_THAN, ListQueryOp.GREATER_THAN_OR_EQUAL,
)

private fun emptyOperators(field: ListFilterField): List<String> = when (field.presence ?: ListFilterFieldPresence.SPARSE) {
  ListFilterFieldPresence.ALWAYS -> emptyList()
  ListFilterFieldPresence.NULLABLE -> listOf("isEmpty", "isNotEmpty")
  else -> listOf("isNotEmpty")
}

/** The operators a field offers, derived from the paths it actually has. */
fun listFilterOperators(field: ListFilterField): List<String> {
  field.operators?.let { return it }
  val empties = emptyOperators(field)
  return when (field.kind) {
    ListFilterKind.TEXT -> buildList {
      if (field.tokensPath != null) add("contains")
      if (field.lowerPath != null) addAll(listOf("equals", "startsWith"))
      if (field.reversedPath != null) add("endsWith")
      addAll(empties)
    }
    ListFilterKind.EXACT -> listOf("equals", "isAnyOf") + empties
    ListFilterKind.ID -> listOf("equals", "startsWith", "isAnyOf")
    ListFilterKind.BOOLEAN -> listOf("is")
    ListFilterKind.NUMBER -> listOf("=", "!=", ">", ">=", "<", "<=") + empties
    ListFilterKind.DATE -> listOf("is", "after", "onOrAfter", "before", "onOrBefore") + empties
    else -> emptyList()
  }
}

/** A date clause's day as `[start, end)` epoch milliseconds in [timeZone] (the device's when null); null when it names no day. */
internal expect fun listQueryDayBounds(raw: String, timeZone: String?): Pair<Long, Long>?

/** Epoch milliseconds as JavaScript's `toISOString`. */
internal expect fun isoInstant(epochMillis: Long): String

private class ClauseShape(
  val filters: List<ListQueryFilter>,
  val inequality: String? = null,
  val array: Boolean = false,
)

private fun filter(path: String, op: ListQueryOp, value: JsonElement) = ListQueryFilter(op = op, path = path, value = value)
private fun str(value: String) = JsonPrimitive(value)
private fun strings(values: List<String>) = JsonArray(values.map(::JsonPrimitive))

/** A number as JSON, whole numbers without a fraction as JavaScript prints them. */
private fun number(value: Double): JsonPrimitive =
  if (value == kotlin.math.floor(value) && kotlin.math.abs(value) < 9.007199254740991E15) JsonPrimitive(value.toLong()) else JsonPrimitive(value)

private fun csv(raw: String): List<String> = raw.split(',').map { it.trim() }.filter { it.isNotEmpty() }

/** JavaScript's `Number(raw)` for what a person types: finite or null. */
private fun jsNumber(raw: String): Double? {
  val text = raw.trim()
  if (text.isEmpty()) return 0.0
  if (text.startsWith("0x", ignoreCase = true)) return text.substring(2).toLongOrNull(16)?.toDouble()
  if (text.contains("Infinity") || text.contains("NaN")) return null
  return text.toDoubleOrNull()?.takeIf { it.isFinite() && !text.endsWith("f", true) && !text.endsWith("d", true) }
}

private fun rangeOrder(declaration: ListQueryDeclaration, field: ListFilterField?, path: String): ListQuerySort =
  declaration.sorts.firstOrNull { it.path == path }
    ?: ListQuerySort(path = path, direction = if (field?.kind == ListFilterKind.DATE) ListQuerySortDirection.DESC else ListQuerySortDirection.ASC)

private fun shapeClause(
  field: ListFilterField,
  input: ListFilterRequest,
  names: ListQueryNormalizers,
  timeZone: String?,
): Any {
  if (field.windowOnly == true) return "this field is not stored where a query can reach it"
  val op = input.op
  if (op !in listFilterOperators(field)) return "$op is not something this list can ask of ${field.column}"
  val raw = input.value.trim()
  val cannot = "$op is not something this list can ask of ${field.column}"

  if (op == "isEmpty") {
    if (field.presence != ListFilterFieldPresence.NULLABLE) return "only a field stored as null can be asked for empty"
    return ClauseShape(listOf(filter(field.path, ListQueryOp.EQUAL, JsonNull)))
  }
  if (op == "isNotEmpty") {
    if (field.presence == ListFilterFieldPresence.ALWAYS) return "this field is never empty"
    return ClauseShape(listOf(filter(field.path, ListQueryOp.NOT_EQUAL, JsonNull)), inequality = field.path)
  }
  if (field.kind == ListFilterKind.BOOLEAN) {
    if (raw != "true" && raw != "false") return "pick true or false"
    return ClauseShape(listOf(filter(field.path, ListQueryOp.EQUAL, JsonPrimitive(raw == "true"))))
  }
  if (raw.isEmpty()) return "no value yet"

  if (field.keysOf == true) {
    if (op != "equals" || !Regex("^[A-Za-z0-9_]+$").matches(raw)) return "pick one of the choices"
    return ClauseShape(listOf(filter("${field.path}.$raw", ListQueryOp.EQUAL, JsonPrimitive(true))))
  }

  val tooMany = "at most $LIST_QUERY_DISJUNCTIONS values"
  when (field.kind) {
    ListFilterKind.TEXT -> {
      val tokens = field.tokensPath
      val lower = field.lowerPath
      val reversed = field.reversedPath
      if (op == "contains" && tokens != null) {
        val token = if (field.verbatimTokens == true) raw else names.token(raw)
        if (token.isEmpty()) return "no value yet"
        return ClauseShape(listOf(filter(tokens, ListQueryOp.ARRAY_CONTAINS, str(token))), array = true)
      }
      if (op == "equals" && lower != null) return ClauseShape(listOf(filter(lower, ListQueryOp.EQUAL, str(names.key(raw)))))
      if (op == "equals" && field.presence == ListFilterFieldPresence.ALWAYS) {
        return ClauseShape(listOf(filter(field.path, ListQueryOp.EQUAL, str(raw))))
      }
      if (op == "startsWith" && lower != null) {
        val key = names.key(raw)
        return ClauseShape(
          listOf(filter(lower, ListQueryOp.GREATER_THAN_OR_EQUAL, str(key)), filter(lower, ListQueryOp.LESS_THAN_OR_EQUAL, str(key + HIGH))),
          inequality = lower,
        )
      }
      if (op == "endsWith" && reversed != null) {
        val key = names.reversed(raw)
        return ClauseShape(
          listOf(filter(reversed, ListQueryOp.GREATER_THAN_OR_EQUAL, str(key)), filter(reversed, ListQueryOp.LESS_THAN_OR_EQUAL, str(key + HIGH))),
          inequality = reversed,
        )
      }
      if (op == "isAnyOf" && lower != null) {
        val values = csv(raw).map(names::key)
        if (values.size > LIST_QUERY_DISJUNCTIONS) return tooMany
        return ClauseShape(listOf(filter(lower, ListQueryOp.IN, strings(values))))
      }
      return cannot
    }
    ListFilterKind.ID -> {
      if (op == "equals") return ClauseShape(listOf(filter(LIST_QUERY_ID_PATH, ListQueryOp.EQUAL, str(raw))))
      if (op == "isAnyOf") {
        val values = csv(raw)
        if (values.size > LIST_QUERY_DISJUNCTIONS) return tooMany
        return ClauseShape(listOf(filter(LIST_QUERY_ID_PATH, ListQueryOp.IN, strings(values))))
      }
      if (op == "startsWith") {
        return ClauseShape(
          listOf(
            filter(LIST_QUERY_ID_PATH, ListQueryOp.GREATER_THAN_OR_EQUAL, str(raw)),
            filter(LIST_QUERY_ID_PATH, ListQueryOp.LESS_THAN_OR_EQUAL, str(raw + HIGH)),
          ),
          inequality = LIST_QUERY_ID_PATH,
        )
      }
      return cannot
    }
    ListFilterKind.EXACT -> {
      if (op == "equals") return ClauseShape(listOf(filter(field.path, ListQueryOp.EQUAL, str(raw))))
      val tokens = field.tokensPath
      if (op == "isAnyOf") {
        val values = csv(raw)
        if (values.size > LIST_QUERY_DISJUNCTIONS) return tooMany
        // An array field asked "any of these": one array clause.
        if (tokens != null) return ClauseShape(listOf(filter(tokens, ListQueryOp.ARRAY_CONTAINS_ANY, strings(values))), array = true)
        return ClauseShape(listOf(filter(field.path, ListQueryOp.IN, strings(values))))
      }
      if (op == "contains" && tokens != null) {
        return ClauseShape(listOf(filter(tokens, ListQueryOp.ARRAY_CONTAINS, str(raw))), array = true)
      }
      return cannot
    }
    ListFilterKind.NUMBER -> {
      val value = jsNumber(raw) ?: return "type a number"
      if (op == "=") return ClauseShape(listOf(filter(field.path, ListQueryOp.EQUAL, number(value))))
      val found = mapOf(
        "!=" to ListQueryOp.NOT_EQUAL, ">" to ListQueryOp.GREATER_THAN, ">=" to ListQueryOp.GREATER_THAN_OR_EQUAL,
        "<" to ListQueryOp.LESS_THAN, "<=" to ListQueryOp.LESS_THAN_OR_EQUAL,
      )[op] ?: return cannot
      return ClauseShape(listOf(filter(field.path, found, number(value))), inequality = field.path)
    }
    ListFilterKind.DATE -> {
      val (start, end) = listQueryDayBounds(raw, timeZone) ?: return "pick a date"
      // A `…AtMs` field is compared as the number it is stored as.
      fun at(ms: Long): JsonElement =
        if (field.storedAs == ListFilterFieldStoredAs.MILLIS) JsonPrimitive(ms) else JsonObject(mapOf("\$date" to JsonPrimitive(isoInstant(ms))))
      if (op == "is") {
        return ClauseShape(
          listOf(filter(field.path, ListQueryOp.GREATER_THAN_OR_EQUAL, at(start)), filter(field.path, ListQueryOp.LESS_THAN, at(end))),
          inequality = field.path,
        )
      }
      val (bound, ms) = when (op) {
        "after" -> ListQueryOp.GREATER_THAN_OR_EQUAL to end
        "onOrAfter" -> ListQueryOp.GREATER_THAN_OR_EQUAL to start
        "before" -> ListQueryOp.LESS_THAN to start
        "onOrBefore" -> ListQueryOp.LESS_THAN to end
        else -> return cannot
      }
      return ClauseShape(listOf(filter(field.path, bound, at(ms))), inequality = field.path)
    }
    else -> return cannot
  }
}

private fun disjunctionsOf(filter: ListQueryFilter): Int =
  if (filter.op == ListQueryOp.IN || filter.op == ListQueryOp.ARRAY_CONTAINS_ANY) {
    maxOf(1, (filter.value as? JsonArray)?.size ?: 1)
  } else {
    1
  }

private fun ListFilterRequest.asJson(): JsonElement =
  JsonObject(mapOf("field" to JsonPrimitive(field), "op" to JsonPrimitive(op), "value" to JsonPrimitive(value)))

/**
 * The plan for [request] over [declaration]. [timeZone] is the zone a date
 * clause's day is read in: the device's when null, as the console reads it
 * in the browser's.
 */
fun planListQuery(
  declaration: ListQueryDeclaration,
  request: ListQueryRequest,
  names: ListQueryNormalizers = NameSearchNormalizers,
  timeZone: String? = null,
): ListQueryPlan {
  val filters = (request.base ?: emptyList()).toMutableList()
  val served = mutableListOf<ListFilterRequest>()
  val refused = mutableListOf<ListQueryRefusal>()
  val notices = mutableListOf<String>()
  var arrayTaken = filters.any { it.op == ListQueryOp.ARRAY_CONTAINS || it.op == ListQueryOp.ARRAY_CONTAINS_ANY }
  var inequality: String? = filters.firstOrNull { it.op in INEQUALITIES }?.path
  var disjunctions = filters.fold(1) { product, f -> product * disjunctionsOf(f) }

  // The search.
  var searched: String? = null
  val words = (request.search ?: emptyList()).map { it.trim() }.filter { it.isNotEmpty() }
  if (words.isNotEmpty()) {
    val search = declaration.search
    val token = names.token(words.joinToString(" "))
    if (search == null) {
      refused += ListQueryRefusal(JsonPrimitive("search"), "this list has no search")
    } else if (token.isNotEmpty()) {
      val scopeAt = filters.indexOfFirst { it.op == ListQueryOp.ARRAY_CONTAINS_ANY || it.op == ListQueryOp.ARRAY_CONTAINS }
      val scoped = search.scoped
      if (scopeAt == -1) {
        filters += filter(search.tokensPath, ListQueryOp.ARRAY_CONTAINS, str(token))
        arrayTaken = true
        searched = token
      } else if (scoped != null) {
        // Fold the search into the scope: one array clause answers both.
        val scope = filters[scopeAt].value
        val scopes = (scope as? JsonArray)?.toList() ?: listOf(scope)
        filters[scopeAt] = filter(
          scoped.tokensPath,
          ListQueryOp.ARRAY_CONTAINS_ANY,
          JsonArray(scopes.map { entry -> JsonPrimitive("${(entry as? JsonPrimitive)?.content ?: entry}${scoped.join}$token") }),
        )
        searched = token
      } else {
        refused += ListQueryRefusal(
          JsonPrimitive("search"),
          "this list is already narrowed to what you can see, which search cannot combine with",
        )
      }
      if (searched != null && words.size > 1) notices += "Search matches one word at a time: showing results for \"$token\"."
      if (searched != null && names.key(words[0]).length > names.maxPrefix) {
        notices += "Search reads the first ${names.maxPrefix} letters of a word."
      }
    }
  }

  // The clauses.
  for (clause in request.clauses) {
    val field = declaration.fields.firstOrNull { it.column == clause.field }
    if (field == null) {
      refused += ListQueryRefusal(clause.asJson(), "this list does not filter by that")
      continue
    }
    val shape = shapeClause(field, clause, names, timeZone)
    if (shape is String) {
      refused += ListQueryRefusal(clause.asJson(), shape)
      continue
    }
    shape as ClauseShape
    if (shape.array && arrayTaken) {
      refused += ListQueryRefusal(
        clause.asJson(),
        if (searched != null) {
          "cannot be combined with the search — clear the search to use it"
        } else {
          "cannot be combined with another \"contains\" or \"any of\" filter on a list"
        },
      )
      continue
    }
    if (shape.inequality != null && inequality != null && shape.inequality != inequality) {
      refused += ListQueryRefusal(clause.asJson(), "only one range (dates, numbers, starts with) can apply at a time")
      continue
    }
    val product = disjunctions * shape.filters.fold(1) { total, f -> total * disjunctionsOf(f) }
    if (product > LIST_QUERY_DISJUNCTIONS) {
      refused += ListQueryRefusal(clause.asJson(), "too many values at once (the limit is $LIST_QUERY_DISJUNCTIONS)")
      continue
    }
    filters += shape.filters
    served += clause
    if (shape.array) arrayTaken = true
    if (shape.inequality != null) inequality = shape.inequality
    disjunctions = product
  }

  // The order. A range leads with the field it ranges over, in the asked
  // direction when the asked order is that field.
  val asked = request.sort?.let { sort -> declaration.sorts.firstOrNull { it.path == sort.path && it.direction == sort.direction } }
  val range = inequality
  val orderBy = if (range != null) {
    if (asked?.path == range) {
      asked
    } else {
      rangeOrder(
        declaration,
        declaration.fields.firstOrNull { it.path == range || it.lowerPath == range || it.reversedPath == range },
        range,
      )
    }
  } else {
    asked ?: declaration.sorts.firstOrNull() ?: ListQuerySort(path = LIST_QUERY_ID_PATH, direction = ListQuerySortDirection.ASC)
  }

  return ListQueryPlan(filters = filters, notices = notices, orderBy = orderBy, refused = refused, searched = searched, served = served)
}
