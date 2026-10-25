package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.OrderTotals
import com.aglyn.contracts.PosOfflineFlag
import com.aglyn.contracts.PosOfflineKit
import com.aglyn.contracts.PosOfflineOutcomeStatus
import com.aglyn.contracts.PosOfflineRefusal
import com.aglyn.contracts.PosOfflineCardForward
import com.aglyn.contracts.PosOfflineSale
import com.aglyn.contracts.PosOfflineSaleCard
import com.aglyn.contracts.PosOfflineSaleCustomer
import com.aglyn.contracts.PosOfflineSaleLine
import com.aglyn.contracts.PosOfflineSaleOutcome
import com.aglyn.contracts.PosOfflineStockConflict
import com.aglyn.contracts.PosOfflineTender
import com.aglyn.contracts.PosOfflineTotalsLine
import com.aglyn.contracts.posOfflineCardIntentMetadata
import com.aglyn.contracts.posOfflineCardRefusal
import com.aglyn.contracts.posOfflineChangeCents
import com.aglyn.contracts.posOfflineSaleTotals
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.KeyValueStore
import com.aglyn.core.localDayAndTime
import com.aglyn.hardware.OfflineCardForward
import com.aglyn.hardware.OfflineCardRequest
import com.aglyn.hardware.OfflineCardTaken
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/*
 * THE REGISTER, OFFLINE (AGL-3625, AGL-3651, AGL-3652): the console register's
 * offline mode, on the device. The Apple app's `PosOffline.swift`, line for line.
 *
 * WHAT SELLS OFFLINE IS CASH, AND A CARD ON THIS DEVICE'S OWN READER (AGL-4039).
 * Stripe's SDK stores the card on the device and sends it once a connection
 * returns; the sale waits here until it has, then syncs and the server
 * captures it. A gift card's balance and a room charge's stay can only be
 * checked by the server, and a promotion code's cap is counted there. The
 * cashier's own discount, bounded by the site's ceiling, does sell.
 *
 * WHAT IT KEEPS, for ONE signed-in member at ONE site: the KIT (the server's
 * offline rules: the store's in-person tax, the discount ceiling, the shift rule,
 * the registers) refreshed while online, and the QUEUE of cash sales rung
 * offline until the server has recorded them. The basket's prices are the
 * catalog's as the grid priced them; a sale carries its customer only when the
 * cashier attached one.
 *
 * HOW IT SYNCS: when the connection returns and after every offline sale, in
 * batches of `POS_OFFLINE_SYNC_BATCH_MAX`, one sync at a time, through
 * `commerce/pos-offline-sync`. A sale leaves the device only when the server has
 * answered for it, recorded or a replay of a recording, so a connection that
 * drops mid-request leaves it queued and sending it again is safe: the server
 * lands a sale key once. A transient failure stays queued; every other refusal
 * waits for the cashier, still on the device, with the server's sentence.
 */

const val POS_OFFLINE_SYNC_ROUTE = "/api/commerce/pos-offline-sync"

/** How often the kit is refreshed while online. */
const val POS_OFFLINE_KIT_REFRESH_MS = 10L * 60 * 1000

/** One sale waiting on the device, with where it stands. */
@Serializable
data class PosOfflineQueued(
  val sale: PosOfflineSale,
  /** `queued` waits for the connection; `refused` waits for the cashier. */
  val state: State = State.QUEUED,
  val queuedAtMs: Long,
  val attempts: Int = 0,
  val error: String? = null,
  val reason: PosOfflineRefusal? = null,
) {
  @Serializable
  enum class State { QUEUED, REFUSED }

  val id: String get() = sale.saleKey
  val totalCents: Long get() = (sale.totals.totalCents ?: 0.0).toLong()

  /** Paid by a card on this device's reader (AGL-4039). */
  val isCard: Boolean get() = sale.tender == PosOfflineTender.CARD

  /** A card still on the device: Stripe has not been sent it yet, so it cannot sync. */
  val cardOnDevice: Boolean get() = isCard && sale.card?.forward == PosOfflineCardForward.STORED
}

/** A sale the server answered for with something to check. */
data class PosOfflineSyncNotice(
  val saleKey: String,
  val orderId: String,
  val number: Long?,
  val flags: List<PosOfflineFlag>,
  val stockConflicts: List<PosOfflineStockConflict>,
  /** The card and the money of a sale paid by card, for a declined card's own notice. */
  val card: PosOfflineSaleCard? = null,
  val totalCents: Long = 0,
  val soldAtMs: Double = 0.0,
) {
  /** A card taken offline that the bank declined, or that Stripe never took: the order is unpaid. */
  val cardUnpaid: Boolean get() = PosOfflineFlag.CARD_DECLINED in flags || PosOfflineFlag.CARD_NOT_CHARGED in flags

  /** What to check, in the words the console shows. */
  val lines: List<String>
    get() = stockConflicts.map { "${it.shortUnits.toLong()} of ${it.requested.toLong()}× ${it.name} not in stock" } +
      flags.filter { it != PosOfflineFlag.STOCK_SHORT && !(cardUnpaid && (it == PosOfflineFlag.CARD_DECLINED || it == PosOfflineFlag.CARD_NOT_CHARGED)) }
        .map { Contracts.posOfflineFlagLabels[it.raw] ?: it.raw }
}

/** A cash sale the register just rang offline, for its receipt step. */
data class PosOfflineRung(val sale: PosOfflineSale) {
  val changeCents: Long get() = sale.changeCents.toLong()
  val totalCents: Long get() = (sale.totals.totalCents ?: 0.0).toLong()
  val hasCustomerEmail: Boolean get() = !sale.customer?.email.isNullOrEmpty()

  /** The card, for a sale paid by card on this device's reader. */
  val card: PosOfflineSaleCard? get() = if (sale.tender == PosOfflineTender.CARD) sale.card else null
}

/** The two offline calls, as the signed-in member. */
interface PosOfflineApi {
  suspend fun kit(): PosOfflineKit

  /** Sends one batch; an empty batch only asks whether the route answers. */
  suspend fun sync(sales: List<PosOfflineSale>): List<PosOfflineSaleOutcome>
}

class ConsolePosOfflineApi(private val api: ConsoleApiClient, private val hostId: String) : PosOfflineApi {
  override suspend fun kit(): PosOfflineKit {
    val answer = api.request(POS_OFFLINE_SYNC_ROUTE, ApiMethod.GET, query = mapOf("hostId" to hostId)).obj()
    return runCatching { ContractJsonFormat.decodeFromJsonElement(PosOfflineKit.serializer(), answer["kit"] as JsonElement) }.getOrNull()
      ?: throw ConsoleApiError("The register did not answer with its offline rules.", 502, null)
  }

  override suspend fun sync(sales: List<PosOfflineSale>): List<PosOfflineSaleOutcome> {
    val body = buildJsonObject {
      put("hostId", hostId)
      put("sales", ContractJsonFormat.encodeToJsonElement(ListSerializer(PosOfflineSale.serializer()), sales))
    }
    val answer = api.request(POS_OFFLINE_SYNC_ROUTE, ApiMethod.POST, body).obj()
    return (answer["results"] as? JsonArray ?: JsonArray(emptyList())).mapNotNull {
      runCatching { ContractJsonFormat.decodeFromJsonElement(PosOfflineSaleOutcome.serializer(), it) }.getOrNull()
    }
  }
}

/** The offline calls where there is no console to ask: every call finds it unreachable. */
object UnreachablePosOffline : PosOfflineApi {
  private fun unreachable(): Nothing = throw ConsoleApiError("The register is offline. Check the connection and try again.", 0, null)
  override suspend fun kit(): PosOfflineKit = unreachable()
  override suspend fun sync(sales: List<PosOfflineSale>): List<PosOfflineSaleOutcome> = unreachable()
}

/** What the register keeps on the device for one member at one site. */
class PosOfflineDeviceStore(private val store: KeyValueStore, scope: String) {
  // `uid:hostId`: another member on the same device, or the same member at another site, never reads these.
  private val kitKey = "commerce.pos.offline.kit.$scope"
  private val queueKey = "commerce.pos.offline.queue.$scope"

  fun loadKit(): PosOfflineKit? =
    runCatching { ContractJsonFormat.decodeFromString(PosOfflineKit.serializer(), store.get(kitKey) ?: return null) }.getOrNull()

  fun saveKit(kit: PosOfflineKit) = store.set(kitKey, ContractJsonFormat.encodeToString(PosOfflineKit.serializer(), kit))

  /** Every sale this member queued at this site, oldest first. */
  fun queue(): List<PosOfflineQueued> =
    runCatching { ContractJsonFormat.decodeFromString(ListSerializer(PosOfflineQueued.serializer()), store.get(queueKey) ?: return emptyList()) }
      .getOrDefault(emptyList())
      .sortedWith(compareBy({ it.sale.soldAtMs }, { it.queuedAtMs }))

  /** Keeps [entry] (replacing the same sale key). False when the device did not hold it. */
  fun put(entry: PosOfflineQueued): Boolean {
    val list = queue().filter { it.id != entry.id } + entry
    store.set(queueKey, ContractJsonFormat.encodeToString(ListSerializer(PosOfflineQueued.serializer()), list))
    return queue().any { it.id == entry.id }
  }

  /** Every card this DEVICE took offline on [day] (any member, any site): what the daily limit per device counts (AGL-4039). */
  fun cardsTaken(day: String): Long {
    val parts = store.get(CARDS_TODAY_KEY).orEmpty().split('|')
    return if (parts.size == 2 && parts[0] == day) parts[1].toLongOrNull() ?: 0 else 0
  }

  fun addCardTaken(cents: Long, day: String) = store.set(CARDS_TODAY_KEY, "$day|${cardsTaken(day) + maxOf(0, cents)}")

  fun remove(saleKey: String) {
    val list = queue().filter { it.id != saleKey }
    store.set(queueKey, if (list.isEmpty()) null else ContractJsonFormat.encodeToString(ListSerializer(PosOfflineQueued.serializer()), list))
  }
}

private const val CARDS_TODAY_KEY = "commerce.pos.offline.cardsToday"

/** A key for one offline sale: the order's id once it syncs. Leading letters keep it from ever reading as an order number. */
@OptIn(ExperimentalUuidApi::class)
fun newPosOfflineSaleKey(): String = "off${Uuid.random().toString().replace("-", "")}".take(40)

class PosOfflineModel(
  private val api: PosOfflineApi,
  private val store: PosOfflineDeviceStore,
  private val uid: String,
  private val scope: CoroutineScope,
  private val registerId: () -> String?,
  private val locationId: () -> String?,
  private val shiftId: () -> String?,
  private val assertion: () -> String?,
  private val now: () -> Long = ::nowMs,
  private val mintKey: () -> String = ::newPosOfflineSaleKey,
  /** The device's own calendar day, `yyyy-MM-dd`: the daily limit per device resets with it. */
  private val today: () -> String = { localDayAndTime(now()).first },
) {
  var kit by mutableStateOf(store.loadKit())
    private set

  /** Sales on this device that have not synced, oldest first. */
  var queue by mutableStateOf(store.queue())
    private set
  var syncing by mutableStateOf(false)
    private set

  /** Why the last sync could not run, when the server refused it outright. */
  var syncError by mutableStateOf<String?>(null)
    private set

  /** Synced sales the server flagged, until the cashier dismisses them. */
  var notices by mutableStateOf<List<PosOfflineSyncNotice>>(emptyList())
    private set
  private var kitSavedAtMs = 0L
  private var syncInFlight = false

  /** Told when a sync failed at the network (true) or the console answered it (false). */
  var networkSink: ((Boolean) -> Unit)? = null

  val waiting: List<PosOfflineQueued> get() = queue.filter { it.state == PosOfflineQueued.State.QUEUED }
  val refused: List<PosOfflineQueued> get() = queue.filter { it.state == PosOfflineQueued.State.REFUSED }
  val waitingCents: Long get() = waiting.sumOf { it.totalCents }

  /** Cards waiting to be charged, and their total (AGL-4039). */
  val waitingCards: List<PosOfflineQueued> get() = waiting.filter { it.isCard }
  val waitingCardCents: Long get() = waitingCards.sumOf { it.totalCents }

  /** Every card this device took offline today: what the daily limit per device counts. */
  val cardsTakenTodayCents: Long get() = store.cardsTaken(today())

  /** When the oldest card still on the device was taken; null when none waits for Stripe. */
  val oldestCardOnDeviceMs: Double? get() = queue.filter { it.cardOnDevice }.minOfOrNull { it.sale.soldAtMs }

  /** Cards have waited on the device past the time Stripe recommends reconnecting within. */
  val cardsWaitedTooLong: Boolean
    get() = oldestCardOnDeviceMs?.let { now() - it > Contracts.posOfflineCardReconnectWithinMs } ?: false

  /** The shift open on the register as last seen: the live one, else the kit's. */
  private fun lastKnownShift(): String? {
    shiftId()?.takeIf { it.isNotEmpty() }?.let { return it }
    val current = kit ?: return null
    val register = registerId() ?: return null
    return current.registers.firstOrNull { it.id == register }?.openShiftId?.takeIf { it.isNotEmpty() }
  }

  /** Why this device cannot sell offline, in the cashier's words; null when it can. */
  val unavailableReason: String?
    get() {
      val current = kit ?: return "Connect once so the register can get ready to sell offline."
      if (!current.available) return current.unavailableReason ?: "Offline selling is unavailable for this site."
      if (current.requireOpenShift && lastKnownShift() == null) return "Open a shift before going offline: this site requires one for every sale."
      return null
    }

  val ready: Boolean get() = unavailableReason == null

  /** The kit is stale or missing: refresh it when online. */
  val kitIsStale: Boolean get() = kit == null || now() - kitSavedAtMs > POS_OFFLINE_KIT_REFRESH_MS

  /** The totals the basket rings offline, or null when it cannot. */
  fun totals(cart: Cart): OrderTotals? {
    val current = kit ?: return null
    if (!current.available || cart.isEmpty) return null
    return posOfflineSaleTotals(
      cart.lines.map { PosOfflineTotalsLine(it.unitCents.toDouble(), it.quantity.toDouble()) },
      cart.discountPct.toDouble(),
      current.tax.pct,
      current.tax.pricesIncludeTax,
    )
  }

  /** The discount is above this site's ceiling. */
  fun discountOverLimit(cart: Cart): Boolean = kit?.let { cart.discountPct.toDouble() > it.maxDiscountPct } ?: false

  /** Why this basket cannot be paid by card offline, in the cashier's words; null when it can (AGL-4039). */
  fun cardRefusal(cart: Cart): String? {
    unavailableReason?.let { return it }
    val totals = totals(cart) ?: return "This basket cannot be rung offline."
    if (discountOverLimit(cart)) return "This register may discount up to ${(kit?.maxDiscountPct ?: 0.0).toLong()}%."
    return posOfflineCardRefusal(kit?.card, totals.totalCents ?: 0.0, cardsTakenTodayCents.toDouble())
  }

  /** The card to take for this basket, under a key minted for the sale; null when it cannot be taken. */
  fun cardRequest(cart: Cart): OfflineCardRequest? {
    if (cardRefusal(cart) != null) return null
    val current = kit ?: return null
    val card = current.card ?: return null
    val register = registerId() ?: return null
    val totals = totals(cart) ?: return null
    val key = mintKey()
    return OfflineCardRequest(
      key, (totals.totalCents ?: 0.0).toLong(), card.currency, card.destination,
      posOfflineCardIntentMetadata(key, current.hostId, current.orgId, register),
      maxSaleCents = minOf(card.maxSaleCents.toLong(), Contracts.posOfflineCardMaxSaleCentsLimit),
      // 0 is no daily limit: the store did not set one.
      maxDeviceDailyCents = if (card.maxDeviceDailyCents > 0) card.maxDeviceDailyCents.toLong() else Long.MAX_VALUE,
      takenTodayCents = cardsTakenTodayCents,
    )
  }

  /** Reads the site's offline rules while online. */
  suspend fun refreshKit() {
    try {
      val fresh = api.kit()
      kit = fresh
      kitSavedAtMs = now()
      store.saveKit(fresh)
    } catch (failure: Throwable) {
      // The kit stays as it was; whether the console answers is the register's own beat to judge.
      if (failure is CancellationException) throw failure
    }
  }

  /** Queues one cash sale; null (and nothing taken) when it cannot be kept. */
  fun ringCashSale(cart: Cart, tenderedCents: Long): PosOfflineRung? {
    val totals = totals(cart) ?: return null
    val total = totals.totalCents ?: 0.0
    if (tenderedCents.toDouble() < total) return null
    return ring(cart, mintKey(), tenderedCents.toDouble(), posOfflineChangeCents(total, tenderedCents.toDouble()).toDouble(), null)
  }

  /**
   * Queues one sale whose card this device's reader took (AGL-4039). The card
   * is already on the device (or with Stripe), so this keeps the sale even
   * past the ceilings: the money was taken.
   */
  fun ringCardSale(cart: Cart, taken: OfflineCardTaken): PosOfflineRung? {
    val card = PosOfflineSaleCard(
      brand = taken.brand,
      forward = if (taken.paymentIntentId == null) PosOfflineCardForward.STORED else PosOfflineCardForward.FORWARDED,
      last4 = taken.last4,
      paymentIntentId = taken.paymentIntentId,
    )
    return ring(cart, taken.saleKey, 0.0, 0.0, card)?.also { store.addCardTaken(it.totalCents, today()) }
  }

  private fun ring(cart: Cart, saleKey: String, cashTenderedCents: Double, changeCents: Double, card: PosOfflineSaleCard?): PosOfflineRung? {
    val current = kit ?: return null
    val register = registerId() ?: return null
    if (!current.available || cart.isEmpty || uid.isEmpty() || (card == null && discountOverLimit(cart))) return null
    val totals = totals(cart) ?: return null
    val sold = now()
    val lines = cart.lines.map { line ->
      PosOfflineSaleLine(
        modifiers = line.modifiers.ifEmpty { null },
        name = line.name,
        productId = line.productId,
        quantity = line.quantity.toDouble(),
        unitAmountCents = line.unitCents.toDouble(),
        variantId = line.variantId,
        variantLabel = line.variantLabel,
      )
    }
    val customer = cart.customer?.let { attached ->
      val named = attached.kind != "none" && attached.id.isNotEmpty()
      PosOfflineSaleCustomer(
        email = attached.email,
        id = if (named) attached.id else null,
        kind = if (named) attached.kind else null,
        name = attached.name.ifEmpty { null },
      ).takeUnless { it.email == null && it.name == null && it.id == null }
    }
    val sale = PosOfflineSale(
      card = card,
      cashierAssertion = assertion(),
      cashTenderedCents = cashTenderedCents,
      changeCents = changeCents,
      customer = customer,
      discountPct = cart.discountPct.toDouble(),
      hostId = current.hostId,
      lines = lines,
      locationId = locationId(),
      orgId = current.orgId,
      registerId = register,
      saleKey = saleKey,
      shiftId = lastKnownShift(),
      signedInUid = uid,
      soldAtMs = sold.toDouble(),
      tender = if (card == null) null else PosOfflineTender.CARD,
      totals = totals,
      v = 1,
    )
    // The sale is real only once the device holds it: a write that fails answers null, before any cash is taken.
    if (!store.put(PosOfflineQueued(sale = sale, queuedAtMs = sold))) return null
    queue = store.queue()
    return PosOfflineRung(sale)
  }

  fun dismissNotices() {
    notices = emptyList()
  }

  /** Dismisses one notice (a declined card's, which stands on its own). */
  fun dismissNotice(saleKey: String) {
    notices = notices.filter { it.saleKey != saleKey }
  }

  /**
   * Applies what the reader's SDK said about cards it sent to Stripe, and
   * answers the sale keys it applied (the ledger then forgets them). A
   * forward for a sale another member or site queued is left for them.
   */
  fun applyForwards(forwards: List<OfflineCardForward>): Set<String> {
    val applied = mutableSetOf<String>()
    for (forward in forwards) {
      val entry = store.queue().firstOrNull { it.id == forward.saleKey }?.takeIf { it.isCard } ?: continue
      val card = entry.sale.card ?: continue
      val next = card.copy(
        forward = when (forward.status) {
          OfflineCardForward.Status.AUTHORIZED -> PosOfflineCardForward.FORWARDED
          OfflineCardForward.Status.DECLINED -> PosOfflineCardForward.DECLINED
          OfflineCardForward.Status.FAILED -> PosOfflineCardForward.FAILED
        },
        paymentIntentId = forward.paymentIntentId ?: card.paymentIntentId,
        declineMessage = forward.message?.take(300) ?: card.declineMessage,
        brand = card.brand ?: forward.brand,
        last4 = card.last4 ?: forward.last4,
      )
      if (store.put(entry.copy(sale = entry.sale.copy(card = next)))) applied += forward.saleKey
    }
    if (applied.isNotEmpty()) queue = store.queue()
    return applied
  }

  /** Removes a refused sale the server will never take, after the cashier confirms. */
  fun discard(saleKey: String) {
    store.remove(saleKey)
    queue = store.queue()
  }

  /** Sends everything waiting, in batches, one sync at a time. */
  fun syncInBackground(launchIn: CoroutineScope = scope) {
    launchIn.launch { sync() }
  }

  suspend fun sync() {
    if (syncInFlight) return
    // A card still on the device waits for its forward: the server reads Stripe, and Stripe has not got it yet.
    val mine = store.queue().filter { it.state == PosOfflineQueued.State.QUEUED && it.sale.signedInUid == uid && !it.cardOnDevice }
    if (mine.isEmpty()) return
    syncInFlight = true
    syncing = true
    val flagged = mutableListOf<PosOfflineSyncNotice>()
    try {
      for (batch in mine.chunked(Contracts.posOfflineSyncBatchMax.toInt())) {
        val results = try {
          api.sync(batch.map { it.sale })
        } catch (failure: Throwable) {
          if (failure is CancellationException) throw failure
          if (failure is ConsoleApiError && failure.status == 0) networkSink?.invoke(true) else if (failure is ConsoleApiError) syncError = failure.message
          break
        }
        syncError = null
        networkSink?.invoke(false)
        val byKey = batch.associateBy { it.id }
        for (result in results) {
          val entry = byKey[result.saleKey] ?: continue
          if (result.status == PosOfflineOutcomeStatus.RECORDED || result.status == PosOfflineOutcomeStatus.REPLAYED) {
            store.remove(entry.id)
            if (!result.flags.isNullOrEmpty()) {
              flagged += PosOfflineSyncNotice(
                result.saleKey, result.orderId ?: result.saleKey, result.number?.toLong(), result.flags.orEmpty(), result.stockConflicts.orEmpty(),
                card = if (entry.isCard) entry.sale.card else null, totalCents = entry.totalCents, soldAtMs = entry.sale.soldAtMs,
              )
            }
            continue
          }
          // A transient failure stays queued; every other refusal waits for the cashier.
          store.put(
            entry.copy(
              attempts = entry.attempts + 1,
              state = if (result.reason == PosOfflineRefusal.FAILED || result.reason == PosOfflineRefusal.WRONG_STAFF) PosOfflineQueued.State.QUEUED else PosOfflineQueued.State.REFUSED,
              error = result.error,
              reason = result.reason,
            ),
          )
        }
      }
      if (flagged.isNotEmpty()) notices = notices + flagged
    } finally {
      queue = store.queue()
      syncing = false
      syncInFlight = false
    }
  }
}
