package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.Instant

/**
 * [FirestoreReader] on the JVM desktop, over Firestore REST v1 with the
 * person's own ID token, so the same security rules apply as everywhere.
 * REST has no listener: an observed query re-reads every [refreshMillis]
 * while it is collected (and the shell re-reads on focus).
 */
class RestFirestoreReader(
  private val http: HttpClient,
  projectId: String,
  emulatorHost: String?,
  private val idToken: suspend () -> String?,
  private val refreshMillis: Long = 30_000,
) : FirestoreReader {
  private val root = (emulatorHost?.let { "http://$it" } ?: "https://firestore.googleapis.com") +
    "/v1/projects/$projectId/databases/(default)/documents"

  private suspend fun bearer(): String = idToken() ?: throw IllegalStateException("Sign in to continue.")

  override suspend fun get(path: String): FirestoreDoc? {
    val response = http.get("$root/$path") { header("Authorization", "Bearer ${bearer()}") }
    if (response.status.value == 404) return null
    val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
    if (response.status.value !in 200..299) throw IllegalStateException(errorOf(body))
    return docOf(body)
  }

  override suspend fun page(query: FirestoreQuery): FirestorePage {
    val limit = query.limit
    val rows = run(if (limit != null) query.copy(limit = limit + 1) else query)
    val page = if (limit != null) rows.take(limit) else rows
    return FirestorePage(page, if (limit != null && rows.size > limit) cursorOf(page.last(), query.orderBy) else null)
  }

  private suspend fun run(query: FirestoreQuery): List<FirestoreDoc> {
    val parent = query.collectionPath.substringBeforeLast('/', "")
    val collectionId = query.collectionPath.substringAfterLast('/')
    val url = if (parent.isEmpty()) "$root:runQuery" else "$root/$parent:runQuery"
    val response = http.post(url) {
      header("Authorization", "Bearer ${bearer()}")
      contentType(ContentType.Application.Json)
      setBody(buildJsonObject { put("structuredQuery", structuredQuery(collectionId, query)) }.toString())
    }
    val body = Json.parseToJsonElement(response.bodyAsText())
    if (response.status.value !in 200..299) throw IllegalStateException(errorOf(body))
    return body.jsonArray.mapNotNull { (it.jsonObject["document"] as? JsonObject)?.let(::docOf) }
  }

  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = poll { get(path) }

  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = poll { run(query) }

  private fun <T> poll(read: suspend () -> T): Flow<Live<T>> = flow {
    emit(Live.Loading)
    while (true) {
      emit(runCatching { read() }.fold({ Live.Ready(it) }, { Live.Failed(it) }))
      delay(refreshMillis)
    }
  }

  private fun docOf(document: JsonObject): FirestoreDoc {
    val name = document.getValue("name").jsonPrimitive.content
    val path = name.substringAfter("/documents/")
    val fields = (document["fields"] as? JsonObject) ?: JsonObject(emptyMap())
    return FirestoreDoc(path.substringAfterLast('/'), path, fields.mapValues { decodeValue(it.value) })
  }

  private fun errorOf(body: JsonElement): String =
    ((body as? JsonArray)?.firstOrNull() ?: body).let { (it as? JsonObject)?.get("error") as? JsonObject }
      ?.get("message")?.jsonPrimitive?.content ?: "Could not read Firestore."

  private fun structuredQuery(collectionId: String, query: FirestoreQuery): JsonObject = buildJsonObject {
    put("from", buildJsonArray { add(buildJsonObject { put("collectionId", collectionId) }) })
    if (query.filters.isNotEmpty()) {
      val filters = query.filters.map(::fieldFilter)
      put("where", if (filters.size == 1) filters.first() else buildJsonObject {
        put("compositeFilter", buildJsonObject { put("op", "AND"); put("filters", JsonArray(filters)) })
      })
    }
    if (query.orderBy.isNotEmpty()) {
      put("orderBy", JsonArray(query.orderBy.map { order ->
        buildJsonObject {
          put("field", buildJsonObject { put("fieldPath", order.field) })
          put("direction", if (order.descending) "DESCENDING" else "ASCENDING")
        }
      }))
    }
    query.startAfter?.let { cursor ->
      put("startAt", buildJsonObject {
        put("values", JsonArray(cursor.mapIndexed { i, value ->
          if (query.orderBy.getOrNull(i)?.field == "__name__") referenceValue(value.toString()) else encodeValue(value)
        }))
        put("before", false)
      })
    }
    query.limit?.let { put("limit", it) }
  }

  private fun referenceValue(path: String) = buildJsonObject { put("referenceValue", "$root/$path".substringAfter("/v1/")) }

  private fun fieldFilter(filter: FirestoreFilter): JsonObject {
    if (filter.value == null && (filter.op == FilterOp.EQ || filter.op == FilterOp.NE)) {
      return buildJsonObject {
        put("unaryFilter", buildJsonObject {
          put("op", if (filter.op == FilterOp.EQ) "IS_NULL" else "IS_NOT_NULL")
          put("field", buildJsonObject { put("fieldPath", filter.field) })
        })
      }
    }
    val op = when (filter.op) {
      FilterOp.EQ -> "EQUAL"
      FilterOp.NE -> "NOT_EQUAL"
      FilterOp.LT -> "LESS_THAN"
      FilterOp.LTE -> "LESS_THAN_OR_EQUAL"
      FilterOp.GT -> "GREATER_THAN"
      FilterOp.GTE -> "GREATER_THAN_OR_EQUAL"
      FilterOp.IN -> "IN"
      FilterOp.NOT_IN -> "NOT_IN"
      FilterOp.ARRAY_CONTAINS -> "ARRAY_CONTAINS"
      FilterOp.ARRAY_CONTAINS_ANY -> "ARRAY_CONTAINS_ANY"
    }
    val value = if (filter.field == "__name__") {
      (filter.value as? List<*>)?.let { values -> buildJsonObject { put("arrayValue", buildJsonObject { put("values", JsonArray(values.map { referenceValue(it.toString()) })) }) } }
        ?: referenceValue(filter.value.toString())
    } else {
      encodeValue(filter.value)
    }
    return buildJsonObject {
      put("fieldFilter", buildJsonObject {
        put("field", buildJsonObject { put("fieldPath", filter.field) })
        put("op", op)
        put("value", value)
      })
    }
  }

  companion object {
    fun encodeValue(value: Any?): JsonObject = when (value) {
      null -> buildJsonObject { put("nullValue", JsonNull) }
      is Boolean -> buildJsonObject { put("booleanValue", value) }
      is Int, is Long -> buildJsonObject { put("integerValue", value.toString()) }
      is Number -> buildJsonObject { put("doubleValue", value.toDouble()) }
      is String -> buildJsonObject { put("stringValue", value) }
      is FirestoreTimestamp -> buildJsonObject { put("timestampValue", Instant.ofEpochSecond(value.seconds, value.nanos.toLong()).toString()) }
      is List<*> -> buildJsonObject { put("arrayValue", buildJsonObject { put("values", JsonArray(value.map(::encodeValue))) }) }
      is Map<*, *> -> buildJsonObject {
        put("mapValue", buildJsonObject { put("fields", JsonObject(value.entries.associate { it.key.toString() to encodeValue(it.value) })) })
      }
      else -> buildJsonObject { put("stringValue", value.toString()) }
    }

    fun decodeValue(value: JsonElement): Any? {
      val obj = value as? JsonObject ?: return null
      val (kind, inner) = obj.entries.firstOrNull() ?: return null
      return when (kind) {
        "nullValue" -> null
        "booleanValue" -> inner.jsonPrimitive.content.toBoolean()
        "integerValue" -> inner.jsonPrimitive.content.toLong()
        "doubleValue" -> inner.jsonPrimitive.content.toDouble()
        "stringValue", "referenceValue", "bytesValue" -> inner.jsonPrimitive.content
        "timestampValue" -> Instant.parse(inner.jsonPrimitive.content).let { FirestoreTimestamp(it.epochSecond, it.nano) }
        "arrayValue" -> ((inner as? JsonObject)?.get("values") as? JsonArray)?.map(::decodeValue) ?: emptyList<Any?>()
        "mapValue" -> ((inner as? JsonObject)?.get("fields") as? JsonObject)?.mapValues { decodeValue(it.value) } ?: emptyMap<String, Any?>()
        "geoPointValue" -> (inner as? JsonObject)?.mapValues { it.value.jsonPrimitive.content.toDouble() }
        else -> null
      }
    }
  }
}

/** Small settings in the user's Java preferences. */
class JavaPreferencesStore(node: String = "com/aglyn") : KeyValueStore {
  private val prefs = java.util.prefs.Preferences.userRoot().node(node)
  override fun get(key: String): String? = prefs.get(key, null)
  override fun set(key: String, value: String?) {
    if (value == null) prefs.remove(key) else prefs.put(key, value)
    runCatching { prefs.flush() }
  }
}
