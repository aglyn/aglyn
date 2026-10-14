package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.put

/*
 * RETURNS AT THE REGISTER (AGL-3609, AGL-3651, AGL-3652): find the sale by its
 * number (typed or scanned off the receipt), its id or the customer's email,
 * pick what came back, and refund it to the payments the sale was made with.
 * The Apple app's `PosReturns.swift`, line for line.
 *
 * The app calls the SAME route the console register's Return dialog calls,
 * `commerce/pos-return`, as the signed-in member, so every gate holds on the
 * device unchanged: the role, the cashier refund limit (above it the route
 * asks for a manager's PIN), the open-shift rule for cash out of the drawer,
 * the open-chargeback refusal and the attempt claim. The server prices the
 * refund, splits it across the sale's payments and restocks; this only
 * previews the figure the same way the console dialog does.
 */

const val POS_RETURN_ROUTE = "/api/commerce/pos-return"

/** One line of the sale, as the return lookup lists it. */
data class PosReturnLine(
  val index: Int,
  val name: String,
  val variantLabel: String?,
  val quantity: Int,
  /** Units the register already took back. */
  val returned: Int,
  /** Units an online return holds or already took. */
  val held: Int,
  /** What the whole line is worth in a refund (discounts and tax shared in). */
  val valueCents: Long,
) {
  /** Units that can still come back. */
  val left: Int get() = maxOf(0, quantity - returned - held)

  /** What returning [count] more units refunds, by the server's cumulative split. */
  fun refundCents(count: Int): Long {
    if (count <= 0 || quantity <= 0) return 0
    val value = valueCents.toDouble()
    return jsRound(value * (returned + count) / quantity) - jsRound(value * returned / quantity)
  }
}

/** A payment on the sale, with what it can still take back. */
data class PosReturnTender(val id: String, val method: String, val label: String, val amountCents: Long, val refundableCents: Long)

data class PosReturnOrder(
  val id: String,
  val label: String,
  val status: String,
  val createdAtMs: Double,
  val customerEmail: String?,
  val customerName: String?,
  val totalCents: Long,
  val refundedCents: Long,
  val returnable: Boolean,
  val lines: List<PosReturnLine>,
  val tenders: List<PosReturnTender>,
) {
  /** What the order can still give back in all. */
  val remainingCents: Long get() = maxOf(0, totalCents - refundedCents)
}

data class PosReturnPick(val index: Int, val quantity: Int)

data class PosReturnSplit(val paymentId: String, val amountCents: Long)

data class PosReturnRequest(
  val orderId: String,
  val picks: List<PosReturnPick>,
  val restock: Boolean,
  val reasonCode: String,
  val note: String,
  /** Named only when the cashier splits the refund by hand. */
  val split: List<PosReturnSplit>?,
)

data class PosReturnTenderResult(val label: String, val amountCents: Long, val failed: Boolean, val error: String?)

data class PosReturnResult(
  val returnId: String,
  val refundedCents: Long,
  /** Money a card could not take back; the cashier pays it another way. */
  val outstandingCents: Long,
  val partial: Boolean,
  /** Cash to hand over from the drawer. */
  val cashOutCents: Long,
  val restockedUnits: Int,
  val tenders: List<PosReturnTenderResult>,
)

fun readReturnOrder(element: JsonElement?): PosReturnOrder? {
  val record = element as? JsonObject ?: return null
  val id = record["id"].str() ?: return null
  val lines = record["lines"].arr().mapNotNull { line ->
    val fields = line.obj()
    PosReturnLine(
      index = fields["index"].num()?.let(::jsRound)?.toInt() ?: return@mapNotNull null,
      name = fields["name"].str().orEmpty(),
      variantLabel = fields["variantLabel"].str(),
      quantity = maxOf(1L, fields["quantity"].cents()).toInt(),
      returned = fields["returned"].cents().toInt(),
      held = fields["held"].cents().toInt(),
      valueCents = fields["valueCents"].cents(),
    )
  }
  val tenders = record["tenders"].arr().mapNotNull { tender ->
    val fields = tender.obj()
    PosReturnTender(
      id = fields["id"].str() ?: return@mapNotNull null,
      method = fields["method"].str().orEmpty(),
      label = fields["label"].str() ?: "Payment",
      amountCents = fields["amountCents"].cents(),
      refundableCents = fields["refundableCents"].cents(),
    )
  }
  return PosReturnOrder(
    id = id,
    label = record["label"].str() ?: id,
    status = record["status"].str().orEmpty(),
    createdAtMs = record["createdAtMs"].num() ?: 0.0,
    customerEmail = record["customerEmail"].str(),
    customerName = record["customerName"].str(),
    totalCents = record["totalCents"].cents(),
    refundedCents = record["refundedCents"].cents(),
    returnable = record["returnable"].bool(),
    lines = lines,
    tenders = tenders,
  )
}

fun readReturnResult(element: JsonElement?): PosReturnResult? {
  val record = element as? JsonObject ?: return null
  if (record["refundedCents"] == null) return null
  return PosReturnResult(
    returnId = record["returnId"].str().orEmpty(),
    refundedCents = record["refundedCents"].cents(),
    outstandingCents = record["outstandingCents"].cents(),
    partial = record["partial"].bool(),
    cashOutCents = record["cashOutCents"].cents(),
    restockedUnits = record["restockedUnits"].cents().toInt(),
    tenders = record["tenders"].arr().map { tender ->
      val fields = tender.obj()
      PosReturnTenderResult(
        label = fields["label"].str() ?: "Payment",
        amountCents = fields["amountCents"].cents(),
        failed = fields["status"].str() == "failed",
        error = fields["error"].str(),
      )
    },
  )
}

/** The return route, as the signed-in member. */
interface PosReturnsApi {
  suspend fun find(text: String): List<PosReturnOrder>
  suspend fun refund(registerId: String, assertion: String?, managerAssertion: String?, request: PosReturnRequest, attemptKey: String): PosReturnResult
}

class ConsolePosReturnsApi(private val api: ConsoleApiClient, private val hostId: String) : PosReturnsApi {
  override suspend fun find(text: String): List<PosReturnOrder> {
    val answer = api.request(
      POS_RETURN_ROUTE,
      ApiMethod.POST,
      buildJsonObject {
        put("hostId", hostId)
        put("action", "find")
        put("text", text)
      },
    ).obj()
    return answer["orders"].arr().mapNotNull(::readReturnOrder)
  }

  override suspend fun refund(registerId: String, assertion: String?, managerAssertion: String?, request: PosReturnRequest, attemptKey: String): PosReturnResult {
    val body = buildJsonObject {
      put("hostId", hostId)
      put("registerId", registerId)
      put("action", "refund")
      put("orderId", request.orderId)
      put(
        "lines",
        buildJsonArray {
          request.picks.forEach { pick ->
            add(buildJsonObject { put("index", pick.index); put("quantity", pick.quantity) })
          }
        },
      )
      put("restock", request.restock)
      put("reasonCode", request.reasonCode)
      request.note.trim().takeIf { it.isNotEmpty() }?.let { put("reason", it) }
      request.split?.let { split ->
        put(
          "tenders",
          buildJsonArray {
            split.forEach { slice -> add(buildJsonObject { put("paymentId", slice.paymentId); put("amountCents", slice.amountCents) }) }
          },
        )
      }
      assertion?.let { put("cashierAssertion", it) }
      managerAssertion?.let { put("managerAssertion", it) }
    }
    return readReturnResult(api.request(POS_RETURN_ROUTE, ApiMethod.POST, body, idempotencyKey = attemptKey))
      ?: throw ConsoleApiError("The register did not answer with a refund.", 502, null)
  }
}

/** The return route where there is no console to ask: every call finds it unreachable. */
object OfflinePosReturns : PosReturnsApi {
  private fun unreachable(): Nothing = throw ConsoleApiError("The register is offline. Check the connection and try again.", 0, null)
  override suspend fun find(text: String): List<PosReturnOrder> = unreachable()
  override suspend fun refund(registerId: String, assertion: String?, managerAssertion: String?, request: PosReturnRequest, attemptKey: String): PosReturnResult = unreachable()
}

/** A return being rung: the lookup, the picks, the refund and what the cashier does next. */
class PosReturnModel(
  private val api: PosReturnsApi,
  private val scope: CoroutineScope,
  private val registerId: () -> String?,
  private val assertion: () -> String?,
  private val mintKey: () -> String = { newAttemptKey("pos-return") },
) {
  /** Every order the lookup found; null before it ran. */
  var orders by mutableStateOf<List<PosReturnOrder>?>(null)
    private set
  var order by mutableStateOf<PosReturnOrder?>(null)
    private set
  var picked by mutableStateOf<Map<Int, Int>>(emptyMap())
    private set
  var text by mutableStateOf("")
  var restock by mutableStateOf(true)
  var reasonCode by mutableStateOf("no_longer_needed")
  var note by mutableStateOf("")
  var splitByHand by mutableStateOf(false)
  var split by mutableStateOf<Map<String, String>>(emptyMap())
  var error by mutableStateOf<String?>(null)
    private set
  var busy by mutableStateOf(false)
    private set
  var result by mutableStateOf<PosReturnResult?>(null)
    private set

  /** Set while the route wants a manager's PIN, with its words. */
  var managerPrompt by mutableStateOf<String?>(null)
    private set

  /** One attempt per return: a retried tap or the manager's approval reuses it. */
  private var attempt = ""

  /** Back to an empty lookup (a dialog that closes, or "Done"). */
  fun reset() {
    text = ""
    orders = null
    order = null
    picked = emptyMap()
    restock = true
    reasonCode = "no_longer_needed"
    note = ""
    splitByHand = false
    split = emptyMap()
    error = null
    result = null
    managerPrompt = null
    attempt = ""
  }

  fun find() {
    val query = text.trim()
    if (query.isEmpty() || busy) return
    busy = true
    error = null
    scope.launch {
      try {
        val found = api.find(query)
        orders = found
        if (found.size == 1) choose(found[0])
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = (failure as? ConsoleApiError)?.message ?: "Could not look the order up."
      } finally {
        busy = false
      }
    }
  }

  fun choose(next: PosReturnOrder) {
    order = next
    picked = emptyMap()
    split = emptyMap()
    attempt = ""
    error = null
  }

  /** Back from the picks: to the list when the lookup found several, else to the lookup. */
  fun back() {
    if (busy) return
    if ((orders?.size ?: 0) > 1) {
      order = null
      picked = emptyMap()
      error = null
    } else {
      reset()
    }
  }

  fun quantity(line: PosReturnLine): Int = picked[line.index] ?: 0

  fun step(line: PosReturnLine, delta: Int) {
    if (order?.returnable != true) return
    picked = picked + (line.index to (quantity(line) + delta).coerceIn(0, line.left))
    attempt = ""
  }

  val picks: List<PosReturnPick>
    get() = picked.filterValues { it > 0 }.map { PosReturnPick(it.key, it.value) }.sortedBy { it.index }

  /** What the picks refund, by the console dialog's own figure. */
  val refundCents: Long
    get() {
      val current = order ?: return 0
      val asked = picks.sumOf { pick -> current.lines.firstOrNull { it.index == pick.index }?.refundCents(pick.quantity) ?: 0L }
      return minOf(asked, current.remainingCents)
    }

  val canSubmit: Boolean get() = !busy && order?.returnable == true && picks.isNotEmpty() && refundCents > 0

  /** What the hand split names, one entry per payment given an amount. */
  private fun handSplit(current: PosReturnOrder): List<PosReturnSplit>? {
    if (!splitByHand) return null
    return current.tenders.mapNotNull { tender ->
      val cents = centsFromText(split[tender.id])?.takeIf { it > 0 } ?: return@mapNotNull null
      PosReturnSplit(tender.id, cents)
    }
  }

  fun submit(managerAssertion: String? = null) {
    val current = order ?: return
    if (picks.isEmpty() || busy) return
    val register = registerId() ?: return
    if (attempt.isEmpty()) attempt = mintKey()
    val request = PosReturnRequest(current.id, picks, restock, reasonCode, note, handSplit(current))
    val key = attempt
    busy = true
    error = null
    scope.launch {
      try {
        result = api.refund(register, assertion(), managerAssertion, request, key)
        managerPrompt = null
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        val refusal = failure as? ConsoleApiError
        if (refusal != null && refusal.status == 403 && refusal.body.obj()["needsManager"].bool()) {
          managerPrompt = refusal.message
        } else {
          // A refusal moved no money; a new tap is a new attempt.
          attempt = ""
          error = refusal?.message ?: "The return could not be refunded."
        }
      } finally {
        busy = false
      }
    }
  }

  /** A manager's PIN approved the refund: send it again as the same attempt. */
  fun approve(manager: PosStaffAssertion) {
    managerPrompt = null
    submit(manager.assertion)
  }

  fun cancelApproval() {
    managerPrompt = null
  }
}
