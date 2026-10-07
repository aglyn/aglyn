package com.aglyn.core

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Decoding that tolerates fields a newer server added. */
val FirestoreDecoding: Json = Json {
  ignoreUnknownKeys = true
  explicitNulls = false
  coerceInputValues = true
}

/** A Firestore value as JSON; a timestamp becomes its epoch milliseconds, as the console's `*Ms` fields hold. */
fun firestoreJson(value: Any?): JsonElement = when (value) {
  null -> JsonNull
  is String -> JsonPrimitive(value)
  is Boolean -> JsonPrimitive(value)
  is Number -> JsonPrimitive(value)
  is FirestoreTimestamp -> JsonPrimitive(value.epochMillis)
  is Map<*, *> -> JsonObject(value.entries.associate { it.key.toString() to firestoreJson(it.value) })
  is List<*> -> JsonArray(value.map(::firestoreJson))
  else -> JsonPrimitive(value.toString())
}

/** This document's fields decoded as [strategy] (a generated contract type), or null when they do not fit it. */
fun <T> FirestoreDoc.decode(strategy: DeserializationStrategy<T>): T? =
  runCatching { FirestoreDecoding.decodeFromJsonElement(strategy, firestoreJson(data)) }.getOrNull()
