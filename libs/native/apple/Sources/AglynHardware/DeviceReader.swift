// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * A DEVICE READER, AS THE SCREENS SEE IT.
 *
 * Tap to Pay on this iPhone, or a Bluetooth reader near the iPhone or iPad,
 * reached through the Stripe Terminal SDK. The SDK itself stays in the
 * commerce plugin (it is iOS only); this file holds every rule that can be
 * decided without it: the collect sequence, the words a reader prompt or an
 * SDK error is read out as, and a reader's name. The SDK binding is a thin
 * adapter over `TerminalPaymentPort`, so the sequence is tested here with a
 * fake. The Kotlin kit's `DeviceReader.kt` holds the same rules.
 */

/// A PaymentIntent as the SDK hands it back, reduced to what the sequence reads.
public struct TerminalIntent: Equatable, Sendable {
  public let id: String
  /// Stripe's status, lower snake case (`requires_payment_method`, `requires_capture`, `succeeded`, …).
  public let status: String
  public let amountCents: Int
  public let tipCents: Int

  public init(id: String, status: String, amountCents: Int, tipCents: Int = 0) {
    self.id = id
    self.status = status
    self.amountCents = amountCents
    self.tipCents = tipCents
  }
}

/// An SDK error, reduced: its code (the SDK's case name), message and decline details.
public struct TerminalError: Error, Equatable, Sendable {
  public let code: String
  public let message: String?
  public let declineCode: String?
  public let apiMessage: String?
  /// The intent as it stood when the call failed, when the SDK says.
  public let intent: TerminalIntent?

  public init(
    code: String, message: String? = nil, declineCode: String? = nil, apiMessage: String? = nil,
    intent: TerminalIntent? = nil
  ) {
    self.code = code
    self.message = message
    self.declineCode = declineCode
    self.apiMessage = apiMessage
    self.intent = intent
  }

  public var canceled: Bool { code.uppercased() == "CANCELED" }
}

/// The three SDK calls a collection makes, one adapter per SDK.
@MainActor
public protocol TerminalPaymentPort {
  func retrieve(clientSecret: String) async -> Result<TerminalIntent, TerminalError>
  func collect(intentID: String, skipTipping: Bool) async -> Result<TerminalIntent, TerminalError>
  func confirm(intentID: String) async -> Result<TerminalIntent, TerminalError>
}

/// Readers that can ask the customer for a tip on their own screen.
public func readerCanTip(_ deviceType: String) -> Bool { deviceType.uppercased().hasPrefix("WISEPAD_3") }

private let authorized: Set<String> = ["requires_capture", "succeeded"]

/// Retrieve → collect → confirm, for one server-made intent. Confirming
/// AUTHORIZES; the server captures after reading Stripe. An intent that is
/// already authorized (a retry after a lost answer) is reported again rather
/// than charged twice, and an intent for another amount than the register
/// shows is refused before the card is asked for.
@MainActor
public func collectCardPayment(
  _ port: TerminalPaymentPort, _ request: CardCollectRequest, readerDeviceType: String?
) async -> CardCollectOutcome {
  let id = request.paymentIntentID
  if let problem = request.problem { return .failed(paymentIntentID: id, message: problem, code: nil) }
  guard let deviceType = readerDeviceType else {
    return .failed(paymentIntentID: id, message: "Connect Tap to Pay or a card reader first.", code: nil)
  }

  let retrieved: TerminalIntent
  switch await port.retrieve(clientSecret: request.clientSecret) {
  case .failure(let error): return failed(id, error, "The payment could not be loaded. Try again.")
  case .success(let intent): retrieved = intent
  }
  guard retrieved.id == id else {
    return .failed(paymentIntentID: id, message: "The payment to collect does not match.", code: nil)
  }
  if authorized.contains(retrieved.status) { return collected(retrieved) }
  guard retrieved.amountCents == request.amountCents else {
    return .failed(
      paymentIntentID: id, message: "The amount to charge does not match the register. Start the payment again.",
      code: nil)
  }

  let skipTipping = !(request.tipEligible && readerCanTip(deviceType))
  if case .failure(let error) = await port.collect(intentID: id, skipTipping: skipTipping) {
    if error.canceled { return .canceled(paymentIntentID: id) }
    return failed(id, error, "The card could not be read. Try again.")
  }
  switch await port.confirm(intentID: id) {
  case .success(let intent): return collected(intent)
  case .failure(let error):
    if error.canceled { return .canceled(paymentIntentID: id) }
    if let after = error.intent, authorized.contains(after.status) { return collected(after) }
    return failed(id, error, "The payment did not go through. Try again.")
  }
}

private func collected(_ intent: TerminalIntent) -> CardCollectOutcome {
  .collected(paymentIntentID: intent.id, amountCents: max(0, intent.amountCents), tipCents: max(0, intent.tipCents))
}

private func failed(_ id: String, _ error: TerminalError, _ fallback: String) -> CardCollectOutcome {
  .failed(paymentIntentID: id, message: collectErrorMessage(error, fallback: fallback), code: error.code)
}

private func nonBlank(_ text: String?) -> String? {
  guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
  return text
}

// MARK: - Words

/// An SDK payment error, as the cashier reads it.
public func collectErrorMessage(_ error: TerminalError, fallback: String) -> String {
  if error.declineCode == "insufficient_funds" { return "Declined: insufficient funds. Ask for another card." }
  if let api = nonBlank(error.apiMessage) { return api }
  let code = error.code.uppercased()
  if code.hasPrefix("DECLINED") { return "The card was declined. Ask for another card." }
  switch code {
  case "NOT_CONNECTED_TO_READER": return "The card reader disconnected. Reconnect it and try again."
  case "READER_BUSY": return "The card reader is busy. Finish or cancel the other payment first."
  default: return nonBlank(error.message) ?? fallback
  }
}

/// What the reader asks for (the SDK's `ReaderDisplayMessage`), in plain words.
public func readerPrompt(_ display: String) -> String {
  switch display.uppercased() {
  case "REMOVE_CARD": "Remove the card."
  case "RETRY_CARD": "Try the card again."
  case "INSERT_CARD": "Insert the card."
  case "INSERT_OR_SWIPE_CARD": "Insert or swipe the card."
  case "SWIPE_CARD": "Swipe the card."
  case "MULTIPLE_CONTACTLESS_CARDS_DETECTED": "More than one card was tapped. Tap just one."
  case "TRY_ANOTHER_READ_METHOD": "Try another way to pay with this card."
  case "TRY_ANOTHER_CARD": "Try another card."
  case "CARD_REMOVED_TOO_EARLY": "The card was removed too early. Try again."
  default: "Follow the prompt on the reader."
  }
}

/// Discovery's failure, as the cashier reads it.
public func friendlyDiscoveryError(code: String, message: String?) -> String {
  switch code.uppercased() {
  case "TAP_TO_PAY_UNSUPPORTED_DEVICE", "TAP_TO_PAY_UNSUPPORTED_OS_VERSION":
    "This device cannot take Tap to Pay. It needs an iPhone XS or later. Use a Bluetooth card reader instead."
  case "BLUETOOTH_DISABLED", "BLUETOOTH_ERROR": "Turn on Bluetooth to find card readers."
  case "BLUETOOTH_SCAN_TIMED_OUT": "No card reader answered. Turn the reader on, keep it close and try again."
  case "BLUETOOTH_ACCESS_DENIED", "BLUETOOTH_PERMISSION_DENIED":
    "Allow Bluetooth for Aglyn POS in Settings to find card readers."
  default: nonBlank(message) ?? "Readers could not be found. Try again."
  }
}

/// Connecting's failure, as the cashier reads it.
public func friendlyConnectError(code: String, message: String?) -> String {
  switch code.uppercased() {
  case "READER_CONNECTED_TO_ANOTHER_DEVICE": "This reader is connected to another device. Disconnect it there first."
  case "TAP_TO_PAY_DEVICE_TAMPERED": "This device failed a security check and cannot take Tap to Pay."
  case "TAP_TO_PAY_INSECURE_ENVIRONMENT": "Turn off screen recording to use Tap to Pay."
  case "UNSUPPORTED_READER_VERSION":
    "This reader needs a software update. Keep it charged and connected while it updates."
  case "READER_BATTERY_CRITICALLY_LOW": "The reader's battery is too low. Charge it and try again."
  default: nonBlank(message) ?? "The reader could not connect. Try again."
  }
}

/// A reader's name for the list: its label, else its model and serial.
public func deviceReaderLabel(
  kind: CardCollectorKind, deviceType: String, label: String?, serial: String?, simulated: Bool
) -> String {
  if kind == .tapToPay { return simulated ? "Tap to Pay (simulated)" : "Tap to Pay on iPhone" }
  let model =
    switch deviceType.uppercased() {
    case "STRIPE_M2", "STRIPEM2": "Stripe Reader M2"
    case "WISEPAD_3", "WISEPAD3", "WISEPAD_3S", "WISEPAD3S": "BBPOS WisePad 3"
    case "CHIPPER_2X", "CHIPPER2X": "BBPOS Chipper 2X BT"
    default: "Card reader"
    }
  let name = nonBlank(label) ?? ([model] + [nonBlank(serial)].compactMap { $0 }).joined(separator: " ")
  return simulated ? "\(name) (simulated)" : name
}
