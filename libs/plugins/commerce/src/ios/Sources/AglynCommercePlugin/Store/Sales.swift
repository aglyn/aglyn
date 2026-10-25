// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Charts
import Observation
import SwiftUI

/*
 * SALES: today, and the last 7 or 30 days against the window before.
 *
 * The orders since the start of the window before the one asked for, newest
 * first (the orders page's own `createdAtMs` order, so its index serves it),
 * up to a ceiling, added up by the console's own `orderWindowFigures` (a sale
 * is paid and live; it counts what it kept). Days are the device's local days.
 *
 * Every figure waits for a plan that sells commerce analytics, as the
 * console's cards do: the orders are ones the workspace may read, so the plan
 * is checked here, on the workspace's own document.
 */

let salesWindowCeiling = 500

struct SalesDay: Identifiable, Hashable {
  let start: Date
  var cents: Int
  var orders: Int
  var id: Date { start }
}

struct ChannelSales: Identifiable, Equatable {
  let channel: String
  let label: String
  var cents: Int
  var id: String { channel }
}

struct SalesReport: Equatable {
  var range: Int
  var current: OrderWindowFigures
  var previous: OrderWindowFigures
  /// Percent change against the window before, to one decimal; nil with no baseline or a capped read.
  var revenueDeltaPct: Double?
  var ordersDeltaPct: Double?
  var days: [SalesDay]
  var channels: [ChannelSales]
  var topProducts: [ProductSales]
  /// More orders than the ceiling: the figures are a floor.
  var capped: Bool

  var today: SalesDay? { days.last }
}

/// Whether the workspace's plan sells commerce analytics, and the plan that first includes it (what an upsell names).
struct SalesAccess: Equatable {
  var carried: Bool
  var plan: String?
}

func salesAccess(_ org: [String: Any]?) -> SalesAccess {
  SalesAccess(
    carried: planFeatureCarried(org, "commerceAnalytics"), plan: PlanFeatureDefaults.grantedFrom["commerceAnalytics"])
}

/// What a plan without analytics reads in place of the figures.
func salesLockedText(_ plan: String?) -> String {
  "Commerce analytics (revenue trend, orders, average order value, channel split and top products) is included from \(plan ?? "a higher plan"). "
    + "Every order is still being recorded, so the numbers are waiting the moment you upgrade."
}

private func deltaPct(_ current: Double, _ previous: Double) -> Double? {
  previous == 0 ? nil : (((current - previous) / previous) * 1000 + 0.5).rounded(.down) / 10
}

/// The last `range` local days (today included) against the `range` days before, with the console's own figures for
/// each (`orderWindowFigures`: sales only, tests and unpaid left out, what each order kept after refunds).
func salesReport(
  _ orders: [FigureOrder], range: Int, now: Date = Date(), calendar: Calendar = .current, capped: Bool = false
) -> SalesReport {
  let today = calendar.startOfDay(for: now)
  func day(_ offset: Int) -> Date {
    calendar.date(byAdding: .day, value: offset, to: today) ?? today.addingTimeInterval(Double(offset) * 86_400)
  }
  func ms(_ date: Date) -> Double { date.timeIntervalSince1970 * 1000 }
  let previousStart = day(-(2 * range - 1))
  let windowStart = day(-(range - 1))
  let tomorrow = day(1)
  let current = orderWindowFigures(orders, startMs: ms(windowStart), endMs: ms(tomorrow))
  let previous = orderWindowFigures(orders, startMs: ms(previousStart), endMs: ms(windowStart))
  let starts = (0..<range).map { day($0 - (range - 1)) }
  let days = starts.enumerated().map { index, start -> SalesDay in
    let end = index + 1 < starts.count ? starts[index + 1] : tomorrow
    let figures = orderWindowFigures(orders, startMs: ms(start), endMs: ms(end))
    return SalesDay(start: start, cents: figures.revenueCents, orders: figures.orders)
  }
  let inWindow = orders.filter {
    guard let at = $0.order.createdAtMs else { return false }
    return at >= ms(windowStart) && at < ms(tomorrow) && orderCountsAsSale($0)
  }
  var byChannel: [String: Int] = [:]
  for source in inWindow {
    let lifted = liftLegacyOrder(source.order)
    let channel = lifted.channel.map { $0.rawValue.isEmpty ? "online" : $0.rawValue } ?? "online"
    byChannel[channel, default: 0] += orderPaidCents(lifted)
  }
  let channels = byChannel
    .map { ChannelSales(channel: $0.key, label: orderChannelLabel($0.key), cents: $0.value) }
    .sorted { $0.cents != $1.cents ? $0.cents > $1.cents : $0.label < $1.label }
  return SalesReport(
    range: range, current: current, previous: previous,
    revenueDeltaPct: capped ? nil : deltaPct(Double(current.revenueCents), Double(previous.revenueCents)),
    ordersDeltaPct: capped ? nil : deltaPct(Double(current.orders), Double(previous.orders)),
    days: days, channels: channels, topProducts: Array(productSales(inWindow).prefix(5)), capped: capped)
}

/// Both windows of a `range`-day report, newest first, with a probe row past the ceiling.
func salesQuery(_ hostID: String, range: Int, now: Date = Date(), calendar: Calendar = .current) -> FirestoreQuery {
  let today = calendar.startOfDay(for: now)
  let start = calendar.date(byAdding: .day, value: -(2 * range - 1), to: today) ?? now
  return FirestoreQuery(
    ordersPath(hostID),
    filters: [
      ListQueryConstraint(path: "createdAtMs", op: .greaterThanOrEqual, value: (start.timeIntervalSince1970 * 1000).rounded())
    ],
    order: [.init("createdAtMs", descending: true)], limit: salesWindowCeiling + 1)
}

/// Units sold as a person reads them: `3`, or `1.5` for a product sold by weight.
func salesUnitsText(_ units: Double) -> String {
  units.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(units)) : String(units)
}

func salesChange(_ pct: Double?) -> String? {
  pct.map { (($0 > 0 ? "+" : "") + String(format: "%g", $0)) + "% vs the period before" }
}

@MainActor
@Observable
final class SalesModel {
  private(set) var report: SalesReport?
  private(set) var access: SalesAccess?
  private(set) var failed = false
  @ObservationIgnored private var orders: FirestoreListening?
  @ObservationIgnored private var plan: FirestoreListening?

  /// Reads the plan first, and the orders only while it carries analytics.
  func start(_ reader: FirestoreReader, hostID: String?, orgID: String?, range: Int) {
    stop()
    report = nil
    access = nil
    failed = false
    guard let hostID, let orgID else { return }
    plan = reader.listenDocument(["orgs", orgID]) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let doc):
        let next = salesAccess(doc?.data)
        self.access = next
        if next.carried {
          if self.orders == nil { self.listenToOrders(reader, hostID: hostID, range: range) }
        } else {
          self.orders?.remove()
          self.orders = nil
          self.report = nil
        }
      case .failure:
        self.failed = true
      }
    }
  }

  private func listenToOrders(_ reader: FirestoreReader, hostID: String, range: Int) {
    orders = reader.listen(salesQuery(hostID, range: range)) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.report = salesReport(
          docs.prefix(salesWindowCeiling).map {
            FigureOrder(id: $0.id, livemode: $0.bool("livemode"), order: decodeOrder($0))
          }, range: range, capped: docs.count > salesWindowCeiling)
      case .failure:
        self.failed = true
      }
    }
  }

  func stop() {
    orders?.remove()
    orders = nil
    plan?.remove()
    plan = nil
  }
}

/// The days' sales as bars, one a day.
struct SalesChart: View {
  let days: [SalesDay]

  var body: some View {
    let long = days.count > 7
    Chart(days) { day in
      BarMark(x: .value("Day", day.start, unit: .day), y: .value("Sales", Double(day.cents) / 100))
        .foregroundStyle(AglynColor.primary)
        .cornerRadius(4)
    }
    .chartXAxis {
      AxisMarks(values: .stride(by: .day, count: long ? 5 : 1)) { _ in
        AxisValueLabel(format: long ? .dateTime.month(.abbreviated).day() : .dateTime.weekday(.narrow))
      }
    }
    .chartYAxis { AxisMarks { _ in AxisGridLine(); AxisValueLabel() } }
    .accessibilityLabel("Sales for the last \(days.count) days")
  }
}

/// Sales: the last 7 or 30 days against the window before, by day, by channel, and the best sellers.
struct SalesScreen: View {
  let context: NativePluginContext
  @State private var model = SalesModel()
  @State private var range = 7

  var body: some View {
    Group {
      if model.failed {
        AglynEmptyState("Could not load sales", systemImage: "exclamationmark.triangle")
      } else if let access = model.access, !access.carried {
        // The console's sentence as the upgrade notice, with View plans (Figma Notice/Upgrade).
        AglynUpgradeNotice(salesLockedText(access.plan), kind: .plan) { context.navigate("core.billing.plans") }
        .asScreen()
      } else if let report = model.report {
        Form {
          Section {
            Picker("Range", selection: $range) {
              Text("Last 7 days").tag(7)
              Text("Last 30 days").tag(30)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
          }
          if report.capped {
            Section {
              AglynNotice(
                "This store had more than \(salesWindowCeiling) orders in the period; the oldest are left out, so there is no comparison.",
                tone: .warning)
            }
          }
          Section {
            AglynCardGrid(minimum: 150, maxColumns: 3) {
              MetricCard(
                "Revenue", systemImage: "dollarsign.circle", value: formatOrderMoney(report.current.revenueCents),
                caption: salesChange(report.revenueDeltaPct) ?? ordersCaption(report.current.orders))
              MetricCard(
                "Orders", systemImage: "bag", value: "\(report.current.orders)",
                caption: salesChange(report.ordersDeltaPct) ?? "")
              MetricCard(
                "Average order", systemImage: "chart.line.uptrend.xyaxis",
                value: formatOrderMoney(report.current.averageCents), caption: "")
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
          }
          Section("By day") {
            SalesChart(days: report.days).frame(height: 180)
            ForEach(report.days.reversed()) { day in
              AglynAmountRow(
                day.start.formatted(.dateTime.weekday(.wide).month().day()), amount: formatOrderMoney(day.cents))
            }
          }
          Section("By channel") {
            if report.channels.isEmpty {
              Text("No sales in this period.").foregroundStyle(.secondary)
            }
            ForEach(report.channels) { AglynAmountRow($0.label, amount: formatOrderMoney($0.cents)) }
          }
          Section("Best sellers") {
            if report.topProducts.isEmpty {
              Text("No sales in this period.").foregroundStyle(.secondary)
            }
            ForEach(report.topProducts, id: \.productID) { product in
              AglynAmountRow(
                "\(product.name) \u{00B7} \(salesUnitsText(product.units)) sold", amount: formatOrderMoney(Int(product.cents)))
            }
          }
          Section {
            Button("All orders") { context.navigate(commerceOrdersScreen) }
          }
        }
        .formStyle(.aglynGrouped)
      } else {
        List { SkeletonRows(count: 4) }.aglynListBackground()
      }
    }
    .navigationTitle("Sales")
    .aglynScreenTitle("Sales")
    .task(id: "\(context.hostID ?? "")|\(range)") {
      model.start(context.firestore, hostID: context.hostID, orgID: context.orgID, range: range)
    }
    .onDisappear { model.stop() }
  }
}

func ordersCaption(_ count: Int) -> String { count == 1 ? "1 paid order" : "\(count) paid orders" }

/// Home's "Today" card.
struct SalesTodayWidget: View {
  let context: NativePluginContext
  @State private var model = SalesModel()

  var body: some View {
    let locked = model.access.map { !$0.carried } ?? false
    MetricCard(
      "Sales today", systemImage: "dollarsign.circle",
      value: locked ? "\u{2014}" : model.report.map { formatOrderMoney($0.today?.cents ?? 0) },
      caption: locked
        ? "Included from \(model.access?.plan ?? "a higher plan")"
        : model.report.map { ordersCaption($0.today?.orders ?? 0) } ?? "Loading",
      actionLabel: "Open sales", failed: model.failed ? "Could not load sales." : nil
    ) {
      context.navigate(commerceSalesScreen)
    }
    .task(id: context.hostID) { model.start(context.firestore, hostID: context.hostID, orgID: context.orgID, range: 7) }
    .onDisappear { model.stop() }
  }
}

/// Home's "Last 7 days" card, with its bars.
struct SalesTrendWidget: View {
  let context: NativePluginContext
  @State private var model = SalesModel()

  var body: some View {
    AglynCard("Last 7 days", systemImage: "chart.bar") {
      if let access = model.access, !access.carried {
        Text("Included from \(access.plan ?? "a higher plan").").foregroundStyle(.secondary)
      } else if let report = model.report {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          Text(formatOrderMoney(report.current.revenueCents)).font(AglynFont.figure).monospacedDigit()
          SalesChart(days: report.days).frame(height: 120)
        }
      } else if model.failed {
        Text("Could not load sales.").foregroundStyle(.secondary)
      } else {
        ProgressView().frame(maxWidth: .infinity, minHeight: 120)
      }
    } accessory: {
      Button("Sales") { context.navigate(commerceSalesScreen) }.buttonStyle(.borderless)
    }
    .task(id: context.hostID) { model.start(context.firestore, hostID: context.hostID, orgID: context.orgID, range: 7) }
    .onDisappear { model.stop() }
  }
}
