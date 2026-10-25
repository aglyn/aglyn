// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * DAY TOTALS (AGL-4037): every register, shift and cashier of one site over a
 * day or an event, from `GET /api/commerce/pos-day-report`. The console's
 * day-report card, on the device: Aglyn POS opens it from the register sheet,
 * and the Aglyn app from Orders. The figures are the server's (the same
 * calculator as the X and Z reports); the device only reads, lays out and
 * exports them. The Kotlin kit's `PosDayReport.kt`.
 */

/// The day report route, as the signed-in member.
protocol PosDayReportAPI: Sendable {
  /// `from`/`to` are `yyyy-MM-dd`; nil asks for today in the store's own time zone.
  func report(from: String?, to: String?) async throws -> PosDayReport
}

struct ConsolePosDayReportAPI: PosDayReportAPI {
  let api: ConsoleAPIClient
  let hostID: String

  func report(from: String?, to: String?) async throws -> PosDayReport {
    let answer = try await api.request(
      ContractValues.shared.posDayReportRoute, query: [("hostId", hostID), ("from", from), ("to", to)])
    guard let data = try answer?["report"]?.encoded(), let report = try? JSONDecoder().decode(PosDayReport.self, from: data)
    else { throw ConsoleAPIError(status: 502, message: "The day totals could not be read.") }
    return report
  }
}

/// One row of the report as the screen, and the printed report, read it.
struct PosDayRow: Equatable, Identifiable {
  let label: String
  let value: String
  var strong = false
  var id: String { label }
}

struct PosDaySection: Equatable, Identifiable {
  let title: String
  let rows: [PosDayRow]
  var id: String { title }
}

/// The report's rows as the console lays them out (`posDayReportSections`).
func posDayReportSections(_ report: PosDayReport, money: (Int) -> String) -> [PosDaySection] {
  let t = report.totals
  let c = report.cash
  func m(_ cents: Double) -> String { money(Int(cents)) }
  var sections = [
    PosDaySection(
      title: "Sales",
      rows: [
        PosDayRow(label: "Orders", value: String(Int(t.orderCount))),
        PosDayRow(label: "Gross sales", value: m(t.grossSalesCents)),
        PosDayRow(label: "Discounts", value: m(t.discountsCents)),
        PosDayRow(label: "Tax", value: m(t.taxCents)),
        PosDayRow(label: "Tips", value: m(t.tipsCents)),
        PosDayRow(label: "Refunds (\(Int(t.refundCount)))", value: m(-t.refundsCents)),
        PosDayRow(label: "Net sales", value: m(t.netSalesCents), strong: true),
      ]),
    PosDaySection(
      title: "By tender",
      rows: report.byTender.isEmpty
        ? [PosDayRow(label: "No sales", value: "")]
        : report.byTender.map { PosDayRow(label: $0.label, value: m($0.netCents)) }),
  ]
  if !report.byRegister.isEmpty {
    sections.append(
      PosDaySection(title: "By register", rows: report.byRegister.map { PosDayRow(label: $0.name, value: m($0.netSalesCents)) }))
  }
  if !report.byCashier.isEmpty {
    sections.append(
      PosDaySection(title: "By cashier", rows: report.byCashier.map { PosDayRow(label: $0.name, value: m($0.netSalesCents)) }))
  }
  var drawers = [
    PosDayRow(label: "Starting cash", value: m(c.openingFloatCents)),
    PosDayRow(label: "Cash sales", value: m(c.cashSalesCents)),
    PosDayRow(label: "Paid in", value: m(c.paidInCents)),
    PosDayRow(label: "Paid out", value: m(-c.paidOutCents)),
    PosDayRow(label: "Safe drops", value: m(-c.dropsCents)),
    PosDayRow(label: "Cash refunds", value: m(-c.cashRefundsCents)),
    PosDayRow(label: "Expected (\(Int(c.closedShiftCount)) closed)", value: m(c.expectedCashCents)),
    PosDayRow(label: "Counted", value: m(c.countedCashCents)),
    PosDayRow(
      label: c.varianceCents < 0 ? "Short" : c.varianceCents > 0 ? "Over" : "Balanced", value: m(c.varianceCents), strong: true),
  ]
  if c.openShiftCount > 0 {
    drawers.append(PosDayRow(label: "Still open (\(Int(c.openShiftCount)))", value: m(c.openExpectedCashCents)))
  }
  sections.append(PosDaySection(title: "Cash drawers", rows: drawers))
  return sections
}

/// The device's own sales the report cannot include yet: rung offline and not synced (AGL-4039).
struct PosDayNotSynced: Equatable {
  let cashCount: Int
  let cashCents: Int
  let cardCount: Int
  let cardCents: Int

  var isEmpty: Bool { cashCount == 0 && cardCount == 0 }

  init(_ queue: [PosOfflineQueued]) {
    let cards = queue.filter(\.isCard)
    let cash = queue.filter { !$0.isCard }
    cashCount = cash.count
    cashCents = cash.reduce(0) { $0 + $1.totalCents }
    cardCount = cards.count
    cardCents = cards.reduce(0) { $0 + $1.totalCents }
  }
}

/// `yyyy-MM-dd` for a picked date, on the device's calendar (the picker's own day).
func posDayKey(_ date: Date, calendar: Calendar = .current) -> String {
  let parts = calendar.dateComponents([.year, .month, .day], from: date)
  return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
}

@MainActor
@Observable
final class PosDayReportModel {
  /// The days asked for; nil is today in the store's own time zone.
  private(set) var range: (from: String, to: String)?
  private(set) var state: Load<PosDayReport> = .loading

  @ObservationIgnored private let api: PosDayReportAPI
  @ObservationIgnored private var generation = 0

  init(api: PosDayReportAPI) { self.api = api }

  /// The days, as the range picker words them (the report's own once it has answered).
  var label: String {
    if let report = state.value { return posDayRangeLabel(from: report.from, to: report.to) }
    guard let range else { return "Today" }
    return posDayRangeLabel(from: range.from, to: range.to)
  }

  func today() async {
    range = nil
    await load()
  }

  /// Picks days; a range given backwards is read forwards, and the server bounds it to a month.
  func pick(from: Date, to: Date) async {
    let start = posDayKey(min(from, to))
    let end = posDayKey(max(from, to))
    range = (start, end)
    await load()
  }

  func load() async {
    generation += 1
    let mine = generation
    state = .loading
    do {
      let report = try await api.report(from: range?.from, to: range?.to)
      if mine == generation { state = .ready(report) }
    } catch {
      if mine == generation {
        let status = (error as? ConsoleAPIError)?.status ?? 0
        state = .failed(
          status == 0
            ? "The day totals could not be read. Check the connection."
            : (error as? ConsoleAPIError)?.message ?? "The day totals could not be read.")
      }
    }
  }

  /// The report as a spreadsheet file to share, named for its days.
  func csvFile() -> URL? {
    guard let report = state.value else { return nil }
    let name = "day-totals-\(report.from)\(report.from == report.to ? "" : "-to-\(report.to)").csv"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
    do {
      try Data(posDayReportCsv(report).utf8).write(to: url, options: .atomic)
      return url
    } catch {
      return nil
    }
  }
}
