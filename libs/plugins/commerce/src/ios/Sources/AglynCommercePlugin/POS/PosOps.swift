// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * RUNNING THE REGISTER (AGL-3609, AGL-3651, AGL-3652): shifts and the cash
 * drawer, and the staff PINs that say who is ringing. The Kotlin app's
 * `PosOps.kt`, line for line.
 *
 * The app calls the SAME two routes the console register calls, as the signed
 * in member, so every gate holds on the device unchanged:
 *
 * - `commerce/pos-shift`: `current`, `open`, `cash-event`, `x-report`,
 *   `close`, `print-report`;
 * - `commerce/pos-staff-pin`: `roster`, `verify` (a right PIN buys a signed,
 *   short-lived statement that this member is at this register: the
 *   cashier assertion every sale, payment and shift call then carries),
 *   `refresh`.
 */

let posShiftRoute = "/api/commerce/pos-shift"
let posStaffPinRoute = "/api/commerce/pos-staff-pin"

/// The site's register rules (`posOpsSettings`), as the context route reports them.
struct PosOpsSettings: Equatable {
  var requireOpenShift = false
  var refundLimitCents = 0
  /// Minutes without a touch before the register locks; 0 never locks.
  var autoLockMinutes = 0
  var receiptAddress = ""
  var returnPolicy = ""
}

/// What a right PIN buys: a signed statement that this member is at this register.
struct PosStaffAssertion: Equatable {
  var assertion: String
  var expiresAtMs: Int
  var memberUID: String
  var name: String
  /// `cashier` switches who is ringing; `manager` approves one action.
  var purpose: String
}

/// A member who can switch in at this register: one with a PIN on this site.
struct PosRosterMember: Equatable, Identifiable {
  let uid: String
  let name: String
  var id: String { uid }
}

/// Whether the signed-in member has a PIN on this site, and whether they may manage everyone's.
struct PosPinStatus: Equatable {
  var hasPin: Bool
  var isManager: Bool
}

/// A shift with the id of its document.
struct PosShiftRecord: Equatable {
  let id: String
  let shift: PosShift
}

/// The open shift's figures so far.
struct PosXReport: Equatable {
  let shift: PosShiftRecord
  let report: PosShiftReport
}

/// A shift the close just froze, with its Z report.
struct PosClosedShift: Equatable {
  let shift: PosShiftRecord
  let report: PosShiftReport?
}

func readPosOpsSettings(_ body: JSONValue?) -> PosOpsSettings {
  let record = body?.objectValue ?? [:]
  return PosOpsSettings(
    requireOpenShift: record["requireOpenShift"]?.flag ?? false,
    refundLimitCents: record["refundLimitCents"]?.cents ?? 0,
    autoLockMinutes: min(240, max(0, record["autoLockMinutes"]?.cents ?? 0)),
    receiptAddress: record["receiptAddress"]?.stringValue ?? "",
    returnPolicy: record["returnPolicy"]?.stringValue ?? "")
}

private func decodeContract<T: Decodable>(_ type: T.Type, _ value: JSONValue?) -> T? {
  guard let value, let data = try? value.encoded() else { return nil }
  return try? JSONDecoder().decode(type, from: data)
}

func readShiftRecord(_ element: JSONValue?) -> PosShiftRecord? {
  guard let id = element?["id"]?.stringValue, let shift = decodeContract(PosShift.self, element) else { return nil }
  return PosShiftRecord(id: id, shift: shift)
}

func readShiftReport(_ element: JSONValue?) -> PosShiftReport? { decodeContract(PosShiftReport.self, element) }

func readStaffAssertion(_ body: JSONValue?) -> PosStaffAssertion? {
  guard let record = body?.objectValue, let assertion = record["assertion"]?.stringValue,
    let expires = record["expiresAtMs"]?.numberValue, let uid = record["memberUid"]?.stringValue
  else { return nil }
  return PosStaffAssertion(
    assertion: assertion, expiresAtMs: jsRound(expires), memberUID: uid,
    name: record["name"]?.stringValue ?? "Staff member", purpose: record["purpose"]?.stringValue ?? "cashier")
}

/// The cash movements the drawer records, in the order the dialog offers them.
let posCashTypes: [PosCashEventType] = [.paidIn, .paidOut, .drop]

/// The register's shift and PIN routes, as the signed-in member.
protocol PosOpsAPI: Sendable {
  func currentShift(registerID: String, assertion: String?) async throws -> PosShiftRecord?
  func openShift(registerID: String, assertion: String?, floatCents: Int) async throws -> PosShiftRecord
  func cashEvent(
    registerID: String, assertion: String?, type: PosCashEventType, amountCents: Int, reason: String, eventID: String
  ) async throws -> PosShiftRecord
  func xReport(registerID: String, assertion: String?) async throws -> PosXReport
  func closeShift(registerID: String, assertion: String?, shiftID: String, countedCents: Int, note: String)
    async throws -> PosClosedShift
  /// True when a cloud receipt printer took the report; false leaves the report on screen.
  func printReport(registerID: String, assertion: String?, shiftID: String?, attemptKey: String) async throws -> Bool
  func roster() async throws -> [PosRosterMember]
  func pinStatus() async throws -> PosPinStatus
  /// Sets a PIN; `memberUID` nil is the signed-in member's own, anyone else's needs a workspace admin.
  func setPin(memberUID: String?, pin: String) async throws
  func clearPin(memberUID: String?) async throws
  func verifyPin(registerID: String, memberUID: String, pin: String, purpose: String) async throws -> PosStaffAssertion
  func refresh(registerID: String, assertion: String) async throws -> PosStaffAssertion?
}

struct ConsolePosOpsAPI: PosOpsAPI {
  let api: ConsoleAPIClient
  let hostID: String

  private func shiftCall(
    registerID: String, assertion: String?, action: String, _ extra: [String: JSONValue] = [:]
  ) async throws -> [String: JSONValue] {
    var body: [String: JSONValue] = [
      "hostId": .string(hostID), "registerId": .string(registerID), "action": .string(action),
    ]
    if let assertion { body["cashierAssertion"] = .string(assertion) }
    body.merge(extra) { _, given in given }
    return try await api.request(posShiftRoute, method: .post, body: .object(body))?.objectValue ?? [:]
  }

  func currentShift(registerID: String, assertion: String?) async throws -> PosShiftRecord? {
    readShiftRecord(try await shiftCall(registerID: registerID, assertion: assertion, action: "current")["shift"])
  }

  func openShift(registerID: String, assertion: String?, floatCents: Int) async throws -> PosShiftRecord {
    let answer = try await shiftCall(
      registerID: registerID, assertion: assertion, action: "open", ["openingFloatCents": .number(Double(floatCents))])
    guard let shift = readShiftRecord(answer["shift"]) else { throw PosOpsFailure.noShift }
    return shift
  }

  func cashEvent(
    registerID: String, assertion: String?, type: PosCashEventType, amountCents: Int, reason: String, eventID: String
  ) async throws -> PosShiftRecord {
    let answer = try await shiftCall(
      registerID: registerID, assertion: assertion, action: "cash-event",
      [
        "type": .string(type.rawValue), "amountCents": .number(Double(amountCents)),
        "reason": .string(reason.trimmingCharacters(in: .whitespacesAndNewlines)), "eventId": .string(eventID),
      ])
    guard let shift = readShiftRecord(answer["shift"]) else { throw PosOpsFailure.noShift }
    return shift
  }

  func xReport(registerID: String, assertion: String?) async throws -> PosXReport {
    let answer = try await shiftCall(registerID: registerID, assertion: assertion, action: "x-report")
    guard let shift = readShiftRecord(answer["shift"]) else { throw PosOpsFailure.noShift }
    guard let report = readShiftReport(answer["report"]) else { throw PosOpsFailure.noReport }
    return PosXReport(shift: shift, report: report)
  }

  func closeShift(registerID: String, assertion: String?, shiftID: String, countedCents: Int, note: String)
    async throws -> PosClosedShift
  {
    var extra: [String: JSONValue] = ["shiftId": .string(shiftID), "countedCashCents": .number(Double(countedCents))]
    let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmed.isEmpty { extra["note"] = .string(trimmed) }
    let answer = try await shiftCall(registerID: registerID, assertion: assertion, action: "close", extra)
    guard let shift = readShiftRecord(answer["shift"]) else { throw PosOpsFailure.noShift }
    return PosClosedShift(shift: shift, report: readShiftReport(answer["report"]))
  }

  func printReport(registerID: String, assertion: String?, shiftID: String?, attemptKey: String) async throws -> Bool {
    var extra: [String: JSONValue] = ["attemptKey": .string(attemptKey)]
    if let shiftID { extra["shiftId"] = .string(shiftID) }
    return try await shiftCall(registerID: registerID, assertion: assertion, action: "print-report", extra)["printed"]?.flag
      ?? false
  }

  func roster() async throws -> [PosRosterMember] {
    let answer = try await api.request(
      posStaffPinRoute, method: .post, body: .object(["hostId": .string(hostID), "action": "roster"]))
    return (answer?["members"]?.arrayValue ?? []).compactMap { member in
      guard let uid = member["uid"]?.stringValue else { return nil }
      return PosRosterMember(uid: uid, name: member["name"]?.stringValue ?? "Staff member")
    }
  }

  func pinStatus() async throws -> PosPinStatus {
    let answer = try await api.request(
      posStaffPinRoute, method: .post, body: .object(["hostId": .string(hostID), "action": "status"]))
    return PosPinStatus(hasPin: answer?["hasPin"]?.flag ?? false, isManager: answer?["isManager"]?.flag ?? false)
  }

  func setPin(memberUID: String?, pin: String) async throws {
    var body: [String: JSONValue] = ["hostId": .string(hostID), "action": "set", "pin": .string(pin)]
    if let memberUID { body["memberUid"] = .string(memberUID) }
    _ = try await api.request(posStaffPinRoute, method: .post, body: .object(body))
  }

  func clearPin(memberUID: String?) async throws {
    var body: [String: JSONValue] = ["hostId": .string(hostID), "action": "clear"]
    if let memberUID { body["memberUid"] = .string(memberUID) }
    _ = try await api.request(posStaffPinRoute, method: .post, body: .object(body))
  }

  func verifyPin(registerID: String, memberUID: String, pin: String, purpose: String) async throws -> PosStaffAssertion {
    let answer = try await api.request(
      posStaffPinRoute, method: .post,
      body: .object([
        "hostId": .string(hostID), "registerId": .string(registerID), "action": "verify", "purpose": .string(purpose),
        "memberUid": .string(memberUID), "pin": .string(pin),
      ]))
    guard let assertion = readStaffAssertion(answer) else { throw PosOpsFailure.pinRefused }
    return assertion
  }

  func refresh(registerID: String, assertion: String) async throws -> PosStaffAssertion? {
    readStaffAssertion(
      try await api.request(
        posStaffPinRoute, method: .post,
        body: .object([
          "hostId": .string(hostID), "registerId": .string(registerID), "action": "refresh",
          "assertion": .string(assertion),
        ])))
  }
}

/// What a route answered when it answered nothing usable.
enum PosOpsFailure: LocalizedError {
  case noShift, noReport, pinRefused
  var errorDescription: String? {
    switch self {
    case .noShift: "The register did not answer with a shift."
    case .noReport: "The register did not answer with a report."
    case .pinRefused: "That PIN did not work."
    }
  }
}

/// The register's shift and PIN routes where there is no console to ask: every call finds it unreachable.
struct OfflinePosOps: PosOpsAPI {
  private func unreachable() -> ConsoleAPIError {
    ConsoleAPIError(status: 0, message: "The register is offline. Check the connection and try again.")
  }
  func currentShift(registerID: String, assertion: String?) async throws -> PosShiftRecord? { throw unreachable() }
  func openShift(registerID: String, assertion: String?, floatCents: Int) async throws -> PosShiftRecord { throw unreachable() }
  func cashEvent(
    registerID: String, assertion: String?, type: PosCashEventType, amountCents: Int, reason: String, eventID: String
  ) async throws -> PosShiftRecord { throw unreachable() }
  func xReport(registerID: String, assertion: String?) async throws -> PosXReport { throw unreachable() }
  func closeShift(registerID: String, assertion: String?, shiftID: String, countedCents: Int, note: String)
    async throws -> PosClosedShift
  { throw unreachable() }
  func printReport(registerID: String, assertion: String?, shiftID: String?, attemptKey: String) async throws -> Bool {
    throw unreachable()
  }
  func roster() async throws -> [PosRosterMember] { throw unreachable() }
  func pinStatus() async throws -> PosPinStatus { throw unreachable() }
  func setPin(memberUID: String?, pin: String) async throws { throw unreachable() }
  func clearPin(memberUID: String?) async throws { throw unreachable() }
  func verifyPin(registerID: String, memberUID: String, pin: String, purpose: String) async throws -> PosStaffAssertion {
    throw unreachable()
  }
  func refresh(registerID: String, assertion: String) async throws -> PosStaffAssertion? { throw unreachable() }
}
