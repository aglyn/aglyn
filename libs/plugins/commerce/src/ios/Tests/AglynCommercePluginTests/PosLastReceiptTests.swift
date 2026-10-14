// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynCommercePlugin

private final class Listening: FirestoreListening, @unchecked Sendable {
  func remove() {}
}

/// A reader that hands each listener the answer a test scripts for it.
@MainActor
private final class ScriptedReader: FirestoreReader, @unchecked Sendable {
  var printers: [FirestoreDocument] = []
  var orders: [String: FirestoreDocument] = [:]
  var queries: [FirestoreQuery] = []

  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
    queries.append(query)
    onChange(.success(printers))
    return Listening()
  }

  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
    onChange(.success(orders[path.last ?? ""]))
    return Listening()
  }

  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}
  func count(_ query: FirestoreQuery) async throws -> Int? { nil }
}

private final class FakeSale: PosSaleAPI, @unchecked Sendable {
  let hostID = "h1"
  private let lock = NSLock()
  private var steps: [String] = []
  var failure: ConsoleAPIError?
  var calls: [String] { lock.withLock { steps } }
  func context() async throws -> PosContext { throw ConsoleAPIError(status: 0, message: "unused") }
  func openSale(registerID: String, locationID: String?, cart: Cart, attemptKey: String) async throws -> PosOpenedSale {
    throw ConsoleAPIError(status: 0, message: "unused")
  }
  func payment(orderID: String, step: SaleStep, attemptKey: String?) async throws -> PosPaymentAnswer {
    lock.withLock { steps.append("\(orderID) \(step.action)") }
    if let failure { throw failure }
    return PosPaymentAnswer(
      sale: PosSale(orderID: orderID, status: "paid", totalCents: 0, paidCents: 0, dueCents: 0, tenderableCents: 0, tipCents: 0, payments: []),
      paymentID: nil, completed: false, clientSecret: nil, paymentIntentID: nil)
  }
  func giftCardBalance(code: String) async throws -> GiftCardBalance { throw ConsoleAPIError(status: 0, message: "unused") }
}

@MainActor
final class PosLastReceiptModelTests: XCTestCase {
  private func defaults() -> UserDefaults {
    let name = "last-receipt-\(UUID().uuidString)"
    let suite = UserDefaults(suiteName: name)!
    suite.removePersistentDomain(forName: name)
    return suite
  }

  private func model(_ reader: ScriptedReader, _ api: FakeSale, defaults: UserDefaults) -> PosLastReceiptModel {
    PosLastReceiptModel(reader: reader, api: api, store: RegisterStore(defaults: defaults, hostID: "h1"), hostID: "h1")
  }

  func testNothingIsRememberedUntilASaleFinishes() {
    let last = model(ScriptedReader(), FakeSale(), defaults: defaults())
    last.watch(registerID: "r1")
    XCTAssertNil(last.lastSale)
    XCTAssertNil(last.summary)
  }

  func testAFinishedSaleIsShownByItsNumberAndTotalAndKeptAcrossARestart() {
    let suite = defaults()
    let reader = ScriptedReader()
    reader.orders["o1"] = FirestoreDocument(id: "o1", data: ["number": 1042, "totals": ["totalCents": 2750]])
    let last = model(reader, FakeSale(), defaults: suite)
    last.watch(registerID: "r1")
    last.remember(orderID: "o1")
    XCTAssertEqual(last.summary, LastSaleSummary(label: "#1042", totalCents: 2750))
    let again = model(reader, FakeSale(), defaults: suite)
    again.watch(registerID: "r1")
    XCTAssertEqual(again.lastSale?.orderID, "o1")
    let other = model(reader, FakeSale(), defaults: suite)
    other.watch(registerID: "r2")
    XCTAssertNil(other.lastSale, "another till has its own last sale")
  }

  func testAnOrderWithNoNumberYetIsNamedByItsId() {
    XCTAssertEqual(lastSaleLabel(number: nil, orderID: "abcdefghijk"), "#abcdefgh")
    XCTAssertEqual(lastSaleLabel(number: 0, orderID: "abcdefghijk"), "#abcdefgh")
    XCTAssertEqual(lastSaleLabel(number: 7, orderID: "x"), "#7")
  }

  func testThePrinterButtonAppearsOnlyForARegisterWithAPrinter() {
    let reader = ScriptedReader()
    let last = model(reader, FakeSale(), defaults: defaults())
    last.watch(registerID: "r1")
    XCTAssertFalse(last.hasPrinter)
    XCTAssertEqual(reader.queries.last?.collection, ["hosts", "h1", "printers"])
    XCTAssertEqual(reader.queries.last?.equals.first?.field, "registerId")
    reader.printers = [FirestoreDocument(id: "pr1", data: [:])]
    last.watch(registerID: "r1")
    XCTAssertTrue(last.hasPrinter)
  }

  func testSendingAsksThePaymentRouteToPrintTheLastSale() async {
    let api = FakeSale()
    let last = model(ScriptedReader(), api, defaults: defaults())
    last.watch(registerID: "r1")
    last.remember(orderID: "o1")
    await last.sendToPrinter()
    XCTAssertEqual(api.calls, ["o1 receipt"])
    XCTAssertEqual(last.notice, "Sent to the receipt printer")
    XCTAssertNil(last.error)
  }

  func testARefusalShowsItsWords() async {
    let api = FakeSale()
    api.failure = ConsoleAPIError(status: 404, message: "No printer for this register")
    let last = model(ScriptedReader(), api, defaults: defaults())
    last.watch(registerID: "r1")
    last.remember(orderID: "o1")
    await last.sendToPrinter()
    XCTAssertEqual(last.error, "No printer for this register")
    XCTAssertNil(last.notice)
  }

  func testNothingIsSentWithNoLastSale() async {
    let api = FakeSale()
    let last = model(ScriptedReader(), api, defaults: defaults())
    last.watch(registerID: "r1")
    await last.sendToPrinter()
    XCTAssertTrue(api.calls.isEmpty)
  }
}
