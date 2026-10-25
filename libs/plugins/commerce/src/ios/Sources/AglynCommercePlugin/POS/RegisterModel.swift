// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import AglynUI
import Foundation
import Observation

/// One load of something the register reads.
enum Load<Value: Equatable>: Equatable {
  case loading
  case ready(Value)
  case failed(String)

  var value: Value? {
    if case .ready(let value) = self { return value }
    return nil
  }
}

/// The item sheet: a product being configured before it goes in the basket.
struct ItemSheet: Identifiable, Equatable {
  let item: PosItem
  var variant: PosVariant
  var picks: [ModifierSelection] = []
  var quantity = 1
  var problem: String?
  var id: String { item.id }
}

/// The register for one store: its registers, the catalog it sells, the
/// basket, and the sale being paid. Every screen of the register reads this.
@MainActor
@Observable
final class RegisterModel {
  let hostID: String
  private(set) var storeName = "Store"
  private(set) var currency = "usd"
  private(set) var timeZone: String?
  /// The paid sale's receipt, read from the order as stored, for the screen and the printer.
  private(set) var receipt: ReceiptData?
  private(set) var registers: Load<[PosRegister]> = .loading
  private(set) var register: PosRegister?
  private(set) var categories: [PosCategory] = []
  private(set) var context: PosContext?
  private(set) var online = true {
    didSet { if online != oldValue { offlineCardReader?.registerConnectivityChanged(online: online) } }
  }
  private(set) var args = PosGridArgs()
  private(set) var grid: Load<[PosItem]> = .loading
  private(set) var cart = Cart.empty
  var sheet: ItemSheet?
  /// The sale being paid; nil while ringing up.
  private(set) var checkout: Checkout?
  private(set) var charging = false
  var toast: CheckoutNotice?
  /// The card readers a tender can use: this device's reader while it is
  /// connected (it follows the readers screen live), then the site's online
  /// smart readers.
  var readers: [any CardReaderService] {
    var all: [any CardReaderService] = []
    if let deviceService, collector?.state.isConnected == true { all.append(deviceService) }
    return all + smartReaders
  }
  private(set) var smartReaders: [SmartReaderService] = []
  @ObservationIgnored private let deviceService: DeviceReaderService?
  /// The checked-in stays a sale can be charged to.
  private(set) var stays: [PosStay] = []

  /// A card typed in (the console's "Type card"), in this app's own card
  /// fields. Offered even before the register's context has loaded: the
  /// tender reads the publishable key again at the press, so a context read
  /// that failed never hides it. Not offered while offline: a card needs
  /// the server.
  var keyedCard: KeyedCardService? {
    guard online, let entry = keyedEntry else { return nil }
    return KeyedCardService(
      entry: entry, publishableKey: context?.publishableKey ?? "", merchantName: storeName, money: { [currency] in
        posMoney($0, currency: currency)
      })
  }

  /// The card tender a payment step names by label, to cancel or to read what it asks for.
  func cardService(labeled label: String) -> (any CardReaderService)? {
    if let reader = readers.first(where: { $0.label == label }) { return reader }
    if let keyed = keyedCard, keyed.label == label { return keyed }
    return nil
  }

  @ObservationIgnored private let reader: FirestoreReader
  @ObservationIgnored private let api: PosSaleAPI
  @ObservationIgnored let terminal: CommerceTerminalConnection
  @ObservationIgnored let collector: CardCollector?
  /// This app's own card fields (Aglyn POS on iPhone, iPad and Mac): a typed card.
  @ObservationIgnored let keyedEntry: KeyedCardEntry?
  @ObservationIgnored private let store: RegisterStore
  @ObservationIgnored private var openAttempt = AttemptKeys()
  @ObservationIgnored private var listeners: [String: FirestoreListening] = [:]
  /// This device's print sheet; a test hands its own.
  @ObservationIgnored var systemPrint: (String, String) async -> SystemPrintResult = { text, job in
    await SystemPrinter.printText(text, jobName: job)
  }
  @ObservationIgnored private var reconnecting: Task<Void, Never>?
  @ObservationIgnored private var keepingTheTill: Task<Void, Never>?
  /// How long an offline register waits between tries to reach the console.
  @ObservationIgnored var reconnectInterval: Duration = .seconds(10)
  /// The shift and staff PIN routes.
  @ObservationIgnored let opsAPI: PosOpsAPI
  @ObservationIgnored private var tillCashier: PosCashier!
  @ObservationIgnored private var tillShift: PosShiftModel!
  /// The customer lookup beside the basket.
  @ObservationIgnored let customers: PosCustomerModel
  /// The last sale this register finished, and its receipt.
  @ObservationIgnored let lastReceipt: PosLastReceiptModel
  /// This register's receipt printers (AGL-3909).
  @ObservationIgnored let printers: PosPrintersModel
  @ObservationIgnored private var tillOffline: PosOfflineModel!
  /// What the reader's SDK said about cards it sent to Stripe, until the register applies it (AGL-4039).
  @ObservationIgnored private let cardForwards: OfflineCardForwardLedger
  @ObservationIgnored private var tillReturns: PosReturnModel!
  @ObservationIgnored private var tillDisplay: PosDisplayControl!
  @ObservationIgnored private var tillKioskQueue: PosKioskQueueModel!
  /// The display is showing the basket (so an emptied basket tells it to go idle).
  @ObservationIgnored private var displayShowsBasket = false
  @ObservationIgnored private var displayShowsProcessing = false
  /// Who is ringing: the cashier a PIN switched in, and the idle lock.
  var cashier: PosCashier { tillCashier }
  /// The register's shift and its drawer.
  var shift: PosShiftModel { tillShift }
  /// The cash sales rung while offline, and their sync.
  var offline: PosOfflineModel { tillOffline }
  /// The return being rung at the register.
  var returns: PosReturnModel { tillReturns }
  /// The paired customer display and kiosks.
  var display: PosDisplayControl { tillDisplay }
  /// "Pay at counter" orders from this register's kiosks.
  var kioskQueue: PosKioskQueueModel { tillKioskQueue }

  init(
    hostID: String, reader: FirestoreReader, api: ConsoleAPIClient, collector: CardCollector?,
    keyedEntry: KeyedCardEntry? = nil,
    defaults: UserDefaults = .standard, opsAPI: PosOpsAPI? = nil, customersAPI: PosCustomersAPI? = nil,
    uid: String = "", offlineAPI: PosOfflineAPI? = nil, returnsAPI: PosReturnsAPI? = nil,
    displayAPI: PosDisplayAPI? = nil, kioskQueueAPI: PosKioskQueueAPI? = nil,
    cardForwards: OfflineCardForwardLedger = OfflineCardForwardLedger()
  ) {
    self.cardForwards = cardForwards
    self.hostID = hostID
    self.reader = reader
    let sale = ConsolePosSaleAPI(api: api, hostID: hostID)
    self.api = sale
    self.opsAPI = opsAPI ?? ConsolePosOpsAPI(api: api, hostID: hostID)
    terminal = CommerceTerminalConnection(api: api)
    self.collector = collector
    deviceService = collector.map { DeviceReaderService($0) }
    self.keyedEntry = keyedEntry
    store = RegisterStore(defaults: defaults, hostID: hostID)
    customers = PosCustomerModel(api: customersAPI ?? ConsolePosCustomersAPI(api: api, hostID: hostID))
    lastReceipt = PosLastReceiptModel(reader: reader, api: sale, store: store, hostID: hostID)
    printers = PosPrintersModel(reader: reader, api: api, hostID: hostID)
    let ops = self.opsAPI
    let cashier = PosCashier(api: ops, registerID: { [weak self] in self?.register?.id }, autoLockMinutes: { [weak self] in self?.context?.ops.autoLockMinutes ?? 0 })
    cashier.assertionSink = { sale.cashier.assertion = $0 }
    tillCashier = cashier
    tillShift = PosShiftModel(api: ops, registerID: { [weak self] in self?.register?.id }, assertion: { [weak cashier] in cashier?.assertion })
    let offline = PosOfflineModel(
      api: offlineAPI ?? ConsolePosOfflineAPI(api: api, hostID: hostID),
      store: PosOfflineDeviceStore(defaults: defaults, scope: "\(uid):\(hostID)"), uid: uid,
      registerID: { [weak self] in self?.register?.id }, locationID: { [weak self] in self?.register?.locationID },
      shiftID: { [weak self] in self?.tillShift.shift?.id }, assertion: { [weak cashier] in cashier?.assertion })
    offline.networkSink = { [weak self] failed in if failed { self?.online = false } }
    tillOffline = offline
    // What the reader's SDK did with cards it stored, even while this register was closed (AGL-4039).
    (collector as? OfflineCardCollector)?.onOfflineForward = { [weak self] in self?.applyCardForwards() }
    applyCardForwards()
    tillDisplay = PosDisplayControl(
      api: displayAPI ?? ConsolePosDisplayAPI(api: api, hostID: hostID), registerID: { [weak self] in self?.register?.id })
    tillKioskQueue = PosKioskQueueModel(
      api: kioskQueueAPI ?? ConsolePosKioskQueueAPI(api: api, hostID: hostID), registerID: { [weak self] in self?.register?.id })
    tillReturns = PosReturnModel(
      api: returnsAPI ?? ConsolePosReturnsAPI(api: api, hostID: hostID), registerID: { [weak self] in self?.register?.id },
      assertion: { [weak cashier] in cashier?.assertion })
  }

  func money(_ cents: Int) -> String { posMoney(cents, currency: currency) }

  func start() {
    listeners["host"]?.remove()
    listeners["host"] = reader.listenDocument(["hosts", hostID]) { [weak self] result in
      guard let self, case .success(let host?) = result else { return }
      for key in ["displayName", "name", "title"] {
        if let name = host.string(key)?.trimmingCharacters(in: .whitespaces), !name.isEmpty {
          storeName = name
          break
        }
      }
      if let currency = host.string("currency"), !currency.isEmpty { self.currency = currency }
      if let zone = host.string("timeZone"), !zone.isEmpty { timeZone = zone }
    }
    listen("registers", registersQuery(hostID), failed: { [weak self] in
      self?.registers = .failed("The registers could not be loaded. Check the connection and try again.")
    }) { [weak self] docs in
      guard let self else { return }
      let all = sortRegisters(docs.map(posRegister))
      registers = .ready(all)
      if self.register == nil || !all.contains(where: { $0.id == self.register?.id }),
        let chosen = all.first(where: { $0.id == self.store.registerID }) ?? all.first
      {
        selectRegister(chosen)
      }
    }
    listen("categories", categoriesQuery(hostID)) { [weak self] docs in
      self?.categories = sortCategories(docs.map(posCategory))
    }
    listen("stays", staysQuery(hostID)) { [weak self] docs in
      self?.stays = docs.map(posStay).sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
    loadGrid()
    if let register {
      lastReceipt.watch(registerID: register.id)
      printers.watch(registerID: register.id)
    }
    Task { await loadContext() }
    reconnecting?.cancel()
    reconnecting = Task { [weak self] in await self?.reconnectWhileOffline() }
    keepingTheTill?.cancel()
    keepingTheTill = Task { [weak self] in await self?.keepTheTill() }
  }

  func stop() {
    lastReceipt.stop()
    printers.stop()
    listeners.values.forEach { $0.remove() }
    listeners = [:]
    reconnecting?.cancel()
    reconnecting = nil
    keepingTheTill?.cancel()
    keepingTheTill = nil
  }

  /// The idle lock and the cashier's assertion renewal, on the clock's beat.
  private func keepTheTill() async {
    while !Task.isCancelled {
      try? await Task.sleep(for: cashierTick)
      if Task.isCancelled { return }
      await cashier.tick()
      if online, offline.kitIsStale { await offline.refreshKit() }
      if online { await display.check() }
    }
  }

  /// The register's one read of the console (readers, tax, receipts) happens
  /// at launch. Were it lost then, the register would stay "offline" for the
  /// whole shift: no smart readers, no emailed receipts, even after the
  /// console answered again (a cold dev server and a flaky link both lose
  /// that first call). So while it is out of reach the register asks again
  /// on a steady beat, and `reconnect()` asks at once.
  private func reconnectWhileOffline() async {
    while !Task.isCancelled {
      try? await Task.sleep(for: reconnectInterval)
      if Task.isCancelled { return }
      if !online { await loadContext() }
    }
  }

  /// Asks the console again now, as the banner's Retry does.
  func reconnect() {
    Task { await loadContext() }
  }

  private func listen(
    _ name: String, _ query: FirestoreQuery, failed: (@MainActor () -> Void)? = nil,
    _ onDocs: @escaping @MainActor ([FirestoreDocument]) -> Void
  ) {
    listeners[name]?.remove()
    listeners[name] = reader.listen(query) { result in
      switch result {
      case .success(let docs): onDocs(docs)
      case .failure: failed?()
      }
    }
  }

  func selectRegister(_ next: PosRegister) {
    if register?.id != next.id { cashier.reset() }
    register = next
    store.registerID = next.id
    cart = store.cart(next.id)
    lastReceipt.watch(registerID: next.id)
    printers.watch(registerID: next.id)
    display.reset()
    displayShowsBasket = false
    displayShowsProcessing = false
    Task { await display.check() }
    resumePendingSale(next)
    Task { await shift.refresh() }
  }

  func loadContext() async {
    do {
      let loaded = try await api.context()
      context = loaded
      online = true
      smartReaders = loaded.readers.filter(\.online).map { SmartReaderService($0) }
      // The reader connected last time comes back on its own; nothing is
      // asked of the cashier here (connecting one is the readers screen's job).
      if let controls = collector?.deviceReaders, collector?.state.isConnected == false {
        await controls.reconnectRemembered(hostID: hostID, sessions: terminal)
      }
      // The console answered: get the offline rules, then send whatever was rung while it did not.
      if offline.kitIsStale { await offline.refreshKit() }
      applyCardForwards(sync: false)
      await offline.syncNow()
    } catch {
      if isLostAnswer(error) { online = false }
    }
  }

  // MARK: The grid

  func search(_ text: String) { narrow(PosGridArgs(search: text, categoryID: args.categoryID, quickKeys: args.quickKeys)) }
  func showQuickKeys() { narrow(PosGridArgs(quickKeys: true)) }
  func showAll() { narrow(PosGridArgs()) }
  func showCategory(_ id: String) { narrow(PosGridArgs(categoryID: id)) }

  private func narrow(_ next: PosGridArgs) {
    guard next != args else { return }
    args = next
    loadGrid()
  }

  func loadGrid() {
    grid = .loading
    listen("grid", posGridQuery(hostID, args), failed: { [weak self] in
      self?.grid = .failed("The products could not be loaded. Check the connection and try again.")
    }) { [weak self] docs in
      self?.grid = .ready(docs.map(posItem))
    }
  }

  /// A scan or a typed code, looked up across the catalog: barcode first, then SKU.
  func lookUp(_ raw: String) {
    guard let code = scannedProductCode(raw) else {
      toast = CheckoutNotice(tone: .warning, message: "That code could not be read. Scan it again.")
      return
    }
    lookUp(code, fields: ["barcodes", "skus"])
  }

  private func lookUp(_ code: String, fields: [String]) {
    guard let field = fields.first else {
      toast = CheckoutNotice(tone: .warning, message: "No product has the code \(code).")
      return
    }
    var answered = false
    listen("lookup", posCodeQuery(hostID, field: field, code: code), failed: { [weak self] in
      self?.toast = CheckoutNotice(tone: .error, message: "The code could not be looked up. Check the connection.")
    }) { [weak self] docs in
      guard let self, !answered else { return }
      answered = true
      listeners["lookup"]?.remove()
      listeners["lookup"] = nil
      guard let doc = docs.first else { return lookUp(code, fields: Array(fields.dropFirst())) }
      let item = posItem(doc)
      let variant = variantForCode(item, code) ?? item.variants[0]
      if item.modifierGroups.isEmpty { add(item, variant) } else { open(item, variant) }
    }
  }

  /// A tile tap: straight in, or the item sheet when there is something to choose.
  func tap(_ item: PosItem) {
    if item.needsSheet { open(item, item.variants.first { !$0.soldOut } ?? item.variants[0]) } else { add(item, item.variants[0]) }
  }

  func open(_ item: PosItem, _ variant: PosVariant) { sheet = ItemSheet(item: item, variant: variant) }

  @discardableResult
  func add(_ item: PosItem, _ variant: PosVariant, picks: [ModifierSelection] = [], quantity: Int = 1) -> Bool {
    switch pick(item, variant, modifiers: picks) {
    case .problem(let message):
      toast = CheckoutNotice(tone: .error, message: message)
      return false
    case .ok(let pick):
      updateCart(cart.adding(pick, quantity: quantity))
      if variant.soldOut { toast = CheckoutNotice(tone: .warning, message: "\(item.name) shows as sold out.") }
      return true
    }
  }

  /// Adds what the item sheet holds; keeps the sheet open with the problem when it cannot.
  func addFromSheet() {
    guard var current = sheet else { return }
    switch pick(current.item, current.variant, modifiers: current.picks) {
    case .problem(let message):
      current.problem = message
      sheet = current
    case .ok(let pick):
      updateCart(cart.adding(pick, quantity: current.quantity))
      sheet = nil
    }
  }

  func setQuantity(_ key: String, _ quantity: Int) { updateCart(cart.settingQuantity(key, quantity)) }
  func setDiscount(_ pct: Double) { updateCart(cart.withDiscount(pct)) }
  func setCustomerEmail(_ email: String) { updateCart(cart.withCustomerEmail(email)) }
  /// Attaches the customer the lookup found; nil lets them go. Their email is the sale's.
  func attachCustomer(_ customer: PosCustomer?) { updateCart(cart.withCustomer(customer)) }
  func clearCart() { updateCart(.empty) }

  /// Takes the basket's total in cash while offline. The sale is on the device, and the basket cleared, only when this answers; nil when it could not be kept.
  func takeOfflineCash(cart sold: Cart, tenderedCents: Int) -> PosOfflineRung? {
    guard let rung = offline.ringCashSale(cart: sold, tenderedCents: tenderedCents) else { return nil }
    updateCart(.empty)
    return rung
  }

  /// This device's reader, when it can take a card with no connection (AGL-4039).
  var offlineCardReader: OfflineCardCollector? { collector as? OfflineCardCollector }

  /// A card can be taken offline right now: the store allows it and the connected reader can store one.
  var offlineCardsReady: Bool {
    offline.kit?.card?.available == true && collector?.state.isConnected == true
      && offlineCardReader?.offlineCardUnavailableReason == nil
  }

  /// Why this basket cannot be paid by card offline, in the cashier's words; nil when it can.
  func offlineCardRefusal(_ sold: Cart) -> String? {
    if let reason = offline.cardRefusal(for: sold) { return reason }
    guard let reader = offlineCardReader else { return "Cards offline need a card reader on this device." }
    guard collector?.state.isConnected == true else { return "Connect the card reader to take cards offline." }
    return reader.offlineCardUnavailableReason
  }

  enum OfflineCardResult: Equatable {
    case rung(PosOfflineRung)
    case canceled
    case failed(String)
  }

  /// Takes the basket's total by card while offline: the reader stores the
  /// card on the device and the sale joins the offline queue. The basket
  /// clears only once both happened.
  func takeOfflineCard(cart sold: Cart) async -> OfflineCardResult {
    if let reason = offlineCardRefusal(sold) { return .failed(reason) }
    guard let reader = offlineCardReader, let request = offline.cardRequest(for: sold) else {
      return .failed("This basket cannot be paid by card offline.")
    }
    switch await reader.collectOffline(request) {
    case .canceled: return .canceled
    case .failed(let message, _): return .failed(message)
    case .taken(let taken):
      guard let rung = offline.ringCardSale(cart: sold, taken: taken) else {
        return .failed(
          "The card was taken, but this register could not save the sale. Note it down: \(taken.label), \(posMoney(request.amountCents, currency: currency)).")
      }
      updateCart(.empty)
      applyCardForwards()
      return .rung(rung)
    }
  }

  /// Applies the ledger of card forwards to the queue, then sends what became ready.
  func applyCardForwards(sync: Bool = true) {
    let applied = offline.applyForwards(cardForwards.all())
    cardForwards.remove(applied)
    if sync, !applied.isEmpty, online { Task { await offline.syncNow() } }
  }

  private func updateCart(_ next: Cart) {
    cart = next
    if let register { store.saveCart(register.id, next) }
  }

  // MARK: The sale

  /// Charge: the server prices the basket and opens the sale. One attempt key
  /// per press until an answer arrives, so a retried press after a lost
  /// answer finds the same pending sale.
  func charge() async {
    guard let current = register, !cart.isEmpty, !charging, checkout == nil else { return }
    charging = true
    defer { charging = false }
    let key = openAttempt.key(for: "open:\(String(decoding: cart.encoded() ?? Data(), as: UTF8.self))")
    do {
      let opened = try await api.openSale(registerID: current.id, locationID: current.locationID, cart: cart, attemptKey: key)
      openAttempt.answered()
      online = true
      store.savePendingSale(current.id, PendingSale(orderID: opened.orderID, totalCents: opened.totalCents, openedAtMs: nowMs()))
      startCheckout(opened)
      if !opened.stockWarnings.isEmpty {
        toast = CheckoutNotice(tone: .warning, message: "Low stock: \(opened.stockWarnings.joined(separator: "; "))")
      }
    } catch {
      if isLostAnswer(error) {
        online = false
        toast = CheckoutNotice(
          tone: .warning, message: "No connection. The basket is kept; charge again when you are back online.")
      } else {
        openAttempt.answered()
        toast = CheckoutNotice(tone: .error, message: (error as? ConsoleAPIError)?.message ?? "The sale could not be opened.")
      }
    }
  }

  private func startCheckout(_ opened: PosOpenedSale) {
    let currency = currency
    checkout = Checkout(
      api: api, opened: opened, settings: context?.settings ?? PosRegisterSettings(),
      formatMoney: { posMoney($0, currency: currency) })
  }

  /// A sale this register left open (the app closed mid-checkout): read it and pick up where it stopped.
  private func resumePendingSale(_ current: PosRegister) {
    guard let pending = store.pendingSale(current.id, nowMs: nowMs()) else {
      store.savePendingSale(current.id, nil)
      return
    }
    Task {
      guard let answer = try? await api.payment(orderID: pending.orderID, step: .sale) else { return }
      switch answer.sale.status {
      case "pending":
        startCheckout(
          PosOpenedSale(
            orderID: pending.orderID, subtotalCents: nil, discountCents: nil, taxCents: nil,
            totalCents: answer.sale.totalCents, dueCents: answer.sale.dueCents, stockWarnings: []))
        await checkout?.recheck()
        toast = CheckoutNotice(tone: .warning, message: "This register had a sale open. Finish or cancel it.")
      case "paid":
        store.savePendingSale(current.id, nil)
        updateCart(.empty)
      default:
        store.savePendingSale(current.id, nil)
      }
    }
  }

  /// Loads a kiosk's "pay at counter" order into checkout, where the cashier takes payment as on any sale. Needs a free register.
  func takeKioskOrder(_ entry: PosKioskQueueEntry) async {
    guard checkout == nil, !charging else {
      toast = CheckoutNotice(tone: .warning, message: "Finish or cancel the open sale first.")
      return
    }
    switch await kioskQueue.take(entry) {
    case .success(let taken):
      let sale = taken.sale
      startCheckout(
        PosOpenedSale(
          orderID: sale.orderID, subtotalCents: nil, discountCents: nil, taxCents: nil, totalCents: sale.totalCents,
          dueCents: sale.dueCents, stockWarnings: []))
      if let register { store.savePendingSale(register.id, PendingSale(orderID: sale.orderID, totalCents: sale.totalCents, openedAtMs: nowMs())) }
    case .failure(let failure):
      toast = CheckoutNotice(tone: .error, message: failure.message)
    }
  }

  // MARK: The customer display

  /// Mirrors the basket (and the open sale's totals) onto a connected display, once the basket has settled.
  func mirrorToDisplay() async {
    guard display.connected, display.asking == nil else { return }
    if checkout?.sale.status == "paid" {
      displayShowsBasket = false
      displayShowsProcessing = false
      return
    }
    // A card payment waiting on the reader: the display says so rather than showing the balance.
    if checkout?.inFlight.contains(where: { $0.method == "card_present" }) == true {
      if !displayShowsProcessing {
        displayShowsProcessing = true
        await display.show(posDisplayProcessing(now: nowMs()))
      }
      return
    }
    displayShowsProcessing = false
    if cart.isEmpty && !displayShowsBasket { return }
    displayShowsBasket = !cart.isEmpty
    await display.show(
      posDisplayBasketState(cart: cart, sale: checkout?.sale, pendingTipCents: checkout?.tipCents ?? 0, now: nowMs()))
  }

  /// Asks the customer for a tip on the display and puts their answer on the tender.
  func askTipOnDisplay() async {
    guard let checkout, display.connected, checkout.amountCents > 0 else { return }
    let prompt = posDisplayTipPrompt(
      baseCents: checkout.amountCents, percentages: context?.settings.tipPercentages ?? [], now: nowMs())
    guard let answer = await display.ask(prompt) else { return }
    let cents = Int(answer.tipCents ?? 0)
    checkout.customTip(cents)
    toast = CheckoutNotice(tone: .info, message: cents > 0 ? "Tip: \(money(cents))" : "No tip")
  }

  /// Hands the receipt choice to the customer's screen when the store asks, then sends it as they chose.
  func askReceiptOnDisplay(_ paid: Checkout) async {
    guard display.connected, context?.settings.receiptDefault == .ask else { return }
    let prompt = posDisplayReceiptPrompt(
      smsAvailable: context?.smsReceipts == true, offerMarketing: context?.settings.displayMarketingOptIn ?? true, now: nowMs())
    guard let answer = await display.ask(prompt), !Task.isCancelled else {
      // The cashier took the receipt over, or the customer walked away: the screen still ends on its thank-you.
      await display.thank()
      return
    }
    let done: Bool
    switch answer.receiptChannel {
    case .email?:
      guard let email = answer.email else { return }
      done = await paid.sendReceipt(channel: "email", to: email, marketingOptIn: answer.marketingOptIn == true)
    case .sms?:
      guard let phone = answer.phone else { return }
      done = await paid.sendReceipt(channel: "sms", to: phone)
    case .print?:
      // The register's cloud printer prints it; with none, the choice is only recorded.
      if canPrintReceipt {
        done = await printReceipt(paid) == .printed
      } else {
        done = await paid.sendReceipt(channel: "print")
      }
    default: done = await paid.sendReceipt(channel: "none")
    }
    if done, checkout === paid { finished() }
  }

  /// The paid sale's receipt, read from the order as stored; kept up to date until the sale is finished.
  func watchReceipt(orderID: String) {
    listeners["receipt"]?.remove()
    receipt = nil
    listeners["receipt"] = reader.listenDocument(["hosts", hostID, "orders", orderID]) { [weak self] result in
      guard let self, case .success(let order?) = result else { return }
      receipt = receiptDataFromOrder(orderID: orderID, order: order.data, context: receiptContext(), nowMs: nowMs())
    }
  }

  private func stopWatchingReceipt() {
    listeners["receipt"]?.remove()
    listeners["receipt"] = nil
    receipt = nil
  }

  /// The store's receipt header, address and return policy as this register prints them.
  private func receiptContext() -> ReceiptContext {
    let rules = context?.ops
    return ReceiptContext(
      storeName: storeName,
      storeLines: (rules?.receiptAddress ?? "").split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty },
      registerName: register?.name, timeZone: timeZone, currency: currency,
      footer: rules?.returnPolicy.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty)
  }

  /// Whether the receipt can go anywhere this register prints: its cloud printer, or this device's print sheet.
  var canPrintReceipt: Bool { lastReceipt.hasPrinter || SystemPrinter.isAvailable }

  /// Prints the paid sale's receipt where this register prints, as the console does: the register's cloud printer when
  /// it has one, else this device's print sheet (the console's `window.print()`). A gift receipt drops every price and
  /// is only ever printed on the sheet (the cloud queue prints the customer's receipt). The words are the notice when
  /// it did not go; a person closing the sheet is not a failure.
  func printReceipt(_ paid: Checkout, gift: Bool = false) async -> SystemPrintResult {
    if lastReceipt.hasPrinter, !gift {
      return await paid.printToCloud() ? .printed : .failed(paid.notice?.message ?? "The receipt did not print.")
    }
    guard let receipt else { return .failed("The receipt is still loading. Try again in a moment.") }
    let cash = paid.sale.payments.contains { $0.method == "cash" && $0.status == "succeeded" }
    let text = renderText(layoutReceipt(receipt, ReceiptLayoutOptions(columns: PaperColumns.mm80, openDrawer: cash && !gift, gift: gift)))
    let result = await systemPrint(text, "\(gift ? "Gift receipt" : "Receipt") \(receipt.orderNumber)")
    if result == .printed, !gift { await paid.markPrinted() }
    return result
  }

  /// A store that always prints: the receipt goes to the register's printer as soon as the sale is paid, once. The cashier
  /// still ends the sale (a copy by email can follow).
  func printReceiptByDefault(_ paid: Checkout) async {
    guard context?.settings.receiptDefault == .print, !paid.printed, canPrintReceipt else { return }
    // The device's print sheet prints from the stored sale, so it waits for that read.
    if !lastReceipt.hasPrinter, receipt == nil { return }
    if case .failed(let words) = await printReceipt(paid) { toast = CheckoutNotice(tone: .error, message: words) }
  }

  /// The sale was voided: back to the basket, which is kept for another try.
  func voided() {
    if let register { store.savePendingSale(register.id, nil) }
    checkout = nil
  }

  /// The sale is paid and the receipt chosen: the next customer.
  func finished() {
    stopWatchingReceipt()
    if let paid = checkout?.opened.orderID { lastReceipt.remember(orderID: paid) }
    if let register { store.savePendingSale(register.id, nil) }
    updateCart(.empty)
    checkout = nil
  }
}

func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
