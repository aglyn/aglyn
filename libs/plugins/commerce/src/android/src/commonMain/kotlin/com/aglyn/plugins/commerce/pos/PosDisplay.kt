package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.PosDeviceMode
import com.aglyn.contracts.PosDisplayCart
import com.aglyn.contracts.PosDisplayLine
import com.aglyn.contracts.PosDisplayMode
import com.aglyn.contracts.PosDisplayResponse
import com.aglyn.contracts.PosDisplayState
import com.aglyn.contracts.PosDisplayStateProcessing
import com.aglyn.contracts.PosDisplayStateReceipt
import com.aglyn.contracts.PosDisplayStateTip
import com.aglyn.contracts.PosReceiptChannel
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.coroutines.coroutineContext

/*
 * THE CUSTOMER DISPLAY, from the register (AGL-3608, AGL-3651, AGL-3652): pair a
 * display or a self-service kiosk, mirror the basket onto it, ask the customer
 * for a tip and a receipt choice, and show the thank-you. The Apple app's
 * `PosDisplay.swift`, line for line.
 *
 * The register calls the SAME staff half of `commerce/pos-display` the console
 * register calls (`pairing-code`, `push`, `state`, `displays`, `revoke`), as the
 * signed-in member, so every gate holds on the device unchanged. The display
 * state lives server-side only (it can hold a customer's typed address), so the
 * register reads the customer's answer back by polling the route, never from
 * Firestore.
 */

const val POS_DISPLAY_ROUTE = "/api/commerce/pos-display"

/** How long the register waits for the customer to answer a prompt. */
const val POS_DISPLAY_ANSWER_TIMEOUT_MS = 3L * 60 * 1000

/** How often the register looks for the customer's answer. */
const val POS_DISPLAY_ANSWER_POLL_MS = 1_000L

/** One paired screen of a register: a customer display or a self-service kiosk. */
data class PosPairedDevice(
  /** The first 16 characters of the token's hash, which is all the staff API names a device by. */
  val id: String,
  val label: String,
  val mode: PosDeviceMode,
  val createdAtMs: Double,
  val lastSeenAtMs: Double,
) {
  /** Polled within the last two minutes, the console's own "connected". */
  fun connected(nowMs: Double): Boolean = nowMs - lastSeenAtMs < 120_000
}

/** A six-digit code the paired screen enters, good for ten minutes and usable once. */
data class PosPairingCode(val code: String, val expiresAtMs: Double) {
  val spoken: String get() = if (code.length == 6) "${code.take(3)} ${code.takeLast(3)}" else code
}

/** What the register reads of its display: the state, and whether a screen is polling. */
data class PosDisplayRead(val state: PosDisplayState?, val connected: Boolean)

/** The register's staff half of the display route, as the signed-in member. */
interface PosDisplayApi {
  suspend fun state(registerId: String): PosDisplayRead
  suspend fun push(registerId: String, state: PosDisplayState)
  suspend fun pairingCode(registerId: String, mode: PosDeviceMode): PosPairingCode
  suspend fun devices(registerId: String): List<PosPairedDevice>
  suspend fun revoke(registerId: String, deviceId: String): Int
}

class ConsolePosDisplayApi(private val api: ConsoleApiClient, private val hostId: String) : PosDisplayApi {
  private fun body(registerId: String, action: String, extra: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit = {}): JsonObject = buildJsonObject {
    put("hostId", hostId)
    put("registerId", registerId)
    put("action", action)
    extra()
  }

  override suspend fun state(registerId: String): PosDisplayRead {
    val answer = api.request(POS_DISPLAY_ROUTE, ApiMethod.GET, query = mapOf("action" to "state", "hostId" to hostId, "registerId" to registerId)).obj()
    val raw = answer["state"]
    val state = if (raw == null || raw is JsonNull) null else runCatching { ContractJsonFormat.decodeFromJsonElement(PosDisplayState.serializer(), raw) }.getOrNull()
    return PosDisplayRead(state, answer["connected"].bool())
  }

  override suspend fun push(registerId: String, state: PosDisplayState) {
    api.request(
      POS_DISPLAY_ROUTE,
      ApiMethod.POST,
      body(registerId, "push") { put("state", ContractJsonFormat.encodeToJsonElement(PosDisplayState.serializer(), state)) },
    )
  }

  override suspend fun pairingCode(registerId: String, mode: PosDeviceMode): PosPairingCode {
    val answer = api.request(POS_DISPLAY_ROUTE, ApiMethod.POST, body(registerId, "pairing-code") { put("mode", mode.raw) }).obj()
    val code = answer["code"].str() ?: throw ConsoleApiError("The register did not answer with a code.", 502, null)
    return PosPairingCode(code, answer["expiresAtMs"].num() ?: 0.0)
  }

  override suspend fun devices(registerId: String): List<PosPairedDevice> {
    val answer = api.request(POS_DISPLAY_ROUTE, ApiMethod.POST, body(registerId, "displays")).obj()
    return answer["displays"].arr().mapNotNull { entry ->
      val fields = entry.obj()
      PosPairedDevice(
        id = fields["id"].str() ?: return@mapNotNull null,
        label = fields["label"].str() ?: "Customer display",
        mode = if (fields["mode"].str() == "kiosk") PosDeviceMode.KIOSK else PosDeviceMode.DISPLAY,
        createdAtMs = fields["createdAtMs"].num() ?: 0.0,
        lastSeenAtMs = fields["lastSeenAtMs"].num() ?: 0.0,
      )
    }
  }

  override suspend fun revoke(registerId: String, deviceId: String): Int =
    api.request(POS_DISPLAY_ROUTE, ApiMethod.POST, body(registerId, "revoke") { put("displayId", deviceId) }).obj()["revoked"].cents().toInt()
}

/** The display route where there is no console to ask: every call finds it unreachable. */
object OfflinePosDisplay : PosDisplayApi {
  private fun unreachable(): Nothing = throw ConsoleApiError("The register is offline. Check the connection and try again.", 0, null)
  override suspend fun state(registerId: String): PosDisplayRead = unreachable()
  override suspend fun push(registerId: String, state: PosDisplayState) = unreachable()
  override suspend fun pairingCode(registerId: String, mode: PosDeviceMode): PosPairingCode = unreachable()
  override suspend fun devices(registerId: String): List<PosPairedDevice> = unreachable()
  override suspend fun revoke(registerId: String, deviceId: String): Int = unreachable()
}

/**
 * The tip the customer screen shows beside the sale: the tips already on its payments, plus one chosen
 * for the payment about to be taken (on the display or by the cashier), which the ledger does not hold
 * until that payment is recorded (`posDisplayTipCents`).
 */
fun posDisplayTipCents(saleStatus: String, saleTipCents: Long, pendingTipCents: Long): Long {
  val pending = if (saleStatus == "paid") 0 else maxOf(0, pendingTipCents)
  return maxOf(0, saleTipCents) + pending
}

/**
 * What the display shows while the cashier builds the basket, or while a sale is open on it: the lines,
 * then the server's total once the sale is priced, with what is paid and due and the tip so far.
 */
fun posDisplayBasketState(cart: Cart, sale: PosSale?, pendingTipCents: Long, nowMs: Long): PosDisplayState {
  if (cart.isEmpty) return PosDisplayState(mode = PosDisplayMode.IDLE, updatedAtMs = nowMs.toDouble())
  val items = cart.subtotalCents
  val discount = cart.discountCents
  val estimate = items - discount
  val lines = cart.lines.takeLast(Contracts.posDisplayMaxLines.toInt()).map {
    PosDisplayLine(amountCents = (it.unitCents * it.quantity).toDouble(), name = it.name, quantity = it.quantity.toDouble(), variantLabel = it.variantLabel)
  }
  val display = PosDisplayCart(
    discountCents = discount.toDouble(),
    dueCents = sale?.dueCents?.toDouble(),
    itemsCents = items.toDouble(),
    lines = lines,
    paidCents = sale?.paidCents?.toDouble(),
    taxCents = (sale?.let { maxOf(0, it.totalCents - estimate) } ?: 0).toDouble(),
    tipCents = sale?.let { posDisplayTipCents(it.status, it.tipCents, pendingTipCents).toDouble() },
    totalCents = (sale?.totalCents ?: estimate).toDouble(),
  )
  return PosDisplayState(cart = display, mode = PosDisplayMode.CART, updatedAtMs = nowMs.toDouble())
}

/** What the customer is asked for a tip on the display: percentages the store offers, and a custom amount. */
fun posDisplayTipPrompt(baseCents: Long, percentages: List<Double>, nowMs: Long): PosDisplayState =
  PosDisplayState(mode = PosDisplayMode.TIP, tip = PosDisplayStateTip(allowCustom = true, baseCents = baseCents.toDouble(), percentages = percentages), updatedAtMs = nowMs.toDouble())

/** What the customer is asked for their receipt on the display. */
fun posDisplayReceiptPrompt(smsAvailable: Boolean, offerMarketing: Boolean, nowMs: Long): PosDisplayState =
  PosDisplayState(
    mode = PosDisplayMode.RECEIPT,
    receipt = PosDisplayStateReceipt(
      channels = listOf(PosReceiptChannel.EMAIL) + (if (smsAvailable) listOf(PosReceiptChannel.SMS) else emptyList()) + listOf(PosReceiptChannel.PRINT, PosReceiptChannel.NONE),
      offerMarketing = offerMarketing,
    ),
    updatedAtMs = nowMs.toDouble(),
  )

/** "Tap, insert or swipe your card on the reader." */
fun posDisplayProcessing(nowMs: Long): PosDisplayState =
  PosDisplayState(mode = PosDisplayMode.PROCESSING, processing = PosDisplayStateProcessing("Tap, insert or swipe your card on the reader."), updatedAtMs = nowMs.toDouble())

/** The register's side of the paired screens: whether one is connected, what it shows, what it is asked, who is paired. */
class PosDisplayControl(
  private val api: PosDisplayApi,
  private val scope: CoroutineScope,
  private val registerId: () -> String?,
  private val now: () -> Long = ::nowMs,
  private val pause: suspend (Long) -> Unit = { delay(it) },
  private val mintKey: () -> String = { newAttemptKey("display") },
  private val timeoutMs: Long = POS_DISPLAY_ANSWER_TIMEOUT_MS,
  private val pollMs: Long = POS_DISPLAY_ANSWER_POLL_MS,
) {
  /** A display for this register polled within the last two minutes. */
  var connected by mutableStateOf(false)
    private set

  /** The prompt the register is waiting on, if any. */
  var asking by mutableStateOf<PosDisplayMode?>(null)
    private set
  var devices by mutableStateOf<List<PosPairedDevice>>(emptyList())
    private set
  var pairing by mutableStateOf<PosPairingCode?>(null)
    private set
  var pairingMode by mutableStateOf(PosDeviceMode.DISPLAY)
    private set
  var busy by mutableStateOf(false)
    private set
  var error by mutableStateOf<String?>(null)
    private set
  var notice by mutableStateOf<String?>(null)

  /** Each ask takes the next number; an older ask sees it has been replaced and gives up. */
  private var generation = 0

  /** A new register is a new set of screens. */
  fun reset() {
    connected = false
    devices = emptyList()
    pairing = null
    cancelAsk()
  }

  /** Asks whether a display is polling; the register's beat calls this. */
  suspend fun check() {
    val register = registerId() ?: return
    connected = try {
      api.state(register).connected
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      false
    }
  }

  /** Shows something on the display with no answer expected. Nothing while no display is connected or a prompt waits. */
  suspend fun show(state: PosDisplayState) {
    if (!connected || asking != null) return
    val register = registerId() ?: return
    try {
      api.push(register, state)
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
    }
  }

  /** Shows the thank-you; the display returns to idle by itself a few seconds later. */
  suspend fun thank() = show(PosDisplayState(mode = PosDisplayMode.THANKS, updatedAtMs = now().toDouble()))

  /**
   * Asks the customer (a tip or a receipt) and returns their answer, or null when the cashier cancels,
   * the customer does not answer, or the display cannot be reached.
   */
  suspend fun ask(state: PosDisplayState): PosDisplayResponse? {
    val register = registerId() ?: return null
    generation += 1
    val mine = generation
    val promptId = mintKey().take(32)
    val prompt = state.copy(promptId = promptId, updatedAtMs = now().toDouble())
    try {
      api.push(register, prompt)
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      return null
    }
    asking = state.mode
    try {
      val ticks = maxOf(1L, timeoutMs / pollMs)
      for (tick in 0 until ticks) {
        pause(pollMs)
        if (generation != mine || !coroutineContext.isActive) return null
        val answer = try {
          api.state(register).state?.response
        } catch (failure: Throwable) {
          if (failure is CancellationException) throw failure
          null
        }
        if (answer != null && answer.promptId == promptId) return answer
      }
      return null
    } finally {
      if (generation == mine) asking = null
    }
  }

  /** The cashier answers for the customer, or the sale moved on. */
  fun cancelAsk() {
    generation += 1
    asking = null
  }

  /** A fresh code for a new screen. */
  fun newPairingCode(mode: PosDeviceMode) {
    val register = registerId() ?: return
    if (busy) return
    busy = true
    error = null
    pairingMode = mode
    scope.launch {
      try {
        pairing = api.pairingCode(register, mode)
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        pairing = null
        error = (failure as? ConsoleApiError)?.message ?: "Could not make a code. Try again."
      } finally {
        busy = false
      }
    }
  }

  fun closePairing() {
    pairing = null
  }

  fun loadDevices() {
    val register = registerId() ?: return
    scope.launch { readDevices(register) }
  }

  private suspend fun readDevices(register: String) {
    try {
      devices = api.devices(register)
      error = null
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      error = (failure as? ConsoleApiError)?.message ?: "Could not read the paired screens."
    }
  }

  /** Signs one screen out, or every screen of this register ("*"). */
  fun revoke(deviceId: String) {
    val register = registerId() ?: return
    if (busy) return
    busy = true
    scope.launch {
      try {
        val count = api.revoke(register, deviceId)
        notice = if (count == 1) "Screen signed out" else "$count screens signed out"
        devices = api.devices(register)
        check()
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = (failure as? ConsoleApiError)?.message ?: "Could not sign the screen out."
      } finally {
        busy = false
      }
    }
  }
}
