// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

// One content entry's traffic (the console's `EntryAnalyticsCard`, AGL-2498): the entry's public path counted in the
// site's day documents (`hosts/{id}/analytics/{day}.paths`), never the template screen's numbers, which are the whole
// collection's. Devices and referrers are counted for the site, not per path, so the card shows neither. The Kotlin
// kit's EntryTraffic.kt.

/// The key a path is counted under in a day document's `paths` (`analyticsPathKey`): `.`, `$`, `#`, `[` and `]`
/// folded to `_`, capped at 200 characters, an empty path counted as `/`.
public func analyticsPathKey(_ path: String) -> String {
  String((path.isEmpty ? "/" : path).prefix(200)).replacingOccurrences(of: "[.$#\\[\\]]", with: "_", options: .regularExpression)
}

/// The card's figures over the days given (oldest first).
public struct EntryTrafficSummary: Equatable {
  public let counts: [(day: String, total: Double)]
  public let total: Double
  /// The busiest day, the first of equals as the console's reduce keeps it; nil when nothing was counted.
  public let best: (day: String, total: Double)?

  public init(days: [TrafficDay], path: String) {
    let key = analyticsPathKey(path)
    counts = days.map { ($0.day, $0.paths[key] ?? 0) }
    total = counts.reduce(0) { $0 + $1.total }
    var top: (day: String, total: Double)?
    for entry in counts where top == nil || entry.total > top!.total { top = entry }
    best = (top?.total ?? 0) > 0 ? top : nil
  }

  public static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.total == rhs.total && lhs.counts.map(\.day) == rhs.counts.map(\.day)
      && lhs.counts.map(\.total) == rhs.counts.map(\.total) && lhs.best?.day == rhs.best?.day
  }
}

/// "Entry traffic (14 days)": page views, the best day, the path it is counted against, a bar per day.
public struct EntryTrafficCard: View {
  static let days = 14
  let reader: FirestoreReader
  let api: ConsoleAPIClient?
  let hostID: String
  /// The entry's public path (`/blog/hello`); nil while it has no address.
  let path: String?
  let upgrade: () -> Void
  @State private var plan = SiteAnalyticsModel()
  @State private var docs = LiveQuery()

  public init(reader: FirestoreReader, api: ConsoleAPIClient?, hostID: String, path: String?, upgrade: @escaping () -> Void) {
    self.reader = reader
    self.api = api
    self.hostID = hostID
    self.path = path
    self.upgrade = upgrade
  }

  public var body: some View {
    AglynStatsSection(plan.entitled == true ? "Entry traffic (14 days)" : "Entry traffic") {
      EmptyView()
    } content: {
      content
    }
    .task(id: hostID) { plan.checkEntitlement(api: api, hostID: hostID) }
    .task(id: "\(hostID):\(plan.entitled == true)") {
      guard plan.entitled == true else { return }
      let first = recentDayIDs(now: .now, days: Self.days).last ?? ""
      await docs.bind(
        reader,
        FirestoreQuery(
          ["hosts", hostID, "analytics"], filters: [ListQueryConstraint(path: "__name__", op: .greaterThanOrEqual, value: first)],
          order: [.init("__name__")], limit: Self.days))
    }
    .accessibilityIdentifier("entry-traffic")
  }

  @ViewBuilder
  private var content: some View {
    switch plan.entitled {
    case nil:
      if plan.entitlementFailed {
        AglynNotice("Your plan could not be checked. Check the connection and pull to refresh.", tone: .error)
      } else {
        Text("Checking your plan…").font(AglynFont.subheadline).foregroundStyle(.secondary)
      }
    case false?:
      AglynUpgradeNotice(
        "Per-page traffic — how many people read this entry, day by day — is a Pro feature. Data is already being "
          + "collected, so history is waiting the moment you upgrade.",
        action: planUpgradeAction(upgrade))
    case true?:
      if let path {
        switch docs.state {
        case .loading: SkeletonRows(count: 2)
        case .failed: AglynNotice("Traffic could not be loaded. Check the connection and try again.", tone: .error)
        case .ready(let found):
          let byID = Dictionary(found.map { ($0.id, $0.data) }, uniquingKeysWith: { a, _ in a })
          let days = recentDayIDs(now: .now, days: Self.days).reversed().map { TrafficDay(day: $0, data: byID[$0]) }
          figures(EntryTrafficSummary(days: days, path: path), path: path)
        }
      } else {
        Text(
          "This entry has no public address yet — save it to give it one, and views will be counted from the moment it "
            + "is published."
        )
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
      }
    }
  }

  @ViewBuilder
  private func figures(_ summary: EntryTrafficSummary, path: String) -> some View {
    AglynCardGrid(minimum: SiteAnalyticsMetrics.pageTileMinimum, maxColumns: 3, spacing: AglynSpace.three) {
      AglynStatTile(analyticsCount(summary.total), label: "Page views")
      AglynStatTile(
        summary.best.map { analyticsCount($0.total) } ?? "—", label: summary.best.map { "Best day · \($0.day)" } ?? "Best day")
      AglynStatTile(path, label: "Counted against this path")
    }
    if summary.total == 0 {
      Text(
        "No page views recorded for this entry yet. Only the published address is counted — a draft is not reachable, "
          + "so it cannot be read."
      )
      .font(AglynFont.subheadline).foregroundStyle(.secondary)
    } else {
      AglynBarChart(
        summary.counts.map {
          AglynBar(id: $0.day, value: $0.total, spoken: "\($0.day) · \(Int($0.total)) view\($0.total == 1 ? "" : "s")")
        }, height: SiteAnalyticsMetrics.pageChart)
    }
  }
}
