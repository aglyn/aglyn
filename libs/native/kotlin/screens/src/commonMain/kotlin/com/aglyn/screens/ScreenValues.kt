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
import kotlin.math.max
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
    val parts = segments(trimmed)
    for ((position, raw) in parts.withIndex()) {
      if (raw == "*") {
        // `rows.*.field`: that field of every row, as a list (rows without it are left out). Over an object (a map of
        // holds by key) the rows are its values, in key order.
        val rest = parts.drop(position + 1).joinToString(".")
        val items = when (val source = current) {
          is JsonArray -> source
          is JsonObject -> source.entries.sortedBy { it.key }.map { it.value }
          else -> return null
        }
        return JsonArray(items.mapNotNull { row -> if (rest.isEmpty()) row else lookup(rest, row)?.takeIf { it != JsonNull } })
      }
      val open = raw.indexOf('[')
      if (raw.endsWith("]") && open >= 0) {
        val segment = raw.substring(0, open)
        val inner = raw.substring(open + 1, raw.length - 1)
        if (segment.isNotEmpty()) current = step(current, segment)
        val contains = inner.indexOf("~=")
        val equals = inner.indexOf('=')
        if (contains >= 0) {
          // `rows[badges~=path]`: the first row whose list field holds the text at path.
          val wanted = text(lookup(inner.substring(contains + 2), context))
          val field = inner.substring(0, contains)
          current = (current as? JsonArray)?.firstOrNull { row -> (lookup(field, row) as? JsonArray)?.any { text(it) == wanted } == true }
        } else if (equals >= 0) {
          val wanted = text(lookup(inner.substring(equals + 1), context))
          val field = inner.substring(0, equals)
          current = (current as? JsonArray)?.firstOrNull { text(lookup(field, it)) == wanted }
        } else if (inner.startsWith("@")) {
          // `map[@path]`: the key is the text at path.
          current = step(current, text(lookup(inner.substring(1), context)))
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

  /**
   * Rows in the order a list's `sort` asks for: `"value desc"` or `"name"` (ascending), a field of each row (`item.` is not
   * written). Numbers compare as numbers and anything else as text; a row without the field goes last.
   */
  fun sorted(rows: List<JsonElement>, sort: String): List<JsonElement> {
    val words = sort.split(' ').filter { it.isNotEmpty() }
    val field = words.firstOrNull() ?: return rows
    val descending = words.getOrNull(1) == "desc"
    fun present(row: JsonElement) = lookup(field, row).let { it != null && it != JsonNull }
    val comparator = Comparator<JsonElement> { a, b ->
      when {
        !present(a) && !present(b) -> 0
        !present(a) -> 1
        !present(b) -> -1
        else -> {
          val left = lookup(field, a)
          val right = lookup(field, b)
          val x = number(left)
          val y = number(right)
          val order = if (x != null && y != null) x.compareTo(y) else text(left).compareTo(text(right), ignoreCase = true)
          if (descending) -order else order
        }
      }
    }
    // `sortedWith` is stable: equal rows keep the order they came in.
    return rows.sortedWith(comparator)
  }

  /**
   * The rows one or more levels down: each segment of [path] names the list (or map) inside every row so far,
   * and each row found carries `$parent`, the row it came out of (and so on up: `item.$parent.$parent`).
   */
  fun flatten(rows: List<JsonElement>, path: String): List<JsonElement> {
    var current = rows
    for (segment in path.split('.').filter { it.isNotEmpty() }) {
      current = current.flatMap { container ->
        rows(lookup(segment, container)).map { child ->
          val record = (child as? JsonObject)?.toMutableMap() ?: mutableMapOf("value" to child)
          record["\$parent"] = container
          JsonObject(record)
        }
      }
    }
    return current
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
    // A negative number counts from the end: `attempts.-1` is the last one.
    is JsonArray -> if (segment == "length") JsonPrimitive(current.size) else segment.toIntOrNull()?.let { current.getOrNull(if (it < 0) current.size + it else it) }
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
    // `{?a == b || !c}`: a condition, as true or false.
    if (expression.trimStart().startsWith("?")) return JsonPrimitive(condition(expression.trim().substring(1), context))
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
    } else if (body.size == 1 && body["\$put"] is JsonObject) {
      // `{"$put": {"map": "{a}", "key": "{b}", "value": "{c}"}}`: the map with the key set, or removed when the value is empty.
      val spec = body["\$put"] as JsonObject
      val map = ((spec["map"]?.let { resolveBody(it, context) }) as? JsonObject)?.toMutableMap() ?: mutableMapOf()
      val key = text(spec["key"]?.let { resolveBody(it, context) })
      val value = spec["value"]?.let { resolveBody(it, context) } ?: JsonNull
      if (key.isNotEmpty()) { if (truthy(value)) map[key] = value else map.remove(key) }
      JsonObject(map)
    } else if (body.size == 1 && body["\$timestamp"] != null) {
      // `{"$timestamp": true}`: the server's time, written as a Firestore timestamp (a write's `updatedAt`).
      JsonObject(mapOf("\$timestamp" to JsonPrimitive(true)))
    } else if (body.size == 1 && body["\$dateMs"] is JsonObject) {
      // `{"$dateMs": {"value": "{form.starts}", "time": "23:59:59"}}`: a date and a UTC time of day as epoch milliseconds; null when it is not a date.
      // With `"local": true` the time of day is the device's own (a browser's `Date.parse` of a zone-less time).
      val spec = body["\$dateMs"] as JsonObject
      val date = text(spec["value"]?.let { resolveBody(it, context) }).trim()
      val time = (spec["time"] as? JsonPrimitive)?.content ?: "00:00:00"
      val local = (spec["local"] as? JsonPrimitive)?.content == "true"
      (if (Regex("""\d{4}-\d{2}-\d{2}""").matches(date)) parseIsoMillis("${date}T${time}Z") else null)
        ?.let { utc -> if (local) deviceWallClockToMillis(utc) else utc }
        ?.let { JsonPrimitive(it) } ?: JsonNull
    } else if (body.size == 1 && body["\$slug"] != null) {
      // `{"$slug": "{form.name}"}`: the console's slug of a name (lower case, letters and digits joined by hyphens).
      JsonPrimitive(com.aglyn.contracts.commerceSlug(text(resolveBody(body.getValue("\$slug"), context))))
    } else if (body.size == 1 && body["\$codes"] != null) {
      // `{"$codes": "{form.countries}"}`: comma- or line-separated codes, trimmed and upper case, as a list (empty ones dropped).
      JsonArray(text(resolveBody(body.getValue("\$codes"), context)).split(',', '\n').map { it.trim().uppercase() }.filter { it.isNotEmpty() }.map { JsonPrimitive(it) })
    } else if (body.size == 1 && body["\$reject"] is JsonObject) {
      // `{"$reject": {"list": "{rates}", "key": "zoneId", "match": "{item.id}"}}`: the list without the rows whose `key` equals `match`.
      val spec = body["\$reject"] as JsonObject
      val list = (spec["list"]?.let { resolveBody(it, context) } as? JsonArray) ?: JsonArray(emptyList())
      val key = (spec["key"] as? JsonPrimitive)?.content.orEmpty()
      val match = text(spec["match"]?.let { resolveBody(it, context) })
      JsonArray(list.filter { text(lookup(key, it)) != match })
    } else if (body.size == 1 && body["\$overlay"] is JsonObject) {
      // `{"$overlay": {"base": "{overlay}", "set": {"slug": "{form.slug}", "supplierId": {"$orNull": "{form.supplier}"}}}}`: the base object with each
      // key of `set` put on top, a key whose value is null taken off. What a route that replaces a document is sent.
      val spec = body["\$overlay"] as JsonObject
      val base = (spec["base"]?.let { resolveBody(it, context) } as? JsonObject) ?: JsonObject(emptyMap())
      val set = (spec["set"]?.let { resolveBody(it, context) } as? JsonObject) ?: JsonObject(emptyMap())
      val merged = base.toMutableMap()
      for ((key, value) in set) if (value is JsonNull) merged.remove(key) else merged[key] = value
      JsonObject(merged)
    } else if (body.size == 1 && body["\$map"] is JsonObject) {
      // `{"$map": {"list": "{data.rates.results}", "where": "item.rate", "fields": {"recordId": "{item.recordId}"}}}`: one object of
      // `fields` for each row of the list that meets `where` (all of them with none), each read with `item` set to the row.
      val spec = body["\$map"] as JsonObject
      val list = (spec["list"]?.let { resolveBody(it, context) } as? JsonArray) ?: JsonArray(emptyList())
      val keep = (spec["where"] as? JsonPrimitive)?.content
      val fields = spec["fields"] ?: JsonNull
      JsonArray(list.map { ScreenContext.withItem(context, it) }.filter { condition(keep, it) }.map { resolveBody(fields, it) })
    } else if (body.size == 1 && body["\$number"] != null) {
      // `{"$number": "{form.ready}"}`: a choice or typed text as a number; null when it is not one (a select's "don't say").
      number(resolveBody(body.getValue("\$number"), context))?.let { JsonPrimitive(it) } ?: JsonNull
    } else if (body.size == 1 && body["\$nowMs"] != null) {
      // `{"$nowMs": true}`: the time of the press, as epoch milliseconds (a moderation's `moderatedAtMs`).
      JsonPrimitive(nowMillis())
    } else if (body.size == 1 && body["\$orNull"] != null) {
      // `{"$orNull": "{form.parentId}"}`: the value, or an explicit null when it is empty (a merge write clears the field).
      resolveBody(body.getValue("\$orNull"), context).let { if (truthy(it)) it else JsonNull }
    } else if (body.size == 1 && body["\$cents"] != null) {
      // `{"$cents": "{form.amount}"}`: typed dollars (`12.50`, `$1,200`, and `-5.50` to take money away) as whole cents; null when it is not an amount.
      val signed = text(resolveBody(body.getValue("\$cents"), context)).trim().removePrefix("$").replace(",", "")
      val negative = signed.startsWith("-")
      val typed = signed.removePrefix("-").removePrefix("$")
      if (Regex("""\d+(\.\d{0,2})?|\.\d{1,2}""").matches(typed)) {
        val (whole, fraction) = typed.split('.').let { it[0] to it.getOrElse(1) { "" } }
        val cents = whole.ifEmpty { "0" }.toLong() * 100 + fraction.padEnd(2, '0').take(2).ifEmpty { "0" }.toLong()
        JsonPrimitive(if (negative) -cents else cents)
      } else JsonNull
    } else if (body.size == 1 && body["\$gather"] is JsonObject) {
      // `{"$gather": {"from": "{form}", "prefix": "restock_", "key": "lineItemId", "value": "quantity"}}`: the entries of
      // an object whose names start with `prefix`, as `{ key: <rest of the name>, value: <entry> }` rows in name order.
      val spec = body["\$gather"] as JsonObject
      val source = (spec["from"]?.let { resolveBody(it, context) } as? JsonObject) ?: JsonObject(emptyMap())
      val prefix = (spec["prefix"] as? JsonPrimitive)?.content.orEmpty()
      val keyName = (spec["key"] as? JsonPrimitive)?.content ?: "key"
      val valueName = (spec["value"] as? JsonPrimitive)?.content ?: "value"
      // `with` adds more columns from other prefixes (`{"reason": "reason_"}`); `skipEmpty` leaves out a row whose value is empty or zero.
      val extra = (spec["with"] as? JsonObject)?.entries.orEmpty().associate { it.key to (it.value as? JsonPrimitive)?.content.orEmpty() }
      val skipEmpty = (spec["skipEmpty"] as? JsonPrimitive)?.content == "true"
      // `keys`: only the names (after the prefix) of the entries that are on, in name order: the checked events of a list of toggles.
      if ((spec["keys"] as? JsonPrimitive)?.content == "true") {
        return JsonArray(source.entries.filter { it.key.startsWith(prefix) && truthy(it.value) }.sortedBy { it.key }.map { JsonPrimitive(it.key.removePrefix(prefix)) })
      }
      JsonArray(
        source.entries.filter { it.key.startsWith(prefix) }.sortedBy { it.key }.mapNotNull { (name, entry) ->
          if (skipEmpty && !truthy(entry)) return@mapNotNull null
          val rest = name.removePrefix(prefix)
          val row = mutableMapOf<String, JsonElement>(
            keyName to (rest.toLongOrNull()?.let { JsonPrimitive(it) } ?: JsonPrimitive(rest)),
            valueName to entry,
          )
          for ((column, columnPrefix) in extra) source[columnPrefix + rest]?.let { row[column] = it }
          JsonObject(row)
        },
      )
    } else if (body.size == 1 && body["\$uuid"] is JsonPrimitive) {
      // `{"$uuid": "box_"}`: the prefix and eight random hex digits, a fresh id for a row the person is adding.
      JsonPrimitive(text(resolveBody(body.getValue("\$uuid"), context)) + (1..8).map { "0123456789abcdef".random() }.joinToString(""))
    } else if (body.size == 1 && body["\$replace"] is JsonObject) {
      // `{"$replace": {"list": "{a}", "key": "id", "match": "{b}", "value": {...}}}`: the list with the row whose
      // `key` equals `match` replaced by `value`.
      val spec = body["\$replace"] as JsonObject
      val list = (spec["list"]?.let { resolveBody(it, context) } as? JsonArray) ?: JsonArray(emptyList())
      val key = (spec["key"] as? JsonPrimitive)?.content.orEmpty()
      val match = text(spec["match"]?.let { resolveBody(it, context) })
      val value = spec["value"]?.let { resolveBody(it, context) } ?: JsonNull
      // key "*": the row that equals `match` as a whole (a list of rows with no id of their own).
      val whole = if (key == "*") spec["match"]?.let { resolveBody(it, context) } else null
      JsonArray(list.map { row -> if (if (key == "*") row == whole else text(lookup(key, row)) == match) value else row })
    } else if (body.size == 1 && body["\$if"] is JsonObject) {
      // `{"$if": {"when": "form.scope == org", "then": X, "else": Y}}`: X or Y resolved, or nothing (the member is left out).
      val spec = body["\$if"] as JsonObject
      val branch = if (condition(spec.str("when"), context)) spec["then"] else spec["else"]
      branch?.let { resolveBody(it, context) } ?: JsonNull
    } else if (body.size == 1 && body["\$collect"] is JsonObject) {
      // `{"$collect": {"prefix": "quota.", "as": "number"}}`: the form's `quota.*` inputs as a map, key without the prefix.
      // `as: number` keeps the filled ones as numbers; `as: flag` reads "true" and "false" and leaves "" (inherit) out.
      val spec = body["\$collect"] as JsonObject
      val prefix = spec.str("prefix").orEmpty()
      val kind = spec.str("as") ?: "text"
      val map = mutableMapOf<String, JsonElement>()
      ((lookup("form", context)) as? JsonObject)?.forEach { (key, value) ->
        if (!key.startsWith(prefix)) return@forEach
        val name = key.removePrefix(prefix)
        val primitive = value as? JsonPrimitive
        when {
          value is JsonNull -> {}
          kind == "flag" -> {
            if (primitive != null && !primitive.isString) map[name] = primitive
            else if (primitive?.content == "true") map[name] = JsonPrimitive(true)
            else if (primitive?.content == "false") map[name] = JsonPrimitive(false)
          }
          kind == "number" && primitive != null && primitive.isString -> {
            val trimmed = primitive.content.trim()
            if (trimmed.isNotEmpty()) map[name] = trimmed.toDoubleOrNull()?.let { JsonPrimitive(it) } ?: JsonPrimitive(trimmed)
          }
          primitive != null && primitive.isString -> if (primitive.content.isNotEmpty()) map[name] = value
          else -> map[name] = value
        }
      }
      JsonObject(map)
    } else if (body.size == 1 && body["\$afterHours"] != null) {
      // `{"$afterHours": "{form.hours}"}`: the moment that many hours from now, in epoch milliseconds; nothing when blank or not positive.
      val hours = number(resolveBody(body.getValue("\$afterHours"), context))
      if (hours == null || !hours.isFinite() || hours <= 0) JsonNull
      else JsonPrimitive(round((number(lookup("now.ms", context)) ?: nowMillis().toDouble()) + hours * 3_600_000).toLong())
    } else if (body.size == 1 && body["\$split"] != null) {
      // `{"$split": "{form.pcts}"}`: the comma- or line-separated text as a list; a part that is a number stays one.
      val parts = text(resolveBody(body.getValue("\$split"), context)).split(',', '\n').map { it.trim() }.filter { it.isNotEmpty() }
      JsonArray(parts.map { part -> part.toLongOrNull()?.let { JsonPrimitive(it) } ?: part.toDoubleOrNull()?.let { JsonPrimitive(it) } ?: JsonPrimitive(part) })
    } else if (body.size == 1 && body["\$pick"] is JsonObject) {
      // `{"$pick": {"a": "{form.x}"}}`: the keys whose values are truthy, as a list.
      val options = body["\$pick"] as JsonObject
      JsonArray(options.keys.sorted().filter { truthy(resolveBody(options.getValue(it), context)) }.map { JsonPrimitive(it) })
    } else JsonObject(
      buildMap {
        for ((key, value) in body) {
          val resolved = resolveBody(value, context)
          // A template that found nothing is left out; a literal null is sent (it clears the field), and so is "$null"
          // where a branch of $if has to say null (a comp removed).
          // A key written as a template (`{item.id}`) is the text it renders: a map keyed by the row's own id.
          val name = if ('{' in key) render(key, context) else key
          if (resolved == JsonPrimitive("\$null")) put(name, JsonNull)
          else if (resolved != JsonNull || value == JsonNull || (value is JsonObject && value.containsKey("\$orNull"))) put(name, resolved)
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
        val found = lookup(clause.substring(0, at), context)
        val left = text(found)
        var right = clause.substring(at + 2).trim()
        if (right.length >= 2 && right.startsWith("'") && right.endsWith("'")) right = right.substring(1, right.length - 1)
        // `path == @other.path`: compared with the text at another path instead of a literal.
        val options = if (right.startsWith("@")) listOf(text(lookup(right.substring(1), context))) else right.split(',').map { it.trim() }
        // A projected list (`zones.*.kind == radius`): `==` holds when any of its values does, `!=` when none does.
        if (found is JsonArray && ".*" in clause.substring(0, at)) {
          val hit = found.any { text(it) in options }
          return if (op == "==") hit else !hit
        }
        return if (op == "==") left in options else left !in options
      }
    }
    // `path < @now.ms+7d`: numbers and times compared; the right side is a number or `@path` with an optional offset.
    for (op in listOf("<=", ">=", "<", ">")) {
      val at = clause.indexOf(op)
      if (at < 0) continue
      val found = lookup(clause.substring(0, at), context)
      val right = operand(clause.substring(at + op.length).trim(), context) ?: return false
      // A projected list (`holds.*.expiresAtMs > @now.ms`) holds when any of its values does.
      val lefts = if (found is JsonArray) found.mapNotNull { comparable(it) } else listOfNotNull(comparable(found))
      return lefts.any { left ->
        when (op) {
          "<=" -> left <= right
          ">=" -> left >= right
          "<" -> left < right
          else -> left > right
        }
      }
    }
    if (clause.startsWith("!")) return !truthy(lookup(clause.substring(1), context))
    return truthy(lookup(clause, context))
  }

  /** A number as it is, or a time (epoch milliseconds, a Firestore timestamp, an ISO date) as milliseconds. */
  private fun comparable(value: JsonElement?): Double? = when {
    value is JsonPrimitive && !value.isString -> value.doubleOrNull
    else -> epochMillis(value)?.toDouble()
  }

  private val offset = Regex("""^@(.+?)\s*([+-])\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$""")

  /** The right side of `<`: a number, `@path`, or `@path+7d` / `@path-30m` (units ms, s, m, h, d; none is ms). */
  internal fun operand(text: String, context: JsonElement): Double? {
    text.toDoubleOrNull()?.let { return it }
    if (!text.startsWith("@")) return null
    val match = offset.matchEntire(text)
    val base = comparable(lookup(match?.groupValues?.get(1) ?: text.substring(1), context)) ?: return null
    if (match == null) return base
    val amount = match.groupValues[3].toDouble() * when (match.groupValues[4]) {
      "s" -> 1_000.0
      "m" -> 60_000.0
      "h" -> 3_600_000.0
      "d" -> 86_400_000.0
      else -> 1.0
    }
    return if (match.groupValues[2] == "+") base + amount else base - amount
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

  /** Two answers added: numbers sum, objects merge key by key, anything else takes the newer value. */
  fun sum(total: JsonElement, page: JsonElement): JsonElement {
    if (total is JsonPrimitive && page is JsonPrimitive && !total.isString && !page.isString) {
      val left = total.content.toDoubleOrNull()
      val right = page.content.toDoubleOrNull()
      if (left != null && right != null) {
        val added = left + right
        return if (added == floor(added) && abs(added) < 9.0e15) JsonPrimitive(added.toLong()) else JsonPrimitive(added)
      }
    }
    if (total is JsonObject && page is JsonObject) {
      val merged = total.toMutableMap()
      for ((key, value) in page) merged[key] = merged[key]?.let { sum(it, value) } ?: value
      return JsonObject(merged)
    }
    return page
  }

  /**
   * An object's plain values as `words: value`, joined by " · ": the readings of a check that
   * have no screen of their own. Keys are sorted and split from camelCase; `ok`, `ms` and `code`
   * are shown elsewhere, and nested values are left out.
   */
  /** An object's entries as `key: value`, the keys as they are (ids, which `facts` would split into words). */
  internal fun pairs(value: JsonElement?): String {
    val record = value as? JsonObject ?: return text(value)
    return record.keys.sorted().mapNotNull { key ->
      val shown = text(record[key])
      if (shown.isEmpty()) null else "$key: $shown"
    }.joinToString(", ")
  }

  /** A random value of [length] characters from [alphabet], from the platform's secure generator. */
  fun generated(length: Int, alphabet: String): String {
    if (alphabet.isEmpty() || length <= 0) return ""
    val bytes = com.aglyn.core.secureRandomBytes(length)
    return String(CharArray(length) { alphabet[(bytes[it].toInt() and 0xff) % alphabet.length] })
  }

  internal fun facts(value: JsonElement?): String {
    val record = value as? JsonObject ?: return text(value)
    return record.keys.sorted().mapNotNull { key ->
      if (key in setOf("ok", "ms", "code")) return@mapNotNull null
      val entry = record.getValue(key) as? JsonPrimitive ?: return@mapNotNull null
      val shown = when {
        entry.isString -> entry.content.ifEmpty { return@mapNotNull null }
        entry.content == "true" -> "yes"
        entry.content == "false" -> "no"
        entry.content.toDoubleOrNull() != null -> formatted(entry, "number", JsonNull)
        else -> return@mapNotNull null
      }
      val words = buildString { for (character in key) if (character.isUpperCase()) append(' ').append(character.lowercaseChar()) else append(character) }
      "$words: $shown"
    }.joinToString(" · ")
  }

  fun formatted(value: JsonElement?, format: String, context: JsonElement): String {
    val parts = format.split('/', limit = 2)
    return when (parts[0]) {
      "date" -> epochMillis(value)?.let { dateText(it, false) } ?: text(value)
      "datetime" -> epochMillis(value)?.let { dateText(it, true) } ?: text(value)
      // A time of day alone: `3:05 PM`.
      "clock" -> epochMillis(value)?.let { at ->
        val (_, _, _, hour, minuteOfHour) = localParts(at, timeZone)
        "${if (hour % 12 == 0) 12 else hour % 12}:${minuteOfHour.toString().padStart(2, '0')} ${if (hour < 12) "AM" else "PM"}"
      } ?: text(value)
      "cents" -> number(value)?.let { amount ->
        val currency = if (parts.size > 1) text(lookup(parts[1], context)) else "USD"
        formatOrderMoney(round(amount), currency.ifEmpty { "USD" })
      } ?: text(value)
      "dollars" -> number(value)?.let { formatOrderMoney(round(it * 100), "USD") } ?: text(value)
      // Whole cents as a plain amount a money field starts with: 1250 -> 12.50 (nothing for no amount).
      // A code the way coupons store it: trimmed, upper case, only letters, digits, hyphens and underscores.
      // `code/40` keeps at most that many characters.
      "code" -> text(value).trim().uppercase().replace(Regex("[^A-Z0-9_-]"), "").let { code -> parts.getOrNull(1)?.toIntOrNull()?.let { code.take(it) } ?: code }
      // The search token of typed words: lower case, the first word, at most twelve characters.
      "token" -> text(value).trim().lowercase().split(Regex("\\s+")).firstOrNull().orEmpty().take(12)
      // A list of numbers added up (cents are cents), and the same as money.
      "sum" -> (value as? JsonArray)?.sumOf { number(it) ?: 0.0 }?.let { numberText(it) } ?: "0"
      "sumcents" -> (value as? JsonArray)?.sumOf { number(it) ?: 0.0 }?.let { formatOrderMoney(round(it), "USD") } ?: formatOrderMoney(0.0, "USD")
      "amount" -> number(value)?.let { cents -> val whole = round(cents).toLong(); "${whole / 100}.${(abs(whole) % 100).toString().padStart(2, '0')}" } ?: ""
      "bytes" -> number(value)?.let { bytesText(it) } ?: text(value)
      "number" -> number(value)?.let { grouped(it, 2) } ?: text(value)
      "percent" -> number(value)?.let { "${grouped(it * 100, 1)}%" } ?: text(value)
      "count" -> when (value) {
        is JsonArray -> value.size.toString()
        is JsonObject -> value.size.toString()
        else -> number(value)?.let { grouped(it) } ?: "0"
      }
      // A time as how long ago it was: `5m ago`, `3h ago`, `2d ago`; a dash for none.
      "ago" -> epochMillis(value)?.let { at ->
        val minutes = max(0.0, round((nowMillis() - at) / 60_000.0)).toLong()
        if (minutes < 60) "${minutes}m ago" else round(minutes / 60.0).toLong().let { hours -> if (hours < 48) "${hours}h ago" else "${round(hours / 24.0).toLong()}d ago" }
      } ?: "\u2014"
      // `minus/other.path`: this number less the one at the path, never below zero (text that is no number stays as it is).
      "minus" -> number(value)?.let { numberText(max(0.0, it - (parts.getOrNull(1)?.let { path -> number(lookup(path, context)) } ?: 0.0))) } ?: text(value)
      // `lesscents/other.path`: this amount less the one at the path, never below zero, as money.
      "lesscents" -> formatOrderMoney(round(max(0.0, (number(value) ?: 0.0) - (parts.getOrNull(1)?.let { number(lookup(it, context)) } ?: 0.0))), "USD")
      // A site path with its leading slash: `about` is `/about`, the home page `/`.
      "slashed" -> text(value).let { if (it == "/") "/" else "/" + it.removePrefix("/") }
      // `take/120`: at most that many characters.
      "take" -> text(value).take(parts.getOrNull(1)?.toIntOrNull() ?: Int.MAX_VALUE)
      // `plural/item`: the count (a list of numbers is their total, any other list its length) with its noun, `1 item` or `3 items`.
      "plural" -> if (value == null || value == JsonNull) "" else (if (value is JsonArray) (if (value.isNotEmpty() && value.all { number(it) != null }) value.sumOf { number(it) ?: 0.0 } else value.size.toDouble()) else number(value) ?: 0.0).let { count -> "${numberText(count)} ${parts.getOrElse(1) { "" }}${if (count == 1.0) "" else "s"}" }
      // `ordernumber/item.$id`: an order's number as `#1042`, else the last six characters of its id (`#A1B2C3`).
      "ordernumber" -> if (truthy(value)) "#${text(value)}" else parts.getOrNull(1)?.let { text(lookup(it, context)) }?.takeIf { it.isNotEmpty() }?.let { "#${it.takeLast(6).uppercase()}" } ?: "#\u2014"
      // A UTC day as `2026-10-09`: the day a stay starts on, which a device's zone must not move.
      "isodate" -> epochMillis(value)?.let { at ->
        val (y, m, d) = localParts(at, "UTC")
        "${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}"
      } ?: "\u2014"
      // How many of a list of times are still ahead (the holds on a promotion that have not lapsed).
      "ahead" -> ((value as? JsonArray)?.count { (epochMillis(it) ?: 0L) > nowMillis() } ?: 0).toString()
      "yesno" -> if (truthy(value)) "Yes" else "No"
      "title" -> text(value).replace('_', ' ').replace('-', ' ').replaceFirstChar { it.uppercase() }
      // `upper/2` also keeps at most that many characters (a country or state code).
      "upper" -> text(value).uppercase().let { upper -> parts.getOrNull(1)?.toIntOrNull()?.let { upper.take(it) } ?: upper }
      "facts" -> facts(value)
      "pairs" -> pairs(value)
      // `before/-` and `after/-`: the text either side of the first separator (a jurisdiction key `US-TX`); no separator, no tail.
      // `shareOf/<path>`: the value as a whole percent of the number at <path> ("40%"; "0%" when there is nothing to share).
      "shareOf" -> {
        val total = parts.getOrNull(1)?.let { number(lookup(it, context)) } ?: 0.0
        val part = number(value)
        if (total > 0 && part != null) "${floor(part / total * 100 + 0.5).toLong()}%" else "0%"
      }
      "before", "after" -> {
        val whole = text(value)
        val separator = parts.getOrNull(1) ?: "-"
        val at = whole.indexOf(separator)
        if (at < 0) (if (parts[0] == "before") whole else "") else if (parts[0] == "before") whole.substring(0, at) else whole.substring(at + separator.length)
      }
      // `labeled/<path>`: each id (or the one) through the map at <path>; an id the map lacks stays as it is.
      "labeled" -> {
        val map = parts.getOrNull(1)?.let { lookup(it, context) } as? JsonObject
        val ids = (value as? JsonArray)?.toList() ?: listOfNotNull(value)
        ids.map { id -> text(id).let { key -> map?.get(key)?.let { text(it) } ?: key } }.filter { it.isNotEmpty() }.joinToString(", ")
      }
      // The console's `formatAge`: "under a minute", "12 min", "3h 5m", "4 days".
      "duration" -> number(value)?.takeIf { it.isFinite() }?.let { millis ->
        val minutes = (millis / 60_000).toLong()
        val hours = minutes / 60
        when {
          minutes < 1 -> "under a minute"
          minutes < 60 -> "$minutes min"
          hours < 48 -> "${hours}h ${minutes % 60}m"
          else -> "${hours / 24} days"
        }
      } ?: "unknown"
      "phone" -> normalizedPhone(text(value)) ?: text(value)
      "json" -> value?.toString() ?: ""
      else -> text(value)
    }
  }
}

/**
 * Best-effort E.164, as the console stores a phone number: `+` and 8 to 15
 * digits, or a US/CA number with or without the leading 1. Anything else is not guessed at.
 */
fun normalizedPhone(input: String): String? {
  val raw = input.trim()
  if (raw.isEmpty()) return null
  val digits = raw.filter { it in '0'..'9' }
  if (raw.startsWith("+")) return if (digits.length in 8..15) "+$digits" else null
  if (digits.length == 10) return "+1$digits"
  if (digits.length == 11 && digits.startsWith("1")) return "+$digits"
  return null
}

/** An ISO-8601 instant or date as epoch milliseconds; null when it is not one. */
internal expect fun parseIsoMillis(text: String): Long?

/**
 * A wall-clock time read as UTC (`wallAsUtc`) re-read as the device's own wall-clock time: the instant the device's clock
 * shows that time at. The offset is looked up at the guess and again at the corrected instant, so a daylight-saving
 * change near the time still lands on the right side of it.
 */
internal fun deviceWallClockToMillis(wallAsUtc: Long): Long {
  fun offsetAt(instant: Long): Long {
    val minute = instant.floorDiv(60_000L) * 60_000L
    val (y, mo, d, h, mi) = localParts(instant, null)
    fun two(n: Int) = n.toString().padStart(2, '0')
    val shown = parseIsoMillis("${y.toString().padStart(4, '0')}-${two(mo)}-${two(d)}T${two(h)}:${two(mi)}:00Z") ?: minute
    return shown - minute
  }
  val first = wallAsUtc - offsetAt(wallAsUtc)
  return wallAsUtc - offsetAt(first)
}

/** Year, month (1–12), day, hour and minute of an instant in a zone (the device's when null). */
internal expect fun localParts(millis: Long, zone: String?): List<Int>

/** Today's year and month (1–12) in UTC. */
internal expect fun nowParts(): List<Int>

internal expect fun nowMillis(): Long
