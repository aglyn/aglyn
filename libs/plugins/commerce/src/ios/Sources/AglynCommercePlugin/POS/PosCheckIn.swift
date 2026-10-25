// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * CHECK-IN AT THE WINDOW (AGL-4043, AGL-4063): a rider who bought a day pass online, a camper, a guest whose stay covers
 * today walks up; the register finds them by name, email, phone or order number and checks each person in, with an
 * optional wristband. The Kotlin app's `PosCheckIn.kt`, line for line.
 *
 * The app calls the SAME route the console register calls (`POS_CHECK_IN_ROUTE`), as the signed-in member with the
 * register and the PIN's cashier, so every gate holds on the device unchanged:
 *   `search` {text} → {dayKey, timeZone, customers}
 *   `customer` {customerKey | email | contactId} → {dayKey, timeZone, customer, checkIns}
 *   `check_in` {checkIns: [{id, wristband?}]} with an Idempotency-Key → {checkedIn, alreadyCheckedIn, missing}
 *   `undo` {id} → {checkIn}
 */

/// How long typing pauses before the register asks (the console's `SEARCH_DEBOUNCE_MS`).
let posCheckInSearchDebounce: Duration = .milliseconds(250)

/// The day the route answered for: its key in the site's time zone, and that zone.
struct PosCheckInDay: Equatable {
  let dayKey: String
  let timeZone: String
}

/// Who to open, as the register's customer panel names them.
struct PosCheckInTarget: Equatable {
  var customerKey: String?
  var email: String?
  var contactId: String?
  /// `if-used`: bring the day in line only on a day the window is already checking people in (the attached customer's
  /// count asks on every customer).
  var reconcile: String?

  var isEmpty: Bool { [customerKey, email, contactId].allSatisfy { ($0 ?? "").isEmpty } }
}

struct PosCheckInCustomerAnswer {
  var day: PosCheckInDay?
  var customer: CheckInCustomer?
  var rows: [CheckInRow]
}

struct PosCheckInResult {
  var checkedIn: [CheckInRow]
  var alreadyCheckedIn: [CheckInRow]
}

/// One check-in the register sends: the person, and the wristband handed over (if any).
struct PosCheckInPick {
  let id: String
  let wristband: CheckInWristband?
}

protocol PosCheckInAPI: Sendable {
  func search(_ text: String) async throws -> (PosCheckInDay?, [CheckInCustomer])
  func customer(_ target: PosCheckInTarget) async throws -> PosCheckInCustomerAnswer
  func checkIn(_ picks: [PosCheckInPick], registerID: String?, assertion: String?, attemptKey: String) async throws
    -> PosCheckInResult
  func undo(_ id: String, registerID: String?, assertion: String?) async throws -> CheckInRow
}

/// The answer's rows: each `{ id, ...record }` decoded through the generated record.
func readCheckInRows(_ value: JSONValue?) -> [CheckInRow] {
  (value?.arrayValue ?? []).compactMap { row in (try? row.encoded()).flatMap { CheckInRow(data: $0) } }
}

func readCheckInCustomers(_ value: JSONValue?) -> [CheckInCustomer] {
  (value?.arrayValue ?? []).compactMap { row in
    (try? row.encoded()).flatMap { try? JSONDecoder().decode(CheckInCustomer.self, from: $0) }
  }
}

private func readDay(_ answer: JSONValue?) -> PosCheckInDay? {
  guard let key = answer?["dayKey"]?.stringValue, !key.isEmpty else { return nil }
  return PosCheckInDay(dayKey: key, timeZone: answer?["timeZone"]?.stringValue ?? "UTC")
}

struct ConsolePosCheckInAPI: PosCheckInAPI {
  let api: ConsoleAPIClient
  let hostID: String

  private func call(_ action: String, _ extra: [String: JSONValue], attemptKey: String? = nil) async throws -> JSONValue? {
    var body: [String: JSONValue] = ["hostId": .string(hostID), "action": .string(action)]
    body.merge(extra) { _, given in given }
    return try await api.request(
      ContractValues.shared.posCheckInRoute, method: .post, body: .object(body), idempotencyKey: attemptKey)
  }

  private func cashier(_ registerID: String?, _ assertion: String?) -> [String: JSONValue] {
    var fields: [String: JSONValue] = [:]
    if let registerID, !registerID.isEmpty { fields["registerId"] = .string(registerID) }
    if let assertion, !assertion.isEmpty { fields["cashierAssertion"] = .string(assertion) }
    return fields
  }

  func search(_ text: String) async throws -> (PosCheckInDay?, [CheckInCustomer]) {
    let answer = try await call("search", ["text": .string(text)])
    return (readDay(answer), readCheckInCustomers(answer?["customers"]))
  }

  func customer(_ target: PosCheckInTarget) async throws -> PosCheckInCustomerAnswer {
    var fields: [String: JSONValue] = [:]
    if let key = target.customerKey, !key.isEmpty { fields["customerKey"] = .string(key) }
    if let email = target.email, !email.isEmpty { fields["email"] = .string(email) }
    if let contact = target.contactId, !contact.isEmpty { fields["contactId"] = .string(contact) }
    if let reconcile = target.reconcile { fields["reconcile"] = .string(reconcile) }
    let answer = try await call("customer", fields)
    let customer = (try? answer?["customer"]?.encoded()).flatMap { try? JSONDecoder().decode(CheckInCustomer.self, from: $0) }
    return PosCheckInCustomerAnswer(day: readDay(answer), customer: customer, rows: readCheckInRows(answer?["checkIns"]))
  }

  func checkIn(_ picks: [PosCheckInPick], registerID: String?, assertion: String?, attemptKey: String) async throws
    -> PosCheckInResult
  {
    let list: [JSONValue] = picks.map { pick in
      var row: [String: JSONValue] = ["id": .string(pick.id)]
      if let band = pick.wristband {
        row["wristband"] = .object(["number": .string(band.number ?? ""), "color": .string(band.color ?? "")])
      }
      return .object(row)
    }
    var fields = cashier(registerID, assertion)
    fields["checkIns"] = .array(list)
    let answer = try await call("check_in", fields, attemptKey: attemptKey)
    return PosCheckInResult(
      checkedIn: readCheckInRows(answer?["checkedIn"]), alreadyCheckedIn: readCheckInRows(answer?["alreadyCheckedIn"]))
  }

  func undo(_ id: String, registerID: String?, assertion: String?) async throws -> CheckInRow {
    var fields = cashier(registerID, assertion)
    fields["id"] = .string(id)
    let answer = try await call("undo", fields)
    guard let row = readCheckInRows(.array([answer?["checkIn"] ?? .null])).first else {
      throw ConsoleAPIError(status: 0, message: "The check-in could not be undone.")
    }
    return row
  }
}

/// A wristband as it is being typed for one person.
struct PosWristbandDraft: Equatable {
  var number = ""
  var color = ""
}

/// The check-in sheet's state: the search, the customer open on it, their rows and the wristbands being typed. The words
/// are the console dialog's (`pos-check-in-dialog.component.tsx`).
@MainActor @Observable
final class PosCheckInModel {
  var text = "" { didSet { if text != oldValue { scheduleSearch() } } }
  private(set) var customers: [CheckInCustomer] = []
  private(set) var searched = false
  private(set) var day: PosCheckInDay?
  private(set) var customer: CheckInCustomer?
  private(set) var rows: [CheckInRow] = []
  var drafts: [String: PosWristbandDraft] = [:]
  private(set) var busy = false
  var error = ""
  var notice = ""

  @ObservationIgnored private let api: PosCheckInAPI
  @ObservationIgnored private let registerID: () -> String?
  @ObservationIgnored private let assertion: () -> String?
  @ObservationIgnored private var searchTask: Task<Void, Never>?
  @ObservationIgnored private var ticket = 0

  init(api: PosCheckInAPI, registerID: @escaping () -> String?, assertion: @escaping () -> String?) {
    self.api = api
    self.registerID = registerID
    self.assertion = assertion
  }

  /// The people still to check in.
  var waiting: [CheckInRow] { rows.filter { !$0.checkedIn } }
  var checkedInCount: Int { rows.filter(\.checkedIn).count }
  var title: String {
    guard let customer else { return "Check in" }
    return [customer.name, customer.email].compactMap { $0 }.first { !$0.isEmpty } ?? "Customer"
  }

  func reset() {
    searchTask?.cancel()
    ticket += 1
    text = ""
    customers = []
    searched = false
    customer = nil
    rows = []
    drafts = [:]
    error = ""
    notice = ""
  }

  private func scheduleSearch() {
    searchTask?.cancel()
    let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    ticket += 1
    let mine = ticket
    guard typed.count >= 2 else {
      customers = []
      searched = false
      return
    }
    searchTask = Task { [weak self] in
      try? await Task.sleep(for: posCheckInSearchDebounce)
      guard let self, !Task.isCancelled else { return }
      do {
        let (day, found) = try await self.api.search(typed)
        guard mine == self.ticket else { return }
        self.error = ""
        if let day { self.day = day }
        self.customers = found
        self.searched = true
      } catch {
        guard mine == self.ticket else { return }
        self.error = (error as? ConsoleAPIError)?.message ?? "The search did not run."
      }
    }
  }

  func open(_ target: PosCheckInTarget) async {
    busy = true
    error = ""
    notice = ""
    defer { busy = false }
    do {
      let answer = try await api.customer(target)
      if let day = answer.day { self.day = day }
      customer = answer.customer
      rows = answer.rows
      drafts = [:]
      if answer.rows.isEmpty { notice = "Nothing to check in today for this customer." }
    } catch {
      self.error = (error as? ConsoleAPIError)?.message ?? "That customer could not be opened."
    }
  }

  func backToSearch() {
    customer = nil
    rows = []
    notice = ""
  }

  func checkIn(_ targets: [CheckInRow]) async {
    guard !targets.isEmpty else { return }
    var picks: [PosCheckInPick] = []
    for row in targets {
      let draft = drafts[row.id] ?? PosWristbandDraft()
      switch normalizeWristband(number: draft.number, color: draft.color) {
      case .ok(let band): picks.append(PosCheckInPick(id: row.id, wristband: band))
      case .refused(let message):
        error = message
        return
      }
    }
    busy = true
    error = ""
    notice = ""
    defer { busy = false }
    do {
      let answer = try await api.checkIn(
        picks, registerID: registerID(), assertion: assertion(), attemptKey: newAttemptKey("pos-check-in"))
      merge(answer.checkedIn + answer.alreadyCheckedIn)
      if let first = answer.alreadyCheckedIn.first, let day {
        notice = alreadyCheckedInLabel(
          checkedInAtMs: first.record.checkedInAtMs, checkedInByName: first.record.checkedInByName, timeZone: day.timeZone)
      }
    } catch {
      self.error = (error as? ConsoleAPIError)?.message ?? "They could not be checked in."
    }
  }

  func undo(_ row: CheckInRow) async {
    busy = true
    error = ""
    notice = ""
    defer { busy = false }
    do {
      merge([try await api.undo(row.id, registerID: registerID(), assertion: assertion())])
    } catch {
      self.error = (error as? ConsoleAPIError)?.message ?? "The check-in could not be undone."
    }
  }

  /// What a row says under its name: when and by whom it was checked in and the wristband, else its order or "Stay".
  func detail(_ row: CheckInRow) -> String {
    if row.checkedIn, let day { return checkedInLine(row.record, timeZone: day.timeZone) }
    return row.record.orderLabel ?? (row.record.source == .reservation ? "Stay" : "")
  }

  private func merge(_ changed: [CheckInRow]) {
    let byID = Dictionary(changed.map { ($0.id, $0) }) { _, last in last }
    rows = rows.map { byID[$0.id] ?? $0 }
  }
}

/// A customer search row's second line, as the console lists it: "1 of 3 checked in · Day pass, RV camping · email · phone".
func checkInCustomerLine(_ customer: CheckInCustomer) -> String {
  [
    "\(customer.unitsCheckedIn ?? 0) of \(customer.unitsDue ?? 0) checked in",
    (customer.items ?? []).joined(separator: ", "),
    customer.email ?? "",
    customer.phone ?? "",
  ].filter { !$0.isEmpty }.joined(separator: " · ")
}

/// The `posCheckIn` zone's params for one customer on one day, as the console hands its widgets
/// (`ConsolePosCheckInZoneProps`): never why anybody is checking them.
func posCheckInZoneParams(
  hostID: String, contactId: String?, email: String?, dayKey: String, name: String?, unitsDue: Int, placement: String
) -> [String: String] {
  var params = ["hostId": hostID, "dayKey": dayKey, "unitsDue": String(unitsDue), "placement": placement]
  if let contactId, !contactId.isEmpty { params["contactId"] = contactId }
  if let email, !email.isEmpty { params["email"] = email.lowercased() }
  if let name, !name.isEmpty { params["name"] = name }
  return params
}

/// The customer a sale is rung for, as the check-in route finds them: by email, else by their contact.
func checkInTarget(for customer: PosCustomer) -> PosCheckInTarget? {
  if let email = customer.email, !email.isEmpty { return PosCheckInTarget(email: email) }
  if customer.kind == "contact", !customer.id.isEmpty { return PosCheckInTarget(contactId: customer.id) }
  return nil
}

/// What the attached customer has to check in today (the console's customer panel): the day, how many still wait and
/// how many in all. Nothing when the route has nothing for the day or cannot be asked.
@MainActor @Observable
final class PosCheckInDue {
  private(set) var dayKey: String?
  private(set) var waiting = 0
  private(set) var total = 0
  @ObservationIgnored private let api: PosCheckInAPI

  init(api: PosCheckInAPI) { self.api = api }

  func load(_ customer: PosCustomer?) async {
    dayKey = nil
    waiting = 0
    total = 0
    guard let customer, var target = checkInTarget(for: customer) else { return }
    target.reconcile = "if-used"
    guard let answer = try? await api.customer(target), let day = answer.day, !Task.isCancelled else { return }
    dayKey = day.dayKey
    waiting = answer.rows.filter { !$0.checkedIn }.count
    total = answer.rows.count
  }
}
extension PosCheckInModel: Identifiable {}
