package com.aglyn.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/*
 * A route body from plain Kotlin values, and plain values out of a route's
 * answer, so a screen's API calls read like the console's `JSON.stringify`
 * and `response.json()`.
 */

/** [value] as JSON: null, booleans, numbers, strings, lists and maps, and JSON as it is. */
fun jsonValue(value: Any?): JsonElement = when (value) {
  null -> JsonNull
  is JsonElement -> value
  is Boolean -> JsonPrimitive(value)
  is Number -> JsonPrimitive(value)
  is String -> JsonPrimitive(value)
  is Map<*, *> -> JsonObject(value.entries.associate { it.key.toString() to jsonValue(it.value) })
  is Iterable<*> -> JsonArray(value.map(::jsonValue))
  is Array<*> -> JsonArray(value.map(::jsonValue))
  else -> JsonPrimitive(value.toString())
}

/** A route's JSON body from a map. */
fun jsonBody(vararg fields: Pair<String, Any?>): JsonObject = jsonValue(mapOf(*fields)) as JsonObject

/** A string field of a route's answer. */
fun JsonElement?.field(key: String): String? = ((this as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

/** A number field of a route's answer. */
fun JsonElement?.numberField(key: String): Double? = ((this as? JsonObject)?.get(key) as? JsonPrimitive)?.doubleOrNull

/** A whole-number field of a route's answer. */
fun JsonElement?.longField(key: String): Long? = ((this as? JsonObject)?.get(key) as? JsonPrimitive)?.longOrNull

/** A boolean field of a route's answer. */
fun JsonElement?.boolField(key: String): Boolean? = ((this as? JsonObject)?.get(key) as? JsonPrimitive)?.booleanOrNull

/** A JSON answer as plain Kotlin values (the shapes [FirestoreDoc] holds). */
fun plainJson(element: JsonElement?): Any? = when (element) {
  null, JsonNull -> null
  is JsonObject -> element.mapValues { plainJson(it.value) }
  is JsonArray -> element.map(::plainJson)
  is JsonPrimitive -> when {
    element.isString -> element.content
    element.booleanOrNull != null -> element.booleanOrNull
    element.longOrNull != null -> element.longOrNull
    else -> element.doubleOrNull
  }
}
