// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynCore

/// A reader that counts: the total, and the tombstones when the query filters on `deletedAt`.
private final class CountingReader: FirestoreReader, @unchecked Sendable {
  let total: Int?
  let tombstones: Int?
  var asked: [FirestoreQuery] = []

  init(total: Int?, tombstones: Int?) {
    self.total = total
    self.tombstones = tombstones
  }

  @MainActor
  func listen(_ query: FirestoreQuery, _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void)
    -> FirestoreListening
  { NoListener() }

  @MainActor
  func listenDocument(_ path: [String], _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void)
    -> FirestoreListening
  { NoListener() }

  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {}
  func deleteDocument(_ path: [String]) async throws {}

  func count(_ query: FirestoreQuery) async throws -> Int? {
    asked.append(query)
    return query.allFilters.contains { $0.path == "deletedAt" } ? tombstones : total
  }
}

/// AGL-3918: a plan allowance counts live documents, every one less the deleted ones.
final class LiveCountTests: XCTestCase {
  func testTheTombstoneFilterMatchesARealDeletionTime() {
    let tombstone = tombstoneConstraint()
    XCTAssertEqual(tombstone.path, "deletedAt")
    XCTAssertEqual(tombstone.op, .greaterThan)
    let queries = liveCountQueries(["hosts", "h", "workflows"])
    XCTAssertTrue(queries.total.allFilters.isEmpty)
    XCTAssertEqual(queries.tombstones.allFilters.first?.path, "deletedAt")
  }

  func testCountsEveryDocumentLessTheDeletedOnes() async throws {
    let reader = CountingReader(total: 4, tombstones: 1)
    let live = try await reader.liveCount(["hosts", "h", "workflows"])
    XCTAssertEqual(live, 3)
    XCTAssertEqual(reader.asked.count, 2)
  }

  func testNeverBelowZeroAndUnknownWhenEitherCountIs() async throws {
    XCTAssertEqual(liveCountOf(total: 1, tombstones: 2), 0)
    let refused = try await CountingReader(total: 4, tombstones: nil).liveCount(["hosts", "h", "products"])
    XCTAssertNil(refused)
  }

  func testAnArchivedDocumentIsLiveAndADeletedOneIsNot() {
    XCTAssertTrue(isLiveDocument(["status": "archived"]))
    XCTAssertTrue(isLiveDocument(["deletedAt": NSNull()]))
    XCTAssertFalse(isLiveDocument(["deletedAt": Date()]))
  }
}
