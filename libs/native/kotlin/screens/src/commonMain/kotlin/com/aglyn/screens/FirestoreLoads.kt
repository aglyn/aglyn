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

  /** `spec` is `{ collection, where: [[field, "==", value]], orderBy: "field desc", limit }`. */
  suspend fun query(reader: FirestoreReader, spec: JsonElement, context: JsonElement): JsonElement {
    val collection = ScreenValues.render(spec.str("collection").orEmpty(), context)
    val filters = spec.arr("where").mapNotNull { clause ->
      val parts = clause as? JsonArray ?: return@mapNotNull null
      if (parts.size != 3) return@mapNotNull null
      val field = (parts[0] as? JsonPrimitive)?.content ?: return@mapNotNull null
      val raw = parts[2]
      val value = ScreenValues.resolve((raw as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ScreenValues.text(raw), context)
      val plain: Any? = (value as? JsonPrimitive)?.let { p ->
        when {
          p.isString -> p.content
          p.content == "true" || p.content == "false" -> p.content == "true"
          else -> p.content.toDoubleOrNull()
        }
      }
      FirestoreFilter(field, FilterOp.EQ, plain)
    }
    val order = spec.str("orderBy")?.split(' ')?.let { listOf(FirestoreOrder(it[0], it.getOrNull(1) == "desc")) } ?: emptyList()
    val limit = ScreenValues.number(spec.obj("limit"))?.toInt() ?: 50
    val page = reader.page(FirestoreQuery(collection, filters, order, limit))
    return JsonObject(mapOf("items" to JsonArray(page.docs.map { json(it) })))
  }
}
