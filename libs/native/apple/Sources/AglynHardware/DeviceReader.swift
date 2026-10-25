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

/// The ways the reader is ready to take the card (the SDK's `ReaderInputOptions`), as the Kotlin kit says them.
public func readerInputPrompt(_ options: [String]) -> String {
  let ways = options.compactMap { option -> String? in
    switch option.uppercased() {
    case "TAP", "TAP_CARD": "tap"
    case "INSERT", "INSERT_CARD": "insert"
    case "SWIPE", "SWIPE_CARD": "swipe"
    default: nil
    }
  }
  return ways.isEmpty ? "Present the card." : "Ready: \(ways.joined(separator: ", ")) the card."
}

/// Discovery's failure, as the cashier reads it.
public func friendlyDiscoveryError(code: String, message: String?) -> String {
  switch code.uppercased() {
  case "TAP_TO_PAY_UNSUPPORTED_DEVICE":
    "This device cannot take Tap to Pay. It needs an iPhone XS or later. Use a Bluetooth card reader instead."
  case "TAP_TO_PAY_UNSUPPORTED_OS_VERSION": TapToPayNotice.needsUpdate.message
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
  default: tapToPayNotice(code: code)?.message ?? nonBlank(message) ?? "The reader could not connect. Try again."
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
  // A simulated reader's serial is a long made-up id (CHB31SIMULATOR:<uuid>); its model alone names it.
  let name = nonBlank(label) ?? ([model] + [simulated ? nil : nonBlank(serial)].compactMap { $0 }).joined(separator: " ")
  return simulated ? "\(name) (simulated)" : name
}

// MARK: - Reader management

/// A reader found by discovery, or the one connected.
public struct DeviceReader: Equatable, Identifiable, Sendable {
  /// The SDK's serial number (Tap to Pay has a stable stand-in).
  public let id: String
  public let label: String
  public let kind: CardCollectorKind
  public let simulated: Bool
  /// 0...1, when the reader reports one.
  public var batteryLevel: Double?
  /// The reader is on its charger, when it says.
  public var charging: Bool
  /// The reader's model as Stripe names it (`STRIPE_M2`, `WISEPAD_3`, `TAP_TO_PAY_DEVICE`, …).
  public let deviceType: String
  /// The reader's software version, when it reports one.
  public var softwareVersion: String?

  public init(
    id: String, label: String, kind: CardCollectorKind, simulated: Bool, batteryLevel: Double? = nil,
    charging: Bool = false, deviceType: String = "", softwareVersion: String? = nil
  ) {
    self.id = id
    self.label = label
    self.kind = kind
    self.simulated = simulated
    self.batteryLevel = batteryLevel
    self.charging = charging
    self.deviceType = deviceType
    self.softwareVersion = softwareVersion
  }
}

public enum ReaderDiscovery: Equatable, Sendable {
  case idle
  case searching(CardCollectorKind, [DeviceReader])
  /// Discovery ended with readers to pick from (possibly none).
  case found(CardCollectorKind, [DeviceReader])
  case failed(String)

  /// The readers listed so far.
  public var readers: [DeviceReader] {
    switch self {
    case .searching(_, let found), .found(_, let found): found
    case .idle, .failed: []
    }
  }
}

/// A reader software update: offered, installing, or due before the next payment.
public struct ReaderUpdate: Equatable, Sendable {
  /// 0...1 while installing; nil while only offered.
  public var progress: Double?
  /// Past its deadline: it installs before this reader takes another payment.
  public var required: Bool
  /// The version it brings, when the SDK says.
  public var version: String?
  /// Roughly how long it takes ("1 to 2 minutes"), when the SDK says.
  public var duration: String?

  public init(progress: Double? = nil, required: Bool = false, version: String? = nil, duration: String? = nil) {
    self.progress = progress
    self.required = required
    self.version = version
    self.duration = duration
  }
}

/// The reader management a device reader adds to `CardCollector`: discover by
/// kind, pick one, disconnect, install an update. Implementations are
/// `@Observable`. The Kotlin kit's `DeviceReaderControls` is the same contract.
@MainActor
public protocol DeviceReaderControls: AnyObject {
  var discovery: ReaderDiscovery { get }
  var connectedReader: DeviceReader? { get }
  var update: ReaderUpdate? { get }
  /// Asks for location (and the SDK for Bluetooth) as it starts: the person
  /// is choosing to connect a reader right now.
  func discover(_ kind: CardCollectorKind, hostID: String, sessions: CardReaderSessionSource) async
  func cancelDiscovery() async
  /// Connects `reader` under the site's Terminal Location and remembers it for reconnects.
  @discardableResult
  func connect(to reader: DeviceReader, hostID: String, sessions: CardReaderSessionSource) async -> Bool
  /// Disconnects and forgets the remembered reader, so opening the register does not reconnect it.
  func forget() async
  func installUpdate() async
  /// Reconnects the reader connected last time, silently: no permission is asked for, and
  /// nothing happens when none was connected or a permission is missing.
  func reconnectRemembered(hostID: String, sessions: CardReaderSessionSource) async
  /// Gets this device's reader ready without asking for anything, when the app opens or comes back to the front
  /// (Apple 1.5): the reader connected last time, else Tap to Pay on iPhone on an iPhone that can take it.
  func warmUp(hostID: String, sessions: CardReaderSessionSource) async
  /// Why Tap to Pay on iPhone could not connect last time; nil when nothing is wrong.
  var tapToPayNotice: TapToPayNotice? { get }
  /// Whether this person may accept Apple's Tap to Pay on iPhone terms (`tapToPayTermsPermitted`).
  func permitTapToPayTerms(_ permitted: Bool)
  /// True once Apple's terms were accepted on this device, until the screen showing Apple's education clears it.
  var tapToPayTermsJustAccepted: Bool { get }
  func clearTapToPayTermsJustAccepted()
}

extension DeviceReaderControls {
  public func warmUp(hostID: String, sessions: CardReaderSessionSource) async {
    await reconnectRemembered(hostID: hostID, sessions: sessions)
  }
  public var tapToPayNotice: TapToPayNotice? { nil }
  public func permitTapToPayTerms(_ permitted: Bool) {}
  public var tapToPayTermsJustAccepted: Bool { false }
  public func clearTapToPayTermsJustAccepted() {}
}

/// The reader controls behind this collector, or nil (the simulated one, the Mac).
@MainActor
extension CardCollector {
  public var deviceReaders: DeviceReaderControls? { self as? DeviceReaderControls }
}

/// Whether an optional update has reached its deadline; after it, it must install first.
public func updateIsDue(requiredAt: Date?, now: Date = Date()) -> Bool {
  guard let requiredAt else { return false }
  return requiredAt <= now
}

/// A battery level as the readers screen shows it: `Battery 82%`, `Battery 82% · charging`.
public func readerBatteryText(_ level: Double?, charging: Bool = false) -> String? {
  guard let level, level >= 0 else { return nil }
  let percent = Int((min(level, 1) * 100).rounded())
  return charging ? "Battery \(percent)% · charging" : "Battery \(percent)%"
}

/// Why connecting needs the person's say-so, read out when they refused it.
public let readerLocationRefused =
  "Allow location for Aglyn POS in Settings to use a card reader. Card networks require the location of in-person payments."
