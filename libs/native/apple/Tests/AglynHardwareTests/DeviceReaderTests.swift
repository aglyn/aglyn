// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynHardware

@MainActor
private final class FakePort: TerminalPaymentPort {
  var retrieved: Result<TerminalIntent, TerminalError>
  var collected: Result<TerminalIntent, TerminalError>
  var confirmed: Result<TerminalIntent, TerminalError>
  var calls: [String] = []
  var skipTipping: Bool?

  init(
    retrieved: Result<TerminalIntent, TerminalError>,
    collected: Result<TerminalIntent, TerminalError>? = nil,
    confirmed: Result<TerminalIntent, TerminalError>? = nil
  ) {
    self.retrieved = retrieved
    let base = (try? retrieved.get()) ?? TerminalIntent(id: "", status: "", amountCents: 0)
    self.collected = collected ?? .success(base)
    self.confirmed =
      confirmed ?? .success(TerminalIntent(id: base.id, status: "requires_capture", amountCents: base.amountCents))
  }

  func retrieve(clientSecret: String) async -> Result<TerminalIntent, TerminalError> {
    calls.append("retrieve")
    return retrieved
  }

  func collect(intentID: String, skipTipping: Bool) async -> Result<TerminalIntent, TerminalError> {
    calls.append("collect")
    self.skipTipping = skipTipping
    return collected
  }

  func confirm(intentID: String) async -> Result<TerminalIntent, TerminalError> {
    calls.append("confirm")
    return confirmed
  }
}

private struct NoSessions: CardReaderSessionSource {
  func session(hostID: String) async throws -> CardReaderSession { throw CancellationError() }
}

@MainActor
final class DeviceReaderTests: XCTestCase {
  private let intentID = "pi_12345678abcd"
  private var request: CardCollectRequest {
    CardCollectRequest(
      paymentIntentID: intentID, clientSecret: "\(intentID)_secret_abcdefgh1234", amountCents: 2500,
      tipEligible: true)
  }
  private func open(_ cents: Int = 2500) -> TerminalIntent {
    TerminalIntent(id: intentID, status: "requires_payment_method", amountCents: cents)
  }

  func testRetrieveCollectConfirmAuthorizes() async {
    let port = FakePort(retrieved: .success(open()))
    let outcome = await collectCardPayment(port, request, readerDeviceType: "TAP_TO_PAY_DEVICE")
    XCTAssertEqual(outcome, .collected(paymentIntentID: intentID, amountCents: 2500, tipCents: 0))
    XCTAssertEqual(port.calls, ["retrieve", "collect", "confirm"])
    XCTAssertEqual(port.skipTipping, true)
  }

  /// Apple 5.8: once the card is read, and before the payment is confirmed, the register is told so it shows processing.
  func testTheReadIsReportedBeforeTheConfirmAndNotWhenTheReadFails() async {
    let port = FakePort(retrieved: .success(open()))
    var seen: [String] = []
    _ = await collectCardPayment(port, request, readerDeviceType: "TAP_TO_PAY_DEVICE") { seen = port.calls }
    XCTAssertEqual(seen, ["retrieve", "collect"], "reported after the read, before the confirm")
    let unread = FakePort(retrieved: .success(open()), collected: .failure(TerminalError(code: "CARD_READ_TIMED_OUT")))
    var read = false
    _ = await collectCardPayment(unread, request, readerDeviceType: "TAP_TO_PAY_DEVICE") { read = true }
    XCTAssertFalse(read)
  }

  /// Apple 5.9: a reader or network timeout is its own outcome, worded as one, never as a decline.
  func testATimeoutIsToldAsATimeoutNotADecline() async {
    for code in ["CARD_READ_TIMED_OUT", "REQUEST_TIMED_OUT", "STRIPE_API_CONNECTION_ERROR", "NOT_CONNECTED_TO_INTERNET"] {
      XCTAssertTrue(cardCollectTimedOut(code: code), code)
    }
    XCTAssertFalse(cardCollectTimedOut(code: "DECLINED_BY_STRIPE_API"))
    XCTAssertFalse(cardCollectTimedOut(code: "BLUETOOTH_SCAN_TIMED_OUT"), "finding a reader is not a payment")
    XCTAssertFalse(cardCollectTimedOut(code: nil))
    let port = FakePort(retrieved: .success(open()), collected: .failure(TerminalError(code: "CARD_READ_TIMED_OUT")))
    let outcome = await collectCardPayment(port, request, readerDeviceType: "TAP_TO_PAY_DEVICE")
    XCTAssertEqual(
      outcome, .failed(paymentIntentID: intentID, message: "The payment timed out.", code: "CARD_READ_TIMED_OUT"))
  }

  func testASimulatedReaderShowsProcessingAfterTheReadOnly() async {
    let collector = SimulatedCardCollector(delay: .zero, processingDelay: .milliseconds(200))
    _ = await collector.connect(hostID: "h1", kind: .simulated, sessions: NoSessions())
    XCTAssertFalse(collector.processing)
    let collecting = Task { await collector.collect(request) }
    var sawProcessing = false
    for _ in 0..<100 where !sawProcessing {
      try? await Task.sleep(for: .milliseconds(5))
      sawProcessing = collector.processing
    }
    _ = await collecting.value
    XCTAssertTrue(sawProcessing)
    XCTAssertFalse(collector.processing, "the outcome ends it")
  }

  func testOnlyAWisePad3AsksForATip() async {
    let port = FakePort(retrieved: .success(open()))
    _ = await collectCardPayment(port, request, readerDeviceType: "WISEPAD_3")
    XCTAssertEqual(port.skipTipping, false)
  }

  func testAnAlreadyAuthorizedIntentIsNotChargedTwice() async {
    let port = FakePort(
      retrieved: .success(TerminalIntent(id: intentID, status: "requires_capture", amountCents: 2500, tipCents: 300)))
    let outcome = await collectCardPayment(port, request, readerDeviceType: "STRIPE_M2")
    XCTAssertEqual(outcome, .collected(paymentIntentID: intentID, amountCents: 2500, tipCents: 300))
    XCTAssertEqual(port.calls, ["retrieve"])
  }

  func testAnotherAmountIsRefusedBeforeTheCard() async {
    let port = FakePort(retrieved: .success(open(9900)))
    let outcome = await collectCardPayment(port, request, readerDeviceType: "STRIPE_M2")
    guard case .failed(_, let message, _) = outcome else { return XCTFail("\(outcome)") }
    XCTAssertTrue(message.contains("does not match the register"))
    XCTAssertEqual(port.calls, ["retrieve"])
  }

  func testAnotherIntentIsRefused() async {
    let port = FakePort(retrieved: .success(TerminalIntent(id: "pi_other12345", status: "x", amountCents: 2500)))
    let outcome = await collectCardPayment(port, request, readerDeviceType: "STRIPE_M2")
    guard case .failed = outcome else { return XCTFail("\(outcome)") }
    XCTAssertEqual(port.calls, ["retrieve"])
  }

  func testNoReaderAsksToConnectFirst() async {
    let port = FakePort(retrieved: .success(open()))
    let outcome = await collectCardPayment(port, request, readerDeviceType: nil)
    guard case .failed(_, let message, _) = outcome else { return XCTFail("\(outcome)") }
    XCTAssertTrue(message.hasPrefix("Connect"))
    XCTAssertTrue(port.calls.isEmpty)
  }

  func testACanceledCollectIsCanceled() async {
    let port = FakePort(retrieved: .success(open()), collected: .failure(TerminalError(code: "canceled")))
    let outcome = await collectCardPayment(port, request, readerDeviceType: "STRIPE_M2")
    XCTAssertEqual(outcome, .canceled(paymentIntentID: intentID))
  }

  func testAConfirmErrorAfterAuthorizationStillCollected() async {
    let after = TerminalIntent(id: intentID, status: "requires_capture", amountCents: 2500)
    let port = FakePort(
      retrieved: .success(open()), confirmed: .failure(TerminalError(code: "API_ERROR", intent: after)))
    let outcome = await collectCardPayment(port, request, readerDeviceType: "STRIPE_M2")
    XCTAssertEqual(outcome, .collected(paymentIntentID: intentID, amountCents: 2500, tipCents: 0))
  }

  func testADeclineReadsAsWords() async {
    let port = FakePort(
      retrieved: .success(open()),
      confirmed: .failure(TerminalError(code: "DECLINED_BY_STRIPE_API", declineCode: "insufficient_funds")))
    let outcome = await collectCardPayment(port, request, readerDeviceType: "STRIPE_M2")
    XCTAssertEqual(
      outcome,
      .failed(
        paymentIntentID: intentID, message: "Declined: insufficient funds. Ask for another card.",
        code: "DECLINED_BY_STRIPE_API"))
  }

  func testWords() {
    XCTAssertEqual(
      collectErrorMessage(TerminalError(code: "DECLINED_BY_READER"), fallback: "x"),
      "The card was declined. Ask for another card.")
    XCTAssertEqual(collectErrorMessage(TerminalError(code: "OTHER", message: " "), fallback: "fallback"), "fallback")
    XCTAssertEqual(readerPrompt("insert_card"), "Insert the card.")
    XCTAssertEqual(readerPrompt("NEW_THING"), "Follow the prompt on the reader.")
    XCTAssertEqual(
      deviceReaderLabel(kind: .bluetooth, deviceType: "STRIPE_M2", label: nil, serial: "CHB31SIMULATOR:3075dac0", simulated: true),
      "Stripe Reader M2 (simulated)")
    XCTAssertEqual(
      deviceReaderLabel(kind: .bluetooth, deviceType: "STRIPE_M2", label: nil, serial: "STRM2-1", simulated: false),
      "Stripe Reader M2 STRM2-1")
    XCTAssertEqual(
      deviceReaderLabel(kind: .tapToPay, deviceType: "", label: nil, serial: nil, simulated: false),
      "Tap to Pay on iPhone")
  }

  func testAnUpdateIsDueOnlyOnceItsDeadlineHasPassed() {
    let now = Date(timeIntervalSince1970: 1_000)
    XCTAssertFalse(updateIsDue(requiredAt: nil, now: now))
    XCTAssertFalse(updateIsDue(requiredAt: now.addingTimeInterval(60), now: now))
    XCTAssertTrue(updateIsDue(requiredAt: now.addingTimeInterval(-60), now: now))
  }

  func testABatteryReadsAsAPercentage() {
    XCTAssertNil(readerBatteryText(nil))
    XCTAssertEqual(readerBatteryText(0.824), "Battery 82%")
    XCTAssertEqual(readerBatteryText(1.2, charging: true), "Battery 100% · charging")
  }

  func testDiscoveryListsWhatItFoundSoFar() {
    let reader = DeviceReader(id: "STRM2-1", label: "Stripe Reader M2 STRM2-1", kind: .bluetooth, simulated: true)
    XCTAssertEqual(ReaderDiscovery.searching(.bluetooth, [reader]).readers, [reader])
    XCTAssertEqual(ReaderDiscovery.found(.bluetooth, [reader]).readers, [reader])
    XCTAssertEqual(ReaderDiscovery.failed("no").readers, [])
  }
}
