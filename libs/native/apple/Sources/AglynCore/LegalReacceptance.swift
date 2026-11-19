// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Where the account stands with the published Terms and Privacy Policy (`GET /api/auth/legal-acceptance`, AGL-2316).
public struct LegalStatus: Equatable, Sendable {
  public enum Reason: String, Sendable { case none, neverAccepted = "never-accepted", versionSuperseded = "version-superseded" }
  public let reacceptanceRequired: Bool
  public let reason: Reason
  /// When they last agreed; nil when unknown or never.
  public let latestAcceptedAt: Date?
  /// Which documents moved (`terms`, `privacy`); nil is UNKNOWN, and then nothing is claimed.
  public let changedDocumentKeys: [String]?

  public init(reacceptanceRequired: Bool, reason: Reason, latestAcceptedAt: Date?, changedDocumentKeys: [String]?) {
    self.reacceptanceRequired = reacceptanceRequired
    self.reason = reason
    self.latestAcceptedAt = latestAcceptedAt
    self.changedDocumentKeys = changedDocumentKeys
  }

  public init?(_ body: JSONValue) {
    guard let required = body["reacceptanceRequired"]?.boolValue else { return nil }
    reacceptanceRequired = required
    reason = body["reacceptanceReason"]?.stringValue.flatMap(Reason.init(rawValue:)) ?? .none
    let iso = body["latestAcceptedAt"]?.stringValue ?? ""
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    latestAcceptedAt = fractional.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    changedDocumentKeys = body["changedDocumentKeys"]?.arrayValue?.compactMap(\.stringValue)
  }
}

/// The re-acceptance banner's words (the console's `LegalReacceptanceBanner`): the sentence around the Terms of Service and
/// Privacy Policy links, and the line under it. Someone who agreed and whose documents moved is thanked first and never told
/// they have not agreed; an account with no record is told it is OUR gap.
public struct LegalReacceptanceCopy: Equatable, Sendable {
  /// Before the two links ("Thanks for agreeing to Aglyn’s ").
  public let lead: String
  /// After them (" on November 2, 2026. We’ve updated them since, …").
  public let tail: String
  public let caption: String

  /// The banner's words, or nil when nothing is asked.
  public static func make(_ status: LegalStatus, brand: String, locale: Locale = .current) -> LegalReacceptanceCopy? {
    guard status.reacceptanceRequired else { return nil }
    if status.reason == .versionSuperseded {
      let on = status.latestAcceptedAt.map { day($0, locale: locale) }
      let then = ". We’ve updated them since, so please take another look and confirm you’re happy to continue."
      let changed = status.changedDocumentKeys.flatMap { $0.isEmpty ? nil : joined($0) }
      return LegalReacceptanceCopy(
        lead: on != nil ? "Thanks for agreeing to \(brand)’s " : "You’ve already agreed to \(brand)’s ",
        tail: on.map { " on \($0)\(then)" } ?? then,
        caption: changed.map { "What changed: the \($0). Your earlier agreement stays on record — this adds to it." }
          ?? "Your earlier agreement stays on record — this adds to it.")
    }
    return LegalReacceptanceCopy(
      lead: "We don’t have a record of your acceptance of \(brand)’s ",
      tail: " on this account. Please take a look and confirm to continue.",
      caption:
        "This is usually because the account was created before we started keeping these records, or through single sign-on or an invite that never showed one.")
  }

  /// The DAY they agreed, in the reader's locale (`formatAcceptedOn`).
  static func day(_ date: Date, locale: Locale) -> String {
    let formatter = DateFormatter()
    formatter.locale = locale
    formatter.dateStyle = .long
    formatter.timeStyle = .none
    return formatter.string(from: date)
  }

  /// "the Terms of Service", "the Terms of Service and the Privacy Policy" (`joinDocumentLabels`).
  static func joined(_ keys: [String]) -> String {
    let labels = keys.map { ["terms": "Terms of Service", "privacy": "Privacy Policy"][$0] ?? $0 }
    guard labels.count > 1 else { return labels.first ?? "" }
    return "\(labels.dropLast().joined(separator: ", ")) and the \(labels.last ?? "")"
  }
}

/// The context the app's re-acceptance is recorded under: its own door, as the console's is `reaccept-console` and the app's
/// Apple sign-up is `signup-apple`. The server stamps the version it publishes and its own clock.
public let legalReacceptanceContext = "reaccept-app"
