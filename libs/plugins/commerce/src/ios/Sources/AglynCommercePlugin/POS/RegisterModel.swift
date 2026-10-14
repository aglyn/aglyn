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
  private(set) var registers: Load<[PosRegister]> = .loading
  private(set) var register: PosRegister?
  private(set) var categories: [PosCategory] = []
  private(set) var context: PosContext?
  private(set) var online = true
  private(set) var args = PosGridArgs()
  private(set) var grid: Load<[PosItem]> = .loading
  private(set) var cart = Cart.empty
  var sheet: ItemSheet?
  /// The sale being paid; nil while ringing up.
  private(set) var checkout: Checkout?
  private(set) var charging = false
  var toast: CheckoutNotice?
  private(set) var readers: [any CardReaderService] = []

  @ObservationIgnored private let reader: FirestoreReader
  @ObservationIgnored private let api: PosSaleAPI
  @ObservationIgnored let terminal: CommerceTerminalConnection
  @ObservationIgnored let collector: CardCollector?
  @ObservationIgnored private let store: RegisterStore
  @ObservationIgnored private var openAttempt = AttemptKeys()
  @ObservationIgnored private var listeners: [String: FirestoreListening] = [:]
  @ObservationIgnored private var reconnecting: Task<Void, Never>?
  @ObservationIgnored private var keepingTheTill: Task<Void, Never>?
  /// How long an offline register waits between tries to reach the console.
  @ObservationIgnored var reconnectInterval: Duration = .seconds(10)
  /// The shift and staff PIN routes.
  @ObservationIgnored let opsAPI: PosOpsAPI
  @ObservationIgnored private var tillCashier: PosCashier!
  @ObservationIgnored private var tillShift: PosShiftModel!
  /// Who is ringing: the cashier a PIN switched in, and the idle lock.
  var cashier: PosCashier { tillCashier }
  /// The register's shift and its drawer.
  var shift: PosShiftModel { tillShift }

  init(
    hostID: String, reader: FirestoreReader, api: ConsoleAPIClient, collector: CardCollector?,
    defaults: UserDefaults = .standard, opsAPI: PosOpsAPI? = nil
  ) {
    self.hostID = hostID
    self.reader = reader
    let sale = ConsolePosSaleAPI(api: api, hostID: hostID)
    self.api = sale
    self.opsAPI = opsAPI ?? ConsolePosOpsAPI(api: api, hostID: hostID)
    terminal = CommerceTerminalConnection(api: api)
    self.collector = collector
    store = RegisterStore(defaults: defaults, hostID: hostID)
    let ops = self.opsAPI
    let cashier = PosCashier(api: ops, registerID: { [weak self] in self?.register?.id }, autoLockMinutes: { [weak self] in self?.context?.ops.autoLockMinutes ?? 0 })
    cashier.assertionSink = { sale.cashier.assertion = $0 }
    tillCashier = cashier
    tillShift = PosShiftModel(api: ops, registerID: { [weak self] in self?.register?.id }, assertion: { [weak cashier] in cashier?.assertion })
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
    loadGrid()
    Task { await loadContext() }
    reconnecting?.cancel()
    reconnecting = Task { [weak self] in await self?.reconnectWhileOffline() }
    keepingTheTill?.cancel()
    keepingTheTill = Task { [weak self] in await self?.keepTheTill() }
  }

  func stop() {
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
    resumePendingSale(next)
    Task { await shift.refresh() }
  }

  func loadContext() async {
    do {
      let loaded = try await api.context()
      context = loaded
      online = true
      var next: [any CardReaderService] = []
      if let collector {
        if !collector.state.isConnected, let kind = collector.kinds.first {
          await collector.connect(hostID: hostID, kind: kind, sessions: terminal)
        }
        if collector.state.isConnected { next.append(DeviceReaderService(collector)) }
      }
      next += loaded.readers.filter(\.online).map { SmartReaderService($0) }
      readers = next
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
  func clearCart() { updateCart(.empty) }

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

  /// The sale was voided: back to the basket, which is kept for another try.
  func voided() {
    if let register { store.savePendingSale(register.id, nil) }
    checkout = nil
  }

  /// The sale is paid and the receipt chosen: the next customer.
  func finished() {
    if let register { store.savePendingSale(register.id, nil) }
    updateCart(.empty)
    checkout = nil
  }
}

func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
