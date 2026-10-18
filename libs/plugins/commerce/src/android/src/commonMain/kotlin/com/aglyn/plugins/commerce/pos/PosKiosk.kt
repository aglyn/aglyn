package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ModifierSelection
import com.aglyn.contracts.PosDeviceMode
import com.aglyn.contracts.PosKioskCatalog
import com.aglyn.contracts.PosKioskContext
import com.aglyn.contracts.PosKioskContextBranding
import com.aglyn.contracts.PosKioskProduct
import com.aglyn.contracts.PosKioskSale
import com.aglyn.contracts.PosKioskSaleStatus
import com.aglyn.contracts.PosReceiptChannel
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.hardware.CardCollectOutcome
import com.aglyn.hardware.CardCollectRequest
import com.aglyn.hardware.CardCollector
import com.aglyn.hardware.CardCollectorState
import com.aglyn.hardware.CardReaderSession
import com.aglyn.hardware.CardReaderSessionSource
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.ceil

/*
 * THE SELF-SERVICE KIOSK (AGL-3623, AGL-3651, AGL-3652), on the tablet. The Apple
 * app's `PosKiosk.swift`, line for line.
 *
 * A register's second kind of paired screen: where the customer display mirrors
 * the cashier's basket, a kiosk lets the customer build their own order, tip,
 * and pay on the register's card reader or on this device's Tap to Pay, or send
 * it to the counter for a cashier. It pairs exactly like a display (the same
 * six-digit code and device token, with kiosk mode on both) and holds no staff
 * session: every call carries the device token to `commerce/pos-kiosk` and the
 * server prices everything.
 *
 * It holds one secret, the token. Everything the customer chooses or types lives
 * in memory only: the idle reset (and "Done", and "Start over") voids an unpaid
 * order and drops the basket, the tip and any email or phone, so the next
 * customer finds nothing of the last.
 */

const val POS_KIOSK_ROUTE = "/api/commerce/pos-kiosk"

/** How often the kiosk asks after a card payment in flight. */
const val POS_KIOSK_PAYMENT_POLL_MS = 1_500L

/** How the customer tips, as the kiosk sends it. */
sealed interface PosKioskTip {
  data object None : PosKioskTip
  data class Percent(val percent: Double) : PosKioskTip
  data class Custom(val cents: Long) : PosKioskTip

  fun fields(builder: JsonObjectBuilder) {
    when (this) {
      None -> builder.put("tipChoice", "none")
      is Percent -> {
        builder.put("tipChoice", "percent")
        builder.put("tipPercent", percent)
      }
      is Custom -> {
        builder.put("tipChoice", "custom")
        builder.put("tipCents", cents)
      }
    }
  }
}

/** How the customer pays by card. */
enum class PosKioskMethod(val raw: String) {
  /** The register's smart reader, driven through the server. */
  READER("reader"),

  /** This device's own Tap to Pay. */
  TAP("tap"),
}

/** A card payment the server started for this kiosk's order. */
data class PosKioskPayment(val sale: PosKioskSale, val paymentId: String?, val clientSecret: String?, val paymentIntentId: String?)

/** What staff may change behind the PIN. */
data class PosKioskSettingsView(val readers: List<Reader>, val readerId: String?, val label: String) {
  data class Reader(val id: String, val label: String, val status: String)
}

data class PosKioskUnlock(val unlock: String, val expiresAtMs: Double)

/** The kiosk's half of `commerce/pos-kiosk`, with the device token. */
interface PosKioskApi {
  suspend fun context(token: String): PosKioskContext
  suspend fun catalog(token: String, categoryId: String?): PosKioskCatalog
  suspend fun sale(token: String, orderId: String): PosKioskSale
  suspend fun checkout(token: String, lines: JsonElement, attemptKey: String): PosKioskSale
  suspend fun pay(token: String, orderId: String, method: PosKioskMethod, tip: PosKioskTip, attemptKey: String): PosKioskPayment
  suspend fun paymentStatus(token: String, orderId: String, paymentId: String): PosKioskSale
  suspend fun cancelPayment(token: String, orderId: String, paymentId: String): PosKioskSale
  suspend fun simulate(token: String, orderId: String, paymentId: String)
  suspend fun counter(token: String, orderId: String): PosKioskSale
  suspend fun receipt(token: String, orderId: String, channel: PosReceiptChannel, to: String?, marketingOptIn: Boolean)
  suspend fun abandon(token: String, orderId: String)
  suspend fun connectionToken(token: String): CardReaderSession
  suspend fun unlock(token: String, pin: String): PosKioskUnlock
  suspend fun settings(token: String, unlock: String): PosKioskSettingsView
  suspend fun setReader(token: String, unlock: String, readerId: String): PosKioskSettingsView
  suspend fun exit(token: String, unlock: String)
}

class ConsolePosKioskApi(private val api: ConsoleApiClient) : PosKioskApi {
  private suspend fun get(token: String, query: Map<String, Any?>): JsonElement? =
    api.request(POS_KIOSK_ROUTE, ApiMethod.GET, query = query, anonymous = true, headers = mapOf(POS_DEVICE_TOKEN_HEADER to token))

  private suspend fun post(token: String, key: String? = null, build: JsonObjectBuilder.() -> Unit): JsonElement? =
    api.request(POS_KIOSK_ROUTE, ApiMethod.POST, buildJsonObject(build), idempotencyKey = key, anonymous = true, headers = mapOf(POS_DEVICE_TOKEN_HEADER to token))

  private fun <T> decode(serializer: kotlinx.serialization.KSerializer<T>, value: JsonElement?, what: String): T =
    value?.let { runCatching { ContractJsonFormat.decodeFromJsonElement(serializer, it) }.getOrNull() }
      ?: throw ConsoleApiError("The kiosk did not answer with $what.", 502, null)

  private fun saleOf(answer: JsonElement?): PosKioskSale = decode(PosKioskSale.serializer(), answer.obj()["sale"], "an order")

  override suspend fun context(token: String): PosKioskContext =
    decode(PosKioskContext.serializer(), get(token, mapOf("action" to "context")), "its settings")

  override suspend fun catalog(token: String, categoryId: String?): PosKioskCatalog =
    decode(PosKioskCatalog.serializer(), get(token, mapOf("action" to "catalog", "categoryId" to categoryId)), "its menu")

  override suspend fun sale(token: String, orderId: String): PosKioskSale = saleOf(get(token, mapOf("action" to "sale", "orderId" to orderId)))

  override suspend fun checkout(token: String, lines: JsonElement, attemptKey: String): PosKioskSale =
    saleOf(post(token, attemptKey) { put("action", "checkout"); put("lines", lines) })

  override suspend fun pay(token: String, orderId: String, method: PosKioskMethod, tip: PosKioskTip, attemptKey: String): PosKioskPayment {
    val answer = post(token, attemptKey) {
      put("action", "pay")
      put("orderId", orderId)
      put("method", method.raw)
      tip.fields(this)
    }
    val record = answer.obj()
    return PosKioskPayment(saleOf(answer), record["paymentId"].str(), record["clientSecret"].str(), record["paymentIntentId"].str())
  }

  override suspend fun paymentStatus(token: String, orderId: String, paymentId: String): PosKioskSale =
    saleOf(post(token) { put("action", "payment-status"); put("orderId", orderId); put("paymentId", paymentId) })

  override suspend fun cancelPayment(token: String, orderId: String, paymentId: String): PosKioskSale =
    saleOf(post(token) { put("action", "cancel-payment"); put("orderId", orderId); put("paymentId", paymentId) })

  override suspend fun simulate(token: String, orderId: String, paymentId: String) {
    post(token) { put("action", "simulate"); put("orderId", orderId); put("paymentId", paymentId) }
  }

  override suspend fun counter(token: String, orderId: String): PosKioskSale = saleOf(post(token) { put("action", "counter"); put("orderId", orderId) })

  override suspend fun receipt(token: String, orderId: String, channel: PosReceiptChannel, to: String?, marketingOptIn: Boolean) {
    post(token) {
      put("action", "receipt")
      put("orderId", orderId)
      put("channel", channel.raw)
      to?.let { put("to", it) }
      if (marketingOptIn) put("marketingOptIn", true)
    }
  }

  override suspend fun abandon(token: String, orderId: String) {
    post(token) { put("action", "abandon"); put("orderId", orderId) }
  }

  override suspend fun connectionToken(token: String): CardReaderSession = readReaderSession(post(token) { put("action", "connection-token") })

  override suspend fun unlock(token: String, pin: String): PosKioskUnlock {
    val answer = post(token) { put("action", "unlock"); put("pin", pin) }.obj()
    val unlock = answer["unlock"].str() ?: throw ConsoleApiError("That PIN is not right.", 502, null)
    return PosKioskUnlock(unlock, answer["expiresAtMs"].num() ?: 0.0)
  }

  private fun settingsOf(answer: JsonElement?): PosKioskSettingsView {
    val record = answer.obj()
    return PosKioskSettingsView(
      readers = record["readers"].arr().mapNotNull { entry ->
        val fields = entry.obj()
        PosKioskSettingsView.Reader(fields["id"].str() ?: return@mapNotNull null, fields["label"].str() ?: "Card reader", fields["status"].str() ?: "offline")
      },
      readerId = record["readerId"].str(),
      label = record["label"].str() ?: "",
    )
  }

  override suspend fun settings(token: String, unlock: String): PosKioskSettingsView = settingsOf(post(token) { put("action", "settings"); put("unlock", unlock) })

  override suspend fun setReader(token: String, unlock: String, readerId: String): PosKioskSettingsView =
    settingsOf(post(token) { put("action", "set-reader"); put("unlock", unlock); put("readerId", readerId) })

  override suspend fun exit(token: String, unlock: String) {
    post(token) { put("action", "exit"); put("unlock", unlock) }
  }
}

/** A kiosk's own Terminal connection tokens, for Tap to Pay on this device. */
class KioskReaderSessions(private val api: PosKioskApi, private val token: String) : CardReaderSessionSource {
  override suspend fun session(hostId: String): CardReaderSession =
    try {
      api.connectionToken(token)
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      throw asSetupError(error)
    }
}

/** The kiosk's catalog product as the register's item machinery takes it, so the same rules price and check its choices. */
fun kioskItemOf(product: PosKioskProduct): PosItem {
  val variants = product.variants.map { variant ->
    PosVariant(
      id = variant.id,
      label = variant.options.entries.sortedBy { it.key }.map { it.value }.filter { it.isNotEmpty() }.joinToString(" / ").ifEmpty { null },
      unitCents = variant.priceCents,
      sku = null,
      barcode = null,
      inventory = if (variant.soldOut) 0 else null,
    )
  }
  val prices = variants.mapNotNull { it.unitCents }
  return PosItem(
    id = product.id,
    name = product.name,
    imageUrl = product.imageUrl,
    variants = variants,
    categoryIds = product.categoryIds,
    modifierGroups = usableModifierGroups(product.modifierGroups),
    quickKey = false,
    fromCents = prices.minOrNull(),
    toCents = prices.maxOrNull(),
  )
}

/** The lowest price a product sells at, for its tile. */
fun kioskFromCents(product: PosKioskProduct): Long = product.variants.minOfOrNull { it.priceCents } ?: 0

fun kioskProductSoldOut(product: PosKioskProduct): Boolean = product.variants.isNotEmpty() && product.variants.all { it.soldOut }

/** The kiosk's branding as its context carries it. */
/** The kiosk's branding as its context carries it, its logos served from [origin], the console the kiosk is paired with. */
fun PosKioskContextBranding.asDeviceBranding(origin: String): PosDeviceBranding =
  PosDeviceBranding(name, posBrandingLogoUrl(logoUrl, origin), posBrandingLogoUrl(logoDarkUrl, origin), message)

sealed interface PosKioskPhase {
  data object Start : PosKioskPhase
  data object Menu : PosKioskPhase
  data object Review : PosKioskPhase
  data class Tip(val method: PosKioskMethod) : PosKioskPhase
  data class Paying(val method: PosKioskMethod, val paymentId: String?, val chargeCents: Long, val failure: String?) : PosKioskPhase
  data object Receipt : PosKioskPhase
  data object Done : PosKioskPhase
}

class PosKioskModel(
  private val device: PosDeviceApi,
  private val api: PosKioskApi,
  private val store: PosDeviceTokenStore,
  private val collector: CardCollector? = null,
  private val now: () -> Long = ::nowMs,
  private val mintKey: () -> String = { newAttemptKey("kiosk") },
) {
  /** False while the stored token is being read, so a paired kiosk never flashes the pairing screen. */
  var started by mutableStateOf(false)
    private set
  var token by mutableStateOf<String?>(null)
    private set
  var context by mutableStateOf<PosKioskContext?>(null)
    private set
  var catalog by mutableStateOf<PosKioskCatalog?>(null)
    private set
  var catalogLoading by mutableStateOf(false)
    private set
  var categoryId by mutableStateOf<String?>(null)
  var phase by mutableStateOf<PosKioskPhase>(PosKioskPhase.Start)
    private set
  var cart by mutableStateOf(Cart.EMPTY)
    private set
  var sale by mutableStateOf<PosKioskSale?>(null)
    private set
  var tip by mutableStateOf<PosKioskTip>(PosKioskTip.None)
    private set
  var busy by mutableStateOf(false)
    private set
  var notice by mutableStateOf<String?>(null)
  var offline by mutableStateOf(false)
    private set
  var pairError by mutableStateOf<String?>(null)
    private set
  var pairing by mutableStateOf(false)
    private set

  /** Bumped by every reset: keys every screen, so inputs never carry over. */
  var turn by mutableStateOf(0)
    private set

  /** Seconds left on the "Still there?" countdown, or null. */
  var idleWarning by mutableStateOf<Int?>(null)
    private set
  var tapReady by mutableStateOf(false)
    private set

  /** One attempt per cart, and one per press of a payment button. */
  private var checkoutKey: String? = null
  private var payKey: String? = null
  private var lastTouch = now()
  private var doneAt = 0L

  val currency: String get() = context?.currency ?: catalog?.currency ?: "usd"
  fun money(cents: Long): String = money(cents, currency)

  // Pairing and settings.

  suspend fun start() {
    token = store.token
    started = true
    if (token != null) refresh()
  }

  suspend fun pair(code: String) {
    val digits = code.filter { it.isDigit() }
    if (digits.length != 6 || pairing) return
    pairing = true
    pairError = null
    try {
      val paired = device.pair(digits, PosDeviceMode.KIOSK)
      store.token = paired.token
      token = paired.token
      pairing = false
      refresh()
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      pairError = (failure as? ConsoleApiError)?.message ?: "That code is not valid. Show a new code on the register."
    } finally {
      pairing = false
    }
  }

  /** Leaves kiosk mode: the device is unpaired and asks for a code again. */
  fun unpaired() {
    store.token = null
    token = null
    context = null
    catalog = null
    sale = null
    cart = Cart.EMPTY
    tip = PosKioskTip.None
    phase = PosKioskPhase.Start
    offline = false
    checkoutKey = null
    payKey = null
    idleWarning = null
    tapReady = false
  }

  /** A refusal that says the kiosk is no longer paired ends the session. */
  private fun lost(error: Throwable): Boolean {
    if (error is ConsoleApiError) {
      if (error.status == 401) {
        unpaired()
        return true
      }
      offline = error.status == 0
    }
    return false
  }

  /** The kiosk's settings and menu: read when paired, and again every ten minutes while idle on the start screen. */
  suspend fun refresh() {
    val current = token ?: return
    try {
      context = api.context(current)
      offline = false
      prepareTap()
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      lost(failure)
    }
  }

  suspend fun loadCatalog() {
    val current = token ?: return
    catalogLoading = true
    try {
      catalog = api.catalog(current, categoryId)
      offline = false
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      lost(failure)
    } finally {
      catalogLoading = false
    }
  }

  /** Connects this device's own reader for Tap to Pay, with the kiosk's own connection token. */
  private suspend fun prepareTap() {
    val reader = collector
    val current = token
    if (reader == null || current == null || context?.payments?.cardPresent != true) {
      tapReady = false
      return
    }
    if (reader.state.value !is CardCollectorState.Connected) reader.connect("", KioskReaderSessions(api, current))
    tapReady = reader.state.value is CardCollectorState.Connected
  }

  // How the customer can pay.

  val canPayByReader: Boolean get() = context?.payments?.cardPresent == true && context?.payments?.reader == true
  val canPayByTap: Boolean get() = context?.payments?.cardPresent == true && tapReady
  val canPayAtCounter: Boolean get() = context?.payments?.payAtCounter == true

  // Idle.

  /** A touch: the customer is still there. */
  fun touch() {
    lastTouch = now()
    if (idleWarning != null) idleWarning = null
  }

  /**
   * One beat of the idle clock (once a second): a visible countdown, then the reset. Never while a card is being
   * collected or on the start screen.
   */
  suspend fun tick() {
    when (phase) {
      PosKioskPhase.Start, is PosKioskPhase.Paying -> {
        idleWarning = null
        return
      }
      else -> Unit
    }
    if (token == null) return
    val idleSeconds = (context?.idleSeconds ?: Contracts.posKioskIdleSecondsDefault).toDouble()
    val warning = Contracts.posKioskIdleWarningSeconds.toDouble()
    val idleFor = (now() - lastTouch) / 1000.0
    if (idleFor < idleSeconds) return
    val left = ceil(idleSeconds + warning - idleFor).toInt()
    if (left <= 0) {
      lastTouch = now()
      idleWarning = null
      reset()
    } else {
      idleWarning = left
    }
  }

  /** "Done": the order-number screen returns to the start on its own. */
  suspend fun tickDone() {
    if (phase == PosKioskPhase.Done && doneAt > 0 && now() - doneAt >= Contracts.posKioskDoneSeconds * 1000) reset()
  }

  private suspend fun quietly(block: suspend () -> Unit) {
    try {
      block()
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
    }
  }

  /** THE RESET: the unpaid order voided, every customer detail dropped from memory, and the screens remounted on the start screen. */
  suspend fun reset() {
    val current = token
    val open = sale
    if (current != null && open != null && open.status == PosKioskSaleStatus.OPEN) quietly { api.abandon(current, open.orderId) }
    sale = null
    cart = Cart.EMPTY
    tip = PosKioskTip.None
    notice = null
    categoryId = null
    checkoutKey = null
    payKey = null
    idleWarning = null
    doneAt = 0
    phase = PosKioskPhase.Start
    turn += 1
    lastTouch = now()
  }

  // The menu and the cart.

  fun startOrder() {
    phase = PosKioskPhase.Menu
    touch()
  }

  val cartCount: Int get() = cart.count
  val cartEstimateCents: Long get() = cart.subtotalCents

  /** Puts a choice in the cart: the same item with the same choices merges, up to what one kiosk order carries. */
  fun add(item: PosItem, variant: PosVariant, picks: List<ModifierSelection> = emptyList(), quantity: Int = 1): Boolean {
    if (variant.soldOut()) return false
    when (val result = pickOf(item, variant, picks)) {
      is PickResult.Problem -> {
        notice = result.message
        return false
      }
      is PickResult.Ok -> {
        val made = result.pick
        val most = Contracts.posKioskMaxQuantity.toInt()
        var next = cart.add(made, quantity)
        val key = cartLineKey(made.productId, made.variantId, made.modifiers)
        if (next.lines.firstOrNull { it.key == key }?.let { it.quantity > most } == true) next = next.setQuantity(key, most)
        if (next.lines.size > Contracts.posKioskMaxLines) return false
        cart = next
        checkoutKey = null
        touch()
        return true
      }
    }
  }

  fun setQuantity(key: String, quantity: Int) {
    cart = cart.setQuantity(key, minOf(quantity, Contracts.posKioskMaxQuantity.toInt()))
    checkoutKey = null
    touch()
  }

  // Checkout.

  /** Prices the cart on the server and moves to the review. */
  suspend fun checkout() {
    val current = token ?: return
    if (busy || cart.isEmpty) return
    val attempt = checkoutKey ?: mintKey().also { checkoutKey = it }
    busy = true
    notice = null
    try {
      sale = api.checkout(current, cart.saleLines(), attempt)
      offline = false
      phase = PosKioskPhase.Review
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      if (lost(failure)) return
      // A refused cart is changed before it is tried again.
      checkoutKey = null
      notice = (failure as? ConsoleApiError)?.message ?: "Your order could not be priced. Try again."
    } finally {
      busy = false
    }
  }

  /** The tip screen's Back: the priced order again. */
  fun backToReview() {
    phase = PosKioskPhase.Review
  }

  /** The staff unlock's calls, with this kiosk's token. */
  val staffApi: PosKioskApi get() = api

  suspend fun backToMenu() {
    val current = token
    val open = sale
    if (current != null && open != null && open.status == PosKioskSaleStatus.OPEN) quietly { api.abandon(current, open.orderId) }
    sale = null
    checkoutKey = null
    notice = null
    phase = PosKioskPhase.Menu
  }

  suspend fun sendToCounter() {
    val current = token ?: return
    val open = sale ?: return
    busy = true
    try {
      sale = api.counter(current, open.orderId)
      cart = Cart.EMPTY
      finishToDone()
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      if (lost(failure)) return
      notice = (failure as? ConsoleApiError)?.message ?: "Your order could not be sent to the counter."
    } finally {
      busy = false
    }
  }

  private fun finishToDone() {
    phase = PosKioskPhase.Done
    doneAt = now()
  }

  // Paying.

  /** The customer chose how to pay: a tip first when the store asks for one. */
  suspend fun choosePay(method: PosKioskMethod) {
    if (context?.tipping?.enabled == true) {
      phase = PosKioskPhase.Tip(method)
    } else {
      tip = PosKioskTip.None
      startPayment(method, PosKioskTip.None)
    }
  }

  suspend fun startPayment(method: PosKioskMethod, answer: PosKioskTip) {
    val current = token ?: return
    val open = sale ?: return
    val attempt = payKey ?: mintKey().also { payKey = it }
    busy = true
    notice = null
    val started = try {
      api.pay(current, open.orderId, method, answer, attempt)
    } catch (failure: Throwable) {
      busy = false
      if (failure is CancellationException) throw failure
      if (lost(failure)) return
      payKey = null
      notice = (failure as? ConsoleApiError)?.message ?: "The card payment could not be started."
      phase = PosKioskPhase.Review
      return
    }
    sale = started.sale
    val charge = open.dueCents + kioskTipCents(answer, open.dueCents)
    phase = PosKioskPhase.Paying(method, started.paymentId, charge, null)
    busy = false
    if (method != PosKioskMethod.TAP) return
    val reader = collector
    val secret = started.clientSecret
    val intent = started.paymentIntentId
    if (reader == null || secret == null || intent == null) {
      phase = PosKioskPhase.Paying(method, started.paymentId, charge, "Tap to Pay is not available on this device.")
      return
    }
    when (val outcome = reader.collect(CardCollectRequest(intent, secret, charge))) {
      is CardCollectOutcome.Collected -> Unit
      is CardCollectOutcome.Canceled -> phase = PosKioskPhase.Paying(method, started.paymentId, charge, "The payment was canceled.")
      is CardCollectOutcome.Failed -> phase = PosKioskPhase.Paying(method, started.paymentId, charge, outcome.message.ifEmpty { "The card was not read." })
    }
  }

  /** What the tip comes to, recomputed from the store's own rules (`posKioskTipCents`). */
  fun kioskTipCents(answer: PosKioskTip, base: Long): Long =
    when (answer) {
      PosKioskTip.None -> 0
      is PosKioskTip.Percent -> posTipFromPercent(base, answer.percent)
      is PosKioskTip.Custom -> answer.cents
    }

  /** Asks after the card in flight until it is paid or it fails; the view calls this every [POS_KIOSK_PAYMENT_POLL_MS]. */
  suspend fun pollPayment() {
    val current = token ?: return
    val open = sale ?: return
    val paying = phase as? PosKioskPhase.Paying ?: return
    val paymentId = paying.paymentId ?: return
    if (paying.failure != null) return
    val next = try {
      api.paymentStatus(current, open.orderId, paymentId)
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      return
    }
    sale = next
    if (next.status == PosKioskSaleStatus.PAID) {
      cart = Cart.EMPTY
      payKey = null
      phase = PosKioskPhase.Receipt
      return
    }
    val payment = next.payment
    if (payment != null && payment.id == paymentId && (payment.status == "failed" || payment.status == "canceled")) {
      payKey = null
      phase = paying.copy(failure = payment.failureMessage ?: "The card was declined.")
    }
  }

  suspend fun cancelPayment() {
    val current = token ?: return
    val open = sale ?: return
    val paying = phase as? PosKioskPhase.Paying ?: return
    busy = true
    try {
      val paymentId = paying.paymentId
      if (paymentId != null && paying.failure == null) quietly { api.cancelPayment(current, open.orderId, paymentId) }
      val fresh = try {
        api.sale(current, open.orderId)
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        null
      }
      collector?.cancel()
      payKey = null
      if (fresh != null) sale = fresh
      phase = if (fresh?.status == PosKioskSaleStatus.PAID) PosKioskPhase.Receipt else PosKioskPhase.Review
    } finally {
      busy = false
    }
  }

  /** Test mode: taps a test card on the register's reader. */
  suspend fun simulate() {
    val current = token ?: return
    val open = sale ?: return
    val paymentId = (phase as? PosKioskPhase.Paying)?.paymentId ?: return
    quietly { api.simulate(current, open.orderId, paymentId) }
  }

  suspend fun retryPayment() {
    val paying = phase as? PosKioskPhase.Paying ?: return
    startPayment(paying.method, tip)
  }

  /** A tip chosen on the tip screen: remembered for a retry, then the payment starts. */
  suspend fun tipChosen(method: PosKioskMethod, answer: PosKioskTip) {
    tip = answer
    startPayment(method, answer)
  }

  // The receipt.

  suspend fun answerReceipt(channel: PosReceiptChannel, to: String?, marketingOptIn: Boolean) {
    val current = token ?: return
    val paid = sale ?: return
    busy = true
    try {
      api.receipt(current, paid.orderId, channel, to, marketingOptIn)
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      if (lost(failure)) return
      notice = (failure as? ConsoleApiError)?.message ?: "Your receipt could not be sent. Ask at the counter."
    } finally {
      busy = false
    }
    finishToDone()
  }
}

/** The staff unlock's state. */
class PosKioskStaffModel(private val now: () -> Long = ::nowMs) {
  enum class Stage { CLOSED, PIN, SETTINGS }

  var stage by mutableStateOf(Stage.CLOSED)
    private set
  var pin by mutableStateOf("")
  var unlock by mutableStateOf<PosKioskUnlock?>(null)
    private set
  var view by mutableStateOf<PosKioskSettingsView?>(null)
    private set
  var error by mutableStateOf<String?>(null)
    private set
  var busy by mutableStateOf(false)
    private set
  var confirmExit by mutableStateOf(false)

  fun open() {
    stage = Stage.PIN
  }

  fun close() {
    if (busy) return
    stage = Stage.CLOSED
    pin = ""
    unlock = null
    view = null
    error = null
    confirmExit = false
  }

  /** Milliseconds until the unlock lapses on its own (zero when none is open). */
  fun lapsesInMs(): Long = unlock?.let { maxOf(0L, (it.expiresAtMs - now()).toLong()) } ?: 0

  /** A right PIN opens the settings. True when the kiosk turned out to be unpaired already (leave). */
  suspend fun submit(model: PosKioskModel): Boolean {
    val current = model.token ?: return false
    if (busy || pin.length < 4) return false
    busy = true
    error = null
    val entered = pin
    pin = ""
    try {
      val opened = model.staffApi.unlock(current, entered)
      unlock = opened
      view = try {
        model.staffApi.settings(current, opened.unlock)
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        null
      }
      stage = Stage.SETTINGS
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      if (failure is ConsoleApiError) {
        if (failure.status == 401 && failure.message.lowercase().contains("not paired")) return true
        error = failure.message
      } else {
        error = "That PIN is not right."
      }
    } finally {
      busy = false
    }
    return false
  }

  suspend fun chooseReader(model: PosKioskModel, readerId: String) {
    val opened = unlock ?: return
    val current = model.token ?: return
    if (busy) return
    busy = true
    try {
      view = model.staffApi.setReader(current, opened.unlock, readerId)
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      error = (failure as? ConsoleApiError)?.message ?: "The card reader could not be changed."
    } finally {
      busy = false
    }
  }

  /** Leaves kiosk mode. True when the kiosk was unpaired. */
  suspend fun exit(model: PosKioskModel): Boolean {
    val opened = unlock ?: return false
    val current = model.token ?: return false
    if (busy) return false
    busy = true
    return try {
      model.staffApi.exit(current, opened.unlock)
      true
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      error = (failure as? ConsoleApiError)?.message ?: "Kiosk mode could not be turned off."
      false
    } finally {
      busy = false
    }
  }
}
