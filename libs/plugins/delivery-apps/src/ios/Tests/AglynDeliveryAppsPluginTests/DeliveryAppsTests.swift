// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import XCTest

@testable import AglynDeliveryAppsPlugin

private func order(
  _ id: String, status: String = "new", service: String = "doordash", ref: String = "ABC1", pending: String? = nil, error: String? = nil,
  total: Int = 2450
) -> JSONValue {
  var fields: [String: JSONValue] = [
    "id": .string(id), "service": .string(service), "externalRef": .string(ref), "status": .string(status), "handoff": "courier",
    "placedAtMs": .number(1_700_000_000_000), "pickupAtMs": .number(1_700_000_900_000), "customerName": "Ana R.",
    "instructions": "Leave at the door", "currency": "usd", "totalCents": .number(Double(total)), "refundedCents": .number(0),
    "displayRef": "#12", "oversold": .number(0), "testMode": .bool(false),
    "lines": .array([
      .object([
        "name": "Latte", "quantity": .number(2), "unitPriceCents": .number(450), "options": .array(["Oat", "Large"]),
        "instructions": "Extra hot", "matched": .bool(true),
      ])
    ]),
  ]
  if let pending { fields["pending"] = .string(pending) }
  if let error { fields["error"] = .string(error) }
  return .object(fields)
}

private func answer(open: [JSONValue] = [], recent: [JSONValue] = [], connected: Bool = true) -> JSONValue {
  .object(["connected": .bool(connected), "open": .array(open), "recent": .array(recent)])
}

private final class Recorder: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private(set) var requests: [URLRequest] = []
  let body: String
  init(_ body: String) { self.body = body }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    lock.withLock { requests.append(request) }
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }

  var sent: [String: Any] { (try? JSONSerialization.jsonObject(with: requests.last?.httpBody ?? Data())) as? [String: Any] ?? [:] }
}

private func client(_ transport: HTTPTransport) -> ConsoleAPIClient {
  ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "token" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
}

final class DeliveryReadingTests: XCTestCase {
  func testAnOrderReadsWithItsLinesOptionsAndTimes() throws {
    let read = try XCTUnwrap(readDeliveryOrder(order("o1")))
    XCTAssertEqual(read.serviceLabel, "DoorDash")
    XCTAssertEqual(read.status, .new)
    XCTAssertEqual(read.lines, [DeliveryOrderLine(name: "Latte", quantity: 2, unitPriceCents: 450, options: ["Oat", "Large"], instructions: "Extra hot", matched: true)])
    XCTAssertEqual(read.pickupAtMs, 1_700_000_900_000)
    XCTAssertEqual(read.displayRef, "#12")
    XCTAssertNil(read.pending)
  }

  func testAnOrderInAStatusThisAppDoesNotKnowIsLeftOut() {
    XCTAssertNil(readDeliveryOrder(order("o1", status: "teleported")))
    XCTAssertNil(readDeliveryOrder(.object(["status": "new"])), "no id, no order")
  }

  func testAServiceThisAppHasNotHeardOfStillDrawsByItsOwnName() throws {
    let read = try XCTUnwrap(readDeliveryOrder(order("o1", service: "postmates")))
    XCTAssertNil(read.service)
    XCTAssertEqual(read.serviceLabel, "postmates")
    XCTAssertEqual(deliverySteps(read).map(\.action), [.accept, .reject], "and can still be accepted")
  }

  func testAQueueWithNoServiceConnectedIsNothing() {
    XCTAssertEqual(readDeliveryQueue(answer(connected: false)), .disconnected)
    XCTAssertEqual(readDeliveryQueue(nil), .disconnected)
    let queue = readDeliveryQueue(answer(open: [order("o1"), order("o2", status: "accepted")], recent: [order("o3", status: "picked_up")]))
    XCTAssertTrue(queue.connected)
    XCTAssertEqual(queue.open.map(\.id), ["o1", "o2"])
    XCTAssertEqual(queue.recent.map(\.status), [.pickedUp])
  }

  func testEachOrderOffersTheOneNextStepTheConsoleOffers() throws {
    func steps(_ status: String, service: String = "doordash", pending: String? = nil) throws -> [DeliveryAction] {
      deliverySteps(try XCTUnwrap(readDeliveryOrder(order("o", status: status, service: service, pending: pending)))).map(\.action)
    }
    XCTAssertEqual(try steps("new"), [.accept, .reject])
    XCTAssertEqual(try steps("accepted"), [.ready, .pickedUp], "a service that takes a ready signal")
    XCTAssertEqual(try steps("accepted", service: "uber-eats"), [.pickedUp], "Uber Eats takes none")
    XCTAssertEqual(try steps("accepted", pending: "accept"), [], "while the acceptance is still owed to the service")
    XCTAssertEqual(try steps("ready"), [.pickedUp])
    XCTAssertEqual(try steps("picked_up"), [])
    XCTAssertEqual(try steps("rejected"), [])
    XCTAssertEqual(try steps("cancelled"), [])
  }

  func testTheStatusesAreNamedAsTheConsoleNamesThem() {
    XCTAssertEqual(DeliveryOrderStatus.accepted.label, "Making")
    XCTAssertEqual(DeliveryOrderStatus.cancelled.label, "Canceled")
    XCTAssertEqual(DeliveryOrderStatus.pickedUp.label, "Picked up")
  }

  func testMoneyIsInTheOrdersOwnCurrency() {
    XCTAssertEqual(deliveryMoney(2450, currency: "usd"), "$24.50")
    XCTAssertEqual(deliveryMoney(2450, currency: ""), "$24.50")
  }
}

final class ConsoleDeliveryAppsAPITests: XCTestCase {
  func testTheQueueIsAskedForBySiteAsTheMember() async throws {
    let transport = Recorder(#"{"connected":true,"open":[],"recent":[]}"#)
    let queue = try await ConsoleDeliveryAppsAPI(api: client(transport)).queue(hostID: "h1")
    let request = try XCTUnwrap(transport.requests.last)
    XCTAssertEqual(request.url?.path, "/api/delivery-apps/queue")
    XCTAssertTrue((request.url?.query ?? "").contains("hostId=h1"))
    XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token")
    XCTAssertTrue(queue.connected)
  }

  func testAnActionCarriesTheOrderTheStepAndTheReason() async throws {
    let transport = Recorder(#"{"ok":true,"message":"Accepted. DoorDash was told.","order":null}"#)
    let result = try await ConsoleDeliveryAppsAPI(api: client(transport)).act(
      hostID: "h1", orderID: "o1", action: .reject, reason: "The store is closing")
    XCTAssertEqual(transport.requests.last?.url?.path, "/api/delivery-apps/order-action")
    XCTAssertEqual(transport.requests.last?.httpMethod, "POST")
    XCTAssertEqual(transport.sent["hostId"] as? String, "h1")
    XCTAssertEqual(transport.sent["orderId"] as? String, "o1")
    XCTAssertEqual(transport.sent["action"] as? String, "reject")
    XCTAssertEqual(transport.sent["reason"] as? String, "The store is closing")
    XCTAssertEqual(result.message, "Accepted. DoorDash was told.")
    XCTAssertNil(result.order)
  }

  func testAPickedUpStepIsSpelledTheRoutesWay() async throws {
    let transport = Recorder(#"{"ok":true,"message":null,"order":null}"#)
    _ = try await ConsoleDeliveryAppsAPI(api: client(transport)).act(hostID: "h1", orderID: "o1", action: .pickedUp, reason: nil)
    XCTAssertEqual(transport.sent["action"] as? String, "picked_up")
    XCTAssertNil(transport.sent["reason"], "no reason is sent for a step that has none")
  }
}

@MainActor
final class DeliveryQueueModelTests: XCTestCase {
  private final class Scripted: DeliveryAppsAPI, @unchecked Sendable {
    private let lock = NSLock()
    var answers: [Result<DeliveryQueue, Error>] = []
    var acted: [String] = []
    var actResult: Result<DeliveryActionResult, Error> = .success(DeliveryActionResult(message: nil, order: nil))

    func queue(hostID: String) async throws -> DeliveryQueue {
      try lock.withLock { answers.isEmpty ? DeliveryQueue.disconnected : try answers.removeFirst().get() }
    }

    func act(hostID: String, orderID: String, action: DeliveryAction, reason: String?) async throws -> DeliveryActionResult {
      lock.withLock { acted.append("\(orderID) \(action.rawValue) \(reason ?? "-")") }
      return try actResult.get()
    }
  }

  private func queue(_ open: [JSONValue]) -> DeliveryQueue { readDeliveryQueue(answer(open: open)) }

  func testANewOrderIsAnnouncedOnceAndTheFirstLookIsNot() async {
    let api = Scripted()
    api.answers = [.success(queue([order("o1")])), .success(queue([order("o1")])), .success(queue([order("o1"), order("o2", ref: "ZZ9")]))]
    let model = DeliveryQueueModel(api: api, hostID: { "h1" })
    await model.refresh()
    XCTAssertNil(model.announcement, "what was already waiting at the first look is not news")
    XCTAssertEqual(model.waiting, 1)
    await model.refresh()
    XCTAssertNil(model.announcement)
    await model.refresh()
    XCTAssertEqual(model.announcement, "New DoorDash order ZZ9")
    XCTAssertEqual(model.waiting, 2)
  }

  func testSeveralNewOrdersAreOneAnnouncement() async {
    let api = Scripted()
    api.answers = [.success(queue([])), .success(queue([order("o1"), order("o2")]))]
    let model = DeliveryQueueModel(api: api, hostID: { "h1" })
    await model.refresh()
    await model.refresh()
    XCTAssertEqual(model.announcement, "2 new delivery orders")
  }

  func testAQueueTheCashierIsTurnedAwayFromDrawsNothing() async {
    let api = Scripted()
    api.answers = [.failure(ConsoleAPIError(status: 403, message: "Not allowed"))]
    let model = DeliveryQueueModel(api: api, hostID: { "h1" })
    await model.refresh()
    XCTAssertEqual(model.queue, DeliveryQueue.disconnected)
    api.answers = [.success(queue([order("o1")]))]
    await model.refresh()
    api.answers = [.failure(ConsoleAPIError(status: 0, message: "offline"))]
    await model.refresh()
    XCTAssertEqual(model.queue?.open.map(\.id), ["o1"], "a missed look keeps what the card showed")
  }

  func testAcceptingSendsTheStepAndLooksAgain() async throws {
    let api = Scripted()
    api.answers = [.success(queue([order("o1")])), .success(queue([order("o1", status: "accepted")]))]
    api.actResult = .success(DeliveryActionResult(message: "Accepted. DoorDash was told.", order: nil))
    let model = DeliveryQueueModel(api: api, hostID: { "h1" })
    await model.refresh()
    let first = try XCTUnwrap(model.queue?.open.first)
    await model.act(first, .accept)
    XCTAssertEqual(api.acted, ["o1 accept -"])
    XCTAssertEqual(model.notice, DeliveryNotice(message: "Accepted. DoorDash was told.", isError: false))
    XCTAssertEqual(model.queue?.open.first?.status, .accepted)
    XCTAssertNil(model.busy)
  }

  func testRejectingAsksForAReasonBeforeAnythingIsSent() async throws {
    let api = Scripted()
    api.answers = [.success(queue([order("o1")])), .success(queue([]))]
    let model = DeliveryQueueModel(api: api, hostID: { "h1" })
    await model.refresh()
    let first = try XCTUnwrap(model.queue?.open.first)
    await model.act(first, .reject)
    XCTAssertEqual(model.rejecting?.id, "o1")
    XCTAssertTrue(api.acted.isEmpty, "nothing goes to the service until a reason is chosen")
    await model.reject(first, reason: deliveryRejectReasons[1])
    XCTAssertNil(model.rejecting)
    XCTAssertEqual(api.acted, ["o1 reject The kitchen is too busy"])
  }

  func testARefusedStepShowsTheRoutesWords() async throws {
    let api = Scripted()
    api.answers = [.success(queue([order("o1")]))]
    api.actResult = .failure(ConsoleAPIError(status: 409, message: "This order is being updated. Try again in a moment."))
    let model = DeliveryQueueModel(api: api, hostID: { "h1" })
    await model.refresh()
    await model.act(try XCTUnwrap(model.queue?.open.first), .accept)
    XCTAssertEqual(model.notice, DeliveryNotice(message: "This order is being updated. Try again in a moment.", isError: true))
  }

  func testTheQueueIsNotAskedForWithoutASite() async {
    let api = Scripted()
    api.answers = [.success(queue([order("o1")]))]
    let model = DeliveryQueueModel(api: api, hostID: { nil })
    await model.refresh()
    XCTAssertNil(model.queue)
  }
}

@MainActor
final class DeliveryRegistrationTests: XCTestCase {
  func testTheWidgetSitsInTheRegistersZoneForThePosAppOnly() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(
      [
        NativePluginManifestEntry(
          id: "delivery-apps",
          contributes: [
            "screens": ["delivery-apps.match", "delivery-apps.service", "delivery-apps.store"],
            "widgets": ["delivery-apps.pos-orders"],
          ], register: registerDeliveryAppsNative)
      ], into: registry)
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(registry.widgets(for: .pos, slot: posOrdersSlot).map(\.id), ["delivery-apps.pos-orders"])
    XCTAssertTrue(registry.widgets(for: .aglyn, slot: posOrdersSlot).isEmpty, "the Aglyn app has no register")
    XCTAssertTrue(registry.widgets(for: .pos).isEmpty, "and it is never a Home card")
  }
}
