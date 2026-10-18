package com.aglyn.plugins.commerce.pos

import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import com.aglyn.ui.StatusTone
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun printerDoc(id: String, data: Map<String, Any?>) = FirestoreDoc(id, "hosts/h1/printers/$id", data)

/** The register's printers as the reader holds them: live through [observe], and read again through [page]. */
private class PrinterReader : FirestoreReader {
  val live = MutableStateFlow<Live<List<FirestoreDoc>>>(Live.Loading)
  var stored = emptyList<FirestoreDoc>()
  val queries = mutableListOf<FirestoreQuery>()

  override suspend fun get(path: String): FirestoreDoc? = null
  override suspend fun page(query: FirestoreQuery): FirestorePage {
    queries += query
    return FirestorePage(stored, null)
  }
  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> {
    queries += query
    return live
  }
}

private class RecordingPrintersApi(private val answer: (String) -> JsonElement? = { null }) : PosPrintersApi {
  val calls = mutableListOf<Pair<String, Map<String, JsonPrimitive>>>()
  var failure: Throwable? = null

  override suspend fun call(action: String, fields: Map<String, JsonPrimitive>): JsonElement? {
    calls += action to fields
    failure?.let { throw it }
    return answer(action)
  }
}

/** A register's receipt printers read and change the way the console's register hardware card does (AGL-3909). */
class PosPrintersTest {
  @Test
  fun aPrinterIsWaitingOnlineOrOfflineByItsLastPoll() {
    val now = 10_000_000.0
    assertEquals("unknown", printerDisplayState("online", null, now))
    assertEquals("online", printerDisplayState("online", now - 30_000, now))
    assertEquals("paper_out", printerDisplayState("paper_out", now - 60_000, now))
    assertEquals("offline", printerDisplayState("online", now - 121_000, now))
    assertEquals("Offline" to StatusTone.WARNING, printerStateChip("offline"))
    assertEquals("Online" to StatusTone.SUCCESS, printerStateChip("online"))
    assertEquals("Out of paper" to StatusTone.ERROR, printerStateChip("paper_out"))
    assertEquals("Waiting for the printer" to StatusTone.NEUTRAL, printerStateChip("unknown"))
  }

  @Test
  fun lastSeenReadsAsTheConsoleSaysIt() {
    val now = 1_800_000_000_000.0
    assertEquals("never", printerSeenAgo(null, now))
    assertEquals("just now", printerSeenAgo(now - 10_000, now))
    assertEquals("5 min ago", printerSeenAgo(now - 5 * 60_000, now))
    assertEquals("3 h ago", printerSeenAgo(now - 3 * 3_600_000, now))
    assertEquals("3 days ago", printerSeenAgo(now - 72 * 3_600_000, now))
  }

  @Test
  fun theFormSendsTheRoutesFieldsAndTheBrandOnlyWhenAdding() {
    var draft = PrinterDraft()
    assertFalse(draft.complete)
    draft = draft.copy(name = " Counter Star ", deviceId = "00:11:62:AB:CD:EF")
    assertTrue(draft.complete)
    val adding = draft.fields(includingBrand = true)
    assertEquals(JsonPrimitive("star"), adding["brand"])
    assertEquals(JsonPrimitive("Counter Star"), adding["name"])
    assertEquals(JsonPrimitive(80), adding["paperWidthMm"])
    assertEquals(JsonPrimitive(true), adding["autoPrintReceipts"])
    assertEquals(JsonPrimitive(true), adding["kickDrawer"])
    assertNull(draft.fields(includingBrand = false)["brand"])
  }

  @Test
  fun aStoredPrinterAndTheRoutesUrlAnswerAreRead() {
    val row = posPrinterFrom(
      printerDoc(
        "p1",
        mapOf(
          "name" to "Front", "brand" to "epson", "model" to "TM-m30III", "deviceId" to "front-1", "paperWidthMm" to 58L,
          "autoPrintReceipts" to false, "kickDrawer" to true, "status" to mapOf("state" to "online", "atMs" to 1_000L),
        ),
      ),
    )
    assertEquals(58, row.paperWidthMm)
    assertFalse(row.autoPrintReceipts)
    assertEquals("online", row.statusState)
    assertEquals(1_000.0, row.statusAtMs)
    assertEquals("epson", PrinterDraft.of(row).brand)
    assertEquals("Epson TM-m30III · Cash drawer", printerSummary(row))
    val answer = buildJsonObject {
      put("printerId", "p1")
      put("brand", "epson")
      put("pollUrl", "https://console.test/api/commerce/sdp/h/p1/x")
      put("deviceId", "front-1")
    }
    assertEquals("https://console.test/api/commerce/sdp/h/p1/x", PrinterCredentials.from(answer)?.pollUrl)
    assertNull(PrinterCredentials.from(buildJsonObject { put("ok", true) }))
  }

  @Test
  fun aNeverPolledPrinterSaysWhatIsLeftToDo() {
    val row = posPrinterFrom(printerDoc("p1", mapOf("name" to "Counter")))
    assertEquals("Waiting for the printer to poll. Paste its URL into the printer to finish.", printerSeenLine(row, 0.0))
    assertEquals("Star · Prints every sale", printerSummary(row))
  }

  @Test
  fun theRegistersPrintersAreWatchedByRegisterAndSortedByName() = runTest {
    val reader = PrinterReader()
    val printers = PosPrintersModel(reader, RecordingPrintersApi(), "h1", backgroundScope)
    var told: List<PosPrinterRow>? = null
    printers.onRows = { told = it }
    printers.watch("r1")
    runCurrent()
    assertFalse(printers.ready)
    reader.live.value = Live.Ready(listOf(printerDoc("b", mapOf("name" to "Kitchen")), printerDoc("a", mapOf("name" to "counter"))))
    runCurrent()
    assertTrue(printers.ready)
    assertEquals(listOf("counter", "Kitchen"), printers.rows.map { it.name })
    assertEquals(2, told?.size)
    val query = reader.queries.first()
    assertEquals("hosts/h1/printers", query.collectionPath)
    assertEquals("r1", query.filters.single().value)
    assertEquals(POS_PRINTER_WINDOW, query.limit)
  }

  @Test
  fun addingSendsCreateWithTheRegisterAndAnswersTheUrl() = runTest {
    val reader = PrinterReader()
    val api = RecordingPrintersApi { action ->
      if (action == "create") buildJsonObject { put("printerId", "p9"); put("brand", "star"); put("pollUrl", "https://console.test/cloudprnt/x") } else null
    }
    val printers = PosPrintersModel(reader, api, "h1", backgroundScope)
    printers.watch("r1")
    reader.stored = listOf(printerDoc("p9", mapOf("name" to "Counter")))
    val made = printers.add(PrinterDraft(name = "Counter", deviceId = "00:11:62:aa:bb:cc"))
    assertEquals("https://console.test/cloudprnt/x", made?.pollUrl)
    val (action, fields) = api.calls.single()
    assertEquals("create", action)
    assertEquals(JsonPrimitive("r1"), fields["registerId"])
    assertEquals(JsonPrimitive("star"), fields["brand"])
    assertEquals(listOf("Counter"), printers.rows.map { it.name }, "the new printer shows without waiting for the listener")
  }

  @Test
  fun aRefusalIsShownInTheRoutesWordsAndALostConnectionInPlainOnes() = runTest {
    val api = RecordingPrintersApi()
    val printers = PosPrintersModel(PrinterReader(), api, "h1", backgroundScope)
    printers.watch("r1")
    api.failure = ConsoleApiError("That printer is already added to this site.", 409, null)
    assertNull(printers.add(PrinterDraft(name = "Counter", deviceId = "x")))
    assertEquals("That printer is already added to this site.", printers.error)
    api.failure = ConsoleApiError("could not be reached", 0, null)
    val row = posPrinterFrom(printerDoc("p1", mapOf("name" to "Counter")))
    assertFalse(printers.save(row, PrinterDraft.of(row)))
    assertEquals("The printer could not be reached. Check your connection.", printers.error)
    assertFalse(printers.busy)
  }

  @Test
  fun testPrintDrawerAndRemoveNameThePrinter() = runTest {
    val api = RecordingPrintersApi()
    val printers = PosPrintersModel(PrinterReader(), api, "h1", this)
    val row = posPrinterFrom(printerDoc("p1", mapOf("name" to "Counter")))
    printers.send("test", row)
    advanceUntilIdle()
    assertEquals("Test print sent to Counter", printers.notice)
    printers.send("drawer", row)
    advanceUntilIdle()
    assertEquals("Drawer kick sent to Counter", printers.notice)
    printers.remove(row)
    advanceUntilIdle()
    assertEquals("Counter removed", printers.notice)
    assertEquals(listOf("test", "drawer", "remove"), api.calls.map { it.first })
    assertTrue(api.calls.all { it.second["printerId"] == JsonPrimitive("p1") })
  }

  @Test
  fun theRegisterTellsTheLastReceiptWhenItHasAPrinter() = runTest {
    val reader = PrinterReader()
    val printers = PosPrintersModel(reader, RecordingPrintersApi(), "h1", backgroundScope)
    var has = false
    printers.onRows = { has = it.isNotEmpty() }
    printers.watch("r1")
    reader.live.value = Live.Ready(listOf(printerDoc("p1", mapOf("name" to "Counter"))))
    runCurrent()
    assertTrue(has)
    reader.live.value = Live.Ready(emptyList())
    runCurrent()
    assertFalse(has)
  }
}
