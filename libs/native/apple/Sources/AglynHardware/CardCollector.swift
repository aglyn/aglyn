// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import Observation

/*
 * THIS DEVICE'S CARD READER.
 *
 * The server has already made a `card_present` PaymentIntent for the
 * payment (a sale's tender or a booking taken at the counter) and holds the
 * money decisions. A collector's only job is the card: retrieve that intent,
 * collect a card on Tap to Pay or a Bluetooth reader, and confirm it, which
 * AUTHORIZES the charge. The server then reads Stripe and captures.
 *
 * So a collector never creates, prices or captures money, and what it
 * reports is a hint the server re-reads, never a fact anyone trusts. Every
 * outcome is one of three: collected, canceled (nobody was charged; the same
 * intent can be collected again) or failed (with words to read out). The
 * Android kit's `CardCollector` is the same contract.
 */

public struct CardCollectRequest: Equatable, Sendable {
  public let paymentIntentID: String
  public let clientSecret: String
  /// What the register shows the customer, tip included. Another amount is refused before the card is asked for.
  public let amountCents: Int
  /// Offer on-reader tipping, when the connected reader can show it.
  public let tipEligible: Bool

  public init(paymentIntentID: String, clientSecret: String, amountCents: Int, tipEligible: Bool = false) {
    self.paymentIntentID = paymentIntentID
    self.clientSecret = clientSecret
    self.amountCents = amountCents
    self.tipEligible = tipEligible
  }

  /// Nil when the request is well formed. The client secret names its own
  /// intent, and one for a different intent is refused, so nothing can ask
  /// to collect A while the register records B.
  public var problem: String? {
    guard paymentIntentID.range(of: "^pi_[A-Za-z0-9]{8,64}$", options: .regularExpression) != nil else {
      return "The payment to collect is missing."
    }
    guard let range = clientSecret.range(of: "^pi_[A-Za-z0-9]{8,64}_secret_[A-Za-z0-9]{8,128}$", options: .regularExpression),
      range == clientSecret.startIndex..<clientSecret.endIndex,
      clientSecret.components(separatedBy: "_secret_").first == paymentIntentID
    else { return "The payment to collect does not match its secret." }
    return nil
  }
}

public enum CardCollectOutcome: Equatable, Sendable {
  case collected(paymentIntentID: String, amountCents: Int, tipCents: Int)
  case canceled(paymentIntentID: String)
  case failed(paymentIntentID: String, message: String, code: String?)

  public var paymentIntentID: String {
    switch self {
    case .collected(let id, _, _), .canceled(let id), .failed(let id, _, _): id
    }
  }
}

public enum CardCollectorKind: String, Sendable {
  case tapToPay
  case bluetooth
  case simulated
}

public enum CardCollectorState: Equatable, Sendable {
  /// This device cannot take cards on its own; the words say why.
  case unavailable(String)
  case disconnected
  case connecting(String)
  case connected(label: String, kind: CardCollectorKind, testMode: Bool)

  public var isConnected: Bool {
    if case .connected = self { return true }
    return false
  }
}

/// Why a reader could not be set up, as the connection token route words it.
public enum CardReaderSetupCode: String, Sendable {
  case unavailable = "terminal-unavailable"
  case merchantNotReady = "merchant-not-ready"
  case locationRequired = "location-required"
}

public struct CardReaderSetupError: Error, LocalizedError, Equatable {
  public let code: CardReaderSetupCode
  public let message: String

  public init(code: CardReaderSetupCode, message: String) {
    self.code = code
    self.message = message
  }

  public var errorDescription: String? { message }
}

/// A Terminal connection token for one site, scoped to the site's Terminal Location.
public struct CardReaderSession: Equatable, Sendable {
  public let secret: String
  public let locationID: String
  public let merchantDisplayName: String
  public let testMode: Bool

  public init(secret: String, locationID: String, merchantDisplayName: String, testMode: Bool) {
    self.secret = secret
    self.locationID = locationID
    self.merchantDisplayName = merchantDisplayName
    self.testMode = testMode
  }
}

/// The server half a device reader needs: a connection token whenever the
/// SDK asks for one. The commerce plugin provides it over its own route;
/// the kit never names a plugin.
public protocol CardReaderSessionSource: Sendable {
  /// Throws `CardReaderSetupError` when the site is not ready for card readers.
  func session(hostID: String) async throws -> CardReaderSession
}

/// This device's own card reader. Implementations are `@Observable`, so a
/// view that reads `state` follows it.
@MainActor
public protocol CardCollector: AnyObject {
  var state: CardCollectorState { get }
  /// What the reader asks the cashier to read out right now ("Insert the
  /// card."), while a payment is in progress.
  var prompt: String? { get }
  /// The readers this device can offer, for the readers screen.
  var kinds: [CardCollectorKind] { get }
  /// Connects for one site; `sessions` mints the connection tokens.
  @discardableResult
  func connect(hostID: String, kind: CardCollectorKind, sessions: CardReaderSessionSource) async -> CardCollectorState
  func disconnect() async
  /// Retrieves, collects and confirms one server-made intent. Validates `request` first.
  func collect(_ request: CardCollectRequest) async -> CardCollectOutcome
  /// Stops a collection in progress; the customer was not charged.
  func cancel() async
}

extension CardCollector {
  public var prompt: String? { nil }
}

/// A reader for tests, demos and training: no card, no SDK. It validates the
/// request like a real reader, waits, and answers (by default, collects the
/// amount it was asked for).
@MainActor
@Observable
public final class SimulatedCardCollector: CardCollector {
  public static let label = "Simulated reader"

  public private(set) var state: CardCollectorState = .disconnected
  public let kinds: [CardCollectorKind] = [.simulated]
  @ObservationIgnored private let delay: Duration
  @ObservationIgnored private let answer: @Sendable (CardCollectRequest) -> CardCollectOutcome
  @ObservationIgnored private var canceled = false

  public init(
    delay: Duration = .milliseconds(1200),
    answer: @escaping @Sendable (CardCollectRequest) -> CardCollectOutcome = {
      .collected(paymentIntentID: $0.paymentIntentID, amountCents: $0.amountCents, tipCents: 0)
    }
  ) {
    self.delay = delay
    self.answer = answer
  }

  public func connect(hostID: String, kind: CardCollectorKind, sessions: CardReaderSessionSource) async
    -> CardCollectorState
  {
    state = .connected(label: Self.label, kind: .simulated, testMode: true)
    return state
  }

  public func disconnect() async { state = .disconnected }

  public func collect(_ request: CardCollectRequest) async -> CardCollectOutcome {
    if let problem = request.problem {
      return .failed(paymentIntentID: request.paymentIntentID, message: problem, code: nil)
    }
    guard state.isConnected else {
      return .failed(paymentIntentID: request.paymentIntentID, message: "Connect the card reader first.", code: nil)
    }
    canceled = false
    try? await Task.sleep(for: delay)
    if canceled { return .canceled(paymentIntentID: request.paymentIntentID) }
    return answer(request)
  }

  public func cancel() async { canceled = true }
}

/// This device's own card reader, as the plugin that drives it publishes it
/// (the commerce plugin's Stripe Terminal collector on iPhone and iPad), so
/// another plugin's screen (a booking paid at the counter) collects on the
/// same reader without naming that plugin. Nil where the device takes no
/// cards itself.
@MainActor
public enum DeviceCardReaders {
  public static var shared: CardCollector?
}
