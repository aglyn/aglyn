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
      deviceReaderLabel(kind: .bluetooth, deviceType: "STRIPE_M2", label: nil, serial: "STRM2-1", simulated: true),
      "Stripe Reader M2 STRM2-1 (simulated)")
    XCTAssertEqual(
      deviceReaderLabel(kind: .tapToPay, deviceType: "", label: nil, serial: nil, simulated: false),
      "Tap to Pay on iPhone")
  }
}
