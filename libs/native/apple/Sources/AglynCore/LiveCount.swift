// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// How a plan allowance counts a collection whose delete is a SOFT delete (AGL-3918): a deleted document frees its
// slot, an archived one keeps it. Deleting stamps `deletedAt` and leaves the document, so the count is every document
// less the tombstones, the same two aggregates `/api/hosts/resources` counts a create at. The Kotlin kit's
// `LiveCount.kt`; the console's `live-document-count.ts`.

/// The filter that matches a deleted document. Every timestamp sorts after the epoch, and neither `null` nor an absent
/// field matches an inequality, so this selects exactly the documents whose `deletedAt` holds a real time.
public func tombstoneConstraint() -> ListQueryConstraint {
  ListQueryConstraint(path: "deletedAt", op: .greaterThan, value: Date(timeIntervalSince1970: 0))
}

/// The two aggregates a live count reads: every document of `path`, and its tombstones.
public func liveCountQueries(_ path: [String]) -> (total: FirestoreQuery, tombstones: FirestoreQuery) {
  (FirestoreQuery(path), FirestoreQuery(path, filters: [tombstoneConstraint()]))
}

/// The live count, never below zero: the two aggregates are separate reads, and a delete between them can make the
/// second the larger.
public func liveCountOf(total: Int, tombstones: Int) -> Int { max(0, total - tombstones) }

/// Whether a stored document is live: no `deletedAt`, or `deletedAt: null`.
public func isLiveDocument(_ data: [String: Any]) -> Bool {
  switch data["deletedAt"] {
  case nil, is NSNull: true
  default: false
  }
}

extension FirestoreReader {
  /// The live documents at `path` as the server counts them, or nil where this reader cannot count either aggregate.
  public func liveCount(_ path: [String]) async throws -> Int? {
    let queries = liveCountQueries(path)
    guard let total = try await count(queries.total) else { return nil }
    guard let tombstones = try await count(queries.tombstones) else { return nil }
    return liveCountOf(total: total, tombstones: tombstones)
  }
}
