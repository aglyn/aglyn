// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynHardware
import Foundation
import XCTest

@testable import AglynCommercePlugin

/// An iPhone's own reader: Tap to Pay on iPhone and a Bluetooth reader, with a scripted connect.
@MainActor
private final class FakeIPhoneReader: CardCollector, DeviceReaderControls {
  var state: CardCollectorState = .disconnected
  let kinds: [CardCollectorKind] = [.tapToPay, .bluetooth]
  var discovery: ReaderDiscovery = .idle
  var connectedReader: DeviceReader?
  var update: ReaderUpdate?
  var tapToPayNotice: TapToPayNotice?
  var tapToPayTermsJustAccepted = false
  /// What a Tap to Pay connect ends in: nil connects, a notice fails with it.
  var connectFails: TapToPayNotice?
  private(set) var permitted: Bool?
  private(set) var connects: [CardCollectorKind] = []
  private(set) var warmUps = 0

  func connect(hostID: String, kind: CardCollectorKind, sessions: CardReaderSessionSource) async -> CardCollectorState {
    connects.append(kind)
    if let connectFails {
      tapToPayNotice = connectFails
      state = .disconnected
    } else {
      tapToPayNotice = nil
      state = .connected(label: kind == .tapToPay ? "Tap to Pay on iPhone" : "Stripe Reader M2", kind: kind, testMode: true)
    }
    return state
  }
  func disconnect() async { state = .disconnected }
  func collect(_ request: CardCollectRequest) async -> CardCollectOutcome { .canceled(paymentIntentID: request.paymentIntentID) }
  func cancel() async {}
  func discover(_ kind: CardCollectorKind, hostID: String, sessions: CardReaderSessionSource) async {}
  func cancelDiscovery() async {}
  func connect(to reader: DeviceReader, hostID: String, sessions: CardReaderSessionSource) async -> Bool { false }
  func forget() async {}
  func installUpdate() async {}
  func reconnectRemembered(hostID: String, sessions: CardReaderSessionSource) async {}
  func warmUp(hostID: String, sessions: CardReaderSessionSource) async { warmUps += 1 }
  func permitTapToPayTerms(_ permitted: Bool) { self.permitted = permitted }
  func clearTapToPayTermsJustAccepted() { tapToPayTermsJustAccepted = false }
}

private final class NoDocuments: FirestoreReader, @unchecked Sendable {
  private final class Nothing: FirestoreListening { func remove() {} }

  @MainActor
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
    -> FirestoreListening
  { Nothing() }

  @MainActor
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
    -> FirestoreListening
  { Nothing() }

  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}
}

/// A card reader that declines every card.
@MainActor
private final class DecliningReader: CardReaderService {
  let id = "device"
  let label = "Tap to Pay on iPhone"
  let kind = CardReaderKind.device
  let prompt: String? = nil
  func charge(
    _ deps: TenderDeps, amountCents: Int, tipCents: Int, attemptKey: String,
    onWaiting: @escaping @MainActor (String?) -> Void
  ) async -> TenderOutcome {
    .failed("The card was declined.", nil)
  }
  func cancel(_ deps: TenderDeps, paymentID: String?) async {}
}

@MainActor
final class PosTapToPayTests: XCTestCase {
  private func register(_ reader: FakeIPhoneReader) -> RegisterModel {
    let api = ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "token" }, sleep: { _ in }, maxAttempts: 1)
    return RegisterModel(hostID: "h1", reader: NoDocuments(), api: api, collector: reader)
  }

  private var osMajor: Int { ProcessInfo.processInfo.operatingSystemVersion.majorVersion }

  func testAnIPhoneOffersTheButtonAndTapToPayIsNeverASecondReaderRow() {
    let reader = FakeIPhoneReader()
    let model = register(reader)
    XCTAssertTrue(model.offersTapToPay)
    reader.state = .connected(label: "Tap to Pay on iPhone", kind: .tapToPay, testMode: true)
    XCTAssertTrue(model.deviceIsTapToPay)
    XCTAssertTrue(model.readers.isEmpty, "the pinned button is Tap to Pay's only way in")
    reader.state = .connected(label: "Stripe Reader M2", kind: .bluetooth, testMode: true)
    XCTAssertEqual(model.readers.map(\.label), ["Stripe Reader M2"])
  }

  func testAPressConnectsTapToPayFirstThenItIsReady() async throws {
    try XCTSkipIf(osMajor < TapToPayIPhone.minimumOSMajor, "the host OS is older than Tap to Pay on iPhone needs")
    let reader = FakeIPhoneReader()
    let model = register(reader)
    XCTAssertEqual(model.tapToPayPressNow, .connect)
    let notice = await model.readyTapToPay()
    XCTAssertNil(notice)
    XCTAssertEqual(reader.connects, [.tapToPay])
    XCTAssertEqual(model.tapToPayPressNow, .collect)
  }

  func testWithThePlatformLinkMissingThePressSaysContactSupport() async throws {
    try XCTSkipIf(osMajor < TapToPayIPhone.minimumOSMajor, "the host OS is older than Tap to Pay on iPhone needs")
    let reader = FakeIPhoneReader()
    reader.connectFails = .notTurnedOn
    let model = register(reader)
    let notice = await model.readyTapToPay()
    XCTAssertEqual(notice, .notTurnedOn)
    XCTAssertEqual(notice?.message, "Contact support to turn it on. Take this payment another way for now.")
    // Said again without another connect: a retry cannot fix it.
    XCTAssertEqual(model.tapToPayPressNow, .explain(.notTurnedOn))
  }

  func testAPressWhileTheIPhoneIsBeingSetUpShowsItsProgress() throws {
    try XCTSkipIf(osMajor < TapToPayIPhone.minimumOSMajor, "the host OS is older than Tap to Pay on iPhone needs")
    let reader = FakeIPhoneReader()
    reader.state = .connecting("Getting Tap to Pay on iPhone ready…")
    reader.update = ReaderUpdate(progress: 0.4)
    let model = register(reader)
    XCTAssertEqual(model.tapToPayPressNow, .explain(.preparing(progress: 0.4)))
  }

  func testOnlyAglynStaffMayAcceptApplesTermsOnThisDevice() {
    let reader = FakeIPhoneReader()
    let model = register(reader)
    model.permitTapToPayTerms(isStaff: false)
    XCTAssertEqual(reader.permitted, false)
    model.permitTapToPayTerms(isStaff: true)
    XCTAssertEqual(reader.permitted, true)
  }

  func testTheRegisterWarmsTheReaderUpWithoutAsking() async {
    let reader = FakeIPhoneReader()
    let model = register(reader)
    await model.warmUpReader()
    XCTAssertEqual(reader.warmUps, 1)
    reader.state = .connected(label: "Tap to Pay on iPhone", kind: .tapToPay, testMode: true)
    await model.warmUpReader()
    XCTAssertEqual(reader.warmUps, 1, "a ready reader is left alone")
  }

  func testADeclinedCardKeepsItsReceiptAndTellsTheCashierWhenAway() async {
    let api = ScriptedSaleAPI()
    let opened = PosOpenedSale(
      orderID: "o1", subtotalCents: 1000, discountCents: 0, taxCents: 80, totalCents: 1080, dueCents: 1080, stockWarnings: [])
    let checkout = Checkout(api: api, opened: opened, settings: PosRegisterSettings(), sleep: { _ in })
    var told: [String] = []
    checkout.onCardNotApproved = { told.append($0) }
    await checkout.payCard(DecliningReader())
    XCTAssertEqual(told, ["$10.80"])
    let declined = try? XCTUnwrap(checkout.declined)
    XCTAssertEqual(declined?.amountCents, 1080)
    let receipt = declined?.receipt(store: "Juniper Street Bakery", money: { posMoney($0, currency: "usd") }) ?? ""
    XCTAssertTrue(receipt.hasPrefix("Juniper Street Bakery\n"))
    XCTAssertTrue(receipt.contains("Card payment not approved"))
    XCTAssertTrue(receipt.contains("Amount: $10.80"))
    XCTAssertTrue(receipt.hasSuffix("Nothing was charged."))
  }
}

/// Answers every request with one status and body, and keeps what was sent.
private final class OneAnswer: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private(set) var requests: [URLRequest] = []
  let status: Int
  let body: String
  init(_ status: Int, _ body: String) {
    self.status = status
    self.body = body
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    lock.withLock { requests.append(request) }
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}

final class PaymentsSetupTests: XCTestCase {
  private func setup(_ transport: OneAnswer) -> PaymentsSetupAPI {
    PaymentsSetupAPI(
      api: ConsoleAPIClient(
        origin: "https://console.test", getIDToken: { _ in "token" }, transport: transport, sleep: { _ in }, maxAttempts: 1),
      hostID: "h1")
  }

  func testTheConsolesOwnRouteHandsBackStripesOnboardingPage() async throws {
    let transport = OneAnswer(200, #"{"accountId":"acct_1","chargesEnabled":false,"url":"https://connect.stripe.com/setup/e/acct_1/abc"}"#)
    let page = try await setup(transport).setupPage()
    XCTAssertEqual(page?.absoluteString, "https://connect.stripe.com/setup/e/acct_1/abc")
    let request = try XCTUnwrap(transport.requests.first)
    XCTAssertEqual(request.url?.path(), "/api/commerce/connect")
    XCTAssertEqual(request.httpMethod, "POST")
    let sent = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any]
    XCTAssertEqual(sent?["hostId"] as? String, "h1")
  }

  func testPaymentsAlreadySetUpOpenNoPage() async throws {
    let page = try await setup(OneAnswer(200, #"{"accountId":"acct_1","chargesEnabled":true}"#)).setupPage()
    XCTAssertNil(page)
  }

  func testSomeoneOtherThanTheOwnerReadsTheRoutesOwnWords() async {
    do {
      _ = try await setup(OneAnswer(403, #"{"error":"Only the organization owner can set up payments"}"#)).setupPage()
      XCTFail("a refusal is thrown")
    } catch {
      XCTAssertEqual((error as? ConsoleAPIError)?.message, "Only the organization owner can set up payments")
    }
  }
}
