// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

#if os(iOS) && canImport(StripeTerminal)
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
   * file only binds the SDK to it. Aglyn POS alone links the SDK, and only on
   * iPhone and iPad: it publishes this collector as `DeviceCardReaders.shared`
   * at launch, and the commerce plugin's register, readers screen and kiosk
   * (and a booking paid at the counter) see only `CardCollector` and
   * `DeviceReaderControls`. The Aglyn app links no card reader SDK.
   *
   * Nothing is asked of the person until they choose to connect a reader on
   * the readers screen: location (card networks require it for in-person
   * payments) is asked then, and Bluetooth by the SDK as it scans. Opening the
   * register only reconnects the reader connected last time, and only when
   * those permissions were already given.
   *
   * Connection tokens come from `commerce/pos-terminal-connection-token` for
   * the site's Terminal Location. In test mode the SDK's simulated readers
   * answer, so the register is exercised without hardware. Card-present
   * payments settle on the platform account: the connection never sets
   * `onBehalfOf`, and the server's intent alone decides where money goes.
   *
   * WITH NO CONNECTION (AGL-4039) a Bluetooth reader still takes cards: the
   * app creates the intent itself (`OfflineTerminalPort`, the sequence in
   * AglynHardware) and the SDK stores the card until a connection returns,
   * then forwards it and tells `OfflineDelegate`, which writes the outcome to
   * the device's forward ledger for the register. The site's Location and
   * merchant name are remembered per site, so the SDK can start and the
   * reader can reconnect while the console cannot be reached.
   */

  /// No connection token to hand the SDK, or no reader where one was expected.
  private enum ReaderSetupError: Error, LocalizedError {
    case notSetUp
    var errorDescription: String? { "Card readers are not set up for this store yet." }
  }

  /// The SDK asks for a connection token whenever it needs one; the site's
  /// session source mints it. The first token of a site is the one the setup
  /// already fetched, so it is not minted twice.
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
        return completion(nil, ReaderSetupError.notSetUp as NSError)
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

  /// Location, asked for when the person connects a reader and answered by the system prompt.
  @MainActor
  private final class LocationAsk: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var waiting: [CheckedContinuation<CLAuthorizationStatus, Never>] = []

    override init() {
      super.init()
      manager.delegate = self
    }

    var status: CLAuthorizationStatus { manager.authorizationStatus }

    var allowed: Bool { status == .authorizedWhenInUse || status == .authorizedAlways }

    func request() async -> CLAuthorizationStatus {
      guard status == .notDetermined else { return status }
      return await withCheckedContinuation { continuation in
        waiting.append(continuation)
        if waiting.count == 1 { manager.requestWhenInUseAuthorization() }
      }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
      let status = manager.authorizationStatus
      guard status != .notDetermined else { return }
      Task { @MainActor in
        let answered = self.waiting
        self.waiting = []
        for continuation in answered { continuation.resume(returning: status) }
      }
    }
  }

  /// The SDK's delegate callbacks, handed to the collector on the main actor.
  private final class TerminalEvents: NSObject, DiscoveryDelegate, TapToPayReaderDelegate, MobileReaderDelegate,
    OfflineDelegate, @unchecked Sendable
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

    func reader(_ reader: Reader, didStartReconnect cancelable: Cancelable, disconnectReason: DisconnectReason) {
      send { $0.didStartReconnect() }
    }

    func readerDidSucceedReconnect(_ reader: Reader) {
      send { $0.didConnect(reader) }
    }

    func readerDidFailReconnect(_ reader: Reader) {
      send { $0.didDisconnect() }
    }

    func reader(_ reader: Reader, didRequestReaderInput inputOptions: ReaderInputOptions) {
      // The ways the reader takes the card right now: a large tap can ask for the chip instead (AGL-4039).
      var ways: [String] = []
      if inputOptions.contains(.tapCard) { ways.append("TAP") }
      if inputOptions.contains(.insertCard) { ways.append("INSERT") }
      if inputOptions.contains(.swipeCard) { ways.append("SWIPE") }
      let words = readerInputPrompt(ways)
      send { $0.prompt = words }
    }

    func reader(_ reader: Reader, didRequestReaderDisplayMessage displayMessage: ReaderDisplayMessage) {
      let words = readerPrompt(Self.displayName(displayMessage))
      send { $0.prompt = words }
    }

    func reader(_ reader: Reader, didStartInstallingUpdate update: ReaderSoftwareUpdate, cancelable: Cancelable?) {
      let offered = readerUpdate(update)
      send { $0.updateStarted(offered) }
    }

    func reader(_ reader: Reader, didReportReaderSoftwareUpdateProgress progress: Float) {
      send { $0.updateProgress(Double(progress)) }
    }

    func reader(_ reader: Reader, didFinishInstallingUpdate update: ReaderSoftwareUpdate?, error: Error?) {
      let failed = error.map { friendlyConnectError(code: terminalError($0).code, message: $0.localizedDescription) }
      send { $0.updateFinished(reader, failed: failed) }
    }

    func reader(_ reader: Reader, didReportAvailableUpdate update: ReaderSoftwareUpdate) {
      let offered = readerUpdate(update)
      send { $0.update = offered }
    }

    func reader(_ reader: Reader, didReportBatteryLevel batteryLevel: Float, status: BatteryStatus, isCharging: Bool) {
      send { $0.batteryChanged(Double(batteryLevel), charging: isCharging) }
    }

    /// Apple's Tap to Pay on iPhone terms were accepted on this device: Apple's education follows (Apple 4.2).
    func tapToPayReaderDidAcceptTermsOfService(_ reader: Reader) {
      send { $0.termsAccepted() }
    }

    // MARK: OfflineDelegate (AGL-4039)

    func terminal(_ terminal: Terminal, didChange offlineStatus: OfflineStatus) {}

    func terminal(_ terminal: Terminal, didForwardPaymentIntent intent: PaymentIntent, error: Error?) {
      let forward = offlineForward(intent, error: error)
      send { $0.forwarded(forward) }
    }

    func terminal(_ terminal: Terminal, didReportForwardingError error: Error) {
      // A forward that failed without naming its payment is retried by the SDK; nothing to record.
    }

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
  /// What the SDK's forward of a stored card became, for the register's ledger.
  private func offlineForward(_ intent: PaymentIntent, error: Error?) -> OfflineCardForward? {
    guard let saleKey = intent.metadata?["saleKey"], !saleKey.isEmpty else { return nil }
    let status = intent.stripeId == nil ? nil : terminalIntent(intent).status
    let present = intent.latestCharge?.paymentMethodDetails?.cardPresent
    let stored = intent.offlineDetails?.cardPresentDetails
    return OfflineCardForward(
      saleKey: saleKey, paymentIntentID: intent.stripeId,
      status: offlineForwardStatus(intentID: intent.stripeId, status: error == nil ? status : "requires_payment_method"),
      message: error.map { terminalError($0).apiMessage ?? $0.localizedDescription },
      brand: present?.brand ?? stored?.brand, last4: present?.last4 ?? stored?.last4)
  }

  /// The reader's intent as the offline sequence reads it.
  private func offlineIntent(_ intent: PaymentIntent) -> OfflineTerminalIntent {
    let present = intent.latestCharge?.paymentMethodDetails?.cardPresent
    let stored = intent.offlineDetails?.cardPresentDetails
    return OfflineTerminalIntent(
      id: intent.stripeId, status: terminalIntent(intent).status, amountCents: Int(intent.amount),
      storedOffline: intent.offlineDetails?.requiresUpload == true, saleKey: intent.metadata?["saleKey"],
      brand: present?.brand ?? stored?.brand, last4: present?.last4 ?? stored?.last4)
  }

  /// What the reader needs of a site to start with no connection: its Location, name and mode, as last seen online.
  private struct RememberedSite: Codable {
    let locationID: String
    let merchantName: String
    let testMode: Bool
  }

  private let terminalErrorNames: [Int: String] = [
    1100: "NOT_CONNECTED_TO_READER", 2020: "CANCELED", 2320: "BLUETOOTH_DISABLED",
    2321: "BLUETOOTH_ACCESS_DENIED", 2330: "BLUETOOTH_SCAN_TIMED_OUT", 3010: "READER_BUSY",
    3850: "UNSUPPORTED_READER_VERSION", 4020: "READER_CONNECTED_TO_ANOTHER_DEVICE",
    6000: "DECLINED_BY_STRIPE_API", 6500: "DECLINED_BY_READER",
    // Cards taken offline (AGL-4039): worded by AglynHardware's `offlineCardErrorMessage`, never the SDK's own text.
    2860: "OFFLINE_PAYMENTS_DATABASE_TOO_LARGE", 2890: "AMOUNT_EXCEEDS_MAX_OFFLINE_AMOUNT", 3971: "TAP_TO_PAY_READER_OFFLINE_MODE_NOT_ALLOWED",
    6901: "INTERAC_NOT_SUPPORTED_OFFLINE", 6902: "OFFLINE_AND_CARD_EXPIRED", 6903: "OFFLINE_TRANSACTION_DECLINED",
    6905: "ONLINE_PIN_NOT_SUPPORTED_OFFLINE", 10106: "NOT_CONNECTED_TO_INTERNET_AND_OFFLINE_BEHAVIOR_REQUIRE_ONLINE",
    // Tap to Pay on iPhone: worded by AglynHardware's `tapToPayNotice`.
    2910: "UNSUPPORTED_MOBILE_DEVICE_CONFIGURATION", 2920: "PASSCODE_NOT_ENABLED",
    2960: "TAP_TO_PAY_READER_TOS_ACCEPTANCE_REQUIRES_ICLOUD_SIGN_IN", 2970: "TAP_TO_PAY_READER_TOS_ACCEPTANCE_CANCELED",
    3100: "NFC_DISABLED", 3905: "TAP_TO_PAY_READER_REQUEST_INTERRUPTED", 3910: "TAP_TO_PAY_READER_FAILED_TO_PREPARE",
    3920: "TAP_TO_PAY_READER_DEVICE_BANNED", 3930: "TAP_TO_PAY_READER_TOS_NOT_YET_ACCEPTED",
    3940: "TAP_TO_PAY_READER_TOS_ACCEPTANCE_FAILED", 3950: "TAP_TO_PAY_READER_MERCHANT_BLOCKED",
    3960: "TAP_TO_PAY_READER_INVALID_MERCHANT", 3970: "TAP_TO_PAY_READER_ACCOUNT_DEACTIVATED",
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

  private func readerKind(_ type: DeviceType) -> CardCollectorKind? {
    switch type {
    case .tapToPay: .tapToPay
    case .stripeM2, .wisePad3, .chipper2X: .bluetooth
    default: nil
    }
  }

  private func readerUpdate(_ update: ReaderSoftwareUpdate) -> ReaderUpdate {
    ReaderUpdate(
      required: updateIsDue(requiredAt: update.requiredAt), version: update.deviceSoftwareVersion,
      duration: ReaderSoftwareUpdate.string(from: update.durationEstimate))
  }

  /// The SDK reader as the screens see it.
  private func deviceReader(_ reader: Reader) -> DeviceReader {
    let kind = readerKind(reader.deviceType) ?? .bluetooth
    let type = deviceTypeName(reader.deviceType)
    return DeviceReader(
      id: readerID(reader),
      label: deviceReaderLabel(
        kind: kind, deviceType: type, label: reader.label, serial: reader.serialNumber, simulated: reader.simulated),
      kind: kind, simulated: reader.simulated, batteryLevel: reader.batteryLevel?.doubleValue,
      charging: reader.isCharging?.boolValue ?? false, deviceType: type, softwareVersion: reader.deviceSoftwareVersion)
  }

  private func readerID(_ reader: Reader) -> String {
    reader.serialNumber.isEmpty ? (reader.stripeId ?? deviceTypeName(reader.deviceType)) : reader.serialNumber
  }

  @MainActor
  @Observable
  final class StripeTerminalCollector: CardCollector, DeviceReaderControls, TerminalPaymentPort, OfflineCardCollector,
    OfflineTerminalPort
  {
    static let shared = StripeTerminalCollector()

    private(set) var state: CardCollectorState = .disconnected
    fileprivate(set) var prompt: String?
    let kinds: [CardCollectorKind]
    private(set) var discovery: ReaderDiscovery = .idle
    private(set) var connectedReader: DeviceReader?
    fileprivate(set) var update: ReaderUpdate?
    /// Why Tap to Pay on iPhone could not connect last time (the checkout button says it).
    private(set) var tapToPayNotice: TapToPayNotice?
    /// Apple's terms were just accepted here; the register shows Apple's education, then clears it.
    private(set) var tapToPayTermsJustAccepted = false
    /// Only Aglyn staff may accept Apple's terms (`tapToPayTermsPermitted`); a warm-up never shows them.
    @ObservationIgnored private var termsPermitted = false
    @ObservationIgnored private var silent = false
    /// The kind being connected, so Tap to Pay's setup reads as its own and not as a reader update.
    @ObservationIgnored private var connectingKind: CardCollectorKind?
    private var osMajor: Int { ProcessInfo.processInfo.operatingSystemVersion.majorVersion }

    @ObservationIgnored private let tokens = TerminalTokens()
    @ObservationIgnored private let events = TerminalEvents()
    @ObservationIgnored private let location = LocationAsk()
    @ObservationIgnored private let defaults = UserDefaults.standard
    /// The site the SDK's tokens are for, and what its session said.
    @ObservationIgnored private var siteID: String?
    @ObservationIgnored private var locationID: String?
    @ObservationIgnored private var merchantName = "Store"
    @ObservationIgnored private var testMode = false
    @ObservationIgnored private var deviceType: String?
    @ObservationIgnored private var intent: PaymentIntent?
    /// The intent of the card being taken offline (AGL-4039).
    @ObservationIgnored private var offlinePayment: PaymentIntent?
    @ObservationIgnored var onOfflineForward: (() -> Void)?
    @ObservationIgnored private let forwards = OfflineCardForwardLedger()
    @ObservationIgnored private var inFlight: Cancelable?
    /// Discovered SDK readers by id, so a pick maps back to the SDK object.
    @ObservationIgnored private var found: [String: Reader] = [:]
    @ObservationIgnored private var discovering: Cancelable?
    /// Bumped by each new discovery or connect, so a stale discovery's end does not overwrite a newer state.
    @ObservationIgnored private var generation = 0

    private static let rememberedKind = "aglyn.pos.reader.kind"
    private static let rememberedReader = "aglyn.pos.reader.id"

    private init() {
      // Tap to Pay is on iPhone only; an iPad takes cards on a Bluetooth reader.
      kinds = UIDevice.current.userInterfaceIdiom == .phone ? [.tapToPay, .bluetooth] : [.bluetooth]
      events.collector = self
    }

    // MARK: Setup

    /// Points the SDK at `hostID` (initializing it once). False, with the
    /// state or the discovery saying why, when location is refused or the site
    /// is not set up for card readers. `ask` false never prompts.
    private func prepare(hostID: String, sessions: CardReaderSessionSource, ask: Bool) async -> Bool {
      if !location.allowed {
        guard ask else { return false }
        let answer = await location.request()
        if answer != .authorizedWhenInUse && answer != .authorizedAlways {
          discovery = .failed(readerLocationRefused)
          return false
        }
      }
      if siteID != hostID {
        if Terminal.isInitialized() {
          if Terminal.shared.connectedReader != nil { await disconnectSDK() }
          try? Terminal.shared.clearCachedCredentials()
        }
        didDisconnect()
        siteID = hostID
        locationID = nil
      }
      tokens.hostID = hostID
      tokens.sessions = sessions
      if locationID == nil {
        do {
          let session = try await sessions.session(hostID: hostID)
          locationID = session.locationID
          merchantName = session.merchantDisplayName
          testMode = session.testMode
          tokens.prefetched = session.secret
          remember(site: hostID, RememberedSite(locationID: session.locationID, merchantName: session.merchantDisplayName, testMode: session.testMode))
        } catch let lost as CardReaderSetupError where lost.code == .unreachable {
          // No connection: start from what this site's reader last saw online, so a card can be stored (AGL-4039).
          guard let known = rememberedSite(hostID) else {
            state = .unavailable("Card readers are not set up for this store yet.")
            if ask { discovery = .failed("Connect once so the card reader can get ready to work offline.") }
            return false
          }
          locationID = known.locationID
          merchantName = known.merchantName
          testMode = known.testMode
        } catch {
          let words =
            (error as? CardReaderSetupError)?.message ?? (error as? LocalizedError)?.errorDescription
            ?? "Card readers are not set up for this store yet."
          state = .unavailable(words)
          if ask { discovery = .failed(words) }
          return false
        }
      }
      if !Terminal.isInitialized() {
        Terminal.initWithTokenProvider(tokens, delegate: nil, offlineDelegate: events, logLevel: .none)
      }
      // The simulated reader stores cards offline only when asked to (test mode).
      if testMode { Terminal.shared.simulatorConfiguration.offlineEnabled = true }
      if case .unavailable = state { state = .disconnected }
      return true
    }

    // MARK: DeviceReaderControls

    func discover(_ kind: CardCollectorKind, hostID: String, sessions: CardReaderSessionSource) async {
      guard kinds.contains(kind) else {
        discovery = .failed("This device cannot use that card reader.")
        return
      }
      if kind == .tapToPay, osMajor < TapToPayIPhone.minimumOSMajor {
        tapToPayNotice = .needsUpdate
        discovery = .failed(TapToPayNotice.needsUpdate.message)
        return
      }
      guard await prepare(hostID: hostID, sessions: sessions, ask: true) else { return }
      _ = await scan(kind, stopWhen: kind == .tapToPay ? { _ in true } : { _ in false })
    }

    /// Scans for `kind` and lists what it finds; ends at the SDK's timeout,
    /// on Stop, or as soon as `stopWhen` picks a reader. Returns the readers found.
    @discardableResult
    private func scan(_ kind: CardCollectorKind, stopWhen: @escaping (Reader) -> Bool) async -> [Reader] {
      await cancelDiscovery()
      generation += 1
      let mine = generation
      found = [:]
      discovery = .searching(kind, [])
      let config: DiscoveryConfiguration
      do {
        config =
          kind == .tapToPay
          ? try TapToPayDiscoveryConfigurationBuilder().setSimulated(testMode).build()
          : try BluetoothScanDiscoveryConfigurationBuilder().setSimulated(testMode).setTimeout(30).build()
      } catch {
        discovery = .failed(friendlyDiscoveryError(code: terminalError(error).code, message: error.localizedDescription))
        return []
      }
      let error: Error? = await withCheckedContinuation { continuation in
        events.onDiscovered = { [weak self] readers in
          guard let self, self.generation == mine else { return }
          let usable = readers.filter { readerKind($0.deviceType) == kind }
          for reader in usable { self.found[readerID(reader)] = reader }
          self.discovery = .searching(kind, usable.map(deviceReader))
          if usable.contains(where: stopWhen), let pending = self.discovering, !pending.completed {
            pending.cancel { _ in }
          }
        }
        discovering = Terminal.shared.discoverReaders(config, delegate: events) { error in
          Task { @MainActor in continuation.resume(returning: error) }
        }
      }
      if generation == mine {
        discovering = nil
        let list = Array(found.values)
        let code = error.map { terminalError($0).code } ?? ""
        if let error, code != "CANCELED", !(code == "BLUETOOTH_SCAN_TIMED_OUT" && !list.isEmpty) {
          discovery = .failed(friendlyDiscoveryError(code: code, message: error.localizedDescription))
        } else {
          discovery = .found(kind, list.map(deviceReader).sorted { $0.label < $1.label })
        }
      }
      return Array(found.values)
    }

    func cancelDiscovery() async {
      guard let pending = discovering else { return }
      discovering = nil
      guard !pending.completed else { return }
      await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
        pending.cancel { _ in continuation.resume() }
      }
    }

    @discardableResult
    func connect(to reader: DeviceReader, hostID: String, sessions: CardReaderSessionSource) async -> Bool {
      guard await prepare(hostID: hostID, sessions: sessions, ask: true) else { return false }
      guard let sdkReader = found[reader.id] else {
        discovery = .failed("Find the reader again, then connect.")
        return false
      }
      return await connectSDK(sdkReader, kind: reader.kind)
    }

    private func connectSDK(_ reader: Reader, kind: CardCollectorKind) async -> Bool {
      guard let locationID else { return false }
      generation += 1
      await cancelDiscovery()
      state = .connecting(kind == .tapToPay ? "Getting \(TapToPayIPhone.title) ready…" : "Connecting \(deviceReader(reader).label)…")
      connectingKind = kind
      defer { connectingKind = nil }
      do {
        let config: ConnectionConfiguration
        if kind == .tapToPay {
          // Aglyn accepts Apple's terms once for every store; a store member, or a warm-up, never sees them.
          config = try TapToPayConnectionConfigurationBuilder(delegate: events, locationId: locationID)
            .setMerchantDisplayName(merchantName)
            .setTosAcceptancePermitted(termsPermitted && !silent)
            .build()
        } else {
          // A simulated Bluetooth reader stays at its own mock location.
          let builder = BluetoothConnectionConfigurationBuilder(
            delegate: events, locationId: reader.simulated ? (reader.locationId ?? locationID) : locationID)
          #if DEBUG
            // `-AglynSimulateReaderUpdate available|required` offers the simulated reader an update to install.
            switch UserDefaults.standard.string(forKey: "AglynSimulateReaderUpdate") {
            case "available": _ = builder.setTestReaderUpdate(.available(.firmware))
            case "required": _ = builder.setTestReaderUpdate(.required(.firmware))
            default: break
            }
          #endif
          config = try builder.build()
        }
        let connected = try await connectReader(reader, config)
        if kind == .tapToPay { tapToPayNotice = nil }
        didConnect(connected)
        defaults.set(kind.rawValue, forKey: Self.rememberedKind)
        defaults.set(readerID(connected), forKey: Self.rememberedReader)
        discovery = .idle
        return true
      } catch {
        state = .disconnected
        let code = terminalError(error).code
        let words = friendlyConnectError(code: code, message: (error as NSError).localizedDescription)
        if kind == .tapToPay { tapToPayNotice = tapToPayNotice(code: code) ?? .failed(words) }
        discovery = .failed(words)
        return false
      }
    }

    func forget() async {
      defaults.removeObject(forKey: Self.rememberedKind)
      defaults.removeObject(forKey: Self.rememberedReader)
      await disconnect()
    }

    func installUpdate() async {
      guard Terminal.isInitialized(), Terminal.shared.connectedReader != nil else { return }
      update = ReaderUpdate(progress: 0, required: update?.required ?? false, version: update?.version)
      Terminal.shared.installAvailableUpdate()
    }

    /// Gets the reader ready when the app opens or comes back to the front (Apple 1.5): the reader connected last
    /// time, else Tap to Pay on iPhone on an iPhone that can take it. Silent: no permission and no terms are asked for.
    func warmUp(hostID: String, sessions: CardReaderSessionSource) async {
      guard !state.isConnected, discovering == nil else { return }
      if defaults.string(forKey: Self.rememberedKind) != nil {
        await reconnectRemembered(hostID: hostID, sessions: sessions)
        return
      }
      guard kinds.contains(.tapToPay), osMajor >= TapToPayIPhone.minimumOSMajor, location.allowed,
        tapToPayNotice != .notTurnedOn
      else { return }
      silent = true
      defer { silent = false }
      guard await prepare(hostID: hostID, sessions: sessions, ask: false) else { return }
      if let first = await scan(.tapToPay, stopWhen: { _ in true }).first {
        _ = await connectSDK(first, kind: .tapToPay)
      }
      if !state.isConnected { discovery = .idle }
    }

    func permitTapToPayTerms(_ permitted: Bool) { termsPermitted = permitted }

    func clearTapToPayTermsJustAccepted() { tapToPayTermsJustAccepted = false }

    fileprivate func termsAccepted() {
      tapToPayTermsJustAccepted = true
      tapToPayNotice = nil
    }

    func reconnectRemembered(hostID: String, sessions: CardReaderSessionSource) async {
      silent = true
      defer { silent = false }
      guard !state.isConnected, location.allowed,
        let raw = defaults.string(forKey: Self.rememberedKind), let kind = CardCollectorKind(rawValue: raw),
        kinds.contains(kind)
      else { return }
      guard await prepare(hostID: hostID, sessions: sessions, ask: false) else { return }
      let remembered = defaults.string(forKey: Self.rememberedReader)
      let readers = await scan(kind) { kind == .tapToPay || readerID($0) == remembered }
      guard let match = readers.first(where: { kind == .tapToPay || readerID($0) == remembered }) else {
        discovery = .idle
        return
      }
      _ = await connectSDK(match, kind: kind)
      if !state.isConnected { discovery = .idle }
    }

    // MARK: CardCollector

    /// Connects the first reader of `kind` discovery finds (the kiosk's one-button setup).
    @discardableResult
    func connect(hostID: String, kind: CardCollectorKind, sessions: CardReaderSessionSource) async
      -> CardCollectorState
    {
      guard kinds.contains(kind) else {
        state = .unavailable("This device cannot use that card reader.")
        return state
      }
      if siteID == hostID, state.isConnected { return state }
      if kind == .tapToPay, osMajor < TapToPayIPhone.minimumOSMajor {
        tapToPayNotice = .needsUpdate
        return state
      }
      guard await prepare(hostID: hostID, sessions: sessions, ask: true) else {
        if case .failed(let words) = discovery, !state.isConnected { state = .unavailable(words) }
        return state
      }
      state = .connecting(kind == .tapToPay ? "Getting \(TapToPayIPhone.title) ready…" : "Looking for card readers…")
      guard let first = await scan(kind, stopWhen: { _ in true }).first else {
        if case .failed(let words) = discovery { state = .unavailable(words) } else { state = .disconnected }
        return state
      }
      if !(await connectSDK(first, kind: kind)), case .failed(let words) = discovery {
        state = .unavailable(words)
      }
      return state
    }

    private func connectReader(_ reader: Reader, _ config: ConnectionConfiguration) async throws -> Reader {
      try await withCheckedThrowingContinuation { continuation in
        Terminal.shared.connectReader(reader, connectionConfig: config) { connected, error in
          if let connected { continuation.resume(returning: connected) } else {
            continuation.resume(throwing: error ?? ReaderSetupError.notSetUp)
          }
        }
      }
    }

    func disconnect() async {
      await cancelDiscovery()
      await disconnectSDK()
      didDisconnect()
    }

    private func disconnectSDK() async {
      guard Terminal.isInitialized(), Terminal.shared.connectedReader != nil else { return }
      await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
        Terminal.shared.disconnectReader { _ in continuation.resume() }
      }
    }

    // MARK: SDK events

    private func remember(site hostID: String, _ site: RememberedSite) {
      if let data = try? JSONEncoder().encode(site) { defaults.set(data, forKey: "aglyn.pos.reader.site.\(hostID)") }
    }

    private func rememberedSite(_ hostID: String) -> RememberedSite? {
      guard let data = defaults.data(forKey: "aglyn.pos.reader.site.\(hostID)") else { return nil }
      return try? JSONDecoder().decode(RememberedSite.self, from: data)
    }

    fileprivate func forwarded(_ forward: OfflineCardForward?) {
      guard let forward else { return }
      forwards.record(forward)
      onOfflineForward?()
    }

    fileprivate func didConnect(_ reader: Reader) {
      let device = deviceReader(reader)
      connectedReader = device
      deviceType = device.deviceType
      state = .connected(label: device.label, kind: device.kind, testMode: reader.simulated || !reader.livemode)
      update = reader.availableUpdate.map(readerUpdate)
    }

    fileprivate func didStartReconnect() {
      state = .connecting("Reconnecting \(connectedReader?.label ?? "the card reader")…")
    }

    fileprivate func didDisconnect() {
      if state.isConnected || { if case .connecting = state { return true } else { return false } }() {
        state = .disconnected
      }
      connectedReader = nil
      deviceType = nil
      prompt = nil
      update = nil
    }

    fileprivate func batteryChanged(_ level: Double, charging: Bool) {
      connectedReader?.batteryLevel = level
      connectedReader?.charging = charging
    }

    fileprivate func updateStarted(_ offered: ReaderUpdate) {
      update = ReaderUpdate(progress: 0, required: offered.required, version: offered.version, duration: offered.duration)
      prompt =
        connectingKind == .tapToPay
        ? TapToPayNotice.preparing(progress: 0).title + "…" : "Updating the card reader. Keep it close and charged."
    }

    fileprivate func updateProgress(_ progress: Double) {
      var next = update ?? ReaderUpdate()
      next.progress = progress
      update = next
      let percent = Int((progress * 100).rounded())
      prompt =
        connectingKind == .tapToPay
        ? "\(TapToPayNotice.preparing(progress: progress).title): \(percent)%." : "Updating the card reader: \(percent)%."
    }

    fileprivate func updateFinished(_ reader: Reader, failed: String?) {
      prompt = nil
      if let failed {
        update = ReaderUpdate(required: update?.required ?? false, version: update?.version)
        discovery = .failed(failed)
      } else {
        update = nil
        connectedReader?.softwareVersion = reader.deviceSoftwareVersion
      }
    }

    // MARK: Payments

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

    // MARK: OfflineCardCollector (AGL-4039)

    var offlineCardUnavailableReason: String? {
      guard case .connected(_, let kind, _) = state else { return "Connect the card reader to take cards offline." }
      if kind == .tapToPay {
        return "Tap to Pay cannot take cards offline on this phone. Connect a Bluetooth card reader, or take cash."
      }
      return nil
    }

    func collectOffline(_ request: OfflineCardRequest) async -> OfflineCardOutcome {
      prompt = nil
      defer {
        prompt = nil
        offlinePayment = nil
        inFlight = nil
      }
      return await collectOfflineCardPayment(self, request, readerDeviceType: state.isConnected ? deviceType : nil)
    }

    func registerConnectivityChanged(online: Bool) {
      #if DEBUG
        // `-AglynMirrorOfflineToStripe YES`: a simulated reader goes offline with the register, so store and forward
        // can be driven on a simulator whose Mac still reaches Stripe.
        guard testMode, UserDefaults.standard.bool(forKey: "AglynMirrorOfflineToStripe"), Terminal.isInitialized() else { return }
        guard
          let config = try? SimulatedOfflineModeConfigurationBuilder()
            .setSdkOfflineMode(online ? .disabled : .offlineImmediate)
            .build()
        else { return }
        try? Terminal.shared.setSimulatedOfflineModeConfiguration(config)
      #endif
    }

    // MARK: OfflineTerminalPort

    func create(_ request: OfflineCardRequest) async -> Result<OfflineTerminalIntent, TerminalError> {
      let params: PaymentIntentParameters
      let config: CreateConfiguration
      do {
        params = try PaymentIntentParametersBuilder(amount: UInt(request.amountCents), currency: request.currency)
          .setCaptureMethod(.manual)
          .setTransferDataDestination(request.destination)
          .setMetadata(request.metadata)
          .build()
        // The store's limits once more at the SDK: above them the card must be taken online.
        let held = Terminal.shared.offlineStatus.sdk.paymentAmountsByCurrency[request.currency]?.intValue ?? 0
        let behavior: OfflineBehavior = offlineCardRequiresOnline(request, sdkStoredCents: held) ? .requireOnline : .preferOnline
        config = try CreateConfigurationBuilder().setOfflineBehavior(behavior).build()
      } catch {
        return .failure(terminalError(error))
      }
      return await withCheckedContinuation { continuation in
        Terminal.shared.createPaymentIntent(params, createConfig: config) { created, error in
          Task { @MainActor in
            if let created {
              self.offlinePayment = created
              continuation.resume(returning: .success(offlineIntent(created)))
            } else {
              continuation.resume(returning: .failure(terminalError(error ?? ReaderSetupError.notSetUp)))
            }
          }
        }
      }
    }

    func collect(saleKey: String) async -> Result<OfflineTerminalIntent, TerminalError> {
      guard let payment = offlinePayment else { return .failure(TerminalError(code: "INTENT_NOT_CREATED")) }
      let config: CollectPaymentIntentConfiguration
      do {
        config = try CollectPaymentIntentConfigurationBuilder().setSkipTipping(true).build()
      } catch {
        return .failure(terminalError(error))
      }
      return await withCheckedContinuation { continuation in
        inFlight = Terminal.shared.collectPaymentMethod(payment, collectConfig: config) { collected, error in
          Task { @MainActor in
            if let collected {
              self.offlinePayment = collected
              continuation.resume(returning: .success(offlineIntent(collected)))
            } else {
              continuation.resume(returning: .failure(terminalError(error ?? ReaderSetupError.notSetUp)))
            }
          }
        }
      }
    }

    func confirm(saleKey: String) async -> Result<OfflineTerminalIntent, TerminalError> {
      guard let payment = offlinePayment else { return .failure(TerminalError(code: "INTENT_NOT_CREATED")) }
      inFlight = nil
      return await withCheckedContinuation { continuation in
        _ = Terminal.shared.confirmPaymentIntent(payment) { confirmed, error in
          Task { @MainActor in
            if let confirmed {
              continuation.resume(returning: .success(offlineIntent(confirmed)))
            } else {
              continuation.resume(returning: .failure(terminalError(error ?? ReaderSetupError.notSetUp)))
            }
          }
        }
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
              continuation.resume(returning: .failure(terminalError(error ?? ReaderSetupError.notSetUp)))
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
              continuation.resume(returning: .failure(terminalError(error ?? ReaderSetupError.notSetUp)))
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
                returning: .failure(terminalError(error ?? ReaderSetupError.notSetUp, intent: intent)))
            }
          }
        }
      }
    }
  }
#endif
