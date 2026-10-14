package com.aglyn.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.floor

/*
 * Reading a file the way the console's Upload step does, enough of it to show the person how it reads: the port of
 * `libs/aglyn-transfer-ui/src/lib/transfer-file.ts` (`detectEncoding`, `decodeBytes`, `detectFormat`, `detectDelimiter`,
 * `parseDelimited`, `detectHeaderRow`, `parseTransferText`, `detectTransferFileSettings`, `formatBytes`), replayed from
 * `libs/native/contracts/transfer-file-cases.json` (the Apple kit holds the same port). Every guess is shown and can be
 * changed; the server reads the file again under the settings the person confirmed.
 */

enum class TransferEncoding(val wire: String, val label: String) {
  UTF8("utf-8", "UTF-8"),
  UTF16LE("utf-16le", "UTF-16 (little-endian)"),
  UTF16BE("utf-16be", "UTF-16 (big-endian)"),
  WINDOWS1252("windows-1252", "Western (Windows-1252)");

  companion object {
    fun of(wire: String?): TransferEncoding? = entries.firstOrNull { it.wire == wire }
  }
}

/** The cell separators a CSV may use, with the words the console's picker has for each. */
val transferDelimiters: List<Pair<String, String>> = listOf("," to "Comma", ";" to "Semicolon", "\t" to "Tab", "|" to "Vertical bar")

/** How a file reads: the person confirms these. */
data class TransferFileSettings(
  val format: TransferFormat,
  val encoding: TransferEncoding = TransferEncoding.UTF8,
  /** The cell separator of a CSV. */
  val delimiter: String = ",",
  /** The first row of a CSV names the columns. */
  val headerRow: Boolean = true,
)

/** A file read under settings: its column names and rows. */
data class TransferParsedFile(
  val headers: List<String> = emptyList(),
  val rows: List<List<JsonElement>> = emptyList(),
  /** The first rows as the preview shows them, a cell as one line of text. */
  val shown: List<List<String>> = emptyList(),
  /** Why the file could not be read under these settings. */
  val error: String? = null,
)

object TransferFileReader {
  /** The rows the preview shows. */
  const val PREVIEW_ROWS = 5

  // Encoding.

  private fun at(bytes: ByteArray, i: Int) = bytes.getOrNull(i)?.toInt()?.and(0xFF) ?: -1

  /** The encoding a byte-order mark names, or a strict UTF-8 read, or Windows-1252. */
  fun detectEncoding(bytes: ByteArray): TransferEncoding {
    if (at(bytes, 0) == 0xEF && at(bytes, 1) == 0xBB && at(bytes, 2) == 0xBF) return TransferEncoding.UTF8
    if (at(bytes, 0) == 0xFF && at(bytes, 1) == 0xFE) return TransferEncoding.UTF16LE
    if (at(bytes, 0) == 0xFE && at(bytes, 1) == 0xFF) return TransferEncoding.UTF16BE
    return try {
      bytes.decodeToString(throwOnInvalidSequence = true)
      TransferEncoding.UTF8
    } catch (_: CharacterCodingException) {
      TransferEncoding.WINDOWS1252
    }
  }

  private val cp1252High = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F" +
    "\u0090‘’“”•–—˜™š›œ\u009DžŸ"

  private fun utf16(bytes: ByteArray, littleEndian: Boolean): String {
    val out = StringBuilder()
    var i = 0
    while (i + 1 < bytes.size) {
      val a = bytes[i].toInt() and 0xFF
      val b = bytes[i + 1].toInt() and 0xFF
      out.append((if (littleEndian) (b shl 8) or a else (a shl 8) or b).toChar())
      i += 2
    }
    return out.toString()
  }

  /**
   * The bytes as text in [encoding], with any byte-order mark dropped. A byte that is not valid in the encoding is read as
   * the replacement character, as a browser's decoder does.
   */
  fun decode(bytes: ByteArray, encoding: TransferEncoding): String {
    val text = when (encoding) {
      TransferEncoding.UTF8 -> bytes.decodeToString()
      TransferEncoding.UTF16LE -> utf16(bytes, littleEndian = true)
      TransferEncoding.UTF16BE -> utf16(bytes, littleEndian = false)
      TransferEncoding.WINDOWS1252 -> buildString {
        for (b in bytes) {
          val code = b.toInt() and 0xFF
          append(if (code in 0x80..0x9F) cp1252High[code - 0x80] else code.toChar())
        }
      }
    }
    return if (text.startsWith('﻿')) text.substring(1) else text
  }

  // Format and layout.

  private fun isSpace(c: Char) = c.isWhitespace() || c == '﻿'

  private fun trimmed(text: String): String = text.trim { isSpace(it) }

  /** `text.split(/\r?\n/)`: a line ends at a line feed, and a carriage return just before it goes with it. */
  private fun lines(text: String): List<String> = text.split('\n').map { if (it.endsWith('\r')) it.dropLast(1) else it }

  /** The format a file name or its text says it is. */
  fun detectFormat(fileName: String, text: String): TransferFormat {
    val name = fileName.lowercase()
    if (name.endsWith(".ndjson") || name.endsWith(".jsonl")) return TransferFormat.NDJSON
    if (name.endsWith(".json")) return TransferFormat.JSON
    val start = text.trimStart { isSpace(it) }
    if (start.startsWith("[")) return TransferFormat.JSON
    if (start.startsWith("{")) {
      val filled = lines(start).filter { trimmed(it).isNotEmpty() }
      return if (filled.size > 1 && filled.all { trimmed(it).startsWith("{") }) TransferFormat.NDJSON else TransferFormat.JSON
    }
    return TransferFormat.CSV
  }

  /** Separators counted per line, outside quotes, over the first lines. */
  private fun separatorCounts(text: String, delimiter: Char, limit: Int = 10): List<Int> {
    val counts = mutableListOf<Int>()
    var count = 0
    var quoted = false
    for (char in text) {
      if (counts.size >= limit) break
      if (char == '"') quoted = !quoted
      else if (!quoted && char == delimiter) count += 1
      else if (!quoted && char == '\n') {
        counts += count
        count = 0
      }
    }
    if (counts.size < limit && count > 0) counts += count
    return counts
  }

  /**
   * The separator the lines agree on: the one found on every sampled line the same number of times, the most of them; else
   * the most frequent; else a comma.
   */
  fun detectDelimiter(text: String): String {
    var best = "," to 0
    for ((value, _) in transferDelimiters) {
      val counts = separatorCounts(text, value[0])
      val first = counts.firstOrNull() ?: continue
      if (first == 0) continue
      val score = (if (counts.all { it == first }) 1000 else 0) + first
      if (score > best.second) best = value to score
    }
    return best.first
  }

  /** Delimited text as rows of cells (quotes, doubled quotes and line breaks inside quotes). */
  fun parseDelimited(text: String, delimiter: String = ","): List<List<String>> {
    val separator = delimiter.firstOrNull() ?: ','
    val rows = mutableListOf<List<String>>()
    var row = mutableListOf<String>()
    var cell = StringBuilder()
    var quoted = false
    var at = 0
    while (at < text.length) {
      val char = text[at]
      if (quoted) {
        if (char == '"' && at + 1 < text.length && text[at + 1] == '"') {
          cell.append('"')
          at += 1
        } else if (char == '"') quoted = false
        else cell.append(char)
        at += 1
        continue
      }
      if (char == '"' && cell.isEmpty()) quoted = true
      else if (char == separator) {
        row += cell.toString()
        cell = StringBuilder()
      } else if (char == '\n' || char == '\r') {
        if (char == '\r' && at + 1 < text.length && text[at + 1] == '\n') at += 1
        row += cell.toString()
        rows += row
        row = mutableListOf()
        cell = StringBuilder()
      } else cell.append(char)
      at += 1
    }
    if (cell.isNotEmpty() || row.isNotEmpty()) {
      row += cell.toString()
      rows += row
    }
    return rows.filter { cells -> cells.any { trimmed(it).isNotEmpty() } }
  }

  private val dataLike = Regex("""^[-+]?[0-9.,\s$€£%]+$|@|^[0-9]{1,4}[/.-][0-9]{1,2}[/.-][0-9]{1,4}$|^(?:true|false)$""", RegexOption.IGNORE_CASE)

  /**
   * Whether the first line names the columns: every cell filled, no two alike, none that looks like data (a number, an
   * email, a date) while a later line has data in that column.
   */
  fun detectHeaderRow(rows: List<List<String>>): Boolean {
    val first = rows.firstOrNull()?.takeIf { it.isNotEmpty() } ?: return false
    val cells = first.map(::trimmed)
    if (cells.any { it.isEmpty() }) return false
    if (cells.map { it.lowercase() }.toSet().size != cells.size) return false
    return cells.none { dataLike.containsMatchIn(it) }
  }

  // Records.

  private fun plainNumber(element: JsonPrimitive): String {
    val value = element.doubleOrNull ?: return element.content
    return if (value == floor(value) && kotlin.math.abs(value) < 1e15) value.toLong().toString() else element.content
  }

  /** A cell as one line of text (the console's `displayTransferValue`). */
  private fun display(value: JsonElement?): String = when (value) {
    null, JsonNull -> "—"
    is JsonArray -> if (value.isEmpty()) "—" else value.joinToString(", ") { display(it) }
    is JsonObject -> value.toString()
    is JsonPrimitive -> when {
      value.isString -> value.content.ifEmpty { "—" }
      value.content == "true" -> "Yes"
      value.content == "false" -> "No"
      else -> plainNumber(value)
    }
  }

  private fun records(text: String, format: TransferFormat): Pair<List<String>, List<JsonObject>> {
    val all: List<JsonElement> = if (format == TransferFormat.NDJSON) {
      lines(text).filter { trimmed(it).isNotEmpty() }.map { Json.parseToJsonElement(it) }
    } else {
      val parsed = Json.parseToJsonElement(text)
      if (parsed is JsonArray) parsed.toList() else listOf(parsed)
    }
    val headers = mutableListOf<String>()
    val objects = all.filterIsInstance<JsonObject>()
    for (record in objects) for (key in record.keys) if (key !in headers) headers += key
    return headers to objects
  }

  /** The text under the settings, as headers and rows. */
  fun parse(text: String, settings: TransferFileSettings): TransferParsedFile {
    if (settings.format == TransferFormat.JSON || settings.format == TransferFormat.NDJSON) {
      val (headers, objects) = try {
        records(text, settings.format)
      } catch (_: Exception) {
        return TransferParsedFile(error = "This is not valid ${if (settings.format == TransferFormat.JSON) "JSON" else "NDJSON"}.")
      }
      val cells = objects.map { record -> headers.map { header -> record[header] ?: JsonPrimitive("") } }
      return TransferParsedFile(
        headers, cells.map { row -> row.map { if (it is JsonNull) JsonPrimitive("") else it } }, cells.take(PREVIEW_ROWS).map { row -> row.map(::display) },
      )
    }
    val parsed = parseDelimited(text, settings.delimiter)
    val width = parsed.maxOfOrNull { it.size } ?: 0
    val headers = (0 until width).map { column ->
      if (!settings.headerRow) "Column ${column + 1}"
      else (parsed.firstOrNull()?.getOrNull(column)?.let(::trimmed) ?: "").ifEmpty { "Column ${column + 1}" }
    }
    val body = if (settings.headerRow) parsed.drop(1) else parsed
    return TransferParsedFile(
      headers, body.map { row -> row.map { JsonPrimitive(it) } },
      body.take(PREVIEW_ROWS).map { row -> (0 until width).map { column -> row.getOrNull(column)?.takeIf { it.isNotEmpty() } ?: "—" } },
    )
  }

  /** Every guess at once, for a file just chosen or pasted. */
  fun detectSettings(fileName: String, text: String, encoding: TransferEncoding = TransferEncoding.UTF8): TransferFileSettings {
    val format = detectFormat(fileName, text)
    if (format != TransferFormat.CSV) return TransferFileSettings(format, encoding)
    val delimiter = detectDelimiter(text)
    return TransferFileSettings(format, encoding, delimiter, detectHeaderRow(parseDelimited(text.take(20_000), delimiter)))
  }

  /** A byte count as a person reads it. */
  fun formatBytes(bytes: Int): String {
    fun oneDecimal(value: Double): String {
      val tenths = floor(value * 10 + 0.5).toLong()
      return "${tenths / 10}.${tenths % 10}"
    }
    return when {
      bytes < 1024 -> "$bytes B"
      bytes < 1024 * 1024 -> "${oneDecimal(bytes / 1024.0)} KB"
      else -> "${oneDecimal(bytes / (1024.0 * 1024.0))} MB"
    }
  }
}
