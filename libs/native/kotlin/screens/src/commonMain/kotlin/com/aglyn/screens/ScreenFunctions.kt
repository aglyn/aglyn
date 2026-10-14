package com.aglyn.screens

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * The pure functions a screen's `compute` load may call, ports of the console's, each replayed from the cases
 * `function-cases.generated.json` records (the Apple kit holds the same ports).
 */
object ScreenFunctions {
  /** The function named, over its arguments (a missing one is null); null for a name this build does not know. */
  fun call(name: String, args: List<JsonElement?>): JsonElement? = when (name) {
    "packageJsonDiff" -> jsonDiff(args.getOrNull(0), args.getOrNull(1), (args.getOrNull(2) as? JsonPrimitive)?.doubleOrNull?.toInt() ?: 200)
    "packageMergeKeys" -> mergeKeys(args.getOrNull(0), args.getOrNull(1))
    // A fourth argument lets the records run past the values' limit (the screen pages through them).
    "packageItemChanges" -> itemChanges(
      args.getOrNull(0), args.getOrNull(1), (args.getOrNull(2) as? JsonPrimitive)?.doubleOrNull?.toInt() ?: 200,
      (args.getOrNull(3) as? JsonPrimitive)?.doubleOrNull?.toInt(),
    )
    "aiProductsImportJob" -> aiProductsImportJob(args.getOrNull(0))
    else -> null
  }

  /**
   * Every leaf that differs between the site's item and the file's, as before → after rows (the console's
   * `packageJsonDiff`): objects are walked key by key, a list or a value is compared whole, at most [limit] rows.
   */
  internal fun jsonDiff(before: JsonElement?, after: JsonElement?, limit: Int): JsonElement {
    val changes = mutableListOf<JsonElement>()
    var more = 0
    fun walk(left: JsonElement?, right: JsonElement?, path: List<String>) {
      if (left == right) return
      if (left is JsonObject && right is JsonObject) {
        for (key in (left.keys + right.keys).toSortedSet()) walk(left[key], right[key], path + key)
        return
      }
      if (changes.size >= limit) {
        more += 1
        return
      }
      changes += JsonObject(
        buildMap {
          put("key", JsonPrimitive(if (path.isEmpty()) "$" else path.joinToString("/")))
          put("label", JsonPrimitive(if (path.isEmpty()) "Whole item" else path.joinToString(" › ")))
          left?.let { put("before", it) }
          right?.let { put("after", it) }
        },
      )
    }
    walk(before, after, emptyList())
    return JsonObject(mapOf("changes" to JsonArray(changes), "more" to JsonPrimitive(more)))
  }

  /**
   * The top-level keys of a merged item that differ, each with what a merge would keep (the console's
   * `packageMergeKeys`): the site's value wins when it has one.
   */
  internal fun mergeKeys(site: JsonElement?, file: JsonElement?): JsonElement {
    val left = site as? JsonObject ?: JsonObject(emptyMap())
    val right = file as? JsonObject ?: JsonObject(emptyMap())
    return JsonArray(
      right.keys.sorted().mapNotNull { key ->
        val incoming = right.getValue(key)
        if (left[key] == incoming) return@mapNotNull null
        val held = left[key]
        val blank = held == null || held is JsonNull || (held is JsonPrimitive && held.isString && held.content.isEmpty())
        JsonObject(
          buildMap {
            put("key", JsonPrimitive(key))
            put("file", incoming)
            held?.let { put("site", it) }
            put("merged", JsonPrimitive(if (blank) "package" else "site"))
          },
        )
      },
    )
  }

  /** A record of an item's list: a document with its own `$id`. */
  private fun isRecord(value: JsonElement): Boolean =
    value is JsonObject && (value["\$id"] as? JsonPrimitive)?.let { it.isString && it.content.isNotEmpty() } == true

  /**
   * The key of an item that holds its records (the console's `packageRecordField`), found by shape: the one
   * list, on either side, whose every element is a document with its own `$id`; the other side holds a list
   * there too, or nothing. Null when no key qualifies or more than one does.
   */
  internal fun recordField(contents: List<JsonElement?>): String? {
    val docs = contents.filterIsInstance<JsonObject>()
    val found = linkedSetOf<String>()
    for (doc in docs) for ((key, value) in doc) if (value is JsonArray && value.isNotEmpty() && value.all(::isRecord)) found += key
    val fields = found.filter { key ->
      docs.all { doc ->
        when (val value = doc[key]) {
          null, is JsonNull -> true
          is JsonArray -> value.all(::isRecord)
          else -> false
        }
      }
    }
    return if (fields.size == 1) fields.first() else null
  }

  private class RecordRow(val status: String, val id: String, val site: JsonElement?, val file: JsonElement?, val changed: List<String>)

  /**
   * What importing an item changes (the console's `packageItemChanges`): the leaf-by-leaf diff of everything but
   * its records and, for an item that holds records, a row per value of a record that differs (a whole record
   * for one only a side holds). At most [limit] rows of each ([recordLimit] for the records, when it differs); `more` counts the rest.
   */
  internal fun itemChanges(before: JsonElement?, incoming: JsonElement?, limit: Int, recordLimit: Int? = null): JsonElement {
    val existing: JsonElement = if (before == null || before is JsonNull) JsonObject(emptyMap()) else before
    val field = recordField(listOf(existing, incoming))
    fun without(content: JsonElement?): JsonElement? =
      if (field != null && content is JsonObject) JsonObject(content - field) else content
    val values = (jsonDiff(without(existing), without(incoming), limit) as JsonObject).toMutableMap()
    if (field == null) {
      values["recordField"] = JsonNull
      values["records"] = JsonNull
      return JsonObject(values)
    }
    fun recordsOf(content: JsonElement?): List<JsonElement> = ((content as? JsonObject)?.get(field) as? JsonArray).orEmpty().filter(::isRecord)
    fun idOf(record: JsonElement) = ((record as JsonObject)["\$id"] as JsonPrimitive).content
    // Matched by `$id`: the site's records in order (a repeated id keeps its first place and its last copy).
    val theirs = linkedMapOf<String, JsonElement>()
    for (record in recordsOf(existing)) theirs[idOf(record)] = record
    val seen = mutableSetOf<String>()
    val rows = mutableListOf<RecordRow>()
    val counts = mutableMapOf("added" to 0, "removed" to 0, "changed" to 0, "same" to 0)
    for (record in recordsOf(incoming)) {
      val id = idOf(record)
      if (!seen.add(id)) continue
      val held = theirs[id]
      if (held == null) {
        counts["added"] = counts.getValue("added") + 1
        rows += RecordRow("added", id, null, record, emptyList())
        continue
      }
      val left = held as JsonObject
      val right = record as JsonObject
      val changed = (left.keys + right.keys).filter { it != "\$id" && left[it] != right[it] }.toSortedSet().toList()
      if (changed.isEmpty()) {
        counts["same"] = counts.getValue("same") + 1
        continue
      }
      counts["changed"] = counts.getValue("changed") + 1
      rows += RecordRow("changed", id, held, record, changed)
    }
    for ((id, record) in theirs) {
      if (id in seen) continue
      counts["removed"] = counts.getValue("removed") + 1
      rows += RecordRow("removed", id, record, null, emptyList())
    }
    val changes = mutableListOf<JsonElement>()
    var more = 0
    fun add(change: Map<String, JsonElement>) {
      if (changes.size >= (recordLimit ?: limit)) more += 1 else changes += JsonObject(change)
    }
    for (row in rows) {
      if (row.status == "changed") {
        for (name in row.changed) {
          add(
            buildMap {
              put("key", JsonPrimitive("${row.id}/$name"))
              put("label", JsonPrimitive("${row.id} › $name"))
              put("status", JsonPrimitive("changed"))
              (row.site as? JsonObject)?.get(name)?.let { put("before", it) }
              (row.file as? JsonObject)?.get(name)?.let { put("after", it) }
            },
          )
        }
      } else {
        add(
          buildMap {
            put("key", JsonPrimitive(row.id))
            put("label", JsonPrimitive(row.id))
            put("status", JsonPrimitive(row.status))
            row.site?.let { put("before", it) }
            row.file?.let { put("after", it) }
          },
        )
      }
    }
    fun counted(count: Int, noun: String) = "${ScreenValues.grouped(count.toDouble())} ${if (count == 1) noun else noun + "s"}"
    val summary = listOf(
      counted(counts.getValue("added"), "new record"),
      counted(counts.getValue("changed"), "changed record"),
      "${counted(counts.getValue("removed"), "record")} not in the file",
      "${ScreenValues.grouped(counts.getValue("same").toDouble())} unchanged",
    ).joinToString(" · ")
    values["recordField"] = JsonPrimitive(field)
    values["records"] = JsonObject(mapOf("summary" to JsonPrimitive(summary), "changes" to JsonArray(changes), "more" to JsonPrimitive(more)))
    return JsonObject(values)
  }

  private val productId = Regex("^[A-Za-z0-9_-]{1,64}$")

  /**
   * The copy job a landed product import starts (the AI plugin's `aiProductsImportJob`): the brief and the `inputs` the
   * jobs route takes, for the first 50 products the import created; null when it created none.
   */
  internal fun aiProductsImportJob(rows: JsonElement?): JsonElement {
    val ids = mutableListOf<String>()
    for (row in (rows as? JsonArray).orEmpty()) {
      val id = (row.obj("recordId") as? JsonPrimitive)?.takeIf { it.isString }?.content
      if (row.str("outcome") == "created" && !id.isNullOrEmpty() && id !in ids) ids += id
    }
    val first = ids.take(50)
    if (first.isEmpty()) return JsonNull
    val readable = first.filter { productId.matches(it) }.distinct()
    return JsonObject(
      mapOf(
        "brief" to JsonPrimitive("Write storefront copy for ${first.size} ${if (first.size == 1) "product" else "products"}"),
        "inputs" to JsonObject(mapOf("target" to JsonPrimitive("bulk"), "productIds" to JsonPrimitive(readable.joinToString(",")))),
      ),
    )
  }
}
