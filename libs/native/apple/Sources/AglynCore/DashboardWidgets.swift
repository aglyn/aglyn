// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Observation
import Foundation

/// Which cards a person keeps on a site's Home and in what order, per workspace: the console's Customize dashboard
/// (`users/{uid}.dashboardWidgets.{orgId}` = `{hidden, order}`). A preference, never a limit: it only removes cards the
/// plugins already put there and reorders what remains, and an id naming no card is matched against nothing.
public struct DashboardWidgetPrefs: Equatable, Sendable {
  public var hidden: [String]
  public var order: [String]

  public init(hidden: [String] = [], order: [String] = []) {
    self.hidden = hidden
    self.order = order
  }

  public static let empty = DashboardWidgetPrefs()

  /// What a save writes under the workspace's key: both lists, always (a merge keeps an omitted key's stored value).
  public var stored: [String: Any] { ["hidden": hidden, "order": order] }
}

/// The ports of the console's dashboard-widget rules (`libs/aglyn/src/lib/app-utils/dashboard-widget-prefs.ts`),
/// replayed from function-cases.generated.json. The Kotlin core's DashboardWidgets.kt.
public enum DashboardWidgets {
  /// The `users/{uid}` field that keeps every workspace's arrangement.
  public static var field: String { ContractValues.shared.dashboardWidgetsField }
  /// The Traffic card's id, which the console renders itself.
  public static var trafficID: String { ContractValues.shared.hostAnalyticsWidgetId }

  /**
   * The console's id for each native Home card that is one of its dashboard cards, so a card hidden or moved on the
   * web is hidden or moved here and the other way round. A card the console does not draw keeps its own id, which the
   * console matches against nothing.
   */
  public static let consoleIDs: [String: String] = [
    "commerce.glance": "commerce-glance",
    "commerce.newest-site-users": "accounts-newest-site-users",
    "inbox.glance": "inbox-glance",
    "crm.glance": "crm-glance",
    "crm.tasks-due": "crm-tasks-due",
    "ai.insight-ask": "ai-insight-ask",
  ]

  /// The Recent activity card: the console's `hostActivity` slot card.
  public static let activityID = "workflows-host-activity"

  /// The id a native Home card is stored under.
  public static func storedID(_ nativeID: String) -> String { consoleIDs[nativeID] ?? nativeID }

  /// `readDashboardWidgetPrefs`: the workspace's arrangement from the stored field, or none.
  public static func read(_ stored: Any?, orgID: String?) -> DashboardWidgetPrefs {
    guard let orgID, !orgID.isEmpty, let all = stored as? [String: Any], let entry = all[orgID] as? [String: Any] else {
      return .empty
    }
    return DashboardWidgetPrefs(hidden: idList(entry["hidden"]), order: idList(entry["order"]))
  }

  /// `isDashboardWidgetHidden`.
  public static func isHidden(_ prefs: DashboardWidgetPrefs, _ widgetID: String) -> Bool {
    prefs.hidden.contains(widgetID)
  }

  /// `orderDashboardWidgets`: the ranked ids first in their rank, the rest after in the order they came.
  public static func ordered<T>(_ widgets: [T], order: [String], id: (T) -> String) -> [T] {
    var rank: [String: Int] = [:]
    for (index, widgetID) in order.enumerated() { rank[widgetID] = index }
    return widgets.enumerated()
      .map { (widget: $0.element, index: $0.offset, rank: rank[id($0.element)] ?? Int.max) }
      .sorted { $0.rank != $1.rank ? $0.rank < $1.rank : $0.index < $1.index }
      .map(\.widget)
  }

  /// `setDashboardWidgetHidden`: a hidden id goes to the end of the list, a shown one leaves it.
  public static func setHidden(_ prefs: DashboardWidgetPrefs, _ widgetID: String, hidden: Bool) -> DashboardWidgetPrefs {
    let without = prefs.hidden.filter { $0 != widgetID }
    return DashboardWidgetPrefs(hidden: hidden ? without + [widgetID] : without, order: prefs.order)
  }

  /// `moveDashboardWidget`: moves `widgetID` by `delta` within its group, whose ranks are rewritten after every other.
  public static func move(
    _ prefs: DashboardWidgetPrefs, groupIDs: [String], _ widgetID: String, delta: Int
  ) -> DashboardWidgetPrefs {
    guard let from = groupIDs.firstIndex(of: widgetID) else { return prefs }
    let to = from + delta
    guard to >= 0, to < groupIDs.count else { return prefs }
    var moved = groupIDs
    moved.remove(at: from)
    moved.insert(widgetID, at: to)
    let group = Set(groupIDs)
    return DashboardWidgetPrefs(hidden: prefs.hidden, order: prefs.order.filter { !group.contains($0) } + moved)
  }

  private static func idList(_ value: Any?) -> [String] {
    (value as? [Any])?.compactMap { $0 as? String } ?? []
  }
}

/// A person's arrangement of a site's Home for the workspace, live from `users/{uid}`, and the switches that change it:
/// the console's `DashboardWidgetPrefsProvider`. Each change shows at once and is written as a merge of both lists under
/// the workspace's key, so the other workspaces' arrangements are never read or rewritten; a failed write leaves the
/// arrangement showing until the next answer (nothing here decides access).
@MainActor
@Observable
public final class DashboardPrefsStore {
  public private(set) var prefs = DashboardWidgetPrefs.empty
  /// The stored arrangement has arrived, or there is nobody to hold one.
  public private(set) var ready = false
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var uid: String?
  @ObservationIgnored private var orgID: String?

  public init() {}

  public func start(reader: FirestoreReader?, uid: String?, orgID: String?) {
    listener?.remove()
    listener = nil
    prefs = .empty
    self.reader = reader
    self.uid = uid
    self.orgID = orgID
    guard let reader, let uid, let orgID else {
      ready = uid == nil
      return
    }
    ready = false
    listener = reader.listenDocument(["users", uid]) { [weak self] result in
      guard let self else { return }
      if case .success(let doc) = result {
        self.prefs = DashboardWidgets.read(doc?.data[DashboardWidgets.field], orgID: orgID)
      }
      // An unreadable preference is the ordinary Home, never an error on it.
      self.ready = true
    }
  }

  public func isHidden(_ widgetID: String) -> Bool { DashboardWidgets.isHidden(prefs, widgetID) }

  public func setHidden(_ widgetID: String, hidden: Bool) {
    persist(DashboardWidgets.setHidden(prefs, widgetID, hidden: hidden))
  }

  public func move(groupIDs: [String], _ widgetID: String, delta: Int) {
    persist(DashboardWidgets.move(prefs, groupIDs: groupIDs, widgetID, delta: delta))
  }

  private func persist(_ next: DashboardWidgetPrefs) {
    prefs = next
    guard let reader, let uid, let orgID else { return }
    Task {
      try? await reader.setDocument(["users", uid], [DashboardWidgets.field: [orgID: next.stored]], merge: true)
    }
  }
}
