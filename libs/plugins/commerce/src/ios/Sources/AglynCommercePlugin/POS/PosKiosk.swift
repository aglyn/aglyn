// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import Foundation
import Observation

/*
 * THE SELF-SERVICE KIOSK (AGL-3623, AGL-3651, AGL-3652), on the tablet. The
 * Kotlin app's `PosKiosk.kt`, line for line.
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

let posKioskRoute = "/api/commerce/pos-kiosk"

/// How often the kiosk asks after a card payment in flight.
let posKioskPaymentPoll: Duration = .milliseconds(1_500)

/// How the customer tips, as the kiosk sends it.
enum PosKioskTip: Equatable {
  case none
  case percent(Double)
  case custom(Int)

  var fields: [String: JSONValue] {
    switch self {
    case .none: ["tipChoice": "none"]
    case .percent(let percent): ["tipChoice": "percent", "tipPercent": .number(percent)]
    case .custom(let cents): ["tipChoice": "custom", "tipCents": .number(Double(cents))]
    }
  }
}

/// How the customer pays by card.
enum PosKioskMethod: String, Equatable {
  /// The register's smart reader, driven through the server.
  case reader
  /// This device's own Tap to Pay.
  case tap
}

/// A card payment the server started for this kiosk's order.
struct PosKioskPayment: Equatable {
  let sale: PosKioskSale
  let paymentID: String?
  let clientSecret: String?
  let paymentIntentID: String?
}

/// What staff may change behind the PIN.
struct PosKioskSettingsView: Equatable {
  struct Reader: Equatable, Identifiable {
    let id: String
    let label: String
    let status: String
  }
  let readers: [Reader]
  let readerID: String?
  let label: String
}

struct PosKioskUnlock: Equatable {
  let unlock: String
  let expiresAtMs: Double
}

/// The kiosk's half of `commerce/pos-kiosk`, with the device token.
protocol PosKioskAPI: Sendable {
  func context(token: String) async throws -> PosKioskContext
  func catalog(token: String, categoryID: String?) async throws -> PosKioskCatalog
  func sale(token: String, orderID: String) async throws -> PosKioskSale
  func checkout(token: String, lines: JSONValue, attemptKey: String) async throws -> PosKioskSale
  func pay(token: String, orderID: String, method: PosKioskMethod, tip: PosKioskTip, attemptKey: String) async throws -> PosKioskPayment
  func paymentStatus(token: String, orderID: String, paymentID: String) async throws -> PosKioskSale
  func cancelPayment(token: String, orderID: String, paymentID: String) async throws -> PosKioskSale
  func simulate(token: String, orderID: String, paymentID: String) async throws
  func counter(token: String, orderID: String) async throws -> PosKioskSale
  func receipt(token: String, orderID: String, channel: PosReceiptChannel, to: String?, marketingOptIn: Bool) async throws
  func abandon(token: String, orderID: String) async throws
  func connectionToken(token: String) async throws -> CardReaderSession
  func unlock(token: String, pin: String) async throws -> PosKioskUnlock
  func settings(token: String, unlock: String) async throws -> PosKioskSettingsView
  func setReader(token: String, unlock: String, readerID: String) async throws -> PosKioskSettingsView
  func exit(token: String, unlock: String) async throws
}

struct ConsolePosKioskAPI: PosKioskAPI {
  let api: ConsoleAPIClient

  private func get(_ token: String, _ query: [(String, String?)]) async throws -> JSONValue? {
    try await api.request(posKioskRoute, query: query, anonymous: true, headers: [posDeviceTokenHeader: token])
  }

  private func post(_ token: String, _ body: [String: JSONValue], key: String? = nil) async throws -> JSONValue? {
    try await api.request(
      posKioskRoute, method: .post, body: .object(body), idempotencyKey: key, anonymous: true,
      headers: [posDeviceTokenHeader: token])
  }

  private func decode<T: Decodable>(_ type: T.Type, _ value: JSONValue?, _ what: String) throws -> T {
    guard let value, let data = try? value.encoded(), let made = try? JSONDecoder().decode(T.self, from: data) else {
      throw ConsoleAPIError(status: 502, message: "The kiosk did not answer with \(what).")
    }
    return made
  }

  private func saleOf(_ answer: JSONValue?) throws -> PosKioskSale { try decode(PosKioskSale.self, answer?["sale"], "an order") }

  func context(token: String) async throws -> PosKioskContext {
    try decode(PosKioskContext.self, try await get(token, [("action", "context")]), "its settings")
  }

  func catalog(token: String, categoryID: String?) async throws -> PosKioskCatalog {
    try decode(PosKioskCatalog.self, try await get(token, [("action", "catalog"), ("categoryId", categoryID)]), "its menu")
  }

  func sale(token: String, orderID: String) async throws -> PosKioskSale {
    try saleOf(try await get(token, [("action", "sale"), ("orderId", orderID)]))
  }

  func checkout(token: String, lines: JSONValue, attemptKey: String) async throws -> PosKioskSale {
    try saleOf(try await post(token, ["action": "checkout", "lines": lines], key: attemptKey))
  }

  func pay(token: String, orderID: String, method: PosKioskMethod, tip: PosKioskTip, attemptKey: String) async throws
    -> PosKioskPayment
  {
    var body: [String: JSONValue] = ["action": "pay", "orderId": .string(orderID), "method": .string(method.rawValue)]
    body.merge(tip.fields) { _, given in given }
    let answer = try await post(token, body, key: attemptKey)
    return PosKioskPayment(
      sale: try saleOf(answer), paymentID: answer?["paymentId"]?.stringValue, clientSecret: answer?["clientSecret"]?.stringValue,
      paymentIntentID: answer?["paymentIntentId"]?.stringValue)
  }

  func paymentStatus(token: String, orderID: String, paymentID: String) async throws -> PosKioskSale {
    try saleOf(try await post(token, ["action": "payment-status", "orderId": .string(orderID), "paymentId": .string(paymentID)]))
  }

  func cancelPayment(token: String, orderID: String, paymentID: String) async throws -> PosKioskSale {
    try saleOf(try await post(token, ["action": "cancel-payment", "orderId": .string(orderID), "paymentId": .string(paymentID)]))
  }

  func simulate(token: String, orderID: String, paymentID: String) async throws {
    _ = try await post(token, ["action": "simulate", "orderId": .string(orderID), "paymentId": .string(paymentID)])
  }

  func counter(token: String, orderID: String) async throws -> PosKioskSale {
    try saleOf(try await post(token, ["action": "counter", "orderId": .string(orderID)]))
  }

  func receipt(token: String, orderID: String, channel: PosReceiptChannel, to: String?, marketingOptIn: Bool) async throws {
    var body: [String: JSONValue] = ["action": "receipt", "orderId": .string(orderID), "channel": .string(channel.rawValue)]
    if let to { body["to"] = .string(to) }
    if marketingOptIn { body["marketingOptIn"] = .bool(true) }
    _ = try await post(token, body)
  }

  func abandon(token: String, orderID: String) async throws {
    _ = try await post(token, ["action": "abandon", "orderId": .string(orderID)])
  }

  func connectionToken(token: String) async throws -> CardReaderSession {
    try readReaderSession(try await post(token, ["action": "connection-token"]))
  }

  func unlock(token: String, pin: String) async throws -> PosKioskUnlock {
    let answer = try await post(token, ["action": "unlock", "pin": .string(pin)])
    guard let unlock = answer?["unlock"]?.stringValue else { throw ConsoleAPIError(status: 502, message: "That PIN is not right.") }
    return PosKioskUnlock(unlock: unlock, expiresAtMs: answer?["expiresAtMs"]?.numberValue ?? 0)
  }

  private func settingsOf(_ answer: JSONValue?) -> PosKioskSettingsView {
    PosKioskSettingsView(
      readers: (answer?["readers"]?.arrayValue ?? []).compactMap { entry in
        guard let id = entry["id"]?.stringValue else { return nil }
        return .init(id: id, label: entry["label"]?.stringValue ?? "Card reader", status: entry["status"]?.stringValue ?? "offline")
      },
      readerID: answer?["readerId"]?.stringValue, label: answer?["label"]?.stringValue ?? "")
  }

  func settings(token: String, unlock: String) async throws -> PosKioskSettingsView {
    settingsOf(try await post(token, ["action": "settings", "unlock": .string(unlock)]))
  }

  func setReader(token: String, unlock: String, readerID: String) async throws -> PosKioskSettingsView {
    settingsOf(try await post(token, ["action": "set-reader", "unlock": .string(unlock), "readerId": .string(readerID)]))
  }

  func exit(token: String, unlock: String) async throws {
    _ = try await post(token, ["action": "exit", "unlock": .string(unlock)])
  }
}

/// A kiosk's own Terminal connection tokens, for Tap to Pay on this device.
struct KioskReaderSessions: CardReaderSessionSource {
  let api: PosKioskAPI
  let token: String

  func session(hostID: String) async throws -> CardReaderSession {
    do {
      return try await api.connectionToken(token: token)
    } catch {
      throw asSetupError(error)
    }
  }
}

/// A cart line's key and estimate, as the kiosk shows its cart.
extension CartLine {
  var estimateCents: Int { unitCents * quantity }
}

/// The kiosk's catalog product as the register's item machinery takes it, so the same rules price and check its choices.
func posItem(from product: PosKioskProduct) -> PosItem {
  let variants = product.variants.map { variant in
    PosVariant(
      id: variant.id,
      label: variant.options.keys.sorted().compactMap { variant.options[$0] }.filter { !$0.isEmpty }.joined(separator: " / ")
        .nilIfEmpty,
      unitCents: variant.priceCents, sku: nil, barcode: nil, inventory: variant.soldOut ? 0 : nil)
  }
  let prices = variants.compactMap(\.unitCents)
  return PosItem(
    id: product.id, name: product.name, imageURL: product.imageUrl, variants: variants, categoryIDs: product.categoryIds,
    modifierGroups: usableModifierGroups(product.modifierGroups), quickKey: false, fromCents: prices.min(), toCents: prices.max())
}

extension String {
  var nilIfEmpty: String? { isEmpty ? nil : self }
}

/// The lowest price a product sells at, for its tile.
func kioskFromCents(_ product: PosKioskProduct) -> Int { product.variants.map(\.priceCents).min() ?? 0 }

func kioskProductSoldOut(_ product: PosKioskProduct) -> Bool { !product.variants.isEmpty && product.variants.allSatisfy(\.soldOut) }

enum PosKioskPhase: Equatable {
  case start
  case menu
  case review
  case tip(PosKioskMethod)
  case paying(method: PosKioskMethod, paymentID: String?, chargeCents: Int, failure: String?)
  case receipt
  case done
}

@MainActor
@Observable
final class PosKioskModel {
  private(set) var started = false
  private(set) var token: String?
  private(set) var context: PosKioskContext?
  private(set) var catalog: PosKioskCatalog?
  private(set) var catalogLoading = false
  var categoryID: String?
  private(set) var phase = PosKioskPhase.start
  private(set) var cart = Cart.empty
  private(set) var sale: PosKioskSale?
  private(set) var tip = PosKioskTip.none
  private(set) var busy = false
  var notice: String?
  private(set) var offline = false
  private(set) var pairError: String?
  private(set) var pairing = false
  /// Bumped by every reset: keys every screen, so inputs never carry over.
  private(set) var turn = 0
  /// Seconds left on the "Still there?" countdown, or nil.
  private(set) var idleWarning: Int?
  private(set) var tapReady = false

  @ObservationIgnored private let device: PosDeviceAPI
  @ObservationIgnored private let api: PosKioskAPI
  @ObservationIgnored private var store: PosDeviceTokenStore
  @ObservationIgnored private let collector: CardCollector?
  @ObservationIgnored private let now: () -> Int64
  @ObservationIgnored private let mintKey: () -> String
  /// One attempt per cart, and one per press of a payment button.
  @ObservationIgnored private var checkoutKey: String?
  @ObservationIgnored private var payKey: String?
  @ObservationIgnored private var lastTouch: Int64
  @ObservationIgnored private var doneAt: Int64 = 0

  init(
    device: PosDeviceAPI, api: PosKioskAPI, store: PosDeviceTokenStore, collector: CardCollector? = nil,
    now: @escaping () -> Int64 = nowMs, mintKey: @escaping () -> String = { newAttemptKey("kiosk") }
  ) {
    self.device = device
    self.api = api
    self.store = store
    self.collector = collector
    self.now = now
    self.mintKey = mintKey
    lastTouch = now()
  }

  var currency: String { context?.currency ?? catalog?.currency ?? "usd" }
  func money(_ cents: Int) -> String { posMoney(cents, currency: currency) }

  // MARK: Pairing and settings

  func start() async {
    token = store.token
    started = true
    if token != nil { await refresh() }
  }

  func pair(code: String) async {
    let digits = code.filter(\.isNumber)
    guard digits.count == 6, !pairing else { return }
    pairing = true
    pairError = nil
    defer { pairing = false }
    do {
      let paired = try await device.pair(code: digits, mode: .kiosk)
      store.token = paired.token
      token = paired.token
      await refresh()
    } catch {
      pairError = (error as? ConsoleAPIError)?.message ?? "That code is not valid. Show a new code on the register."
    }
  }

  /// Leaves kiosk mode: the device is unpaired and asks for a code again.
  func unpaired() {
    store.token = nil
    token = nil
    context = nil
    catalog = nil
    sale = nil
    cart = .empty
    tip = .none
    phase = .start
    offline = false
    checkoutKey = nil
    payKey = nil
    idleWarning = nil
    tapReady = false
  }

  /// A refusal that says the kiosk is no longer paired ends the session.
  private func lost(_ error: Error) -> Bool {
    if let failure = error as? ConsoleAPIError {
      if failure.status == 401 {
        unpaired()
        return true
      }
      offline = failure.status == 0
    }
    return false
  }

  /// The kiosk's settings and menu: read when paired, and again every ten minutes while idle on the start screen.
  func refresh() async {
    guard let token else { return }
    do {
      context = try await api.context(token: token)
      offline = false
      await prepareTap()
    } catch {
      _ = lost(error)
    }
  }

  func loadCatalog() async {
    guard let token else { return }
    catalogLoading = true
    defer { catalogLoading = false }
    do {
      catalog = try await api.catalog(token: token, categoryID: categoryID)
      offline = false
    } catch {
      _ = lost(error)
    }
  }

  /// Connects this device's own reader for Tap to Pay, with the kiosk's own connection token.
  private func prepareTap() async {
    guard let collector, let token, context?.payments.cardPresent == true else {
      tapReady = false
      return
    }
    if !collector.state.isConnected, let kind = collector.kinds.first {
      await collector.connect(hostID: "", kind: kind, sessions: KioskReaderSessions(api: api, token: token))
    }
    tapReady = collector.state.isConnected
  }

  // MARK: How the customer can pay

  var canPayByReader: Bool { context?.payments.cardPresent == true && context?.payments.reader == true }
  var canPayByTap: Bool { context?.payments.cardPresent == true && tapReady }
  var canPayAtCounter: Bool { context?.payments.payAtCounter == true }

  // MARK: Idle

  /// A touch: the customer is still there.
  func touch() {
    lastTouch = now()
    if idleWarning != nil { idleWarning = nil }
  }

  /// One beat of the idle clock (once a second): a visible countdown, then the reset. Never while a card is
  /// being collected or on the start screen.
  func tick() {
    switch phase {
    case .start, .paying:
      idleWarning = nil
      return
    default: break
    }
    guard token != nil else { return }
    let idleSeconds = Double(context?.idleSeconds ?? Int(ContractValues.shared.posKioskIdleSecondsDefault))
    let warning = Double(ContractValues.shared.posKioskIdleWarningSeconds)
    let idleFor = Double(now() - lastTouch) / 1000
    if idleFor < idleSeconds { return }
    let left = Int((idleSeconds + warning - idleFor).rounded(.up))
    if left <= 0 {
      lastTouch = now()
      idleWarning = nil
      Task { await reset() }
    } else {
      idleWarning = left
    }
  }

  /// "Done": the order-number screen returns to the start on its own.
  func tickDone() {
    if phase == .done, doneAt > 0, now() - doneAt >= Int64(ContractValues.shared.posKioskDoneSeconds) * 1000 {
      Task { await reset() }
    }
  }

  /// THE RESET: the unpaid order voided, every customer detail dropped from memory, and the screens remounted on the start screen.
  func reset() async {
    if let token, let open = sale, open.status == .open { try? await api.abandon(token: token, orderID: open.orderId) }
    sale = nil
    cart = .empty
    tip = .none
    notice = nil
    categoryID = nil
    checkoutKey = nil
    payKey = nil
    idleWarning = nil
    doneAt = 0
    phase = .start
    turn += 1
    lastTouch = now()
  }

  // MARK: The menu and the cart

  func startOrder() {
    phase = .menu
    touch()
  }

  var cartCount: Int { cart.count }
  var cartEstimateCents: Int { cart.subtotalCents }

  /// Puts a choice in the cart: the same item with the same choices merges, up to what one kiosk order carries.
  @discardableResult
  func add(_ item: PosItem, _ variant: PosVariant, picks: [ModifierSelection] = [], quantity: Int = 1) -> Bool {
    guard !variant.soldOut else { return false }
    switch pick(item, variant, modifiers: picks) {
    case .problem(let message):
      notice = message
      return false
    case .ok(let made):
      var next = cart.adding(made, quantity: quantity)
      let key = cartLineKey(made.productID, made.variantID, made.modifiers)
      if let line = next.lines.first(where: { $0.key == key }), line.quantity > Int(ContractValues.shared.posKioskMaxQuantity) {
        next = next.settingQuantity(key, Int(ContractValues.shared.posKioskMaxQuantity))
      }
      guard next.lines.count <= Int(ContractValues.shared.posKioskMaxLines) else { return false }
      cart = next
      checkoutKey = nil
      touch()
      return true
    }
  }

  func setQuantity(_ key: String, _ quantity: Int) {
    cart = cart.settingQuantity(key, min(quantity, Int(ContractValues.shared.posKioskMaxQuantity)))
    checkoutKey = nil
    touch()
  }

  // MARK: Checkout

  /// Prices the cart on the server and moves to the review.
  func checkout() async {
    guard let token, !busy, !cart.isEmpty else { return }
    if checkoutKey == nil { checkoutKey = mintKey() }
    busy = true
    notice = nil
    defer { busy = false }
    do {
      sale = try await api.checkout(token: token, lines: cart.saleLines, attemptKey: checkoutKey ?? mintKey())
      offline = false
      phase = .review
    } catch {
      if lost(error) { return }
      // A refused cart is changed before it is tried again.
      checkoutKey = nil
      notice = (error as? ConsoleAPIError)?.message ?? "Your order could not be priced. Try again."
    }
  }

  /// The tip screen's Back: the priced order again.
  func backToReview() { phase = .review }

  /// The staff unlock's calls, with this kiosk's token.
  var staffAPI: PosKioskAPI { api }

  func backToMenu() async {
    if let token, let open = sale, open.status == .open { try? await api.abandon(token: token, orderID: open.orderId) }
    sale = nil
    checkoutKey = nil
    notice = nil
    phase = .menu
  }

  func sendToCounter() async {
    guard let token, let open = sale else { return }
    busy = true
    defer { busy = false }
    do {
      sale = try await api.counter(token: token, orderID: open.orderId)
      cart = .empty
      finishToDone()
    } catch {
      if lost(error) { return }
      notice = (error as? ConsoleAPIError)?.message ?? "Your order could not be sent to the counter."
    }
  }

  private func finishToDone() {
    phase = .done
    doneAt = now()
  }

  // MARK: Paying

  /// The customer chose how to pay: a tip first when the store asks for one.
  func choosePay(_ method: PosKioskMethod) async {
    if context?.tipping.enabled == true {
      phase = .tip(method)
    } else {
      tip = .none
      await startPayment(method, .none)
    }
  }

  func startPayment(_ method: PosKioskMethod, _ answer: PosKioskTip) async {
    guard let token, let open = sale else { return }
    if payKey == nil { payKey = mintKey() }
    busy = true
    notice = nil
    let started: PosKioskPayment
    do {
      started = try await api.pay(token: token, orderID: open.orderId, method: method, tip: answer, attemptKey: payKey ?? mintKey())
    } catch {
      busy = false
      if lost(error) { return }
      payKey = nil
      notice = (error as? ConsoleAPIError)?.message ?? "The card payment could not be started."
      phase = .review
      return
    }
    sale = started.sale
    let tipCents = kioskTipCents(answer, base: open.dueCents)
    let charge = open.dueCents + tipCents
    phase = .paying(method: method, paymentID: started.paymentID, chargeCents: charge, failure: nil)
    busy = false
    guard method == .tap else { return }
    guard let collector, let secret = started.clientSecret, let intent = started.paymentIntentID else {
      phase = .paying(method: method, paymentID: started.paymentID, chargeCents: charge, failure: "Tap to Pay is not available on this device.")
      return
    }
    let outcome = await collector.collect(CardCollectRequest(paymentIntentID: intent, clientSecret: secret, amountCents: charge))
    switch outcome {
    case .collected: break
    case .canceled:
      phase = .paying(method: method, paymentID: started.paymentID, chargeCents: charge, failure: "The payment was canceled.")
    case .failed(_, let message, _):
      phase = .paying(method: method, paymentID: started.paymentID, chargeCents: charge, failure: message.isEmpty ? "The card was not read." : message)
    }
  }

  /// What the tip comes to, recomputed from the store's own rules (`posKioskTipCents`).
  func kioskTipCents(_ answer: PosKioskTip, base: Int) -> Int {
    switch answer {
    case .none: 0
    case .percent(let percent): posTipFromPercent(base, percent)
    case .custom(let cents): cents
    }
  }

  /// Asks after the card in flight until it is paid or it fails; the view calls this every `posKioskPaymentPoll`.
  func pollPayment() async {
    guard let token, let open = sale, case .paying(let method, let paymentID?, let charge, nil) = phase else { return }
    guard let next = try? await api.paymentStatus(token: token, orderID: open.orderId, paymentID: paymentID) else { return }
    sale = next
    if next.status == .paid {
      cart = .empty
      payKey = nil
      phase = .receipt
      return
    }
    if let payment = next.payment, payment.id == paymentID, payment.status == "failed" || payment.status == "canceled" {
      payKey = nil
      phase = .paying(method: method, paymentID: paymentID, chargeCents: charge, failure: payment.failureMessage ?? "The card was declined.")
    }
  }

  func cancelPayment() async {
    guard let token, let open = sale, case .paying(_, let paymentID, _, let failure) = phase else { return }
    busy = true
    defer { busy = false }
    if let paymentID, failure == nil { _ = try? await api.cancelPayment(token: token, orderID: open.orderId, paymentID: paymentID) }
    let fresh = try? await api.sale(token: token, orderID: open.orderId)
    if collector != nil { await collector?.cancel() }
    payKey = nil
    if let fresh { sale = fresh }
    phase = fresh?.status == .paid ? .receipt : .review
  }

  /// Test mode: taps a test card on the register's reader.
  func simulate() async {
    guard let token, let open = sale, case .paying(_, let paymentID?, _, _) = phase else { return }
    try? await api.simulate(token: token, orderID: open.orderId, paymentID: paymentID)
  }

  func retryPayment() async {
    guard case .paying(let method, _, _, _) = phase else { return }
    await startPayment(method, tip)
  }

  /// A tip chosen on the tip screen: remembered for a retry, then the payment starts.
  func tipChosen(_ method: PosKioskMethod, _ answer: PosKioskTip) async {
    tip = answer
    await startPayment(method, answer)
  }

  // MARK: The receipt

  func answerReceipt(channel: PosReceiptChannel, to: String?, marketingOptIn: Bool) async {
    guard let token, let paid = sale else { return }
    busy = true
    defer { busy = false }
    do {
      try await api.receipt(token: token, orderID: paid.orderId, channel: channel, to: to, marketingOptIn: marketingOptIn)
    } catch {
      if lost(error) { return }
      notice = (error as? ConsoleAPIError)?.message ?? "Your receipt could not be sent. Ask at the counter."
    }
    finishToDone()
  }
}
