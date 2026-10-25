// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

/// Answers each request with the next body in line and keeps what was sent.
private final class Window: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private var queue: [(Int, String)]
  private var sent: [URLRequest] = []
  var requests: [URLRequest] { lock.withLock { sent } }
  var bodies: [JSONValue] { requests.compactMap { JSONValue.decode($0.httpBody ?? Data()) } }

  init(_ answers: [(Int, String)]) { queue = answers }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (status, body) = lock.withLock { () -> (Int, String) in
      sent.append(request)
      return queue.isEmpty ? (200, "{}") : queue.removeFirst()
    }
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}

private func row(_ id: String, status: String = "expected", extra: String = "") -> String {
  ##"{"id":"\##(id)","source":"order","orderLabel":"#1042","itemName":"Day pass","variantLabel":"Adult","unitIndex":0,"unitCount":2,"dayKey":"2026-10-25","customerKey":"ana@example.com","customerName":"Ana Ruiz","status":"\##(status)","searchTokens":[],"createdAtMs":1,"updatedAtMs":1\##(extra)}"##
}

@MainActor
final class PosCheckInTests: XCTestCase {
  private func model(_ window: Window) -> PosCheckInModel {
    let api = ConsolePosCheckInAPI(api: ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: window), hostID: "h1")
    return PosCheckInModel(api: api, registerID: { "reg1" }, assertion: { "pin-assertion" })
  }

  private func waitForSearch(_ window: Window, count: Int) async {
    for _ in 0..<40 where window.requests.count < count { try? await Task.sleep(for: .milliseconds(25)) }
  }

  func testTypingSearchesAfterAPauseAndListsWhoIsDue() async throws {
    let window = Window([
      (200, #"{"dayKey":"2026-10-25","timeZone":"America/Chicago","customers":[{"customerKey":"ana@example.com","name":"Ana Ruiz","email":"ana@example.com","phone":null,"contactId":"c1","unitsDue":3,"unitsCheckedIn":1,"items":["Day pass","RV camping"]}]}"#)
    ])
    let model = model(window)
    model.text = "a"
    try await Task.sleep(for: .milliseconds(400))
    XCTAssertTrue(window.requests.isEmpty, "one letter asks nothing")
    model.text = "ana"
    await waitForSearch(window, count: 1)
    try await Task.sleep(for: .milliseconds(50))
    XCTAssertEqual(window.bodies.first?["action"], "search")
    XCTAssertEqual(window.bodies.first?["text"], "ana")
    XCTAssertEqual(window.bodies.first?["hostId"], "h1")
    XCTAssertEqual(window.requests.first?.url?.path, "/api/commerce/pos-check-in")
    XCTAssertEqual(model.customers.map(\.customerKey), ["ana@example.com"])
    XCTAssertEqual(model.day, PosCheckInDay(dayKey: "2026-10-25", timeZone: "America/Chicago"))
    XCTAssertEqual(checkInCustomerLine(model.customers[0]), "1 of 3 checked in · Day pass, RV camping · ana@example.com")
  }

  func testACustomerOpensOnTheirRowsAndEachIsCheckedInWithItsWristband() async throws {
    let checked = row("r1", status: "checked_in", extra: #","checkedInAtMs":1792940040000,"checkedInByName":"Sam","wristband":{"number":"214","color":"Blue"}"#)
    let window = Window([
      (200, #"{"dayKey":"2026-10-25","timeZone":"America/Chicago","customer":{"customerKey":"ana@example.com","name":"Ana Ruiz","unitsDue":2,"unitsCheckedIn":0,"items":["Day pass"]},"checkIns":[\#(row("r1")),\#(row("r2"))]}"#),
      (200, #"{"checkedIn":[\#(checked)],"alreadyCheckedIn":[],"missing":[]}"#),
    ])
    let model = model(window)
    await model.open(PosCheckInTarget(customerKey: "ana@example.com"))
    XCTAssertEqual(model.title, "Ana Ruiz")
    XCTAssertEqual(model.rows.map(\.id), ["r1", "r2"])
    XCTAssertEqual(checkInItemLabel(model.rows[0].record), "Day pass · Adult (1 of 2)")
    XCTAssertEqual(model.detail(model.rows[0]), "#1042")
    model.drafts["r1"] = PosWristbandDraft(number: "214", color: "Blue")
    await model.checkIn([model.rows[0]])
    let sent = try XCTUnwrap(window.bodies.last)
    XCTAssertEqual(sent["action"], "check_in")
    XCTAssertEqual(sent["registerId"], "reg1")
    XCTAssertEqual(sent["cashierAssertion"], "pin-assertion")
    XCTAssertEqual(sent["checkIns"], [["id": "r1", "wristband": ["number": "214", "color": "Blue"]]])
    XCTAssertNotNil(window.requests.last?.value(forHTTPHeaderField: "Idempotency-Key"), "a retried tap is the same check-in")
    XCTAssertTrue(model.rows[0].checkedIn)
    XCTAssertEqual(model.detail(model.rows[0]), "Checked in at 9:54 AM by Sam · Blue #214")
    XCTAssertEqual(model.waiting.map(\.id), ["r2"])
    XCTAssertEqual(model.checkedInCount, 1)
  }

  func testAJunkWristbandIsRefusedBeforeAnythingIsSent() async throws {
    let window = Window([(200, #"{"dayKey":"2026-10-25","timeZone":"UTC","customer":null,"checkIns":[\#(row("r1"))]}"#)])
    let model = model(window)
    await model.open(PosCheckInTarget(email: "ana@example.com"))
    model.drafts["r1"] = PosWristbandDraft(number: "12 3", color: "")
    await model.checkIn(model.rows)
    XCTAssertEqual(model.error, "A wristband number is letters, digits and dashes.")
    XCTAssertEqual(window.requests.count, 1)
  }

  func testSomeoneAlreadyCheckedInSaysWhenAndByWhomAndUndoTakesItBack() async throws {
    let already = row("r1", status: "checked_in", extra: #","checkedInAtMs":1792940040000,"checkedInByName":"Sam""#)
    let window = Window([
      (200, #"{"dayKey":"2026-10-25","timeZone":"America/Chicago","checkIns":[\#(row("r1"))]}"#),
      (200, #"{"checkedIn":[],"alreadyCheckedIn":[\#(already)],"missing":[]}"#),
      (200, #"{"checkIn":\#(row("r1"))}"#),
    ])
    let model = model(window)
    await model.open(PosCheckInTarget(email: "ana@example.com"))
    await model.checkIn(model.rows)
    XCTAssertEqual(model.notice, "Already checked in at 9:54 AM by Sam")
    await model.undo(model.rows[0])
    XCTAssertEqual(window.bodies.last?["action"], "undo")
    XCTAssertEqual(window.bodies.last?["id"], "r1")
    XCTAssertFalse(model.rows[0].checkedIn)
  }

  func testNothingDueSaysSoAndARefusalIsTheRoutesWords() async throws {
    let window = Window([
      (200, #"{"dayKey":"2026-10-25","timeZone":"UTC","customer":null,"checkIns":[]}"#),
      (403, #"{"error":"Check-in needs the POS on your plan."}"#),
    ])
    let model = model(window)
    await model.open(PosCheckInTarget(email: "ana@example.com"))
    XCTAssertEqual(model.notice, "Nothing to check in today for this customer.")
    await model.open(PosCheckInTarget(email: "ana@example.com"))
    XCTAssertEqual(model.error, "Check-in needs the POS on your plan.")
  }

  func testTheAttachedCustomersCountAsksIfUsedAndCountsWhoWaits() async throws {
    let window = Window([
      (200, #"{"dayKey":"2026-10-25","timeZone":"UTC","checkIns":[\#(row("r1")),\#(row("r2", status: "checked_in"))]}"#)
    ])
    let api = ConsolePosCheckInAPI(api: ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" }, transport: window), hostID: "h1")
    let due = PosCheckInDue(api: api)
    await due.load(PosCustomer(kind: "contact", id: "c1", name: "Ana Ruiz", email: "ana@example.com", phone: nil))
    XCTAssertEqual(window.bodies.first?["reconcile"], "if-used")
    XCTAssertEqual(window.bodies.first?["email"], "ana@example.com")
    XCTAssertEqual(due.dayKey, "2026-10-25")
    XCTAssertEqual(due.waiting, 1)
    XCTAssertEqual(due.total, 2)
    XCTAssertNil(checkInTarget(for: PosCustomer(kind: "none", id: "", name: "", email: nil, phone: nil)))
    XCTAssertEqual(checkInTarget(for: PosCustomer(kind: "contact", id: "c9", name: "Lee", email: nil, phone: nil))?.contactId, "c9")
  }

  func testTheZoneIsHandedTheConsolesPropsAndNothingElse() {
    XCTAssertEqual(
      posCheckInZoneParams(
        hostID: "h1", contactId: "c1", email: "Ana@Example.com", dayKey: "2026-10-25", name: "Ana Ruiz", unitsDue: 3,
        placement: "check-in-row"),
      ["hostId": "h1", "contactId": "c1", "email": "ana@example.com", "dayKey": "2026-10-25", "name": "Ana Ruiz", "unitsDue": "3", "placement": "check-in-row"])
  }
}
