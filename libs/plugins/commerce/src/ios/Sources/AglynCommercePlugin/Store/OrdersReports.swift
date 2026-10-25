// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import Observation
import SwiftUI

/*
 * THE REGISTER'S REPORTS IN ORDERS (AGL-4062): the console's Day report and
 * Shift history cards, for a store with registers. Two rows head the orders
 * list (Figma Native App 341:13731, 341:43261): Day report opens the day's
 * totals over every register (the register's own Day totals screen), and
 * Shift history lists a register's shifts, newest first, each opening its
 * frozen Z report (341:43824), with the history as a spreadsheet. The Kotlin
 * kit's `OrdersReports.kt`.
 */

/// The list row ids the two reports take beside the orders' own.
let ordersDayReportRowID = "report.day"
let ordersShiftHistoryRowID = "report.shifts"

/// The site's registers, for whether the reports show at all and for Shift history's register picker.
@MainActor
@Observable
final class OrdersRegisters {
  private(set) var registers: [PosRegister] = []
  /// The store's currency, as its site document names it (the register reads it the same way).
  private(set) var currency = "usd"
  @ObservationIgnored private var listening: [FirestoreListening] = []

  func start(_ reader: FirestoreReader, hostID: String?) {
    stop()
    guard let hostID else { return }
    listening.append(
      reader.listen(registersQuery(hostID)) { [weak self] result in
        self?.registers = sortRegisters((try? result.get())?.map(posRegister) ?? [])
      })
    listening.append(
      reader.listenDocument(["hosts", hostID]) { [weak self] result in
        if case .success(let doc?) = result, let stored = doc.string("currency"), !stored.isEmpty { self?.currency = stored.lowercased() }
      })
  }

  func stop() {
    listening.forEach { $0.remove() }
    listening = []
  }
}

/// One report row heading the orders list.
struct OrdersReportRow: View {
  let title: String
  let detail: String
  let systemImage: String

  var body: some View {
    AglynRow(title, subtitle: detail, systemImage: systemImage)
      .accessibilityElement(children: .combine)
  }
}

/// Day report: every register's day, as the register's own Day totals screen shows it.
struct OrdersDayReportView: View {
  @State private var model: PosDayReportModel
  let currency: String

  init(context: NativePluginContext, currency: String) {
    _model = State(initialValue: PosDayReportModel(api: ConsolePosDayReportAPI(api: context.api, hostID: context.hostID ?? "")))
    self.currency = currency
  }

  var body: some View { PosDayTotalsView(model: model, currency: currency, notSynced: nil) }
}

/// The newest shifts one register reads at a time, as the console's history card pages them.
let shiftHistoryWindow = 50

/// One register's shifts, newest first, from `hosts/{host}/registers/{register}/shifts`.
@MainActor
@Observable
final class ShiftHistoryModel {
  private(set) var registerID: String?
  private(set) var state: Load<[PosShiftCsvRow]> = .loading
  @ObservationIgnored private var listening: FirestoreListening?

  func show(_ reader: FirestoreReader, hostID: String?, register: PosRegister?) {
    listening?.remove()
    listening = nil
    registerID = register?.id
    guard let hostID, let register else {
      state = .ready([])
      return
    }
    state = .loading
    let query = FirestoreQuery(
      ["hosts", hostID, "registers", register.id, "shifts"], order: [.init("openedAtMs", descending: true)],
      limit: shiftHistoryWindow)
    listening = reader.listen(query) { [weak self] result in
      switch result {
      case .failure: self?.state = .failed("The shifts could not be read. Check the connection and try again.")
      case .success(let docs):
        self?.state = .ready(docs.compactMap { shiftRow($0, registerName: register.name) })
      }
    }
  }

  func stop() {
    listening?.remove()
    listening = nil
  }

  /// The history as a spreadsheet to share, named for its register; nil until it has loaded.
  func csvFile(registerName: String) -> URL? {
    guard let rows = state.value, !rows.isEmpty else { return nil }
    let slug = registerName.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("shifts-\(slug).csv")
    do {
      try Data(posShiftsCsv(rows).utf8).write(to: url, options: .atomic)
      return url
    } catch {
      return nil
    }
  }
}

/// A shift document as the history reads it; nil for one that does not decode.
func shiftRow(_ doc: FirestoreDocument, registerName: String) -> PosShiftCsvRow? {
  guard JSONSerialization.isValidJSONObject(doc.data),
    let data = try? JSONSerialization.data(withJSONObject: doc.data),
    let shift = try? JSONDecoder().decode(PosShift.self, from: data)
  else { return nil }
  return PosShiftCsvRow(id: doc.id, registerName: registerName, shift: shift)
}

/// Shift history: pick a register, read its shifts, open one's Z report, share them all as a spreadsheet.
struct ShiftHistoryView: View {
  let context: NativePluginContext
  let registers: [PosRegister]
  let currency: String
  @State private var model = ShiftHistoryModel()
  @State private var registerID: String?

  private var register: PosRegister? { registers.first { $0.id == registerID } ?? registers.first }
  private func money(_ cents: Double?) -> String { cents.map { posMoney(Int($0), currency: currency) } ?? "—" }

  var body: some View {
    Form {
      if registers.count > 1 {
        Section {
          Picker("Register", selection: Binding(get: { register?.id }, set: { registerID = $0 })) {
            ForEach(registers) { Text($0.name).tag(Optional($0.id)) }
          }
          .accessibilityIdentifier("shift-history-register")
        }
      }
      switch model.state {
      case .loading:
        Section { SkeletonRows(count: 4) }
      case .failed(let message):
        Section { AglynNotice(message, tone: .error) }
      case .ready(let rows) where rows.isEmpty:
        Section { Text("No shifts on this register yet.").foregroundStyle(.secondary) }
          .accessibilityIdentifier("shift-history-empty")
      case .ready(let rows):
        Section("Shifts") {
          ForEach(rows, id: \.id) { row in
            AglynPushLink {
              ShiftZReportView(row: row, currency: currency)
            } label: {
              ShiftHistoryRowView(row: row, money: money)
            }
            .accessibilityIdentifier("shift-\(row.id)")
          }
        }
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Shift history")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        if let name = register?.name, let file = model.csvFile(registerName: name) {
          ShareLink(item: file) { Label("Share CSV", systemImage: "square.and.arrow.up") }
            .accessibilityIdentifier("shift-history-share")
        }
      }
    }
    .task(id: register?.id) { model.show(context.firestore, hostID: context.hostID, register: register) }
    .onDisappear { model.stop() }
    .accessibilityIdentifier("shift-history")
  }
}

/// One shift: who opened it and when, until when, its net sales and the drawer's variance once counted.
private struct ShiftHistoryRowView: View {
  let row: PosShiftCsvRow
  let money: (Double?) -> String

  private func when(_ ms: Double?) -> String {
    guard let ms, ms > 0 else { return "—" }
    return Date(timeIntervalSince1970: ms / 1000).formatted(date: .abbreviated, time: .shortened)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      HStack {
        Text(row.shift.openedByName ?? "Shift").font(AglynFont.body.weight(.medium))
        Spacer()
        Text(money(row.shift.netSalesCents ?? row.shift.report?.netSalesCents)).font(AglynFont.body.monospacedDigit())
      }
      HStack(spacing: AglynSpace.one) {
        Text("\(when(row.shift.openedAtMs)) – \(row.shift.status == .open ? "Open" : when(row.shift.closedAtMs))")
          .font(AglynFont.caption).foregroundStyle(.secondary)
        Spacer()
        if let variance = row.shift.varianceCents {
          StatusChip(variance == 0 ? "Balanced" : "\(variance < 0 ? "Short" : "Over") \(money(abs(variance)))", tone: variance == 0 ? .success : .warning)
        } else if row.shift.status == .open {
          StatusChip("Open", tone: .success)
        }
      }
    }
  }
}

/// A closed shift's Z report, frozen when it closed; an open shift has none yet.
struct ShiftZReportView: View {
  let row: PosShiftCsvRow
  let currency: String

  var body: some View {
    Form {
      Section {
        if let report = row.shift.report {
          ShiftReportView(report: report, shift: row.shift, currency: currency)
        } else {
          Text("This shift is still open. Its Z report is made when it closes; the register's X report shows it so far.")
            .foregroundStyle(.secondary)
        }
      } header: {
        Text("\(row.registerName ?? "Register") · \(row.shift.openedByName ?? "Shift")")
      }
    }
    .formStyle(.grouped)
    .navigationTitle(row.shift.report == nil ? "Shift" : "Z report")
    .accessibilityIdentifier("shift-z-report")
  }
}
