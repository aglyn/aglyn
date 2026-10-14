// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

private func suite() -> UserDefaults {
  let name = "pos-device-\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: name)!
  defaults.removePersistentDomain(forName: name)
  return defaults
}

private func state(
  _ mode: PosDisplayMode, promptId: String? = nil, cart: PosDisplayCart? = nil, tip: PosDisplayStateTip? = nil,
  receipt: PosDisplayStateReceipt? = nil, processing: PosDisplayStateProcessing? = nil, updatedAtMs: Double = 1
) -> PosDisplayState {
  PosDisplayState(
    cart: cart, currency: "usd", mode: mode, processing: processing, promptId: promptId, receipt: receipt, tip: tip,
    updatedAtMs: updatedAtMs)
}

private let basket = PosDisplayCart(
  discountCents: 0, dueCents: nil, itemsCents: 900,
  lines: [PosDisplayLine(amountCents: 900, name: "Latte", quantity: 2, variantLabel: "Large")], paidCents: nil, taxCents: 0,
  tipCents: nil, totalCents: 900)

private final class ScriptedDevice: PosDeviceAPI, @unchecked Sendable {
  private let lock = NSLock()
  private var recorded: [String] = []
  var calls: [String] { lock.withLock { recorded } }
  var pairing: Result<PosPaired, ConsoleAPIError> = .success(PosPaired(token: "tok-1", mode: .display, branding: nil))
  var polls: [Result<(read: PosDisplayRead, branding: PosDeviceBranding?), ConsoleAPIError>] = []
  var respondFailure: ConsoleAPIError?
  var answers: [PosDisplayAnswer] = []

  func pair(code: String, mode: PosDeviceMode) async throws -> PosPaired {
    lock.withLock { recorded.append("pair \(code) \(mode.rawValue)") }
    return try pairing.get()
  }

  func poll(token: String, withBranding: Bool) async throws -> (read: PosDisplayRead, branding: PosDeviceBranding?) {
    lock.withLock { recorded.append("poll \(token) \(withBranding)") }
    guard !polls.isEmpty else { throw ConsoleAPIError(status: 0, message: "lost") }
    return try polls.removeFirst().get()
  }

  func respond(token: String, answer: PosDisplayAnswer) async throws {
    lock.withLock { recorded.append("respond \(token) \(answer.promptID)") }
    if let respondFailure { throw respondFailure }
    answers.append(answer)
  }

  func forget(token: String) async throws { lock.withLock { recorded.append("forget \(token)") } }
}

private func read(_ state: PosDisplayState, answered: Bool = false) -> Result<(read: PosDisplayRead, branding: PosDeviceBranding?), ConsoleAPIError> {
  .success((PosDisplayRead(state: state, answered: answered), nil))
}

@MainActor
final class PosCustomerDisplayModelTests: XCTestCase {
  private final class Clock: @unchecked Sendable { var ms: Int64 = 1_000_000 }

  private func model(_ api: ScriptedDevice, defaults: UserDefaults = suite(), clock: Clock = Clock()) -> PosCustomerDisplayModel {
    PosCustomerDisplayModel(api: api, store: PosDeviceTokenStore(defaults: defaults, mode: .display), now: { clock.ms })
  }

  func testAnUnpairedDisplayAsksForACodeAndAPairedOneComesBackAfterARelaunch() async {
    let defaults = suite()
    let api = ScriptedDevice()
    let first = model(api, defaults: defaults)
    first.start()
    XCTAssertNil(first.token)
    await first.pair(code: "123 456")
    XCTAssertEqual(api.calls, ["pair 123456 display"])
    XCTAssertEqual(first.token, "tok-1")
    let again = model(api, defaults: defaults)
    again.start()
    XCTAssertEqual(again.token, "tok-1", "the token is the one thing the tablet keeps")
  }

  func testAShortCodeIsNotSent() async {
    let api = ScriptedDevice()
    let display = model(api)
    display.start()
    await display.pair(code: "12345")
    XCTAssertTrue(api.calls.isEmpty)
  }

  func testAWrongCodeShowsTheRoutesWords() async {
    let api = ScriptedDevice()
    api.pairing = .failure(ConsoleAPIError(status: 404, message: "That code is not valid. Show a new code on the register."))
    let display = model(api)
    display.start()
    await display.pair(code: "000000")
    XCTAssertNil(display.token)
    XCTAssertEqual(display.pairError, "That code is not valid. Show a new code on the register.")
  }

  func testTheScreenFollowsTheRegistersMode() async {
    let api = ScriptedDevice()
    let display = model(api)
    display.start()
    await display.pair(code: "123456")
    XCTAssertEqual(display.screen, .idle)
    api.polls = [read(state(.cart, cart: basket))]
    await display.poll()
    XCTAssertEqual(display.screen, .cart(basket))
    XCTAssertEqual(display.pollDelay, posDisplayActivePoll)
    api.polls = [read(state(.idle))]
    await display.poll()
    XCTAssertEqual(display.pollDelay, posDisplayIdlePoll)

    let tip = PosDisplayStateTip(allowCustom: true, baseCents: 900, percentages: [15, 20])
    api.polls = [read(state(.tip, promptId: "p1", tip: tip))]
    await display.poll()
    XCTAssertEqual(display.screen, .tip(tip, promptID: "p1"))

    let receipt = PosDisplayStateReceipt(channels: [.email, .print, .none], offerMarketing: true)
    api.polls = [read(state(.receipt, promptId: "p2", receipt: receipt))]
    await display.poll()
    XCTAssertEqual(display.screen, .receipt(receipt, promptID: "p2"))

    api.polls = [
      read(
        state(
          .processing, cart: PosDisplayCart(discountCents: 0, dueCents: 500, itemsCents: 900, lines: [], paidCents: 400, taxCents: 0, tipCents: nil, totalCents: 900),
          processing: PosDisplayStateProcessing(message: "Tap your card.")))
    ]
    await display.poll()
    XCTAssertEqual(display.screen, .processing(message: "Tap your card.", total: 500))
  }

  func testAPromptWithoutItsInputsFallsBackToTheBasketOrIdle() async {
    let api = ScriptedDevice()
    let display = model(api)
    display.start()
    await display.pair(code: "123456")
    api.polls = [read(state(.tip, promptId: "p1", cart: basket))]
    await display.poll()
    XCTAssertEqual(display.screen, .cart(basket))
    api.polls = [read(state(.receipt))]
    await display.poll()
    XCTAssertEqual(display.screen, .idle)
  }

  func testAnAnsweredPromptWaitsForTheCashierWhetherThisScreenOrAnotherAnsweredIt() async {
    let api = ScriptedDevice()
    let display = model(api)
    display.start()
    await display.pair(code: "123456")
    let tip = PosDisplayStateTip(allowCustom: false, baseCents: 900, percentages: [15])
    api.polls = [read(state(.tip, promptId: "p1", tip: tip))]
    await display.poll()
    await display.answer(PosDisplayAnswer(promptID: "p1", tipChoice: .percent, tipPercent: 15))
    XCTAssertEqual(api.calls.last, "respond tok-1 p1")
    XCTAssertEqual(display.screen, .answered, "the answer shows at once, before the next poll")
    api.polls = [read(state(.tip, promptId: "p3", tip: tip), answered: true)]
    await display.poll()
    XCTAssertEqual(display.screen, .answered, "answered somewhere else")
  }

  func testAThankYouReturnsToIdleOnItsOwn() async {
    let clock = Clock()
    let api = ScriptedDevice()
    let display = model(api, clock: clock)
    display.start()
    await display.pair(code: "123456")
    api.polls = [read(state(.thanks, updatedAtMs: 5))]
    await display.poll()
    XCTAssertEqual(display.screen, .thanks)
    clock.ms += Int64(ContractValues.shared.posDisplayThanksMs) + 1
    XCTAssertEqual(display.screen, .idle)
  }

  func testAnUnpairedTokenSendsTheDisplayBackToPairing() async {
    let defaults = suite()
    let api = ScriptedDevice()
    let display = model(api, defaults: defaults)
    display.start()
    await display.pair(code: "123456")
    api.polls = [.failure(ConsoleAPIError(status: 401, message: "This display is not paired."))]
    await display.poll()
    XCTAssertNil(display.token)
    XCTAssertNil(PosDeviceTokenStore(defaults: defaults, mode: .display).token)
  }

  func testALostConnectionKeepsTheScreenAndSaysItIsReconnecting() async {
    let api = ScriptedDevice()
    let display = model(api)
    display.start()
    await display.pair(code: "123456")
    api.polls = [read(state(.cart, cart: basket))]
    await display.poll()
    await display.poll()
    XCTAssertTrue(display.offline)
    XCTAssertEqual(display.screen, .cart(basket))
    api.polls = [read(state(.cart, cart: basket))]
    await display.poll()
    XCTAssertFalse(display.offline)
  }

  func testAScreenThatMovedOnSaysSoAndAnUnpairedOneLeaves() async {
    let api = ScriptedDevice()
    let display = model(api)
    display.start()
    await display.pair(code: "123456")
    api.respondFailure = ConsoleAPIError(status: 409, message: "x")
    await display.answer(PosDisplayAnswer(promptID: "old", tipChoice: PosDisplayResponseTipChoice.none))
    XCTAssertEqual(display.notice, "That screen has moved on. Check the display.")
    api.respondFailure = ConsoleAPIError(status: 401, message: "x")
    await display.answer(PosDisplayAnswer(promptID: "old", tipChoice: PosDisplayResponseTipChoice.none))
    XCTAssertNil(display.token)
  }

  func testUnpairingForgetsTheTokenOnTheServerToo() async {
    let api = ScriptedDevice()
    let display = model(api)
    display.start()
    await display.pair(code: "123456")
    await display.unpair()
    XCTAssertEqual(api.calls.last, "forget tok-1")
    XCTAssertNil(display.token)
  }

  func testBrandingIsReReadWhenItIsStale() async {
    let clock = Clock()
    let api = ScriptedDevice()
    let display = model(api, clock: clock)
    display.start()
    await display.pair(code: "123456")
    api.polls = [read(state(.idle)), read(state(.idle))]
    await display.poll()
    clock.ms += posDeviceBrandingRefreshMs + 1
    await display.poll()
    XCTAssertEqual(api.calls.filter { $0.hasPrefix("poll") }, ["poll tok-1 false", "poll tok-1 true"])
  }
}

final class PosDisplayAnswerTests: XCTestCase {
  func testTheAnswerCarriesOnlyWhatTheCustomerChose() {
    XCTAssertEqual(
      PosDisplayAnswer(promptID: "p", tipChoice: .percent, tipPercent: 20).json,
      .object(["promptId": "p", "tipChoice": "percent", "tipPercent": .number(20)]))
    XCTAssertEqual(
      PosDisplayAnswer(promptID: "p", tipChoice: .custom, tipCents: 350).json,
      .object(["promptId": "p", "tipChoice": "custom", "tipCents": .number(350)]))
    XCTAssertEqual(
      PosDisplayAnswer(promptID: "p", receiptChannel: .email, email: "a@b.co", marketingOptIn: true).json,
      .object(["promptId": "p", "receiptChannel": "email", "email": "a@b.co", "marketingOptIn": .bool(true)]))
    XCTAssertEqual(PosDisplayAnswer(promptID: "p", receiptChannel: .sms, phone: "+15550100199").json["phone"], "+15550100199")
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
  // No token source answers: a paired screen is anonymous, so a call that asked for one would fail.
  ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in nil }, transport: transport, sleep: { _ in }, maxAttempts: 1)
}

final class ConsolePosDeviceAPITests: XCTestCase {
  func testPairingSendsTheCodeAndTheKindOfScreenWithoutASession() async throws {
    let transport = Recording(
      #"{"token":"abc","mode":"display","branding":{"name":"Corner Cafe","logoUrl":"https://x.test/l.png","logoDarkUrl":null,"message":"Welcome in"}}"#)
    let paired = try await ConsolePosDeviceAPI(api: client(transport)).pair(code: "123456", mode: .display)
    let request = transport.requests.last!
    XCTAssertEqual(request.url?.path, "/api/commerce/pos-display")
    XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    XCTAssertEqual(transport.sent["action"] as? String, "pair")
    XCTAssertEqual(transport.sent["code"] as? String, "123456")
    XCTAssertEqual(transport.sent["mode"] as? String, "display")
    XCTAssertEqual(transport.sent["label"] as? String, "Customer display")
    XCTAssertEqual(paired.token, "abc")
    XCTAssertEqual(paired.branding?.name, "Corner Cafe")
    XCTAssertEqual(paired.branding?.logoURL?.absoluteString, "https://x.test/l.png")
    XCTAssertNil(paired.branding?.logoDarkURL)
  }

  func testAPollCarriesTheTokenInItsHeaderAndReadsTheScreen() async throws {
    let transport = Recording(
      #"{"state":{"mode":"cart","updatedAtMs":5,"currency":"usd","answered":false,"cart":{"lines":[{"name":"Latte","quantity":2,"amountCents":900}],"itemsCents":900,"discountCents":0,"taxCents":0,"totalCents":900}},"branding":{"name":"Cafe","logoUrl":null,"logoDarkUrl":null,"message":"Hi"}}"#)
    let answer = try await ConsolePosDeviceAPI(api: client(transport)).poll(token: "tok", withBranding: true)
    let request = transport.requests.last!
    XCTAssertEqual(request.httpMethod, "GET")
    XCTAssertEqual(request.value(forHTTPHeaderField: "X-Pos-Display-Token"), "tok")
    XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    XCTAssertTrue((request.url?.query ?? "").contains("action=poll") && (request.url?.query ?? "").contains("branding=true"))
    XCTAssertEqual(answer.read.state.mode, .cart)
    XCTAssertFalse(answer.read.answered)
    XCTAssertEqual(answer.read.state.cart?.lines.first?.name, "Latte")
    XCTAssertEqual(answer.branding?.message, "Hi")
    let plain = Recording(#"{"state":{"mode":"idle","updatedAtMs":5,"answered":true}}"#)
    let idle = try await ConsolePosDeviceAPI(api: client(plain)).poll(token: "tok", withBranding: false)
    XCTAssertFalse((plain.requests.last?.url?.query ?? "").contains("branding"))
    XCTAssertTrue(idle.read.answered)
  }

  func testRespondAndForgetNameTheTokenAndTheAnswer() async throws {
    let respond = Recording(#"{"ok":true}"#)
    try await ConsolePosDeviceAPI(api: client(respond)).respond(
      token: "tok", answer: PosDisplayAnswer(promptID: "p", tipChoice: .percent, tipPercent: 15))
    XCTAssertEqual(respond.requests.last?.value(forHTTPHeaderField: "X-Pos-Display-Token"), "tok")
    XCTAssertEqual(respond.sent["action"] as? String, "respond")
    XCTAssertEqual((respond.sent["response"] as? [String: Any])?["promptId"] as? String, "p")
    let forget = Recording(#"{"ok":true}"#)
    try await ConsolePosDeviceAPI(api: client(forget)).forget(token: "tok")
    XCTAssertEqual(forget.sent["action"] as? String, "forget")
    XCTAssertEqual(forget.requests.last?.value(forHTTPHeaderField: "X-Pos-Display-Token"), "tok")
  }
}
