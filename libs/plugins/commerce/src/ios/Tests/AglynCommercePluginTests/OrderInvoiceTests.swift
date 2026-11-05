// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

private final class Recording: HTTPTransport, @unchecked Sendable {
  private let lock = NSLock()
  private(set) var requests: [URLRequest] = []
  let body: String
  let status: Int

  init(_ body: String = "{}", status: Int = 200) {
    self.body = body
    self.status = status
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    lock.withLock { requests.append(request) }
    return (
      Data(body.utf8),
      HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: nil,
        headerFields: ["Content-Disposition": "attachment; filename=\"invoice-1042.pdf\""])!
    )
  }
}

private func client(_ transport: HTTPTransport) -> ConsoleAPIClient {
  ConsoleAPIClient(origin: "https://console.test", getIDToken: { _ in "token" }, transport: transport, sleep: { _ in })
}

private func order(_ fields: [String: Any]) throws -> HostOrder {
  var filled = fields
  if filled["status"] == nil { filled["status"] = "paid" }
  if filled["number"] == nil { filled["number"] = 1042 }
  return try JSONDecoder().decode(HostOrder.self, from: JSONSerialization.data(withJSONObject: filled))
}

private func send(to: String, atMs: Double = 1_793_000_000_000, paid: Bool = false) -> [String: Any] {
  ["atMs": atMs, "by": "u1", "messageId": "m", "paid": paid, "subject": "s", "to": to, "totalCents": 1000]
}

private let quote: [String: Any] = [
  "createdAtMs": 1, "createdBy": "u1", "revision": 1, "stage": "draft", "updatedAtMs": 1, "updatedBy": "u1",
  "tax": ["source": "none"], "customer": ["email": "quote@example.test"],
]

final class OrderInvoiceTests: XCTestCase {
  func testAPaidOrderIsOneThatStillStandsAsPaid() throws {
    for status in ["paid", "partially_fulfilled", "fulfilled", "delivered"] {
      XCTAssertTrue(invoiceIsPaid(try order(["status": status])), status)
    }
    for status in ["pending", "cancelled", "refunded"] {
      XCTAssertFalse(invoiceIsPaid(try order(["status": status])), status)
    }
  }

  func testTheFormAddressesTheCustomerThenTheLastSend() throws {
    XCTAssertEqual(invoiceSendPrefill(try order(["customerEmail": " a@example.test "])), "a@example.test")
    XCTAssertEqual(invoiceSendPrefill(try order(["invoiceSends": [send(to: "b@example.test")]])), "b@example.test")
    XCTAssertEqual(invoiceSendPrefill(try order([:])), "")
  }

  func testTheSubjectKeepsTheConversationElseNamesTheBusiness() throws {
    let plain = try order([:])
    let number = formatInvoiceNumber(plain, orderID: "o1")
    XCTAssertEqual(invoiceEmailDefaultSubject(plain, businessName: " Test Shop ", orderID: "o1"), "\(number) from Test Shop")
    XCTAssertEqual(invoiceEmailDefaultSubject(plain, businessName: "", orderID: "o1"), number)
    let threaded = try order(["emailThread": ["messageId": "m", "references": [], "subject": "Your order"]])
    XCTAssertEqual(invoiceEmailDefaultSubject(threaded, businessName: "Test Shop", orderID: "o1"), "Your order")
  }

  func testTheSentLineNamesTheLastSendInTheGivenZone() throws {
    XCTAssertNil(invoiceSentLine(try order([:])))
    let sends = [send(to: "old@example.test", atMs: 1), send(to: "new@example.test", atMs: 1_793_000_000_000, paid: true)]
    XCTAssertEqual(
      invoiceSentLine(try order(["invoiceSends": sends]), timeZone: "UTC"),
      "Paid invoice sent \(formatReceiptTime(1_793_000_000_000, timeZone: "UTC")) to new@example.test.")
    XCTAssertTrue(
      invoiceSentLine(try order(["invoiceSends": [send(to: "")]]))?.hasSuffix("to the customer.") == true)
  }

  func testAnOfflineSaleSaysWhenAndWhatToCheck() throws {
    XCTAssertNil(orderOfflineNotice(try order([:])))
    let plain: [String: Any] = ["flags": [], "saleKey": "k", "soldAtMs": 1_793_000_000_000, "syncedAtMs": 1_793_000_600_000, "syncedBy": "u1"]
    let quiet = try XCTUnwrap(orderOfflineNotice(try order(["offline": plain]), timeZone: "UTC"))
    XCTAssertFalse(quiet.needsCheck)
    XCTAssertTrue(quiet.text.hasPrefix("Rung while the register was offline\nRung "))
    var flagged = plain
    flagged["flags"] = ["stock-short", "late-sync"]
    flagged["stockConflicts"] = [["applied": 1, "name": "Mug", "productId": "p", "requested": 3, "shortUnits": 2]]
    let loud = try XCTUnwrap(orderOfflineNotice(try order(["offline": flagged]), timeZone: "UTC"))
    XCTAssertTrue(loud.needsCheck)
    let lines = loud.text.components(separatedBy: "\n")
    XCTAssertEqual(lines[2], "2 of 3× Mug not in stock")
    XCTAssertEqual(lines.count, 4, "the stock flag is said by its conflict, not twice")
    XCTAssertEqual(lines[3], ContractValues.shared.posOfflineFlagLabels["late-sync"])
  }

  func testTheSmallPrintSaysWhereRepliesGo() {
    XCTAssertTrue(invoiceSendNote(paid: true, contact: "hi@example.test").hasSuffix("Replies go to hi@example.test."))
    XCTAssertTrue(invoiceSendNote(paid: false, contact: nil).hasSuffix("Replies go to your email."))
  }

  func testTheSiteDetailsPreferSetupBusinessAndDropANonAddress() {
    let site = invoiceSiteDetails([
      "displayName": "Site", "seo": ["entity": ["name": "Business", "email": "hi@example.test"]],
      "business": ["supportEmail": "old@example.test"],
    ])
    XCTAssertEqual(site.businessName, "Business")
    XCTAssertEqual(site.contact, "hi@example.test")
    let older = invoiceSiteDetails(["displayName": " Site ", "business": ["supportEmail": "not an address"]])
    XCTAssertEqual(older.businessName, "Site")
    XCTAssertNil(older.contact)
  }

  func testSendingCarriesTheFormAndItsAttemptKey() async throws {
    let transport = Recording(#"{"sent":true,"to":"a@example.test"}"#)
    let to = try await sendOrderInvoice(
      api: client(transport), hostID: "h1", orderID: "o1", to: "a@example.test", subject: "S", message: "M", attemptKey: "k1")
    XCTAssertEqual(to, "a@example.test")
    let request = try XCTUnwrap(transport.requests.last)
    XCTAssertEqual(request.url?.path, "/api/commerce/order-invoice-send")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), "k1")
    let body = try XCTUnwrap(JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
    XCTAssertEqual(body["hostId"] as? String, "h1")
    XCTAssertEqual(body["orderId"] as? String, "o1")
    XCTAssertEqual(body["subject"] as? String, "S")
    XCTAssertEqual(body["message"] as? String, "M")
  }

  func testThePdfComesFromThePrintRouteUnderItsOwnName() async throws {
    let transport = Recording("%PDF-1.7")
    let url = try await downloadOrderInvoicePDF(api: client(transport), hostID: "h 1", orderID: "o1", number: "#1042")
    XCTAssertEqual(url.lastPathComponent, "invoice-1042.pdf")
    XCTAssertEqual(try Data(contentsOf: url), Data("%PDF-1.7".utf8))
    let request = try XCTUnwrap(transport.requests.last)
    XCTAssertEqual(request.httpMethod, "GET")
    XCTAssertEqual(request.url?.query, "hostId=h%201&orderId=o1&kind=invoice-pdf")
  }

  func testARefusedPdfSaysTheRoutesWords() async {
    let transport = Recording(#"{"error":"No invoice here"}"#, status: 403)
    do {
      _ = try await downloadOrderInvoicePDF(api: client(transport), hostID: "h1", orderID: "o1", number: "#1042")
      XCTFail("should have thrown")
    } catch {
      XCTAssertEqual((error as? ConsoleAPIError)?.message, "No invoice here")
    }
  }
}
