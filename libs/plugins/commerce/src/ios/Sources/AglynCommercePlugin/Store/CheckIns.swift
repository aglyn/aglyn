// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import AglynPluginHost
import AglynUI
import Foundation
import SwiftUI

/*
 * TODAY'S CHECK-INS (AGL-4043), as the console's PosCheckInsCard has it on the Orders page: who is due at the window on
 * a day, who has checked in, the stays setting, and each pass's rain check. The route (`POS_CHECK_IN_ROUTE`) reads the day
 * (reconciling it first) and does every write; this view only lists and asks. A row heads the orders list beside Day
 * report for a store with registers. The Kotlin kit's CheckIns.kt.
 */

let ordersCheckInsRowID = "report.check-ins"
private let checkInsTitle = "Today's check-ins"
private let managePosKey = "managePos"

/// One row of the day's list: the stored check-in and its id.
struct CheckInListRow: Identifiable, Hashable {
  let id: String
  let checkIn: HostCheckIn
}

/// A day's list, as the route reads it.
struct CheckInDayList {
  let dayKey: String
  let timeZone: String
  let totals: CheckInDayTotals
  let rows: [CheckInListRow]
  let truncated: Bool
  let stayCheckIn: String
}

/// A row off the route's answer; nil for one that does not decode.
func checkInListRow(_ json: JSONValue) -> CheckInListRow? {
  guard let id = json["id"]?.stringValue, let data = try? json.encoded(),
    let checkIn = try? JSONDecoder().decode(HostCheckIn.self, from: data)
  else { return nil }
  return CheckInListRow(id: id, checkIn: checkIn)
}

func checkInDayList(_ json: JSONValue?) -> CheckInDayList? {
  guard let json, let items = json["checkIns"]?.arrayValue else { return nil }
  let rows = items.compactMap(checkInListRow)
  let totals: CheckInDayTotals
  if let read = json["totals"], case .object = read {
    totals = CheckInDayTotals(
      checkedIn: read["checkedIn"]?.numberValue ?? 0, expected: read["expected"]?.numberValue ?? 0,
      rainChecks: read["rainChecks"]?.numberValue ?? 0)
  } else {
    totals = checkInDayTotals(rows.map(\.checkIn))
  }
  return CheckInDayList(
    dayKey: json["dayKey"]?.stringValue ?? "", timeZone: json["timeZone"]?.stringValue ?? "UTC", totals: totals, rows: rows,
    truncated: json["truncated"]?.boolValue == true, stayCheckIn: json["stayCheckIn"]?.stringValue ?? "resource")
}

private func storeFormatter(_ format: String, _ timeZone: String) -> DateFormatter {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.calendar = Calendar(identifier: .gregorian)
  formatter.timeZone = TimeZone(identifier: timeZone) ?? .current
  formatter.dateFormat = format
  return formatter
}

/// A check-in's time on the store's clock, "9:05 AM" (`checkInTimeLabel`).
func checkInTimeLabel(_ ms: Double?, timeZone: String) -> String {
  guard let ms, ms != 0 else { return "" }
  return storeFormatter("h:mm a", timeZone).string(from: Date(timeIntervalSince1970: ms / 1000))
}

/// Today on the store's calendar.
func checkInTodayKey(_ timeZone: String) -> String { storeFormatter("yyyy-MM-dd", timeZone).string(from: Date()) }

/// The day's list as the console's spreadsheet has it (`checkInDayCsv`): one row per person, in the route's order.
func checkInDayCsv(_ list: CheckInDayList) -> String {
  let header = [
    "Day", "Name", "Email", "Phone", "Item", "Order", "Status", "Checked in at", "Checked in by", "Wristband number",
    "Wristband color", "Rain check",
  ]
  let lines = list.rows.map { row -> String in
    let checkIn = row.checkIn
    return [
      checkIn.dayKey, checkIn.customerName ?? "", checkIn.customerEmail ?? "", checkIn.customerPhone ?? "",
      checkInItemLabel(checkIn), checkIn.orderLabel ?? (checkIn.source == .reservation ? "Stay" : ""),
      checkInStatusLabel(checkIn), checkInTimeLabel(checkIn.checkedInAtMs, timeZone: list.timeZone),
      checkIn.checkedInByName ?? "", checkIn.wristband?.number ?? "", checkIn.wristband?.color ?? "", rainCheckLabel(checkIn),
    ].map(posCsvCell).joined(separator: ",")
  }
  return ([header.map(posCsvCell).joined(separator: ",")] + lines).joined(separator: "\n") + "\n"
}

private func esc(_ text: String) -> String {
  text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
    .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
}

/// The day's list as the console prints it (`posCheckInsDocument`): markup the system print sheet lays out.
func checkInsPrintDocument(_ list: CheckInDayList) -> String {
  let rows = list.rows.map { row -> String in
    let checkIn = row.checkIn
    let right: String
    if checkIn.status == .checkedIn {
      right = [checkInTimeLabel(checkIn.checkedInAtMs, timeZone: list.timeZone), describeWristband(checkIn.wristband)]
        .filter { !$0.isEmpty }.joined(separator: " ")
    } else if checkInRainCheckIsOpen(checkIn) {
      right = "Rain check"
    } else {
      right = "—"
    }
    let who = checkIn.customerName ?? checkIn.customerEmail ?? "Customer"
    return "<p>\(esc("\(who) · \(checkInItemLabel(checkIn))")) — \(esc(right))</p>"
  }.joined()
  return
    "<h2>CHECK-INS</h2><p>\(esc(list.dayKey)) · \(Int(list.totals.checkedIn)) of \(Int(list.totals.expected)) checked in</p><hr>\(rows)"
}

/// The route's POST body: the site and the fields, nils left out.
func posCheckInBody(hostID: String, _ fields: [String: JSONValue?]) -> JSONValue {
  var body: [String: JSONValue] = ["hostId": .string(hostID)]
  for (key, value) in fields { if let value { body[key] = value } }
  return .object(body)
}

private func refusal(_ error: Error, _ fallback: String) -> String {
  (error as? ConsoleAPIError)?.body?["error"]?.stringValue ?? fallback
}

/// A day key as a date for the picker (noon on the device's calendar, so the picker shows the same day).
private func pickerDate(_ dayKey: String) -> Date? {
  storeFormatter("yyyy-MM-dd HH:mm", TimeZone.current.identifier).date(from: "\(dayKey) 12:00")
}

private func pickerDayKey(_ date: Date) -> String { storeFormatter("yyyy-MM-dd", TimeZone.current.identifier).string(from: date) }

/// Today's check-ins, for the Orders detail pane and the phone's pushed screen.
struct CheckInsView: View {
  let context: NativePluginContext
  @State private var day = ""
  @State private var list: CheckInDayList?
  @State private var loading = false
  @State private var error: String?
  @State private var actionError: String?
  @State private var savingStayMode = false
  @State private var rainCheckRow: CheckInListRow?
  @State private var guestsFor: GuestsTarget?
  @State private var printFailed: String?
  @State private var reloads = 0

  struct GuestsTarget: Identifiable {
    let id: String
  }

  private var hostID: String { context.hostID ?? "" }
  private var canManagePos: Bool { context.can(managePosKey) }
  private var todayKey: String { list.map { checkInTodayKey($0.timeZone) } ?? "" }

  private var csvFile: URL? {
    guard let list else { return nil }
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("check-ins-\(list.dayKey).csv")
    do {
      try Data(checkInDayCsv(list).utf8).write(to: url, options: .atomic)
      return url
    } catch {
      return nil
    }
  }

  var body: some View {
    Form {
      if !canManagePos {
        Section {
          AglynNotice(
            "Check-ins take the \"Use the point of sale\" permission, which site admins and editors hold by default.", tone: .info)
        }
      }
      Section {
        DatePicker(
          "Day",
          selection: Binding(
            get: { pickerDate(day.isEmpty ? (list?.dayKey ?? "") : day) ?? Date() },
            set: { day = pickerDayKey($0) }),
          displayedComponents: .date
        )
        .disabled(!canManagePos)
        .accessibilityIdentifier("check-ins-day")
        Button("Today") { day = "" }
          .disabled(!canManagePos || day.isEmpty)
          .accessibilityIdentifier("check-ins-today")
      }
      Section {
        Picker(
          "Stays at check-in",
          selection: Binding(
            get: { list?.stayCheckIn ?? "resource" },
            set: { mode in
              guard canManagePos, let list, !savingStayMode, mode != list.stayCheckIn else { return }
              savingStayMode = true
              post(["action": "stay_mode", "mode": .string(mode), "day": day.isEmpty ? nil : .string(day)], refused: "The setting could not be saved.")
            })
        ) {
          ForEach(stayCheckInModeLabels, id: \.mode) { Text($0.label).tag($0.mode) }
        }
        .disabled(!canManagePos || list == nil || savingStayMode)
        .accessibilityIdentifier("check-ins-stay-mode")
      } footer: {
        Text("One per guest gives each guest of a stay their own check-in and wristband, by the stay’s guest count.")
      }
      if loading && list == nil {
        Section { Text("Reading who is due…").foregroundStyle(.secondary) }
      }
      if let error { Section { AglynNotice(error, tone: .warning) } }
      if let list {
        Section {
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: AglynSpace.one)], spacing: AglynSpace.one) {
            AglynStatTile("\(Int(list.totals.expected))", label: "Expected")
            AglynStatTile("\(Int(list.totals.checkedIn))", label: "Checked in")
            AglynStatTile("\(Int(list.totals.expected - list.totals.checkedIn))", label: "Still to come")
            if list.totals.rainChecks > 0 { AglynStatTile("\(Int(list.totals.rainChecks))", label: "Rain checks") }
          }
          .accessibilityIdentifier("check-ins-totals")
        } header: {
          Text("\(list.dayKey) · \(list.timeZone) · passes and stays that need check-in")
        }
        if list.truncated {
          Section { AglynNotice("This day has more check-ins than one list reads; some are missing here.", tone: .warning) }
        }
        if let actionError { Section { AglynNotice(actionError, tone: .warning) { self.actionError = nil } } }
        if let printFailed { Section { AglynNotice(printFailed, tone: .warning) { self.printFailed = nil } } }
        Section {
          if list.rows.isEmpty {
            Text("Nobody is due to check in on this day").foregroundStyle(.secondary)
              .accessibilityIdentifier("check-ins-empty")
          } else {
            ForEach(list.rows) { row in
              CheckInDayRowView(
                row: row, timeZone: list.timeZone, canManagePos: canManagePos, hasToday: !todayKey.isEmpty,
                onGuests: { guestsFor = GuestsTarget(id: $0) },
                onRainCheck: { rainCheckRow = row },
                onUndoRainCheck: {
                  post(["action": "undo_rain_check", "id": .string(row.id)], refused: "The rain check could not be undone.")
                })
            }
          }
        }
        .accessibilityIdentifier("check-ins-rows")
      }
    }
    .formStyle(.grouped)
    .navigationTitle(checkInsTitle)
    .toolbar {
      ToolbarItemGroup(placement: .primaryAction) {
        Button { reloads += 1 } label: { Label("Refresh", systemImage: "arrow.clockwise") }
          .disabled(!canManagePos || loading)
          .accessibilityIdentifier("check-ins-refresh")
        if let file = csvFile {
          ShareLink(item: file) { Label("Export CSV", systemImage: "square.and.arrow.up") }
            .accessibilityIdentifier("check-ins-export")
        }
        if SystemPrinter.isAvailable, let list {
          Button {
            Task {
              if case .failed(let message) = await SystemPrinter.printDocument(
                .html(checkInsPrintDocument(list)), jobName: "Check-ins \(list.dayKey)")
              {
                printFailed = message
              }
            }
          } label: {
            Label("Print", systemImage: "printer")
          }
          .accessibilityIdentifier("check-ins-print")
        }
      }
    }
    .task(id: "\(hostID)|\(day)|\(reloads)|\(canManagePos)") { await load() }
    .sheet(item: $rainCheckRow) { row in
      RainCheckSheet(context: context, hostID: hostID, row: row, todayKey: todayKey) { reloads += 1 }
    }
    .sheet(item: $guestsFor) { target in
      ReservationGuestsSheet(context: context, hostID: hostID, reservationID: target.id) { reloads += 1 }
    }
    .accessibilityIdentifier("check-ins-pane")
  }

  private func load() async {
    guard canManagePos, !hostID.isEmpty else { return }
    loading = true
    defer { loading = false }
    do {
      let answer = try await context.api.request(
        ContractValues.shared.posCheckInRoute, query: [("hostId", hostID), ("day", day.isEmpty ? nil : day)])
      let read = checkInDayList(answer)
      list = read
      error = read == nil ? "The check-ins could not be read." : nil
    } catch is CancellationError {
      return
    } catch {
      self.error = refusal(error, "The check-ins could not be read. Check the connection.")
    }
  }

  private func post(_ fields: [String: JSONValue?], refused: String) {
    actionError = nil
    Task {
      defer { savingStayMode = false }
      do {
        try await context.api.request(
          ContractValues.shared.posCheckInRoute, method: .post, body: posCheckInBody(hostID: hostID, fields))
        reloads += 1
      } catch {
        actionError = refusal(error, refused)
      }
    }
  }
}

private struct CheckInDayRowView: View {
  let row: CheckInListRow
  let timeZone: String
  let canManagePos: Bool
  let hasToday: Bool
  let onGuests: (String) -> Void
  let onRainCheck: () -> Void
  let onUndoRainCheck: () -> Void

  private var checkIn: HostCheckIn { row.checkIn }

  private var detail: String {
    let at = checkInTimeLabel(checkIn.checkedInAtMs, timeZone: timeZone)
    let checkedIn =
      at.isEmpty ? "" : "Checked in at \(at)" + (checkIn.checkedInByName.flatMap { $0.isEmpty ? nil : " by \($0)" } ?? "")
    return [rainCheckLabel(checkIn), checkedIn, describeWristband(checkIn.wristband)].filter { !$0.isEmpty }
      .joined(separator: " · ")
  }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      HStack(spacing: AglynSpace.one) {
        Text(checkIn.customerName.flatMap { $0.isEmpty ? nil : $0 } ?? checkIn.customerEmail ?? "")
          .font(AglynFont.body.weight(.medium))
        Spacer()
        if checkIn.status == .checkedIn {
          StatusChip("Checked in", tone: .success)
        } else if checkInRainCheckIsOpen(checkIn) {
          StatusChip("Rain check", tone: .info)
        } else {
          StatusChip("Expected")
        }
      }
      let order = checkIn.orderLabel ?? (checkIn.source == .reservation ? "Stay" : "")
      Text([checkInItemLabel(checkIn), order].filter { !$0.isEmpty }.joined(separator: " · "))
        .font(AglynFont.subheadline)
      if !detail.isEmpty { Text(detail).font(AglynFont.caption).foregroundStyle(.secondary) }
      action
    }
    .padding(.vertical, AglynSpace.half)
    .accessibilityIdentifier("check-in-\(row.id)")
  }

  @ViewBuilder private var action: some View {
    if checkIn.source == .reservation, let reservationID = checkIn.reservationId {
      Button("Guests") { onGuests(reservationID) }
        .buttonStyle(.borderless).disabled(!canManagePos)
        .accessibilityIdentifier("check-in-guests-\(row.id)")
    } else if checkIn.source != .order || checkIn.status != .expected {
      EmptyView()
    } else if checkIn.rainCheck != nil {
      Button("Undo rain check", action: onUndoRainCheck)
        .buttonStyle(.borderless).disabled(!canManagePos)
        .accessibilityIdentifier("check-in-undo-rain-check-\(row.id)")
    } else {
      Button("Rain check", action: onRainCheck)
        .buttonStyle(.borderless).disabled(!canManagePos || !hasToday)
        .accessibilityIdentifier("check-in-rain-check-\(row.id)")
    }
  }
}

/// Give a pass a rain check: open, or moved to a day (the console's PosRainCheckDialog).
struct RainCheckSheet: View {
  let context: NativePluginContext
  let hostID: String
  let row: CheckInListRow
  let todayKey: String
  /// The register and its cashier, when given at the register.
  var extraFields: [String: JSONValue?] = [:]
  let onDone: () -> Void
  @State private var kind = "open"
  @State private var newDay: Date?

  /// The picked day, else the one the picker shows first: the day after the pass's.
  private var newDayKey: String? { newDay.map(pickerDayKey) ?? addCheckInDays(row.checkIn.dayKey, 1) }
  private var dayProblem: String? {
    guard kind == "date", let newDayKey else { return nil }
    return rainCheckProblem(row.checkIn, kind: "date", dayKey: newDayKey, todayKey: todayKey)
  }

  var body: some View {
    let checkIn = row.checkIn
    AglynFormSheet(
      "Rain check", confirm: "Give rain check", working: "Giving…",
      canConfirm: !(kind == "date" && (newDayKey == nil || dayProblem != nil))
    ) {
      do {
        try await context.api.request(
          ContractValues.shared.posCheckInRoute, method: .post,
          body: posCheckInBody(
            hostID: hostID,
            ["action": "rain_check", "id": .string(row.id), "kind": .string(kind),
             "day": kind == "date" ? newDayKey.map(JSONValue.string) : nil].merging(extraFields) { _, extra in extra }))
      } catch {
        throw ConsoleAPIError(status: (error as? ConsoleAPIError)?.status ?? 0, message: refusal(error, "The rain check was not given."))
      }
      onDone()
    } content: {
      Section {
        Text(
          "\(checkIn.customerName.flatMap { $0.isEmpty ? nil : $0 } ?? checkIn.customerEmail ?? "Customer") · \(checkInItemLabel(checkIn)) · \(checkInDayLabel(checkIn.dayKey))"
        )
        .foregroundStyle(.secondary)
        Picker("Rain check", selection: $kind) {
          Text("Open: good on any later day until it is used").tag("open")
          Text("Move it to a day").tag("date")
        }
        .pickerStyle(.inline)
        .labelsHidden()
        .accessibilityIdentifier("rain-check-kind")
        if kind == "date" {
          DatePicker(
            "New day",
            selection: Binding(get: { newDay ?? newDayKey.flatMap(pickerDate) ?? Date() }, set: { newDay = $0 }),
            displayedComponents: .date
          )
          .accessibilityIdentifier("rain-check-day")
          if let dayProblem { Text(dayProblem).font(AglynFont.caption).foregroundStyle(AglynColor.error) }
        }
      }
      .accessibilityIdentifier("rain-check-sheet")
    }
  }
}

/// How many guests a stay holds (the console's ReservationGuestsDialog): check-ins follow it under one per guest.
struct ReservationGuestsSheet: View {
  let context: NativePluginContext
  let hostID: String
  let reservationID: String
  let onDone: () -> Void
  @State private var loaded: (guests: Int, capacity: Double?, label: String)?
  @State private var typed = ""

  private var count: Double? { Double(typed.trimmingCharacters(in: .whitespaces)) }
  private var problem: String? {
    typed.trimmingCharacters(in: .whitespaces).isEmpty ? "How many guests?" : reservationGuestsProblem(count, capacity: loaded?.capacity)
  }

  var body: some View {
    AglynFormSheet("Guests", canConfirm: loaded != nil && problem == nil) {
      guard problem == nil, let count else { return }
      do {
        try await context.api.request(
          ContractValues.shared.reservationGuestsRoute, method: .post,
          body: .object(["hostId": .string(hostID), "reservationId": .string(reservationID), "guests": .number(count.rounded(.down))]))
      } catch {
        throw ConsoleAPIError(
          status: (error as? ConsoleAPIError)?.status ?? 0, message: refusal(error, "The guests could not be changed. Try again."))
      }
      onDone()
    } content: {
      Section {
        if let label = loaded?.label, !label.isEmpty { Text(label).foregroundStyle(.secondary) }
        TextField("Guests", text: Binding(get: { typed }, set: { typed = $0.filter(\.isNumber) }))
          #if os(iOS)
            .keyboardType(.numberPad)
          #endif
          .disabled(loaded == nil)
          .accessibilityIdentifier("guests-count")
      } footer: {
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          if !typed.isEmpty, let problem {
            Text(problem).foregroundStyle(AglynColor.error)
          } else if let capacity = loaded?.capacity {
            Text("Up to \(resourceGuestCeiling(capacity: capacity)), what this stay sleeps")
          } else {
            Text("At least 1")
          }
          Text(
            "When the stay is checked in one guest at a time, today’s check-ins follow: an added guest gets their own, and a guest already checked in stays."
          )
        }
      }
      .accessibilityIdentifier("guests-sheet")
    }
    .task(id: reservationID) { await load() }
  }

  private func load() async {
    let stay = (try? await context.firestore.readOnce(["hosts", hostID, "reservations", reservationID]))?.data ?? [:]
    var resource: [String: Any]?
    if let resourceID = stay["resourceId"] as? String, !resourceID.isEmpty {
      resource = (try? await context.firestore.readOnce(["hosts", hostID, "resources", resourceID]))?.data
    }
    let guests = reservationGuests((stay["guests"] as? NSNumber)?.doubleValue)
    let who = (stay["guestName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? stay["guestEmail"] as? String
    let label = [resource?["name"] as? String, who].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    loaded = (guests, (resource?["capacity"] as? NSNumber)?.doubleValue, label)
    typed = String(guests)
  }
}
