package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * A case file's JSON as the plain values a Firestore read hands over: maps,
 * lists, strings, booleans, a whole number as a Long and any other as a
 * Double.
 */
fun plainOf(element: JsonElement?): Any? = when (element) {
  null, JsonNull -> null
  is JsonObject -> LinkedHashMap<String, Any?>().apply { element.forEach { (key, value) -> put(key, plainOf(value)) } }
  is JsonArray -> element.map(::plainOf)
  is JsonPrimitive -> when {
    element.isString -> element.content
    element.booleanOrNull != null -> element.booleanOrNull
    element.content.any { it == '.' || it == 'e' || it == 'E' } -> element.content.toDouble()
    else -> element.content.toLongOrNull() ?: element.content.toDouble()
  }
}

/** A value with every number as a Double, so a Long and a Double that are equal compare equal. */
fun comparable(value: Any?): Any? = when (value) {
  is Map<*, *> -> value.entries.associate { it.key.toString() to comparable(it.value) }
  is List<*> -> value.map(::comparable)
  is Pair<*, *> -> comparable(value.second)
  is Number -> value.toDouble()
  else -> value
}

/** A case's expected answer as comparable plain values. */
fun expected(element: JsonElement): Any? = comparable(plainOf(element))

/** A scope from a case: numbers as Doubles, as the evaluator holds them. */
@Suppress("UNCHECKED_CAST")
fun scopeOf(element: JsonElement): Map<String, Any> =
  (comparable(plainOf(element)) as Map<String, Any?>).filterValues { it != null } as Map<String, Any>
