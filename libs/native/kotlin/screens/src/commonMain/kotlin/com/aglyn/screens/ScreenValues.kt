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

  /** The clock `now` reads, in epoch milliseconds; tests pin it. */
  var clock: () -> Long = { nowMillis() }

  /** `now.year`, `now.month` (`2026-10`), `now.prevMonth`, `now.quarter`, `now.ms` and `now.day` (`2026-10-13`) in UTC, the keys the console's monthly counters and daily documents are named by. */
  fun nowObject(): JsonElement {
    val (year, month, day) = localParts(clock(), "UTC")
    val y = year.toString().padStart(4, '0')
    val m = month.toString().padStart(2, '0')
    val d = day.toString().padStart(2, '0')
    val (priorYear, priorMonth) = if (month == 1) (year - 1) to 12 else year to (month - 1)
    val prior = "${priorYear.toString().padStart(4, '0')}-${priorMonth.toString().padStart(2, '0')}"
    return JsonObject(
      mapOf(
        "year" to JsonPrimitive(y), "month" to JsonPrimitive("$y-$m"), "day" to JsonPrimitive("$y-$m-$d"),
        "prevMonth" to JsonPrimitive(prior), "quarter" to JsonPrimitive("$year-Q${(month - 1) / 3 + 1}"),
        "ms" to JsonPrimitive(clock().toDouble()),
      ),
    )
  }

  fun lookup(path: String, context: JsonElement): JsonElement? = lookup(path, context, context)

  /** [path] read from [start], with every `@path` and selector value read from [root]. */
  private fun lookup(path: String, root: JsonElement, start: JsonElement?): JsonElement? {
    val trimmed = path.trim()
    if (trimmed.isEmpty()) return start
    var current: JsonElement? = start
    val parts = segments(trimmed)
    for ((position, raw) in parts.withIndex()) {
      // `rows.*.field`: that field of every row, as a list (rows without it are left out; a field
      // that is itself a list adds its members, so `resources.*.items` is every resource's items).
      val walked = wildcardRows(current)
      if (raw == "*" && walked != null) {
        val rest = parts.drop(position + 1).joinToString(".")
        return JsonArray(walked.mapNotNull { if (rest.isEmpty()) it else lookup(rest, root, it) }.flatMap { if (it is JsonArray) it.toList() else listOf(it) })
      }
      // `name[group][group]…`: each group is `[field=other.path]` (the first row whose field reads as the text
      // at other.path, or as a quoted literal), `[@path]` (the key is the text at path) or `[some.key]` (a key
      // that itself holds dots).
      var name = raw
      var groups = emptyList<String>()
      val open = raw.indexOf('[')
      if (raw.endsWith("]") && open >= 0) {
        name = raw.substring(0, open)
        groups = bracketGroups(raw.substring(open))
      }
      if (name.isNotEmpty()) current = step(current, name)
      for (inner in groups) {
        val equals = inner.indexOf('=')
        if (inner.startsWith("@")) {
          current = step(current, text(lookup(inner.substring(1), root, root)))
        } else if (equals >= 0) {
          val field = inner.substring(0, equals)
          val right = inner.substring(equals + 1).trim()
          val wanted = if (right.length >= 2 && right.startsWith("'") && right.endsWith("'")) right.substring(1, right.length - 1) else text(lookup(right, root, root))
          current = (current as? JsonArray)?.firstOrNull { text(lookup(field, it, it)) == wanted }
        } else {
          current = step(current, inner)
        }
      }
    }
    return current
  }

  /** What `*` walks: an array's rows, or an object's values in key order. */
  private fun wildcardRows(value: JsonElement?): List<JsonElement>? = when (value) {
    is JsonArray -> value
    is JsonObject -> value.keys.sorted().map { value.getValue(it) }
    else -> null
  }

  /** The groups of `[a][b[c]]`: `a` and `b[c]`, matching brackets inside a group. */
  private fun bracketGroups(text: String): List<String> {
    val groups = mutableListOf<String>()
    var depth = 0
    val current = StringBuilder()
    for (character in text) {
      if (character == '[') {
        if (depth > 0) current.append(character)
        depth += 1
      } else if (character == ']') {
        depth -= 1
        if (depth == 0) {
          groups += current.toString()
          current.clear()
        } else {
          current.append(character)
        }
      } else if (depth > 0) {
        current.append(character)
      }
    }
    return groups
  }

  /** The rows a list or meters block walks: an array as it is, or an object's entries as `{ key, value }`. */
  fun rows(value: JsonElement?): List<JsonElement> = when (value) {
    is JsonArray -> value
    is JsonObject -> value.keys.sorted().map { JsonObject(mapOf("key" to JsonPrimitive(it), "value" to value.getValue(it))) }
    else -> emptyList()
  }

  /**
   * The scopes a list or an option source walks: one per row of `items` that meets `filter`, with
   * the row as `item` and its position as `index`; or, given `within` (a path read from each row), one per row of that inner
   * list, the outer row as `parent` (every resource's items, labeled by their resource).
   */
  fun scopes(path: String, within: String?, filter: String?, context: JsonElement): List<JsonElement> {
    val found = mutableListOf<JsonElement>()
    for ((at, row) in rows(lookup(path, context)).withIndex()) {
      val outer = ScreenContext.with(ScreenContext.withItem(context, row), "index", JsonPrimitive(at))
      if (!within.isNullOrEmpty()) {
        for ((inside, inner) in rows(lookup(within, row)).withIndex()) {
          found += ScreenContext.with(ScreenContext.withItem(outer, inner), "index", JsonPrimitive(inside))
        }
      } else {
        found += outer
      }
    }
    return found.filter { condition(filter, it) }
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
    // `a + b - c`: a sum of numbers (paths or literals), each operator set apart by spaces. A term
    // that is missing makes the whole sum missing, so a read that failed never shows as zero.
    arithmeticTerms(body)?.let { terms ->
      var total = 0.0
      for ((sign, term) in terms) {
        // A term ending in `?` is zero where it is missing (an add-on never bought).
        val optional = term.endsWith("?")
        val path = if (optional) term.dropLast(1) else term
        val value = path.toDoubleOrNull()?.let { JsonPrimitive(it) } ?: lookup(path, context)
        if (optional && (value == null || value == JsonNull)) continue
        // A list (`rows.*.field`) adds up its numbers.
        if (value is JsonArray) {
          total += sign * value.mapNotNull { number(it) }.sum()
          continue
        }
        val amount = number(value) ?: return null
        total += sign * amount
      }
      val sum = JsonPrimitive(total)
      val named = format
      return if (named.isNullOrEmpty()) sum else JsonPrimitive(formatted(sum, named, context))
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
    } else if (body.size == 1 && body["\$put"] is JsonObject) {
      // `{"$put": {"map": "{a}", "key": "{b}", "value": "{c}"}}`: the map with the key set, or removed when the value is empty.
      val spec = body["\$put"] as JsonObject
      val map = ((spec["map"]?.let { resolveBody(it, context) }) as? JsonObject)?.toMutableMap() ?: mutableMapOf()
      val key = text(spec["key"]?.let { resolveBody(it, context) })
      val value = spec["value"]?.let { resolveBody(it, context) } ?: JsonNull
      if (key.isNotEmpty()) { if (truthy(value)) map[key] = value else map.remove(key) }
      JsonObject(map)
    } else if (body.size == 1 && body["\$index"] is JsonObject) {
      // `{"$index": {"rows": "data.picklists", "key": "{item.fieldId}", "value": "{item.proposals}"}}`: the rows as a
      // map, each under its key (a row with no key is left out).
      val spec = body["\$index"] as JsonObject
      val map = mutableMapOf<String, JsonElement>()
      for (row in rows(lookup(spec["rows"]?.let { (it as? JsonPrimitive)?.content }.orEmpty(), context))) {
        val scope = ScreenContext.withItem(context, row)
        val key = text(spec["key"]?.let { resolveBody(it, scope) })
        if (key.isNotEmpty()) map[key] = spec["value"]?.let { resolveBody(it, scope) } ?: JsonNull
      }
      JsonObject(map)
    } else if (body.size == 1 && body["\$merge"] is JsonArray) {
      // `{"$merge": [a, b]}`: the maps laid over one another, deeply; a later value wins.
      var merged: Map<String, JsonElement> = emptyMap()
      for (part in body["\$merge"] as JsonArray) (resolveBody(part, context) as? JsonObject)?.let { merged = mergeMaps(merged, it) }
      JsonObject(merged)
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
          // `name?`: sent only when it holds something (not null, "", [] or {}); false and 0 are real answers.
          if (key.endsWith("?")) {
            if (!isBlank(resolved)) put(key.dropLast(1), resolved)
            continue
          }
          // A template that found nothing is left out; a literal null is sent (it clears the field).
          if (resolved != JsonNull || value == JsonNull) put(key, resolved)
        }
      },
    )
    JsonNull -> JsonNull
  }

  /** Nothing to send: null, empty text, an empty list or an empty map. */
  internal fun isBlank(value: JsonElement): Boolean = when (value) {
    JsonNull -> true
    is JsonPrimitive -> value.isString && value.content.isEmpty()
    is JsonArray -> value.isEmpty()
    is JsonObject -> value.isEmpty()
  }

  /** [base] with [top] laid over it: maps merge key by key, anything else is replaced. */
  internal fun mergeMaps(base: Map<String, JsonElement>, top: Map<String, JsonElement>): Map<String, JsonElement> {
    val out = base.toMutableMap()
    for ((key, value) in top) {
      val under = out[key]
      out[key] = if (value is JsonObject && under is JsonObject) JsonObject(mergeMaps(under, value)) else value
    }
    return out
  }

  /**
   * A chosen file's text: UTF-8 (a byte-order mark dropped), UTF-16 where it carries its mark, else
   * Windows-1252, the encoding a spreadsheet's "CSV" is saved in. Nothing is dropped silently.
   */
  fun decodeFileText(bytes: ByteArray): String {
    fun at(i: Int) = bytes.getOrNull(i)?.toInt()?.and(0xFF) ?: -1
    if (at(0) == 0xEF && at(1) == 0xBB && at(2) == 0xBF) return bytes.decodeToString(3, bytes.size)
    if (at(0) == 0xFF && at(1) == 0xFE) return utf16(bytes, 2, littleEndian = true)
    if (at(0) == 0xFE && at(1) == 0xFF) return utf16(bytes, 2, littleEndian = false)
    return try {
      bytes.decodeToString(throwOnInvalidSequence = true)
    } catch (_: CharacterCodingException) {
      buildString { for (b in bytes) append(windows1252(b.toInt() and 0xFF)) }
    }
  }

  private fun utf16(bytes: ByteArray, from: Int, littleEndian: Boolean): String {
    val out = StringBuilder()
    var i = from
    while (i + 1 < bytes.size) {
      val a = bytes[i].toInt() and 0xFF
      val b = bytes[i + 1].toInt() and 0xFF
      out.append((if (littleEndian) (b shl 8) or a else (a shl 8) or b).toChar())
      i += 2
    }
    return out.toString()
  }

  private val cp1252High = "\u20AC\u0081\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u008D\u017D\u008F" +
    "\u0090\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u009D\u017E\u0178"

  private fun windows1252(code: Int): Char = if (code in 0x80..0x9F) cp1252High[code - 0x80] else code.toChar()

  /** What one character costs once JSON-encoded, in UTF-8 bytes (the console's `encodedBytes`). */
  private fun encodedBytes(code: Int): Int = when {
    code == '"'.code || code == '\\'.code -> 2
    code == 0x08 || code == 0x09 || code == 0x0A || code == 0x0C || code == 0x0D -> 2
    code < 0x20 -> 6
    code < 0x80 -> 1
    code < 0x800 -> 2
    code in 0xD800..0xDFFF -> 6 // a lone surrogate is written as \uXXXX
    code < 0x10000 -> 3
    else -> 4
  }

  /**
   * A file's text cut into parts that each take at most [budget] bytes once JSON-encoded, ending on a
   * character boundary (a surrogate pair is never split), so the parts join back into the file.
   */
  fun splitUpload(text: String, budget: Int = 3_000_000): List<String> {
    val parts = mutableListOf<String>()
    var start = 0
    var at = 0
    var used = 0
    while (at < text.length) {
      val high = text[at].isHighSurrogate() && at + 1 < text.length && text[at + 1].isLowSurrogate()
      val size = if (high) 2 else 1
      val cost = if (high) 4 else encodedBytes(text[at].code)
      if (used + cost > budget && at > start) {
        parts += text.substring(start, at)
        start = at
        used = 0
      }
      used += cost
      at += size
    }
    parts += text.substring(start)
    return parts
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
    val equality = "==" in clause || "!=" in clause
    // `path ~= x` (or `~= @path`): a list holds x, or a text contains it.
    if (!equality) {
      val at = clause.indexOf("~=")
      if (at >= 0) {
        // `path !~= x` is the other way round.
        val negated = clause.substring(0, at).endsWith("!")
        val left = lookup(clause.substring(0, at).trimEnd('!', ' '), context)
        var right = clause.substring(at + 2).trim()
        if (right.length >= 2 && right.startsWith("'") && right.endsWith("'")) right = right.substring(1, right.length - 1)
        // `a ~= @path`: what is wanted is read from the context (the kinds a file holds, against a row's own).
        else if (right.startsWith("@")) right = text(lookup(right.substring(1), context))
        val holds = if (left is JsonArray) left.any { text(it) == right } else text(left).contains(right)
        return if (negated) !holds else holds
      }
      // `a > b`, `a >= b`, `a < b`, `a <= b`: numbers, each side a literal or a path.
      for (op in listOf(">=", "<=", ">", "<")) {
        val place = clause.indexOf(op)
        if (place < 0) continue
        fun side(part: String): Double? = part.trim().let { it.toDoubleOrNull() ?: number(lookup(it, context)) }
        val left = side(clause.substring(0, place)) ?: return false
        val right = side(clause.substring(place + op.length)) ?: return false
        return when (op) {
          ">=" -> left >= right
          "<=" -> left <= right
          ">" -> left > right
          else -> left < right
        }
      }
    }
    for (op in listOf("!=", "==")) {
      val at = clause.indexOf(op)
      if (at >= 0) {
        val left = text(lookup(clause.substring(0, at), context))
        var right = clause.substring(at + 2).trim()
        if (right.length >= 2 && right.startsWith("'") && right.endsWith("'")) right = right.substring(1, right.length - 1)
        // `a == @path`: the other side is read from the context (the plan a row stands for against the current one).
        val options = if (right.startsWith("@")) listOf(text(lookup(right.substring(1), context))) else right.split(',').map { it.trim() }
        return if (op == "==") left in options else left !in options
      }
    }
    if (clause.startsWith("!")) return !truthy(lookup(clause.substring(1), context))
    return truthy(lookup(clause, context))
  }

  /** The signed terms of `a + b - c`, or null where the text is not a sum. */
  internal fun arithmeticTerms(body: String): List<Pair<Double, String>>? {
    if ('\'' in body || !(body.contains(" + ") || body.contains(" - "))) return null
    val terms = mutableListOf<Pair<Double, String>>()
    var sign = 1.0
    val current = mutableListOf<String>()
    for (word in body.split(' ').filter { it.isNotEmpty() }) {
      if (word == "+" || word == "-") {
        if (current.isEmpty()) return null
        terms += sign to current.joinToString(" ")
        current.clear()
        sign = if (word == "+") 1.0 else -1.0
      } else {
        current += word
      }
    }
    if (current.isEmpty()) return null
    terms += sign to current.joinToString(" ")
    return if (terms.size > 1) terms else null
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
    // `first3`: a list's first three entries, joined.
    if (parts[0].startsWith("first") && value is JsonArray) {
      parts[0].drop(5).toIntOrNull()?.let { count -> return text(JsonArray(value.take(count))) }
    }
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
