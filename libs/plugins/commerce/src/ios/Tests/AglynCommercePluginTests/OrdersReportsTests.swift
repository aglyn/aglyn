// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynCommercePlugin

/// Answers one query with documents, and the site document with a currency.
private final class ShiftDocs: FirestoreReader, @unchecked Sendable {
  private final class Nothing: FirestoreListening { func remove() {} }
  var docs: [FirestoreDocument] = []
  private(set) var asked: [FirestoreQuery] = []

  @MainActor
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
    -> FirestoreListening
  {
    asked.append(query)
    onChange(.success(docs))
    return Nothing()
  }

  @MainActor
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
    -> FirestoreListening
  {
    onChange(.success(FirestoreDocument(id: path.last ?? "", data: ["currency": "CAD"])))
    return Nothing()
  }

  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}
}

private let closedShift: [String: Any] = [
  "hostId": "h1", "registerId": "r1", "status": "closed", "openedBy": "u1", "openedByName": "Cashier One",
  "openedAtMs": 1_792_929_600_000, "openingFloatCents": 15000, "cashEvents": [], "closedBy": "u1",
  "closedAtMs": 1_792_958_700_000, "countedCashCents": 20350, "expectedCashCents": 20550, "varianceCents": -200,
  "netSalesCents": 23110,
  "report": [
    "orderCount": 11, "grossSalesCents": 24360, "discountsCents": 250, "taxCents": 1840, "tipsCents": 1260,
    "salesByTender": ["card_present": 15810, "cash": 7300], "refundCount": 0, "refundsCents": 0, "refundsByTender": [:],
    "netSalesCents": 23110, "openingFloatCents": 15000, "cashSalesCents": 7300, "paidInCents": 0, "paidOutCents": 500,
    "dropsCents": 0, "cashRefundsCents": 0, "expectedCashCents": 20550,
  ] as [String: Any],
]

@MainActor
final class OrdersReportsTests: XCTestCase {
  func testAShiftDocumentReadsAsAHistoryRowAndAnUnreadableOneIsSkipped() {
    let row = shiftRow(FirestoreDocument(id: "s1", data: closedShift), registerName: "Front counter")
    XCTAssertEqual(row?.id, "s1")
    XCTAssertEqual(row?.registerName, "Front counter")
    XCTAssertEqual(row?.shift.report?.netSalesCents, 23110)
    XCTAssertNil(shiftRow(FirestoreDocument(id: "bad", data: ["status": "closed"]), registerName: "Front counter"))
  }

  func testTheHistoryReadsOneRegistersNewestShiftsAndSharesThem() throws {
    let reader = ShiftDocs()
    reader.docs = [FirestoreDocument(id: "s1", data: closedShift), FirestoreDocument(id: "bad", data: [:])]
    let model = ShiftHistoryModel()
    model.show(reader, hostID: "h1", register: PosRegister(id: "r1", name: "Front counter", locationID: nil))
    let query = try XCTUnwrap(reader.asked.last)
    XCTAssertEqual(query.collection, ["hosts", "h1", "registers", "r1", "shifts"])
    XCTAssertEqual(query.order.first?.field, "openedAtMs")
    XCTAssertEqual(query.order.first?.descending, true)
    XCTAssertEqual(query.limit, shiftHistoryWindow)
    XCTAssertEqual(model.state.value?.map(\.id), ["s1"])
    let file = try XCTUnwrap(model.csvFile(registerName: "Front counter"))
    XCTAssertEqual(file.lastPathComponent, "shifts-front-counter.csv")
    let text = try String(contentsOf: file, encoding: .utf8)
    XCTAssertTrue(text.hasPrefix("Shift,Register,Opened"))
    XCTAssertTrue(text.contains("s1,Front counter,2026-10-25T12:00:00.000Z,Cashier One"))
  }

  func testAStoreWithoutRegistersHasNoShiftsToShow() {
    let model = ShiftHistoryModel()
    model.show(ShiftDocs(), hostID: "h1", register: nil)
    XCTAssertEqual(model.state.value?.count, 0)
    XCTAssertNil(model.csvFile(registerName: "Front counter"))
  }

  func testTheReportsReadTheStoresRegistersAndItsCurrency() {
    let reader = ShiftDocs()
    reader.docs = [FirestoreDocument(id: "r2", data: ["name": "Patio"]), FirestoreDocument(id: "r1", data: ["name": "Front counter"])]
    let registers = OrdersRegisters()
    registers.start(reader, hostID: "h1")
    XCTAssertEqual(registers.registers.map(\.name), ["Front counter", "Patio"])
    XCTAssertEqual(registers.currency, "cad")
  }
}
