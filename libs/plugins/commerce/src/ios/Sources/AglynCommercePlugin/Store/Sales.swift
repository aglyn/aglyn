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
 * SALES AT A GLANCE: today and the last seven days.
 *
 * The orders since the start of the seventh day back, newest first (the
 * orders page's own `createdAtMs` order, so its index serves it), up to a
 * ceiling; an order counts once it is paid and counts what it kept
 * (`orderNetCents`, refunds out). Days are the device's local days.
 */

let salesWindowCeiling = 500

struct SalesDay: Identifiable, Hashable {
  let start: Date
  var cents: Int
  var orders: Int
  var id: Date { start }
}

struct SalesSummary: Equatable {
  var days: [SalesDay]
  /// More orders than the ceiling: the figures are a floor.
  var capped: Bool

  var today: SalesDay? { days.last }
  var weekCents: Int { days.reduce(0) { $0 + $1.cents } }
  var weekOrders: Int { days.reduce(0) { $0 + $1.orders } }
}

private let countedStatuses: Set<OrderStatus> = [.paid, .partiallyFulfilled, .fulfilled, .delivered, .refunded]

/// Seven local days ending today, each with what its paid orders kept.
func summarizeSales(_ orders: [HostOrder], now: Date = Date(), calendar: Calendar = .current, capped: Bool = false)
  -> SalesSummary
{
  let today = calendar.startOfDay(for: now)
  var days = (0..<7).reversed().compactMap { back in
    calendar.date(byAdding: .day, value: -back, to: today).map { SalesDay(start: $0, cents: 0, orders: 0) }
  }
  for order in orders {
    guard let status = order.status, countedStatuses.contains(status), let ms = order.createdAtMs else { continue }
    let day = calendar.startOfDay(for: Date(timeIntervalSince1970: ms / 1000))
    guard let index = days.firstIndex(where: { $0.start == day }) else { continue }
    days[index].cents += orderNetCents(order)
    days[index].orders += 1
  }
  return SalesSummary(days: days, capped: capped)
}

func salesQuery(_ hostID: String, now: Date = Date(), calendar: Calendar = .current) -> FirestoreQuery {
  let start = calendar.date(byAdding: .day, value: -6, to: calendar.startOfDay(for: now)) ?? now
  return FirestoreQuery(
    ordersPath(hostID),
    filters: [
      ListQueryConstraint(path: "createdAtMs", op: .greaterThanOrEqual, value: (start.timeIntervalSince1970 * 1000).rounded())
    ],
    order: [.init("createdAtMs", descending: true)], limit: salesWindowCeiling + 1)
}

@MainActor
@Observable
final class SalesModel {
  private(set) var summary: SalesSummary?
  private(set) var failed = false
  @ObservationIgnored private var listener: FirestoreListening?

  func start(_ reader: FirestoreReader, hostID: String?) {
    listener?.remove()
    summary = nil
    failed = false
    guard let hostID else { return }
    listener = reader.listen(salesQuery(hostID)) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.summary = summarizeSales(
          docs.prefix(salesWindowCeiling).map(decodeOrder), capped: docs.count > salesWindowCeiling)
      case .failure:
        self.failed = true
      }
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }
}

/// The week's sales as bars, one a day.
struct SalesChart: View {
  let days: [SalesDay]

  var body: some View {
    Chart(days) { day in
      BarMark(x: .value("Day", day.start, unit: .day), y: .value("Sales", Double(day.cents) / 100))
        .foregroundStyle(AglynColor.primary)
        .cornerRadius(4)
    }
    .chartXAxis {
      AxisMarks(values: .stride(by: .day)) { _ in AxisValueLabel(format: .dateTime.weekday(.narrow)) }
    }
    .chartYAxis { AxisMarks { _ in AxisGridLine(); AxisValueLabel() } }
    .accessibilityLabel("Sales for the last seven days")
  }
}

/// Sales: today, the week, and each day.
struct SalesScreen: View {
  let context: NativePluginContext
  @State private var model = SalesModel()

  var body: some View {
    Group {
      if model.failed {
        AglynEmptyState("Could not load sales", systemImage: "exclamationmark.triangle")
      } else if let summary = model.summary {
        Form {
          Section {
            AglynCardGrid(minimum: 150, maxColumns: 3) {
              MetricCard(
                "Today", systemImage: "sun.max", value: formatOrderMoney(summary.today?.cents ?? 0),
                caption: ordersCaption(summary.today?.orders ?? 0))
              MetricCard(
                "Last 7 days", systemImage: "calendar", value: formatOrderMoney(summary.weekCents),
                caption: ordersCaption(summary.weekOrders))
            }
            .listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
          }
          Section("By day") {
            SalesChart(days: summary.days).frame(height: 180)
            ForEach(summary.days.reversed()) { day in
              AglynAmountRow(
                day.start.formatted(.dateTime.weekday(.wide).month().day()), amount: formatOrderMoney(day.cents))
            }
          }
          if summary.capped {
            Section { AglynNotice("More orders than this screen reads at once: these figures are a floor.", tone: .info) }
          }
          Section {
            Button("All orders") { context.navigate(commerceOrdersScreen) }
          }
        }
        .formStyle(.grouped)
        .aglynListBackground()
      } else {
        List { SkeletonRows(count: 4) }.aglynListBackground()
      }
    }
    .navigationTitle("Sales")
    .task(id: context.hostID) { model.start(context.firestore, hostID: context.hostID) }
    .onDisappear { model.stop() }
  }
}

func ordersCaption(_ count: Int) -> String { count == 1 ? "1 paid order" : "\(count) paid orders" }

/// Home's "Today" card.
struct SalesTodayWidget: View {
  let context: NativePluginContext
  @State private var model = SalesModel()

  var body: some View {
    MetricCard(
      "Sales today", systemImage: "dollarsign.circle",
      value: model.summary.map { formatOrderMoney($0.today?.cents ?? 0) },
      caption: model.summary.map { ordersCaption($0.today?.orders ?? 0) } ?? "Loading",
      actionLabel: "Open sales", failed: model.failed ? "Could not load sales." : nil
    ) {
      context.navigate(commerceSalesScreen)
    }
    .task(id: context.hostID) { model.start(context.firestore, hostID: context.hostID) }
    .onDisappear { model.stop() }
  }
}

/// Home's "Last 7 days" card, with its bars.
struct SalesTrendWidget: View {
  let context: NativePluginContext
  @State private var model = SalesModel()

  var body: some View {
    AglynCard("Last 7 days", systemImage: "chart.bar") {
      if let summary = model.summary {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          Text(formatOrderMoney(summary.weekCents)).font(AglynFont.figure).monospacedDigit()
          SalesChart(days: summary.days).frame(height: 120)
        }
      } else if model.failed {
        Text("Could not load sales.").foregroundStyle(.secondary)
      } else {
        ProgressView().frame(maxWidth: .infinity, minHeight: 120)
      }
    } accessory: {
      Button("Sales") { context.navigate(commerceSalesScreen) }.buttonStyle(.borderless)
    }
    .task(id: context.hostID) { model.start(context.firestore, hostID: context.hostID) }
    .onDisappear { model.stop() }
  }
}
