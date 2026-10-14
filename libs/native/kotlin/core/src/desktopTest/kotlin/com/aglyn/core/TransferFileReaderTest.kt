package com.aglyn.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Reading a chosen or pasted file as the console's Upload step reads it, replayed from the cases the console's own
 * `transfer-file.ts` answers (`libs/native/contracts/transfer-file-cases.json`; the Apple kit replays the same file).
 */
class TransferFileReaderTest {
  private val file: JsonObject =
    Json.parseToJsonElement(File(System.getProperty("aglyn.contractsDir"), "transfer-file-cases.json").readText()) as JsonObject

  private fun list(value: JsonElement?): List<JsonElement> = (value as? JsonArray).orEmpty()
  private fun str(value: JsonElement?): String? = (value as? JsonPrimitive)?.contentOrNull
  private val texts: Map<String, String> = (file["texts"] as JsonObject).mapValues { str(it.value).orEmpty() }

  private fun settings(value: JsonElement?): TransferFileSettings {
    val record = value as JsonObject
    return TransferFileSettings(
      TransferFormat.entries.first { it.wire == str(record["format"]) },
      TransferEncoding.of(str(record["encoding"])) ?: TransferEncoding.UTF8,
      str(record["delimiter"]) ?: ",",
      (record["headerRow"] as? JsonPrimitive)?.booleanOrNull ?: true,
    )
  }

  /** Numbers compare by value (3 and 3.0 are the same JSON number). */
  private fun same(a: JsonElement, b: JsonElement): Boolean = when {
    a is JsonPrimitive && b is JsonPrimitive && !a.isString && !b.isString && a.doubleOrNull != null && b.doubleOrNull != null -> a.doubleOrNull == b.doubleOrNull
    else -> a == b
  }

  @Test
  fun theFormatTheSeparatorAndTheHeaderRowAreGuessedAsTheConsoleGuessesThem() {
    for (one in list(file["detectFormat"]).map { it as JsonObject }) {
      val name = str(one["fileName"]).orEmpty()
      val key = str(one["text"])!!
      assertEquals(str(one["result"]), TransferFileReader.detectFormat(name, texts.getValue(key)).wire, "$name $key")
    }
    for (one in list(file["detectDelimiter"]).map { it as JsonObject }) {
      assertEquals(str(one["result"]), TransferFileReader.detectDelimiter(texts.getValue(str(one["text"])!!)), str(one["text"]))
    }
    for (one in list(file["detectHeaderRow"]).map { it as JsonObject }) {
      val rows = TransferFileReader.parseDelimited(texts.getValue(str(one["text"])!!), str(one["delimiter"])!!)
      assertEquals((one["result"] as JsonPrimitive).booleanOrNull, TransferFileReader.detectHeaderRow(rows), str(one["text"]))
    }
    for (one in list(file["detectSettings"]).map { it as JsonObject }) {
      val got = TransferFileReader.detectSettings(str(one["fileName"]).orEmpty(), texts.getValue(str(one["text"])!!), TransferEncoding.of(str(one["encoding"])) ?: TransferEncoding.UTF8)
      assertEquals(settings(one["result"]), got, "${one["fileName"]} ${one["text"]}")
    }
  }

  @Test
  fun cellsRecordsAndSizesReadAsTheConsoleReadsThem() {
    for (one in list(file["parseDelimited"]).map { it as JsonObject }) {
      val want = list(one["result"]).map { row -> list(row).map { str(it).orEmpty() } }
      assertEquals(want, TransferFileReader.parseDelimited(texts.getValue(str(one["text"])!!), str(one["delimiter"])!!), "${one["text"]} ${one["delimiter"]}")
    }
    assertTrue(list(file["parse"]).size > 30)
    for (one in list(file["parse"]).map { it as JsonObject }) {
      val got = TransferFileReader.parse(texts.getValue(str(one["text"])!!), settings(one["settings"]))
      val want = one["result"] as JsonObject
      val label = "${one["text"]} ${one["settings"]}"
      assertEquals(list(want["headers"]).map { str(it) }, got.headers, label)
      val wantRows = list(want["rows"]).map { list(it) }
      assertEquals(wantRows.size, got.rows.size, label)
      wantRows.forEachIndexed { r, row ->
        assertEquals(row.size, got.rows[r].size, label)
        row.forEachIndexed { c, cell -> assertTrue(same(cell, got.rows[r][c]), "$label row $r col $c: $cell vs ${got.rows[r][c]}") }
      }
      assertEquals(str(want["error"]), got.error, label)
    }
    for (one in list(file["formatBytes"]).map { it as JsonObject }) {
      assertEquals(str(one["result"]), TransferFileReader.formatBytes((one["bytes"] as JsonPrimitive).doubleOrNull!!.toInt()))
    }
  }

  @Test
  fun thePreviewShowsFiveRowsAsTheConsoleShowsACell() {
    val csv = "name,note\n" + (1..8).joinToString("\n") { "r$it,${if (it % 2 == 0) "" else "x"}" }
    val parsed = TransferFileReader.parse(csv, TransferFileSettings(TransferFormat.CSV))
    assertEquals(8, parsed.rows.size)
    assertEquals(5, parsed.shown.size)
    assertEquals(listOf("r2", "—"), parsed.shown[1])
    val json = TransferFileReader.parse("""[{"b":true,"a":["x","y"],"n":null,"o":{"z":1,"y":[2]}}]""", TransferFileSettings(TransferFormat.JSON))
    assertEquals(listOf("b", "a", "n", "o"), json.headers) // keys in the order the file gives them
    assertEquals(listOf(listOf("Yes", "x, y", "—", """{"z":1,"y":[2]}""")), json.shown)
  }

  @Test
  fun theEncodingIsGuessedFromTheBytesAndChosenBytesReadUnderAnother() {
    fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }
    assertEquals(TransferEncoding.UTF8, TransferFileReader.detectEncoding(bytes(0xEF, 0xBB, 0xBF, 0x61)))
    assertEquals(TransferEncoding.UTF16LE, TransferFileReader.detectEncoding(bytes(0xFF, 0xFE, 0x61, 0x00)))
    assertEquals(TransferEncoding.UTF16BE, TransferFileReader.detectEncoding(bytes(0xFE, 0xFF, 0x00, 0x61)))
    assertEquals(TransferEncoding.UTF8, TransferFileReader.detectEncoding("café".encodeToByteArray()))
    val latin = bytes(0x63, 0x61, 0x66, 0xE9) // "café" as Windows-1252
    assertEquals(TransferEncoding.WINDOWS1252, TransferFileReader.detectEncoding(latin))
    assertEquals("café", TransferFileReader.decode(latin, TransferEncoding.WINDOWS1252))
    assertEquals("ab", TransferFileReader.decode(bytes(0xEF, 0xBB, 0xBF, 0x61, 0x62), TransferEncoding.UTF8)) // the mark is dropped
    assertEquals("ab", TransferFileReader.decode(bytes(0xFF, 0xFE, 0x61, 0x00, 0x62, 0x00), TransferEncoding.UTF16LE))
    assertEquals("ab", TransferFileReader.decode(bytes(0xFE, 0xFF, 0x00, 0x61, 0x00, 0x62), TransferEncoding.UTF16BE))
    // The same bytes under the wrong encoding read as something else, which is why the person can change it.
    assertEquals("caf�", TransferFileReader.decode(latin, TransferEncoding.UTF8))
    assertEquals("â‚¬", TransferFileReader.decode("€".encodeToByteArray(), TransferEncoding.WINDOWS1252))
  }
}
