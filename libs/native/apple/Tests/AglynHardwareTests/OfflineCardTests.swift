// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynHardware

@MainActor
private final class FakeOfflinePort: OfflineTerminalPort {
  var created: Result<OfflineTerminalIntent, TerminalError>
  var collected: Result<OfflineTerminalIntent, TerminalError>
  var confirmed: Result<OfflineTerminalIntent, TerminalError>
  var calls: [String] = []
  var request: OfflineCardRequest?

  init(
    created: Result<OfflineTerminalIntent, TerminalError> = .success(
      OfflineTerminalIntent(id: nil, status: "requires_payment_method", amountCents: 2479, storedOffline: false)),
    collected: Result<OfflineTerminalIntent, TerminalError>? = nil,
    confirmed: Result<OfflineTerminalIntent, TerminalError> = .success(
      OfflineTerminalIntent(
        id: nil, status: "requires_capture", amountCents: 2479, storedOffline: true, brand: "visa", last4: "4242"))
  ) {
    self.created = created
    self.collected = collected ?? created
    self.confirmed = confirmed
  }

  func create(_ request: OfflineCardRequest) async -> Result<OfflineTerminalIntent, TerminalError> {
    calls.append("create")
    self.request = request
    return created
  }

  func collect(saleKey: String) async -> Result<OfflineTerminalIntent, TerminalError> {
    calls.append("collect")
    return collected
  }

  func confirm(saleKey: String) async -> Result<OfflineTerminalIntent, TerminalError> {
    calls.append("confirm")
    return confirmed
  }
}

/// A card taken with no connection (AGL-4039): the request's checks, the
/// create → collect → confirm sequence, and what a forward means.
@MainActor
final class OfflineCardTests: XCTestCase {
  private let key = "off8f2f9807c22c4fe3b1ed9042c497949d"

  private func request(amount: Int = 2479, destination: String = "acct_merchant") -> OfflineCardRequest {
    OfflineCardRequest(
      saleKey: key, amountCents: amount, currency: "usd", destination: destination,
      metadata: ["kind": "pos-offline", "saleKey": key])
  }

  func testAStoredCardIsTakenWithoutAStripeID() async {
    let port = FakeOfflinePort()
    let outcome = await collectOfflineCardPayment(port, request(), readerDeviceType: "STRIPE_M2")
    XCTAssertEqual(outcome, .taken(OfflineCardTaken(saleKey: key, paymentIntentID: nil, brand: "visa", last4: "4242")))
    XCTAssertEqual(port.calls, ["create", "collect", "confirm"])
    XCTAssertEqual(port.request?.destination, "acct_merchant")
  }

  func testACardStripeAuthorizedAfterAllKeepsItsID() async {
    let port = FakeOfflinePort(
      confirmed: .success(
        OfflineTerminalIntent(id: "pi_3Q0abcdEFGH12345", status: "requires_capture", amountCents: 2479, storedOffline: false)))
    let outcome = await collectOfflineCardPayment(port, request(), readerDeviceType: "STRIPE_M2")
    XCTAssertEqual(outcome, .taken(OfflineCardTaken(saleKey: key, paymentIntentID: "pi_3Q0abcdEFGH12345")))
  }

  func testADeclineWhileStripeIsReachableIsSaidAtTheCounter() async {
    let port = FakeOfflinePort(
      confirmed: .failure(TerminalError(code: "DECLINED_BY_STRIPE_API", declineCode: "insufficient_funds")))
    let outcome = await collectOfflineCardPayment(port, request(), readerDeviceType: "STRIPE_M2")
    guard case .failed(_, let code) = outcome else { return XCTFail("expected a failure, got \(outcome)") }
    XCTAssertEqual(code, "DECLINED_BY_STRIPE_API")
  }

  func testACanceledCardChargesNobody() async {
    let port = FakeOfflinePort(collected: .failure(TerminalError(code: "CANCELED")))
    let outcome = await collectOfflineCardPayment(port, request(), readerDeviceType: "STRIPE_M2")
    XCTAssertEqual(outcome, .canceled)
    XCTAssertEqual(port.calls, ["create", "collect"])
  }

  func testNothingStartsWithoutAReaderOrAWellFormedRequest() async {
    let port = FakeOfflinePort()
    if case .taken = await collectOfflineCardPayment(port, request(), readerDeviceType: nil) { XCTFail("needs a reader") }
    if case .taken = await collectOfflineCardPayment(port, request(destination: ""), readerDeviceType: "STRIPE_M2") {
      XCTFail("needs a destination")
    }
    if case .taken = await collectOfflineCardPayment(port, request(amount: 0), readerDeviceType: "STRIPE_M2") {
      XCTFail("needs an amount")
    }
    XCTAssertEqual(port.calls, [])
  }

  func testAnIntentForAnotherAmountIsRefusedBeforeTheCard() async {
    let port = FakeOfflinePort(
      created: .success(OfflineTerminalIntent(id: nil, status: "requires_payment_method", amountCents: 1, storedOffline: false)))
    if case .taken = await collectOfflineCardPayment(port, request(), readerDeviceType: "STRIPE_M2") { XCTFail("wrong amount") }
    XCTAssertEqual(port.calls, ["create"])
  }

  func testStripesOfflineLimitIsSaidInTheRegistersWordsNeverTheSDKs() async {
    let port = FakeOfflinePort(
      confirmed: .failure(TerminalError(code: "AMOUNT_EXCEEDS_MAX_OFFLINE_AMOUNT", apiMessage: "Amount exceeds max offline amount.")))
    let outcome = await collectOfflineCardPayment(port, request(), readerDeviceType: "STRIPE_M2")
    XCTAssertEqual(
      outcome,
      .failed(
        message: "This card is over Stripe's $10,000 limit for a card taken offline. Take it when you're back online, or take cash.",
        code: "AMOUNT_EXCEEDS_MAX_OFFLINE_AMOUNT"))
    XCTAssertEqual(
      offlineCardErrorMessage(TerminalError(code: "NOT_CONNECTED_TO_INTERNET_AND_OFFLINE_BEHAVIOR_REQUIRE_ONLINE"), fallback: "x"),
      "This sale is over your offline card limit. Take it when you're back online, or take cash.")
  }

  func testTheStoreLimitsAreEnforcedAgainAtTheSDK() {
    func limited(_ amount: Int, today: Int = 0) -> OfflineCardRequest {
      OfflineCardRequest(
        saleKey: key, amountCents: amount, currency: "usd", destination: "acct_merchant", metadata: ["saleKey": key],
        maxSaleCents: 10_000, maxDeviceDailyCents: 500_000, takenTodayCents: today)
    }
    XCTAssertFalse(offlineCardRequiresOnline(limited(10_000), sdkStoredCents: 0))
    XCTAssertTrue(offlineCardRequiresOnline(limited(10_001), sdkStoredCents: 0), "over the limit per sale")
    XCTAssertTrue(offlineCardRequiresOnline(limited(2_000, today: 499_000), sdkStoredCents: 0), "over the daily limit")
    XCTAssertTrue(offlineCardRequiresOnline(limited(2_000), sdkStoredCents: 499_000), "the SDK's own unsent cards count")
  }

  func testAReaderAsksForTheWaysItTakesTheCard() {
    XCTAssertEqual(readerInputPrompt(["TAP", "INSERT"]), "Ready: tap, insert the card.")
    XCTAssertEqual(readerInputPrompt(["INSERT"]), "Ready: insert the card.")
    XCTAssertEqual(readerInputPrompt([]), "Present the card.")
  }

  func testWhatAForwardMeans() {
    XCTAssertEqual(offlineForwardStatus(intentID: "pi_1", status: "requires_capture"), .authorized)
    XCTAssertEqual(offlineForwardStatus(intentID: "pi_1", status: "succeeded"), .authorized)
    XCTAssertEqual(offlineForwardStatus(intentID: "pi_1", status: "requires_payment_method"), .declined)
    XCTAssertEqual(offlineForwardStatus(intentID: nil, status: nil), .failed)
  }

  func testTheLedgerKeepsOneForwardPerSaleUntilApplied() {
    let defaults = UserDefaults(suiteName: "OfflineCardTests-\(UUID().uuidString)")!
    let ledger = OfflineCardForwardLedger(defaults: defaults)
    ledger.record(OfflineCardForward(saleKey: "a", paymentIntentID: nil, status: .failed))
    ledger.record(OfflineCardForward(saleKey: "a", paymentIntentID: "pi_1", status: .authorized))
    ledger.record(OfflineCardForward(saleKey: "b", paymentIntentID: "pi_2", status: .declined))
    XCTAssertEqual(ledger.all().map(\.status), [.authorized, .declined])
    ledger.remove(["a"])
    XCTAssertEqual(ledger.all().map(\.saleKey), ["b"])
  }

  func testACardIsNamedTheWayAReceiptNamesIt() {
    XCTAssertEqual(offlineCardLabel(brand: "visa", last4: "4242"), "Visa •••• 4242")
    XCTAssertEqual(offlineCardLabel(brand: nil, last4: nil), "Card")
    XCTAssertEqual(offlineCardLabel(brand: "amex", last4: "0005"), "American Express •••• 0005")
  }
}
