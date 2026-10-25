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
import com.aglyn.hardware.SystemPrintResult
import com.aglyn.hardware.renderText
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.time.Clock
import kotlin.time.ExperimentalTime

@OptIn(ExperimentalTime::class)
internal fun nowMs(): Long = Clock.System.now().toEpochMilliseconds()

/** How often an offline register tries the console again. */
internal const val RECONNECT_MS = 10_000L

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
  /** How long the register waits between tries to reach the console again while it is out of reach. */
  private val reconnectMs: Long = RECONNECT_MS,
  /** The shift and staff PIN routes. */
  val opsApi: PosOpsApi = OfflinePosOps,
  /** The customer route. */
  customersApi: PosCustomersApi = OfflinePosCustomers,
  /** The signed-in member: the only one whose offline sales this device may sync. */
  uid: String = "",
  /** The offline register's kit and sync routes. */
  offlineApi: PosOfflineApi = UnreachablePosOffline,
  /** The return route. */
  returnsApi: PosReturnsApi = OfflinePosReturns,
  /** The customer display route. */
  displayApi: PosDisplayApi = OfflinePosDisplay,
  /** The kiosks' "pay at counter" queue. */
  kioskQueueApi: PosKioskQueueApi = OfflinePosKioskQueue,
  /** The receipt printers route. */
  printersApi: PosPrintersApi = OfflinePosPrinters,
  /** Check-in at the window (AGL-4063). */
  val checkInApi: PosCheckInApi = OfflinePosCheckIn,
) {
  private val store = RegisterStore(deviceStore, hostId)

  /** Who is ringing: the cashier a PIN switched in, and the idle lock. */
  val cashier = PosCashier(opsApi, { register?.id }, { context?.ops?.autoLockMinutes ?: 0 })

  /** The register's shift and its drawer. */
  val shift = PosShiftModel(opsApi, scope, { register?.id }, { cashier.assertion })

  /** The customer lookup beside the basket. */
  val customers = PosCustomerModel(customersApi, scope)

  /** What the attached customer has to check in today. */
  val checkInDue = PosCheckInDue(checkInApi)

  /** A check-in sheet for this register: the person who checks people in is the PIN's cashier, at this register. */
  fun makeCheckIn(): PosCheckInModel = PosCheckInModel(checkInApi, scope, { register?.id }, { cashier.assertion })
  /** The last sale this register finished, and its receipt. */
  val lastReceipt = PosLastReceiptModel(firestore, api, store, hostId, scope, { receiptContext() })

  /** This register's receipt printers (AGL-3909); the last receipt offers its printer button from them. */
  val printers = PosPrintersModel(firestore, printersApi, hostId, scope).also { model ->
    model.onRows = { rows -> lastReceipt.noteCloudPrinter(rows.isNotEmpty()) }
  }

  /** The cash sales rung while offline, and their sync. */
  val offline = PosOfflineModel(
    offlineApi, PosOfflineDeviceStore(deviceStore, "$uid:$hostId"), uid, scope,
    { register?.id }, { register?.locationId }, { shift.shift?.id }, { cashier.assertion },
  ).also { model -> model.networkSink = { failed -> if (failed) online = false } }

  /** The offline cash dialog is open. */
  var offlineCashOpen by mutableStateOf(false)
  /** The return being rung at the register. */
  val returns = PosReturnModel(returnsApi, scope, { register?.id }, { cashier.assertion })

  /** The paired customer display and kiosks. */
  val display = PosDisplayControl(displayApi, scope, { register?.id })

  /** "Pay at counter" orders from this register's kiosks. */
  val kioskQueue = PosKioskQueueModel(kioskQueueApi, { register?.id })

  /** The display is showing the basket (so an emptied basket tells it to go idle). */
  private var displayShowsBasket = false
  private var displayShowsProcessing = false

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

  /** The checked-in stays a sale can be charged to. */
  var stays by mutableStateOf<List<PosStay>>(emptyList())
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

  /**
   * A card typed in (the console's "Type card"), wherever this app has
   * Stripe's card form. Offered even before the register's context has
   * loaded: the server hands the publishable key back with the intent, so a
   * context read that failed never hides the tender. Not offered while
   * offline: a card needs the server's intent.
   */
  val keyedCard: KeyedCardService?
    get() {
      val entry = peripherals.keyedCardEntry ?: return null
      return if (online) KeyedCardService(entry, context?.publishableKey.orEmpty(), storeName) else null
    }

  /** The card tender a payment step names by label, to cancel or to read what it asks for. */
  fun cardService(label: String): CardReaderService? =
    readers.firstOrNull { it.label == label } ?: keyedCard?.takeIf { it.label == label }

  /**
   * Runs a press on the register's own scope, not the pressed screen's: a
   * tender moves the checkout to its next step, and a press must outlive the
   * step that started it.
   */
  fun act(block: suspend () -> Unit) {
    scope.launch { block() }
  }

  fun start() {
    // A device reader connected or dropped on the readers screen (or by the
    // SDK's own reconnect) joins or leaves the tender buttons at once.
    cardCollector?.let { collector -> scope.launch { collector.state.collect { syncDeviceReader(collector) } } }
    scope.launch { loadRegisters() }
    scope.launch { loadStore() }
    scope.launch { loadCategories() }
    scope.launch { loadStays() }
    scope.launch { loadContext() }
    scope.launch { reconnectWhileOffline() }
    scope.launch { keepTheTill() }
    loadGrid()
  }

  /**
   * The register's one read of the console (readers, tax, receipts) happens
   * at launch. If it was lost then, the register would stay "offline" for
   * the whole shift: no smart readers, no emailed receipts, even after the
   * console answered again (a cold dev server or a flaky link both lose that
   * first call). So while it is out of reach the register asks again on a
   * steady beat, and [reconnect] asks at once.
   */
  private suspend fun reconnectWhileOffline() {
    while (currentCoroutineContext().isActive) {
      delay(reconnectMs)
      if (!online) loadContext()
    }
  }

  /** The idle lock and the cashier's assertion renewal, on the clock's beat. */
  private suspend fun keepTheTill() {
    while (currentCoroutineContext().isActive) {
      delay(CASHIER_TICK_MS)
      cashier.tick()
      if (online && offline.kitIsStale) offline.refreshKit()
      if (online) display.check()
    }
  }

  /** Asks the console again now, as the banner's Retry does. */
  fun reconnect() {
    scope.launch { loadContext() }
  }

  private suspend fun loadStore() {
    runCatching { firestore.get("hosts/$hostId") }.getOrNull()?.let { host ->
      storeName = listOf("displayName", "name", "title").firstNotNullOfOrNull { (host.data[it] as? String)?.trim()?.ifEmpty { null } } ?: storeName
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
    if (register?.id != next.id) cashier.reset()
    register = next
    store.registerId = next.id
    cart = store.cart(next.id)
    holds = store.holds(next.id)
    lastReceipt.watch(next.id)
    printers.watch(next.id)
    display.reset()
    displayShowsBasket = false
    displayShowsProcessing = false
    scope.launch { display.check() }
    resumePendingSale(next)
    shift.refresh()
  }

  private suspend fun loadCategories() {
    categories = runCatching { sortCategories(firestore.page(categoriesQuery(hostId)).docs.map(::posCategoryFrom)) }
      .getOrElse { if (it is CancellationException) throw it else emptyList() }
  }

  /** The checked-in stays a sale can be charged to; read again whenever the room charge opens, since guests come and go. */
  suspend fun loadStays() {
    stays = runCatching { firestore.page(staysQuery(hostId)).docs.map(::posStayFrom).sortedBy { it.name.lowercase() } }
      .getOrElse { if (it is CancellationException) throw it else stays }
  }

  suspend fun loadContext() {
    try {
      val loaded = api.context()
      context = loaded
      online = true
      readers.removeAll { it.kind == CardReaderKind.SMART }
      loaded.readers.filter { it.online }.forEach { readers += SmartReaderService(it) }
      // The console answered: get the offline rules, then send whatever was rung while it did not.
      if (offline.kitIsStale) offline.refreshKit()
      offline.sync()
      cardCollector?.let { collector ->
        runCatching { collector.connect(hostId, terminal) }.onFailure { if (it is CancellationException) throw it }
        syncDeviceReader(collector)
      }
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      if (error is ConsoleApiError && error.status == 0) online = false
    }
  }

  /** This device's reader is first among the tenders while it is connected. */
  private fun syncDeviceReader(collector: CardCollector) {
    val connected = collector.state.value is CardCollectorState.Connected
    val listed = readers.any { it is DeviceReaderService }
    if (connected && !listed) readers.add(0, DeviceReaderService(collector))
    if (!connected && listed) readers.removeAll { it is DeviceReaderService }
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

  /**
   * A scan or a typed code, looked up across the catalog: barcode first, then
   * SKU. [onAnswer] hears the outcome in words, for a camera sheet that stays
   * open between scans; it is told [ScanAnswer.needsSheet] when the item
   * opened the item sheet, which the camera sheet must then make way for.
   */
  fun lookUp(raw: String, onAnswer: ((ScanAnswer) -> Unit)? = null) {
    if (checkout != null) return
    val code = scannedProductCode(raw)
    if (code == null) {
      val words = "That code could not be read. Try again."
      if (onAnswer != null) onAnswer(ScanAnswer(words)) else toast = Notice(NoticeTone.WARNING, words)
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
        val words = "The lookup did not work. Check the connection and try again."
        if (onAnswer != null) onAnswer(ScanAnswer(words)) else toast = Notice(NoticeTone.ERROR, words)
        return@launch
      }
      when (result) {
        is ScanResult.Found -> if (result.item.modifierGroups.isNotEmpty()) {
          open(result.item, result.variant)
          onAnswer?.invoke(ScanAnswer("Choose options for ${result.item.name}", needsSheet = true))
        } else {
          val added = add(result.item, result.variant)
          onAnswer?.invoke(ScanAnswer(if (added) "Added ${result.item.name}" else toast?.message ?: "${result.item.name} could not be added."))
        }
        is ScanResult.Missing -> {
          val words = "No product has the code ${result.code}."
          if (onAnswer != null) onAnswer(ScanAnswer(words)) else toast = Notice(NoticeTone.WARNING, words)
        }
        ScanResult.Unreadable -> Unit
      }
    }
  }

  // ---- the basket

  /** A tile tap: straight in, or the item sheet when there is something to choose. */
  fun tap(item: PosItem) {
    if (checkout != null) return
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

  /** Attaches the customer the lookup found; null lets them go. Their email is the sale's. */
  fun attachCustomer(customer: PosCustomer?) = updateCart(cart.withCustomer(customer))

  fun clearCart() = updateCart(Cart.EMPTY)

  /** Takes the basket's total in cash while offline. The sale is on the device, and the basket cleared, only when this answers; null when it could not be kept. */
  fun takeOfflineCash(sold: Cart, tenderedCents: Long): PosOfflineRung? {
    val rung = offline.ringCashSale(sold, tenderedCents) ?: return null
    updateCart(Cart.EMPTY)
    return rung
  }

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

  /** Loads a kiosk's "pay at counter" order into checkout, where the cashier takes payment as on any sale. Needs a free register. */
  suspend fun takeKioskOrder(entry: PosKioskQueueEntry) {
    if (checkout != null || charging) {
      toast = Notice(NoticeTone.WARNING, "Finish or cancel the open sale first.")
      return
    }
    when (val result = kioskQueue.take(entry)) {
      is PosKioskTake.Taken -> {
        val sale = result.taken.sale
        startCheckout(PosOpenedSale(sale.orderId, null, null, null, sale.totalCents, sale.dueCents, emptyList()))
        register?.let { store.savePendingSale(it.id, PendingSale(sale.orderId, sale.totalCents, nowMs())) }
      }
      is PosKioskTake.Refused -> toast = Notice(NoticeTone.ERROR, result.message)
    }
  }

  // The customer display.

  /** Mirrors the basket (and the open sale's totals) onto a connected display, once the basket has settled. */
  suspend fun mirrorToDisplay() {
    if (!display.connected || display.asking != null) return
    val open = checkout?.state?.value
    if (open?.sale?.status == "paid") {
      displayShowsBasket = false
      displayShowsProcessing = false
      return
    }
    // A card payment waiting on the reader: the display says so rather than showing the balance.
    if (open?.inFlight?.any { it.method == "card_present" } == true) {
      if (!displayShowsProcessing) {
        displayShowsProcessing = true
        display.show(posDisplayProcessing(nowMs()))
      }
      return
    }
    displayShowsProcessing = false
    if (cart.isEmpty && !displayShowsBasket) return
    displayShowsBasket = !cart.isEmpty
    display.show(posDisplayBasketState(cart, open?.sale, open?.tipCents ?: 0, nowMs()))
  }

  /** Asks the customer for a tip on the display and puts their answer on the tender. */
  suspend fun askTipOnDisplay() {
    val open = checkout ?: return
    val amount = open.state.value.amountCents
    if (!display.connected || amount <= 0) return
    val answer = display.ask(posDisplayTipPrompt(amount, context?.settings?.tipPercentages ?: emptyList(), nowMs())) ?: return
    val cents = (answer.tipCents ?: 0.0).toLong()
    open.customTip(cents)
    toast = Notice(NoticeTone.INFO, if (cents > 0) "Tip: ${money(cents, currency)}" else "No tip")
  }

  /** Hands the receipt choice to the customer's screen when the store asks, then sends it as they chose. */
  suspend fun askReceiptOnDisplay(paid: Checkout) {
    val settings = context?.settings ?: return
    if (!display.connected || settings.receiptDefault != ReceiptDefault.ASK) return
    val answer = display.ask(posDisplayReceiptPrompt(context?.smsReceipts == true, settings.displayMarketingOptIn, nowMs()))
    if (answer == null) {
      // The cashier took the receipt over, or the customer walked away: the screen still ends on its thank-you.
      display.thank()
      return
    }
    val done = when (answer.receiptChannel) {
      com.aglyn.contracts.PosReceiptChannel.EMAIL -> paid.sendReceipt("email", answer.email ?: return, answer.marketingOptIn == true)
      com.aglyn.contracts.PosReceiptChannel.SMS -> paid.sendReceipt("sms", answer.phone ?: return)
      com.aglyn.contracts.PosReceiptChannel.PRINT -> if (canPrintReceipt) printReceipt(paid) == SystemPrintResult.Printed else paid.sendReceipt("print")
      else -> paid.sendReceipt("none")
    }
    if (done && checkout === paid) finished()
  }

  /** Whether the receipt can go anywhere this register prints: its direct or cloud printer, or this device's print sheet. */
  val canPrintReceipt: Boolean get() = peripherals.printers.isNotEmpty() || lastReceipt.hasPrinter || peripherals.systemPrinter != null

  /**
   * Prints the paid sale's receipt where this register prints, as the console does: its direct printer, else its cloud
   * printer, else this device's print sheet (the console's `window.print()`); with none of them, the choice is only
   * recorded. A gift receipt drops every price and is only ever printed by this device (the cloud queue prints the
   * customer's receipt). A person closing the sheet is not a failure.
   */
  suspend fun printReceipt(paid: Checkout, gift: Boolean = false): SystemPrintResult {
    val data = receipt
    val loading = SystemPrintResult.Failed("The receipt is still loading. Try again in a moment.")
    val cash = paid.state.value.sale.payments.any { it.method == "cash" && it.status == "succeeded" }
    if (peripherals.printers.isNotEmpty()) {
      data ?: return loading
      print(data, openDrawer = cash && !gift, gift = gift)?.let { return SystemPrintResult.Failed(it) }
      if (!gift) paid.markPrinted()
      return SystemPrintResult.Printed
    }
    if (lastReceipt.hasPrinter && !gift) return paid.printToCloud()?.let { SystemPrintResult.Failed(it) } ?: SystemPrintResult.Printed
    val sheet = peripherals.systemPrinter
    if (sheet != null) {
      data ?: return loading
      val text = renderText(layoutReceipt(data, ReceiptLayoutOptions(columns = 48, gift = gift)))
      val result = sheet.printText(text, "${if (gift) "Gift receipt" else "Receipt"} ${data.orderNumber}")
      if (result == SystemPrintResult.Printed && !gift) paid.markPrinted()
      return result
    }
    if (gift) return SystemPrintResult.Failed("No printer is set up on this register.")
    paid.sendReceipt("print")
    return SystemPrintResult.Printed
  }

  /** A store that always prints: the receipt goes to the register's printer as soon as the sale is paid, once. */
  suspend fun printReceiptByDefault(paid: Checkout) {
    if (context?.settings?.receiptDefault != ReceiptDefault.PRINT || paid.state.value.printed || !canPrintReceipt) return
    // A direct printer and this device's print sheet print from the stored sale, so they wait for that read.
    if (!lastReceipt.hasPrinter && receipt == null) return
    (printReceipt(paid) as? SystemPrintResult.Failed)?.let { toast = Notice(NoticeTone.ERROR, it.message) }
  }

  /** The sale was voided: back to the basket, which is kept for another try. */
  fun voided() {
    register?.let { store.savePendingSale(it.id, null) }
    checkout = null
    receipt = null
  }

  /** The sale is paid and the receipt chosen: the next customer. */
  fun finished() {
    checkout?.state?.value?.opened?.orderId?.let(lastReceipt::remember)
    register?.let { store.savePendingSale(it.id, null) }
    updateCart(Cart.EMPTY)
    checkout = null
    receipt = null
  }

  /** The paid order's receipt, read from the order as stored, for the screen and the printer. */
  fun loadReceipt(orderId: String) {
    scope.launch {
      val order = runCatching { firestore.get("hosts/$hostId/orders/$orderId") }.getOrNull() ?: return@launch
      receipt = receiptDataFromOrder(orderId, order.data, receiptContext(), nowMs())
    }
  }

  /** The store's receipt header, address and return policy as this register prints them. */
  private fun receiptContext(): ReceiptContext {
    val rules = context?.ops
    return ReceiptContext(
      storeName = storeName,
      storeLines = rules?.receiptAddress.orEmpty().lines().map { it.trim() }.filter { it.isNotEmpty() },
      registerName = register?.name,
      timeZone = timeZone,
      currency = currency,
      footer = rules?.returnPolicy?.trim()?.ifEmpty { null },
    )
  }

  /** Prints the receipt on the register's direct printer, kicking the drawer for cash. A gift receipt drops every price. */
  suspend fun print(receiptData: ReceiptData, openDrawer: Boolean, gift: Boolean = false): String? {
    val printer = peripherals.printers.firstOrNull() ?: return "No receipt printer is set up on this register."
    return try {
      printer.print(EscPosEncoder().encode(layoutReceipt(receiptData, ReceiptLayoutOptions(columns = 48, openDrawer = openDrawer, gift = gift))))
      null
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      error.message ?: "The receipt did not print."
    }
  }
}

/** What a looked-up code did, for a scanner that stays open. */
data class ScanAnswer(val words: String, val needsSheet: Boolean = false)
