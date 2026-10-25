// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * A CARD TAKEN WITH NO CONNECTION (AGL-4039), on this device's own reader.
 *
 * Online, the server makes every card PaymentIntent and the reader only
 * collects it (`collectCardPayment`). Offline there is no server to ask, so
 * the app makes the intent itself through the Stripe Terminal SDK, which
 * stores the card on the device ("store and forward") and sends it to Stripe
 * once a connection returns. The intent is a destination charge with MANUAL
 * capture and no application fee: the server captures it when the sale
 * syncs, and sizes the platform fee then.
 *
 * Every rule that does not need the SDK lives here and is tested with a fake
 * port: the request's checks, the create → collect → confirm sequence, and
 * what a forwarded card became. The SDK adapters (Aglyn POS's Stripe Terminal
 * collector on Apple, the Kotlin kit's `OfflineCard.kt`) only bind calls.
 *
 * A forward can happen at any time, even before the register is on screen
 * (the SDK forwards on launch), so every outcome is written to a small ledger
 * on the device, keyed by the sale, and the register applies it when it next
 * looks. Nothing is lost if the app was not listening.
 */

/// One card to take offline for one sale.
public struct OfflineCardRequest: Equatable, Sendable {
  /// The sale's key: the order's id once it syncs, and the intent's `metadata.saleKey`.
  public let saleKey: String
  public let amountCents: Int
  public let currency: String
  /// The connected account the charge transfers to.
  public let destination: String
  public let metadata: [String: String]
  /// The store's limit per sale offline, in cents: above it the SDK is told to require a connection.
  public let maxSaleCents: Int
  /// The store's daily limit per device, in cents, and what this device took offline today before this card.
  public let maxDeviceDailyCents: Int
  public let takenTodayCents: Int

  public init(
    saleKey: String, amountCents: Int, currency: String, destination: String, metadata: [String: String],
    maxSaleCents: Int = Int.max, maxDeviceDailyCents: Int = Int.max, takenTodayCents: Int = 0
  ) {
    self.saleKey = saleKey
    self.amountCents = amountCents
    self.currency = currency
    self.destination = destination
    self.metadata = metadata
    self.maxSaleCents = maxSaleCents
    self.maxDeviceDailyCents = maxDeviceDailyCents
    self.takenTodayCents = takenTodayCents
  }

  /// Nil when the request is well formed.
  public var problem: String? {
    guard saleKey.range(of: "^[A-Za-z0-9_-]{16,64}$", options: .regularExpression) != nil else {
      return "The sale has no key to charge the card against."
    }
    guard amountCents > 0 else { return "There is nothing to charge." }
    guard destination.hasPrefix("acct_") else { return "Card payments are not set up for this store." }
    guard currency.range(of: "^[a-z]{3}$", options: .regularExpression) != nil else {
      return "The store's currency is missing."
    }
    guard metadata["saleKey"] == saleKey else { return "The card does not name its sale." }
    return nil
  }
}

/// A card the reader has taken, on the device or already with Stripe.
public struct OfflineCardTaken: Equatable, Sendable {
  public let saleKey: String
  /// Stripe's id when Stripe already has it (the SDK reached Stripe after all); nil while stored on the device.
  public let paymentIntentID: String?
  public let brand: String?
  public let last4: String?

  public init(saleKey: String, paymentIntentID: String?, brand: String? = nil, last4: String? = nil) {
    self.saleKey = saleKey
    self.paymentIntentID = paymentIntentID
    self.brand = brand
    self.last4 = last4
  }

  /// Visa •••• 4242, or "Card".
  public var label: String { offlineCardLabel(brand: brand, last4: last4) }
}

public enum OfflineCardOutcome: Equatable, Sendable {
  case taken(OfflineCardTaken)
  /// Nobody was charged; the sale can be tried again.
  case canceled
  case failed(message: String, code: String?)
}

/// What became of a stored card once the SDK sent it to Stripe.
public struct OfflineCardForward: Codable, Equatable, Sendable {
  public enum Status: String, Codable, Sendable {
    /// Stripe has it and the bank authorized it: the sync captures it.
    case authorized
    /// The bank refused it.
    case declined
    /// Stripe could not take it at all.
    case failed
  }

  public let saleKey: String
  public let paymentIntentID: String?
  public let status: Status
  public let message: String?
  public let brand: String?
  public let last4: String?

  public init(
    saleKey: String, paymentIntentID: String?, status: Status, message: String? = nil, brand: String? = nil,
    last4: String? = nil
  ) {
    self.saleKey = saleKey
    self.paymentIntentID = paymentIntentID
    self.status = status
    self.message = message
    self.brand = brand
    self.last4 = last4
  }
}

/// An intent the SDK made or handed back, reduced to what the offline sequence reads.
public struct OfflineTerminalIntent: Equatable, Sendable {
  /// Nil while the intent exists only on the device.
  public let id: String?
  public let status: String
  public let amountCents: Int
  /// Confirmed while offline: the card waits on the device for its forward.
  public let storedOffline: Bool
  public let saleKey: String?
  public let brand: String?
  public let last4: String?

  public init(
    id: String?, status: String, amountCents: Int, storedOffline: Bool, saleKey: String? = nil, brand: String? = nil,
    last4: String? = nil
  ) {
    self.id = id
    self.status = status
    self.amountCents = amountCents
    self.storedOffline = storedOffline
    self.saleKey = saleKey
    self.brand = brand
    self.last4 = last4
  }
}

/// The three SDK calls an offline card makes, one adapter per SDK.
@MainActor
public protocol OfflineTerminalPort {
  func create(_ request: OfflineCardRequest) async -> Result<OfflineTerminalIntent, TerminalError>
  func collect(saleKey: String) async -> Result<OfflineTerminalIntent, TerminalError>
  func confirm(saleKey: String) async -> Result<OfflineTerminalIntent, TerminalError>
}

private let authorizedStatuses: Set<String> = ["requires_capture", "succeeded"]

/// Create → collect → confirm, for one card taken offline. Confirming offline
/// stores the card on the device; confirming while Stripe is reachable after
/// all authorizes it there and then (a decline is then said at once, while
/// the customer is still at the counter).
@MainActor
public func collectOfflineCardPayment(
  _ port: OfflineTerminalPort, _ request: OfflineCardRequest, readerDeviceType: String?
) async -> OfflineCardOutcome {
  if let problem = request.problem { return .failed(message: problem, code: nil) }
  guard readerDeviceType != nil else { return .failed(message: "Connect the card reader first.", code: nil) }
  switch await port.create(request) {
  case .failure(let error): return offlineFailed(error, "The card could not be started. Try again.")
  case .success(let intent):
    guard intent.amountCents == request.amountCents else {
      return .failed(message: "The amount to charge does not match the register. Start again.", code: nil)
    }
  }
  if case .failure(let error) = await port.collect(saleKey: request.saleKey) {
    if error.canceled { return .canceled }
    return offlineFailed(error, "The card could not be read. Try again.")
  }
  switch await port.confirm(saleKey: request.saleKey) {
  case .failure(let error):
    if error.canceled { return .canceled }
    return offlineFailed(error, "The card did not go through. Try another card or take cash.")
  case .success(let intent):
    guard intent.storedOffline || authorizedStatuses.contains(intent.status) else {
      return .failed(message: "The card did not go through. Try another card or take cash.", code: nil)
    }
    return .taken(
      OfflineCardTaken(
        saleKey: request.saleKey, paymentIntentID: intent.storedOffline ? nil : intent.id, brand: intent.brand,
        last4: intent.last4))
  }
}

private func offlineFailed(_ error: TerminalError, _ fallback: String) -> OfflineCardOutcome {
  .failed(message: offlineCardErrorMessage(error, fallback: fallback), code: error.code)
}

/// Whether the SDK may store this card offline, or must take it online: the
/// store's limits enforced once more at the SDK (`offlineBehavior`), counting
/// what the SDK itself still holds unsent (`offlinePaymentAmountsByCurrency`).
public func offlineCardRequiresOnline(_ request: OfflineCardRequest, sdkStoredCents: Int) -> Bool {
  request.amountCents > request.maxSaleCents
    || max(request.takenTodayCents, sdkStoredCents) + request.amountCents > request.maxDeviceDailyCents
}

/// An SDK error on a card taken offline, as the cashier reads it: never the SDK's own words for an offline limit.
public func offlineCardErrorMessage(_ error: TerminalError, fallback: String) -> String {
  switch error.code.uppercased() {
  case "AMOUNT_EXCEEDS_MAX_OFFLINE_AMOUNT":
    return "This card is over Stripe's $10,000 limit for a card taken offline. Take it when you're back online, or take cash."
  case "NOT_CONNECTED_TO_INTERNET_AND_OFFLINE_BEHAVIOR_REQUIRE_ONLINE", "NOT_CONNECTED_TO_INTERNET_AND_REQUIRE_ONLINE_SET":
    return "This sale is over your offline card limit. Take it when you're back online, or take cash."
  case "ONLINE_PIN_NOT_SUPPORTED_OFFLINE":
    return "This card needs its PIN checked online. Take another card or cash, or take it when you're back online."
  case "INTERAC_NOT_SUPPORTED_OFFLINE": return "Interac cards can't be taken offline. Take another card or cash."
  case "OFFLINE_AND_CARD_EXPIRED": return "This card has expired. Take another card or cash."
  case "OFFLINE_TRANSACTION_DECLINED": return "The card was declined. Take another card or cash."
  case "OFFLINE_PAYMENTS_DATABASE_TOO_LARGE":
    return "This device holds too many cards taken offline. Reconnect to send them, or take cash."
  case "TAP_TO_PAY_READER_OFFLINE_MODE_NOT_ALLOWED":
    return "Tap to Pay cannot take cards offline. Connect a Bluetooth card reader, or take cash."
  default: return collectErrorMessage(error, fallback: fallback)
  }
}

/// What a forward the SDK reported means for the sale: authorized when Stripe
/// holds an authorization to capture, failed when Stripe never made the
/// payment at all (no id), and declined for anything else Stripe answered.
public func offlineForwardStatus(intentID: String?, status: String?) -> OfflineCardForward.Status {
  guard let intentID, !intentID.isEmpty else { return .failed }
  if let status, authorizedStatuses.contains(status) { return .authorized }
  return .declined
}

/// "Visa •••• 4242", "Card •••• 4242" or "Card".
public func offlineCardLabel(brand: String?, last4: String?) -> String {
  let name: String
  switch (brand ?? "").lowercased() {
  case "visa": name = "Visa"
  case "mastercard": name = "Mastercard"
  case "amex", "american_express": name = "American Express"
  case "discover": name = "Discover"
  case "jcb": name = "JCB"
  case "": name = "Card"
  default: name = (brand ?? "Card").prefix(1).uppercased() + (brand ?? "").dropFirst()
  }
  guard let last4, last4.count == 4 else { return name }
  return "\(name) •••• \(last4)"
}

/// The device's record of forwards the register has not applied yet.
public struct OfflineCardForwardLedger {
  private let defaults: UserDefaults
  private static let key = "aglyn.pos.offlineCard.forwards"

  public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

  public func all() -> [OfflineCardForward] {
    guard let data = defaults.data(forKey: Self.key) else { return [] }
    return (try? JSONDecoder().decode([OfflineCardForward].self, from: data)) ?? []
  }

  /// Keeps `forward`, replacing an earlier one for the same sale.
  public func record(_ forward: OfflineCardForward) {
    write(all().filter { $0.saleKey != forward.saleKey } + [forward])
  }

  public func remove(_ saleKeys: Set<String>) {
    guard !saleKeys.isEmpty else { return }
    write(all().filter { !saleKeys.contains($0.saleKey) })
  }

  private func write(_ list: [OfflineCardForward]) {
    if list.isEmpty {
      defaults.removeObject(forKey: Self.key)
    } else if let data = try? JSONEncoder().encode(list) {
      defaults.set(data, forKey: Self.key)
    }
  }
}

/// A reader that can take a card with no connection. Aglyn POS's Stripe
/// Terminal collector is one; `DeviceCardReaders.shared` is cast to it.
@MainActor
public protocol OfflineCardCollector: AnyObject {
  /// Why the connected reader cannot take a card offline right now, or nil when it can.
  var offlineCardUnavailableReason: String? { get }
  func collectOffline(_ request: OfflineCardRequest) async -> OfflineCardOutcome
  /// Told after a forward was written to the ledger, so a register on screen applies it now.
  var onOfflineForward: (() -> Void)? { get set }
  /// The register found the console reachable (true) or not (false). A test build may mirror it onto a simulated reader.
  func registerConnectivityChanged(online: Bool)
}

extension OfflineCardCollector {
  public func registerConnectivityChanged(online: Bool) {}
}
