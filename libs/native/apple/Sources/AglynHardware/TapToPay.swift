// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * TAP TO PAY ON IPHONE, AS APPLE'S REVIEW ASKS FOR IT.
 *
 * Every rule here can be decided without the reader SDK, so it is tested in
 * this kit and the SDK binding (Aglyn POS's Stripe Terminal collector) only
 * reports what happened:
 *
 * - The checkout button is always there on an iPhone, at the top, named
 *   "Tap to Pay on iPhone" with Apple's symbol, and never greyed out. What a
 *   press does depends on the device's state (`tapToPayPress`): take the
 *   card, connect first, or say plainly why not.
 * - Tap to Pay on iPhone needs iOS 18 (Apple's merchant education is an
 *   iOS 18 API, so there are no screens of our own to keep in step).
 * - Apple's terms are accepted ONCE, for every store, by Aglyn: card-present
 *   charges are destination charges made on the platform account (no
 *   `on_behalf_of`), so Apple links the platform's merchant, not each
 *   store's. A store member never sees the terms; only Aglyn staff may
 *   accept them (`tapToPayTermsPermitted`). Should the link ever be missing,
 *   members read a neutral "contact support".
 *
 * Tap to Pay on Android has rules of its own; this file is the iPhone's.
 */

public enum TapToPayIPhone {
  /// Apple's name for it, in full (never shortened, never with "Apple").
  public static let title = "Tap to Pay on iPhone"
  /// Apple's symbol for the checkout button (`wave.3.right.circle` or its filled form).
  public static let symbol = "wave.3.right.circle.fill"
  /// The iOS version Tap to Pay on iPhone is offered on.
  public static let minimumOSMajor = 18
}

/// Why a press of the Tap to Pay on iPhone button cannot take the card yet, in the cashier's words.
public enum TapToPayNotice: Equatable, Sendable {
  /// iOS is older than Tap to Pay on iPhone needs.
  case needsUpdate
  /// The platform's link with Apple is missing; a store member cannot fix it.
  case notTurnedOn
  /// The iPhone is still being set up to take cards (`progress` 0...1 when the SDK says).
  case preparing(progress: Double?)
  /// Anything else, already worded.
  case failed(String)

  public var title: String {
    switch self {
    case .needsUpdate: "Update iOS to use Tap to Pay on iPhone"
    case .notTurnedOn: "Tap to Pay on iPhone isn’t turned on yet"
    case .preparing: "Getting Tap to Pay on iPhone ready"
    case .failed: "Tap to Pay on iPhone"
    }
  }

  public var message: String {
    switch self {
    case .needsUpdate:
      "Tap to Pay on iPhone needs iOS \(TapToPayIPhone.minimumOSMajor) or later. Update in Settings › General › Software Update, or take this payment another way."
    case .notTurnedOn: "Contact support to turn it on. Take this payment another way for now."
    case .preparing:
      "This iPhone is being set up to take cards. It takes a moment the first time. Keep the app open; it is ready as soon as the bar fills."
    case .failed(let words): words
    }
  }
}

/// What a press of the Tap to Pay on iPhone button does.
public enum TapToPayPress: Equatable, Sendable {
  /// The reader is ready: take the card now.
  case collect
  /// Not connected yet: connect (the button then shows it getting ready), then take the card.
  case connect
  /// Say why not, and leave the other tenders to the cashier.
  case explain(TapToPayNotice)
}

/// The press, from the device's state. `osMajor` is the running iOS major version;
/// `progress` is the reader's setup progress while it installs its configuration.
public func tapToPayPress(
  osMajor: Int, state: CardCollectorState, progress: Double?, notice: TapToPayNotice?
) -> TapToPayPress {
  if osMajor < TapToPayIPhone.minimumOSMajor { return .explain(.needsUpdate) }
  if let progress { return .explain(.preparing(progress: progress)) }
  switch state {
  case .connected(_, .tapToPay, _): return .collect
  case .connecting: return .explain(.preparing(progress: nil))
  default: break
  }
  // Only what a retry cannot fix is said again; anything else connects again.
  if let notice, notice == .needsUpdate || notice == .notTurnedOn { return .explain(notice) }
  return .connect
}

/// Whether this person may accept Apple's Tap to Pay on iPhone terms. Aglyn
/// accepts them once for every store, so only Aglyn staff may; a store member
/// is never shown them.
public func tapToPayTermsPermitted(isStaff: Bool) -> Bool { isStaff }

/// The notice for an SDK error code met while connecting Tap to Pay on iPhone, or nil for one that is not its own.
public func tapToPayNotice(code: String) -> TapToPayNotice? {
  switch code.uppercased() {
  case "TAP_TO_PAY_UNSUPPORTED_OS_VERSION": .needsUpdate
  case "TAP_TO_PAY_READER_TOS_NOT_YET_ACCEPTED", "TAP_TO_PAY_READER_MERCHANT_BLOCKED",
    "TAP_TO_PAY_READER_INVALID_MERCHANT", "TAP_TO_PAY_READER_ACCOUNT_DEACTIVATED":
    .notTurnedOn
  case "TAP_TO_PAY_READER_TOS_ACCEPTANCE_CANCELED":
    .failed("Apple’s terms were not accepted, so Tap to Pay on iPhone is still off.")
  case "TAP_TO_PAY_READER_TOS_ACCEPTANCE_REQUIRES_ICLOUD_SIGN_IN":
    .failed("Sign in to iCloud in Settings to accept Apple’s terms for Tap to Pay on iPhone.")
  case "TAP_TO_PAY_READER_TOS_ACCEPTANCE_FAILED":
    .failed("Apple’s terms could not be accepted with this Apple Account. Try again.")
  case "TAP_TO_PAY_READER_FAILED_TO_PREPARE", "TAP_TO_PAY_READER_REQUEST_INTERRUPTED":
    .failed("Tap to Pay on iPhone could not get ready. Keep the app open and try again.")
  case "PASSCODE_NOT_ENABLED": .failed("Set a passcode on this iPhone to use Tap to Pay on iPhone.")
  case "NFC_DISABLED": .failed("Turn on NFC for this iPhone to use Tap to Pay on iPhone.")
  case "TAP_TO_PAY_READER_DEVICE_BANNED", "TAP_TO_PAY_DEVICE_TAMPERED":
    .failed("This iPhone failed a security check and cannot take Tap to Pay on iPhone.")
  case "UNSUPPORTED_MOBILE_DEVICE_CONFIGURATION", "TAP_TO_PAY_UNSUPPORTED_DEVICE":
    .failed("This iPhone cannot take Tap to Pay on iPhone. It needs an iPhone XS or later on the latest iOS.")
  default: nil
  }
}

/// A local notification for a card that was not approved while the app was
/// not on screen (Apple 5.12), or a card taken offline that the bank declined
/// once it was sent.
public struct CardNotApprovedNotification: Equatable, Sendable {
  public let title: String
  public let body: String

  public init(amount: String, place: String?) {
    title = "Card not approved"
    let at = place.map { " at \($0)" } ?? ""
    body = "\(amount)\(at) was not charged. Open the sale to take the payment another way."
  }
}
