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
import com.aglyn.contracts.PosOfflineSale
import com.aglyn.contracts.PosOfflineSaleCustomer
import com.aglyn.contracts.PosOfflineSaleLine
import com.aglyn.contracts.PosOfflineSaleOutcome
import com.aglyn.contracts.PosOfflineStockConflict
import com.aglyn.contracts.PosOfflineTotalsLine
import com.aglyn.contracts.posOfflineChangeCents
import com.aglyn.contracts.posOfflineSaleTotals
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.KeyValueStore
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
 * WHAT SELLS OFFLINE IS CASH, AND ONLY CASH (the console's rule, unchanged).
 * A card needs the reader and Stripe, a gift card's balance and a room charge's
 * stay can only be checked by the server, and a promotion code's cap is counted
 * there. The cashier's own discount, bounded by the site's ceiling, does sell.
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
}

/** A sale the server answered for with something to check. */
data class PosOfflineSyncNotice(
  val saleKey: String,
  val orderId: String,
  val number: Long?,
  val flags: List<PosOfflineFlag>,
  val stockConflicts: List<PosOfflineStockConflict>,
) {
  /** What to check, in the words the console shows. */
  val lines: List<String>
    get() = stockConflicts.map { "${it.shortUnits.toLong()} of ${it.requested.toLong()}× ${it.name} not in stock" } +
      flags.filter { it != PosOfflineFlag.STOCK_SHORT }.map { Contracts.posOfflineFlagLabels[it.raw] ?: it.raw }
}

/** A cash sale the register just rang offline, for its receipt step. */
data class PosOfflineRung(val sale: PosOfflineSale) {
  val changeCents: Long get() = sale.changeCents.toLong()
  val totalCents: Long get() = (sale.totals.totalCents ?: 0.0).toLong()
  val hasCustomerEmail: Boolean get() = !sale.customer?.email.isNullOrEmpty()
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

  fun remove(saleKey: String) {
    val list = queue().filter { it.id != saleKey }
    store.set(queueKey, if (list.isEmpty()) null else ContractJsonFormat.encodeToString(ListSerializer(PosOfflineQueued.serializer()), list))
  }
}

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
    val current = kit ?: return null
    val register = registerId() ?: return null
    if (!current.available || cart.isEmpty || uid.isEmpty() || discountOverLimit(cart)) return null
    val totals = totals(cart) ?: return null
    val total = totals.totalCents ?: 0.0
    if (tenderedCents.toDouble() < total) return null
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
      cashierAssertion = assertion(),
      cashTenderedCents = tenderedCents.toDouble(),
      changeCents = posOfflineChangeCents(total, tenderedCents.toDouble()).toDouble(),
      customer = customer,
      discountPct = cart.discountPct.toDouble(),
      hostId = current.hostId,
      lines = lines,
      locationId = locationId(),
      orgId = current.orgId,
      registerId = register,
      saleKey = mintKey(),
      shiftId = lastKnownShift(),
      signedInUid = uid,
      soldAtMs = sold.toDouble(),
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
    val mine = store.queue().filter { it.state == PosOfflineQueued.State.QUEUED && it.sale.signedInUid == uid }
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
              flagged += PosOfflineSyncNotice(result.saleKey, result.orderId ?: result.saleKey, result.number?.toLong(), result.flags.orEmpty(), result.stockConflicts.orEmpty())
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
