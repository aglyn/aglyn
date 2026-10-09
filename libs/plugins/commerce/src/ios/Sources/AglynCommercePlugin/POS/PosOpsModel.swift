// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/// Refresh a cashier assertion this long before it expires (the console's margin).
let cashierRefreshMarginMs = 3 * 60 * 1000

/// How often the register checks the idle clock and the expiry.
let cashierTick: Duration = .seconds(15)

private func wallClockMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

/// Who is at the register. Holds the cashier a PIN switched in, refreshes
/// their assertion while they keep working (the server re-checks their role
/// on every refresh), and LOCKS the register after the site's idle minutes,
/// dropping the assertion so the next person must enter their own PIN. An
/// expired assertion the refresh could not renew drops back to the signed-in
/// member rather than ringing sales under a name the server would refuse.
/// The Kotlin app's `PosCashier`.
@MainActor
@Observable
final class PosCashier {
  /// The member a PIN switched in, or nil for whoever is signed in.
  private(set) var cashier: PosStaffAssertion? { didSet { assertionSink?(cashier?.assertion) } }
  /// The register is locked and waits for a PIN.
  private(set) var locked = false
  /// The assertion every register call carries, or nil.
  var assertion: String? { cashier?.assertion }

  @ObservationIgnored private let api: PosOpsAPI
  @ObservationIgnored private let registerID: () -> String?
  @ObservationIgnored private let autoLockMinutes: () -> Int
  @ObservationIgnored private let now: () -> Int
  @ObservationIgnored private var lastActivity: Int
  @ObservationIgnored private var refreshing = false
  /// Told the assertion after every change, so the sale routes (which are `Sendable`) can name the cashier.
  @ObservationIgnored var assertionSink: ((String?) -> Void)?

  init(
    api: PosOpsAPI, registerID: @escaping () -> String?, autoLockMinutes: @escaping () -> Int,
    now: @escaping () -> Int = wallClockMs
  ) {
    self.api = api
    self.registerID = registerID
    self.autoLockMinutes = autoLockMinutes
    self.now = now
    lastActivity = now()
  }

  /// A tap or a key: the register is in use.
  func touch() { lastActivity = now() }

  func switchTo(_ next: PosStaffAssertion) {
    touch()
    cashier = next
    locked = false
  }

  /// Back to the signed-in member.
  func signOut() { cashier = nil }

  func lock() {
    cashier = nil
    locked = true
  }

  /// Lifts a lock without a PIN: only for a site where nobody has one.
  func unlock() {
    touch()
    locked = false
  }

  /// A different register is a different till: nobody carries over.
  func reset() {
    cashier = nil
    locked = false
    touch()
  }

  /// One beat of the clock: locks an idle register, renews a working cashier's assertion.
  func tick() async {
    let time = now()
    let minutes = autoLockMinutes()
    if minutes > 0, !locked, time - lastActivity > minutes * 60_000 {
      cashier = nil
      locked = true
      return
    }
    guard let current = cashier else { return }
    if time >= current.expiresAtMs {
      cashier = nil
      return
    }
    if current.expiresAtMs - time > cashierRefreshMarginMs || refreshing { return }
    // Only a cashier who is still working earns a fresh assertion.
    if time - lastActivity > cashierRefreshMarginMs { return }
    guard let register = registerID() else { return }
    refreshing = true
    defer { refreshing = false }
    do {
      if let fresh = try await api.refresh(registerID: register, assertion: current.assertion),
        cashier?.memberUID == current.memberUID
      {
        var renewed = current
        renewed.assertion = fresh.assertion
        renewed.expiresAtMs = fresh.expiresAtMs
        cashier = renewed
      }
    } catch let error as ConsoleAPIError where error.status == 401 || error.status == 403 {
      cashier = nil
    } catch {}
  }
}

/// The PIN pad for one prompt: the roster, the pick, the digits.
@MainActor
@Observable
final class PosPinPadModel {
  private(set) var members: [PosRosterMember]?
  private(set) var memberUID = ""
  private(set) var pin = ""
  private(set) var error: String?
  private(set) var busy = false
  let purpose: String

  @ObservationIgnored private let api: PosOpsAPI
  @ObservationIgnored private let registerID: String
  @ObservationIgnored private let onVerified: (PosStaffAssertion) -> Void

  init(api: PosOpsAPI, registerID: String, purpose: String, onVerified: @escaping (PosStaffAssertion) -> Void) {
    self.api = api
    self.registerID = registerID
    self.purpose = purpose
    self.onVerified = onVerified
  }

  /// Nobody on the site has a PIN: a lock nobody can open is no lock, so the pad may close.
  var nobodyHasAPin: Bool { members?.isEmpty == true && error == nil }

  var canSubmit: Bool { !busy && !memberUID.isEmpty && pin.count >= 4 }

  func load() async {
    do {
      let list = try await api.roster()
      members = list
      if list.count == 1 { memberUID = list[0].uid }
    } catch {
      members = []
      self.error = (error as? ConsoleAPIError)?.message ?? "Could not load the staff list."
    }
  }

  func pick(_ uid: String) {
    memberUID = uid
    error = nil
  }

  func press(_ key: String) {
    switch key {
    case "clear": pin = ""
    case "back": pin = String(pin.dropLast())
    default: if key.count == 1, key.first?.isNumber == true, pin.count < 6 { pin += key }
    }
  }

  func submit() async {
    guard canSubmit else { return }
    let value = pin
    busy = true
    error = nil
    defer { busy = false }
    do {
      let assertion = try await api.verifyPin(registerID: registerID, memberUID: memberUID, pin: value, purpose: purpose)
      pin = ""
      onVerified(assertion)
    } catch {
      pin = ""
      self.error = (error as? ConsoleAPIError)?.message ?? "That PIN did not work."
    }
  }
}

/// The dialogs the shift opens, one at a time.
enum ShiftDialog { case open, cash, report, close }

/// The register's shift: open it with a starting float, record cash paid in,
/// paid out and dropped to the safe, read the X report at any time, and close
/// with a count; the Z report freezes the figures and the variance. The
/// server decides every figure; this reads the shift it names.
@MainActor
@Observable
final class PosShiftModel {
  /// The register's open shift; nil while none is open (or before it is read).
  private(set) var shift: PosShiftRecord?
  private(set) var loaded = false
  private(set) var dialog: ShiftDialog?
  private(set) var busy = false
  private(set) var error: String?
  var notice: String?
  /// The X report while its dialog is open.
  private(set) var report: PosShiftReport?
  /// The shift a close just froze: the Z report.
  private(set) var closed: PosClosedShift?
  /// One id per Cash in/out dialog, so a retried tap records one event.
  private(set) var eventKey: String

  @ObservationIgnored private let api: PosOpsAPI
  @ObservationIgnored private let registerID: () -> String?
  @ObservationIgnored private let assertion: () -> String?
  @ObservationIgnored private let mintKey: () -> String

  init(
    api: PosOpsAPI, registerID: @escaping () -> String?, assertion: @escaping () -> String?,
    mintKey: @escaping () -> String = { newAttemptKey("pos-shift") }
  ) {
    self.api = api
    self.registerID = registerID
    self.assertion = assertion
    self.mintKey = mintKey
    eventKey = mintKey()
  }

  func refresh() async {
    guard let register = registerID() else { return }
    do {
      shift = try await api.currentShift(registerID: register, assertion: assertion()).flatMap {
        $0.shift.status == .open ? $0 : nil
      }
    } catch {}
    loaded = true
  }

  func open(_ next: ShiftDialog) {
    dialog = next
    error = nil
    report = nil
    closed = nil
    if next == .cash { eventKey = mintKey() }
    if next == .report || next == .close { Task { await loadReport() } }
  }

  func dismiss() {
    if busy { return }
    dialog = nil
    error = nil
    report = nil
    closed = nil
  }

  private func loadReport() async {
    guard let register = registerID() else { return }
    do {
      let answer = try await api.xReport(registerID: register, assertion: assertion())
      shift = answer.shift
      report = answer.report
    } catch {
      self.error = describe(error, "Could not read the shift.")
    }
  }

  private func describe(_ failure: Error, _ fallback: String) -> String {
    (failure as? ConsoleAPIError)?.message ?? (failure as? LocalizedError)?.errorDescription ?? fallback
  }

  /// Runs one shift call; keeps the dialog open with the reason when it fails.
  private func run(_ fallback: String, success: String?, _ call: (String) async throws -> Void) async {
    guard !busy, let register = registerID() else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      try await call(register)
      if let success { notice = success }
    } catch {
      self.error = describe(error, fallback)
      // A shift another tablet opened or closed: read the register's own.
      if (error as? ConsoleAPIError)?.status == 409 { Task { await refresh() } }
    }
  }

  func submitOpen(_ amountText: String) async {
    guard let cents = amountText.trimmingCharacters(in: .whitespaces).isEmpty ? 0 : centsFromText(amountText) else {
      error = "Enter the starting cash, like 150.00."
      return
    }
    await run("Could not open the shift.", success: "Shift opened") { register in
      shift = try await api.openShift(registerID: register, assertion: assertion(), floatCents: cents)
      dialog = nil
    }
  }

  func submitCash(_ type: PosCashEventType, amount: String, reason: String) async {
    guard let cents = centsFromText(amount), cents > 0 else {
      error = "Enter an amount above zero."
      return
    }
    if type != .drop, reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      error = "Say what the cash was for."
      return
    }
    let label = ContractValues.shared.posCashEventLabels[type.rawValue] ?? type.rawValue
    await run("Could not record the cash.", success: "\(label) recorded") { register in
      shift = try await api.cashEvent(
        registerID: register, assertion: assertion(), type: type, amountCents: cents, reason: reason, eventID: eventKey)
      dialog = nil
    }
  }

  func submitClose(counted: String, note: String) async {
    guard let cents = centsFromText(counted) else {
      error = "Enter the cash you counted, like 212.40."
      return
    }
    guard let current = shift else {
      error = "No shift is open on this register."
      return
    }
    await run("Could not close the shift.", success: nil) { register in
      closed = try await api.closeShift(
        registerID: register, assertion: assertion(), shiftID: current.id, countedCents: cents, note: note)
      shift = nil
    }
  }

  /// Sends the X report (or the frozen Z report) to the register's receipt printer.
  func print(shiftID: String?) async {
    await run("Could not print the report.", success: nil) { register in
      let printed = try await api.printReport(
        registerID: register, assertion: assertion(), shiftID: shiftID, attemptKey: mintKey())
      notice = printed ? "Sent to the receipt printer" : "This register has no receipt printer. The report stays on screen."
    }
  }
}

/// Staff PINs: each member who works the register sets their own 4 to 6 digit
/// PIN, which switches the cashier on a shared tablet without signing anybody
/// out and never grants more than that member's role. A workspace admin can
/// reset or remove anyone's, which also lifts a lockout.
@MainActor
@Observable
final class PosStaffPinsModel {
  private(set) var status: PosPinStatus?
  private(set) var roster: [PosRosterMember] = []
  private(set) var refusal: String?
  /// Whose PIN the dialog sets: nil is the signed-in member's own.
  private(set) var editing: PosRosterMember?
  private(set) var dialogOpen = false
  private(set) var error: String?
  private(set) var busy = false
  var notice: String?

  @ObservationIgnored private let api: PosOpsAPI

  init(api: PosOpsAPI) { self.api = api }

  func load() async {
    do {
      let current = try await api.pinStatus()
      status = current
      refusal = nil
      roster = current.isManager ? ((try? await api.roster()) ?? []) : []
    } catch {
      refusal = (error as? ConsoleAPIError)?.message ?? "Could not read your PIN."
    }
  }

  func startEdit(_ member: PosRosterMember?) {
    editing = member
    dialogOpen = true
    error = nil
  }

  func closeDialog() {
    if busy { return }
    dialogOpen = false
    editing = nil
    error = nil
  }

  func save(pin: String, again: String) async {
    if busy { return }
    if let problem = posPinProblem(pin) {
      error = problem
      return
    }
    if pin != again {
      error = "The two PINs do not match."
      return
    }
    busy = true
    error = nil
    defer { busy = false }
    let target = editing
    do {
      try await api.setPin(memberUID: target?.uid, pin: pin)
      notice = target.map { "PIN reset for \($0.name)" } ?? "Your PIN is set"
      dialogOpen = false
      editing = nil
      await load()
    } catch {
      self.error = (error as? ConsoleAPIError)?.message ?? "Could not save the PIN."
    }
  }

  func remove(_ member: PosRosterMember?) async {
    if busy { return }
    busy = true
    defer { busy = false }
    do {
      try await api.clearPin(memberUID: member?.uid)
      notice = member.map { "\($0.name)'s PIN is removed" } ?? "Your PIN is removed"
      await load()
    } catch {
      notice = (error as? ConsoleAPIError)?.message ?? "Could not remove the PIN."
    }
  }
}
