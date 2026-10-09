// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

/// Records each request and answers every one with a fixed body.
private final class Recording: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private(set) var requests: [URLRequest] = []
  let body: String

  init(_ body: String = "{}") { self.body = body }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    lock.withLock { requests.append(request) }
    return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
  }

  var sentBody: [String: Any] {
    (try? JSONSerialization.jsonObject(with: requests.last?.httpBody ?? Data())) as? [String: Any] ?? [:]
  }
}

private func client(_ transport: HTTPTransport) -> ConsoleAPIClient {
  ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "token" }, transport: transport, sleep: { _ in })
}

private func order(_ fields: [String: Any]) throws -> HostOrder {
  var filled = fields
  if filled["status"] == nil { filled["status"] = "paid" }
  return try JSONDecoder().decode(HostOrder.self, from: JSONSerialization.data(withJSONObject: filled))
}

final class OrderNotesTests: XCTestCase {
  func testTheTimelineReadsNewestFirstAsTheConsolePrintsIt() throws {
    let paid = try order([
      "timeline": [
        ["atMs": 1_700_000_000_000, "event": "paid"],
        ["atMs": 1_700_000_100_000, "event": "note", "detail": "Customer called"],
      ]
    ])
    let events = orderTimeline(paid)
    XCTAssertEqual(events.map(\.event), ["note", "paid"])
    XCTAssertTrue(timelineLine(events[0]).hasSuffix(" — note: Customer called"))
    XCTAssertTrue(timelineLine(events[1]).hasSuffix(" — paid"))
  }

  func testAnAnsweredRestockQuestionIsNotOfferedAgain() throws {
    let open: [String: Any] = [
      "kind": "refund", "units": 2, "fullyReversed": true, "flaggedAtMs": 1000,
      "lines": [["productId": "p1", "variantId": "v", "quantity": 2, "name": "Mug"]],
    ]
    XCTAssertEqual(openRestockCheck(try order(["restockCheck": open]))?.flaggedAtMs, 1000)
    XCTAssertNil(openRestockCheck(try order(["restockCheck": open.merging(["resolution": "dismissed"]) { $1 }])))
    XCTAssertNil(openRestockCheck(try order([:])))
  }

  func testANoteNeedsSomethingWritten() {
    XCTAssertEqual(checkOrderNote("   "), "Write a note first")
    XCTAssertNil(checkOrderNote("Customer called"))
  }

  func testTheRestockRouteVerdictsAreSaidInWords() {
    XCTAssertEqual(restockAnswerMessage(verdict: "recorded", choice: .restocked), "Recorded as restocked")
    XCTAssertEqual(restockAnswerMessage(verdict: "recorded", choice: .dismissed), "Recorded — no restock")
    XCTAssertEqual(
      restockAnswerMessage(verdict: "answered", choice: .restocked),
      "This restock question was already answered — nothing changed.")
    XCTAssertTrue(restockAnswerMessage(verdict: "changed", choice: .dismissed).hasPrefix("The restock question changed"))
  }

  func testANoteIsPostedTrimmedAndCappedToTheRoute() async throws {
    let transport = Recording()
    try await addOrderNote(api: client(transport), hostID: "h1", orderID: "o1", note: "  " + String(repeating: "x", count: 600) + " ")
    XCTAssertEqual(transport.requests.last?.url?.path, "/api/commerce/order-note")
    XCTAssertEqual(transport.requests.last?.httpMethod, "POST")
    XCTAssertEqual(transport.sentBody["hostId"] as? String, "h1")
    XCTAssertEqual(transport.sentBody["orderId"] as? String, "o1")
    XCTAssertEqual((transport.sentBody["note"] as? String)?.count, orderNoteMaxLength)
  }

  func testARestockAnswerNamesTheQuestionItAnswers() async throws {
    let transport = Recording(#"{"ok":true,"verdict":"answered"}"#)
    let verdict = try await answerOrderRestock(
      api: client(transport), hostID: "h1", orderID: "o1", choice: .restocked, flaggedAtMs: 1000)
    XCTAssertEqual(verdict, "answered")
    XCTAssertEqual(transport.requests.last?.url?.path, "/api/commerce/order-restock-answer")
    XCTAssertEqual(transport.sentBody["resolution"] as? String, "restocked")
    XCTAssertEqual(transport.sentBody["flaggedAtMs"] as? Int, 1000)
  }
}
