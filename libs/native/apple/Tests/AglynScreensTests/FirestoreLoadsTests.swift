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

  /// A coupon "works through this day" on the device's own clock, as a browser's `Date.parse` of a zone-less time.
  func testADateCanBeTheDevicesOwnEndOfDay() throws {
    let body: JSONValue = ["$dateMs": ["value": "2026-11-30", "time": "23:59:59.999", "local": true]]
    let got = ScreenValues.resolveBody(body, in: [:])
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .current
    let expected = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 11, day: 30, hour: 23, minute: 59, second: 59, nanosecond: 999_000_000)))
    XCTAssertEqual(got, .number((expected.timeIntervalSince1970 * 1000).rounded()))
  }
}
