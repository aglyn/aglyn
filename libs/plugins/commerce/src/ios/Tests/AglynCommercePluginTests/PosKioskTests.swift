// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import Foundation
import XCTest

@testable import AglynCommercePlugin

private func suite() -> UserDefaults {
  let name = "pos-kiosk-\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: name)!
  defaults.removePersistentDomain(forName: name)
  return defaults
}

private func json<T: Decodable>(_ type: T.Type, _ text: String) -> T { try! JSONDecoder().decode(T.self, from: Data(text.utf8)) }

private func makeContext(
  tipping: Bool = false, reader: Bool = true, cardPresent: Bool = true, counter: Bool = true, idle: Int = 90, test: Bool = false
) -> PosKioskContext {
  json(
    PosKioskContext.self,
    """
    {"branding":{"name":"Corner Cafe","logoUrl":null,"logoDarkUrl":null,"message":"Order here"},"currency":"usd",
     "tipping":{"enabled":\(tipping),"percentages":[15,20]},
     "payments":{"reader":\(reader),"cardPresent":\(cardPresent),"payAtCounter":\(counter)},
     "receipts":["email","print","none"],"offerMarketing":true,"idleSeconds":\(idle),"testMode":\(test)}
    """)
}

private let latte = json(
  PosKioskProduct.self,
  """
  {"id":"p1","name":"Latte","categoryIds":["c1"],"options":[{"name":"Size","values":["Small","Large"]}],
   "variants":[{"id":"v-s","options":{"Size":"Small"},"priceCents":400,"soldOut":false},{"id":"v-l","options":{"Size":"Large"},"priceCents":500,"soldOut":false}],
   "modifierGroups":[{"id":"milk","name":"Milk","min":1,"max":1,"options":[{"id":"oat","name":"Oat","priceCents":75},{"id":"whole","name":"Whole","priceCents":0}]}]}
  """)

private let muffin = json(
  PosKioskProduct.self,
  """
  {"id":"p2","name":"Muffin","categoryIds":[],"options":[],"variants":[{"id":"default","options":{},"priceCents":300,"soldOut":false}],"modifierGroups":[]}
  """)

private let gone = json(
  PosKioskProduct.self,
  """
  {"id":"p3","name":"Scone","categoryIds":[],"options":[],"variants":[{"id":"default","options":{},"priceCents":250,"soldOut":true}],"modifierGroups":[]}
  """)

private func makeSale(
  status: PosKioskSaleStatus = .open, total: Int = 1296, due: Int? = nil, paid: Int = 0, number: Int = 12, payment: String? = nil,
  paymentStatus: String = "pending", failure: String? = nil
) -> PosKioskSale {
  json(
    PosKioskSale.self,
    """
    {"orderId":"o1","number":\(number),"status":"\(status.rawValue)","lines":[{"name":"Latte","quantity":2,"amountCents":900}],
     "itemsCents":1200,"discountCents":0,"taxCents":96,"totalCents":\(total),"tipCents":0,"paidCents":\(paid),"dueCents":\(due ?? total),
     "payment":\(payment.map { "{\"id\":\"\($0)\",\"status\":\"\(paymentStatus)\"\(failure.map { ",\"failureMessage\":\"\($0)\"" } ?? "")}" } ?? "null")}
    """)
}

private final class ScriptedKiosk: PosKioskAPI, @unchecked Sendable {
  private let lock = NSLock()
  private var recorded: [String] = []
  var calls: [String] { lock.withLock { recorded } }
  func note(_ call: String) { lock.withLock { recorded.append(call) } }

  var contextAnswer = makeContext()
  var catalogAnswer = PosKioskCatalog(categories: [PosKioskCategory(id: "c1", name: "Coffee")], currency: "usd", products: [latte, muffin, gone])
  var checkoutResult: Result<PosKioskSale, ConsoleAPIError> = .success(makeSale())
  var payResult: Result<PosKioskPayment, ConsoleAPIError> = .success(
    PosKioskPayment(sale: makeSale(payment: "pay1"), paymentID: "pay1", clientSecret: nil, paymentIntentID: nil))
  var statuses: [PosKioskSale] = []
  var freshSale = makeSale()
  var counterSale = makeSale(status: .queued)
  var failure: ConsoleAPIError?
  var lines: [JSONValue] = []

  func context(token: String) async throws -> PosKioskContext {
    note("context \(token)")
    if let failure { throw failure }
    return contextAnswer
  }

  func catalog(token: String, categoryID: String?) async throws -> PosKioskCatalog {
    note("catalog \(categoryID ?? "-")")
    if let failure { throw failure }
    return catalogAnswer
  }

  func sale(token: String, orderID: String) async throws -> PosKioskSale {
    note("sale \(orderID)")
    return freshSale
  }

  func checkout(token: String, lines: JSONValue, attemptKey: String) async throws -> PosKioskSale {
    note("checkout \(attemptKey)")
    self.lines.append(lines)
    return try checkoutResult.get()
  }

  func pay(token: String, orderID: String, method: PosKioskMethod, tip: PosKioskTip, attemptKey: String) async throws -> PosKioskPayment {
    note("pay \(method.rawValue) \(tip) \(attemptKey)")
    return try payResult.get()
  }

  func paymentStatus(token: String, orderID: String, paymentID: String) async throws -> PosKioskSale {
    note("status \(paymentID)")
    return statuses.isEmpty ? freshSale : statuses.removeFirst()
  }

  func cancelPayment(token: String, orderID: String, paymentID: String) async throws -> PosKioskSale {
    note("cancel \(paymentID)")
    return freshSale
  }

  func simulate(token: String, orderID: String, paymentID: String) async throws { note("simulate \(paymentID)") }

  func counter(token: String, orderID: String) async throws -> PosKioskSale {
    note("counter \(orderID)")
    return counterSale
  }

  func receipt(token: String, orderID: String, channel: PosReceiptChannel, to: String?, marketingOptIn: Bool) async throws {
    note("receipt \(channel.rawValue) \(to ?? "-") \(marketingOptIn)")
  }

  func abandon(token: String, orderID: String) async throws { note("abandon \(orderID)") }

  func connectionToken(token: String) async throws -> CardReaderSession {
    CardReaderSession(secret: "pst_x", locationID: "tml_1", merchantDisplayName: "Cafe", testMode: true)
  }

  func unlock(token: String, pin: String) async throws -> PosKioskUnlock {
    note("unlock \(pin)")
    if pin != "4821" { throw ConsoleAPIError(status: 403, message: "That PIN is not right.") }
    return PosKioskUnlock(unlock: "u-1", expiresAtMs: Double(nowMs() + 300_000))
  }

  func settings(token: String, unlock: String) async throws -> PosKioskSettingsView {
    PosKioskSettingsView(readers: [.init(id: "r1", label: "Counter reader", status: "online")], readerID: nil, label: "Front kiosk")
  }

  func setReader(token: String, unlock: String, readerID: String) async throws -> PosKioskSettingsView {
    note("set-reader \(readerID)")
    return PosKioskSettingsView(readers: [.init(id: "r1", label: "Counter reader", status: "online")], readerID: readerID, label: "Front kiosk")
  }

  func exit(token: String, unlock: String) async throws { note("exit") }
}

private final class PairingDevice: PosDeviceAPI, @unchecked Sendable {
  var modes: [PosDeviceMode] = []
  var result: Result<PosPaired, ConsoleAPIError> = .success(PosPaired(token: "kiosk-tok", mode: .kiosk, branding: nil))
  func pair(code: String, mode: PosDeviceMode) async throws -> PosPaired {
    modes.append(mode)
    return try result.get()
  }
  func poll(token: String, withBranding: Bool) async throws -> (read: PosDisplayRead, branding: PosDeviceBranding?) {
    throw ConsoleAPIError(status: 0, message: "unused")
  }
  func respond(token: String, answer: PosDisplayAnswer) async throws {}
  func forget(token: String) async throws {}
}

final class PosKioskItemTests: XCTestCase {
  func testAKioskProductIsTheRegistersItemSoTheSameRulesPriceItsChoices() {
    let item = posItem(from: latte)
    XCTAssertEqual(item.variants.map(\.label), ["Small", "Large"])
    XCTAssertEqual(item.variants.map(\.unitCents), [400, 500])
    XCTAssertTrue(item.needsSheet)
    XCTAssertEqual(item.fromCents, 400)
    XCTAssertEqual(item.toCents, 500)
    guard case .ok(let made) = pick(item, item.variants[1], modifiers: [ModifierSelection(groupId: "milk", optionId: "oat")]) else {
      return XCTFail("a Large oat latte is sellable")
    }
    XCTAssertEqual(made.unitCents, 575)
    XCTAssertEqual(made.variantID, "v-l")
    XCTAssertEqual(made.variantLabel, "Large / Oat")
    // A required choice is asked for before the cart takes the item.
    XCTAssertEqual(pick(item, item.variants[0]), .problem("Choose milk for Latte."))
    XCTAssertFalse(posItem(from: muffin).needsSheet)
    XCTAssertTrue(posItem(from: gone).variants[0].soldOut)
  }

  func testTheTileShowsTheLowestPriceAndWhetherAnythingIsLeft() {
    XCTAssertEqual(kioskFromCents(latte), 400)
    XCTAssertFalse(kioskProductSoldOut(latte))
    XCTAssertTrue(kioskProductSoldOut(gone))
  }
}

@MainActor
final class PosKioskModelTests: XCTestCase {
  private final class Clock: @unchecked Sendable { var ms: Int64 = 1_000_000 }

  private func model(
    _ api: ScriptedKiosk, device: PairingDevice = PairingDevice(), defaults: UserDefaults = suite(), collector: CardCollector? = nil,
    clock: Clock = Clock()
  ) -> PosKioskModel {
    var keys = (1...50).map { "key-\($0)" }
    return PosKioskModel(
      device: device, api: api, store: PosDeviceTokenStore(defaults: defaults, mode: .kiosk), collector: collector, now: { clock.ms },
      mintKey: { keys.removeFirst() })
  }

  private func paired(_ api: ScriptedKiosk, collector: CardCollector? = nil, clock: Clock = Clock()) async -> PosKioskModel {
    let kiosk = model(api, collector: collector, clock: clock)
    await kiosk.start()
    await kiosk.pair(code: "123456")
    await kiosk.loadCatalog()
    return kiosk
  }

  private func fill(_ kiosk: PosKioskModel) {
    kiosk.startOrder()
    let item = posItem(from: muffin)
    kiosk.add(item, item.variants[0], quantity: 2)
  }

  func testAKioskPairsAsAKioskAndComesBackAfterARelaunch() async {
    let defaults = suite()
    let device = PairingDevice()
    let api = ScriptedKiosk()
    let first = model(api, device: device, defaults: defaults)
    await first.start()
    XCTAssertNil(first.token)
    await first.pair(code: "123 456")
    XCTAssertEqual(device.modes, [.kiosk])
    XCTAssertEqual(first.token, "kiosk-tok")
    XCTAssertEqual(first.context?.currency, "usd")
    let again = model(api, device: device, defaults: defaults)
    await again.start()
    XCTAssertEqual(again.token, "kiosk-tok")
    XCTAssertEqual(PosDeviceTokenStore(defaults: defaults, mode: .display).token, nil, "a kiosk's token is not a display's")
  }

  func testTheCartMergesSameChoicesAndStopsAtWhatOneOrderCarries() async {
    let kiosk = await paired(ScriptedKiosk())
    kiosk.startOrder()
    let item = posItem(from: muffin)
    kiosk.add(item, item.variants[0], quantity: 15)
    kiosk.add(item, item.variants[0], quantity: 15)
    XCTAssertEqual(kiosk.cart.lines.count, 1)
    XCTAssertEqual(kiosk.cart.lines[0].quantity, Int(ContractValues.shared.posKioskMaxQuantity))
    XCTAssertEqual(kiosk.cartEstimateCents, 300 * Int(ContractValues.shared.posKioskMaxQuantity))
    let soldOut = posItem(from: gone)
    XCTAssertFalse(kiosk.add(soldOut, soldOut.variants[0]))
    let coffee = posItem(from: latte)
    XCTAssertFalse(kiosk.add(coffee, coffee.variants[0]), "a required choice is missing")
    XCTAssertEqual(kiosk.notice, "Choose milk for Latte.")
    XCTAssertTrue(kiosk.add(coffee, coffee.variants[1], picks: [ModifierSelection(groupId: "milk", optionId: "oat")]))
    kiosk.setQuantity(kiosk.cart.lines[0].key, 0)
    XCTAssertEqual(kiosk.cart.lines.count, 1)
  }

  func testCheckoutSendsOnlyPicksAndKeepsOneAttemptPerCart() async {
    let api = ScriptedKiosk()
    let kiosk = await paired(api)
    fill(kiosk)
    await kiosk.checkout()
    XCTAssertEqual(kiosk.phase, .review)
    XCTAssertEqual(kiosk.sale?.totalCents, 1296)
    let line = api.lines.last?.arrayValue.first?.objectValue
    XCTAssertEqual(line?["productId"], "p2")
    XCTAssertEqual(line?["quantity"], .number(2))
    XCTAssertNil(line?["unitCents"], "a price is never sent")
    // The same cart tried again is the same attempt; a changed cart is a new one.
    await kiosk.backToMenu()
    await kiosk.checkout()
    kiosk.setQuantity(kiosk.cart.lines[0].key, 3)
    await kiosk.backToMenu()
    await kiosk.checkout()
    let keys = api.calls.filter { $0.hasPrefix("checkout") }
    XCTAssertEqual(keys.count, 3)
    XCTAssertNotEqual(keys[0], keys[2])
  }

  func testARefusedCartShowsWhyAndIsChangedBeforeItIsTriedAgain() async {
    let api = ScriptedKiosk()
    api.checkoutResult = .failure(ConsoleAPIError(status: 400, message: "Latte is no longer available."))
    let kiosk = await paired(api)
    fill(kiosk)
    await kiosk.checkout()
    XCTAssertEqual(kiosk.phase, .menu)
    XCTAssertEqual(kiosk.notice, "Latte is no longer available.")
    api.checkoutResult = .success(makeSale())
    await kiosk.checkout()
    let keys = api.calls.filter { $0.hasPrefix("checkout") }
    XCTAssertNotEqual(keys[0], keys[1], "a refusal starts a new attempt")
  }

  func testGoingBackToTheMenuVoidsTheUnpaidOrder() async {
    let api = ScriptedKiosk()
    let kiosk = await paired(api)
    fill(kiosk)
    await kiosk.checkout()
    await kiosk.backToMenu()
    XCTAssertTrue(api.calls.contains("abandon o1"))
    XCTAssertNil(kiosk.sale)
    XCTAssertEqual(kiosk.phase, .menu)
    XCTAssertFalse(kiosk.cart.isEmpty, "the cart is kept for another go")
  }

  func testPayAtCounterSendsTheOrderToTheRegistersQueueAndShowsItsNumber() async {
    let api = ScriptedKiosk()
    let kiosk = await paired(api)
    fill(kiosk)
    await kiosk.checkout()
    await kiosk.sendToCounter()
    XCTAssertEqual(kiosk.phase, .done)
    XCTAssertEqual(kiosk.sale?.status, .queued)
    XCTAssertTrue(kiosk.cart.isEmpty)
  }

  func testWithTippingOnThePaymentWaitsForTheTipAndNeverChargesWithoutOne() async {
    let api = ScriptedKiosk()
    api.contextAnswer = makeContext(tipping: true)
    let kiosk = await paired(api)
    fill(kiosk)
    await kiosk.checkout()
    await kiosk.choosePay(.reader)
    XCTAssertEqual(kiosk.phase, .tip(.reader))
    XCTAssertTrue(api.calls.allSatisfy { !$0.hasPrefix("pay") })
    await kiosk.tipChosen(.reader, .percent(20))
    // 20% of the 1296 due, recomputed the way the server does.
    XCTAssertEqual(kiosk.phase, .paying(method: .reader, paymentID: "pay1", chargeCents: 1296 + 259, failure: nil))
    XCTAssertEqual(api.calls.last, "pay reader percent(20.0) key-2")
  }

  func testWithoutTippingThePaymentStartsAtOnceAndAFinishedCardMovesToTheReceipt() async {
    let api = ScriptedKiosk()
    let kiosk = await paired(api)
    fill(kiosk)
    await kiosk.checkout()
    await kiosk.choosePay(.reader)
    XCTAssertEqual(kiosk.phase, .paying(method: .reader, paymentID: "pay1", chargeCents: 1296, failure: nil))
    api.statuses = [makeSale(payment: "pay1"), makeSale(status: .paid, paid: 1296, payment: "pay1", paymentStatus: "succeeded")]
    await kiosk.pollPayment()
    XCTAssertEqual(kiosk.phase, .paying(method: .reader, paymentID: "pay1", chargeCents: 1296, failure: nil))
    await kiosk.pollPayment()
    XCTAssertEqual(kiosk.phase, .receipt)
    XCTAssertTrue(kiosk.cart.isEmpty)
  }

  func testADeclinedCardSaysSoAndALaterTryIsANewPress() async {
    let api = ScriptedKiosk()
    let kiosk = await paired(api)
    fill(kiosk)
    await kiosk.checkout()
    await kiosk.choosePay(.reader)
    api.statuses = [makeSale(payment: "pay1", paymentStatus: "failed", failure: "The card was declined.")]
    await kiosk.pollPayment()
    XCTAssertEqual(kiosk.phase, .paying(method: .reader, paymentID: "pay1", chargeCents: 1296, failure: "The card was declined."))
    await kiosk.retryPayment()
    let presses = api.calls.filter { $0.hasPrefix("pay ") }
    XCTAssertEqual(presses.count, 2)
    XCTAssertNotEqual(presses[0], presses[1])
  }

  func testAPaymentThatCouldNotStartReturnsToTheReviewWithItsWords() async {
    let api = ScriptedKiosk()
    api.payResult = .failure(ConsoleAPIError(status: 409, message: "No card reader is set up for this kiosk. Please pay at the counter."))
    let kiosk = await paired(api)
    fill(kiosk)
    await kiosk.checkout()
    await kiosk.choosePay(.reader)
    XCTAssertEqual(kiosk.phase, .review)
    XCTAssertEqual(kiosk.notice, "No card reader is set up for this kiosk. Please pay at the counter.")
  }

  func testCancellingTheCardStopsItAndGoesBackUnlessItAlreadyPaid() async {
    let api = ScriptedKiosk()
    let kiosk = await paired(api)
    fill(kiosk)
    await kiosk.checkout()
    await kiosk.choosePay(.reader)
    await kiosk.cancelPayment()
    XCTAssertTrue(api.calls.contains("cancel pay1"))
    XCTAssertEqual(kiosk.phase, .review)
    await kiosk.choosePay(.reader)
    api.freshSale = makeSale(status: .paid, paid: 1296)
    await kiosk.cancelPayment()
    XCTAssertEqual(kiosk.phase, .receipt, "a card that settled between the taps is paid")
  }

  func testTapToPayCollectsTheServersIntentOnThisDevice() async {
    let api = ScriptedKiosk()
    api.payResult = .success(
      PosKioskPayment(sale: makeSale(payment: "pay1"), paymentID: "pay1", clientSecret: "pi_12345678_secret_abcdefgh", paymentIntentID: "pi_12345678"))
    let collector = SimulatedCardCollector(delay: .milliseconds(1))
    let kiosk = await paired(api, collector: collector)
    XCTAssertTrue(kiosk.canPayByTap)
    fill(kiosk)
    await kiosk.checkout()
    await kiosk.choosePay(.tap)
    XCTAssertEqual(kiosk.phase, .paying(method: .tap, paymentID: "pay1", chargeCents: 1296, failure: nil), "collected: the server settles it by status")
  }

  func testTapToPayWithoutAReaderSaysSo() async {
    let api = ScriptedKiosk()
    let kiosk = await paired(api)
    XCTAssertFalse(kiosk.canPayByTap)
    fill(kiosk)
    await kiosk.checkout()
    await kiosk.choosePay(.tap)
    XCTAssertEqual(kiosk.phase, .paying(method: .tap, paymentID: "pay1", chargeCents: 1296, failure: "Tap to Pay is not available on this device."))
  }

  func testTheReceiptGoesWhereTheCustomerSaidThenTheOrderNumberShows() async {
    let api = ScriptedKiosk()
    let kiosk = await paired(api)
    fill(kiosk)
    await kiosk.checkout()
    await kiosk.choosePay(.reader)
    api.statuses = [makeSale(status: .paid, paid: 1296)]
    await kiosk.pollPayment()
    await kiosk.answerReceipt(channel: .email, to: "a@b.co", marketingOptIn: true)
    XCTAssertEqual(api.calls.last, "receipt email a@b.co true")
    XCTAssertEqual(kiosk.phase, .done)
  }

  func testTheOrderNumberScreenReturnsToTheStartOnItsOwn() async {
    let clock = Clock()
    let api = ScriptedKiosk()
    let kiosk = await paired(api, clock: clock)
    fill(kiosk)
    await kiosk.checkout()
    await kiosk.sendToCounter()
    kiosk.tickDone()
    XCTAssertEqual(kiosk.phase, .done)
    clock.ms += Int64(ContractValues.shared.posKioskDoneSeconds) * 1000
    kiosk.tickDone()
    await Task.yield()
    for _ in 0..<50 where kiosk.phase != .start { await Task.yield() }
    XCTAssertEqual(kiosk.phase, .start)
    XCTAssertTrue(kiosk.cart.isEmpty)
    XCTAssertNil(kiosk.sale)
  }

  func testAnIdleKioskAsksStillThereThenClearsTheOrderAndVoidsItsSale() async {
    let clock = Clock()
    let api = ScriptedKiosk()
    api.contextAnswer = makeContext(idle: 30)
    let kiosk = await paired(api, clock: clock)
    fill(kiosk)
    await kiosk.checkout()
    clock.ms += 29_000
    kiosk.tick()
    XCTAssertNil(kiosk.idleWarning)
    clock.ms += 2_000
    kiosk.tick()
    XCTAssertEqual(kiosk.idleWarning, Int(ContractValues.shared.posKioskIdleWarningSeconds) - 1)
    kiosk.touch()
    XCTAssertNil(kiosk.idleWarning, "a touch during the countdown cancels it")
    clock.ms += 31_000 + Int64(ContractValues.shared.posKioskIdleWarningSeconds) * 1000
    kiosk.tick()
    for _ in 0..<50 where kiosk.phase != .start { await Task.yield() }
    XCTAssertEqual(kiosk.phase, .start)
    XCTAssertTrue(api.calls.contains("abandon o1"))
    XCTAssertTrue(kiosk.cart.isEmpty)
    XCTAssertEqual(kiosk.turn, 1, "every screen is remounted so nothing typed carries over")
  }

  func testTheKioskNeverTimesOutOnTheStartScreenOrWhileACardIsBeingCollected() async {
    let clock = Clock()
    let api = ScriptedKiosk()
    let kiosk = await paired(api, clock: clock)
    clock.ms += 10 * 60_000
    kiosk.tick()
    XCTAssertNil(kiosk.idleWarning)
    fill(kiosk)
    await kiosk.checkout()
    await kiosk.choosePay(.reader)
    clock.ms += 10 * 60_000
    kiosk.tick()
    XCTAssertNil(kiosk.idleWarning)
    if case .paying = kiosk.phase {} else { XCTFail("still paying") }
  }

  func testAnUnpairedTokenLeavesTheKioskForPairing() async {
    let defaults = suite()
    let api = ScriptedKiosk()
    let kiosk = model(api, defaults: defaults)
    await kiosk.start()
    await kiosk.pair(code: "123456")
    api.failure = ConsoleAPIError(status: 401, message: "This kiosk is not paired.")
    await kiosk.loadCatalog()
    XCTAssertNil(kiosk.token)
    XCTAssertNil(PosDeviceTokenStore(defaults: defaults, mode: .kiosk).token)
  }

  func testWhatPaymentsAreOfferedFollowsTheStoresSettingsAndTheDevice() async {
    let api = ScriptedKiosk()
    api.contextAnswer = makeContext(reader: false, cardPresent: true, counter: false)
    let kiosk = await paired(api)
    XCTAssertFalse(kiosk.canPayByReader)
    XCTAssertFalse(kiosk.canPayAtCounter)
    api.contextAnswer = makeContext(reader: true, cardPresent: false, counter: true)
    await kiosk.refresh()
    XCTAssertFalse(kiosk.canPayByReader, "card payments are off for the platform")
    XCTAssertTrue(kiosk.canPayAtCounter)
  }

  func testStaffUnlockOpensTheReaderChoiceAndLeavesKioskMode() async {
    let api = ScriptedKiosk()
    let kiosk = await paired(api)
    let staff = PosKioskStaffModel()
    staff.open()
    staff.pin = "0000"
    var left = await staff.submit(kiosk)
    XCTAssertFalse(left)
    XCTAssertEqual(staff.error, "That PIN is not right.")
    XCTAssertEqual(staff.pin, "", "the PIN is never kept")
    staff.pin = "4821"
    left = await staff.submit(kiosk)
    XCTAssertFalse(left)
    XCTAssertEqual(staff.stage, .settings)
    XCTAssertEqual(staff.view?.label, "Front kiosk")
    await staff.chooseReader(kiosk, "r1")
    XCTAssertEqual(staff.view?.readerID, "r1")
    left = await staff.exit(kiosk)
    XCTAssertTrue(left)
    XCTAssertEqual(api.calls.last, "exit")
    staff.close()
    XCTAssertEqual(staff.stage, .closed)
    XCTAssertNil(staff.unlock)
  }
}

private final class Recording: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private(set) var requests: [URLRequest] = []
  let body: String
  init(_ body: String) { self.body = body }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    lock.withLock { requests.append(request) }
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }

  var sent: [String: Any] {
    (try? JSONSerialization.jsonObject(with: requests.last?.httpBody ?? Data())) as? [String: Any] ?? [:]
  }
}

private func client(_ transport: HTTPTransport, signedIn: Bool = false) -> ConsoleAPIClient {
  ConsoleAPIClient(
    origin: "https://console.test", getIDToken: { _ in signedIn ? "id-token" : nil }, transport: transport, sleep: { _ in }, maxAttempts: 1)
}

final class ConsolePosKioskAPITests: XCTestCase {
  func testEveryCallCarriesTheDeviceTokenAndNoSession() async throws {
    let transport = Recording(
      #"{"branding":{"name":"Cafe","logoUrl":null,"logoDarkUrl":null,"message":"Hi"},"currency":"usd","tipping":{"enabled":false,"percentages":[]},"payments":{"reader":true,"cardPresent":true,"payAtCounter":true},"receipts":["none"],"offerMarketing":false,"idleSeconds":90,"testMode":false}"#)
    let read = try await ConsolePosKioskAPI(api: client(transport)).context(token: "tok")
    let request = transport.requests.last!
    XCTAssertEqual(request.url?.path, "/api/commerce/pos-kiosk")
    XCTAssertEqual(request.value(forHTTPHeaderField: "X-Pos-Display-Token"), "tok")
    XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    XCTAssertTrue((request.url?.query ?? "").contains("action=context"))
    XCTAssertEqual(read.idleSeconds, 90)
  }

  func testCheckoutAndPayCarryTheirAttemptKeysAndTheTipChoice() async throws {
    let saleJSON = #"{"orderId":"o1","number":3,"status":"open","lines":[],"itemsCents":100,"discountCents":0,"taxCents":0,"totalCents":100,"tipCents":0,"paidCents":0,"dueCents":100,"payment":null}"#
    let checkout = Recording(#"{"sale":\#(saleJSON)}"#)
    let lines: JSONValue = .array([.object(["productId": "p1", "quantity": .number(1)])])
    _ = try await ConsolePosKioskAPI(api: client(checkout)).checkout(token: "tok", lines: lines, attemptKey: "k-1")
    XCTAssertEqual(checkout.requests.last?.value(forHTTPHeaderField: "Idempotency-Key"), "k-1")
    XCTAssertEqual(checkout.sent["action"] as? String, "checkout")
    XCTAssertEqual((checkout.sent["lines"] as? [[String: Any]])?.first?["productId"] as? String, "p1")

    let pay = Recording(#"{"sale":\#(saleJSON),"paymentId":"pay1","clientSecret":"pi_12345678_secret_abcdefgh","paymentIntentId":"pi_12345678"}"#)
    let started = try await ConsolePosKioskAPI(api: client(pay)).pay(
      token: "tok", orderID: "o1", method: .tap, tip: .custom(250), attemptKey: "k-2")
    XCTAssertEqual(pay.requests.last?.value(forHTTPHeaderField: "Idempotency-Key"), "k-2")
    XCTAssertEqual(pay.sent["method"] as? String, "tap")
    XCTAssertEqual(pay.sent["tipChoice"] as? String, "custom")
    XCTAssertEqual(pay.sent["tipCents"] as? Int, 250)
    XCTAssertEqual(started.paymentID, "pay1")
    XCTAssertEqual(started.paymentIntentID, "pi_12345678")
    XCTAssertEqual(started.sale.number, 3)
  }

  func testTheReceiptTheUnlockAndTheSettingsSpeakTheRoutesWords() async throws {
    let receipt = Recording(#"{"ok":true}"#)
    try await ConsolePosKioskAPI(api: client(receipt)).receipt(
      token: "tok", orderID: "o1", channel: .email, to: "a@b.co", marketingOptIn: true)
    XCTAssertEqual(receipt.sent["channel"] as? String, "email")
    XCTAssertEqual(receipt.sent["to"] as? String, "a@b.co")
    XCTAssertEqual(receipt.sent["marketingOptIn"] as? Bool, true)

    let unlock = Recording(#"{"unlock":"u-9","expiresAtMs":1700000300000}"#)
    let opened = try await ConsolePosKioskAPI(api: client(unlock)).unlock(token: "tok", pin: "4821")
    XCTAssertEqual(unlock.sent["pin"] as? String, "4821")
    XCTAssertEqual(opened, PosKioskUnlock(unlock: "u-9", expiresAtMs: 1_700_000_300_000))

    let settings = Recording(#"{"readers":[{"id":"r1","label":"Counter","status":"online"}],"readerId":"r1","label":"Front kiosk"}"#)
    let view = try await ConsolePosKioskAPI(api: client(settings)).settings(token: "tok", unlock: "u-9")
    XCTAssertEqual(view.readerID, "r1")
    XCTAssertEqual(view.readers.first?.label, "Counter")
  }
}

@MainActor
final class PosKioskQueueTests: XCTestCase {
  private final class ScriptedQueue: PosKioskQueueAPI, @unchecked Sendable {
    var entries = [PosKioskQueueEntry(orderID: "o1", number: 12, queuedAtMs: 5, totalCents: 1240, itemCount: 3)]
    var takeFailure: ConsoleAPIError?
    var taken: [String] = []
    func queue(registerID: String) async throws -> (entries: [PosKioskQueueEntry], currency: String?) { (entries, "usd") }
    func take(registerID: String, orderID: String) async throws -> PosKioskTaken {
      if let takeFailure { throw takeFailure }
      taken.append(orderID)
      return PosKioskTaken(
        sale: PosSale(orderID: orderID, status: "pending", totalCents: 1240, paidCents: 0, dueCents: 1240, tenderableCents: 1240, tipCents: 0, payments: []),
        number: 12)
    }
  }

  func testTheQueueListsOrdersOldestFirstAndNothingWithoutARegister() async {
    let api = ScriptedQueue()
    var register: String? = nil
    let queue = PosKioskQueueModel(api: api, registerID: { register })
    await queue.load()
    XCTAssertTrue(queue.entries.isEmpty)
    register = "r1"
    await queue.load()
    XCTAssertEqual(queue.entries.map(\.number), [12])
  }

  func testTakingAnOrderReturnsItsSaleAndAFailureReloadsTheQueue() async {
    let api = ScriptedQueue()
    let queue = PosKioskQueueModel(api: api, registerID: { "r1" })
    await queue.load()
    switch await queue.take(queue.entries[0]) {
    case .success(let taken): XCTAssertEqual(taken.sale.dueCents, 1240)
    case .failure: XCTFail("taken")
    }
    api.takeFailure = ConsoleAPIError(status: 409, message: "This order is no longer waiting for payment.")
    api.entries = []
    switch await queue.take(PosKioskQueueEntry(orderID: "o1", number: 12, queuedAtMs: 5, totalCents: 1, itemCount: 1)) {
    case .success: XCTFail("refused")
    case .failure(let failure): XCTAssertEqual(failure.message, "This order is no longer waiting for payment.")
    }
    XCTAssertTrue(queue.entries.isEmpty, "the queue is re-read after a refusal")
  }

  func testTheQueueApiReadsEntriesAndTheTakenSale() async throws {
    let transport = Recording(
      #"{"entries":[{"orderId":"o1","number":12,"queuedAtMs":5,"totalCents":1240,"itemCount":3}],"currency":"eur"}"#)
    let answer = try await ConsolePosKioskQueueAPI(api: client(transport, signedIn: true), hostID: "h1").queue(registerID: "r1")
    XCTAssertTrue((transport.requests.last?.url?.query ?? "").contains("action=queue"))
    XCTAssertEqual(answer.entries.first?.itemCount, 3)
    XCTAssertEqual(answer.currency, "eur")
    let take = Recording(
      #"{"sale":{"orderId":"o1","status":"pending","totalCents":1240,"paidCents":0,"dueCents":1240,"tenderableCents":1240,"tipCents":0,"payments":[]},"number":12,"lines":[]}"#)
    let taken = try await ConsolePosKioskQueueAPI(api: client(take, signedIn: true), hostID: "h1").take(registerID: "r1", orderID: "o1")
    XCTAssertEqual(take.sent["action"] as? String, "take")
    XCTAssertEqual(taken.number, 12)
    XCTAssertEqual(taken.sale.orderID, "o1")
    XCTAssertEqual(taken.sale.tenderableCents, 1240)
  }
}

@MainActor
final class RegisterKioskOrderTests: XCTestCase {
  private final class Nothing: FirestoreListening, @unchecked Sendable { func remove() {} }

  private final class EmptyReader: FirestoreReader, @unchecked Sendable {
    @MainActor
    func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening { Nothing() }
    @MainActor
    func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening { Nothing() }
    func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
    func deleteDocument(_ path: [String]) async throws {}
  }

  private final class Queue: PosKioskQueueAPI, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []
    var taken: [String] { lock.withLock { recorded } }
    var takeFailure: ConsoleAPIError?

    func queue(registerID: String) async throws -> (entries: [PosKioskQueueEntry], currency: String?) {
      ([PosKioskQueueEntry(orderID: "o1", number: 12, queuedAtMs: 5, totalCents: 1240, itemCount: 3)], "usd")
    }

    func take(registerID: String, orderID: String) async throws -> PosKioskTaken {
      if let takeFailure { throw takeFailure }
      lock.withLock { recorded.append(orderID) }
      return PosKioskTaken(
        sale: PosSale(orderID: orderID, status: "pending", totalCents: 1240, paidCents: 0, dueCents: 1240, tenderableCents: 1240, tipCents: 0, payments: []),
        number: 12)
    }
  }

  private func register(_ queue: Queue) -> RegisterModel {
    let api = ConsoleAPIClient(
      origin: "https://console.test", getIDToken: { _ in "token" }, transport: Recording("{}"), sleep: { _ in }, maxAttempts: 1)
    let model = RegisterModel(
      hostID: "h1", reader: EmptyReader(), api: api, collector: nil, defaults: UserDefaults(suiteName: "kiosk-order-\(UUID().uuidString)")!,
      kioskQueueAPI: queue)
    model.selectRegister(PosRegister(id: "r1", name: "Front", locationID: nil))
    return model
  }

  func testTakingAKioskOrderOpensItForPaymentWhereTheCashierTakesIt() async {
    let queue = Queue()
    let model = register(queue)
    await model.kioskQueue.load()
    await model.takeKioskOrder(model.kioskQueue.entries[0])
    XCTAssertEqual(model.checkout?.opened.orderID, "o1")
    XCTAssertEqual(model.checkout?.opened.dueCents, 1240)
    XCTAssertEqual(queue.taken, ["o1"])
  }

  func testAnOpenSaleBlocksTakingAnotherAndSaysWhy() async {
    let queue = Queue()
    let model = register(queue)
    await model.kioskQueue.load()
    await model.takeKioskOrder(model.kioskQueue.entries[0])
    await model.takeKioskOrder(model.kioskQueue.entries[0])
    XCTAssertEqual(model.toast?.message, "Finish or cancel the open sale first.")
    XCTAssertEqual(queue.taken, ["o1"], "the second take never reached the route")
  }

  func testARefusedTakeSaysWhyAndLeavesTheRegisterFree() async {
    let queue = Queue()
    queue.takeFailure = ConsoleAPIError(status: 409, message: "This order is no longer waiting for payment.")
    let model = register(queue)
    await model.kioskQueue.load()
    await model.takeKioskOrder(model.kioskQueue.entries[0])
    XCTAssertEqual(model.toast?.message, "This order is no longer waiting for payment.")
    XCTAssertNil(model.checkout)
  }
}
