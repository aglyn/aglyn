// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * Visit site as the team (the console's `SiteVisitButton`, AGL-4086). While a site is in preview or in maintenance its
 * visitors see the 503 page, so Visit site enters it through a two-minute link the console mints for a member of the
 * site's team (`/api/site-preview/link`); anywhere the link cannot be had it opens the ordinary address, where the public
 * answer is what anyone gets. The Kotlin core's SiteVisit.kt.
 */
public enum SiteVisit {
  /// Whether Visit site enters this site as the team: it is in preview (`preview: true`) or in maintenance.
  public static func entersAsTeam(_ host: [String: Any]?) -> Bool {
    if host?["preview"] as? Bool == true { return true }
    switch host?["maintenance"] {
    case nil, is NSNull: return false
    case let flag as Bool: return flag
    case let text as String: return !text.isEmpty
    case let number as NSNumber: return number.doubleValue != 0
    default: return true
    }
  }

  /// The link that enters the site as the team at `path`, or nil when the console would not mint one.
  public static func teamLink(api: ConsoleAPIClient, hostID: String, path: String = "/") async -> URL? {
    let answer = try? await api.request("/api/site-preview/link", method: .post, body: jsonBody(["hostId": hostID, "path": path]))
    return answer?["url"]?.stringValue.flatMap(URL.init(string:))
  }

  /// Where Visit site goes: the team link while the site is in preview or maintenance (`entersAsTeam`), else (or when no
  /// link comes) `address`.
  public static func url(entersAsTeam: Bool, hostID: String, address: URL, api: ConsoleAPIClient?) async -> URL {
    guard entersAsTeam, let api else { return address }
    return await teamLink(api: api, hostID: hostID) ?? address
  }
}
