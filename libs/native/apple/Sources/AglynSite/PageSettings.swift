// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import CryptoKit
import Foundation

// A page's own publishing and access settings, as the console's page view reads and writes them
// (`screens/[screenId]/versions/[versionId]/view`): the scheduled publish or unpublish (`publishSchedule`, AGL-113,
// the plan's `scheduledPublishing`), who may see the page (`visibility` + `protection.passwordHash`, AGL-113), and
// whether only the site's team sees it once it is live (`host.previewScreens`, AGL-4086). The Kotlin kit's
// PageSettings.kt.

/// The plan feature that carries scheduled publishing.
public let scheduledPublishingFeature = "scheduledPublishing"

/// Who may see a page: the console's `HostScreenVisibility` values its Page Access card offers, in its order, with its
/// words. Every choice but Public keeps the page out of search results and the sitemap (AGL-1263).
public enum PageVisibility: Int, CaseIterable, Identifiable, Sendable {
  case everyone = 2
  case unlisted = 6
  case password = 24
  case members = 40

  public var id: Int { rawValue }

  public var label: String {
    switch self {
    case .everyone: "Public"
    case .unlisted: "Unlisted"
    case .password: "Password protected"
    case .members: "Members only"
    }
  }

  public var hint: String {
    switch self {
    case .everyone: "Anyone with the link; listed in navigation and offered to search engines."
    case .unlisted: "Reachable by URL only — kept out of search results and the sitemap."
    case .password: "Visitors must enter the page password; kept out of search results."
    case .members: "Requires site membership (enforced once site sign-in ships); kept out of search results."
    }
  }
}

/// A page's one schedule, as `publishSchedule` stores it.
public struct PageSchedule: Equatable, Sendable {
  /// `publish` or `unpublish`.
  public let action: String
  public let versionID: String?
  public let publishAt: Date?
  /// `pending`; `skipped-unentitled` when it came due on a plan without scheduling (AGL-1185); `skipped-unroutable`
  /// when the page had no address it could go live at (AGL-1589).
  public let status: String

  public var isUnpublish: Bool { action == "unpublish" }

  init?(_ value: Any?) {
    guard let map = value as? [String: Any], let action = map["action"] as? String else { return nil }
    self.action = action
    versionID = map["versionId"] as? String
    publishAt = map["publishAt"] as? Date
    status = map["status"] as? String ?? ""
  }
}

/// What the page's Publishing and Page Access cards read from the screen document.
public struct PageSettings: Equatable, Sendable {
  /// The stored value; the console reads a page with none as Public.
  public let visibilityValue: Int
  public let hasPassword: Bool
  public let schedule: PageSchedule?

  public init(_ doc: FirestoreDocument?) {
    visibilityValue = doc?.int("visibility") ?? PageVisibility.everyone.rawValue
    hasPassword = ((doc?.data["protection"] as? [String: Any])?["passwordHash"] as? String).map { !$0.isEmpty } ?? false
    schedule = PageSchedule(doc?.data["publishSchedule"])
  }

  /// The choice the select shows; nil for a stored value the card does not offer.
  public var visibility: PageVisibility? { PageVisibility(rawValue: visibilityValue) }

  /// The schedule still waiting to run.
  public var pending: PageSchedule? { schedule?.status == "pending" ? schedule : nil }

  /// A schedule that came due and did not run, with the console's chip words; dismissing it clears the field.
  public var skippedLabel: String? {
    guard let schedule else { return nil }
    switch schedule.status {
    case "skipped-unentitled":
      return "Did not \(schedule.isUnpublish ? "unpublish" : "publish") — plan does not include scheduling"
    case "skipped-unroutable": return "Did not publish — no available address"
    default: return nil
    }
  }

  /// The console's explanation beside a skipped schedule.
  public var skippedHelp: String? {
    switch schedule?.status {
    case "skipped-unentitled":
      return "Scheduled publishing is a \(PlanFeatureDefaults.grantedFrom[scheduledPublishingFeature] ?? "Pro") feature. "
        + "This schedule came due on a plan without it, so it was not applied — and it will not run later if you "
        + "upgrade. Schedule it again to publish."
    case "skipped-unroutable":
      return "The scheduled publish ran, but this page has no address it could be published at — its slug (or a "
        + "parent page's) is missing, or another page is already published at that path. Set the slug below, publish "
        + "or fix the parent, then schedule it again."
    default: return nil
    }
  }
}

/// The pending schedule's chip: "Publishes Nov 20, 2026 at 9:00 AM".
public func pageScheduleLabel(_ schedule: PageSchedule, format: (Date) -> String = { $0.formatted(date: .abbreviated, time: .shortened) }) -> String {
  "\(schedule.isUnpublish ? "Unpublishes" : "Publishes") \(schedule.publishAt.map(format) ?? "")"
}

/// Whether one page of the site is in preview (`host.previewScreens[id] == true`), as `isScreenInPreview`.
public func isPageInPreview(_ host: [String: Any]?, pageID: String) -> Bool {
  (host?["previewScreens"] as? [String: Any])?[pageID] as? Bool == true
}

/// Whether the whole site is in preview, as `isHostInPreview`: only an explicit `true` is.
public func isSiteInPreview(_ host: [String: Any]?) -> Bool { host?["preview"] as? Bool == true }

/// The Page Access card's line under its Preview switch.
public func pagePreviewCaption(siteInPreview: Bool, pageInPreview: Bool) -> String {
  if siteInPreview {
    return "The whole site is in preview, so visitors see none of it yet. Make it public in Admin → Error pages."
  }
  return pageInPreview
    ? "Visitors get your 404 page here until you switch this off."
    : "Switch it on to keep this page to your team after you publish it."
}

/// The page password as the console stores it: SHA-256 of the typed text, lowercase hex.
public func pagePasswordHash(_ password: String) -> String {
  SHA256.hash(data: Data(password.utf8)).map { String(format: "%02x", $0) }.joined()
}

/// The schedule dialog's first time, as the console's: the next whole hour.
public func defaultScheduleTime(now: Date = Date(), calendar: Calendar = .current) -> Date {
  let next = now.addingTimeInterval(3600)
  return calendar.date(from: calendar.dateComponents([.year, .month, .day, .hour], from: next)) ?? next
}

/// A page's settings writes, the console page view's own: the screen document updated in place, then the live page's
/// cached copy dropped (`announceLiveScreenChange`) when the page has an address; the preview switch on the host
/// beside the routing map, announced to the whole site as `updateHostDocument` does.
public struct PageSettingsAPI: Sendable {
  let api: ConsoleAPIClient
  let writer: FirestoreWriter
  let reader: FirestoreReader
  let hostID: String

  public init(api: ConsoleAPIClient, writer: FirestoreWriter, reader: FirestoreReader, hostID: String) {
    self.api = api
    self.writer = writer
    self.reader = reader
    self.hostID = hostID
  }

  private func path(_ id: String) -> [String] { ["hosts", hostID, "screens", id] }

  /// Drops the live page's cache so visitors get the change now; never fails the save before it.
  func announce(_ id: String, livePath: String?) async {
    guard livePath != nil else { return }
    _ = try? await api.request("/api/screens/revalidate", method: .post, body: jsonBody(["hostId": hostID, "screenId": id]))
  }

  /// Who may see the page. Leaving password mode drops the stored hash, so protection does not silently linger.
  public func setVisibility(_ id: String, _ visibility: PageVisibility, hadPassword: Bool, livePath: String?) async throws {
    var fields: [String: Any] = ["visibility": visibility.rawValue]
    if visibility != .password && hadPassword { fields["protection"] = FirestoreSentinel.delete }
    try await writer.update(path(id), fields)
    await announce(id, livePath: livePath)
  }

  /// Saves the page password (its hash), or removes protection when it is blank.
  public func setPassword(_ id: String, _ password: String, livePath: String?) async throws {
    let value = password.trimmingCharacters(in: .whitespacesAndNewlines)
    let fields: [String: Any] =
      value.isEmpty ? ["protection": FirestoreSentinel.delete] : ["protection": ["passwordHash": pagePasswordHash(value)]]
    try await writer.update(path(id), fields)
    await announce(id, livePath: livePath)
  }

  /// The page's one pending schedule: publish `versionID`, or unpublish, at `at`.
  public func schedule(_ id: String, unpublish: Bool, versionID: String?, at: Date) async throws {
    var schedule: [String: Any] = [
      "action": unpublish ? "unpublish" : "publish", "publishAt": at, "status": "pending", "createdAt": Date(),
    ]
    if !unpublish, let versionID { schedule["versionId"] = versionID }
    try await writer.update(path(id), ["publishSchedule": schedule])
  }

  /// Cancels the schedule, or dismisses one that came due and did not run.
  public func cancelSchedule(_ id: String) async throws {
    try await writer.update(path(id), ["publishSchedule": FirestoreSentinel.delete])
  }

  /// One page in preview: once published, only the site's team sees it.
  public func setPreview(_ id: String, _ enabled: Bool) async throws {
    let entry: Any = enabled ? true : FirestoreSentinel.delete
    try await writer.merge(["hosts", hostID], ["previewScreens": [id: entry] as [String: Any]])
    await publishSiteWideChange(api: api, reader: reader, hostID: hostID)
  }
}
