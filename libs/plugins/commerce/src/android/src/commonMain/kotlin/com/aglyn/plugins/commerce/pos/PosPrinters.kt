package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.Contracts
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import com.aglyn.ui.StatusTone
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.max
import kotlin.math.roundToLong

/*
 * A REGISTER'S RECEIPT PRINTERS (AGL-3909): the console's register hardware
 * card, natively, as the Apple app's `PosPrinters.swift` has it. Star CloudPRNT
 * and Epson Server Direct Print printers poll the console for their jobs, so
 * adding one is a form and a URL to paste into the printer: no driver, no
 * pairing. Every change goes through `/api/commerce/printers`, as the console's
 * does, so the route's gates (managePos, the plan's POS) hold here unchanged.
 */

const val POS_PRINTERS_ROUTE = "/api/commerce/printers"

/** The most printers one register lists (the console's card reads the same window). */
const val POS_PRINTER_WINDOW = 10

/** One printer of the register (`hosts/{site}/printers/{id}`, server-written). */
data class PosPrinterRow(
  val id: String,
  val name: String,
  val brand: String,
  val model: String?,
  val deviceId: String,
  val paperWidthMm: Int,
  val autoPrintReceipts: Boolean,
  val kickDrawer: Boolean,
  val kitchenTickets: Boolean,
  val logoKey: String?,
  val statusState: String?,
  val statusDetail: String?,
  val statusAtMs: Double?,
)

fun posPrinterFrom(doc: FirestoreDoc): PosPrinterRow {
  val status = doc.data["status"] as? Map<*, *>
  return PosPrinterRow(
    id = doc.id,
    name = doc.string("name")?.trim()?.ifEmpty { null } ?: "Printer",
    brand = doc.string("brand")?.ifEmpty { null } ?: "star",
    model = doc.string("model")?.trim()?.ifEmpty { null },
    deviceId = doc.string("deviceId").orEmpty(),
    paperWidthMm = if ((doc.data["paperWidthMm"] as? Number)?.toInt() == 58) 58 else 80,
    autoPrintReceipts = doc.bool("autoPrintReceipts") ?: true,
    kickDrawer = doc.bool("kickDrawer") ?: false,
    kitchenTickets = doc.bool("kitchenTickets") ?: false,
    logoKey = doc.string("logoKey")?.trim()?.ifEmpty { null },
    statusState = status?.get("state") as? String,
    statusDetail = (status?.get("detail") as? String)?.ifEmpty { null },
    statusAtMs = (status?.get("atMs") as? Number)?.toDouble(),
  )
}

fun printersQuery(hostId: String, registerId: String) = FirestoreQuery(
  "hosts/$hostId/printers",
  filters = listOf(FirestoreFilter("registerId", FilterOp.EQ, registerId)),
  limit = POS_PRINTER_WINDOW,
)

/**
 * What a printer shows now, as the console's `printerDisplayState` reads it:
 * never polled is waiting, a printer quiet for longer than the offline window
 * is offline, else what it last said.
 */
fun printerDisplayState(state: String?, atMs: Double?, nowMs: Double): String {
  if (atMs == null || atMs <= 0) return "unknown"
  if (nowMs - atMs > Contracts.printerOfflineAfterMs) return "offline"
  return state ?: "unknown"
}

/** A printer state's words and tone. */
fun printerStateChip(state: String): Pair<String, StatusTone> = when (state) {
  "offline" -> "Offline" to StatusTone.WARNING
  "online" -> (Contracts.printerStateLabels[state] ?: "Online") to StatusTone.SUCCESS
  "paper_low" -> (Contracts.printerStateLabels[state] ?: "Paper low") to StatusTone.WARNING
  "unknown" -> (Contracts.printerStateLabels[state] ?: "Waiting for the printer") to StatusTone.NEUTRAL
  else -> (Contracts.printerStateLabels[state] ?: "Printer error") to StatusTone.ERROR
}

/** How long ago a printer last polled, in the console's words (`seenAgo`). */
fun printerSeenAgo(atMs: Double?, nowMs: Double): String {
  if (atMs == null || atMs <= 0) return "never"
  val seconds = max(0.0, (nowMs - atMs) / 1000).roundToLong()
  if (seconds < 45) return "just now"
  val minutes = (seconds / 60.0).roundToLong()
  if (minutes < 60) return "$minutes min ago"
  val hours = (minutes / 60.0).roundToLong()
  if (hours < 48) return "$hours h ago"
  return "${(hours / 24.0).roundToLong()} days ago"
}

/** The brand's short name, as the printer row says it. */
fun printerBrandName(brand: String): String = if (brand == "epson") "Epson" else "Star"

/** The row's second line: the brand and model, then what the printer does for this register. */
fun printerSummary(row: PosPrinterRow): String = buildList {
  add(printerBrandName(row.brand) + (row.model?.let { " $it" } ?: ""))
  if (row.autoPrintReceipts) add("Prints every sale")
  if (row.kickDrawer) add("Cash drawer")
  if (row.kitchenTickets) add("Kitchen tickets")
}.joinToString(" · ")

/** When the printer last polled (and what it said), or what is left to finish it. */
fun printerSeenLine(row: PosPrinterRow, nowMs: Double): String =
  if (row.statusAtMs == null) {
    "Waiting for the printer to poll. Paste its URL into the printer to finish."
  } else {
    "Last seen ${printerSeenAgo(row.statusAtMs, nowMs)}" + (row.statusDetail?.let { " · $it" } ?: "")
  }

/** Where each brand's URL goes, step by step (the console's `printerSetupSteps`). */
fun printerSetupSteps(brand: String): List<String> =
  if (brand == "star") {
    listOf(
      "Open the printer’s web page: print a self-test (hold FEED while switching on) to find its IP address, then browse to it and sign in (default user root, password public, or the password on the printer’s label).",
      "Go to Settings → CloudPRNT. Turn CloudPRNT on and paste the URL below as the Server URL.",
      "Set the polling interval to 5 seconds, then Submit and Save → Restart device.",
      "Come back here: the printer shows Online within a minute. Send a test print.",
    )
  } else {
    listOf(
      "Open EPSON TMNet WebConfig: browse to the printer’s IP address (print a status sheet by holding FEED while switching on).",
      "Open Server Direct Print (under Web Service Settings on most models). Select Enable and enter the ID below.",
      "Paste the URL below as Server 1 URL and set the interval to 5 seconds. Submit, then reset the printer.",
      "Come back here: the printer shows Online within a minute. Send a test print.",
    )
  }

/** The printer form (add and settings), as the console's `PrinterForm` holds it. */
data class PrinterDraft(
  val brand: String = "star",
  val name: String = "",
  val model: String = "",
  val deviceId: String = "",
  val paperWidthMm: Int = 80,
  val autoPrintReceipts: Boolean = true,
  val kickDrawer: Boolean = true,
  val kitchenTickets: Boolean = false,
  val logoKey: String = "",
) {
  /** The route body's settings; `brand` only when adding (a printer's brand never changes). */
  fun fields(includingBrand: Boolean): Map<String, JsonPrimitive> = buildMap {
    put("name", JsonPrimitive(name.trim()))
    put("model", JsonPrimitive(model.trim()))
    put("deviceId", JsonPrimitive(deviceId.trim()))
    put("paperWidthMm", JsonPrimitive(paperWidthMm))
    put("autoPrintReceipts", JsonPrimitive(autoPrintReceipts))
    put("kickDrawer", JsonPrimitive(kickDrawer))
    put("kitchenTickets", JsonPrimitive(kitchenTickets))
    put("logoKey", JsonPrimitive(logoKey.trim()))
    if (includingBrand) put("brand", JsonPrimitive(brand))
  }

  val complete: Boolean get() = name.isNotBlank() && deviceId.isNotBlank()

  companion object {
    fun of(row: PosPrinterRow) = PrinterDraft(
      brand = row.brand,
      name = row.name,
      model = row.model.orEmpty(),
      deviceId = row.deviceId,
      paperWidthMm = row.paperWidthMm,
      autoPrintReceipts = row.autoPrintReceipts,
      kickDrawer = row.kickDrawer,
      kitchenTickets = row.kitchenTickets,
      logoKey = row.logoKey.orEmpty(),
    )
  }
}

/** The URL (and Epson ID) a printer polls with, as the route answers it. */
data class PrinterCredentials(val printerId: String, val brand: String, val pollUrl: String, val deviceId: String?) {
  companion object {
    fun from(answer: JsonElement?): PrinterCredentials? {
      val record = answer as? JsonObject ?: return null
      val url = record["pollUrl"].str()?.ifEmpty { null } ?: return null
      return PrinterCredentials(
        printerId = record["printerId"].str().orEmpty(),
        brand = record["brand"].str() ?: "star",
        pollUrl = url,
        deviceId = record["deviceId"].str(),
      )
    }
  }
}

/** The printers route, as the signed-in member: one action and its fields per call. */
fun interface PosPrintersApi {
  suspend fun call(action: String, fields: Map<String, JsonPrimitive>): JsonElement?
}

class ConsolePosPrintersApi(private val api: ConsoleApiClient, private val hostId: String) : PosPrintersApi {
  override suspend fun call(action: String, fields: Map<String, JsonPrimitive>): JsonElement? =
    api.request(POS_PRINTERS_ROUTE, ApiMethod.POST, JsonObject(fields + mapOf("hostId" to JsonPrimitive(hostId), "action" to JsonPrimitive(action))))
}

/** The printers route where there is no console to ask. */
val OfflinePosPrinters = PosPrintersApi { _, _ -> throw ConsoleApiError("The register is offline. Check the connection and try again.", 0, null) }

/** The register's printers, live, and the route's actions on them. */
class PosPrintersModel(
  private val firestore: FirestoreReader,
  private val api: PosPrintersApi,
  private val hostId: String,
  private val scope: CoroutineScope,
) {
  var rows by mutableStateOf<List<PosPrinterRow>>(emptyList())
    private set
  var ready by mutableStateOf(false)
    private set
  var busy by mutableStateOf(false)
    private set
  var notice by mutableStateOf<String?>(null)
  var error by mutableStateOf<String?>(null)

  var registerId: String? = null
    private set

  /** Told whenever the register's printers change (the last receipt offers its printer button from it). */
  var onRows: (List<PosPrinterRow>) -> Unit = {}

  private var listening: Job? = null

  fun watch(next: String?) {
    if (next == registerId && listening != null) return
    registerId = next
    listening?.cancel()
    listening = null
    rows = emptyList()
    ready = false
    if (next == null) return
    listening = scope.launch {
      firestore.observe(printersQuery(hostId, next)).collect { live ->
        if (registerId != next) return@collect
        when (live) {
          is Live.Ready -> show(live.value)
          is Live.Failed -> ready = true
          Live.Loading -> Unit
        }
      }
    }
  }

  fun stop() {
    listening?.cancel()
    listening = null
  }

  private fun show(docs: List<FirestoreDoc>) {
    rows = docs.map(::posPrinterFrom).sortedWith(compareBy<PosPrinterRow> { it.name.lowercase() }.thenBy { it.id })
    ready = true
    onRows(rows)
  }

  /** Reads the register's printers once: a change shows at once, also where the reader refreshes on a timer. */
  private suspend fun reread() {
    val register = registerId ?: return
    runCatching { firestore.page(printersQuery(hostId, register)).docs }
      .onSuccess { if (registerId == register) show(it) }
      .onFailure { if (it is CancellationException) throw it }
  }

  /** Runs one route call; the answer, or null with [error] set. */
  private suspend fun ask(action: String, fields: Map<String, JsonPrimitive>): Result<JsonElement?> {
    busy = true
    error = null
    return try {
      Result.success(api.call(action, fields))
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      error = (failure as? ConsoleApiError)?.takeIf { it.status != 0 }?.message ?: "The printer could not be reached. Check your connection."
      Result.failure(failure)
    } finally {
      busy = false
    }
  }

  /** Adds a printer to this register; answers the URL to paste into it. */
  suspend fun add(draft: PrinterDraft): PrinterCredentials? {
    val register = registerId ?: return null
    val answer = ask("create", draft.fields(includingBrand = true) + ("registerId" to JsonPrimitive(register))).getOrNull() ?: return null
    reread()
    return PrinterCredentials.from(answer)
  }

  suspend fun save(row: PosPrinterRow, draft: PrinterDraft): Boolean {
    val saved = ask("update", draft.fields(includingBrand = false) + ("printerId" to JsonPrimitive(row.id))).isSuccess
    if (saved) {
      notice = "${draft.name.trim().ifEmpty { row.name }} saved"
      reread()
    }
    return saved
  }

  suspend fun credentials(row: PosPrinterRow): PrinterCredentials? =
    PrinterCredentials.from(ask("credentials", mapOf("printerId" to JsonPrimitive(row.id))).getOrNull())

  suspend fun regenerate(row: PosPrinterRow): PrinterCredentials? =
    PrinterCredentials.from(ask("regenerate", mapOf("printerId" to JsonPrimitive(row.id))).getOrNull())

  /** A test print, or the drawer kicked open. */
  fun send(action: String, row: PosPrinterRow) {
    if (busy) return
    scope.launch {
      if (ask(action, mapOf("printerId" to JsonPrimitive(row.id))).isSuccess) {
        notice = if (action == "test") "Test print sent to ${row.name}" else "Drawer kick sent to ${row.name}"
      }
    }
  }

  fun remove(row: PosPrinterRow) {
    if (busy) return
    scope.launch {
      if (ask("remove", mapOf("printerId" to JsonPrimitive(row.id))).isSuccess) {
        notice = "${row.name} removed"
        reread()
      }
    }
  }
}
