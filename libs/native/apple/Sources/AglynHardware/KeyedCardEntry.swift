// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * A CARD TYPED IN AT THE REGISTER.
 *
 * The console's "Type card" puts the card into Stripe's own Payment Element:
 * the number never touches the register, the server made the PaymentIntent and
 * records the payment from Stripe, never from the form's say-so. This is the
 * same split on the device. The server has already made a `card_keyed`
 * PaymentIntent (`card-keyed`); an entry's only job is to show Stripe's own
 * card form for that intent and report how it ended. The Stripe card SDK that
 * draws the form lives in the Aglyn POS app alone and implements
 * `KeyedCardEntry`; this kit, the commerce plugin and the Aglyn app never
 * link it, which keeps the card number out of every other part of the code
 * and out of this project's PCI scope.
 *
 * So an entry never creates, prices or captures money, and what it reports is
 * a hint the server re-reads. Every outcome is one of three: confirmed (Stripe
 * took the card; the server decides what that means), canceled (nobody was
 * charged; the amount is released) or failed (with words to read out). The
 * Android kit's `KeyedCardEntry` is the same contract.
 */

public struct KeyedCardRequest: Equatable, Sendable {
  public let paymentIntentID: String
  public let clientSecret: String
  /// The site's Stripe publishable key, which the register's context supplies (the console loads Stripe with the same one).
  public let publishableKey: String
  /// What the register shows the customer, tip included.
  public let amountCents: Int
  /// The business name the card form carries.
  public let merchantName: String

  public init(
    paymentIntentID: String, clientSecret: String, publishableKey: String, amountCents: Int, merchantName: String
  ) {
    self.paymentIntentID = paymentIntentID
    self.clientSecret = clientSecret
    self.publishableKey = publishableKey
    self.amountCents = amountCents
    self.merchantName = merchantName
  }

  /// Nil when the request is well formed. The client secret names its own
  /// intent, and one for a different intent is refused, so nothing can ask to
  /// take A while the register records B.
  public var problem: String? {
    if !publishableKey.hasPrefix("pk_") { return "Card entry is not set up for this site." }
    if amountCents <= 0 { return "There is nothing to charge." }
    return CardCollectRequest(paymentIntentID: paymentIntentID, clientSecret: clientSecret, amountCents: amountCents)
      .problem
  }
}

public enum KeyedCardOutcome: Equatable, Sendable {
  case confirmed(paymentIntentID: String)
  case canceled(paymentIntentID: String)
  case failed(paymentIntentID: String, message: String)

  public var paymentIntentID: String {
    switch self {
    case .confirmed(let id), .canceled(let id), .failed(let id, _): id
    }
  }
}

/// Stripe's own card form, on this device. Implementations are bound by the
/// Aglyn POS app.
@MainActor
public protocol KeyedCardEntry: AnyObject {
  /// Shows the form for one server-made intent and returns when it closes.
  /// Validates `request` first.
  func collect(_ request: KeyedCardRequest) async -> KeyedCardOutcome
}

/// This device's card form, as the Aglyn POS app publishes it (the app that
/// carries Stripe's card SDK), so the commerce plugin can offer "Type card"
/// without naming the SDK. Nil where the device has none: the Mac register
/// and the Aglyn app.
@MainActor
public enum DeviceKeyedCardEntry {
  public static var shared: KeyedCardEntry?
}
