// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The platform lockdown's notice (`/api/lockdown-status`, the console's `PlatformLockdownGate`): what a signed-in person
/// who is not staff sees in place of the app while the platform is locked. An answer that is not `locked`, or no answer
/// at all, is open: the server gates decide.
public struct PlatformLockdownNotice: Equatable, Sendable {
  public let title: String
  public let message: String
  /// "Expected back by …", in the reader's locale and zone, when the lock has an end.
  public let until: String?
  /// The address questions go to, when the lock names one.
  public let contact: String?

  public init?(_ answer: JSONValue?, brand: String, locale: Locale = .current, timeZone: TimeZone = .current) {
    guard let answer, answer["locked"] == .bool(true) else { return nil }
    func text(_ key: String) -> String? {
      guard let value = answer[key]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
        return nil
      }
      return value
    }
    title = text("title") ?? "Temporarily unavailable"
    message = text("message") ?? "\(brand) is temporarily unavailable. Please check back shortly."
    contact = text("contact")
    until = answer["untilMs"]?.numberValue.flatMap { ms -> String? in
      guard ms.isFinite, ms > 0 else { return nil }
      let formatter = DateFormatter()
      formatter.locale = locale
      formatter.timeZone = timeZone
      formatter.dateStyle = .short
      formatter.timeStyle = .medium
      return "Expected back by \(formatter.string(from: Date(timeIntervalSince1970: ms / 1000)))."
    }
  }

  /// Reads the lock; a failed read is open, as the console's gate fails open.
  public static func read(_ api: ConsoleAPIClient, brand: String) async -> PlatformLockdownNotice? {
    let answer: JSONValue? = (try? await api.request("/api/lockdown-status", anonymous: true)) ?? nil
    return PlatformLockdownNotice(answer, brand: brand)
  }
}
