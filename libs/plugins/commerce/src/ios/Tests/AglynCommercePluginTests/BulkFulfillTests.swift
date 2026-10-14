// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

/// Answers each fulfil request by the order it names: a status and a body.
private final class PerOrder: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private(set) var requests: [URLRequest] = []
  let answer: @Sendable (String) -> (Int, String)

  init(_ answer: @escaping @Sendable (String) -> (Int, String)) { self.answer = answer }

  func orderID(_ request: URLRequest) -> String {
    let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any]
    return body?["orderId"] as? String ?? ""
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    lock.withLock { requests.append(request) }
    let (status, body) = answer(orderID(request))
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}

private func client(_ transport: HTTPTransport) -> ConsoleAPIClient {
  ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "token" }, transport: transport, sleep: { _ in }, maxAttempts: 1)
}

private func row(_ id: String, _ status: OrderStatus) -> OrderRow { OrderRow(id: id, order: HostOrder(status: status)) }

/// Several orders marked fulfilled from the list: each is its own request with its own key, and each answer is read on its own.
final class BulkFulfillTests: XCTestCase {
  func testEachOrderIsItsOwnRequestWithAKeyFromTheBatchAndTheOrder() async throws {
    let transport = PerOrder { id in id == "b" ? (200, #"{"already":true}"#) : (200, "{}") }
    let result = await bulkFulfillOrders(
      api: client(transport), hostID: "h1", orders: [row("a", .paid), row("b", .partiallyFulfilled)], batchKey: "batch-1")
    XCTAssertEqual(transport.requests.map { $0.value(forHTTPHeaderField: "Idempotency-Key") }, ["batch-1:a", "batch-1:b"])
    XCTAssertEqual(transport.requests.first?.url?.path, "/api/commerce/fulfill-order")
    XCTAssertEqual(result, BulkFulfillResult(fulfilled: 1, already: 1))
    XCTAssertEqual(describeBulkFulfill(result), "2 orders fulfilled")
  }

  func testAnOrderThatCannotShipIsSkippedWithoutARequestAndTheRestGoAhead() async throws {
    let transport = PerOrder { id in id == "c" ? (409, #"{"error":"Cannot fulfill a refunded order"}"#) : (200, "{}") }
    let result = await bulkFulfillOrders(
      api: client(transport), hostID: "h1", orders: [row("a", .paid), row("x", .cancelled), row("c", .paid)], batchKey: "batch-2")
    XCTAssertEqual(transport.requests.map { transport.orderID($0) }, ["a", "c"], "a canceled order asks nothing of the route")
    XCTAssertEqual(result.fulfilled, 1)
    XCTAssertEqual(
      result.refused,
      [
        .init(orderID: "x", error: "Orders in \"cancelled\" cannot be fulfilled"),
        .init(orderID: "c", error: "Cannot fulfill a refunded order"),
      ])
    XCTAssertEqual(describeBulkFulfill(result), "1 order fulfilled; 2 skipped (orders in \"cancelled\" cannot be fulfilled, …)")
  }

  func testAServerFailureLeavesTheOrderUnconfirmedRatherThanRefused() async throws {
    let transport = PerOrder { _ in (500, #"{"error":"boom"}"#) }
    let result = await bulkFulfillOrders(api: client(transport), hostID: "h1", orders: [row("a", .paid)], batchKey: "batch-3")
    XCTAssertEqual(result, BulkFulfillResult(unknown: ["a"]))
    XCTAssertEqual(describeBulkFulfill(result), "1 not confirmed — reopen it to check; running it again is safe")
    XCTAssertEqual(describeBulkFulfill(BulkFulfillResult()), "Nothing to fulfill")
  }
}
