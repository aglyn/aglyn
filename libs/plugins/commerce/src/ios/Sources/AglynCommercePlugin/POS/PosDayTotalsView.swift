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
  @State private var from = Date()
  @State private var to = Date()

  private func money(_ cents: Int) -> String { posMoney(cents, currency: model.state.value?.currency ?? currency) }

  var body: some View {
    Form {
      Section {
        DatePicker("From", selection: $from, displayedComponents: .date)
          .accessibilityIdentifier("day-totals-from")
        DatePicker("To", selection: $to, in: from..., displayedComponents: .date)
          .accessibilityIdentifier("day-totals-to")
        Button("Today") {
          from = Date()
          to = Date()
          Task { await model.today() }
        }
        .accessibilityIdentifier("day-totals-today")
      } header: {
        Text(model.label)
      }
      .onChange(of: from) { _, _ in Task { await model.pick(from: from, to: to) } }
      .onChange(of: to) { _, _ in Task { await model.pick(from: from, to: to) } }

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
            Section(section.title) {
              ForEach(section.rows) { row in AglynAmountRow(row.label, amount: row.value, emphasized: row.strong) }
            }
          }
          if !report.shifts.isEmpty {
            Section("Shifts") {
              ForEach(report.shifts, id: \.shiftId) { shift in PosDayShiftRowView(shift: shift, money: money) }
            }
          }
        }
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Day totals")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        if let file = model.csvFile() {
          ShareLink(item: file) { Label("Share CSV", systemImage: "square.and.arrow.up") }
            .accessibilityIdentifier("day-totals-share")
        }
      }
    }
    .task { if case .loading = model.state { await model.load() } }
    .refreshable { await model.load() }
    .accessibilityIdentifier("day-totals")
  }
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
