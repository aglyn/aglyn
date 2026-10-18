package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.PosDeviceMode
import com.aglyn.contracts.PosDisplayCart
import com.aglyn.contracts.PosDisplayMode
import com.aglyn.contracts.PosDisplayResponseTipChoice
import com.aglyn.contracts.PosDisplayState
import com.aglyn.contracts.PosDisplayStateReceipt
import com.aglyn.contracts.PosDisplayStateTip
import com.aglyn.contracts.PosReceiptChannel
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.KeyValueStore
import com.aglyn.site.media.mediaPreviewUrl
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * A PAIRED SCREEN, on the tablet (AGL-3608, AGL-3623, AGL-3651, AGL-3652): the
 * customer display a register turns toward its customer. The Apple app's
 * `PosDevice.swift`, line for line. The self-service kiosk shares the pairing,
 * the store's look and the device calls here.
 *
 * It works with NO staff sign-in on the tablet, so it holds nothing but a device
 * token, minted once by the register's six-digit code and good for one register.
 * Every call carries that token (never a staff session) to `commerce/pos-display`,
 * which answers 401 when the token is unknown or revoked, read here as "pair
 * again". The display reads its register's state by polling that route, and
 * everything the customer answers goes back through `respond`, where the server
 * checks it against the prompt it claims to answer, so a stale screen cannot
 * answer the next sale's question.
 */

/** The header a paired screen's token travels in. */
const val POS_DEVICE_TOKEN_HEADER = "X-Pos-Display-Token"

/** How often the display asks for news while a sale is on screen, and between sales. */
const val POS_DISPLAY_ACTIVE_POLL_MS = 1_000L
const val POS_DISPLAY_IDLE_POLL_MS = 3_000L

/** The store's name and logo are re-read this often, so an edit reaches the screen. */
const val POS_DEVICE_BRANDING_REFRESH_MS = 10L * 60 * 1000

/**
 * Where a store logo is shown from: the routes send the site's logo as a path on the console's media CDN (or a reference,
 * or an https address), read from [origin], the console the screen is paired with.
 */
fun posBrandingLogoUrl(value: String?, origin: String): String? =
  value?.ifEmpty { null }?.let { mediaPreviewUrl(it, origin, null, 640) }

/** The store's look for the idle and thank-you screens. */
data class PosDeviceBranding(val name: String, val logoUrl: String?, val logoDarkUrl: String?, val message: String) {
  companion object {
    /** The branding the display route sends, its logos served from [origin]. */
    fun read(element: JsonElement?, origin: String): PosDeviceBranding? {
      val record = element as? JsonObject ?: return null
      if (record.isEmpty()) return null
      return PosDeviceBranding(
        name = record["name"].str() ?: "Welcome",
        logoUrl = posBrandingLogoUrl(record["logoUrl"].str(), origin),
        logoDarkUrl = posBrandingLogoUrl(record["logoDarkUrl"].str(), origin),
        message = record["message"].str() ?: "Welcome",
      )
    }
  }
}

/** The display's state as the route hands it to the screen: the register's prompt, with the answer withheld. */
data class PosDisplayView(val state: PosDisplayState, val answered: Boolean)

/** What the customer sends back for the current prompt. */
data class PosDisplayAnswer(
  val promptId: String,
  val tipChoice: PosDisplayResponseTipChoice? = null,
  val tipPercent: Double? = null,
  val tipCents: Long? = null,
  val receiptChannel: PosReceiptChannel? = null,
  val email: String? = null,
  val phone: String? = null,
  val marketingOptIn: Boolean? = null,
) {
  fun toJson(): JsonObject = buildJsonObject {
    put("promptId", promptId)
    tipChoice?.let { put("tipChoice", it.raw) }
    tipPercent?.let { put("tipPercent", it) }
    tipCents?.let { put("tipCents", it) }
    receiptChannel?.let { put("receiptChannel", it.raw) }
    email?.let { put("email", it) }
    phone?.let { put("phone", it) }
    marketingOptIn?.let { put("marketingOptIn", it) }
  }
}

/** What pairing hands back. */
data class PosPaired(val token: String, val mode: PosDeviceMode, val branding: PosDeviceBranding?)

/** One poll's answer. */
data class PosDevicePoll(val view: PosDisplayView, val branding: PosDeviceBranding?)

/** The paired screen's half of the display route, with its device token. */
interface PosDeviceApi {
  suspend fun pair(code: String, mode: PosDeviceMode): PosPaired
  suspend fun poll(token: String, withBranding: Boolean): PosDevicePoll
  suspend fun respond(token: String, answer: PosDisplayAnswer)
  suspend fun forget(token: String)
}

class ConsolePosDeviceApi(private val api: ConsoleApiClient) : PosDeviceApi {
  override suspend fun pair(code: String, mode: PosDeviceMode): PosPaired {
    val answer = api.request(
      POS_DISPLAY_ROUTE,
      ApiMethod.POST,
      buildJsonObject {
        put("action", "pair")
        put("code", code)
        put("mode", mode.raw)
        put("label", if (mode == PosDeviceMode.KIOSK) "Self-service kiosk" else "Customer display")
      },
      anonymous = true,
    ).obj()
    val token = answer["token"].str() ?: throw ConsoleApiError("The register did not answer with a token.", 502, null)
    return PosPaired(token, if (answer["mode"].str() == "kiosk") PosDeviceMode.KIOSK else PosDeviceMode.DISPLAY, PosDeviceBranding.read(answer["branding"], api.origin))
  }

  override suspend fun poll(token: String, withBranding: Boolean): PosDevicePoll {
    val answer = api.request(
      POS_DISPLAY_ROUTE,
      ApiMethod.GET,
      query = mapOf("action" to "poll", "branding" to if (withBranding) "true" else null),
      anonymous = true,
      headers = mapOf(POS_DEVICE_TOKEN_HEADER to token),
    ).obj()
    val raw = answer["state"]
    val state = if (raw == null || raw is JsonNull) null else runCatching { ContractJsonFormat.decodeFromJsonElement(PosDisplayState.serializer(), raw) }.getOrNull()
    state ?: throw ConsoleApiError("The register did not answer with a screen.", 502, null)
    return PosDevicePoll(PosDisplayView(state, raw.obj()["answered"].bool()), PosDeviceBranding.read(answer["branding"], api.origin))
  }

  override suspend fun respond(token: String, answer: PosDisplayAnswer) {
    api.request(
      POS_DISPLAY_ROUTE,
      ApiMethod.POST,
      buildJsonObject {
        put("action", "respond")
        put("response", answer.toJson())
      },
      anonymous = true,
      headers = mapOf(POS_DEVICE_TOKEN_HEADER to token),
    )
  }

  override suspend fun forget(token: String) {
    api.request(POS_DISPLAY_ROUTE, ApiMethod.POST, buildJsonObject { put("action", "forget") }, anonymous = true, headers = mapOf(POS_DEVICE_TOKEN_HEADER to token))
  }
}

/** Where a paired screen keeps its one secret on the device. */
class PosDeviceTokenStore(private val store: KeyValueStore, mode: PosDeviceMode) {
  private val key = "commerce.pos.device.token.${mode.raw}"
  var token: String?
    get() = store.get(key)?.ifEmpty { null }
    set(value) = store.set(key, value)
}

/** What the display shows right now. */
sealed interface PosDisplayScreen {
  data object Idle : PosDisplayScreen
  data object Thanks : PosDisplayScreen
  data class Processing(val message: String, val totalCents: Long?) : PosDisplayScreen

  /** The customer answered; the cashier finishes up. */
  data object Answered : PosDisplayScreen
  data class Cart(val cart: PosDisplayCart) : PosDisplayScreen
  data class Tip(val tip: PosDisplayStateTip, val promptId: String) : PosDisplayScreen
  data class Receipt(val receipt: PosDisplayStateReceipt, val promptId: String) : PosDisplayScreen
}

class PosCustomerDisplayModel(
  private val api: PosDeviceApi,
  private val store: PosDeviceTokenStore,
  private val now: () -> Long = ::nowMs,
) {
  /** False while the stored token is being read, so a paired display never flashes the pairing screen. */
  var started by mutableStateOf(false)
    private set
  var token by mutableStateOf<String?>(null)
    private set
  var branding by mutableStateOf<PosDeviceBranding?>(null)
    private set
  var view by mutableStateOf<PosDisplayView?>(null)
    private set
  var offline by mutableStateOf(false)
    private set
  var busy by mutableStateOf(false)
    private set
  var notice by mutableStateOf<String?>(null)
    private set
  var pairError by mutableStateOf<String?>(null)
    private set
  var pairing by mutableStateOf(false)
    private set
  var sentPromptId by mutableStateOf<String?>(null)
    private set
  private var thanksKey = ""
  private var thanksShownAt = 0L
  private var brandingAt = 0L
  private var promptKey = ""

  /** Reads the stored token. */
  fun start() {
    token = store.token
    started = true
  }

  val currency: String? get() = view?.state?.currency

  suspend fun pair(code: String) {
    val digits = code.filter { it.isDigit() }
    if (digits.length != 6 || pairing) return
    pairing = true
    pairError = null
    try {
      val paired = api.pair(digits, PosDeviceMode.DISPLAY)
      store.token = paired.token
      token = paired.token
      branding = paired.branding
      brandingAt = now()
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      pairError = (failure as? ConsoleApiError)?.message ?: "That code is not valid. Show a new code on the register."
    } finally {
      pairing = false
    }
  }

  /** How long to wait before the next poll: quick while a sale is on screen, slower between sales. */
  val pollDelayMs: Long get() = if ((view?.state?.mode ?: PosDisplayMode.IDLE) == PosDisplayMode.IDLE) POS_DISPLAY_IDLE_POLL_MS else POS_DISPLAY_ACTIVE_POLL_MS

  /** One poll. A 401 unpairs; a lost answer keeps the screen and says it is reconnecting. */
  suspend fun poll() {
    val current = token ?: return
    val withBranding = now() - brandingAt > POS_DEVICE_BRANDING_REFRESH_MS
    try {
      val answer = api.poll(current, withBranding)
      offline = false
      view = answer.view
      answer.branding?.let {
        branding = it
        brandingAt = now()
      }
      noteMoves(answer.view.state)
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      if (failure is ConsoleApiError && failure.status == 401) unpaired() else offline = true
    }
  }

  /** A new prompt clears whatever this screen said about the last one; a new thank-you starts its clock. */
  private fun noteMoves(state: PosDisplayState) {
    val key = "${state.mode.raw}:${state.promptId.orEmpty()}"
    if (key != promptKey) {
      promptKey = key
      notice = null
    }
    if (state.mode == PosDisplayMode.THANKS) {
      val thanks = "${state.promptId.orEmpty()}:${state.updatedAtMs}"
      if (thanks != thanksKey) {
        thanksKey = thanks
        thanksShownAt = now()
      }
    } else {
      thanksKey = ""
    }
  }

  /** What to show: the thank-you returns to idle on its own after a few seconds, even if the next poll is late. */
  val screen: PosDisplayScreen
    get() {
      val current = view ?: return PosDisplayScreen.Idle
      val state = current.state
      return when (state.mode) {
        PosDisplayMode.THANKS -> if (now() - thanksShownAt > Contracts.posDisplayThanksMs) PosDisplayScreen.Idle else PosDisplayScreen.Thanks
        PosDisplayMode.PROCESSING -> PosDisplayScreen.Processing(
          state.processing?.message ?: "Tap, insert or swipe your card on the reader.",
          (state.cart?.dueCents ?: state.cart?.totalCents)?.toLong(),
        )
        PosDisplayMode.TIP, PosDisplayMode.RECEIPT -> {
          val promptId = state.promptId.orEmpty()
          when {
            current.answered || (promptId.isNotEmpty() && promptId == sentPromptId) -> PosDisplayScreen.Answered
            state.mode == PosDisplayMode.TIP && state.tip != null && promptId.isNotEmpty() -> PosDisplayScreen.Tip(state.tip!!, promptId)
            state.mode == PosDisplayMode.RECEIPT && state.receipt != null && promptId.isNotEmpty() -> PosDisplayScreen.Receipt(state.receipt!!, promptId)
            else -> state.cart?.let { PosDisplayScreen.Cart(it) } ?: PosDisplayScreen.Idle
          }
        }
        PosDisplayMode.CART -> state.cart?.let { PosDisplayScreen.Cart(it) } ?: PosDisplayScreen.Idle
        else -> PosDisplayScreen.Idle
      }
    }

  /** Sends the customer's answer. A 401 unpairs; a screen that moved on says so. */
  suspend fun answer(answer: PosDisplayAnswer) {
    val current = token ?: return
    if (busy) return
    busy = true
    notice = null
    try {
      api.respond(current, answer)
      sentPromptId = answer.promptId
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      val refusal = failure as? ConsoleApiError
      if (refusal?.status == 401) {
        unpaired()
      } else {
        notice = if (refusal?.status == 409) "That screen has moved on. Check the display." else refusal?.message ?: "Something went wrong. Try again."
      }
    } finally {
      busy = false
    }
  }

  /** Unpairs from the tablet: the route forgets the token (a display only), and the tablet asks for a code again. */
  suspend fun unpair() {
    token?.let { current ->
      try {
        api.forget(current)
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
      }
    }
    unpaired()
  }

  private fun unpaired() {
    store.token = null
    token = null
    view = null
    branding = null
    brandingAt = 0
    sentPromptId = null
    promptKey = ""
    offline = false
  }
}
