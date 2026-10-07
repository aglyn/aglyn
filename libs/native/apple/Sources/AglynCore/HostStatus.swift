// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Whether a site is serving its pages, as the console's Sites list reports it.
public struct HostStatus: Equatable, Sendable {
  public enum Kind: Sendable { case live, draft, maintenance, suspended }

  public let kind: Kind
  /// `Live`, `Draft`, `Maintenance`, `Suspended`.
  public let label: String
  /// Why, in one sentence.
  public let detail: String
  public let publishedPages: Int

  /// The platform domain sites are served on, as the console's `TENANT_APEX` defaults it.
  public static let defaultTenantApex = "aglyn.app"

  public static func publishedScreenCount(_ host: [String: Any]?) -> Int {
    (host?["screens"] as? [String: Any])?.count ?? 0
  }

  /// The console's `describeHostStatus`. Order matters: a suspended site is
  /// not live whatever it has published, and a site in maintenance serves
  /// the maintenance page rather than its pages.
  public static func describe(_ host: [String: Any]?, now: Date = Date()) -> HostStatus {
    let published = publishedScreenCount(host)
    if let suspendedAt = millis(host?["suspendedAt"]), suspendedAt != 0 {
      let until = millis(host?["suspendedUntilMs"])
      if until == nil || until == 0 || until! > now.timeIntervalSince1970 * 1000 {
        return HostStatus(
          kind: .suspended, label: "Suspended", detail: "This site is serving a lockdown notice instead of content.",
          publishedPages: published)
      }
    }
    if host?["maintenance"] as? Bool == true {
      return HostStatus(
        kind: .maintenance, label: "Maintenance", detail: "Every path serves the maintenance page.",
        publishedPages: published)
    }
    if published > 0 {
      return HostStatus(
        kind: .live, label: "Live", detail: "\(published) published page\(published == 1 ? "" : "s").",
        publishedPages: published)
    }
    return HostStatus(
      kind: .draft, label: "Draft", detail: "Nothing published yet — visitors see the placeholder.", publishedPages: 0)
  }

  /// A site's own address on the platform domain, or nil without a subdomain.
  public static func siteAddress(_ subdomain: String?, apex: String = defaultTenantApex) -> String? {
    guard let subdomain, !subdomain.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
    return "\(subdomain).\(apex)"
  }

  private static func millis(_ value: Any?) -> Double? {
    switch value {
    case let date as Date: return date.timeIntervalSince1970 * 1000
    case let number as NSNumber: return number.doubleValue
    default: return nil
    }
  }
}

/// How long ago a moment was, in the short words an activity list uses:
/// `Just now`, `12 min ago`, `3 hr ago`, `Yesterday`, `4 days ago`,
/// `2 wk ago`, `5 mo ago`, `2 yr ago`. A time in the future reads `Just now`.
public func relativeTime(_ then: Date, now: Date = Date()) -> String {
  let minutes = Int((now.timeIntervalSince1970 - then.timeIntervalSince1970) / 60)
  let hours = minutes / 60
  let days = hours / 24
  switch true {
  case minutes < 1: return "Just now"
  case minutes < 60: return "\(minutes) min ago"
  case hours < 24: return "\(hours) hr ago"
  case days < 2: return "Yesterday"
  case days < 7: return "\(days) days ago"
  case days < 30: return "\(days / 7) wk ago"
  case days < 365: return "\(days / 30) mo ago"
  default: return "\(days / 365) yr ago"
  }
}
