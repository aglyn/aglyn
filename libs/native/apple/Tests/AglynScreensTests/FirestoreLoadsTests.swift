// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// The Firestore reads a spec makes: filters of every operator, server counts and sums, and a plan feature's gate.
/// The Kotlin renderer's `FirestoreLoadsTest` holds the same cases.
final class FirestoreLoadsTests: XCTestCase {
  private final class Reader: FirestoreReader, @unchecked Sendable {
    var docs: [String: [String: Any]] = [:]
    var counted: Int? = 7
    var summed: Double? = 1234.5
    var queries: [FirestoreQuery] = []
    var asked = ""

    @MainActor
    func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
      queries.append(query)
      onChange(.success([]))
      return NoListener()
    }

    @MainActor
    func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
      onChange(.success(docs[path.joined(separator: "/")].map { FirestoreDocument(id: path.last ?? "", data: $0) }))
      return NoListener()
    }

    func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
    func deleteDocument(_ path: [String]) async throws {}
    func count(_ query: FirestoreQuery) async throws -> Int? {
      queries.append(query)
      return counted
    }
    func sum(_ query: FirestoreQuery, field: String) async throws -> Double? {
      queries.append(query)
      asked = field
      return summed
    }
  }

  private let context: JSONValue = ["site": ["id": "h1"], "params": ["q": "Ada Lovelace"], "org": ["id": "o1"]]

  @MainActor
  func testEveryOperatorBecomesAFilterAndTheValueIsRendered() async throws {
    let reader = Reader()
    let spec = try XCTUnwrap(
      JSONValue.decode(
        Data(
          """
          {"collection":"hosts/{site.id}/giftCards","orderBy":"createdAtMs desc","limit":20,
           "where":[["balanceCents",">",0],["status","!=","void"],["searchTokens","array-contains","{params.q:token}"],["kind","in",["a","b"]],["n","<=",5]]}
          """.utf8)))
    _ = try await FirestoreLoads.query(reader, spec, in: context)
    let query = try XCTUnwrap(reader.queries.first)
    XCTAssertEqual(query.collection, ["hosts", "h1", "giftCards"])
    XCTAssertEqual(query.filters.map(\.path), ["balanceCents", "status", "searchTokens", "kind", "n"])
    XCTAssertEqual(query.filters.map { $0.op.rawValue }, [">", "!=", "array-contains", "in", "<="])
    XCTAssertEqual(query.filters[0].value as? Double, 0)
    XCTAssertEqual(query.filters[1].value as? String, "void")
    XCTAssertEqual(query.filters[2].value as? String, "ada")
    XCTAssertEqual(query.filters[3].value as? [String], ["a", "b"])
    XCTAssertEqual(query.filters[4].value as? Double, 5)
    XCTAssertEqual(query.limit, 20)
  }

  @MainActor
  func testAnAggregateAsksTheServerForTheWholeCollectionAndReadsNoRows() async throws {
    let reader = Reader()
    let spec: JSONValue = ["collection": "hosts/h1/giftCards", "limit": 50, "where": [["balanceCents", ">", 0]], "aggregate": ["count": true, "sum": "balanceCents"]]
    let result = try await FirestoreLoads.query(reader, spec, in: context)
    XCTAssertEqual(result["count"], .number(7))
    XCTAssertEqual(result["sum"], .number(1234.5))
    XCTAssertEqual(reader.asked, "balanceCents")
    XCTAssertEqual(result["items"].array.count, 0)
    XCTAssertTrue(reader.queries.allSatisfy { $0.limit == nil }, "a capped list is never the answer")
  }

  @MainActor
  func testAReaderThatCannotAnswerLeavesTheFiguresOutSoTheScreenSaysSo() async throws {
    let reader = Reader()
    reader.counted = nil
    reader.summed = nil
    let spec: JSONValue = ["collection": "hosts/h1/c", "aggregate": ["count": true, "sum": "x"]]
    let result = try await FirestoreLoads.query(reader, spec, in: context)
    XCTAssertNil(result["count"])
    XCTAssertNil(result["sum"])
    XCTAssertEqual(ScreenValues.render("{data.live.sum|'Unavailable':cents}", in: ["data": ["live": result]]), "Unavailable")
  }

  @MainActor
  func testAnEntitlementReadsTheWorkspaceDocumentAndNamesThePlanThatHasTheFeature() async throws {
    let reader = Reader()
    func gate(_ org: [String: Any], _ feature: String = "giftCards") async throws -> JSONValue {
      reader.docs = ["orgs/o1": org]
      return try await FirestoreLoads.entitlement(reader, feature: feature, orgID: "o1")
    }
    let business = try await gate(["plan": "business"])
    XCTAssertEqual(business["carried"], .bool(true))
    let free = try await gate(["plan": "free"])
    XCTAssertEqual(free["carried"], .bool(false))
    XCTAssertEqual(free["label"], .string("Business"))
    let override = try await gate(["plan": "free", "entitlements": ["features": ["giftCards": true]]])
    XCTAssertEqual(override["carried"], .bool(true), "a per-workspace override wins over the plan")
    let unknown = try await gate(["plan": "free"], "nothingLikeIt")
    XCTAssertEqual(unknown["label"], .null)
  }

  /// An order is handed to a widget with what each line has shipped and what is left, as the Kotlin renderer's test holds.
  @MainActor
  func testAnOrderIsHandedToAWidgetWithItsLinesUnitsAndWhatIsLeftToShipOrBringBack() async throws {
    let reader = Reader()
    reader.docs["hosts/h1/orders/ord1234567"] = [
      "status": "paid", "number": 1042, "livemode": true,
      "shippingAddress": ["line1": "1 Main", "city": "Austin", "country": "US"],
      "lineItems": [
        ["productId": "p1", "name": "Mug", "quantity": 3, "unitAmountCents": 1000],
        ["productId": "p2", "name": "Gift", "quantity": 1, "unitAmountCents": 500, "productType": "digital"],
        ["productId": "p3", "name": "Tee", "quantity": 2, "unitAmountCents": 2000],
      ],
      "fulfillments": [["id": "f1", "atMs": 1, "status": "active", "lineItemIds": [0], "lines": [["lineItemId": 0, "quantity": 1]]]],
    ]
    let order = try await FirestoreLoads.orderZone(reader, hostID: "h1", orderID: "ord1234567")
    XCTAssertEqual(order["number"]?.stringValue, "#1042")
    XCTAssertEqual(order["id"]?.stringValue, "ord1234567")
    let lines = ScreenValues.lookup("lines", in: order).array
    XCTAssertEqual(lines.map { ScreenValues.text($0["quantity"]) }, ["3", "1", "2"])
    XCTAssertEqual(lines.map { ScreenValues.text($0["fulfilledQuantity"]) }, ["1", "0", "0"])
    XCTAssertEqual(lines.map { ScreenValues.text($0["remainingQuantity"]) }, ["2", "1", "2"])
    XCTAssertEqual(lines.map { ScreenValues.text($0["requiresShipping"]) }, ["true", "false", "true"])
    XCTAssertEqual(ScreenValues.lookup("shipLines", in: order).array.count, 2, "a digital line does not ship")
    XCTAssertEqual(order["shippable"], .bool(true))
    XCTAssertEqual(order["returnable"], .bool(true))
    XCTAssertEqual(order["testMode"], .bool(false))
    XCTAssertEqual(order["fulfillmentMethod"]?.stringValue, "shipping")
    XCTAssertEqual(order["pickupStatus"]?.stringValue, "preparing")
    reader.docs["hosts/h1/orders/missing"] = nil
    let none = try await FirestoreLoads.orderZone(reader, hostID: "h1", orderID: "missing")
    XCTAssertEqual(none, .null)
  }

  /// A coupon "works through this day" on the device's own clock, as a browser's `Date.parse` of a zone-less time.
  func testADateCanBeTheDevicesOwnEndOfDay() throws {
    let body: JSONValue = ["$dateMs": ["value": "2026-11-30", "time": "23:59:59.999", "local": true]]
    let got = ScreenValues.resolveBody(body, in: [:])
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .current
    let expected = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 11, day: 30, hour: 23, minute: 59, second: 59, nanosecond: 999_000_000)))
    XCTAssertEqual(got, .number((expected.timeIntervalSince1970 * 1000).rounded()))
  }

  /// Answers a query with as many rows as it was limited to, up to its total.
  private final class Rows: FirestoreReader, @unchecked Sendable {
    let total: Int
    var limits: [Int?] = []
    init(total: Int) { self.total = total }

    @MainActor
    func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void) -> FirestoreListening {
      limits.append(query.limit)
      let count = min(total, query.limit ?? total)
      onChange(.success((1...max(count, 1)).prefix(count).map { FirestoreDocument(id: "d\($0)", data: ["n": $0]) }))
      return NoListener()
    }

    @MainActor
    func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void) -> FirestoreListening {
      onChange(.success(nil))
      return NoListener()
    }

    func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
    func deleteDocument(_ path: [String]) async throws {}
  }

  @MainActor
  private func growing(total: Int, limit: Int) throws -> (ScreenModel, Rows) {
    let spec = try XCTUnwrap(
      ScreenSpec([
        "id": "core.x", "title": "X",
        "load": ["rows": ["query": ["collection": "hosts/h1/rows", "limit": .number(Double(limit))]]],
        "blocks": [["type": "list", "id": "rows", "items": "data.rows.items", "load": "rows", "primary": "{item.n}"]],
      ]))
    let reader = Rows(total: total)
    let api = ConsoleAPIClient(origin: "http://localhost", getIDToken: { _ in "t" })
    return (ScreenModel(spec: spec, context: ["site": ["id": "h1"]], api: api, reader: reader), reader)
  }

  @MainActor
  private func rowCount(_ model: ScreenModel) -> Int { ScreenValues.lookup("data.rows.items", in: model.context).array.count }

  /// A list fed by a Firestore query reads a bigger window each time it is asked for more, and stops offering more when the
  /// window falls short. The Kotlin renderer's `QueryGrowthTest` holds the same cases.
  @MainActor
  func testAFullWindowOffersMoreAndEachAskReadsAnotherPage() async throws {
    let (model, reader) = try growing(total: 5, limit: 2)
    await model.load()
    XCTAssertEqual(rowCount(model), 2)
    XCTAssertEqual(model.cursors["rows"], "2", "a window that came back full may have more behind it")
    await model.loadMore("rows")
    XCTAssertEqual(rowCount(model), 4)
    XCTAssertEqual(model.cursors["rows"], "4")
    await model.loadMore("rows")
    XCTAssertEqual(rowCount(model), 5)
    XCTAssertNil(model.cursors["rows"], "the window fell short, so that was everything")
    XCTAssertEqual(reader.limits, [2, 4, 6])
  }

  @MainActor
  func testAWindowThatFellShortOffersNothingMoreAndAReloadKeepsAGrownOne() async throws {
    let (short, shortReader) = try growing(total: 1, limit: 2)
    await short.load()
    XCTAssertEqual(rowCount(short), 1)
    XCTAssertNil(short.cursors["rows"])
    await short.loadMore("rows")
    XCTAssertEqual(shortReader.limits, [2], "nothing to ask for")
    let (grown, reader) = try growing(total: 9, limit: 3)
    await grown.load()
    await grown.loadMore("rows")
    await grown.load()
    XCTAssertEqual(rowCount(grown), 6, "an action that reloads does not shrink the list the person grew")
    XCTAssertEqual(reader.limits, [3, 6, 6])
  }
}
