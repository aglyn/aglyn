package com.aglyn.core

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The import's Upload step apart from its drawing: how a chosen or pasted file reads, what changing a setting does, and what
 * stops it being uploaded.
 */
class TransferUploadDraftTest {
  private val limits = TransferUploadLimits(maxBytes = 200, maxRows = 3, formats = listOf(TransferFormat.CSV, TransferFormat.JSON))

  @Test
  fun aFileIsReadUnderTheEncodingItsBytesSuggestAndItsLayoutIsGuessed() {
    val draft = TransferUploadDraft.file("people.csv", "name;city\nAna;Köln\nBo;Wien\n".encodeToByteArray(), 200)
    assertEquals(TransferFileSettings(TransferFormat.CSV, TransferEncoding.UTF8, ";", true), draft.settings)
    assertEquals(listOf("name", "city"), draft.parsed?.headers)
    assertEquals(listOf(listOf("Ana", "Köln"), listOf("Bo", "Wien")), draft.parsed?.shown)
    assertEquals("people.csv · 28 B · 2 rows, 2 columns", draft.summary)
    assertEquals(emptyList(), draft.blockers(limits))
    assertEquals(
      Json.parseToJsonElement("""{"fileName":"people.csv","text":"name;city\nAna;Köln\nBo;Wien\n","bytes":28,"format":"csv","delimiter":";","headerRow":true}"""),
      draft.value(limits),
    )
  }

  @Test
  fun anotherEncodingReadsTheSameBytesAnotherWayAndTheOtherSettingsStay() {
    val latin = "name,city\nAna,Cologne".encodeToByteArray() + byteArrayOf(0xE9.toByte(), '\n'.code.toByte()) // 0xE9 alone is not UTF-8
    var draft = TransferUploadDraft.file("latin.csv", latin, 200)
    assertEquals(TransferEncoding.WINDOWS1252, draft.settings.encoding)
    assertEquals(listOf(listOf("Ana", "Cologneé")), draft.parsed?.shown)
    draft = draft.changing(";")
    assertEquals(listOf("name,city"), draft.parsed?.headers) // the separator the person chose, not the guess
    draft = draft.changing(TransferEncoding.UTF8)
    assertEquals(";", draft.settings.delimiter)
    assertEquals(TransferEncoding.UTF8, draft.settings.encoding)
    assertTrue(draft.text.contains("�"))
    draft = draft.changing(",").changingHeaderRow(false)
    assertEquals(listOf("Column 1", "Column 2"), draft.parsed?.headers)
    assertEquals(2, draft.parsed?.rows?.size) // the first row is data now
  }

  @Test
  fun pastedRowsAreReadLikeAFileWithoutAnEncodingToChoose() {
    val draft = TransferUploadDraft.pasted("email\tname\nana@x.co\tAna\n")
    assertEquals("Pasted rows", draft.fileName)
    assertNull(draft.raw)
    assertEquals("\t", draft.settings.delimiter)
    assertEquals(draft, draft.changing(TransferEncoding.WINDOWS1252)) // nothing to decode again
    assertEquals(listOf("email", "name"), draft.parsed?.headers)
  }

  @Test
  fun aFileTheImportCannotTakeIsRefusedInTheConsolesWords() {
    val big = TransferUploadDraft.file("huge.csv", ByteArray(2_048) { 97 }, 200)
    assertTrue(big.unread)
    assertNull(big.parsed)
    assertEquals(listOf("This file is 2.0 KB; this import takes at most 200 B."), big.blockers(limits))
    assertNull(big.value(limits))
    assertEquals(big, big.changing(TransferFormat.JSON))
    val long = TransferUploadDraft.pasted("a,b\n1,2\n3,4\n5,6\n7,8\n")
    assertEquals(listOf("This file has 4 rows; this import takes at most 3. Split it and import the rest separately."), long.blockers(limits))
    assertEquals(listOf("This file has no rows to import."), TransferUploadDraft.pasted("a,b\n").blockers(limits))
    assertEquals(listOf("This is not valid JSON."), TransferUploadDraft.pasted("[1,").blockers(limits))
    val rows = "{\"a\":1}\n{\"a\":2}\n"
    assertEquals(listOf("This import does not take NDJSON."), TransferUploadDraft.pasted(rows).blockers(limits))
    assertEquals(emptyList(), TransferUploadDraft.pasted(rows).changing(TransferFormat.CSV).blockers(limits))
    assertEquals(
      Json.parseToJsonElement("""{"fileName":"Pasted rows","text":"[{\"a\":1}]","bytes":9,"format":"json"}"""),
      TransferUploadDraft.pasted("[{\"a\":1}]").value(limits),
    )
  }
}
