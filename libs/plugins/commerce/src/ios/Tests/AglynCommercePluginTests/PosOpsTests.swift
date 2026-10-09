// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

private func shiftOf(_ status: PosShiftStatus = .open, float: Double = 15_000) -> PosShift {
  PosShift(
    cashEvents: [], hostId: "h1", openedAtMs: 1_700_000_000_000, openedBy: "u1", openingFloatCents: float,
    registerId: "r1", status: status)
}

private func report(expected: Double = 21_240) -> PosShiftReport {
  PosShiftReport(
    cashRefundsCents: 0, cashSalesCents: 6_240, discountsCents: 0, dropsCents: 0, expectedCashCents: expected,
    grossSalesCents: 6_240, netSalesCents: 6_240, openingFloatCents: 15_000, orderCount: 3, paidInCents: 0,
    paidOutCents: 0, refundCount: 0, refundsByTender: [:], refundsCents: 0, salesByTender: ["cash": 6_240], taxCents: 0,
    tipsCents: 0)
}

private let ana = PosStaffAssertion(assertion: "a-1", expiresAtMs: 1_000_000, memberUID: "u1", name: "Ana", purpose: "cashier")

/// A script of answers for the shift and PIN routes, recording what was asked.
private final class FakeOps: PosOpsAPI, @unchecked Sendable {
  private let lock = NSLock()
  private var recorded: [String] = []
  var calls: [String] { lock.withLock { recorded } }
  var current: PosShiftRecord?
  var failWith: Error?
  var members = [PosRosterMember(uid: "u1", name: "Ana"), PosRosterMember(uid: "u2", name: "Ben")]
  var refreshed: PosStaffAssertion?
  var printed = false

  private func note(_ call: String) throws {
    lock.withLock { recorded.append(call) }
    if let failWith { throw failWith }
  }

  func currentShift(registerID: String, assertion: String?) async throws -> PosShiftRecord? {
    try note("current \(registerID) \(assertion ?? "-")")
    return current
  }
  func openShift(registerID: String, assertion: String?, floatCents: Int) async throws -> PosShiftRecord {
    try note("open \(registerID) \(assertion ?? "-") \(floatCents)")
    let record = PosShiftRecord(id: "s1", shift: shiftOf(float: Double(floatCents)))
    current = record
    return record
  }
  func cashEvent(
    registerID: String, assertion: String?, type: PosCashEventType, amountCents: Int, reason: String, eventID: String
  ) async throws -> PosShiftRecord {
    try note("cash \(type.rawValue) \(amountCents) '\(reason)' \(eventID)")
    return current ?? PosShiftRecord(id: "s1", shift: shiftOf())
  }
  func xReport(registerID: String, assertion: String?) async throws -> PosXReport {
    try note("x-report")
    return PosXReport(shift: current ?? PosShiftRecord(id: "s1", shift: shiftOf()), report: report())
  }
  func closeShift(registerID: String, assertion: String?, shiftID: String, countedCents: Int, note: String)
    async throws -> PosClosedShift
  {
    try self.note("close \(shiftID) \(countedCents) '\(note)'")
    return PosClosedShift(shift: PosShiftRecord(id: shiftID, shift: shiftOf(.closed)), report: report())
  }
  func printReport(registerID: String, assertion: String?, shiftID: String?, attemptKey: String) async throws -> Bool {
    try note("print \(shiftID ?? "-")")
    return printed
  }
  func roster() async throws -> [PosRosterMember] {
    try note("roster")
    return members
  }
  var status = PosPinStatus(hasPin: false, isManager: false)
  func pinStatus() async throws -> PosPinStatus {
    try note("status")
    return status
  }
  func setPin(memberUID: String?, pin: String) async throws {
    try note("set-pin \(memberUID ?? "me") \(pin)")
    status.hasPin = true
  }
  func clearPin(memberUID: String?) async throws {
    try note("clear-pin \(memberUID ?? "me")")
    status.hasPin = false
  }
  func verifyPin(registerID: String, memberUID: String, pin: String, purpose: String) async throws -> PosStaffAssertion {
    try note("verify \(memberUID) \(pin) \(purpose)")
    return PosStaffAssertion(
      assertion: "assert-\(memberUID)", expiresAtMs: 10_000_000, memberUID: memberUID,
      name: members.first { $0.uid == memberUID }?.name ?? "", purpose: purpose)
  }
  func refresh(registerID: String, assertion: String) async throws -> PosStaffAssertion? {
    try note("refresh \(assertion)")
    return refreshed
  }
}

@MainActor
final class PosCashierTests: XCTestCase {
  private final class Clock: @unchecked Sendable { var ms = 0 }

  private func cashier(_ ops: FakeOps, minutes: Int, _ clock: Clock) -> PosCashier {
    PosCashier(api: ops, registerID: { "r1" }, autoLockMinutes: { minutes }, now: { clock.ms })
  }

  func testAnIdleRegisterLocksAndDropsTheCashier() async {
    let clock = Clock()
    let till = cashier(FakeOps(), minutes: 5, clock)
    till.switchTo(ana)
    clock.ms = 4 * 60_000
    await till.tick()
    XCTAssertFalse(till.locked)
    clock.ms = 5 * 60_000 + 1
    await till.tick()
    XCTAssertTrue(till.locked)
    XCTAssertNil(till.cashier, "the next person enters their own PIN")
  }

  func testATouchKeepsTheRegisterAwakeAndZeroMinutesNeverLocks() async {
    let clock = Clock()
    let busy = cashier(FakeOps(), minutes: 5, clock)
    clock.ms = 4 * 60_000
    busy.touch()
    clock.ms = 8 * 60_000
    await busy.tick()
    XCTAssertFalse(busy.locked)
    let never = cashier(FakeOps(), minutes: 0, clock)
    clock.ms = 10 * 60 * 60_000
    await never.tick()
    XCTAssertFalse(never.locked)
  }

  func testAWorkingCashierEarnsAFreshAssertionBeforeItExpires() async {
    let clock = Clock()
    let ops = FakeOps()
    ops.refreshed = PosStaffAssertion(assertion: "a-2", expiresAtMs: 2_000_000, memberUID: "u1", name: "Ana", purpose: "cashier")
    let till = cashier(ops, minutes: 0, clock)
    var short = ana
    short.expiresAtMs = 5 * 60_000
    till.switchTo(short)
    clock.ms = 3 * 60_000
    till.touch()
    await till.tick()
    XCTAssertEqual(till.assertion, "a-2")
    XCTAssertEqual(till.cashier?.expiresAtMs, 2_000_000)
  }

  func testAnAssertionThatExpiredOrWasRefusedDropsBackToTheSignedInMember() async {
    let clock = Clock()
    let ops = FakeOps()
    let till = cashier(ops, minutes: 0, clock)
    var short = ana
    short.expiresAtMs = 100_000
    till.switchTo(short)
    clock.ms = 100_001
    await till.tick()
    XCTAssertNil(till.cashier, "an expired assertion is dropped")

    short.expiresAtMs = 5 * 60_000
    till.switchTo(short)
    clock.ms = 100_001 + 3 * 60_000
    till.touch()
    ops.failWith = ConsoleAPIError(status: 403, message: "Not permitted")
    await till.tick()
    XCTAssertNil(till.cashier, "a refused refresh drops the cashier")
  }

  func testSwitchingRegistersLeavesNobodyAtTheNewTill() {
    let till = cashier(FakeOps(), minutes: 0, Clock())
    till.switchTo(ana)
    till.lock()
    till.reset()
    XCTAssertNil(till.cashier)
    XCTAssertFalse(till.locked)
  }

  func testTheSaleRoutesNameTheCashierWhoIsRinging() {
    let box = CashierAssertionBox()
    let till = cashier(FakeOps(), minutes: 0, Clock())
    till.assertionSink = { box.assertion = $0 }
    till.switchTo(ana)
    XCTAssertEqual(box.assertion, "a-1")
    till.signOut()
    XCTAssertNil(box.assertion)
  }
}

@MainActor
final class PosPinPadTests: XCTestCase {
  func testAPinPadPicksYourNameTapsDigitsAndGetsAnAssertion() async {
    let ops = FakeOps()
    var verified: PosStaffAssertion?
    let pad = PosPinPadModel(api: ops, registerID: "r1", purpose: "cashier") { verified = $0 }
    await pad.load()
    XCTAssertEqual(pad.members?.count, 2)
    XCTAssertFalse(pad.canSubmit)
    pad.pick("u2")
    "12345678".forEach { pad.press(String($0)) }
    XCTAssertEqual(pad.pin, "123456", "a PIN is at most six digits")
    pad.press("back")
    XCTAssertEqual(pad.pin, "12345")
    pad.press("clear")
    "4321".forEach { pad.press(String($0)) }
    await pad.submit()
    XCTAssertEqual(ops.calls.last, "verify u2 4321 cashier")
    XCTAssertEqual(verified?.name, "Ben")
    XCTAssertEqual(pad.pin, "", "the digits are cleared once sent")
  }

  func testAWrongPinShowsTheRoutesWordsAndClearsTheDigits() async {
    let ops = FakeOps()
    let pad = PosPinPadModel(api: ops, registerID: "r1", purpose: "cashier") { _ in }
    await pad.load()
    pad.pick("u1")
    "9999".forEach { pad.press(String($0)) }
    ops.failWith = ConsoleAPIError(status: 401, message: "That PIN is not right. 4 tries left.")
    await pad.submit()
    XCTAssertEqual(pad.error, "That PIN is not right. 4 tries left.")
    XCTAssertEqual(pad.pin, "")
  }

  func testASiteWithNoPinsLetsTheLockBeClosedAndASingleMemberIsPicked() async {
    let none = FakeOps()
    none.members = []
    let empty = PosPinPadModel(api: none, registerID: "r1", purpose: "cashier") { _ in }
    await empty.load()
    XCTAssertTrue(empty.nobodyHasAPin)

    let one = FakeOps()
    one.members = [PosRosterMember(uid: "u1", name: "Ana")]
    let single = PosPinPadModel(api: one, registerID: "r1", purpose: "manager") { _ in }
    await single.load()
    XCTAssertEqual(single.memberUID, "u1")
  }
}

@MainActor
final class PosStaffPinsTests: XCTestCase {
  func testAMemberSetsTheirOwnPinAfterTheSamePinChecksAsTheConsole() async {
    let ops = FakeOps()
    let pins = PosStaffPinsModel(api: ops)
    await pins.load()
    XCTAssertEqual(pins.status?.hasPin, false)
    pins.startEdit(nil)
    await pins.save(pin: "12", again: "12")
    XCTAssertEqual(pins.error, "A PIN is 4 to 6 digits.")
    await pins.save(pin: "1234", again: "1234")
    XCTAssertEqual(pins.error, "Pick a PIN that is not a straight run like 1234.")
    await pins.save(pin: "4821", again: "4822")
    XCTAssertEqual(pins.error, "The two PINs do not match.")
    XCTAssertTrue(ops.calls.filter { $0.hasPrefix("set-pin") }.isEmpty)
    await pins.save(pin: "4821", again: "4821")
    XCTAssertEqual(ops.calls.filter { $0.hasPrefix("set-pin") }, ["set-pin me 4821"])
    XCTAssertEqual(pins.notice, "Your PIN is set")
    XCTAssertEqual(pins.status?.hasPin, true)
    XCTAssertFalse(pins.dialogOpen)
  }

  func testAWorkspaceAdminSeesTheStaffWithPinsAndResetsOne() async {
    let ops = FakeOps()
    ops.status = PosPinStatus(hasPin: true, isManager: true)
    let pins = PosStaffPinsModel(api: ops)
    await pins.load()
    XCTAssertEqual(pins.roster.count, 2)
    pins.startEdit(pins.roster[1])
    await pins.save(pin: "4821", again: "4821")
    XCTAssertEqual(ops.calls.filter { $0.hasPrefix("set-pin") }, ["set-pin u2 4821"])
    XCTAssertEqual(pins.notice, "PIN reset for Ben")
    await pins.remove(pins.roster[0])
    XCTAssertEqual(ops.calls.last { $0.hasPrefix("clear-pin") }, "clear-pin u1")
  }

  func testAMemberWhoCannotUseTheRegisterIsToldSoInTheRoutesWords() async {
    let ops = FakeOps()
    ops.failWith = ConsoleAPIError(status: 403, message: "Not permitted")
    let pins = PosStaffPinsModel(api: ops)
    await pins.load()
    XCTAssertEqual(pins.refusal, "Not permitted")
    XCTAssertNil(pins.status)
  }
}

@MainActor
final class PosShiftModelTests: XCTestCase {
  private func model(_ ops: FakeOps, key: String = "key-1") -> PosShiftModel {
    PosShiftModel(api: ops, registerID: { "r1" }, assertion: { "a-1" }, mintKey: { key })
  }

  func testOpensWithTheStartingFloatInCentsAsTheNamedCashier() async {
    let ops = FakeOps()
    let shift = model(ops)
    shift.open(.open)
    await shift.submitOpen("150.00")
    XCTAssertEqual(ops.calls.last, "open r1 a-1 15000")
    XCTAssertEqual(shift.shift?.id, "s1")
    XCTAssertNil(shift.dialog)
    XCTAssertEqual(shift.notice, "Shift opened")
  }

  func testAnEmptyFloatIsZeroAndNonsenseIsRefusedWithoutACall() async {
    let ops = FakeOps()
    let shift = model(ops)
    await shift.submitOpen("")
    XCTAssertEqual(ops.calls.last, "open r1 a-1 0")
    let calls = ops.calls.count
    shift.open(.open)
    await shift.submitOpen("lots")
    XCTAssertEqual(shift.error, "Enter the starting cash, like 150.00.")
    XCTAssertEqual(ops.calls.count, calls)
  }

  func testACashMovementNeedsAnAmountAndAReasonExceptForADrop() async {
    let ops = FakeOps()
    let shift = model(ops)
    shift.open(.cash)
    await shift.submitCash(.paidOut, amount: "0", reason: "milk")
    XCTAssertEqual(shift.error, "Enter an amount above zero.")
    await shift.submitCash(.paidOut, amount: "12.50", reason: " ")
    XCTAssertEqual(shift.error, "Say what the cash was for.")
    XCTAssertTrue(ops.calls.isEmpty)
    await shift.submitCash(.drop, amount: "200", reason: "")
    XCTAssertEqual(ops.calls.last, "cash drop 20000 '' key-1")
    XCTAssertEqual(shift.notice, "Safe drop recorded")
  }

  func testARetriedCashTapIsTheSameEvent() async {
    let ops = FakeOps()
    var minted = 0
    let shift = PosShiftModel(api: ops, registerID: { "r1" }, assertion: { nil }, mintKey: {
      minted += 1
      return "evt-\(minted)"
    })
    shift.open(.cash)
    let first = shift.eventKey
    ops.failWith = ConsoleAPIError(status: 503, message: "Server hiccup")
    await shift.submitCash(.paidIn, amount: "5", reason: "float top-up")
    XCTAssertEqual(shift.error, "Server hiccup")
    ops.failWith = nil
    await shift.submitCash(.paidIn, amount: "5", reason: "float top-up")
    XCTAssertEqual(
      ops.calls.filter { $0.hasPrefix("cash") }, Array(repeating: "cash paid_in 500 'float top-up' \(first)", count: 2))
    shift.open(.cash)
    XCTAssertNotEqual(shift.eventKey, first, "a new dialog is a new event")
  }

  func testClosingShowsTheXReportThenFreezesTheZReport() async {
    let ops = FakeOps()
    ops.current = PosShiftRecord(id: "s1", shift: shiftOf())
    let shift = model(ops)
    await shift.refresh()
    XCTAssertEqual(shift.shift?.id, "s1")
    shift.open(.close)
    for _ in 0..<100 where shift.report == nil { try? await Task.sleep(for: .milliseconds(10)) }
    XCTAssertEqual(shift.report?.expectedCashCents, 21_240)
    await shift.submitClose(counted: "212.40", note: "Counted twice")
    XCTAssertEqual(ops.calls.last, "close s1 21240 'Counted twice'")
    XCTAssertNotNil(shift.closed)
    XCTAssertNil(shift.shift, "the register has no open shift once it closes")
  }

  func testPrintingSaysWhetherAPrinterTookTheReport() async {
    let ops = FakeOps()
    let shift = model(ops)
    await shift.print(shiftID: "s1")
    XCTAssertEqual(shift.notice, "This register has no receipt printer. The report stays on screen.")
    ops.printed = true
    await shift.print(shiftID: "s1")
    XCTAssertEqual(shift.notice, "Sent to the receipt printer")
  }

  func testAClosedShiftIsNotTheOpenOne() async {
    let ops = FakeOps()
    ops.current = PosShiftRecord(id: "s1", shift: shiftOf(.closed))
    let shift = model(ops)
    await shift.refresh()
    XCTAssertNil(shift.shift)
    XCTAssertTrue(shift.loaded)
  }
}

/// Records each request and answers every one with a fixed body.
private final class Recording: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private(set) var requests: [URLRequest] = []
  let body: String
  init(_ body: String) { self.body = body }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    lock.withLock { requests.append(request) }
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }

  var sent: [String: Any] {
    (try? JSONSerialization.jsonObject(with: requests.last?.httpBody ?? Data())) as? [String: Any] ?? [:]
  }
}

private func client(_ transport: HTTPTransport) -> ConsoleAPIClient {
  ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "token" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
}

final class ConsolePosOpsAPITests: XCTestCase {
  private let shiftJSON =
    #"{"shift":{"id":"s1","hostId":"h1","registerId":"r1","status":"open","openedBy":"u1","openedAtMs":1700000000000,"openingFloatCents":15000,"cashEvents":[{"id":"e1","type":"drop","amountCents":2000,"reason":"","by":"u1","atMs":1700000100000}]}}"#

  func testEveryShiftCallNamesTheSiteTheRegisterAndTheCashier() async throws {
    let transport = Recording(shiftJSON)
    let opened = try await ConsolePosOpsAPI(api: client(transport), hostID: "h1")
      .openShift(registerID: "r1", assertion: "assert-1", floatCents: 15_000)
    XCTAssertEqual(transport.requests.last?.url?.path, "/api/commerce/pos-shift")
    XCTAssertEqual(transport.sent["action"] as? String, "open")
    XCTAssertEqual(transport.sent["hostId"] as? String, "h1")
    XCTAssertEqual(transport.sent["registerId"] as? String, "r1")
    XCTAssertEqual(transport.sent["cashierAssertion"] as? String, "assert-1")
    XCTAssertEqual(transport.sent["openingFloatCents"] as? Int, 15_000)
    XCTAssertEqual(opened.id, "s1")
    XCTAssertEqual(opened.shift.cashEvents.count, 1)
    XCTAssertEqual(opened.shift.cashEvents.first?.type, .drop)
  }

  func testNoCashierMeansNoAssertionIsSent() async throws {
    let transport = Recording(#"{"shift":null}"#)
    let current = try await ConsolePosOpsAPI(api: client(transport), hostID: "h1").currentShift(registerID: "r1", assertion: nil)
    XCTAssertNil(current)
    XCTAssertNil(transport.sent["cashierAssertion"])
    XCTAssertEqual(transport.sent["action"] as? String, "current")
  }

  func testACloseSendsTheShiftTheCountAndTheNote() async throws {
    let answer =
      #"{"shift":{"id":"s1","hostId":"h1","registerId":"r1","status":"closed","openedBy":"u1","openedAtMs":1,"openingFloatCents":0,"cashEvents":[],"countedCashCents":21240,"varianceCents":0},"report":{"orderCount":1,"grossSalesCents":100,"discountsCents":0,"taxCents":0,"tipsCents":0,"salesByTender":{"cash":100},"refundCount":0,"refundsCents":0,"refundsByTender":{},"netSalesCents":100,"openingFloatCents":0,"cashSalesCents":100,"paidInCents":0,"paidOutCents":0,"dropsCents":0,"cashRefundsCents":0,"expectedCashCents":100}}"#
    let transport = Recording(answer)
    let closed = try await ConsolePosOpsAPI(api: client(transport), hostID: "h1")
      .closeShift(registerID: "r1", assertion: "a", shiftID: "s1", countedCents: 21_240, note: "Counted twice")
    XCTAssertEqual(transport.sent["action"] as? String, "close")
    XCTAssertEqual(transport.sent["shiftId"] as? String, "s1")
    XCTAssertEqual(transport.sent["countedCashCents"] as? Int, 21_240)
    XCTAssertEqual(transport.sent["note"] as? String, "Counted twice")
    XCTAssertEqual(closed.shift.shift.status, .closed)
    XCTAssertEqual(closed.report?.expectedCashCents, 100)
  }

  func testAPinVerifyAsksForThePurposeAndReadsTheAssertion() async throws {
    let transport = Recording(#"{"assertion":"sig","expiresAtMs":1700000900000,"memberUid":"u2","name":"Ben","purpose":"cashier"}"#)
    let assertion = try await ConsolePosOpsAPI(api: client(transport), hostID: "h1")
      .verifyPin(registerID: "r1", memberUID: "u2", pin: "4321", purpose: "cashier")
    XCTAssertEqual(transport.requests.last?.url?.path, "/api/commerce/pos-staff-pin")
    XCTAssertEqual(transport.sent["action"] as? String, "verify")
    XCTAssertEqual(transport.sent["pin"] as? String, "4321")
    XCTAssertEqual(assertion.name, "Ben")
    XCTAssertEqual(assertion.expiresAtMs, 1_700_000_900_000)
  }

  func testTheContextCarriesTheRegisterRules() throws {
    func body(_ text: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }
    let context = readPosContext(
      try body(
        #"{"settings":{},"terminal":{},"ops":{"requireOpenShift":true,"refundLimitCents":5000,"autoLockMinutes":15,"receiptAddress":"1 Main St","returnPolicy":"30 days"}}"#
      ))
    XCTAssertEqual(
      context.ops,
      PosOpsSettings(requireOpenShift: true, refundLimitCents: 5000, autoLockMinutes: 15, receiptAddress: "1 Main St", returnPolicy: "30 days"))
    XCTAssertEqual(readPosContext(try body("{}")).ops, PosOpsSettings(), "an older console names no rules")
  }

  func testTheSaleAndItsPaymentsNameTheCashier() async throws {
    let transport = Recording(#"{"orderId":"o1","totals":{"totalCents":100}}"#)
    let sale = ConsolePosSaleAPI(api: client(transport), hostID: "h1")
    sale.cashier.assertion = "assert-1"
    _ = try await sale.openSale(registerID: "r1", locationID: nil, cart: .empty, attemptKey: "k1")
    XCTAssertEqual(transport.sent["cashierAssertion"] as? String, "assert-1")
    _ = try await sale.payment(orderID: "o1", step: .cash(tenderedCents: 100, tipCents: 0, amountCents: nil), attemptKey: "k2")
    XCTAssertEqual(transport.sent["cashierAssertion"] as? String, "assert-1", "a payment-starting step names the cashier")
    _ = try await sale.payment(orderID: "o1", step: .sale)
    XCTAssertNil(transport.sent["cashierAssertion"], "a read does not")
  }
}
