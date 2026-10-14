// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

private func cart(discount: Int = 0) -> Cart {
  Cart.empty
    .adding(CartPick(productID: "p1", variantID: "v1", name: "Latte", variantLabel: "Large", unitCents: 450), quantity: 2)
    .adding(CartPick(productID: "p2", variantID: nil, name: "Muffin", variantLabel: nil, unitCents: 300))
    .withDiscount(Double(discount))
}

private func sale(status: String = "pending", total: Int = 1296, paid: Int = 0, due: Int = 1296, tip: Int = 0) -> PosSale {
  PosSale(
    orderID: "o1", status: status, totalCents: total, paidCents: paid, dueCents: due, tenderableCents: due, tipCents: tip, payments: [])
}

final class PosDisplayStateTests: XCTestCase {
  func testAnEmptyBasketIsIdle() {
    XCTAssertEqual(posDisplayBasketState(cart: .empty, sale: nil, pendingTipCents: 0, now: 5).mode, .idle)
  }

  func testTheBasketShowsItsLinesAndTheEstimateBeforeASaleIsOpen() {
    let state = posDisplayBasketState(cart: cart(discount: 10), sale: nil, pendingTipCents: 0, now: 5)
    XCTAssertEqual(state.mode, .cart)
    XCTAssertEqual(state.cart?.lines.map(\.name), ["Latte", "Muffin"])
    XCTAssertEqual(state.cart?.lines.first?.amountCents, 900)
    XCTAssertEqual(state.cart?.lines.first?.quantity, 2)
    XCTAssertEqual(state.cart?.lines.first?.variantLabel, "Large")
    XCTAssertEqual(state.cart?.itemsCents, 1200)
    XCTAssertEqual(state.cart?.discountCents, 120)
    XCTAssertEqual(state.cart?.totalCents, 1080)
    XCTAssertEqual(state.cart?.taxCents, 0)
    XCTAssertNil(state.cart?.paidCents)
    XCTAssertEqual(state.updatedAtMs, 5)
  }

  func testAnOpenSaleShowsTheServersTotalTaxPaidDueAndTip() {
    let open = sale(total: 1166, paid: 500, due: 666, tip: 100)
    let state = posDisplayBasketState(cart: cart(discount: 10), sale: open, pendingTipCents: 50, now: 5)
    XCTAssertEqual(state.cart?.totalCents, 1166)
    XCTAssertEqual(state.cart?.taxCents, 86, "the server's total less the estimate")
    XCTAssertEqual(state.cart?.paidCents, 500)
    XCTAssertEqual(state.cart?.dueCents, 666)
    XCTAssertEqual(state.cart?.tipCents, 150, "the tips already on payments plus the one chosen for the next")
  }

  func testAPaidSaleCountsNoPendingTip() {
    XCTAssertEqual(posDisplayTipCents(saleStatus: "paid", saleTipCents: 100, pendingTipCents: 50), 100)
    XCTAssertEqual(posDisplayTipCents(saleStatus: "pending", saleTipCents: 100, pendingTipCents: -5), 100)
  }

  func testThePromptsAskForWhatTheStoreOffers() {
    let tip = posDisplayTipPrompt(baseCents: 1296, percentages: [15, 20], now: 7)
    XCTAssertEqual(tip.mode, .tip)
    XCTAssertEqual(tip.tip?.baseCents, 1296)
    XCTAssertEqual(tip.tip?.percentages, [15, 20])
    XCTAssertEqual(tip.tip?.allowCustom, true)
    let receipt = posDisplayReceiptPrompt(smsAvailable: false, offerMarketing: true, now: 7)
    XCTAssertEqual(receipt.receipt?.channels, [.email, .print, .none])
    XCTAssertEqual(receipt.receipt?.offerMarketing, true)
    XCTAssertEqual(posDisplayReceiptPrompt(smsAvailable: true, offerMarketing: false, now: 7).receipt?.channels, [.email, .sms, .print, .none])
    XCTAssertEqual(posDisplayProcessing(now: 7).processing?.message, "Tap, insert or swipe your card on the reader.")
  }
}

private final class ScriptedDisplay: PosDisplayAPI, @unchecked Sendable {
  private let lock = NSLock()
  private var recorded: [String] = []
  private var pushedStates: [PosDisplayState] = []
  var calls: [String] { lock.withLock { recorded } }
  var pushes: [PosDisplayState] { lock.withLock { pushedStates } }
  var connected = true
  var state: PosDisplayState?
  var failure: ConsoleAPIError?
  var devicesAnswer: [PosPairedDevice] = []
  /// Called on every `state` read, so a test can answer the prompt while the register waits.
  var onRead: (@Sendable (ScriptedDisplay) -> Void)?

  func state(registerID: String) async throws -> (state: PosDisplayState?, connected: Bool) {
    lock.withLock { recorded.append("state \(registerID)") }
    if let failure { throw failure }
    onRead?(self)
    return (state, connected)
  }

  func push(registerID: String, state: PosDisplayState) async throws {
    lock.withLock {
      recorded.append("push \(registerID) \(state.mode.rawValue)")
      pushedStates.append(state)
    }
    if let failure { throw failure }
    self.state = state
  }

  func pairingCode(registerID: String, mode: PosDeviceMode) async throws -> PosPairingCode {
    lock.withLock { recorded.append("code \(registerID) \(mode.rawValue)") }
    if let failure { throw failure }
    return PosPairingCode(code: "123456", expiresAtMs: 1_000_000)
  }

  func devices(registerID: String) async throws -> [PosPairedDevice] {
    lock.withLock { recorded.append("devices \(registerID)") }
    if let failure { throw failure }
    return devicesAnswer
  }

  func revoke(registerID: String, deviceID: String) async throws -> Int {
    lock.withLock { recorded.append("revoke \(deviceID)") }
    devicesAnswer.removeAll { $0.id == deviceID || deviceID == "*" }
    return 1
  }
}

@MainActor
final class PosDisplayControlTests: XCTestCase {
  private func control(_ api: ScriptedDisplay, timeout: Duration = .seconds(5), poll: Duration = .seconds(1)) -> PosDisplayControl {
    PosDisplayControl(
      api: api, registerID: { "r1" }, now: { 1_000 }, sleep: { _ in await Task.yield() }, mintKey: { "prompt-1" }, timeout: timeout, poll: poll)
  }

  func testTheRegisterKnowsWhetherADisplayIsConnected() async {
    let api = ScriptedDisplay()
    let display = control(api)
    XCTAssertFalse(display.connected)
    await display.check()
    XCTAssertTrue(display.connected)
    api.connected = false
    await display.check()
    XCTAssertFalse(display.connected)
    api.failure = ConsoleAPIError(status: 0, message: "lost")
    api.connected = true
    await display.check()
    XCTAssertFalse(display.connected, "a lost answer is not a connected display")
  }

  func testNothingIsShownWithoutAConnectedDisplay() async {
    let api = ScriptedDisplay()
    let display = control(api)
    await display.show(PosDisplayState(mode: .idle, updatedAtMs: 1))
    XCTAssertTrue(api.pushes.isEmpty)
    await display.check()
    await display.show(PosDisplayState(mode: .idle, updatedAtMs: 1))
    XCTAssertEqual(api.pushes.map(\.mode), [.idle])
  }

  func testAskPushesAPromptAndReturnsTheCustomersAnswerToThatPrompt() async {
    let api = ScriptedDisplay()
    var reads = 0
    api.onRead = { api in
      reads += 1
      guard reads == 3 else { return }
      var answered = api.state
      answered?.response = PosDisplayResponse(atMs: 2, promptId: "prompt-1", tipCents: 200, tipChoice: .percent, tipPercent: 15)
      api.state = answered
    }
    let display = control(api)
    let answer = await display.ask(posDisplayTipPrompt(baseCents: 1000, percentages: [15], now: 1))
    XCTAssertEqual(api.pushes.first?.promptId, "prompt-1")
    XCTAssertEqual(api.pushes.first?.mode, .tip)
    XCTAssertEqual(answer?.tipCents, 200)
    XCTAssertEqual(answer?.tipPercent, 15)
    XCTAssertNil(display.asking, "answered, the register is no longer waiting")
  }

  func testAStaleAnswerIsNotTheCustomersAnswer() async {
    let api = ScriptedDisplay()
    api.onRead = { api in
      var stale = api.state
      stale?.response = PosDisplayResponse(atMs: 2, promptId: "an-older-prompt", tipCents: 999, tipChoice: .custom)
      api.state = stale
    }
    let display = control(api, timeout: .seconds(3))
    let answer = await display.ask(posDisplayTipPrompt(baseCents: 1000, percentages: [15], now: 1))
    XCTAssertNil(answer)
  }

  func testACustomerWhoNeverAnswersTimesOutAndTheRegisterMovesOn() async {
    let api = ScriptedDisplay()
    let display = control(api, timeout: .seconds(4))
    let answer = await display.ask(posDisplayReceiptPrompt(smsAvailable: false, offerMarketing: false, now: 1))
    XCTAssertNil(answer)
    XCTAssertEqual(api.calls.filter { $0.hasPrefix("state") }.count, 4)
    XCTAssertNil(display.asking)
  }

  func testTheCashierCancelsTheWaitAndTheScreenIsFreeAgain() async {
    let api = ScriptedDisplay()
    var display: PosDisplayControl!
    var reads = 0
    api.onRead = { _ in
      reads += 1
      if reads == 2 { Task { @MainActor in display.cancelAsk() } }
    }
    display = control(api, timeout: .seconds(60))
    let answer = await display.ask(posDisplayTipPrompt(baseCents: 1000, percentages: [15], now: 1))
    XCTAssertNil(answer)
    XCTAssertLessThan(reads, 10, "a cancelled ask stops polling")
    XCTAssertNil(display.asking)
  }

  func testAPromptIsNotShownOverWhileWaiting() async {
    let api = ScriptedDisplay()
    var display: PosDisplayControl!
    var reads = 0
    api.onRead = { _ in
      reads += 1
      if reads == 1 {
        Task { @MainActor in
          // While the tip prompt waits, the basket mirror asks to show the cart: it must not overwrite the prompt.
          await display.show(PosDisplayState(mode: .cart, updatedAtMs: 3))
          display.cancelAsk()
        }
      }
    }
    display = control(api, timeout: .seconds(30))
    await display.check()
    _ = await display.ask(posDisplayTipPrompt(baseCents: 1000, percentages: [15], now: 1))
    XCTAssertEqual(api.pushes.map(\.mode), [.tip])
  }

  func testAFailedPushIsNoAnswerAndWaitsForNothing() async {
    let api = ScriptedDisplay()
    api.failure = ConsoleAPIError(status: 401, message: "This display is not paired.")
    let display = control(api)
    let answer = await display.ask(posDisplayTipPrompt(baseCents: 1000, percentages: [15], now: 1))
    XCTAssertNil(answer)
    XCTAssertNil(display.asking)
  }

  func testPairingMakesACodeAndListsAndSignsOutScreens() async {
    let api = ScriptedDisplay()
    api.devicesAnswer = [
      PosPairedDevice(id: "abcd1234abcd1234", label: "Front display", mode: .display, createdAtMs: 1, lastSeenAtMs: 1_000),
      PosPairedDevice(id: "ffff0000ffff0000", label: "Kiosk", mode: .kiosk, createdAtMs: 1, lastSeenAtMs: 1_000),
    ]
    let display = control(api)
    await display.newPairingCode(.kiosk)
    XCTAssertEqual(display.pairing?.code, "123456")
    XCTAssertEqual(display.pairing?.spoken, "123 456")
    XCTAssertEqual(display.pairingMode, .kiosk)
    XCTAssertEqual(api.calls.last, "code r1 kiosk")
    display.closePairing()
    XCTAssertNil(display.pairing)
    await display.loadDevices()
    XCTAssertEqual(display.devices.map(\.label), ["Front display", "Kiosk"])
    await display.revoke("abcd1234abcd1234")
    XCTAssertEqual(display.notice, "Screen signed out")
    XCTAssertEqual(display.devices.map(\.label), ["Kiosk"])
    XCTAssertTrue(display.devices[0].connected(now: 1_000 + 119_000))
    XCTAssertFalse(display.devices[0].connected(now: 1_000 + 121_000))
  }

  func testACodeThatCouldNotBeMadeSaysWhy() async {
    let api = ScriptedDisplay()
    api.failure = ConsoleAPIError(status: 403, message: "Pairing needs the register permission.")
    let display = control(api)
    await display.newPairingCode(.display)
    XCTAssertNil(display.pairing)
    XCTAssertEqual(display.error, "Pairing needs the register permission.")
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

final class ConsolePosDisplayAPITests: XCTestCase {
  func testTheStateIsReadWithTheSiteAndRegisterAndAnswersConnected() async throws {
    let transport = Recording(
      #"{"connected":true,"state":{"mode":"tip","updatedAtMs":5,"promptId":"p","tip":{"baseCents":1000,"percentages":[15],"allowCustom":true},"response":{"promptId":"p","atMs":6,"tipChoice":"none","tipCents":0}}}"#)
    let read = try await ConsolePosDisplayAPI(api: client(transport), hostID: "h1").state(registerID: "r1")
    XCTAssertEqual(transport.requests.last?.httpMethod, "GET")
    XCTAssertEqual(transport.requests.last?.url?.path, "/api/commerce/pos-display")
    let query = transport.requests.last?.url?.query ?? ""
    XCTAssertTrue(query.contains("action=state") && query.contains("hostId=h1") && query.contains("registerId=r1"))
    XCTAssertTrue(read.connected)
    XCTAssertEqual(read.state?.mode, .tip)
    XCTAssertEqual(read.state?.response?.tipChoice, PosDisplayResponseTipChoice.none)
  }

  func testNoStateYetIsNoStateNotAnError() async throws {
    let transport = Recording(#"{"state":null,"connected":false}"#)
    let read = try await ConsolePosDisplayAPI(api: client(transport), hostID: "h1").state(registerID: "r1")
    XCTAssertNil(read.state)
    XCTAssertFalse(read.connected)
  }

  func testPushSendsTheStateTheRegisterMeans() async throws {
    let transport = Recording(#"{"ok":true,"promptId":"p"}"#)
    let state = PosDisplayState(mode: .tip, promptId: "p", tip: PosDisplayStateTip(allowCustom: true, baseCents: 1000, percentages: [15, 20]), updatedAtMs: 5)
    try await ConsolePosDisplayAPI(api: client(transport), hostID: "h1").push(registerID: "r1", state: state)
    XCTAssertEqual(transport.sent["action"] as? String, "push")
    XCTAssertEqual(transport.sent["registerId"] as? String, "r1")
    let sent = transport.sent["state"] as? [String: Any]
    XCTAssertEqual(sent?["mode"] as? String, "tip")
    XCTAssertEqual(sent?["promptId"] as? String, "p")
    XCTAssertEqual((sent?["tip"] as? [String: Any])?["percentages"] as? [Int], [15, 20])
  }

  func testPairingDevicesAndRevokeSpeakTheRoutesWords() async throws {
    let code = Recording(#"{"code":"654321","expiresAtMs":1700000600000}"#)
    let made = try await ConsolePosDisplayAPI(api: client(code), hostID: "h1").pairingCode(registerID: "r1", mode: .kiosk)
    XCTAssertEqual(code.sent["action"] as? String, "pairing-code")
    XCTAssertEqual(code.sent["mode"] as? String, "kiosk")
    XCTAssertEqual(made, PosPairingCode(code: "654321", expiresAtMs: 1_700_000_600_000))

    let devices = Recording(
      #"{"displays":[{"id":"abcd1234abcd1234","label":"Front","mode":"kiosk","createdAtMs":1,"lastSeenAtMs":2},{"id":"0000111122223333","label":"Old","createdAtMs":1,"lastSeenAtMs":2}]}"#)
    let listed = try await ConsolePosDisplayAPI(api: client(devices), hostID: "h1").devices(registerID: "r1")
    XCTAssertEqual(devices.sent["action"] as? String, "displays")
    XCTAssertEqual(listed.map(\.mode), [.kiosk, .display], "a token from before kiosks is a display")

    let revoke = Recording(#"{"revoked":2}"#)
    let count = try await ConsolePosDisplayAPI(api: client(revoke), hostID: "h1").revoke(registerID: "r1", deviceID: "*")
    XCTAssertEqual(revoke.sent["action"] as? String, "revoke")
    XCTAssertEqual(revoke.sent["displayId"] as? String, "*")
    XCTAssertEqual(count, 2)
  }
}

@MainActor
final class RegisterDisplayMirrorTests: XCTestCase {
  private final class Nothing: FirestoreListening, @unchecked Sendable { func remove() {} }

  private final class EmptyReader: FirestoreReader, @unchecked Sendable {
    @MainActor
    func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening { Nothing() }
    @MainActor
    func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening { Nothing() }
    func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
    func deleteDocument(_ path: [String]) async throws {}
  }

  private func register(_ display: ScriptedDisplay) -> RegisterModel {
    let api = ConsoleAPIClient(
      origin: "https://console.test", getIDToken: { _ in "token" }, transport: Recording("{}"), sleep: { _ in }, maxAttempts: 1)
    let model = RegisterModel(
      hostID: "h1", reader: EmptyReader(), api: api, collector: nil, defaults: UserDefaults(suiteName: "mirror-\(UUID().uuidString)")!,
      displayAPI: display)
    model.selectRegister(PosRegister(id: "r1", name: "Front", locationID: nil))
    return model
  }

  private func item() -> PosItem {
    let variant = PosVariant(id: "default", label: nil, unitCents: 450, sku: nil, barcode: nil, inventory: 5)
    return PosItem(
      id: "p1", name: "Latte", imageURL: nil, variants: [variant], categoryIDs: [], modifierGroups: [], quickKey: false, fromCents: 450,
      toCents: 450)
  }

  func testTheBasketFollowsTheDisplayAndAnEmptiedBasketSendsItIdle() async {
    let api = ScriptedDisplay()
    let model = register(api)
    await model.display.check()
    await model.mirrorToDisplay()
    XCTAssertTrue(api.pushes.isEmpty, "nothing to show and nothing shown")
    model.tap(item())
    await model.mirrorToDisplay()
    XCTAssertEqual(api.pushes.map(\.mode), [.cart])
    XCTAssertEqual(api.pushes.last?.cart?.totalCents, 450)
    model.clearCart()
    await model.mirrorToDisplay()
    XCTAssertEqual(api.pushes.map(\.mode), [.cart, .idle])
    await model.mirrorToDisplay()
    XCTAssertEqual(api.pushes.count, 2, "idle once, not on every beat")
  }

  func testNothingIsMirroredToADisplayThatIsNotConnected() async {
    let api = ScriptedDisplay()
    api.connected = false
    let model = register(api)
    await model.display.check()
    model.tap(item())
    await model.mirrorToDisplay()
    XCTAssertTrue(api.pushes.isEmpty)
  }
}
