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

  /**
   * Whether the workspace carries a plan feature, as the console's `checkEntitlement` answers from the workspace's own
   * document, with the name of the cheapest plan that includes it (what an upsell says): `{ carried, label }`.
   */
  suspend fun entitlement(reader: FirestoreReader, feature: String, orgId: String): JsonElement = JsonObject(
    mapOf(
      "carried" to JsonPrimitive(com.aglyn.core.planFeatureCarried(reader.get("orgs/$orgId")?.data, feature)),
      "label" to (com.aglyn.core.PlanFeatureDefaults.grantedFrom[feature]?.let { JsonPrimitive(it) } ?: JsonNull),
    ),
  )

  /** `spec` is `{ collection, where: [[field, "==", value]], orderBy: "field desc", limit }`. */
  suspend fun query(reader: FirestoreReader, spec: JsonElement, context: JsonElement): JsonElement {
    val collection = ScreenValues.render(spec.str("collection").orEmpty(), context)
    val filters = spec.arr("where").mapNotNull { clause ->
      val parts = clause as? JsonArray ?: return@mapNotNull null
      if (parts.size != 3) return@mapNotNull null
      val field = (parts[0] as? JsonPrimitive)?.content ?: return@mapNotNull null
      val op = when ((parts[1] as? JsonPrimitive)?.content) {
        "==" -> FilterOp.EQ
        "!=" -> FilterOp.NE
        "<" -> FilterOp.LT
        "<=" -> FilterOp.LTE
        ">" -> FilterOp.GT
        ">=" -> FilterOp.GTE
        "in" -> FilterOp.IN
        "not-in" -> FilterOp.NOT_IN
        "array-contains" -> FilterOp.ARRAY_CONTAINS
        "array-contains-any" -> FilterOp.ARRAY_CONTAINS_ANY
        else -> return@mapNotNull null
      }
      fun plain(raw: JsonElement): Any? {
        // A number or flag written into the spec is compared as itself, not as its text.
        (raw as? JsonPrimitive)?.takeIf { !it.isString && it !is JsonNull }?.let { literal ->
          return if (literal.content == "true" || literal.content == "false") literal.content == "true" else literal.content.toDoubleOrNull()
        }
        val value = ScreenValues.resolve((raw as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ScreenValues.text(raw), context)
        return (value as? JsonPrimitive)?.let { p ->
          when {
            p.isString -> p.content
            p.content == "true" || p.content == "false" -> p.content == "true"
            else -> p.content.toDoubleOrNull()
          }
        }
      }
      // `in`, `not-in` and `array-contains-any` take a list; the others one value.
      val listOp = op == FilterOp.IN || op == FilterOp.NOT_IN || op == FilterOp.ARRAY_CONTAINS_ANY
      FirestoreFilter(field, op, if (listOp) (parts[2] as? JsonArray)?.map { plain(it) } ?: listOf(plain(parts[2])) else plain(parts[2]))
    }
    val order = spec.str("orderBy")?.split(' ')?.let { listOf(FirestoreOrder(it[0], it.getOrNull(1) == "desc")) } ?: emptyList()
    val limit = ScreenValues.number(spec.obj("limit"))?.toInt() ?: 50
    // `aggregate`: { count: true, sum: "balanceCents" } asks the server for the figures over every matching document
    // and reads no rows: `count` and `sum` are missing from the result where the reader cannot answer, so a screen
    // shows "Unavailable" instead of a zero.
    spec.obj("aggregate")?.let { aggregate ->
      val whole = FirestoreQuery(collection, filters, order)
      val count = if ((aggregate.obj("count") as? JsonPrimitive)?.content == "true") reader.count(whole) else null
      val sum = aggregate.str("sum")?.let { reader.sum(whole, it) }
      return JsonObject(
        buildMap {
          put("items", JsonArray(emptyList()))
          count?.let { put("count", JsonPrimitive(it.toDouble())) }
          sum?.let { put("sum", JsonPrimitive(it)) }
        },
      )
    }
    val page = reader.page(FirestoreQuery(collection, filters, order, limit))
    return JsonObject(mapOf("items" to JsonArray(page.docs.map { json(it) })))
  }
}
