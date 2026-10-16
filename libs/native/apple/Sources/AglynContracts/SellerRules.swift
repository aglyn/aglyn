// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * What the marketplace's seller panel says about money, ported once from libs/plugins/marketplace/src/lib/model
 * (seller-ledger-totals.ts, payout-readiness.ts). The cases in function-cases.generated.json are the TypeScript's own answers,
 * and SellerRulesTests replays every one. The Kotlin contracts' SellerRules.kt.
 */

/// JavaScript's truthiness for a plain value: not null, false, 0, NaN or empty text.
private func truthy(_ value: Any?) -> Bool {
  switch value {
  case nil, is NSNull: return false
  case let number as NSNumber:
    if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
    return !number.doubleValue.isNaN && number.doubleValue != 0
  case let text as String: return !text.isEmpty
  default: return true
  }
}

/// What the seller's sales add up to. Cents are numbers as the ledger holds them, so a stored string counts as the number it reads as.
public struct SellerLedgerTotals: Equatable, Sendable {
  /// Sales still standing.
  public let paidCount: Int
  /// Refunded or charged back.
  public let refundedCount: Int
  /// What Stripe was asked to move to the publisher's Connect account, net of any pull-back: not what reached their bank.
  public let sentToStripeCents: Double
  /// Tax-inclusive gross on the sales still standing.
  public let buyersPaidCents: Double
  /// Tax on those sales: the platform's remittance liability, never the seller's.
  public let salesTaxCents: Double
  /// Platform fee on those sales.
  public let platformFeeCents: Double
  /// Pulled back out of the publisher's account on the refunded ones.
  public let returnedCents: Double
}

private func field(_ sale: [String: Any], _ key: String) -> Double {
  guard let value = sale[key], !(value is NSNull) else { return 0 }
  return jsNumber(value)
}

private func transferOf(_ sale: [String: Any]) -> Double {
  if let value = sale["transferCents"], !(value is NSNull) { return jsNumber(value) }
  return field(sale, "amountCents") - field(sale, "feeCents")
}

/// `summarizeSellerLedger`: the totals over a seller's purchase records; a record that is not a number adds nothing.
public func summarizeSellerLedger(_ sales: [[String: Any]]?) -> SellerLedgerTotals {
  let all = sales ?? []
  let paid = all.filter { !truthy($0["refundedAt"]) }
  let refunded = all.filter { truthy($0["refundedAt"]) }
  func sum(_ rows: [[String: Any]], _ of: ([String: Any]) -> Double) -> Double {
    rows.reduce(0) { total, sale in
      let value = of(sale)
      return total + (value.isNaN || value == 0 ? 0 : value)
    }
  }
  return SellerLedgerTotals(
    paidCount: paid.count, refundedCount: refunded.count,
    sentToStripeCents: sum(paid) { transferOf($0) - field($0, "reversedTransferCents") - field($0, "partialReversedTransferCents") },
    buyersPaidCents: sum(paid) { field($0, "amountCents") }, salesTaxCents: sum(paid) { field($0, "taxCents") },
    platformFeeCents: sum(paid) { field($0, "feeCents") },
    returnedCents: sum(refunded) { field($0, "reversedTransferCents") + field($0, "partialReversedTransferCents") })
}

/// Where a publisher's payouts stand, as the Payouts card words it (`PayoutReadiness`).
public enum PayoutReadiness: String, Sendable {
  /// Still reading the profile: say nothing about payouts.
  case pending
  /// The read failed: say nothing about payouts, this is not "off".
  case error
  /// No Stripe account can take charges yet: the call to action.
  case disconnected
  /// Charges on, payout readiness never recorded: not a problem report.
  case unknown
  /// Charges on, payouts explicitly not enabled: the stranded-funds state.
  case blocked
  /// Charges on, but which Stripe mode the account belongs to was never recorded, so no checkout will charge against it.
  case unverified
  /// Charges on and payouts on: the only state that may claim success.
  case ready
}

/// `payoutReadiness`: `state` is the profile load (`pending`, `error` or `loaded`); the rest are the profile's Stripe fields as stored.
public func payoutReadiness(state: String, chargesEnabled: Any?, payoutsEnabled: Any?, accountLivemode: Any?) -> PayoutReadiness {
  if state != "loaded" { return state == "error" ? .error : .pending }
  func boolean(_ value: Any?) -> Bool? {
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
    return number.boolValue
  }
  if boolean(chargesEnabled) != true { return .disconnected }
  // Only a literal boolean counts as recorded, the same three-valued reading the server gate uses.
  if boolean(accountLivemode) == nil { return .unverified }
  if boolean(payoutsEnabled) == true { return .ready }
  if boolean(payoutsEnabled) == false { return .blocked }
  return .unknown
}

private let handlePattern = try! NSRegularExpression(pattern: "^[a-z0-9][a-z0-9-]{2,29}$")

/// A publisher handle: three to thirty lowercase letters, digits and hyphens, starting with a letter or digit.
public func isPublisherHandle(_ handle: String) -> Bool {
  handlePattern.firstMatch(in: handle, range: NSRange(handle.startIndex..., in: handle)) != nil
}
