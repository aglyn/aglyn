// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import SwiftUI

/*
 * CHECK-IN AT THE WINDOW (AGL-4043), as the console's PosCheckInDialog has it at the register: find the customer by
 * name, email, phone or order number, see what their passes, camping and stays cover today, and check each person in
 * with an optional wristband number and color. One already checked in says when and by whom, with an undo. The register
 * and its cashier ride every write, so a PIN's cashier is who checked them in. The route (`POS_CHECK_IN_ROUTE`) does
 * the work. The Kotlin kit's PosCheckIn.kt.
 */

/// The register's check-in zone (`POS_CHECK_IN_ZONE`): another plugin's status or flow for one customer on one day.
let posCheckInZone = "posCheckIn"

/// What the zone hands a widget, as the console's `PosCheckInZone` does.
private func checkInZoneProps(
  context: NativePluginContext, hostID: String, customer: CheckInCustomer, dayKey: String, unitsDue: Int, placement: String
) -> [String: String] {
  var props: [String: String] = [
    "hostId": hostID, "dayKey": dayKey, "unitsDue": String(unitsDue), "placement": placement,
  ]
  if let orgID = context.orgID { props["orgId"] = orgID }
  if let contactID = customer.contactId, !contactID.isEmpty { props["contactId"] = contactID }
  if let email = customer.email, !email.isEmpty { props["email"] = email.lowercased() }
  if let name = customer.name, !name.isEmpty { props["name"] = name }
  return props
}

/// How long typing pauses before the register asks.
private let checkInSearchDebounce: Duration = .milliseconds(250)

/// The customer to open on, as the register's customer panel names them.
struct PosCheckInTarget: Equatable {
  var customerKey: String?
  var email: String?
  var contactID: String?

  var isEmpty: Bool { [customerKey, email, contactID].allSatisfy { ($0 ?? "").isEmpty } }
}

private struct WristbandDraft: Equatable {
  var number = ""
  var color = ""
}

private func checkInCustomer(_ json: JSONValue) -> CheckInCustomer? {
  guard let data = try? json.encoded() else { return nil }
  return try? JSONDecoder().decode(CheckInCustomer.self, from: data)
}

private func checkInRows(_ json: JSONValue?) -> [CheckInListRow] { (json?.arrayValue ?? []).compactMap(checkInListRow) }

private func refusalText(_ error: Error, _ fallback: String) -> String {
  (error as? ConsoleAPIError)?.body?["error"]?.stringValue ?? fallback
}

/// The check-in sheet at the register; `initial` opens straight on one customer rather than on the search.
struct PosCheckInSheet: View {
  let context: NativePluginContext
  let hostID: String
  let registerID: String?
  let cashierAssertion: () -> String?
  var initial: PosCheckInTarget?
  @Environment(\.dismiss) private var dismiss
  @State private var text = ""
  @State private var customers: [CheckInCustomer] = []
  @State private var searched = false
  @State private var dayKey = ""
  @State private var timeZone = "UTC"
  @State private var customer: CheckInCustomer?
  @State private var rows: [CheckInListRow] = []
  @State private var drafts: [String: WristbandDraft] = [:]
  @State private var busy = false
  @State private var error: String?
  @State private var notice: String?
  @State private var rainCheckRow: CheckInListRow?
  @State private var guestsFor: CheckInsView.GuestsTarget?

  /// The register and its cashier, on every write.
  private var staffFields: [String: JSONValue?] {
    ["registerId": registerID.map(JSONValue.string), "cashierAssertion": cashierAssertion().map(JSONValue.string)]
  }

  /// A pass a dated rain check moved off the window's day: not to check in today.
  private func movedAway(_ row: CheckInListRow) -> Bool {
    row.checkIn.status == .expected && row.checkIn.rainCheck?.kind == .date && row.checkIn.dayKey != dayKey
  }
  // "Check in all" leaves rain checks alone: an open one is used one at a time.
  private var waiting: [CheckInListRow] {
    rows.filter { $0.checkIn.status == .expected && !movedAway($0) && !checkInRainCheckIsOpen($0.checkIn) }
  }
  private var todayKey: String { dayKey.isEmpty ? "" : checkInTodayKey(timeZone) }

  var body: some View {
    NavigationStack {
      Form {
        if let customer {
          Section {
            HStack(spacing: AglynSpace.one) {
              if let email = customer.email { Text(email).font(AglynFont.subheadline).foregroundStyle(.secondary) }
              Spacer()
              StatusChip(
                "\(rows.filter { $0.checkIn.status == .checkedIn }.count) of \(rows.count) checked in",
                tone: !rows.isEmpty && waiting.isEmpty ? .success : .neutral)
            }
            if !dayKey.isEmpty {
              SlotWidgets(
                context: context, slot: posCheckInZone,
                props: checkInZoneProps(
                  context: context, hostID: hostID, customer: customer, dayKey: dayKey, unitsDue: rows.count,
                  placement: "check-in-customer"))
            }
          }
          Section {
            ForEach(rows) { row in
              PosCheckInRowView(
                row: row, timeZone: timeZone, busy: busy, movedAway: movedAway(row), hasToday: !todayKey.isEmpty,
                draft: Binding(get: { drafts[row.id] ?? WristbandDraft() }, set: { drafts[row.id] = $0 }),
                onCheckIn: { Task { await checkIn([row]) } },
                onUndo: { Task { await undo(row, action: "undo", refused: "The check-in could not be undone.") } },
                onUndoRainCheck: {
                  Task { await undo(row, action: "undo_rain_check", refused: "The rain check could not be undone.") }
                },
                onRainCheck: { rainCheckRow = row },
                onGuests: { guestsFor = CheckInsView.GuestsTarget(id: $0) })
            }
          }
        } else {
          Section {
            TextField("Find a customer", text: $text, prompt: Text("Name, email, phone or order number"))
              .autocorrectionDisabled()
              #if os(iOS)
                .textInputAutocapitalization(.never)
              #endif
              .accessibilityIdentifier("pos-check-in-search")
          }
          Section {
            if !customers.isEmpty {
              ForEach(customers, id: \.customerKey) { one in
                Button {
                  Task { await openCustomer(PosCheckInTarget(customerKey: one.customerKey)) }
                } label: {
                  VStack(alignment: .leading, spacing: AglynSpace.half) {
                    Text(one.name.flatMap { $0.isEmpty ? nil : $0 } ?? one.email ?? "Customer")
                      .font(AglynFont.body.weight(.medium)).foregroundStyle(.primary)
                    Text(
                      [
                        "\(Int(one.unitsCheckedIn)) of \(Int(one.unitsDue)) checked in",
                        one.items.joined(separator: ", "), one.email ?? "", one.phone ?? "",
                      ].filter { !$0.isEmpty }.joined(separator: " · ")
                    )
                    .font(AglynFont.caption).foregroundStyle(.secondary)
                  }
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .contentShape(Rectangle())
                }
                // A result reads as a row, not as tinted button text.
                .buttonStyle(.plain)
                .accessibilityIdentifier("pos-check-in-customer-\(one.customerKey)")
                if !dayKey.isEmpty {
                  SlotWidgets(
                    context: context, slot: posCheckInZone,
                    props: checkInZoneProps(
                      context: context, hostID: hostID, customer: one, dayKey: dayKey, unitsDue: Int(one.unitsDue),
                      placement: "check-in-row"))
                }
              }
            } else if searched {
              Text("Nobody with that name, email, phone or order number has anything to check in today.")
                .foregroundStyle(.secondary)
            } else {
              Text("Passes, camping and stays bought online or at the register show up here on the day they are for.")
                .foregroundStyle(.secondary)
            }
          }
        }
        if let notice { Section { AglynNotice(notice, tone: .info) { self.notice = nil } } }
        if let error { Section { AglynNotice(error, tone: .warning) { self.error = nil } } }
      }
      .formStyle(.grouped)
      // A page a zone opens (a waiver's signing page) is pushed on this sheet's own stack, over the check-in.
      .aglynBrowserDestination()
      .navigationTitle(customer.map { $0.name.flatMap { $0.isEmpty ? nil : $0 } ?? $0.email ?? "Customer" } ?? "Check in")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          if customer != nil {
            Button("Back to search") {
              customer = nil
              rows = []
              notice = nil
            }
            .accessibilityIdentifier("pos-check-in-back")
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          if customer != nil && waiting.count > 1 {
            Button("Check in all \(waiting.count)") { Task { await checkIn(waiting) } }
              .disabled(busy)
              .accessibilityIdentifier("pos-check-in-all")
          } else {
            Button("Done") { dismiss() }
          }
        }
      }
    }
    .task(id: text) { await search() }
    .task { if let initial, !initial.isEmpty { await openCustomer(initial) } }
    .sheet(item: $rainCheckRow) { row in
      RainCheckSheet(context: context, hostID: hostID, row: row, todayKey: todayKey, extraFields: staffFields) {
        reopen()
      }
    }
    .sheet(item: $guestsFor) { target in
      // The stay's check-ins may have changed: read the customer again.
      ReservationGuestsSheet(context: context, hostID: hostID, reservationID: target.id) { reopen() }
    }
    .aglynSheetMinimumSize(width: 520, height: 560)
    .accessibilityIdentifier("pos-check-in")
  }

  private func reopen() {
    guard let key = customer?.customerKey else { return }
    Task { await openCustomer(PosCheckInTarget(customerKey: key)) }
  }

  private func post(_ fields: [String: JSONValue?], idempotencyKey: String? = nil) async throws -> JSONValue? {
    try await context.api.request(
      ContractValues.shared.posCheckInRoute, method: .post, body: posCheckInBody(hostID: hostID, fields),
      idempotencyKey: idempotencyKey)
  }

  private func readDay(_ answer: JSONValue?) {
    if let key = answer?["dayKey"]?.stringValue { dayKey = key }
    if let zone = answer?["timeZone"]?.stringValue { timeZone = zone }
  }

  private func search() async {
    let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard typed.count >= 2 else {
      customers = []
      searched = false
      return
    }
    do {
      try await Task.sleep(for: checkInSearchDebounce)
      let answer = try await post(["action": "search", "text": .string(typed)])
      error = nil
      readDay(answer)
      customers = (answer?["customers"]?.arrayValue ?? []).compactMap(checkInCustomer)
      searched = true
    } catch is CancellationError {
      return
    } catch {
      self.error = refusalText(error, "The search did not run.")
    }
  }

  private func openCustomer(_ target: PosCheckInTarget) async {
    busy = true
    error = nil
    notice = nil
    defer { busy = false }
    do {
      let answer = try await post([
        "action": "customer", "customerKey": target.customerKey.map(JSONValue.string),
        "email": target.email.map(JSONValue.string), "contactId": target.contactID.map(JSONValue.string),
      ])
      readDay(answer)
      customer = answer?["customer"].flatMap(checkInCustomer)
      rows = checkInRows(answer?["checkIns"])
      drafts = [:]
      if rows.isEmpty { notice = "Nothing to check in today for this customer." }
    } catch {
      self.error = refusalText(error, "That customer could not be opened.")
    }
  }

  private func merge(_ changed: [CheckInListRow]) {
    let byID = Dictionary(changed.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
    rows = rows.map { byID[$0.id] ?? $0 }
  }

  private func checkIn(_ targets: [CheckInListRow]) async {
    guard !targets.isEmpty else { return }
    busy = true
    error = nil
    notice = nil
    defer { busy = false }
    let entries: [JSONValue] = targets.map { row in
      var entry: [String: JSONValue] = ["id": .string(row.id)]
      if let draft = drafts[row.id] {
        let number = draft.number.trimmingCharacters(in: .whitespaces)
        if !number.isEmpty || !draft.color.isEmpty {
          entry["wristband"] = .object(["number": .string(number), "color": .string(draft.color)])
        }
      }
      return .object(entry)
    }
    var fields: [String: JSONValue?] = ["action": "check_in", "checkIns": .array(entries)]
    // The window's day: an open rain check checked in is used on it.
    if !dayKey.isEmpty { fields["day"] = .string(dayKey) }
    fields.merge(staffFields) { _, staff in staff }
    do {
      let answer = try await post(fields, idempotencyKey: "pos-app-\(UUID().uuidString)")
      let already = checkInRows(answer?["alreadyCheckedIn"])
      merge(checkInRows(answer?["checkedIn"]) + already)
      if let first = already.first {
        notice = alreadyCheckedInLabel(
          timeLabel: checkInTimeLabel(first.checkIn.checkedInAtMs, timeZone: timeZone), byName: first.checkIn.checkedInByName)
      }
    } catch {
      self.error = refusalText(error, "They could not be checked in.")
    }
  }

  private func undo(_ row: CheckInListRow, action: String, refused: String) async {
    busy = true
    error = nil
    notice = nil
    defer { busy = false }
    var fields: [String: JSONValue?] = ["action": .string(action), "id": .string(row.id)]
    fields.merge(staffFields) { _, staff in staff }
    do {
      if let changed = try await post(fields)?["checkIn"].flatMap(checkInListRow) {
        merge([changed])
      } else {
        error = refused
      }
    } catch {
      self.error = refusalText(error, refused)
    }
  }
}

private struct PosCheckInRowView: View {
  let row: CheckInListRow
  let timeZone: String
  let busy: Bool
  let movedAway: Bool
  let hasToday: Bool
  @Binding var draft: WristbandDraft
  let onCheckIn: () -> Void
  let onUndo: () -> Void
  let onUndoRainCheck: () -> Void
  let onRainCheck: () -> Void
  let onGuests: (String) -> Void

  private var checkIn: HostCheckIn { row.checkIn }
  private var stay: String? { checkIn.source == .reservation ? checkIn.reservationId : nil }

  private var secondary: String {
    let first: String
    if checkIn.status == .checkedIn {
      first = [
        "Checked in at \(checkInTimeLabel(checkIn.checkedInAtMs, timeZone: timeZone))"
          + (checkIn.checkedInByName.flatMap { $0.isEmpty ? nil : " by \($0)" } ?? ""),
        describeWristband(checkIn.wristband),
      ].filter { !$0.isEmpty }.joined(separator: " · ")
    } else {
      first = checkIn.orderLabel ?? (checkIn.source == .reservation ? "Stay" : "")
    }
    return [first, rainCheckLabel(checkIn)].filter { !$0.isEmpty }.joined(separator: " · ")
  }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text(checkInItemLabel(checkIn)).font(AglynFont.body.weight(.medium))
      if !secondary.isEmpty { Text(secondary).font(AglynFont.caption).foregroundStyle(.secondary) }
      if checkIn.status == .checkedIn {
        HStack(spacing: AglynSpace.two) {
          Button("Undo", action: onUndo).buttonStyle(.borderless).disabled(busy)
            .accessibilityIdentifier("pos-check-in-undo-\(row.id)")
          if let stay { Button("Guests") { onGuests(stay) }.buttonStyle(.borderless).disabled(busy) }
        }
      } else if movedAway {
        Button("Undo rain check", action: onUndoRainCheck).buttonStyle(.borderless).disabled(busy)
      } else {
        TextField("Wristband number", text: Binding(
          get: { draft.number },
          set: { draft.number = String($0.prefix(ContractValues.shared.checkInWristbandMax)) }))
          .accessibilityIdentifier("pos-check-in-wristband-\(row.id)")
        Picker("Color", selection: $draft.color) {
          Text("None").tag("")
          ForEach(ContractValues.shared.checkInWristbandColors, id: \.self) { Text($0).tag($0) }
        }
        .accessibilityIdentifier("pos-check-in-color-\(row.id)")
        HStack(spacing: AglynSpace.two) {
          Button("Check in", action: onCheckIn).buttonStyle(.borderedProminent).disabled(busy)
            .accessibilityIdentifier("pos-check-in-one-\(row.id)")
          if let stay { Button("Guests") { onGuests(stay) }.buttonStyle(.borderless).disabled(busy) }
          if checkIn.source == .order {
            if checkIn.rainCheck != nil {
              Button("Undo rain check", action: onUndoRainCheck).buttonStyle(.borderless).disabled(busy)
            } else {
              Button("Rain check", action: onRainCheck).buttonStyle(.borderless).disabled(busy || !hasToday)
                .accessibilityIdentifier("pos-check-in-rain-check-\(row.id)")
            }
          }
        }
      }
    }
    .padding(.vertical, AglynSpace.half)
    .accessibilityIdentifier("pos-check-in-row-\(row.id)")
  }
}
