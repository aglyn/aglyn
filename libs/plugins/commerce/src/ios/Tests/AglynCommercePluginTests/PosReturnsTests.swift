// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

private func json(_ text: String) -> JSONValue { try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }

private let orderJSON = """
  {"id":"o1","number":1042,"label":"#1042","status":"paid","channel":"pos","createdAtMs":1700000000000,
   "customerEmail":"a@b.co","customerName":"Ana","totalCents":3000,"refundedCents":0,"returnable":true,
   "lines":[{"index":0,"name":"Mug","variantLabel":"Blue","quantity":3,"returned":0,"held":0,"valueCents":3000}],
   "tenders":[{"id":"p1","method":"cash","label":"Cash","amountCents":3000,"refundableCents":3000}]}
  """

private func order(_ text: String = orderJSON) -> PosReturnOrder { readReturnOrder(json(text))! }

private final class FakeReturns: PosReturnsAPI, @unchecked Sendable {
  private let lock = NSLock()
  private var recorded: [String] = []
  private var asked: [PosReturnRequest] = []
  private var scripted: [ConsoleAPIError] = []
  var calls: [String] { lock.withLock { recorded } }
  var requests: [PosReturnRequest] { lock.withLock { asked } }
  var found: [PosReturnOrder] = []
  func fail(with failure: ConsoleAPIError) { lock.withLock { scripted.append(failure) } }

  func find(_ text: String) async throws -> [PosReturnOrder] {
    lock.withLock { recorded.append("find \(text)") }
    return found
  }

  func refund(
    registerID: String, assertion: String?, managerAssertion: String?, request: PosReturnRequest, attemptKey: String
  ) async throws -> PosReturnResult {
    let failure: ConsoleAPIError? = lock.withLock {
      recorded.append("refund \(registerID) \(assertion ?? "-") \(managerAssertion ?? "-") \(attemptKey)")
      asked.append(request)
      return scripted.isEmpty ? nil : scripted.removeFirst()
    }
    if let failure { throw failure }
    return PosReturnResult(
      returnID: "ret1", refundedCents: 1000, outstandingCents: 0, partial: false, cashOutCents: 1000, restockedUnits: 1,
      tenders: [PosReturnTenderResult(label: "Cash", amountCents: 1000, failed: false, error: nil)])
  }
}

final class PosReturnReadingTests: XCTestCase {
  func testAnOrderReadsItsLinesAndTenders() {
    let read = order()
    XCTAssertEqual(read.label, "#1042")
    XCTAssertEqual(read.lines.first?.left, 3)
    XCTAssertEqual(read.tenders.first?.refundableCents, 3000)
    XCTAssertTrue(read.returnable)
  }

  func testALineRefundsByTheServersCumulativeSplit() {
    let line = PosReturnLine(index: 0, name: "Mug", variantLabel: nil, quantity: 3, returned: 1, held: 0, valueCents: 1000)
    // 1000 * 2/3 = 667 less 1000 * 1/3 = 333, rounded the way the server rounds.
    XCTAssertEqual(line.refundCents(returning: 1), 334)
    XCTAssertEqual(line.refundCents(returning: 2), 667)
    XCTAssertEqual(line.refundCents(returning: 0), 0)
  }

  func testUnitsHeldByAnOnlineReturnCannotComeBackAtTheRegister() {
    let line = PosReturnLine(index: 0, name: "Mug", variantLabel: nil, quantity: 3, returned: 1, held: 1, valueCents: 900)
    XCTAssertEqual(line.left, 1)
  }

  func testAnAnswerWithoutARefundIsNotAResult() {
    XCTAssertNil(readReturnResult(json(#"{"error":"no"}"#)))
    let read = readReturnResult(
      json(
        #"{"returnId":"r","refundedCents":500,"outstandingCents":200,"partial":true,"cashOutCents":300,"restockedUnits":2,"tenders":[{"label":"Visa","amountCents":200,"status":"failed","error":"declined"},{"label":"Cash","amountCents":300,"status":"refunded"}]}"#
      ))
    XCTAssertEqual(read?.partial, true)
    XCTAssertEqual(read?.tenders.first?.failed, true)
    XCTAssertEqual(read?.tenders.first?.error, "declined")
    XCTAssertEqual(read?.cashOutCents, 300)
  }
}

@MainActor
final class PosReturnModelTests: XCTestCase {
  private func model(_ api: FakeReturns, key: String = "key-1") -> PosReturnModel {
    PosReturnModel(api: api, registerID: { "r1" }, assertion: { "cashier-1" }, mintKey: { key })
  }

  private func picked(_ api: FakeReturns, model returns: PosReturnModel) async {
    returns.text = "1042"
    await returns.find()
    returns.step(returns.order!.lines[0], by: 1)
  }

  func testOneMatchOpensStraightAway() async {
    let api = FakeReturns()
    api.found = [order()]
    let returns = model(api)
    returns.text = "  #1042 "
    await returns.find()
    XCTAssertEqual(api.calls, ["find #1042"])
    XCTAssertEqual(returns.order?.id, "o1")
  }

  func testSeveralMatchesWaitForAPickAndBackReturnsToThem() async {
    let api = FakeReturns()
    api.found = [order(), order()]
    let returns = model(api)
    returns.text = "a@b.co"
    await returns.find()
    XCTAssertNil(returns.order)
    returns.choose(api.found[0])
    returns.back()
    XCTAssertNil(returns.order)
    XCTAssertEqual(returns.orders?.count, 2)
  }

  func testQuantitiesStopAtWhatCanStillComeBackAndPreviewTheRefund() async {
    let api = FakeReturns()
    api.found = [order()]
    let returns = model(api)
    await picked(api, model: returns)
    XCTAssertEqual(returns.refundCents, 1000)
    let line = returns.order!.lines[0]
    for _ in 0..<5 { returns.step(line, by: 1) }
    XCTAssertEqual(returns.quantity(line), 3)
    XCTAssertEqual(returns.refundCents, 3000)
    XCTAssertTrue(returns.canSubmit)
  }

  func testAnOrderThatCannotBeReturnedTakesNoPicks() async {
    let api = FakeReturns()
    api.found = [order(orderJSON.replacingOccurrences(of: "\"returnable\":true", with: "\"returnable\":false"))]
    let returns = model(api)
    await picked(api, model: returns)
    XCTAssertFalse(returns.canSubmit)
    XCTAssertEqual(returns.picks.count, 0)
  }

  func testTheRefundNamesTheCashierTheRegisterAndOneKey() async {
    let api = FakeReturns()
    api.found = [order()]
    let returns = model(api)
    await picked(api, model: returns)
    returns.note = "Handle cracked"
    await returns.submit()
    XCTAssertEqual(api.calls.last, "refund r1 cashier-1 - key-1")
    XCTAssertEqual(api.requests.last?.picks, [PosReturnPick(index: 0, quantity: 1)])
    XCTAssertEqual(api.requests.last?.reasonCode, "no_longer_needed")
    XCTAssertEqual(api.requests.last?.restock, true)
    XCTAssertEqual(api.requests.last?.note, "Handle cracked")
    XCTAssertNil(api.requests.last?.split)
    XCTAssertEqual(returns.result?.cashOutCents, 1000)
  }

  func testAboveTheLimitTheManagerApprovesTheSameAttempt() async {
    let api = FakeReturns()
    api.fail(
      with: ConsoleAPIError(
        status: 403, message: "Register refunds need a manager's PIN.",
        body: json(#"{"error":"Register refunds need a manager's PIN.","needsManager":true,"limitCents":0}"#)))
    api.found = [order()]
    let returns = model(api)
    await picked(api, model: returns)
    await returns.submit()
    XCTAssertEqual(returns.managerPrompt, "Register refunds need a manager's PIN.")
    XCTAssertNil(returns.result)
    XCTAssertNil(returns.error)
    await returns.approve(
      PosStaffAssertion(assertion: "mgr-1", expiresAtMs: 1, memberUID: "m", name: "Mo", purpose: "manager"))
    XCTAssertNil(returns.managerPrompt)
    XCTAssertEqual(Array(api.calls.suffix(2)), ["refund r1 cashier-1 - key-1", "refund r1 cashier-1 mgr-1 key-1"])
    XCTAssertNotNil(returns.result)
  }

  func testARefusalShowsItsWordsAndTheNextTapIsANewAttempt() async {
    final class Keys: @unchecked Sendable {
      var list = ["k1", "k2"]
      func next() -> String { list.removeFirst() }
    }
    let keys = Keys()
    let api = FakeReturns()
    api.fail(with: ConsoleAPIError(status: 409, message: "Open a shift before paying cash out of the drawer."))
    api.found = [order()]
    let returns = PosReturnModel(api: api, registerID: { "r1" }, assertion: { nil }, mintKey: { keys.next() })
    await picked(api, model: returns)
    await returns.submit()
    XCTAssertEqual(returns.error, "Open a shift before paying cash out of the drawer.")
    await returns.submit()
    XCTAssertEqual(Array(api.calls.suffix(2)), ["refund r1 - - k1", "refund r1 - - k2"])
  }

  func testASplitByHandNamesOnlyThePaymentsGivenAnAmount() async {
    let api = FakeReturns()
    let two = orderJSON.replacingOccurrences(
      of: #""tenders":["#,
      with: #""tenders":[{"id":"p0","method":"card","label":"Visa 4242","amountCents":1000,"refundableCents":1000},"#)
    api.found = [order(two)]
    let returns = model(api)
    await picked(api, model: returns)
    returns.splitByHand = true
    returns.split = ["p0": "4.00", "p1": "6.00", "zz": "1.00"]
    await returns.submit()
    XCTAssertEqual(
      api.requests.last?.split,
      [PosReturnSplit(paymentID: "p0", amountCents: 400), PosReturnSplit(paymentID: "p1", amountCents: 600)])
  }
}

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

final class ConsolePosReturnsAPITests: XCTestCase {
  func testFindAsksTheReturnRouteForTheText() async throws {
    let transport = Recording(#"{"orders":[\#(orderJSON)]}"#)
    let found = try await ConsolePosReturnsAPI(api: client(transport), hostID: "h1").find("1042")
    XCTAssertEqual(transport.requests.last?.url?.path, "/api/commerce/pos-return")
    XCTAssertEqual(transport.sent["action"] as? String, "find")
    XCTAssertEqual(transport.sent["text"] as? String, "1042")
    XCTAssertEqual(transport.sent["hostId"] as? String, "h1")
    XCTAssertEqual(found.first?.id, "o1")
  }

  func testARefundSendsThePicksTheCashierAndTheIdempotencyKey() async throws {
    let transport = Recording(
      #"{"returnId":"r","refundedCents":1000,"outstandingCents":0,"partial":false,"cashOutCents":1000,"restockedUnits":1,"tenders":[]}"#
    )
    let request = PosReturnRequest(
      orderID: "o1", picks: [PosReturnPick(index: 0, quantity: 2)], restock: false, reasonCode: "damaged", note: " cracked ",
      split: [PosReturnSplit(paymentID: "p1", amountCents: 1000)])
    let result = try await ConsolePosReturnsAPI(api: client(transport), hostID: "h1")
      .refund(registerID: "r1", assertion: "cashier-1", managerAssertion: "mgr", request: request, attemptKey: "k-9")
    let sent = transport.sent
    XCTAssertEqual(sent["action"] as? String, "refund")
    XCTAssertEqual(sent["registerId"] as? String, "r1")
    XCTAssertEqual(sent["orderId"] as? String, "o1")
    XCTAssertEqual(sent["restock"] as? Bool, false)
    XCTAssertEqual(sent["reasonCode"] as? String, "damaged")
    XCTAssertEqual(sent["reason"] as? String, "cracked")
    XCTAssertEqual(sent["cashierAssertion"] as? String, "cashier-1")
    XCTAssertEqual(sent["managerAssertion"] as? String, "mgr")
    XCTAssertEqual((sent["lines"] as? [[String: Int]])?.first, ["index": 0, "quantity": 2])
    XCTAssertEqual((sent["tenders"] as? [[String: Any]])?.first?["paymentId"] as? String, "p1")
    XCTAssertEqual(transport.requests.last?.value(forHTTPHeaderField: "Idempotency-Key"), "k-9")
    XCTAssertEqual(result.refundedCents, 1000)
  }
}
