package com.aglyn.plugins.commerce.pos

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.ModifierSelection
import com.aglyn.contracts.ReceiptData
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreReader
import com.aglyn.core.KeyValueStore
import com.aglyn.hardware.CardCollector
import com.aglyn.hardware.CardCollectorState
import com.aglyn.hardware.CardReaderSessionSource
import com.aglyn.hardware.EscPosEncoder
import com.aglyn.hardware.Peripherals
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

@OptIn(ExperimentalTime::class)
internal fun nowMs(): Long = Clock.System.now().toEpochMilliseconds()

/** One load of something the register reads. */
sealed interface Load<out T> {
  data object Loading : Load<Nothing>
  data class Ready<T>(val value: T) : Load<T>
  data class Failed(val message: String) : Load<Nothing>
}

/** The item sheet: a product being configured before it goes in the basket. */
data class ItemSheet(val item: PosItem, val variantId: String, val picks: List<ModifierSelection>, val quantity: Int, val problem: String? = null)

/**
 * The register's state for one store: its catalog, the basket (kept on the
 * device), the sale being paid, held baskets and the card readers on offer.
 * Screens read it and call it; it owns every read and every route call.
 */
class RegisterModel(
  val hostId: String,
  private val firestore: FirestoreReader,
  private val api: PosSaleApi,
  private val terminal: CardReaderSessionSource,
  deviceStore: KeyValueStore,
  val peripherals: Peripherals,
  private val scope: CoroutineScope,
) {
  private val store = RegisterStore(deviceStore, hostId)

  var registers by mutableStateOf<Load<List<PosRegister>>>(Load.Loading)
    private set
  var register by mutableStateOf<PosRegister?>(null)
    private set
  var context by mutableStateOf<PosContext?>(null)
    private set
  var storeName by mutableStateOf("Store")
    private set
  var currency by mutableStateOf("usd")
    private set
  var timeZone by mutableStateOf<String?>(null)
    private set

  var categories by mutableStateOf<List<PosCategory>>(emptyList())
    private set
  var args by mutableStateOf(PosGridArgs(quickKeys = true))
    private set
  var grid by mutableStateOf<Load<List<PosItem>>>(Load.Loading)
    private set
  private var gridCursor: List<Any?>? = null
  var gridHasMore by mutableStateOf(false)
    private set
  private var gridJob: Job? = null
  var hasQuickKeys by mutableStateOf(true)
    private set

  var cart by mutableStateOf(Cart.EMPTY)
    private set
  var holds by mutableStateOf<List<HeldBasket>>(emptyList())
    private set
  var sheet by mutableStateOf<ItemSheet?>(null)
  var toast by mutableStateOf<Notice?>(null)
  var online by mutableStateOf(true)
    private set
  var charging by mutableStateOf(false)
    private set

  /** The sale being paid; null while ringing up. */
  var checkout by mutableStateOf<Checkout?>(null)
    private set
  var receipt by mutableStateOf<ReceiptData?>(null)
    private set
  private var openAttempt = AttemptKeys()

  val cardCollector: CardCollector? get() = peripherals.cardCollector
  val readers = mutableStateListOf<CardReaderService>()

  fun start() {
    scope.launch { loadRegisters() }
    scope.launch { loadStore() }
    scope.launch { loadCategories() }
    scope.launch { loadContext() }
    loadGrid()
  }

  private suspend fun loadStore() {
    runCatching { firestore.get("hosts/$hostId") }.getOrNull()?.let { host ->
      storeName = (host.data["name"] as? String)?.ifEmpty { null } ?: (host.data["title"] as? String) ?: storeName
      (host.data["currency"] as? String)?.ifEmpty { null }?.let { currency = it }
      (host.data["timeZone"] as? String)?.ifEmpty { null }?.let { timeZone = it }
    }
  }

  suspend fun loadRegisters() {
    registers = Load.Loading
    registers = try {
      val all = sortRegisters(firestore.page(registersQuery(hostId)).docs.map(::posRegisterFrom))
      val chosen = all.firstOrNull { it.id == store.registerId } ?: all.firstOrNull()
      if (chosen != null) selectRegister(chosen)
      Load.Ready(all)
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      Load.Failed("The registers could not be loaded. Check the connection and try again.")
    }
  }

  fun selectRegister(next: PosRegister) {
    register = next
    store.registerId = next.id
    cart = store.cart(next.id)
    holds = store.holds(next.id)
    resumePendingSale(next)
  }

  private suspend fun loadCategories() {
    categories = runCatching { sortCategories(firestore.page(categoriesQuery(hostId)).docs.map(::posCategoryFrom)) }
      .getOrElse { if (it is CancellationException) throw it else emptyList() }
  }

  suspend fun loadContext() {
    try {
      val loaded = api.context()
      context = loaded
      online = true
      readers.clear()
      cardCollector?.let { collector ->
        runCatching { collector.connect(hostId, terminal) }
        if (collector.state.value is CardCollectorState.Connected) readers += DeviceReaderService(collector)
      }
      loaded.readers.filter { it.online }.forEach { readers += SmartReaderService(it) }
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      if (error is ConsoleApiError && error.status == 0) online = false
    }
  }

  // ---- the grid

  fun search(text: String) = narrow(PosGridArgs(search = text, categoryId = args.categoryId, quickKeys = args.quickKeys))

  fun showQuickKeys() = narrow(PosGridArgs(quickKeys = true))

  fun showAll() = narrow(PosGridArgs())

  fun showCategory(id: String) = narrow(PosGridArgs(categoryId = id))

  private fun narrow(next: PosGridArgs) {
    if (next == args) return
    args = next
    loadGrid()
  }

  fun loadGrid() {
    gridJob?.cancel()
    grid = Load.Loading
    gridCursor = null
    val asked = args
    gridJob = scope.launch {
      grid = try {
        val page = firestore.page(posGridQuery(hostId, asked))
        gridCursor = page.nextCursor
        gridHasMore = page.nextCursor != null
        val items = page.docs.map(::posItemFrom)
        // A store with no quick keys opens on the whole catalog instead.
        if (asked.quickKeys && asked.search.isBlank() && items.isEmpty()) {
          hasQuickKeys = false
          args = PosGridArgs()
          loadGrid()
          return@launch
        }
        Load.Ready(items)
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        Load.Failed("Products could not be loaded. Check the connection and try again.")
      }
    }
  }

  fun loadMore() {
    val cursor = gridCursor ?: return
    val shown = (grid as? Load.Ready)?.value ?: return
    if (gridJob?.isActive == true) return
    val asked = args
    gridJob = scope.launch {
      runCatching { firestore.page(posGridQuery(hostId, asked, startAfter = cursor)) }.onSuccess { page ->
        if (asked != args) return@onSuccess
        gridCursor = page.nextCursor
        gridHasMore = page.nextCursor != null
        grid = Load.Ready(shown + page.docs.map(::posItemFrom))
      }
    }
  }

  /** A scan or a typed code, looked up across the catalog: barcode first, then SKU. */
  fun lookUp(raw: String) {
    val code = scannedProductCode(raw)
    if (code == null) {
      toast = Notice(NoticeTone.WARNING, "That code could not be read. Try again.")
      return
    }
    scope.launch {
      val result = try {
        var found: ScanResult = ScanResult.Missing(code)
        for (field in listOf("barcodes", "skus")) {
          val item = firestore.page(posCodeQuery(hostId, field, code)).docs.firstOrNull()?.let(::posItemFrom) ?: continue
          found = ScanResult.Found(item, variantForCode(item, code) ?: item.variants.first())
          break
        }
        found
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        toast = Notice(NoticeTone.ERROR, "The lookup did not work. Check the connection and try again.")
        return@launch
      }
      when (result) {
        is ScanResult.Found -> if (result.item.modifierGroups.isNotEmpty()) open(result.item, result.variant) else add(result.item, result.variant)
        is ScanResult.Missing -> toast = Notice(NoticeTone.WARNING, "No product has the code ${result.code}.")
        ScanResult.Unreadable -> Unit
      }
    }
  }

  // ---- the basket

  /** A tile tap: straight in, or the item sheet when there is something to choose. */
  fun tap(item: PosItem) {
    if (item.needsSheet()) open(item, item.variants.firstOrNull { !it.soldOut() && it.unitCents != null } ?: item.variants.first()) else add(item, item.variants.first())
  }

  fun open(item: PosItem, variant: PosVariant) {
    val defaults = item.modifierGroups.filter { it.single() && it.required() }.map { ModifierSelection(it.id, it.options.first().id) }
    sheet = ItemSheet(item, variant.id, defaults, 1)
  }

  fun add(item: PosItem, variant: PosVariant, picks: List<ModifierSelection> = emptyList(), quantity: Int = 1): Boolean {
    when (val pick = pickOf(item, variant, picks)) {
      is PickResult.Problem -> {
        toast = Notice(NoticeTone.ERROR, pick.message)
        return false
      }
      is PickResult.Ok -> {
        updateCart(cart.add(pick.pick, quantity))
        if (variant.soldOut()) toast = Notice(NoticeTone.WARNING, "${item.name} shows as sold out. The sale may refuse it.")
        return true
      }
    }
  }

  /** Adds what the item sheet holds; keeps the sheet open with the problem when it cannot. */
  fun addFromSheet() {
    val open = sheet ?: return
    val variant = open.item.variants.firstOrNull { it.id == open.variantId } ?: return
    when (val pick = pickOf(open.item, variant, open.picks)) {
      is PickResult.Problem -> sheet = open.copy(problem = pick.message)
      is PickResult.Ok -> {
        updateCart(cart.add(pick.pick, open.quantity))
        sheet = null
      }
    }
  }

  fun setQuantity(key: String, quantity: Int) = updateCart(cart.setQuantity(key, quantity))

  fun setDiscount(pct: Double) = updateCart(cart.withDiscount(pct))

  fun setCustomerEmail(email: String) = updateCart(cart.withCustomerEmail(email))

  fun clearCart() = updateCart(Cart.EMPTY)

  private fun updateCart(next: Cart) {
    cart = next
    register?.let { store.saveCart(it.id, next) }
  }

  /** Sets the basket aside under [label]; the next customer starts empty. */
  fun hold(label: String = holdLabel(cart)) {
    val registerId = register?.id ?: return
    if (store.hold(registerId, cart, label, nowMs())) {
      holds = store.holds(registerId)
      updateCart(Cart.EMPTY)
      toast = Notice(NoticeTone.SUCCESS, "Basket held. Resume it from Held.")
    } else if (!cart.isEmpty) {
      toast = Notice(NoticeTone.WARNING, "This register already holds $POS_MAX_HELD_BASKETS baskets. Resume or discard one first.")
    }
  }

  /** Brings a held basket back; the basket on screen is held in its place, so nothing is lost. */
  fun resume(holdId: String) {
    val registerId = register?.id ?: return
    val current = cart
    val back = store.resume(registerId, holdId) ?: return
    if (!current.isEmpty) store.hold(registerId, current, holdLabel(current), nowMs())
    holds = store.holds(registerId)
    updateCart(back)
  }

  fun discardHold(holdId: String) {
    val registerId = register?.id ?: return
    store.discard(registerId, holdId)
    holds = store.holds(registerId)
  }

  // ---- the sale

  /**
   * Charge: the server prices the basket and opens the sale. One attempt key
   * per press until an answer arrives, so a retried press after a lost answer
   * finds the same pending sale.
   */
  fun charge() {
    val current = register ?: return
    if (cart.isEmpty || charging || checkout != null) return
    charging = true
    scope.launch {
      val key = openAttempt.keyFor("open:${cart.encode()}")
      try {
        val opened = api.openSale(current.id, current.locationId, cart, key)
        openAttempt.answered()
        online = true
        store.savePendingSale(current.id, PendingSale(opened.orderId, opened.totalCents, nowMs()))
        startCheckout(opened)
        if (opened.stockWarnings.isNotEmpty()) toast = Notice(NoticeTone.WARNING, "Low stock: ${opened.stockWarnings.joinToString("; ")}")
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        val lost = error !is ConsoleApiError || error.status == 0
        if (lost) {
          online = false
          toast = Notice(NoticeTone.WARNING, "No connection. The basket is kept; hold it or charge again when you are back online.")
        } else {
          openAttempt.answered()
          toast = Notice(NoticeTone.ERROR, error.message ?: "The sale could not be opened.")
        }
      } finally {
        charging = false
      }
    }
  }

  private fun startCheckout(opened: PosOpenedSale) {
    checkout = Checkout(api, opened, context?.settings ?: PosRegisterSettings(), formatMoney = { money(it, currency) })
  }

  /** A sale this register left open (the app closed mid-checkout): read it and pick up where it stopped. */
  private fun resumePendingSale(current: PosRegister) {
    val pending = store.pendingSale(current.id, nowMs()) ?: return store.savePendingSale(current.id, null)
    scope.launch {
      val answer = runCatching { api.payment(pending.orderId, SaleStep.Sale) }.getOrNull() ?: return@launch
      when (answer.sale.status) {
        "pending" -> {
          startCheckout(PosOpenedSale(pending.orderId, null, null, null, answer.sale.totalCents, answer.sale.dueCents, emptyList()))
          checkout?.recheck()
          toast = Notice(NoticeTone.WARNING, "This register had a sale open. Finish or cancel it.")
        }
        "paid" -> {
          store.savePendingSale(current.id, null)
          updateCart(Cart.EMPTY)
        }
        else -> store.savePendingSale(current.id, null)
      }
    }
  }

  /** The sale was voided: back to the basket, which is kept for another try. */
  fun voided() {
    register?.let { store.savePendingSale(it.id, null) }
    checkout = null
    receipt = null
  }

  /** The sale is paid and the receipt chosen: the next customer. */
  fun finished() {
    register?.let { store.savePendingSale(it.id, null) }
    updateCart(Cart.EMPTY)
    checkout = null
    receipt = null
  }

  /** The paid order's receipt, read from the order as stored, for the screen and the printer. */
  fun loadReceipt(orderId: String) {
    scope.launch {
      val order = runCatching { firestore.get("hosts/$hostId/orders/$orderId") }.getOrNull() ?: return@launch
      receipt = receiptDataFromOrder(
        orderId,
        order.data,
        ReceiptContext(storeName = storeName, registerName = register?.name, timeZone = timeZone, currency = currency),
        nowMs(),
      )
    }
  }

  /** Prints the receipt on the register's direct printer, kicking the drawer for cash. */
  suspend fun print(receiptData: ReceiptData, openDrawer: Boolean): String? {
    val printer = peripherals.printers.firstOrNull() ?: return "No receipt printer is set up on this register."
    return try {
      printer.print(EscPosEncoder().encode(layoutReceipt(receiptData, ReceiptLayoutOptions(columns = 48, openDrawer = openDrawer))))
      null
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      error.message ?: "The receipt did not print."
    }
  }
}
