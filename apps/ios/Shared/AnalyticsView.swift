// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Observation
import SwiftUI

// A SITE'S ANALYTICS, as the console's Analytics page shows them: Traffic
// over `hosts/{id}/analytics` (a document per UTC day), Pages (the per-page
// table, a Pro feature) over `hosts/{id}/screenAnalytics`, and whatever
// plugins put in the page's `hostAnalytics` slot. The figures are the
// console's own functions, ported once in the contracts. The Kotlin shell's
// Analytics.kt is the same screen.

/// The core page's widget slot, as the console's `PluginWidgetSlot`.
let hostAnalyticsSlot = "hostAnalytics"

struct TrafficDay: Equatable {
  let day: String
  let total: Double
  let visitors: Double
  let paths: [String: Double]
  let referrers: [String: Double]
  let devices: [String: Double]
  let utm: [String: [String: Double]]

  init(day: String, data: [String: Any]?) {
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

struct TrafficSummary {
  let current: [TrafficDay]
  let total: Double
  let deltaPct: Double?
  let visitors: Double
  let avgPerDay: Int
  let devices: [DeviceSplitEntry]
  let topPaths: [(key: String, value: Double)]
  let topReferrers: [(key: String, value: Double)]
  let topUtmSources: [(key: String, value: Double)]
  let topUtmCampaigns: [(key: String, value: Double)]

  /// The Traffic card's figures over both windows (oldest first), as the console computes them.
  init(days: [TrafficDay], range: Int) {
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
    topReferrers = rollUp(current.map(\.referrers))
    topUtmSources = Array(rollUp(current.map { $0.utm["source"] ?? [:] }).prefix(5))
    topUtmCampaigns = Array(rollUp(current.map { $0.utm["campaign"] ?? [:] }).prefix(5))
  }
}

/// Both windows of `range` days, oldest first, a zero day where no document was written.
func trafficDays(_ docs: [FirestoreDocument], now: Date, range: Int) -> [TrafficDay] {
  let byID = Dictionary(docs.map { ($0.id, $0.data) }, uniquingKeysWith: { a, _ in a })
  return recentDayIDs(now: now, days: range * 2).reversed().map { TrafficDay(day: $0, data: byID[$0]) }
}

private func count(_ value: Double) -> String { Int(value).formatted() }

@MainActor
@Observable
final class AnalyticsModel {
  private(set) var traffic: [FirestoreDocument]?
  private(set) var trafficFailed = false
  private(set) var screenDocs: [FirestoreDocument]?
  private(set) var screens: [String: String] = [:]
  private(set) var entitled: Bool?
  private(set) var entitlementFailed = false
  @ObservationIgnored private var listeners: [FirestoreListening] = []
  @ObservationIgnored private var pagesListener: FirestoreListening?

  func start(reader: FirestoreReader, api: ConsoleAPIClient?, hostID: String, range: Int) {
    stopTraffic()
    // The newest `2 × range` day documents by id hold every day of both windows.
    listeners.append(
      reader.listen(
        FirestoreQuery(["hosts", hostID, "analytics"], order: [.init("__name__", descending: true)], limit: range * 2)
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
    if entitled == nil, let api {
      entitlementFailed = false
      Task {
        // A failed lookup is not a plan without the feature: it says so, and a refresh retries.
        do {
          let body = try await api.request("/api/orgs/entitlements", query: [("hostId", hostID)])
          if case .bool(let value)? = body?["features"]?["screenAnalytics"] { entitled = value } else { entitled = false }
        } catch {
          entitlementFailed = true
        }
      }
    }
  }

  func startPages(reader: FirestoreReader, hostID: String, range: Int) {
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

  func stop() {
    stopTraffic()
    pagesListener?.remove()
    pagesListener = nil
  }
}

struct AnalyticsView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @State private var analytics = AnalyticsModel()
  @State private var range = 14
  @State private var pagesRange = 14

  private var hostID: String? { model.workspace?.site?.id }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: AglynSpace.two) {
        if hostID == nil {
          AglynEmptyState("Pick a site first", systemImage: "globe", message: "Analytics are one site's.")
        } else {
          trafficCard
          pagesCard
          if let context = model.context(for: navigation) {
            ForEach(model.registry.widgets(for: .aglyn, slot: hostAnalyticsSlot)) { widget in
              widget.make(context).accessibilityIdentifier("widget-\(widget.id)")
            }
          }
        }
      }
      .padding(AglynSpace.two)
      .frame(maxWidth: 1180)
      .frame(maxWidth: .infinity)
    }
    .aglynListBackground()
    .navigationTitle("Analytics")
    .refreshable { model.refresh() }
    .task(id: "\(hostID ?? ""):\(range):\(model.refreshToken)") {
      if let hostID, let reader = model.reader { analytics.start(reader: reader, api: model.api, hostID: hostID, range: range) }
    }
    .task(id: "\(hostID ?? ""):\(pagesRange):\(analytics.entitled == true):\(model.refreshToken)") {
      if let hostID, let reader = model.reader, analytics.entitled == true {
        analytics.startPages(reader: reader, hostID: hostID, range: pagesRange)
      }
    }
    .onDisappear { analytics.stop() }
    .accessibilityIdentifier("analytics")
  }

  private var trafficCard: some View {
    AglynCard("Traffic", systemImage: "chart.bar.xaxis") {
      Picker("Range", selection: $range) {
        ForEach([7, 14, 30, 90], id: \.self) { Text("Last \($0) days").tag($0) }
      }
      .pickerStyle(.segmented)
      .accessibilityIdentifier("analytics-range")
      if let docs = analytics.traffic {
        if analytics.trafficFailed && docs.isEmpty {
          AglynNotice("Traffic could not be loaded. Check the connection and try again.", tone: .error)
        } else {
          let summary = TrafficSummary(days: trafficDays(docs, now: .now, range: range), range: range)
          if summary.total == 0 {
            Text("No pageviews recorded yet — stats appear as visitors browse your published site.")
              .font(AglynFont.subheadline).foregroundStyle(.secondary)
          } else {
            tiles(summary)
            AglynBarChart(summary.current.map { AglynBar(id: $0.day, value: $0.total, spoken: "\($0.day): \(count($0.total))") })
              .accessibilityIdentifier("analytics-chart")
            AglynCardGrid(minimum: 220, maxColumns: 2) {
              topList("Top pages", Array(summary.topPaths.prefix(5)))
              topList("Top referrers", Array(summary.topReferrers.prefix(5)))
              topList("Top campaign sources (UTM)", summary.topUtmSources)
              topList("Top campaigns (UTM)", summary.topUtmCampaigns)
            }
          }
        }
      } else {
        SkeletonRows(count: 3)
      }
    }
    .accessibilityIdentifier("analytics-traffic")
  }

  private func tiles(_ summary: TrafficSummary) -> some View {
    AglynCardGrid(minimum: 160, maxColumns: 3) {
      MetricCard(
        "Page views", systemImage: "eye", value: count(summary.total),
        caption: summary.deltaPct.map { "\($0 > 0 ? "+" : "")\($0.formatted())% vs prior \(range) days" } ?? "No earlier window to compare")
      if summary.visitors > 0 {
        MetricCard("Visitors (approx.)", systemImage: "person", value: count(summary.visitors), caption: "One per browser tab a day")
      }
      MetricCard("Avg / day", systemImage: "chart.line.uptrend.xyaxis", value: count(Double(summary.avgPerDay)), caption: "Over \(range) days")
      if !summary.devices.isEmpty {
        MetricCard(deviceSplitLabel(summary.devices), systemImage: "iphone.and.ipad", value: deviceSplitValue(summary.devices), caption: "Device split")
      }
      if let top = summary.topPaths.first {
        MetricCard("Top page · \(count(top.value)) views", systemImage: "doc.text", value: top.key, caption: "")
      }
      if let top = summary.topReferrers.first {
        MetricCard("Top referrer · \(count(top.value)) views", systemImage: "link", value: top.key, caption: "")
      }
    }
    .accessibilityIdentifier("analytics-tiles")
  }

  private func topList(_ title: String, _ rows: [(key: String, value: Double)]) -> some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      Text(title).font(AglynFont.strongSubheadline)
      if rows.isEmpty { Text("Nothing yet").font(AglynFont.caption).foregroundStyle(.secondary) }
      ForEach(rows, id: \.key) { row in
        HStack {
          Text(row.key).lineLimit(1).truncationMode(.middle)
          Spacer()
          Text(count(row.value)).foregroundStyle(.secondary).monospacedDigit()
        }
        .font(AglynFont.subheadline)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var pagesCard: some View {
    AglynCard("Pages", systemImage: "doc.on.doc") {
      if analytics.entitled == true {
        Picker("Range", selection: $pagesRange) {
          ForEach([7, 14, 30], id: \.self) { Text("Last \($0) days").tag($0) }
        }
        .pickerStyle(.segmented)
      }
      switch analytics.entitled {
      case nil:
        if analytics.entitlementFailed {
          AglynNotice("Your plan could not be checked. Check the connection and pull to refresh.", tone: .error)
            .accessibilityIdentifier("analytics-pages-failed")
        } else {
          SkeletonRows(count: 2)
        }
      case false?:
        AglynNotice("Per-page traffic is part of the Pro plan. Upgrade in Billing to see each page's views, devices and referrers.", tone: .info)
          .accessibilityIdentifier("analytics-pages-upgrade")
      case true?:
        if let docs = analytics.screenDocs {
          let rows = aggregateScreenDays(docs.map(\.data))
          let sum = max(1, rows.reduce(0) { $0 + $1.total })
          if rows.isEmpty {
            Text("No page views in this window.").foregroundStyle(.secondary)
          } else {
            Grid(alignment: .leading, horizontalSpacing: AglynSpace.two, verticalSpacing: AglynSpace.one) {
              GridRow {
                Text("Page"); Text("Views"); Text("Share"); Text("Top device"); Text("Top referrer")
              }
              .font(AglynFont.caption.weight(.semibold))
              .foregroundStyle(.secondary)
              Divider()
              ForEach(rows, id: \.screenId) { row in
                GridRow {
                  Text(analytics.screens[row.screenId] ?? row.screenId).lineLimit(1)
                  Text(count(Double(row.total))).monospacedDigit()
                  Text("\(Int((Double(row.total) * 100 / Double(sum) + 0.5).rounded(.down)))%").monospacedDigit()
                  Text(topDevice(row).capitalized)
                  Text(topReferrer(row).isEmpty ? "—" : topReferrer(row)).lineLimit(1)
                }
                .font(AglynFont.subheadline)
                .accessibilityElement(children: .combine)
              }
            }
          }
        } else {
          SkeletonRows(count: 3)
        }
      }
    }
    .accessibilityIdentifier("analytics-pages")
  }
}
