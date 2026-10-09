package com.aglyn.screens

import com.aglyn.contracts.formatOrderMoney
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.round

/**
 * The values a console screen spec reads: paths into a JSON context, text
 * templates, display formats and `when` conditions. Twin of the Apple
 * `ScreenValues`; both replay `libs/native/screens/template-cases.json`.
 */
object ScreenValues {
  /** The time zone dates print in; tests pin it to UTC. */
  var timeZone: String? = null

  fun lookup(path: String, context: JsonElement): JsonElement? {
    val trimmed = path.trim()
    if (trimmed.isEmpty()) return context
    var current: JsonElement? = context
    for (raw in segments(trimmed)) {
      val open = raw.indexOf('[')
      if (raw.endsWith("]") && open >= 0) {
        val segment = raw.substring(0, open)
        val inner = raw.substring(open + 1, raw.length - 1)
        if (segment.isNotEmpty()) current = step(current, segment)
        val equals = inner.indexOf('=')
        if (equals >= 0) {
          val wanted = text(lookup(inner.substring(equals + 1), context))
          val field = inner.substring(0, equals)
          current = (current as? JsonArray)?.firstOrNull { text(lookup(field, it)) == wanted }
        } else {
          current = step(current, inner)
        }
      } else if (raw.isNotEmpty()) {
        current = step(current, raw)
      }
    }
    return current
  }

  /** The rows a list or meters block walks: an array as it is, or an object's entries as `{ key, value }`. */
  fun rows(value: JsonElement?): List<JsonElement> = when (value) {
    is JsonArray -> value
    is JsonObject -> value.keys.sorted().map { JsonObject(mapOf("key" to JsonPrimitive(it), "value" to value.getValue(it))) }
    else -> emptyList()
  }

  internal fun segments(path: String): List<String> {
    val parts = mutableListOf<String>()
    val current = StringBuilder()
    var depth = 0
    for (c in path) {
      if (c == '[') depth++
      if (c == ']') depth--
      if (c == '.' && depth == 0) {
        parts += current.toString()
        current.clear()
      } else {
        current.append(c)
      }
    }
    parts += current.toString()
    return parts
  }

  private fun step(current: JsonElement?, segment: String): JsonElement? = when (current) {
    is JsonObject -> current[segment]
    is JsonArray -> if (segment == "length") JsonPrimitive(current.size) else segment.toIntOrNull()?.let { current.getOrNull(it) }
    else -> null
  }

  fun truthy(value: JsonElement?): Boolean = when (value) {
    null, JsonNull -> false
    is JsonPrimitive -> when {
      value.isString -> value.content.isNotEmpty()
      value.booleanOrNull != null -> value.booleanOrNull!!
      else -> value.doubleOrNull.let { it != null && it != 0.0 && !it.isNaN() }
    }
    is JsonArray -> value.isNotEmpty()
    is JsonObject -> value.isNotEmpty()
  }

  fun text(value: JsonElement?): String = when (value) {
    null, JsonNull -> ""
    is JsonPrimitive -> when {
      value.isString -> value.content
      value.booleanOrNull != null -> value.content
      else -> value.doubleOrNull?.let { numberText(it) } ?: value.content
    }
    is JsonArray -> value.map { text(it) }.filter { it.isNotEmpty() }.joinToString(", ")
    is JsonObject -> ""
  }

  internal fun numberText(number: Double): String =
    if (number.isFinite() && number == floor(number) && abs(number) < 9_007_199_254_740_992.0) number.toLong().toString()
    else number.toString()

  fun evaluate(expression: String, context: JsonElement): JsonElement? {
    var body = expression
    var format: String? = null
    lastUnquotedColon(body)?.let { colon ->
      format = body.substring(colon + 1).trim()
      body = body.substring(0, colon)
    }
    // `a ?? b`: the first alternative that is present at all (false and 0 count), else the quoted literal.
    if (body.contains("??")) {
      var found: JsonElement? = null
      for (alternative in body.split("??")) {
        val part = alternative.trim()
        if (part.length >= 2 && part.startsWith("'") && part.endsWith("'")) {
          found = JsonPrimitive(part.substring(1, part.length - 1))
          break
        }
        val value = lookup(part, context)
        if (value != null && value != JsonNull) {
          found = value
          break
        }
      }
      val named = format
      return if (named.isNullOrEmpty()) found else JsonPrimitive(formatted(found, named, context))
    }
    var picked: JsonElement? = null
    var firstPresent: JsonElement? = null
    for (alternative in splitUnquoted(body, '|')) {
      val part = alternative.trim()
      if (part.length >= 2 && part.startsWith("'") && part.endsWith("'")) {
        picked = JsonPrimitive(part.substring(1, part.length - 1))
        break
      }
      val value = lookup(part, context)
      if (truthy(value)) {
        picked = value
        break
      }
      if (firstPresent == null && value != null && value != JsonNull) firstPresent = value
    }
    val result = picked ?: firstPresent
    val named = format
    return if (named.isNullOrEmpty()) result else JsonPrimitive(formatted(result, named, context))
  }

  fun render(template: String, context: JsonElement): String {
    val out = StringBuilder()
    var i = 0
    while (i < template.length) {
      val c = template[i]
      if (c == '{') {
        if (i + 1 < template.length && template[i + 1] == '{') {
          out.append('{')
          i += 2
          continue
        }
        val close = template.indexOf('}', i + 1)
        if (close >= 0) {
          out.append(text(evaluate(template.substring(i + 1, close), context)))
          i = close + 1
          continue
        }
      }
      out.append(c)
      i++
    }
    return out.toString()
  }

  fun resolve(template: String, context: JsonElement): JsonElement {
    val t = template.trim()
    if (t.startsWith("{") && t.endsWith("}") && !t.startsWith("{{") &&
      t.substring(1).indexOf('{') < 0 && t.substring(1, t.length - 1).indexOf('}') < 0
    ) {
      return evaluate(t.substring(1, t.length - 1), context) ?: JsonNull
    }
    return JsonPrimitive(render(template, context))
  }

  fun resolveBody(body: JsonElement, context: JsonElement): JsonElement = when (body) {
    is JsonPrimitive -> if (body.isString) resolve(body.content, context) else body
    is JsonArray -> JsonArray(body.map { resolveBody(it, context) })
    is JsonObject -> if (body.size == 1 && (body["\$append"] is JsonObject || body["\$without"] is JsonObject)) {
      // `{"$append": {"list": "{a}", "item": "{b}"}}` / `$without`: the list with the item added (once) or removed.
      val adding = body["\$append"] is JsonObject
      val spec = (body["\$append"] ?: body["\$without"]) as JsonObject
      val list = ((spec["list"]?.let { resolveBody(it, context) }) as? JsonArray)?.toMutableList() ?: mutableListOf()
      val item = spec["item"]?.let { resolveBody(it, context) } ?: JsonNull
      if (adding) {
        if (item != JsonNull && item != JsonPrimitive("") && item !in list) list += item
      } else {
        list.removeAll { it == item }
      }
      JsonArray(list)
    } else if (body.size == 1 && body["\$split"] != null) {
      // `{"$split": "{form.pcts}"}`: the comma-separated text as a list; a part that is a number stays one.
      val parts = text(resolveBody(body.getValue("\$split"), context)).split(',').map { it.trim() }.filter { it.isNotEmpty() }
      JsonArray(parts.map { part -> part.toLongOrNull()?.let { JsonPrimitive(it) } ?: part.toDoubleOrNull()?.let { JsonPrimitive(it) } ?: JsonPrimitive(part) })
    } else if (body.size == 1 && body["\$pick"] is JsonObject) {
      // `{"$pick": {"a": "{form.x}"}}`: the keys whose values are truthy, as a list.
      val options = body["\$pick"] as JsonObject
      JsonArray(options.keys.sorted().filter { truthy(resolveBody(options.getValue(it), context)) }.map { JsonPrimitive(it) })
    } else JsonObject(
      buildMap {
        for ((key, value) in body) {
          val resolved = resolveBody(value, context)
          // A template that found nothing is left out; a literal null is sent (it clears the field).
          if (resolved != JsonNull || value == JsonNull) put(key, resolved)
        }
      },
    )
    JsonNull -> JsonNull
  }

  fun renderUrl(template: String, context: JsonElement): String {
    val out = StringBuilder()
    var i = 0
    while (i < template.length) {
      val c = template[i]
      if (c == '{') {
        val close = template.indexOf('}', i + 1)
        if (close >= 0) {
          out.append(encodeComponent(text(evaluate(template.substring(i + 1, close), context))))
          i = close + 1
          continue
        }
      }
      out.append(c)
      i++
    }
    return out.toString()
  }

  /** `encodeURIComponent`. */
  fun encodeComponent(value: String): String {
    val unreserved = "-_.!~*'()"
    val out = StringBuilder()
    for (byte in value.encodeToByteArray()) {
      val ch = (byte.toInt() and 0xFF)
      val c = ch.toChar()
      if (ch < 128 && (c.isLetterOrDigit() || c in unreserved)) out.append(c)
      else out.append('%').append(ch.toString(16).uppercase().padStart(2, '0'))
    }
    return out.toString()
  }

  fun condition(expression: String?, context: JsonElement): Boolean {
    val e = expression?.trim().orEmpty()
    if (e.isEmpty()) return true
    if ("||" in e) return e.split("||").any { condition(it, context) }
    return e.split("&&").all { clause(it, context) }
  }

  private fun clause(raw: String, context: JsonElement): Boolean {
    val clause = raw.trim()
    for (op in listOf("!=", "==")) {
      val at = clause.indexOf(op)
      if (at >= 0) {
        val left = text(lookup(clause.substring(0, at), context))
        var right = clause.substring(at + 2).trim()
        if (right.length >= 2 && right.startsWith("'") && right.endsWith("'")) right = right.substring(1, right.length - 1)
        val options = right.split(',').map { it.trim() }
        return if (op == "==") left in options else left !in options
      }
    }
    if (clause.startsWith("!")) return !truthy(lookup(clause.substring(1), context))
    return truthy(lookup(clause, context))
  }

  private fun lastUnquotedColon(text: String): Int? {
    var quoted = false
    var found: Int? = null
    text.forEachIndexed { i, c ->
      if (c == '\'') quoted = !quoted
      if (c == ':' && !quoted) found = i
    }
    return found
  }

  private fun splitUnquoted(text: String, separator: Char): List<String> {
    val parts = mutableListOf<String>()
    val current = StringBuilder()
    var quoted = false
    for (c in text) {
      if (c == '\'') quoted = !quoted
      if (c == separator && !quoted) {
        parts += current.toString()
        current.clear()
      } else {
        current.append(c)
      }
    }
    parts += current.toString()
    return parts
  }

  // Formats

  fun epochMillis(value: JsonElement?): Long? = when (value) {
    is JsonPrimitive -> when {
      value.isString -> value.content.toDoubleOrNull()?.let { epochMillis(JsonPrimitive(it)) }
        ?: parseIsoMillis(value.content)
      else -> value.doubleOrNull?.takeIf { it.isFinite() && it > 0 }?.let { if (it < 1e11) (it * 1000).toLong() else it.toLong() }
    }
    is JsonObject -> ((value["_seconds"] ?: value["seconds"]) as? JsonPrimitive)?.doubleOrNull?.let { (it * 1000).toLong() }
      ?: value["\$date"]?.let { epochMillis(it) }
    else -> null
  }

  private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

  private fun dateText(millis: Long, withTime: Boolean): String {
    val (year, month, dayOfMonth, hour, minuteOfHour) = localParts(millis, timeZone)
    val day = "${MONTHS[month - 1]} $dayOfMonth, $year"
    if (!withTime) return day
    val hour12 = if (hour % 12 == 0) 12 else hour % 12
    val minute = minuteOfHour.toString().padStart(2, '0')
    return "$day, $hour12:$minute ${if (hour < 12) "AM" else "PM"}"
  }

  fun number(value: JsonElement?): Double? = when (value) {
    is JsonPrimitive -> if (value.isString) value.content.toDoubleOrNull() else value.booleanOrNull?.let { if (it) 1.0 else 0.0 } ?: value.doubleOrNull
    else -> null
  }

  /** Thousands grouped with commas, up to `fraction` decimals, half up. */
  fun grouped(value: Double, fraction: Int = 0): String {
    var scale = 1.0
    repeat(fraction) { scale *= 10 }
    val rounded = floor(abs(value) * scale + 0.5) / scale
    val whole = floor(rounded).toLong()
    var frac = ""
    if (fraction > 0) {
      val digits = round((rounded - whole) * scale).toLong().toString().padStart(fraction, '0').trimEnd('0')
      if (digits.isNotEmpty()) frac = ".$digits"
    }
    val wholeText = whole.toString().reversed().chunked(3).joinToString(",").reversed()
    return (if (value < 0 && (whole != 0L || frac.isNotEmpty())) "-" else "") + wholeText + frac
  }

  internal fun bytesText(value: Double): String {
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var amount = value
    var unit = 0
    while (abs(amount) >= 1024 && unit < units.size - 1) {
      amount /= 1024
      unit++
    }
    return if (unit == 0) "${grouped(amount)} B" else "${grouped(amount, 1)} ${units[unit]}"
  }

  fun formatted(value: JsonElement?, format: String, context: JsonElement): String {
    val parts = format.split('/', limit = 2)
    return when (parts[0]) {
      "date" -> epochMillis(value)?.let { dateText(it, false) } ?: text(value)
      "datetime" -> epochMillis(value)?.let { dateText(it, true) } ?: text(value)
      "cents" -> number(value)?.let { amount ->
        val currency = if (parts.size > 1) text(lookup(parts[1], context)) else "USD"
        formatOrderMoney(round(amount), currency.ifEmpty { "USD" })
      } ?: text(value)
      "dollars" -> number(value)?.let { formatOrderMoney(round(it * 100), "USD") } ?: text(value)
      "bytes" -> number(value)?.let { bytesText(it) } ?: text(value)
      "number" -> number(value)?.let { grouped(it, 2) } ?: text(value)
      "percent" -> number(value)?.let { "${grouped(it * 100, 1)}%" } ?: text(value)
      "count" -> when (value) {
        is JsonArray -> value.size.toString()
        is JsonObject -> value.size.toString()
        else -> number(value)?.let { grouped(it) } ?: "0"
      }
      "yesno" -> if (truthy(value)) "Yes" else "No"
      "title" -> text(value).replace('_', ' ').replace('-', ' ').replaceFirstChar { it.uppercase() }
      "upper" -> text(value).uppercase()
      "json" -> value?.toString() ?: ""
      else -> text(value)
    }
  }
}

/** An ISO-8601 instant or date as epoch milliseconds; null when it is not one. */
internal expect fun parseIsoMillis(text: String): Long?

/** Year, month (1–12), day, hour and minute of an instant in a zone (the device's when null). */
internal expect fun localParts(millis: Long, zone: String?): List<Int>

/** Today's year and month (1–12) in UTC. */
internal expect fun nowParts(): List<Int>

internal expect fun nowMillis(): Long
