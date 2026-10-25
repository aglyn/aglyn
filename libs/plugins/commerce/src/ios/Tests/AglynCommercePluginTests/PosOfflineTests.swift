// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import Foundation
import XCTest

@testable import AglynCommercePlugin

private let kitJSON = """
  {"v":1,"hostId":"h1","orgId":"org1","issuedAtMs":1700000000000,"available":true,
   "tax":{"pct":8,"pricesIncludeTax":false},"maxDiscountPct":20,"requireOpenShift":false,
   "registers":[{"id":"r1","name":"Front","locationId":"loc1","openShiftId":"s9"}],
   "receipt":{"name":"Corner Cafe"}}
  """

private func makeKit(_ patch: (inout PosOfflineKit) -> Void = { _ in }) -> PosOfflineKit {
  var made = try! JSONDecoder().decode(PosOfflineKit.self, from: Data(kitJSON.utf8))
  patch(&made)
  return made
}

private func suite() -> UserDefaults {
  let name = "pos-offline-\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: name)!
  defaults.removePersistentDomain(forName: name)
  return defaults
}

private func cart(discount: Int = 0, customer: PosCustomer? = nil) -> Cart {
  var cart = Cart.empty
    .adding(CartPick(productID: "p1", variantID: "v1", name: "Latte", variantLabel: "Large", unitCents: 450), quantity: 2)
    .adding(CartPick(productID: "p2", variantID: nil, name: "Muffin", variantLabel: nil, unitCents: 300))
  cart = cart.withDiscount(Double(discount))
  return cart.withCustomer(customer)
}

private final class FakeOfflineAPI: PosOfflineAPI, @unchecked Sendable {
  private let lock = NSLock()
  private var batches: [[String]] = []
  var batchesSent: [[String]] { lock.withLock { batches } }
  var kitAnswer: PosOfflineKit? = makeKit()
  var failure: ConsoleAPIError?
  var answers: [String: PosOfflineSaleOutcome] = [:]

  func kit() async throws -> PosOfflineKit {
    if let failure { throw failure }
    return kitAnswer!
  }

  func sync(_ sales: [PosOfflineSale]) async throws -> [PosOfflineSaleOutcome] {
    lock.withLock { batches.append(sales.map(\.saleKey)) }
    if let failure { throw failure }
    return sales.map { answers[$0.saleKey] ?? PosOfflineSaleOutcome(number: 7, orderId: $0.saleKey, saleKey: $0.saleKey, status: .recorded) }
  }
}

@MainActor
private func model(
  _ api: FakeOfflineAPI, defaults: UserDefaults, uid: String = "u1", shift: String? = nil, keys: [String] = [],
  clock: @escaping () -> Int64 = { 1_700_000_100_000 }
) -> PosOfflineModel {
  final class Keys: @unchecked Sendable {
    var list: [String]
    init(_ list: [String]) { self.list = list }
    func next() -> String { list.isEmpty ? newPosOfflineSaleKey() : list.removeFirst() }
  }
  let minted = Keys(keys)
  return PosOfflineModel(
    api: api, store: PosOfflineDeviceStore(defaults: defaults, scope: "\(uid):h1"), uid: uid, registerID: { "r1" },
    locationID: { "loc1" }, shiftID: { shift }, assertion: { "cashier-1" }, now: clock, mintKey: { minted.next() })
}

final class PosOfflineStoreTests: XCTestCase {
  func testASaleIsHeldForTheMemberAndSiteThatRangItAndNobodyElse() throws {
    let defaults = suite()
    let mine = PosOfflineDeviceStore(defaults: defaults, scope: "u1:h1")
    let sale = try sampleSale("off11111111111111111111")
    XCTAssertTrue(mine.put(PosOfflineQueued(sale: sale, state: .queued, queuedAtMs: 1, attempts: 0)))
    XCTAssertEqual(mine.queue().map(\.id), ["off11111111111111111111"])
    XCTAssertTrue(PosOfflineDeviceStore(defaults: defaults, scope: "u2:h1").queue().isEmpty)
    XCTAssertTrue(PosOfflineDeviceStore(defaults: defaults, scope: "u1:h2").queue().isEmpty)
    mine.remove("off11111111111111111111")
    XCTAssertTrue(mine.queue().isEmpty)
  }

  func testSalesAreKeptOldestFirstAndPuttingTwiceReplacesNotDuplicates() throws {
    let store = PosOfflineDeviceStore(defaults: suite(), scope: "u1:h1")
    let later = try sampleSale("off22222222222222222222", soldAtMs: 2_000)
    let earlier = try sampleSale("off11111111111111111111", soldAtMs: 1_000)
    store.put(PosOfflineQueued(sale: later, state: .queued, queuedAtMs: 2, attempts: 0))
    store.put(PosOfflineQueued(sale: earlier, state: .queued, queuedAtMs: 1, attempts: 0))
    store.put(PosOfflineQueued(sale: earlier, state: .refused, queuedAtMs: 1, attempts: 3, error: "x", reason: .invalid))
    XCTAssertEqual(store.queue().map(\.id), ["off11111111111111111111", "off22222222222222222222"])
    XCTAssertEqual(store.queue().first?.state, .refused)
    XCTAssertEqual(store.queue().first?.reason, .invalid)
  }

  func testTheKitSurvivesARestart() {
    let defaults = suite()
    PosOfflineDeviceStore(defaults: defaults, scope: "u1:h1").saveKit(makeKit())
    XCTAssertEqual(PosOfflineDeviceStore(defaults: defaults, scope: "u1:h1").loadKit()?.orgId, "org1")
    XCTAssertNil(PosOfflineDeviceStore(defaults: defaults, scope: "u2:h1").loadKit())
  }

  func testAMintedKeyIsOneTheServerTakes() {
    for _ in 0..<20 { XCTAssertTrue(posOfflineSaleKeyIsValid(newPosOfflineSaleKey())) }
  }

  private func sampleSale(_ key: String, soldAtMs: Double = 1_700_000_000_000) throws -> PosOfflineSale {
    PosOfflineSale(
      cashTenderedCents: 1000, changeCents: 100, discountPct: 0, hostId: "h1",
      lines: [PosOfflineSaleLine(name: "Mug", productId: "p1", quantity: 1, unitAmountCents: 900)], orgId: "org1",
      registerId: "r1", saleKey: key, signedInUid: "u1", soldAtMs: soldAtMs, totals: OrderTotals(totalCents: 900), v: 1)
  }
}

@MainActor
final class PosOfflineModelTests: XCTestCase {
  private func ready(_ api: FakeOfflineAPI, defaults: UserDefaults, keys: [String] = [], shift: String? = nil) async -> PosOfflineModel {
    let offline = model(api, defaults: defaults, shift: shift, keys: keys)
    await offline.refreshKit()
    return offline
  }

  func testNothingSellsUntilTheRegisterHasHeardFromTheServerOnce() {
    let offline = model(FakeOfflineAPI(), defaults: suite())
    XCTAssertEqual(offline.unavailableReason, "Connect once so the register can get ready to sell offline.")
    XCTAssertFalse(offline.ready)
    XCTAssertNil(offline.totals(for: cart()))
    XCTAssertNil(offline.ringCashSale(cart: cart(), tenderedCents: 5000))
  }

  func testTheKitIsKeptAndTheSiteMayForbidOfflineSelling() async {
    let defaults = suite()
    let api = FakeOfflineAPI()
    api.kitAnswer = makeKit { $0.available = false; $0.unavailableReason = "Set your store's tax rate first." }
    let offline = await ready(api, defaults: defaults)
    XCTAssertEqual(offline.unavailableReason, "Set your store's tax rate first.")
    // Restarted, the register still knows what it was told.
    let again = model(FakeOfflineAPI(), defaults: defaults)
    XCTAssertEqual(again.kit?.available, false)
  }

  func testASiteThatRequiresAShiftNeedsOneOpenBeforeGoingOffline() async {
    let api = FakeOfflineAPI()
    api.kitAnswer = makeKit { $0.requireOpenShift = true; $0.registers = [PosOfflineKitRegister(id: "r1", name: "Front")] }
    let without = await ready(api, defaults: suite())
    XCTAssertEqual(without.unavailableReason, "Open a shift before going offline: this site requires one for every sale.")
    let live = await ready(api, defaults: suite(), shift: "s1")
    XCTAssertNil(live.unavailableReason)
  }

  func testTheBasketIsPricedFromItsOwnPricesAndTheStoresTaxRate() async {
    let offline = await ready(FakeOfflineAPI(), defaults: suite())
    let totals = offline.totals(for: cart())
    // (2 x 450 + 300) = 1200; 8% of 1200 = 96.
    XCTAssertEqual(totals?.itemsCents, 1200)
    XCTAssertEqual(totals?.taxCents, 96)
    XCTAssertEqual(totals?.totalCents, 1296)
    let discounted = offline.totals(for: cart(discount: 10))
    XCTAssertEqual(discounted?.discountCents, 120)
    XCTAssertEqual(discounted?.taxCents, 86)
    XCTAssertEqual(discounted?.totalCents, 1166)
  }

  func testACashSaleIsQueuedWithTheKeyTheCashierTheShiftAndTheChange() async {
    let defaults = suite()
    let offline = await ready(FakeOfflineAPI(), defaults: defaults, keys: ["off0123456789abcdef0123"])
    let customer = PosCustomer(kind: "contact", id: "c1", name: "Ana", email: "ana@shop.co", phone: nil)
    let rung = offline.ringCashSale(cart: cart(customer: customer), tenderedCents: 2000)
    XCTAssertNotNil(rung)
    let sale = rung!.sale
    XCTAssertEqual(sale.saleKey, "off0123456789abcdef0123")
    XCTAssertEqual(sale.hostId, "h1")
    XCTAssertEqual(sale.orgId, "org1")
    XCTAssertEqual(sale.signedInUid, "u1")
    XCTAssertEqual(sale.registerId, "r1")
    XCTAssertEqual(sale.shiftId, "s9", "the kit's open shift stands in when the register has not read its own")
    XCTAssertEqual(sale.locationId, "loc1")
    XCTAssertEqual(sale.cashierAssertion, "cashier-1")
    XCTAssertEqual(sale.soldAtMs, 1_700_000_100_000)
    XCTAssertEqual(sale.cashTenderedCents, 2000)
    XCTAssertEqual(sale.changeCents, 704)
    XCTAssertEqual(rung!.changeCents, 704)
    XCTAssertEqual(sale.lines.map(\.productId), ["p1", "p2"])
    XCTAssertEqual(sale.lines[0].quantity, 2)
    XCTAssertEqual(sale.lines[0].unitAmountCents, 450)
    XCTAssertEqual(sale.lines[0].variantId, "v1")
    XCTAssertEqual(sale.lines[0].variantLabel, "Large")
    XCTAssertEqual(sale.customer?.email, "ana@shop.co")
    XCTAssertEqual(sale.customer?.kind, "contact")
    XCTAssertEqual(sale.customer?.id, "c1")
    XCTAssertEqual(sale.totals.totalCents, 1296)
    XCTAssertTrue(rung!.hasCustomerEmail)
    // The device holds it, scoped to this member and site.
    XCTAssertEqual(offline.waiting.map(\.id), ["off0123456789abcdef0123"])
    XCTAssertEqual(PosOfflineDeviceStore(defaults: defaults, scope: "u1:h1").queue().count, 1)
  }

  func testAnEmailTypedForTheReceiptRidesWithoutARecordBehindIt() async {
    let offline = await ready(FakeOfflineAPI(), defaults: suite())
    let rung = offline.ringCashSale(cart: cart(customer: .typed(email: "buyer@shop.co")), tenderedCents: 1296)
    XCTAssertEqual(rung?.sale.customer?.email, "buyer@shop.co")
    XCTAssertNil(rung?.sale.customer?.kind)
    XCTAssertNil(rung?.sale.customer?.id)
  }

  func testNoCashIsTakenForASaleTheDeviceCannotKeepOrTheTillMayNotRing() async {
    let offline = await ready(FakeOfflineAPI(), defaults: suite())
    XCTAssertNil(offline.ringCashSale(cart: cart(), tenderedCents: 1295), "offline takes the whole total in cash")
    XCTAssertNil(offline.ringCashSale(cart: cart(discount: 25), tenderedCents: 5000), "above the site's discount ceiling")
    XCTAssertTrue(offline.discountOverLimit(cart(discount: 25)))
    XCTAssertNil(offline.ringCashSale(cart: .empty, tenderedCents: 5000))
    XCTAssertTrue(offline.waiting.isEmpty)
  }

  func testASaleLeavesTheDeviceOnlyWhenTheServerHasAnsweredForIt() async {
    let defaults = suite()
    let api = FakeOfflineAPI()
    let offline = await ready(api, defaults: defaults, keys: ["off0123456789abcdef0001", "off0123456789abcdef0002"])
    _ = offline.ringCashSale(cart: cart(), tenderedCents: 1296)
    _ = offline.ringCashSale(cart: cart(), tenderedCents: 1296)
    api.answers["off0123456789abcdef0002"] = PosOfflineSaleOutcome(
      flags: [.priceChanged, .stockShort], number: 41, orderId: "off0123456789abcdef0002", saleKey: "off0123456789abcdef0002",
      status: .replayed,
      stockConflicts: [PosOfflineStockConflict(applied: 1, name: "Latte — Large", productId: "p1", requested: 2, shortUnits: 1)])
    await offline.syncNow()
    XCTAssertEqual(api.batchesSent, [["off0123456789abcdef0001", "off0123456789abcdef0002"]])
    XCTAssertTrue(offline.queue.isEmpty)
    XCTAssertEqual(offline.notices.count, 1)
    XCTAssertEqual(offline.notices[0].number, 41)
    XCTAssertEqual(offline.notices[0].lines.first, "1 of 2× Latte — Large not in stock")
    XCTAssertTrue(offline.notices[0].lines.contains(ContractValues.shared.posOfflineFlagLabels["price-changed"] ?? ""))
    offline.dismissNotices()
    XCTAssertTrue(offline.notices.isEmpty)
  }

  func testATransientFailureStaysQueuedAndEveryOtherRefusalWaitsForTheCashier() async {
    let api = FakeOfflineAPI()
    let offline = await ready(
      api, defaults: suite(), keys: ["off0123456789abcdef0001", "off0123456789abcdef0002", "off0123456789abcdef0003"])
    for _ in 0..<3 { _ = offline.ringCashSale(cart: cart(), tenderedCents: 1296) }
    api.answers["off0123456789abcdef0001"] = PosOfflineSaleOutcome(
      error: "Try again", reason: .failed, retry: true, saleKey: "off0123456789abcdef0001", status: .refused)
    api.answers["off0123456789abcdef0002"] = PosOfflineSaleOutcome(
      error: "A line of the sale cannot be read", reason: .invalid, retry: false, saleKey: "off0123456789abcdef0002", status: .refused)
    api.answers["off0123456789abcdef0003"] = PosOfflineSaleOutcome(
      error: "Signed for another member", reason: .wrongStaff, saleKey: "off0123456789abcdef0003", status: .refused)
    await offline.syncNow()
    XCTAssertEqual(offline.queue.count, 3)
    XCTAssertEqual(offline.waiting.map(\.id), ["off0123456789abcdef0001", "off0123456789abcdef0003"])
    XCTAssertEqual(offline.refused.map(\.id), ["off0123456789abcdef0002"])
    XCTAssertEqual(offline.refused[0].error, "A line of the sale cannot be read")
    XCTAssertEqual(offline.queue.map(\.attempts), [1, 1, 1])
    offline.discard("off0123456789abcdef0002")
    XCTAssertTrue(offline.refused.isEmpty)
  }

  func testALostConnectionLeavesTheQueueAsItWasAndTellsTheRegister() async {
    let api = FakeOfflineAPI()
    let offline = await ready(api, defaults: suite())
    _ = offline.ringCashSale(cart: cart(), tenderedCents: 1296)
    final class Sink: @unchecked Sendable { var calls: [Bool] = [] }
    let sink = Sink()
    offline.networkSink = { sink.calls.append($0) }
    api.failure = ConsoleAPIError(status: 0, message: "could not be reached")
    await offline.syncNow()
    XCTAssertEqual(offline.waiting.count, 1)
    XCTAssertEqual(sink.calls, [true])
    XCTAssertNil(offline.syncError)
  }

  func testAServerRefusalOfTheWholeSyncIsShownAndTheSalesStayPut() async {
    let api = FakeOfflineAPI()
    let offline = await ready(api, defaults: suite())
    _ = offline.ringCashSale(cart: cart(), tenderedCents: 1296)
    api.failure = ConsoleAPIError(status: 403, message: "Your plan does not include the register.")
    await offline.syncNow()
    XCTAssertEqual(offline.syncError, "Your plan does not include the register.")
    XCTAssertEqual(offline.waiting.count, 1)
  }

  func testOnlyTheSalesTheSignedInMemberRangAreSent() async {
    let defaults = suite()
    let api = FakeOfflineAPI()
    let other = await ready(api, defaults: defaults, keys: ["off0123456789abcdef0009"])
    _ = other.ringCashSale(cart: cart(), tenderedCents: 1296)
    // Another member on the same device shares the device store but not the scope.
    let mine = model(api, defaults: defaults, uid: "u2")
    await mine.syncNow()
    XCTAssertTrue(api.batchesSent.isEmpty)
  }

  func testALongQueueGoesInBatchesOfTheRoutesMaximum() async {
    let api = FakeOfflineAPI()
    let keys = (0..<30).map { "off0123456789abcdef\(String(format: "%04d", $0))" }
    let offline = await ready(api, defaults: suite(), keys: keys)
    for _ in 0..<30 { _ = offline.ringCashSale(cart: cart(), tenderedCents: 1296) }
    await offline.syncNow()
    XCTAssertEqual(api.batchesSent.map(\.count), [ContractValues.shared.posOfflineSyncBatchMax, 30 - ContractValues.shared.posOfflineSyncBatchMax])
    XCTAssertTrue(offline.queue.isEmpty)
  }

  func testTheKitIsRefreshedWhenStaleAndNotBefore() async {
    final class Clock: @unchecked Sendable { var ms: Int64 = 1_700_000_000_000 }
    let clock = Clock()
    let offline = model(FakeOfflineAPI(), defaults: suite(), clock: { clock.ms })
    XCTAssertTrue(offline.kitIsStale)
    await offline.refreshKit()
    XCTAssertFalse(offline.kitIsStale)
    clock.ms += posOfflineKitRefreshMs + 1
    XCTAssertTrue(offline.kitIsStale)
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

private func client(_ transport: HTTPTransport) -> ConsoleAPIClient {
  ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "token" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
}

final class ConsolePosOfflineAPITests: XCTestCase {
  func testTheKitIsReadForTheSite() async throws {
    let transport = Recording(#"{"kit":\#(kitJSON)}"#)
    let read = try await ConsolePosOfflineAPI(api: client(transport), hostID: "h1").kit()
    XCTAssertEqual(transport.requests.last?.url?.path, "/api/commerce/pos-offline-sync")
    XCTAssertEqual(transport.requests.last?.url?.query, "hostId=h1")
    XCTAssertEqual(transport.requests.last?.httpMethod, "GET")
    XCTAssertEqual(read.tax.pct, 8)
    XCTAssertEqual(read.maxDiscountPct, 20)
    XCTAssertEqual(read.registers.first?.openShiftId, "s9")
  }

  func testASyncSendsTheSitesSalesAsTheRegisterQueuedThemAndReadsEachAnswer() async throws {
    let transport = Recording(
      #"{"results":[{"saleKey":"off0123456789abcdef0001","status":"recorded","orderId":"off0123456789abcdef0001","number":12,"flags":["late-sync"]}]}"#
    )
    let sale = PosOfflineSale(
      cashTenderedCents: 1000, changeCents: 100, customer: PosOfflineSaleCustomer(email: "a@b.co"), discountPct: 0,
      hostId: "h1", lines: [PosOfflineSaleLine(name: "Mug", productId: "p1", quantity: 1, unitAmountCents: 900)],
      orgId: "org1", registerId: "r1", saleKey: "off0123456789abcdef0001", shiftId: "s1", signedInUid: "u1",
      soldAtMs: 1_700_000_000_000, totals: OrderTotals(itemsCents: 900, totalCents: 900), v: 1)
    let results = try await ConsolePosOfflineAPI(api: client(transport), hostID: "h1").sync([sale])
    XCTAssertEqual(transport.requests.last?.httpMethod, "POST")
    XCTAssertEqual(transport.sent["hostId"] as? String, "h1")
    let sent = (transport.sent["sales"] as? [[String: Any]])?.first
    XCTAssertEqual(sent?["saleKey"] as? String, "off0123456789abcdef0001")
    XCTAssertEqual(sent?["signedInUid"] as? String, "u1")
    XCTAssertEqual(sent?["soldAtMs"] as? Int, 1_700_000_000_000)
    XCTAssertEqual(sent?["v"] as? Int, 1)
    XCTAssertEqual((sent?["lines"] as? [[String: Any]])?.first?["productId"] as? String, "p1")
    XCTAssertEqual((sent?["customer"] as? [String: Any])?["email"] as? String, "a@b.co")
    XCTAssertEqual(results.first?.status, .recorded)
    XCTAssertEqual(results.first?.number, 12)
    XCTAssertEqual(results.first?.flags, [.lateSync])
  }

  func testAnEmptyBatchOnlyAsksWhetherTheRouteAnswers() async throws {
    let transport = Recording(#"{"results":[]}"#)
    let results = try await ConsolePosOfflineAPI(api: client(transport), hostID: "h1").sync([])
    XCTAssertTrue(results.isEmpty)
    XCTAssertEqual((transport.sent["sales"] as? [Any])?.count, 0)
  }
}

/// A card taken offline on this device's reader (AGL-4039): the store's
/// ceilings, the sale it queues, and the forward that lets it sync.
@MainActor
final class PosOfflineCardTests: XCTestCase {
  private let key = "offcard0000000000000000001"

  private func cardKit(available: Bool = true, maxSale: Double = 10_000, maxDaily: Double = 500_000) -> PosOfflineKit {
    makeKit {
      $0.card = PosOfflineKitCard(
        available: available, currency: "usd", destination: "acct_merchant", maxDeviceDailyCents: maxDaily,
        maxSaleCents: maxSale, unavailableReason: available ? nil : "Card sales offline are not turned on.")
    }
  }

  private func ready(_ api: FakeOfflineAPI, keys: [String]) async -> PosOfflineModel {
    let offline = model(api, defaults: suite(), keys: keys)
    await offline.refreshKit()
    return offline
  }

  func testACardIsTakenWithinTheStoreCeilingsAndRefusedPastThem() async {
    let api = FakeOfflineAPI()
    api.kitAnswer = cardKit()
    let offline = await ready(api, keys: [key])
    XCTAssertNil(offline.cardRefusal(for: cart()))
    api.kitAnswer = cardKit(maxSale: 500)
    await offline.refreshKit()
    XCTAssertEqual(
      offline.cardRefusal(for: cart()),
      "Offline, a card sale can be up to $5.00. Take cash, or charge it when you are back online.")
    api.kitAnswer = makeKit()
    await offline.refreshKit()
    XCTAssertEqual(offline.cardRefusal(for: cart()), "Card sales offline need the register to connect once first.")
  }

  func testASaleOverTheLimitPerSaleIsRefusedBeforeTheCardIsAskedFor() async {
    let api = FakeOfflineAPI()
    api.kitAnswer = cardKit(maxSale: 1000)
    let offline = await ready(api, keys: [key])
    XCTAssertNil(offline.cardRequest(for: cart()), "no card request reaches the reader")
    XCTAssertEqual(
      offline.cardRefusal(for: cart()),
      "Offline, a card sale can be up to $10.00. Take cash, or charge it when you are back online.")
  }

  func testTheRequestCarriesTheStoreLimitsForTheSDK() async {
    let api = FakeOfflineAPI()
    api.kitAnswer = cardKit()
    let offline = await ready(api, keys: [key])
    let request = offline.cardRequest(for: cart())
    XCTAssertEqual(request?.maxSaleCents, 10_000)
    XCTAssertEqual(request?.maxDeviceDailyCents, 500_000)
    XCTAssertEqual(request?.takenTodayCents, 0)
  }

  func testWithNoLimitsSetTheRequestRunsToStripesCeilingWithNoDailyLimit() async {
    let api = FakeOfflineAPI()
    api.kitAnswer = cardKit(maxSale: 1_000_000, maxDaily: 0)
    let offline = await ready(api, keys: [key])
    let request = offline.cardRequest(for: cart())
    XCTAssertEqual(request?.maxSaleCents, 1_000_000)
    XCTAssertEqual(request?.maxDeviceDailyCents, .max)
  }

  func testTheBannerNamesTheDailyLimitOnlyWhenTheStoreSetOne() {
    let money = { (cents: Int) in "$\(cents / 100)" }
    XCTAssertEqual(
      offlineCardLimitsNote(perSaleCents: 1_000_000, perDayCents: 0, money: money),
      "The card is saved on this register and charged when the connection returns. Offline, a card sale can be up to $10000.")
    XCTAssertEqual(
      offlineCardLimitsNote(perSaleCents: 10_000, perDayCents: 500_000, money: money),
      "The card is saved on this register and charged when the connection returns. Offline, a card sale can be up to $100, and this device can take up to $5000 in cards a day.")
  }

  func testTheRequestNamesItsSaleAndTheStoreDestination() async {
    let api = FakeOfflineAPI()
    api.kitAnswer = cardKit()
    let offline = await ready(api, keys: [key])
    let request = offline.cardRequest(for: cart())
    XCTAssertEqual(request?.saleKey, key)
    XCTAssertEqual(request?.destination, "acct_merchant")
    XCTAssertEqual(request?.amountCents, 1296)
    XCTAssertEqual(request?.metadata["kind"], "pos-offline")
    XCTAssertEqual(request?.metadata["registerId"], "r1")
    XCTAssertNil(request?.problem)
  }

  func testACardOnTheDeviceWaitsForItsForwardBeforeItSyncs() async {
    let api = FakeOfflineAPI()
    api.kitAnswer = cardKit()
    let offline = await ready(api, keys: [])
    let rung = offline.ringCardSale(
      cart: cart(), taken: OfflineCardTaken(saleKey: key, paymentIntentID: nil, brand: "visa", last4: "4242"))
    XCTAssertEqual(rung?.card?.forward, .stored)
    XCTAssertEqual(rung?.sale.cashTenderedCents, 0)
    XCTAssertEqual(offline.cardsTakenTodayCents, 1296)
    XCTAssertNotNil(offline.oldestCardOnDeviceMs)
    XCTAssertEqual(offline.waitingCardCents, 1296)
    await offline.syncNow()
    XCTAssertTrue(api.batchesSent.isEmpty, "Stripe has not got the card yet")
    // Stripe's forward arrives: the card is authorized and the sale syncs.
    let applied = offline.applyForwards([
      OfflineCardForward(saleKey: key, paymentIntentID: "pi_3Q0abcdEFGH12345", status: .authorized),
      OfflineCardForward(saleKey: "someone-elses-sale-0000", paymentIntentID: "pi_x", status: .authorized),
    ])
    XCTAssertEqual(applied, [key])
    XCTAssertEqual(offline.queue.first?.sale.card?.paymentIntentId, "pi_3Q0abcdEFGH12345")
    XCTAssertNil(offline.oldestCardOnDeviceMs, "Stripe has the card now")
    XCTAssertEqual(offline.cardsTakenTodayCents, 1296, "the daily limit still counts it")
    await offline.syncNow()
    XCTAssertEqual(api.batchesSent, [[key]])
    XCTAssertTrue(offline.queue.isEmpty)
  }

  func testADeclineAfterTheSaleIsToldOnItsOwnWithTheCard() async {
    let api = FakeOfflineAPI()
    api.kitAnswer = cardKit()
    api.answers[key] = PosOfflineSaleOutcome(
      flags: [.cardDeclined], number: 1042, orderId: key, saleKey: key, status: .recorded)
    let offline = await ready(api, keys: [])
    _ = offline.ringCardSale(cart: cart(), taken: OfflineCardTaken(saleKey: key, paymentIntentID: nil, brand: "visa", last4: "4242"))
    offline.applyForwards([
      OfflineCardForward(saleKey: key, paymentIntentID: "pi_3Q0abcdEFGH12345", status: .declined, message: "Your card was declined.")
    ])
    XCTAssertEqual(offline.queue.first?.sale.card?.forward, .declined)
    await offline.syncNow()
    let notice = offline.notices.first
    XCTAssertEqual(notice?.cardUnpaid, true)
    XCTAssertEqual(notice?.card?.last4, "4242")
    XCTAssertEqual(notice?.totalCents, 1296)
    XCTAssertEqual(notice?.lines, [], "the declined card is said once, in its own notice")
    offline.dismissNotice(key)
    XCTAssertTrue(offline.notices.isEmpty)
  }

  func testTheDailyLimitPerDeviceCountsEveryCardTakenTodayAndResetsTomorrow() async {
    let api = FakeOfflineAPI()
    api.kitAnswer = cardKit(maxDaily: 2000)
    let defaults = suite()
    var day = "2026-10-25"
    let offline = PosOfflineModel(
      api: api, store: PosOfflineDeviceStore(defaults: defaults, scope: "u1:h1"), uid: "u1", registerID: { "r1" },
      locationID: { "loc1" }, shiftID: { nil }, assertion: { nil }, now: { 1_700_000_100_000 }, today: { day })
    await offline.refreshKit()
    _ = offline.ringCardSale(cart: cart(), taken: OfflineCardTaken(saleKey: key, paymentIntentID: nil))
    XCTAssertEqual(
      offline.cardRefusal(for: cart()),
      "This device has taken $12.96 in cards offline today, and its daily limit is $20.00. Take cash, or wait for the connection.")
    // Another member on the same device counts too: the limit is the device's.
    XCTAssertEqual(PosOfflineDeviceStore(defaults: defaults, scope: "u2:h1").cardsTaken(on: day), 1296)
    day = "2026-10-26"
    XCTAssertNil(offline.cardRefusal(for: cart()))
  }

  func testCardsWaitingADayAskToReconnectNow() async {
    let api = FakeOfflineAPI()
    api.kitAnswer = cardKit()
    var clock: Int64 = 1_700_000_100_000
    let offline = PosOfflineModel(
      api: api, store: PosOfflineDeviceStore(defaults: suite(), scope: "u1:h1"), uid: "u1", registerID: { "r1" },
      locationID: { "loc1" }, shiftID: { nil }, assertion: { nil }, now: { clock }, today: { "2026-10-25" })
    await offline.refreshKit()
    _ = offline.ringCardSale(cart: cart(), taken: OfflineCardTaken(saleKey: key, paymentIntentID: nil))
    XCTAssertFalse(offline.cardsWaitedTooLong)
    clock += 25 * 60 * 60 * 1000
    XCTAssertTrue(offline.cardsWaitedTooLong)
  }
}
