package com.aglyn.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * The import's Upload step apart from its drawing (the Apple kit's `TransferUploadDraft` holds the same): a file or pasted
 * rows, read here to show how they read (format, encoding, separator and header row guessed, shown and changeable), and
 * refused before anything is sent when the file is larger, or longer, than the import takes.
 */

/** What an import takes: the console's `resource.limits` and `resource.formats`. */
data class TransferUploadLimits(
  /** The most bytes a file may carry: the resource's `limits.maxBytes`, else the console's CSV upload ceiling. */
  val maxBytes: Int = DEFAULT_MAX_BYTES,
  val maxRows: Int? = null,
  val formats: List<TransferFormat> = listOf(TransferFormat.CSV),
) {
  companion object {
    /** The ceiling a resource without its own `limits.maxBytes` gets in the console (`CSV_UPLOAD_MAX_CHARACTERS`). */
    const val DEFAULT_MAX_BYTES = 8_000_000
  }
}

class TransferUploadDraft private constructor(
  val fileName: String,
  /** The size of the file as chosen, in bytes (the pasted text's, for rows pasted). */
  val bytes: Int,
  /** The file's bytes, kept so a different encoding can be tried; null for pasted rows. */
  val raw: ByteArray?,
  val text: String,
  val settings: TransferFileSettings,
  /** The file was larger than the import takes, so it was not read. */
  val unread: Boolean,
) {
  val parsed: TransferParsedFile? = if (unread) null else TransferFileReader.parse(text, settings)

  override fun equals(other: Any?): Boolean =
    other is TransferUploadDraft && fileName == other.fileName && bytes == other.bytes && text == other.text && settings == other.settings &&
      unread == other.unread && (raw == null) == (other.raw == null)

  override fun hashCode(): Int = listOf(fileName, bytes, text, settings, unread).hashCode()

  private fun with(change: (TransferFileSettings) -> TransferFileSettings): TransferUploadDraft =
    if (unread) this else TransferUploadDraft(fileName, bytes, raw, text, change(settings), false)

  /** The same file read in another format. */
  fun changing(format: TransferFormat): TransferUploadDraft = with { it.copy(format = format) }

  /** The same file read under another separator. */
  fun changing(delimiter: String): TransferUploadDraft = with { it.copy(delimiter = delimiter) }

  /** The same file with its first row naming the columns, or not. */
  fun changingHeaderRow(headerRow: Boolean): TransferUploadDraft = with { it.copy(headerRow = headerRow) }

  /** The same bytes decoded under another encoding (a file's bytes only). */
  fun changing(encoding: TransferEncoding): TransferUploadDraft {
    val bytesHeld = raw ?: return this
    return TransferUploadDraft(fileName, bytes, bytesHeld, TransferFileReader.decode(bytesHeld, encoding), settings.copy(encoding = encoding), false)
  }

  private fun count(n: Int, noun: String) = "$n ${if (n == 1) noun else noun + "s"}"

  /** `name · size`, and how many rows and columns it reads as. */
  val summary: String
    get() {
      var line = "$fileName · ${TransferFileReader.formatBytes(bytes)}"
      val read = parsed
      if (read != null && read.error == null) line += " · ${count(read.rows.size, "row")}, ${count(read.headers.size, "column")}"
      return line
    }

  /** What stops this file being uploaded, in the console's words (empty when nothing does). */
  fun blockers(limits: TransferUploadLimits): List<String> = buildList {
    val read = parsed
    if (bytes > limits.maxBytes) {
      add("This file is ${TransferFileReader.formatBytes(bytes)}; this import takes at most ${TransferFileReader.formatBytes(limits.maxBytes)}.")
    }
    val maxRows = limits.maxRows
    if (read != null && maxRows != null && read.rows.size > maxRows) {
      add("This file has ${count(read.rows.size, "row")}; this import takes at most $maxRows. Split it and import the rest separately.")
    }
    read?.error?.let { add(it) }
    if (read != null && read.error == null && bytes <= limits.maxBytes && read.rows.isEmpty()) add("This file has no rows to import.")
    if (!unread && settings.format !in limits.formats) add("This import does not take ${formatName(settings.format)}.")
  }

  /**
   * What the upload sends once nothing blocks it; null until then. A CSV also says its separator and whether the first row
   * names the columns.
   */
  fun value(limits: TransferUploadLimits): JsonElement? {
    if (unread || parsed == null || blockers(limits).isNotEmpty()) return null
    val value = linkedMapOf<String, JsonElement>(
      "fileName" to JsonPrimitive(fileName), "text" to JsonPrimitive(text), "bytes" to JsonPrimitive(bytes), "format" to JsonPrimitive(settings.format.wire),
    )
    if (settings.format == TransferFormat.CSV) {
      value["delimiter"] = JsonPrimitive(settings.delimiter)
      value["headerRow"] = JsonPrimitive(settings.headerRow)
    }
    return JsonObject(value)
  }

  companion object {
    /** The name rows pasted are given. */
    const val PASTED_NAME = "Pasted rows"

    /** The words the console uses for a format in its refusals and picker. */
    fun formatName(format: TransferFormat): String = when (format) {
      TransferFormat.CSV -> "CSV"
      TransferFormat.JSON -> "JSON"
      TransferFormat.NDJSON -> "NDJSON"
    }

    /**
     * A chosen file: refused unread when it is larger than [maxBytes], else decoded under the encoding its bytes suggest, with
     * the format, separator and header row guessed.
     */
    fun file(name: String, data: ByteArray, maxBytes: Int): TransferUploadDraft {
      if (data.size > maxBytes) return TransferUploadDraft(name, data.size, null, "", TransferFileSettings(TransferFormat.CSV), true)
      val encoding = TransferFileReader.detectEncoding(data)
      val text = TransferFileReader.decode(data, encoding)
      return TransferUploadDraft(name, data.size, data, text, TransferFileReader.detectSettings(name, text, encoding), false)
    }

    /** Rows pasted in. */
    fun pasted(text: String): TransferUploadDraft =
      TransferUploadDraft(PASTED_NAME, text.encodeToByteArray().size, null, text, TransferFileReader.detectSettings("", text), false)
  }
}
