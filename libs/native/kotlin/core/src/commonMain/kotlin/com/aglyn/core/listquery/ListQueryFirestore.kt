package com.aglyn.core.listquery

import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryPlan
import com.aglyn.contracts.ListQuerySortDirection
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/** Epoch milliseconds of an ISO instant as `toISOString` writes it. */
internal expect fun parseIsoInstant(iso: String): Long?

private fun plainValue(value: JsonElement): Any? = when (value) {
  JsonNull -> null
  is JsonArray -> value.map(::plainValue)
  is JsonObject -> (value["\$date"] as? JsonPrimitive)?.content?.let(::parseIsoInstant)
    ?.let { FirestoreTimestamp(it.floorDiv(1000L), (it.mod(1000L) * 1_000_000).toInt()) }
  is JsonPrimitive -> when {
    value.isString -> value.content
    value.booleanOrNull != null -> value.booleanOrNull
    value.longOrNull != null -> value.longOrNull
    else -> value.doubleOrNull
  }
}

private val OPS = mapOf(
  ListQueryOp.EQUAL to FilterOp.EQ, ListQueryOp.NOT_EQUAL to FilterOp.NE, ListQueryOp.LESS_THAN to FilterOp.LT,
  ListQueryOp.LESS_THAN_OR_EQUAL to FilterOp.LTE, ListQueryOp.GREATER_THAN to FilterOp.GT,
  ListQueryOp.GREATER_THAN_OR_EQUAL to FilterOp.GTE, ListQueryOp.IN to FilterOp.IN,
  ListQueryOp.ARRAY_CONTAINS to FilterOp.ARRAY_CONTAINS, ListQueryOp.ARRAY_CONTAINS_ANY to FilterOp.ARRAY_CONTAINS_ANY,
)

/** The plan as a [FirestoreQuery] over [collectionPath], one page of [limit] rows. */
fun ListQueryPlan.toFirestoreQuery(collectionPath: String, limit: Int? = null, startAfter: List<Any?>? = null): FirestoreQuery =
  FirestoreQuery(
    collectionPath = collectionPath,
    filters = filters.mapNotNull { f -> OPS[f.op]?.let { FirestoreFilter(f.path, it, plainValue(f.value)) } },
    orderBy = listOf(FirestoreOrder(orderBy.path, descending = orderBy.direction == ListQuerySortDirection.DESC)),
    limit = limit,
    startAfter = startAfter,
  )
