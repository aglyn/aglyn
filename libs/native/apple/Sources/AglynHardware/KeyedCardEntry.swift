// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * A CARD TYPED IN AT THE REGISTER.
 *
 * The console's "Type card" puts the card into Stripe's Payment Element; the
 * Apple register (iPhone, iPad and Mac) puts it into its own native card
 * fields (`CardFields`), which send it to Stripe alone and get back a
 * PaymentMethod id. The entry's job is to show those fields for one charge
 * and hand each PaymentMethod to the register, which asks its server to
 * confirm the payment with it; the server records the payment from its own
 * read of Stripe, never from the form's say-so. A decline keeps the fields
 * open with the bank's words, so the cashier can fix the card or try
 * another, as a card terminal does.
 *
 * So an entry never creates, prices or captures money. Every form ends in one
 * of three ways: paid (the server said so), canceled (closed without paying)
 * or lost (the answer did not arrive: check the sale before charging again).
 * Android keeps Stripe's own card form behind its Kotlin `KeyedCardEntry`.
 */

/// One charge's card form.
public struct KeyedCardRequest: Equatable, Sendable {
  /// The site's Stripe publishable key, which the card is sent to Stripe with.
  public let publishableKey: String
  /// What the register charges, tip included.
  public let amountCents: Int
  /// The amount as the form shows it (`$12.50`).
  public let amountText: String
  /// The business the charge is for.
  public let merchantName: String

  public init(publishableKey: String, amountCents: Int, amountText: String, merchantName: String) {
    self.publishableKey = publishableKey
    self.amountCents = amountCents
    self.amountText = amountText
    self.merchantName = merchantName
  }

  /// Nil when the form can open.
  public var problem: String? {
    if !publishableKey.hasPrefix("pk_") { return "Card entry is not set up for this site." }
    if amountCents <= 0 { return "There is nothing to charge." }
    return nil
  }
}

/// What the register's server said about one card.
public enum KeyedCardVerdict: Equatable, Sendable {
  /// The payment went through: the form closes.
  case paid
  /// Declined or refused, with words for the cashier: the form stays open.
  case declined(String)
  /// The answer was lost: the form closes and the cashier checks the sale.
  case lost(String)
}

public enum KeyedCardOutcome: Equatable, Sendable {
  case paid
  case canceled
  case lost(String)
}

/// The card fields, on this device. The commerce register binds them.
@MainActor
public protocol KeyedCardEntry: AnyObject {
  /// Shows the fields for one charge and returns when the form closes. Each
  /// Pay sends the card to Stripe, which answers with a PaymentMethod id, and
  /// passes that id to `submit`, whose verdict closes the form or keeps it open.
  func collect(
    _ request: KeyedCardRequest, submit: @escaping @MainActor (_ paymentMethodID: String) async -> KeyedCardVerdict
  ) async -> KeyedCardOutcome
  /// Closes an open form as canceled.
  func dismiss()
}
