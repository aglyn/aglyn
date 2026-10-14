package com.aglyn.pluginhost

import com.aglyn.core.FirestoreTimestamp
import kotlinx.serialization.json.JsonPrimitive

/*
 * JavaScript's spellings of plain values, so a native screen prints a stored
 * value exactly as the console's `String(value)` and `JSON.stringify(value)`
 * print it. The plugins that port a console formatter replay its answers
 * through these.
 */

/** `String(number)`. */
fun jsNumber(value: Double): String {
  if (value.isNaN()) return "NaN"
  if (value.isInfinite()) return if (value > 0) "Infinity" else "-Infinity"
  if (value == kotlin.math.floor(value) && kotlin.math.abs(value) < 1e21) return value.toLong().toString()
  val text = value.toString()
  val at = text.indexOf('E')
  if (at < 0) return text
  val mantissa = text.substring(0, at).removeSuffix(".0")
  val exponent = text.substring(at + 1).toInt()
  return "${mantissa}e${if (exponent >= 0) "+" else ""}$exponent"
}

/** `String(value)` for the plain shapes a record holds. */
fun jsString(value: Any?): String = when (value) {
  null -> "null"
  is String -> value
  is Boolean -> value.toString()
  is Long, is Int -> value.toString()
  is Number -> jsNumber(value.toDouble())
  is List<*> -> value.joinToString(",") { jsJoinPart(it) }
  is Map<*, *> -> "[object Object]"
  is FirestoreTimestamp -> value.toString()
  else -> value.toString()
}

/** An array entry as `Array.prototype.join` writes it: null and undefined as ''. */
private fun jsJoinPart(value: Any?): String = if (value == null) "" else jsString(value)

/** `JSON.stringify` for the plain shapes a record holds. */
fun jsonStringify(value: Any?): String = when (value) {
  null -> "null"
  is String -> JsonPrimitive(value).toString()
  is Boolean -> value.toString()
  is Long, is Int -> value.toString()
  is Number -> value.toDouble().let { if (it.isFinite()) jsNumber(it) else "null" }
  is List<*> -> value.joinToString(",", "[", "]") { jsonStringify(it) }
  is Map<*, *> -> value.entries.joinToString(",", "{", "}") { (key, entry) -> JsonPrimitive(key.toString()).toString() + ":" + jsonStringify(entry) }
  else -> JsonPrimitive(value.toString()).toString()
}
