package com.aglyn.screens

import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The reads a spec makes straight from Firestore, under the same rules the
 * console's own client reads run under: one document (`doc`) or one
 * collection query (`query`). Twin of the Apple `FirestoreLoads`.
 */
internal object FirestoreLoads {
  fun json(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is String -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value.toDouble())
    is FirestoreTimestamp -> JsonPrimitive(value.epochMillis.toDouble())
    is List<*> -> JsonArray(value.map { json(it) })
    is Map<*, *> -> JsonObject(value.entries.associate { it.key.toString() to json(it.value) })
    else -> JsonPrimitive(value.toString())
  }

  fun json(doc: FirestoreDoc): JsonElement = JsonObject(doc.data.mapValues { json(it.value) } + ("\$id" to JsonPrimitive(doc.id)))

  suspend fun document(reader: FirestoreReader, path: String): JsonElement = reader.get(path)?.let { json(it) } ?: JsonNull

  /** `2026-10-13T04:00:00Z` (fraction optional, or a bare date) as a timestamp, else null. */
  internal fun isoInstant(text: String): FirestoreTimestamp? {
    val match = Regex("""^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z)?$""").find(text) ?: return null
    val (y, m, d) = match.groupValues.slice(1..3).map { it.toInt() }
    val clock = match.groupValues.slice(4..6).map { it.toIntOrNull() ?: 0 }
    val fraction = match.groupValues[7].padEnd(9, '0').take(9).toIntOrNull() ?: 0
    val yy = if (m <= 2) y - 1 else y
    val era = (if (yy >= 0) yy else yy - 399) / 400
    val yoe = yy - era * 400
    val doy = (153 * (m + (if (m > 2) -3 else 9)) + 2) / 5 + d - 1
    val days = era * 146097L + (yoe * 365 + yoe / 4 - yoe / 100 + doy) - 719468
    return FirestoreTimestamp(days * 86400 + clock[0] * 3600 + clock[1] * 60 + clock[2], fraction)
  }

  private fun filterOp(symbol: String?): FilterOp = when (symbol) {
    "!=" -> FilterOp.NE
    "<" -> FilterOp.LT
    "<=" -> FilterOp.LTE
    ">" -> FilterOp.GT
    ">=" -> FilterOp.GTE
    "in" -> FilterOp.IN
    "not-in" -> FilterOp.NOT_IN
    "array-contains" -> FilterOp.ARRAY_CONTAINS
    "array-contains-any" -> FilterOp.ARRAY_CONTAINS_ANY
    else -> FilterOp.EQ
  }

  /** `spec` is `{ collection, where: [[field, "==", value]], orderBy: "field desc", limit }`. */
  suspend fun query(reader: FirestoreReader, spec: JsonElement, context: JsonElement): JsonElement {
    val collection = ScreenValues.render(spec.str("collection").orEmpty(), context)
    // `[field, op, value]`: equality, or any operator (`>`, `in`, …); a value may be `{ "$date": ISO }` for a timestamp.
    val filters = spec.arr("where").mapNotNull { clause ->
      val parts = clause as? JsonArray ?: return@mapNotNull null
      if (parts.size != 3) return@mapNotNull null
      val field = (parts[0] as? JsonPrimitive)?.content ?: return@mapNotNull null
      val raw = parts[2]
      val value = if (raw is JsonObject) raw else ScreenValues.resolve((raw as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ScreenValues.text(raw), context)
      val plain: Any? = when (value) {
        is JsonObject -> value.str("\$date")?.let { isoInstant(it) } ?: ScreenValues.text(value)
        is JsonPrimitive -> when {
          value.isString -> value.content
          value.content == "true" || value.content == "false" -> value.content == "true"
          else -> value.content.toDoubleOrNull()
        }
        else -> ScreenValues.text(value)
      }
      FirestoreFilter(field, filterOp((parts[1] as? JsonPrimitive)?.content), plain)
    }
    val order = spec.str("orderBy")?.split(' ')?.let { listOf(FirestoreOrder(it[0], it.getOrNull(1) == "desc")) } ?: emptyList()
    val counting = spec.isTrue("count")
    // `count: true` answers `{ "count": N }`: the server's count where the reader has one (the web SDK's
    // getCountFromServer), else the rows up to a ceiling.
    if (counting) {
      reader.count(FirestoreQuery(collection, filters, emptyList(), 1))?.let { return JsonObject(mapOf("count" to JsonPrimitive(it.toDouble()))) }
    }
    val limit = ScreenValues.number(spec.obj("limit"))?.toInt() ?: if (counting) 1000 else 50
    val page = reader.page(FirestoreQuery(collection, filters, order, limit))
    if (counting) return JsonObject(mapOf("count" to JsonPrimitive(page.docs.size.toDouble())))
    return JsonObject(mapOf("items" to JsonArray(page.docs.map { json(it) })))
  }
}
