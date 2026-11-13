// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/*
 * DAY TOTALS (AGL-4037), as a pushed screen: the console's day-report card at
 * a touch size. A day (today by default) or a run of days up to a month; the
 * sales, tenders, registers, cashiers, drawers and shifts; the report as a
 * spreadsheet through the share sheet; and, on a register, the sales this
 * device rang offline that the report cannot include until they sync.
 */
struct PosDayTotalsView: View {
  let model: PosDayReportModel
  let currency: String
  /// This register's own unsynced sales (Aglyn POS); nil in the Aglyn app.
  var notSynced: PosDayNotSynced?
  /// The Aglyn app's Orders head (Figma 341:13731 on the iPad, 343:43796 on a phone): the report's own title, and the
  /// line under it naming the site, every register and the days. Nil on the register, whose screen is Day totals.
  var head: PosDayReportHead?
  @Environment(\.aglynWideChrome) private var wide
  @State private var from = Date()
  @State private var to = Date()
  /// Today resets the pickers to the device's date; that is not a pick, or it would replace the store's own today
  /// (and its "Today, …" heading) with a plain range.
  @State private var resettingToToday = false

  private func money(_ cents: Int) -> String { posMoney(cents, currency: model.state.value?.currency ?? currency) }

  /// Orders' detail column on the Mac and iPad: Figma's plain column, under the report's head.
  private var plainColumn: Bool { head != nil && wide }

  private var byline: String { posDayReportByline(site: head?.site, days: model.label) }

  var body: some View {
    container
      .navigationTitle(head?.title ?? "Day totals")
      .toolbar {
        // In the plain column the head carries Share CSV.
        if !plainColumn {
          ToolbarItem(placement: .primaryAction) {
            if let file = model.csvFile() {
              // Over the register sheet it sits in (a ShareLink asked the register, which was already presenting it).
              AglynShareButton(url: file) { Label("Share CSV", systemImage: "square.and.arrow.up") }
                .accessibilityIdentifier("day-totals-share")
            }
          }
        }
      }
      .task { if case .loading = model.state { await model.load() } }
      .refreshable { await model.load() }
      .accessibilityIdentifier("day-totals")
  }

  @ViewBuilder
  private var container: some View {
    if head != nil {
      AglynRecordForm {
        if plainColumn, let head {
          Section {
            AglynRecordHeader(
              head.title, subtitle: byline, systemImage: "chart.bar.doc.horizontal",
              primary: model.csvFile().map {
                AglynRecordAction("day-totals-share", "Share CSV", systemImage: "square.and.arrow.up", share: $0)
              })
          }
        }
        sections
      }
    } else {
      Form { sections }.formStyle(.grouped)
    }
  }

  @ViewBuilder
  private var sections: some View {
    Section {
      DatePicker("From", selection: $from, displayedComponents: .date)
        .accessibilityIdentifier("day-totals-from")
      DatePicker("To", selection: $to, in: from..., displayedComponents: .date)
        .accessibilityIdentifier("day-totals-to")
      Button("Today") {
        resettingToToday = true
        from = Date()
        to = Date()
        Task {
          await model.today()
          resettingToToday = false
        }
      }
      .accessibilityIdentifier("day-totals-today")
    } header: {
      // The register heads the days with their date; Orders' phone screen with its line (whose site, every register,
      // which days); the plain column's head already says it.
      if !plainColumn {
        Text(head == nil ? model.label : byline).textCase(nil).accessibilityIdentifier("day-totals-days")
      }
    }
    .onChange(of: from) { _, _ in if !resettingToToday { Task { await model.pick(from: from, to: to) } } }
    .onChange(of: to) { _, _ in if !resettingToToday { Task { await model.pick(from: from, to: to) } } }

    if let notSynced, !notSynced.isEmpty {
      Section {
        if notSynced.cashCount > 0 {
          AglynAmountRow("Cash (\(notSynced.cashCount))", amount: money(notSynced.cashCents))
        }
        if notSynced.cardCount > 0 {
          AglynAmountRow("Cards to charge (\(notSynced.cardCount))", amount: money(notSynced.cardCents))
        }
      } header: {
        Text("On this register, not synced yet")
      } footer: {
        Text("Added to the totals when the register is back online.")
      }
      .accessibilityIdentifier("day-totals-not-synced")
    }

    switch model.state {
    case .loading:
      Section {
        HStack(spacing: AglynSpace.one) {
          ProgressView()
          Text("Adding up every register…").foregroundStyle(.secondary)
        }
      }
    case .failed(let message):
      Section { AglynNotice(message, tone: .error) }
    case .ready(let report):
      if report.truncated == true {
        Section {
          AglynNotice(
            "These days had more activity than one report reads; the figures are partial. Choose fewer days.", tone: .warning)
        }
      }
      if posDayReportIsEmpty(report) {
        Section { Text("No register sales, returns or shifts on these days.").foregroundStyle(.secondary) }
          .accessibilityIdentifier("day-totals-empty")
      } else {
        ForEach(posDayReportSections(report, money: money)) { section in
          titled(section.title) {
            ForEach(section.rows) { row in
              AglynAmountRow(row.label, amount: row.value, emphasized: row.strong)
                // Figma 341:13731: a total sits under a hairline in the plain column.
                .overlay(alignment: .top) { if plainColumn && row.strong { AglynHairline() } }
            }
          }
        }
        if !report.shifts.isEmpty {
          titled("Shifts") {
            ForEach(report.shifts, id: \.shiftId) { shift in PosDayShiftRowView(shift: shift, money: money) }
          }
        }
      }
    }
  }

  /// A section under its title: the plain column's prominent title row (Figma 341:13731), a grouped form's header.
  @ViewBuilder
  private func titled<Rows: View>(_ title: String, @ViewBuilder rows: () -> Rows) -> some View {
    if plainColumn {
      Section {
        AglynRecordSectionTitle(title)
        rows()
      }
    } else {
      Section(title) { rows() }
    }
  }
}

/// A day report's own head in the Aglyn app's Orders: its title, and the site it adds up.
struct PosDayReportHead: Equatable {
  let title: String
  let site: String?
}

/// One shift in the range: its register and times, net sales, and the drawer's variance once counted.
private struct PosDayShiftRowView: View {
  let shift: PosDayShiftRow
  let money: (Int) -> String

  private func when(_ ms: Double?) -> String {
    guard let ms, ms > 0 else { return "—" }
    return Date(timeIntervalSince1970: ms / 1000).formatted(date: .abbreviated, time: .shortened)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      HStack {
        Text(shift.registerName).font(AglynFont.body.weight(.medium))
        Spacer()
        Text(money(Int(shift.netSalesCents))).font(AglynFont.body.monospacedDigit())
      }
      HStack(spacing: AglynSpace.one) {
        Text("\(when(shift.openedAtMs)) – \(shift.status == .open ? "Open" : when(shift.closedAtMs))")
          .font(AglynFont.caption).foregroundStyle(.secondary)
        Spacer()
        if let variance = shift.varianceCents {
          StatusChip(money(Int(variance)), tone: variance == 0 ? .success : .warning)
        } else if shift.status == .open {
          StatusChip("Open", tone: .success)
        }
      }
    }
    .accessibilityElement(children: .combine)
  }
}
