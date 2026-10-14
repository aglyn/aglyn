// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

private let ana = PosCustomer(kind: "contact", id: "c1", name: "Ana Ruiz", email: "ana@shop.co", phone: "555 0100")

private final class FakeCustomers: PosCustomersAPI, @unchecked Sendable {
  private let lock = NSLock()
  private var recorded: [String] = []
  var calls: [String] { lock.withLock { recorded } }
  var search = PosCustomerSearch(available: true, customers: [])
  var statsAnswer = PosCustomerStats(orderCount: 3, lifetimeSpendCents: 12_500)
  var created = ana
  var failure: ConsoleAPIError?

  private func note(_ call: String) throws {
    lock.withLock { recorded.append(call) }
    if let failure { throw failure }
  }

  func search(_ text: String) async throws -> PosCustomerSearch {
    try note("search \(text)")
    return search
  }
  func stats(email: String) async throws -> PosCustomerStats {
    try note("stats \(email)")
    return statsAnswer
  }
  func create(name: String, email: String, phone: String) async throws -> PosCustomer {
    try note("create \(name)|\(email)|\(phone)")
    return created
  }
}

@MainActor
final class PosCustomerModelTests: XCTestCase {
  func testShortTextAsksNothing() async {
    let api = FakeCustomers()
    let model = PosCustomerModel(api: api)
    model.text = "a"
    await model.search()
    XCTAssertTrue(api.calls.isEmpty)
    XCTAssertTrue(model.results.isEmpty)
  }

  func testASearchListsThePeopleTheRouteFound() async {
    let api = FakeCustomers()
    api.search = PosCustomerSearch(available: true, customers: [ana])
    let model = PosCustomerModel(api: api)
    model.text = " ana "
    await model.search()
    XCTAssertEqual(api.calls, ["search ana"])
    XCTAssertEqual(model.results, [ana])
  }

  func testAWorkspaceWithNoPeopleFallsBackToATypedEmail() async {
    let api = FakeCustomers()
    api.search = PosCustomerSearch(available: false, customers: [])
    let model = PosCustomerModel(api: api)
    model.text = "Buyer@Shop.CO"
    await model.search()
    XCTAssertFalse(model.available)
    XCTAssertEqual(model.typedEmail, "buyer@shop.co")
    XCTAssertEqual(PosCustomer.typed(email: "Buyer@Shop.CO").kind, "none")
  }

  func testStatsReadOnlyForAnAttachedCustomerWithAnEmail() async {
    let api = FakeCustomers()
    let model = PosCustomerModel(api: api)
    await model.loadStats(email: nil)
    XCTAssertTrue(api.calls.isEmpty)
    await model.loadStats(email: "ana@shop.co")
    XCTAssertEqual(model.stats, PosCustomerStats(orderCount: 3, lifetimeSpendCents: 12_500))
    await model.loadStats(email: nil)
    XCTAssertNil(model.stats)
  }

  func testAddingNeedsAnEmailAndPrefillsATypedOne() async {
    let api = FakeCustomers()
    let model = PosCustomerModel(api: api)
    model.text = "new@shop.co"
    model.startAdding()
    XCTAssertEqual(model.draftEmail, "new@shop.co")
    model.draftEmail = "nope"
    let none = await model.create()
    XCTAssertNil(none)
    XCTAssertEqual(model.error, "Add the customer’s email address.")
    XCTAssertTrue(api.calls.isEmpty)
    model.draftName = "Ana Ruiz"
    model.draftEmail = "ana@shop.co"
    let made = await model.create()
    XCTAssertEqual(made, ana)
    XCTAssertFalse(model.adding)
    XCTAssertEqual(api.calls, ["create Ana Ruiz|ana@shop.co|"])
  }

  func testARefusedAddKeepsTheFormOpenWithTheReason() async {
    let api = FakeCustomers()
    api.failure = ConsoleAPIError(status: 409, message: "That customer could not be added.")
    let model = PosCustomerModel(api: api)
    model.startAdding()
    model.draftEmail = "ana@shop.co"
    let made = await model.create()
    XCTAssertNil(made)
    XCTAssertTrue(model.adding)
    XCTAssertEqual(model.error, "That customer could not be added.")
  }
}

final class CartCustomerTests: XCTestCase {
  func testAttachingACustomerMakesTheirEmailTheSales() {
    let cart = Cart.empty.withCustomer(ana)
    XCTAssertEqual(cart.customerEmail, "ana@shop.co")
    XCTAssertEqual(cart.customer, ana)
    XCTAssertNil(cart.withCustomer(nil).customer)
    XCTAssertEqual(cart.withCustomer(nil).customerEmail, "")
  }

  func testTheCustomerSurvivesARestart() {
    let kept = Cart.read(Cart.empty.withCustomer(ana).encoded())
    XCTAssertEqual(kept.customer, ana)
    XCTAssertEqual(kept.customerEmail, "ana@shop.co")
    let typed = Cart.read(Cart.empty.withCustomer(.typed(email: "x@y.co")).encoded())
    XCTAssertEqual(typed.customer?.kind, "none")
    XCTAssertEqual(typed.customerEmail, "x@y.co")
  }

  func testACustomerWithNoEmailKeepsTheReceiptEmailTypedBeforeIt() {
    var cart = Cart.empty.withCustomerEmail("typed@shop.co")
    cart.customer = PosCustomer(kind: "contact", id: "c2", name: "No Mail", email: nil, phone: nil)
    let kept = Cart.read(cart.encoded())
    XCTAssertEqual(kept.customer?.name, "No Mail")
    XCTAssertEqual(kept.customerEmail, "typed@shop.co")
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

final class ConsolePosCustomersAPITests: XCTestCase {
  func testSearchReadsAvailabilityAndPeople() async throws {
    let transport = Recording(
      #"{"available":true,"customers":[{"kind":"contact","id":"c1","name":"Ana Ruiz","email":"ana@shop.co","phone":"555 0100"}]}"#)
    let found = try await ConsolePosCustomersAPI(api: client(transport), hostID: "h1").search("ana")
    XCTAssertEqual(transport.requests.last?.url?.path, "/api/commerce/pos-customer")
    XCTAssertEqual(transport.sent["action"] as? String, "search")
    XCTAssertEqual(transport.sent["text"] as? String, "ana")
    XCTAssertEqual(transport.sent["hostId"] as? String, "h1")
    XCTAssertEqual(found.customers, [ana])
    let none = try await ConsolePosCustomersAPI(api: client(Recording(#"{"available":false,"customers":[]}"#)), hostID: "h1")
      .search("ana")
    XCTAssertFalse(none.available)
  }

  func testStatsAndCreateSpeakTheRoutesWords() async throws {
    let stats = Recording(#"{"orderCount":2,"lifetimeSpendCents":4200}"#)
    let read = try await ConsolePosCustomersAPI(api: client(stats), hostID: "h1").stats(email: "ana@shop.co")
    XCTAssertEqual(stats.sent["action"] as? String, "stats")
    XCTAssertEqual(stats.sent["email"] as? String, "ana@shop.co")
    XCTAssertEqual(read, PosCustomerStats(orderCount: 2, lifetimeSpendCents: 4200))

    let create = Recording(
      #"{"available":true,"customer":{"kind":"contact","id":"c1","name":"Ana Ruiz","email":"ana@shop.co","phone":null},"created":true}"#)
    let made = try await ConsolePosCustomersAPI(api: client(create), hostID: "h1")
      .create(name: " Ana Ruiz ", email: "ana@shop.co", phone: "")
    XCTAssertEqual(create.sent["action"] as? String, "create")
    XCTAssertEqual(create.sent["name"] as? String, "Ana Ruiz")
    XCTAssertEqual(made.id, "c1")
    XCTAssertNil(made.phone)
  }

  func testTheSaleCarriesTheCustomerTheWayTheConsoleDoes() async throws {
    let transport = Recording(#"{"orderId":"o1","totalCents":100,"dueCents":100}"#)
    let cart = Cart.empty
      .adding(CartPick(productID: "p1", variantID: nil, name: "Mug", variantLabel: nil, unitCents: 100))
      .withCustomer(ana)
    _ = try await ConsolePosSaleAPI(api: client(transport), hostID: "h1")
      .openSale(registerID: "r1", locationID: nil, cart: cart, attemptKey: "k")
    XCTAssertEqual(transport.sent["customerEmail"] as? String, "ana@shop.co")
    let customer = transport.sent["customer"] as? [String: Any]
    XCTAssertEqual(customer?["kind"] as? String, "contact")
    XCTAssertEqual(customer?["id"] as? String, "c1")
    XCTAssertEqual(customer?["name"] as? String, "Ana Ruiz")
  }
}
