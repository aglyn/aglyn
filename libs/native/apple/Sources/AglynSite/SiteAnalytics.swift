// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import Observation
import SwiftUI

// A SITE'S NUMBERS, as the console's cards read them (AGL-4011): the Traffic card over `hosts/{id}/analytics` (a
// document per UTC day), the Pages table (a Pro feature) over `hosts/{id}/screenAnalytics`, a page's own traffic over
// its `screenAnalytics/{screenId}:{day}` documents, and the activity log `hosts/{id}/activity`. The figures are the
// console's own functions, ported once in the contracts. Home, Analytics and a page's detail draw these parts, and a
// phone's Home can host them too. The Kotlin twin is `site/SiteAnalytics.kt`.

/// One UTC day of a site's traffic.
public struct TrafficDay: Equatable, Sendable {
  public let day: String
  public let total: Double
  public let visitors: Double
  public let paths: [String: Double]
  public let referrers: [String: Double]
  public let devices: [String: Double]
  public let utm: [String: [String: Double]]

  public init(day: String, data: [String: Any]?) {
    func counts(_ value: Any?) -> [String: Double] {
      (value as? [String: Any] ?? [:]).compactMapValues { ($0 as? NSNumber)?.doubleValue }
    }
    self.day = day
    total = (data?["total"] as? NSNumber)?.doubleValue ?? 0
    visitors = (data?["visitors"] as? NSNumber)?.doubleValue ?? 0
    paths = counts(data?["paths"])
    referrers = counts(data?["referrers"])
    devices = counts(data?["devices"])
    utm = (data?["utm"] as? [String: Any] ?? [:]).mapValues { counts($0) }
  }
}

/// The Traffic card's figures over both windows (oldest first), as the console computes them.
public struct TrafficSummary {
  public let current: [TrafficDay]
  public let total: Double
  public let deltaPct: Double?
  public let visitors: Double
  public let avgPerDay: Int
  public let devices: [DeviceSplitEntry]
  public let topPaths: [(key: String, value: Double)]
  public let topReferrers: [(key: String, value: Double)]
  public let topUtmSources: [(key: String, value: Double)]
  public let topUtmCampaigns: [(key: String, value: Double)]

  public init(days: [TrafficDay], range: Int) {
    current = Array(days.suffix(range))
    let prior = Array(days.dropLast(range).suffix(range))
    total = current.reduce(0) { $0 + $1.total }
    deltaPct = trafficDeltaPct(current: total, prior: prior.reduce(0) { $0 + $1.total })
    visitors = current.reduce(0) { $0 + $1.visitors }
    avgPerDay = Int((total / Double(max(1, current.count)) + 0.5).rounded(.down))
    var deviceTotals: [String: Double] = [:]
    for day in current { for (key, value) in day.devices { deviceTotals[key, default: 0] += value } }
    devices = deviceSplit(deviceTotals)
    topPaths = rollUp(current.map(\.paths))
    topReferrers = rollUp(current.map(\.referrers)).map { (key: referrerLabel($0.key), value: $0.value) }
    topUtmSources = Array(rollUp(current.map { $0.utm["source"] ?? [:] }).prefix(5))
    topUtmCampaigns = Array(rollUp(current.map { $0.utm["campaign"] ?? [:] }).prefix(5))
  }
}

/// Both windows of `range` days, oldest first, a zero day where no document was written.
public func trafficDays(_ docs: [FirestoreDocument], now: Date, range: Int) -> [TrafficDay] {
  let byID = Dictionary(docs.map { ($0.id, $0.data) }, uniquingKeysWith: { a, _ in a })
  return recentDayIDs(now: now, days: range * 2).reversed().map { TrafficDay(day: $0, data: byID[$0]) }
}

/// The Pages table's column widths and the charts' heights, on the console's 8-point scale.
enum SiteAnalyticsMetrics {
  static let viewsColumn = AglynSpace.of(9)
  static let shareColumn = AglynSpace.of(7)
  static let deviceColumn = AglynSpace.of(12)
  static let referrerColumn = AglynSpace.of(17.5)
  static let summaryChart = AglynSpace.of(15)
  static let detailChart = AglynSpace.of(20)
  static let pageChart = AglynSpace.of(12)
  static let tileMinimum = AglynSpace.of(15)
  static let pageTileMinimum = AglynSpace.of(17.5)
  static let listMinimum = AglynSpace.of(27.5)
}

/// A count as the console prints it: `1,284`.
public func analyticsCount(_ value: Double) -> String { Int(value).formatted() }

/// The site's traffic days, its routing map (page id → path) and whether its plan shows per-page traffic
/// (`screenAnalytics`, Pro and up).
@MainActor
@Observable
public final class SiteAnalyticsModel {
  public private(set) var traffic: [FirestoreDocument]?
  public private(set) var trafficFailed = false
  public private(set) var screenDocs: [FirestoreDocument]?
  public private(set) var screens: [String: String] = [:]
  public private(set) var entitled: Bool?
  public private(set) var entitlementFailed = false
  @ObservationIgnored private var listeners: [FirestoreListening] = []
  @ObservationIgnored private var pagesListener: FirestoreListening?

  public init() {}

  /// Reads both windows of `range` days, the site's routing map, and (once) the plan's `screenAnalytics`.
  public func start(reader: FirestoreReader, api: ConsoleAPIClient?, hostID: String, range: Int) {
    stopTraffic()
    // Both windows' day documents, by id from the oldest day on: ascending, which the Firestore emulator can answer
    // too (it refuses a descending scan of ids).
    let first = recentDayIDs(now: .now, days: range * 2).last ?? ""
    listeners.append(
      reader.listen(
        FirestoreQuery(
          ["hosts", hostID, "analytics"], filters: [ListQueryConstraint(path: "__name__", op: .greaterThanOrEqual, value: first)],
          order: [.init("__name__")], limit: range * 2)
      ) { [weak self] result in
        switch result {
        case .success(let docs):
          self?.traffic = docs
          self?.trafficFailed = false
        case .failure:
          self?.trafficFailed = true
          if self?.traffic == nil { self?.traffic = [] }
        }
      })
    listeners.append(
      reader.listenDocument(["hosts", hostID]) { [weak self] result in
        if case .success(let doc) = result {
          self?.screens = (doc?.data["screens"] as? [String: Any] ?? [:]).compactMapValues { $0 as? String }
        }
      })
    checkEntitlement(api: api, hostID: hostID)
  }

  /// Whether the plan shows per-page traffic. A failed lookup is not a plan without the feature: it says so, and a
  /// refresh retries.
  public func checkEntitlement(api: ConsoleAPIClient?, hostID: String) {
    guard entitled == nil, let api else { return }
    entitlementFailed = false
    Task {
      do {
        let body = try await api.request("/api/orgs/entitlements", query: [("hostId", hostID)])
        if case .bool(let value)? = body?["features"]?["screenAnalytics"] { entitled = value } else { entitled = false }
      } catch {
        Telemetry.record(error, "site_analytics.entitlement")
        entitlementFailed = true
      }
    }
  }

  /// Every page's day documents in the window, newest first, at most a thousand (the console table's ceiling).
  public func startPages(reader: FirestoreReader, hostID: String, range: Int) {
    pagesListener?.remove()
    let first = recentDayIDs(now: .now, days: range).last ?? ""
    pagesListener = reader.listen(
      FirestoreQuery(
        ["hosts", hostID, "screenAnalytics"], filters: [ListQueryConstraint(path: "day", op: .greaterThanOrEqual, value: first)],
        order: [.init("day", descending: true)], limit: 1000)
    ) { [weak self] result in
      if case .success(let docs) = result { self?.screenDocs = docs } else { self?.screenDocs = [] }
    }
  }

  private func stopTraffic() {
    listeners.forEach { $0.remove() }
    listeners = []
  }

  public func stop() {
    stopTraffic()
    pagesListener?.remove()
    pagesListener = nil
  }
}

/// One page's last 14 days (`screenAnalytics/{screenId}:{day}`), read by id range so no index is owed.
@MainActor
@Observable
public final class PageTrafficModel {
  public static let days = 14
  public private(set) var days: [ScreenTrafficDay]?
  public private(set) var failed = false
  @ObservationIgnored private var listener: FirestoreListening?

  public init() {}

  public func start(reader: FirestoreReader, hostID: String, screenID: String) {
    listener?.remove()
    let ids = Array(recentDayIDs(now: .now, days: Self.days).reversed())
    let first = "\(screenID):\(ids.first ?? "")"
    let last = "\(screenID):\(ids.last ?? "")"
    listener = reader.listen(
      FirestoreQuery(
        ["hosts", hostID, "screenAnalytics"],
        filters: [
          ListQueryConstraint(path: "__name__", op: .greaterThanOrEqual, value: first),
          ListQueryConstraint(path: "__name__", op: .lessThanOrEqual, value: last),
        ],
        order: [.init("__name__")], limit: Self.days)
    ) { [weak self] result in
      switch result {
      case .success(let docs):
        let byID = Dictionary(docs.map { ($0.id, $0.data) }, uniquingKeysWith: { a, _ in a })
        // Oldest first, a zero day where nothing was written: the chart reads left to right.
        self?.days = ids.map { ScreenTrafficDay(data: byID["\(screenID):\($0)"]) }
        self?.failed = false
      case .failure:
        self?.failed = true
        if self?.days == nil { self?.days = [] }
      }
    }
  }

  public func stop() {
    listener?.remove()
    listener = nil
  }
}

/// One row of a site's activity log, in the console's words.
public struct SiteActivityRow: Identifiable, Equatable, Sendable {
  public let id: String
  public let text: String
  public let actor: String
  public let at: Date?
}

/// A site's activity log, newest first: the whole site's (Home's Recent activity) or one page's (Page Activity).
/// A window of 200, as the console's card reads; one page's rows are filtered on the server and sorted here, which
/// needs no composite index. A row that recorded a person's uid and no address is named by the address that account
/// holds today, read through the console's `/api/hosts/activity-actors` (`useResolvedActivityActors`), fifty at a time.
@MainActor
@Observable
public final class SiteActivityModel {
  public static let window = 200
  static let actorsPerRequest = 50
  public private(set) var rows: [SiteActivityRow]?
  public private(set) var failed = false
  /// The window was full: there is more history than these rows.
  public private(set) var truncated = false
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var docs: [FirestoreDocument] = []
  @ObservationIgnored private var resolved: [String: String] = [:]
  @ObservationIgnored private var asked: Set<String> = []

  public init() {}

  public func start(reader: FirestoreReader, api: ConsoleAPIClient?, hostID: String, targetID: String? = nil) {
    listener?.remove()
    resolved = [:]
    asked = []
    let query =
      if let targetID {
        FirestoreQuery(["hosts", hostID, "activity"], equals: [("target.id", targetID)], limit: Self.window + 1)
      } else {
        FirestoreQuery(["hosts", hostID, "activity"], order: [.init("createdAt", descending: true)], limit: Self.window + 1)
      }
    listener = reader.listen(query) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.truncated = docs.count > Self.window
        self.docs = Array(docs.prefix(Self.window))
        self.failed = false
        self.publish()
        self.resolveActors(api: api, hostID: hostID)
      case .failure:
        self.failed = true
      }
    }
  }

  private func publish() {
    rows = docs.map { doc in
      var fields = ActivityEntryFields(data: doc.data)
      if let uid = Self.unaddressedUID(fields), let now = resolved[uid] { fields.actorEmailNow = now }
      return SiteActivityRow(id: doc.id, text: activityRowText(fields), actor: activityActorLabel(fields), at: doc.date("createdAt"))
    }
    .sorted { ($0.at ?? .distantPast) > ($1.at ?? .distantPast) }
  }

  /// The uid a row names with no address: a person's (never an API key's or the platform's).
  static func unaddressedUID(_ fields: ActivityEntryFields) -> String? {
    if let email = fields.actorEmail, !email.isEmpty { return nil }
    let uid = fields.actorId?.trimmingCharacters(in: .whitespaces) ?? ""
    return uid.isEmpty || uid == "api" || uid.hasPrefix("system:") ? nil : uid
  }

  private func resolveActors(api: ConsoleAPIClient?, hostID: String) {
    guard let api else { return }
    let fresh = Array(Set(docs.compactMap { Self.unaddressedUID(ActivityEntryFields(data: $0.data)) }).subtracting(asked)).sorted()
    guard !fresh.isEmpty else { return }
    asked.formUnion(fresh)
    Task {
      for start in stride(from: 0, to: fresh.count, by: Self.actorsPerRequest) {
        let batch = fresh[start..<min(fresh.count, start + Self.actorsPerRequest)]
        // A refused or failed lookup leaves the console's own label, `Account <uid>`.
        guard
          let body = try? await api.request(
            "/api/hosts/activity-actors", query: [("hostId", hostID), ("uids", batch.joined(separator: ","))]),
          case .object(let actors)? = body["actors"]
        else { continue }
        for (uid, value) in actors { if let email = value.stringValue { resolved[uid] = email } }
        publish()
      }
    }
  }

  public func stop() {
    listener?.remove()
    listener = nil
  }
}

// MARK: - Cards

/// The console's Traffic card (`HostAnalyticsCard`): a range, the figures, a bar per day. On Home it is the summary with
/// View details; on Analytics (`detail`) it adds the four ranked lists and the per-page note.
public struct SiteTrafficCard: View {
  let reader: FirestoreReader
  let api: ConsoleAPIClient?
  let hostID: String
  let detail: Bool
  let refresh: Int
  let viewDetails: (() -> Void)?
  @State private var model = SiteAnalyticsModel()
  @State private var range = 14

  public init(
    reader: FirestoreReader, api: ConsoleAPIClient?, hostID: String, detail: Bool = false, refresh: Int = 0,
    viewDetails: (() -> Void)? = nil
  ) {
    self.reader = reader
    self.api = api
    self.hostID = hostID
    self.detail = detail
    self.refresh = refresh
    self.viewDetails = viewDetails
  }

  public var body: some View {
    AglynStatsSection("Traffic") {
      HStack(spacing: AglynSpace.two) {
        AglynRangePicker(days: $range, choices: [7, 14, 30, 90]).accessibilityIdentifier("analytics-range")
        if let viewDetails {
          Button("View details", action: viewDetails).buttonStyle(.borderless).foregroundStyle(AglynColor.tint)
            .accessibilityIdentifier("traffic-view-details")
        }
      }
    } content: {
      content
    }
    .task(id: "\(hostID):\(range):\(refresh)") {
      model.start(reader: reader, api: detail ? api : nil, hostID: hostID, range: range)
    }
    .onDisappear { model.stop() }
    .accessibilityIdentifier("analytics-traffic")
  }

  @ViewBuilder
  private var content: some View {
    if let docs = model.traffic {
      if model.trafficFailed && docs.isEmpty {
        AglynNotice("Traffic could not be loaded. Check the connection and try again.", tone: .error)
      } else {
        let summary = TrafficSummary(days: trafficDays(docs, now: .now, range: range), range: range)
        if summary.total == 0 {
          Text("No pageviews recorded yet — stats appear as visitors browse your published site.")
            .font(AglynFont.subheadline).foregroundStyle(.secondary)
        } else {
          figures(summary)
          AglynBarChart(
            summary.current.map { AglynBar(id: $0.day, value: $0.total, spoken: "\($0.day): \(analyticsCount($0.total))") },
            height: detail ? SiteAnalyticsMetrics.detailChart : SiteAnalyticsMetrics.summaryChart
          )
          .accessibilityIdentifier("analytics-chart")
          if detail {
            AglynCardGrid(minimum: SiteAnalyticsMetrics.listMinimum, maxColumns: 2, spacing: AglynSpace.three) {
              AglynTopList("Top pages", rows: rows(Array(summary.topPaths.prefix(5))))
              AglynTopList("Top referrers", rows: rows(Array(summary.topReferrers.prefix(5))))
              AglynTopList("Top campaign sources (UTM)", rows: rows(summary.topUtmSources))
              AglynTopList("Top campaigns (UTM)", rows: rows(summary.topUtmCampaigns))
            }
            Text("Per-page breakdowns live in the Pages table in Analytics and in each page’s detail view (Pro plans).")
              .font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
      }
    } else {
      SkeletonRows(count: 3)
    }
  }

  private func rows(_ list: [(key: String, value: Double)]) -> [(label: String, count: String)] {
    list.map { (label: $0.key, count: analyticsCount($0.value)) }
  }

  private func figures(_ summary: TrafficSummary) -> some View {
    AglynCardGrid(minimum: SiteAnalyticsMetrics.tileMinimum, maxColumns: 6, spacing: AglynSpace.three) {
      AglynStatTile(
        analyticsCount(summary.total), label: "Page views",
        delta: summary.deltaPct.map { "\($0 > 0 ? "+" : "")\($0.formatted())% vs prior" },
        deltaTone: (summary.deltaPct ?? 0) > 0 ? .up : (summary.deltaPct ?? 0) < 0 ? .down : .flat,
        help: "vs the previous \(range) days")
      if summary.visitors > 0 {
        AglynStatTile(
          analyticsCount(summary.visitors), label: "Visitors (approx.)",
          help:
            "Approximate: counts each browser tab once per day, without cookies or visitor IDs. A visitor using two tabs, or returning on another day, counts again."
        )
      }
      AglynStatTile(analyticsCount(Double(summary.avgPerDay)), label: "Avg / day")
      if !summary.devices.isEmpty {
        AglynStatTile(deviceSplitValue(summary.devices), label: deviceSplitLabel(summary.devices))
      }
      if let top = summary.topPaths.first {
        AglynStatTile(top.key, label: "Top page · \(analyticsCount(top.value)) views", help: top.key)
      }
      if let top = summary.topReferrers.first {
        AglynStatTile(top.key, label: "Top referrer · \(analyticsCount(top.value)) views", help: top.key)
      }
    }
    .accessibilityIdentifier("analytics-tiles")
  }
}

/// The console's Pages table (`ScreensAnalyticsTable`): every page's views over a range, side by side, a Pro feature.
/// A row opens that page's traffic.
public struct SitePagesTrafficCard: View {
  let reader: FirestoreReader
  let api: ConsoleAPIClient?
  let hostID: String
  let refresh: Int
  let upgrade: () -> Void
  let open: (_ screenID: String, _ path: String) -> Void
  @State private var model = SiteAnalyticsModel()
  @State private var range = 14

  public init(
    reader: FirestoreReader, api: ConsoleAPIClient?, hostID: String, refresh: Int = 0, upgrade: @escaping () -> Void,
    open: @escaping (_ screenID: String, _ path: String) -> Void
  ) {
    self.reader = reader
    self.api = api
    self.hostID = hostID
    self.refresh = refresh
    self.upgrade = upgrade
    self.open = open
  }

  public var body: some View {
    AglynStatsSection("Pages") {
      if model.entitled == true { AglynRangePicker(days: $range, choices: [7, 14, 30]) }
    } content: {
      content
    }
    .task(id: "\(hostID):\(refresh)") {
      model.start(reader: reader, api: api, hostID: hostID, range: 1)
    }
    .task(id: "\(hostID):\(range):\(model.entitled == true):\(refresh)") {
      if model.entitled == true { model.startPages(reader: reader, hostID: hostID, range: range) }
    }
    .onDisappear { model.stop() }
    .accessibilityIdentifier("analytics-pages")
  }

  @ViewBuilder
  private var content: some View {
    switch model.entitled {
    case nil:
      if model.entitlementFailed {
        AglynNotice("Your plan could not be checked. Check the connection and pull to refresh.", tone: .error)
          .accessibilityIdentifier("analytics-pages-failed")
      } else {
        Text("Checking your plan…").font(AglynFont.subheadline).foregroundStyle(.secondary)
      }
    case false?:
      AglynUpgradeNotice(
        "Comparing traffic across pages is a Pro feature. Data is already being collected, so history is waiting the moment you upgrade.",
        action: upgrade
      )
      .accessibilityIdentifier("analytics-pages-upgrade")
    case true?:
      if let docs = model.screenDocs {
        let rows = aggregateScreenDays(docs.map(\.data))
        let sum = rows.reduce(0) { $0 + $1.total }
        if rows.isEmpty {
          Text("No per-page pageviews recorded in this range yet.").font(AglynFont.subheadline).foregroundStyle(.secondary)
        } else {
          table(rows, sum: sum)
        }
      } else {
        SkeletonRows(count: 3)
      }
    }
  }

  private func table(_ rows: [ScreenTrafficRow], sum: Int) -> some View {
    VStack(spacing: 0) {
      header
      ForEach(rows, id: \.screenId) { row in
        Divider()
        let path = model.screens[row.screenId] ?? row.screenId
        Button {
          open(row.screenId, path)
        } label: {
          HStack(spacing: AglynSpace.two) {
            Text(path).lineLimit(1).truncationMode(.middle).frame(maxWidth: .infinity, alignment: .leading)
            Text(analyticsCount(Double(row.total))).monospacedDigit().frame(width: SiteAnalyticsMetrics.viewsColumn, alignment: .trailing)
            Text(sum > 0 ? "\(Int((Double(row.total) * 100 / Double(sum) + 0.5).rounded(.down)))%" : "--").monospacedDigit()
              .foregroundStyle(.secondary).frame(width: SiteAnalyticsMetrics.shareColumn, alignment: .trailing)
            Text(topDevice(row).isEmpty ? "--" : topDevice(row).capitalized).foregroundStyle(.secondary)
              .frame(width: SiteAnalyticsMetrics.deviceColumn, alignment: .leading)
            Text(topReferrer(row).isEmpty ? "--" : referrerLabel(topReferrer(row))).lineLimit(1).foregroundStyle(.secondary)
              .frame(width: SiteAnalyticsMetrics.referrerColumn, alignment: .leading)
            Image(systemName: "chevron.right").font(AglynFont.caption).foregroundStyle(.tertiary).accessibilityHidden(true)
          }
          .font(AglynFont.subheadline)
          .padding(.vertical, AglynSpace.oneAndHalf)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("analytics-page-\(row.screenId)")
      }
    }
  }

  private var header: some View {
    HStack(spacing: AglynSpace.two) {
      Text("Page").frame(maxWidth: .infinity, alignment: .leading)
      Text("Views").frame(width: SiteAnalyticsMetrics.viewsColumn, alignment: .trailing)
      Text("Share").frame(width: SiteAnalyticsMetrics.shareColumn, alignment: .trailing)
      Text("Top device").frame(width: SiteAnalyticsMetrics.deviceColumn, alignment: .leading)
      Text("Top referrer").frame(width: SiteAnalyticsMetrics.referrerColumn, alignment: .leading)
      Image(systemName: "chevron.right").font(AglynFont.caption).hidden()
    }
    .font(AglynFont.caption.weight(.semibold))
    .foregroundStyle(.secondary)
    .padding(.bottom, AglynSpace.one)
  }
}

/// The console's "Page traffic" card (`ScreenAnalyticsCard`): one page's last 14 days, a Pro feature whose data is
/// collected on every plan.
public struct PageTrafficCard: View {
  let reader: FirestoreReader
  let api: ConsoleAPIClient?
  let hostID: String
  let screenID: String
  let refresh: Int
  let upgrade: () -> Void
  @State private var plan = SiteAnalyticsModel()
  @State private var model = PageTrafficModel()

  public init(
    reader: FirestoreReader, api: ConsoleAPIClient?, hostID: String, screenID: String, refresh: Int = 0,
    upgrade: @escaping () -> Void
  ) {
    self.reader = reader
    self.api = api
    self.hostID = hostID
    self.screenID = screenID
    self.refresh = refresh
    self.upgrade = upgrade
  }

  public var body: some View {
    AglynStatsSection(plan.entitled == true ? "Page traffic (14 days)" : "Page traffic") {
      EmptyView()
    } content: {
      content
    }
    .task(id: "\(hostID):\(refresh)") { plan.checkEntitlement(api: api, hostID: hostID) }
    .task(id: "\(hostID):\(screenID):\(plan.entitled == true):\(refresh)") {
      if plan.entitled == true { model.start(reader: reader, hostID: hostID, screenID: screenID) }
    }
    .onDisappear { model.stop() }
    .accessibilityIdentifier("page-traffic")
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
        "Per-page traffic — the views, devices and referrers of each page — is a Pro feature. Data is already being collected, so history is waiting the moment you upgrade.",
        action: upgrade
      )
      .accessibilityIdentifier("page-traffic-upgrade")
    case true?:
      if let days = model.days {
        let summary = summarizeScreenTraffic(days)
        if model.failed && days.allSatisfy({ $0.total == 0 }) {
          AglynNotice("Traffic could not be loaded. Check the connection and try again.", tone: .error)
        } else if summary.total == 0 {
          Text("No pageviews recorded for this page yet.").font(AglynFont.subheadline).foregroundStyle(.secondary)
        } else {
          AglynCardGrid(minimum: SiteAnalyticsMetrics.pageTileMinimum, maxColumns: 4, spacing: AglynSpace.three) {
            AglynStatTile(analyticsCount(summary.total), label: "Page views")
            if let dwell = summary.avgDwellMs {
              AglynStatTile(formatDwell(dwell), label: "Avg. time on this page")
            }
          }
          let ids = recentDayIDs(now: .now, days: PageTrafficModel.days).reversed()
          AglynBarChart(
            zip(ids, days).map { AglynBar(id: $0, value: $1.total, spoken: "\($0): \(analyticsCount($1.total))") }, height: SiteAnalyticsMetrics.pageChart)
          if !summary.deviceLine.isEmpty {
            Text(summary.deviceLine).font(AglynFont.caption).foregroundStyle(.secondary)
          }
          AglynTopList(
            "Top referrers", rows: summary.topReferrers.map { (label: referrerLabel($0.referrer), count: analyticsCount($0.count)) })
        }
      } else {
        SkeletonRows(count: 2)
      }
    }
  }
}

/// The console's activity card (`HostActivityCard`): Recent Activity for the whole site, or a page's "Page Activity".
/// `limit` shows only the newest rows (Home's five); nil shows the whole window.
public struct SiteActivityCard: View {
  let reader: FirestoreReader
  let api: ConsoleAPIClient?
  let hostID: String
  let targetID: String?
  let title: String
  let limit: Int?
  let refresh: Int
  let viewAll: (() -> Void)?
  @State private var model = SiteActivityModel()

  public init(
    reader: FirestoreReader, api: ConsoleAPIClient?, hostID: String, targetID: String? = nil, title: String = "Recent activity",
    limit: Int? = nil, refresh: Int = 0, viewAll: (() -> Void)? = nil
  ) {
    self.reader = reader
    self.api = api
    self.hostID = hostID
    self.targetID = targetID
    self.title = title
    self.limit = limit
    self.refresh = refresh
    self.viewAll = viewAll
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
      AglynSectionHeader(title) {
        if let viewAll {
          Button("View all", action: viewAll).buttonStyle(.borderless).foregroundStyle(AglynColor.tint)
            .accessibilityIdentifier("activity-view-all")
        }
      }
      content
    }
    .task(id: "\(hostID):\(targetID ?? ""):\(refresh)") { model.start(reader: reader, api: api, hostID: hostID, targetID: targetID) }
    .onDisappear { model.stop() }
    .accessibilityIdentifier(targetID == nil ? "site-activity" : "page-activity")
  }

  @ViewBuilder
  private var content: some View {
    if model.failed && model.rows == nil {
      // A read that never happened is not an empty history.
      AglynNotice(
        "Could not read the activity log. This is NOT the same as nothing having happened — do not treat this as a record that the page is unchanged.",
        tone: .warning)
    } else if let rows = model.rows {
      if rows.isEmpty {
        Text("No activity yet — changes made in the console appear here.").font(AglynFont.subheadline)
          .foregroundStyle(.secondary)
      } else {
        let shown = limit.map { Array(rows.prefix($0)) } ?? rows
        AglynListCard(shown) { row in
          ActivityRow(
            row.text, subtitle: [row.actor, row.at.map { relativeTime($0) }].compactMap { $0 }.joined(separator: " · "),
            time: nil, systemImage: "clock.arrow.circlepath", tone: .neutral, unread: false)
        }
        if limit == nil && model.truncated {
          Text("Showing the newest \(SiteActivityModel.window) entries.").font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
    } else {
      SkeletonRows(count: 3)
    }
  }
}
