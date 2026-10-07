// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

#if os(iOS)
  import AglynHardware
  import CoreLocation
  import Foundation
  import Observation
  import StripeTerminal
  import UIKit

  /*
   * THIS DEVICE'S READER, THROUGH THE STRIPE TERMINAL SDK.
   *
   * Tap to Pay on iPhone, or a Bluetooth reader (Stripe M2, WisePad 3) near
   * the iPhone or iPad. The collect sequence and every word the cashier reads
   * live in AglynHardware (`collectCardPayment`, tested with a fake); this
   * file only binds the SDK to it.
   *
   * Connection tokens come from `commerce/pos-terminal-connection-token` for
   * the site's Terminal Location. In test mode the SDK's simulated readers
   * answer, so the register is exercised without hardware. Card-present
   * payments settle on the platform account: the connection never sets
   * `onBehalfOf`, and the server's intent alone decides where money goes.
   */

  /// The SDK asks for a connection token whenever it needs one; the site's
  /// session source mints it. The first token of a connect is the one the
  /// connect already fetched, so it is not minted twice.
  private final class TerminalTokens: NSObject, ConnectionTokenProvider, @unchecked Sendable {
    var hostID: String?
    var sessions: CardReaderSessionSource?
    var prefetched: String?

    func fetchConnectionToken(_ completion: @escaping ConnectionTokenCompletionBlock) {
      if let token = prefetched {
        prefetched = nil
        return completion(token, nil)
      }
      guard let hostID, let sessions else {
        return completion(nil, TerminalSessionError.notSetUp as NSError)
      }
      Task {
        do {
          completion(try await sessions.session(hostID: hostID).secret, nil)
        } catch {
          completion(nil, error as NSError)
        }
      }
    }
  }

  /// The SDK's delegate callbacks, handed to the collector on the main actor.
  private final class TerminalEvents: NSObject, DiscoveryDelegate, TapToPayReaderDelegate, MobileReaderDelegate,
    @unchecked Sendable
  {
    weak var collector: StripeTerminalCollector?
    var onDiscovered: (([Reader]) -> Void)?

    private func send(_ body: @escaping @MainActor (StripeTerminalCollector) -> Void) {
      Task { @MainActor [weak collector] in if let collector { body(collector) } }
    }

    func terminal(_ terminal: Terminal, didUpdateDiscoveredReaders readers: [Reader]) {
      let handler = onDiscovered
      Task { @MainActor in handler?(readers) }
    }

    func reader(_ reader: Reader, didDisconnect reason: DisconnectReason) {
      send { $0.didDisconnect() }
    }

    func reader(_ reader: Reader, didRequestReaderInput inputOptions: ReaderInputOptions) {
      send { $0.prompt = "Present the card." }
    }

    func reader(_ reader: Reader, didRequestReaderDisplayMessage displayMessage: ReaderDisplayMessage) {
      let words = readerPrompt(Self.displayName(displayMessage))
      send { $0.prompt = words }
    }

    func reader(_ reader: Reader, didStartInstallingUpdate update: ReaderSoftwareUpdate, cancelable: Cancelable?) {
      send { $0.prompt = "Updating the card reader. Keep it close and charged." }
    }

    func reader(_ reader: Reader, didReportReaderSoftwareUpdateProgress progress: Float) {
      let percent = Int((progress * 100).rounded())
      send { $0.prompt = "Updating the card reader: \(percent)%." }
    }

    func reader(_ reader: Reader, didFinishInstallingUpdate update: ReaderSoftwareUpdate?, error: Error?) {
      send { $0.prompt = nil }
    }

    func reader(_ reader: Reader, didReportAvailableUpdate update: ReaderSoftwareUpdate) {}

    static func displayName(_ message: ReaderDisplayMessage) -> String {
      switch message {
      case .retryCard: "RETRY_CARD"
      case .insertCard: "INSERT_CARD"
      case .insertOrSwipeCard: "INSERT_OR_SWIPE_CARD"
      case .swipeCard: "SWIPE_CARD"
      case .removeCard: "REMOVE_CARD"
      case .multipleContactlessCardsDetected: "MULTIPLE_CONTACTLESS_CARDS_DETECTED"
      case .tryAnotherReadMethod: "TRY_ANOTHER_READ_METHOD"
      case .tryAnotherCard: "TRY_ANOTHER_CARD"
      case .cardRemovedTooEarly: "CARD_REMOVED_TOO_EARLY"
      @unknown default: ""
      }
    }
  }

  /// The SDK's error codes the shared words know, by their names in the
  /// Kotlin kit; anything else keeps its number.
  private let terminalErrorNames: [Int: String] = [
    1100: "NOT_CONNECTED_TO_READER", 2020: "CANCELED", 2320: "BLUETOOTH_DISABLED",
    2321: "BLUETOOTH_ACCESS_DENIED", 2330: "BLUETOOTH_SCAN_TIMED_OUT", 3010: "READER_BUSY",
    3850: "UNSUPPORTED_READER_VERSION", 4020: "READER_CONNECTED_TO_ANOTHER_DEVICE",
    6000: "DECLINED_BY_STRIPE_API", 6500: "DECLINED_BY_READER",
  ]

  private func terminalError(_ error: Error, intent: PaymentIntent? = nil) -> TerminalError {
    let ns = error as NSError
    let confirm = error as? ConfirmPaymentIntentError
    return TerminalError(
      code: terminalErrorNames[ns.code] ?? "ERROR_\(ns.code)",
      message: ns.localizedDescription,
      declineCode: confirm?.declineCode ?? confirm?.apiError?.declineCode,
      apiMessage: confirm?.apiError?.message,
      intent: (confirm?.paymentIntent ?? intent).map(terminalIntent))
  }

  private func terminalIntent(_ intent: PaymentIntent) -> TerminalIntent {
    let status =
      switch intent.status {
      case .requiresPaymentMethod: "requires_payment_method"
      case .requiresConfirmation: "requires_confirmation"
      case .requiresAction: "requires_action"
      case .requiresCapture: "requires_capture"
      case .processing: "processing"
      case .canceled: "canceled"
      case .succeeded: "succeeded"
      case .requiresReauthorization: "requires_reauthorization"
      @unknown default: "unknown"
      }
    return TerminalIntent(
      id: intent.stripeId ?? "", status: status, amountCents: Int(intent.amount),
      tipCents: intent.amountTip?.intValue ?? 0)
  }

  private func deviceTypeName(_ type: DeviceType) -> String {
    switch type {
    case .stripeM2: "STRIPE_M2"
    case .wisePad3: "WISEPAD_3"
    case .chipper2X: "CHIPPER_2X"
    case .tapToPay: "TAP_TO_PAY_DEVICE"
    default: Terminal.stringFromDeviceType(type)
    }
  }

  @MainActor
  @Observable
  final class StripeTerminalCollector: CardCollector, TerminalPaymentPort {
    static let shared = StripeTerminalCollector()

    private(set) var state: CardCollectorState = .disconnected
    fileprivate(set) var prompt: String?
    let kinds: [CardCollectorKind]

    @ObservationIgnored private let tokens = TerminalTokens()
    @ObservationIgnored private let events = TerminalEvents()
    @ObservationIgnored private let location = CLLocationManager()
    @ObservationIgnored private var hostID: String?
    @ObservationIgnored private var deviceType: String?
    @ObservationIgnored private var intent: PaymentIntent?
    @ObservationIgnored private var inFlight: Cancelable?

    private init() {
      // Tap to Pay is on iPhone only; an iPad takes cards on a Bluetooth reader.
      kinds = UIDevice.current.userInterfaceIdiom == .phone ? [.tapToPay, .bluetooth] : [.bluetooth]
      events.collector = self
    }

    private func start() {
      if !Terminal.isInitialized() { Terminal.initWithTokenProvider(tokens, delegate: nil) }
    }

    @discardableResult
    func connect(hostID: String, kind: CardCollectorKind, sessions: CardReaderSessionSource) async
      -> CardCollectorState
    {
      guard kinds.contains(kind) else {
        state = .unavailable("This device cannot use that card reader.")
        return state
      }
      if self.hostID != hostID, state.isConnected { await disconnect() }
      if state.isConnected { return state }
      if location.authorizationStatus == .notDetermined { location.requestWhenInUseAuthorization() }

      state = .connecting(kind == .tapToPay ? "Starting Tap to Pay…" : "Looking for card readers…")
      let session: CardReaderSession
      do {
        session = try await sessions.session(hostID: hostID)
      } catch {
        state = .unavailable(error.localizedDescription)
        return state
      }
      tokens.hostID = hostID
      tokens.sessions = sessions
      tokens.prefetched = session.secret
      start()

      let reader: Reader
      switch await discover(kind, simulated: session.testMode) {
      case .failure(let error):
        state = .unavailable(
          friendlyDiscoveryError(code: terminalError(error).code, message: (error as NSError).localizedDescription))
        return state
      case .success(let found): reader = found
      }

      state = .connecting("Connecting \(label(reader, kind))…")
      do {
        let config: ConnectionConfiguration =
          kind == .tapToPay
          ? try TapToPayConnectionConfigurationBuilder(delegate: events, locationId: session.locationID)
            .setMerchantDisplayName(session.merchantDisplayName)
            .build()
          : try BluetoothConnectionConfigurationBuilder(
            delegate: events,
            // A simulated Bluetooth reader stays at its own mock location.
            locationId: reader.simulated ? (reader.locationId ?? session.locationID) : session.locationID
          ).build()
        let connected = try await connectReader(reader, config)
        self.hostID = hostID
        deviceType = deviceTypeName(connected.deviceType)
        state = .connected(label: label(connected, kind), kind: kind, testMode: session.testMode)
      } catch {
        state = .unavailable(
          friendlyConnectError(code: terminalError(error).code, message: (error as NSError).localizedDescription))
      }
      return state
    }

    private func label(_ reader: Reader, _ kind: CardCollectorKind) -> String {
      deviceReaderLabel(
        kind: kind, deviceType: deviceTypeName(reader.deviceType), label: reader.label,
        serial: reader.serialNumber, simulated: reader.simulated)
    }

    /// The first reader discovery finds: Tap to Pay finds this device, a
    /// Bluetooth scan the nearest reader (it gives up after 30 seconds).
    private func discover(_ kind: CardCollectorKind, simulated: Bool) async -> Result<Reader, Error> {
      let config: DiscoveryConfiguration
      do {
        config =
          kind == .tapToPay
          ? try TapToPayDiscoveryConfigurationBuilder().setSimulated(simulated).build()
          : try BluetoothScanDiscoveryConfigurationBuilder().setSimulated(simulated).setTimeout(30).build()
      } catch {
        return .failure(error)
      }
      return await withCheckedContinuation { continuation in
        var answered = false
        func answer(_ result: Result<Reader, Error>) {
          guard !answered else { return }
          answered = true
          continuation.resume(returning: result)
        }
        events.onDiscovered = { readers in
          if let first = readers.first { answer(.success(first)) }
        }
        _ = Terminal.shared.discoverReaders(config, delegate: events) { error in
          Task { @MainActor in
            if let error { answer(.failure(error)) } else { answer(.failure(TerminalSessionError.notSetUp)) }
          }
        }
      }
    }

    private func connectReader(_ reader: Reader, _ config: ConnectionConfiguration) async throws -> Reader {
      try await withCheckedThrowingContinuation { continuation in
        Terminal.shared.connectReader(reader, connectionConfig: config) { connected, error in
          if let connected { continuation.resume(returning: connected) } else {
            continuation.resume(throwing: error ?? TerminalSessionError.notSetUp)
          }
        }
      }
    }

    func disconnect() async {
      if Terminal.isInitialized(), Terminal.shared.connectedReader != nil {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
          Terminal.shared.disconnectReader { _ in continuation.resume() }
        }
      }
      didDisconnect()
    }

    fileprivate func didDisconnect() {
      state = .disconnected
      deviceType = nil
      prompt = nil
      hostID = nil
    }

    func collect(_ request: CardCollectRequest) async -> CardCollectOutcome {
      prompt = nil
      defer {
        prompt = nil
        intent = nil
        inFlight = nil
      }
      return await collectCardPayment(self, request, readerDeviceType: state.isConnected ? deviceType : nil)
    }

    func cancel() async {
      guard let inFlight, !inFlight.completed else { return }
      await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
        inFlight.cancel { _ in continuation.resume() }
      }
    }

    // MARK: TerminalPaymentPort

    func retrieve(clientSecret: String) async -> Result<TerminalIntent, TerminalError> {
      await withCheckedContinuation { continuation in
        Terminal.shared.retrievePaymentIntent(clientSecret: clientSecret) { intent, error in
          Task { @MainActor in
            if let intent {
              self.intent = intent
              continuation.resume(returning: .success(terminalIntent(intent)))
            } else {
              continuation.resume(returning: .failure(terminalError(error ?? TerminalSessionError.notSetUp)))
            }
          }
        }
      }
    }

    func collect(intentID: String, skipTipping: Bool) async -> Result<TerminalIntent, TerminalError> {
      guard let intent, intent.stripeId == intentID else {
        return .failure(TerminalError(code: "INTENT_NOT_RETRIEVED"))
      }
      let config: CollectPaymentIntentConfiguration
      do {
        config = try CollectPaymentIntentConfigurationBuilder().setSkipTipping(skipTipping).build()
      } catch {
        return .failure(terminalError(error))
      }
      return await withCheckedContinuation { continuation in
        inFlight = Terminal.shared.collectPaymentMethod(intent, collectConfig: config) { collected, error in
          Task { @MainActor in
            if let collected {
              self.intent = collected
              continuation.resume(returning: .success(terminalIntent(collected)))
            } else {
              continuation.resume(returning: .failure(terminalError(error ?? TerminalSessionError.notSetUp)))
            }
          }
        }
      }
    }

    func confirm(intentID: String) async -> Result<TerminalIntent, TerminalError> {
      guard let intent, intent.stripeId == intentID else {
        return .failure(TerminalError(code: "INTENT_NOT_RETRIEVED"))
      }
      inFlight = nil
      return await withCheckedContinuation { continuation in
        _ = Terminal.shared.confirmPaymentIntent(intent) { confirmed, error in
          Task { @MainActor in
            if let confirmed {
              continuation.resume(returning: .success(terminalIntent(confirmed)))
            } else {
              continuation.resume(
                returning: .failure(terminalError(error ?? TerminalSessionError.notSetUp, intent: intent)))
            }
          }
        }
      }
    }
  }
#endif
