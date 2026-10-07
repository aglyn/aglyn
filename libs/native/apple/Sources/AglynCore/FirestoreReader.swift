// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

/// One Firestore document as the app reads it: its id and its fields.
public struct FirestoreDocument: @unchecked Sendable {
  public let id: String
  /// Plain values: String, Bool, Int/Double (as NSNumber), Date, arrays and dictionaries.
  public let data: [String: Any]

  public init(id: String, data: [String: Any]) {
    self.id = id
    self.data = data
  }

  public func string(_ key: String) -> String? { data[key] as? String }
  public func bool(_ key: String) -> Bool? { data[key] as? Bool }
  public func int(_ key: String) -> Int? { (data[key] as? NSNumber)?.intValue }
  public func double(_ key: String) -> Double? { (data[key] as? NSNumber)?.doubleValue }
  public func date(_ key: String) -> Date? { data[key] as? Date }
}

/// A query the reader runs: a collection path, equality filters, an order and a window.
public struct FirestoreQuery: @unchecked Sendable {
  public struct Order: Sendable {
    public var field: String
    public var descending: Bool
    public init(_ field: String, descending: Bool = false) {
      self.field = field
      self.descending = descending
    }
  }

  public var collection: [String]
  public var equals: [(field: String, value: Any)]
  /// Filters beyond equality, as a list-query plan makes them.
  public var filters: [ListQueryConstraint]
  public var order: [Order]
  public var limit: Int?

  public init(
    _ collection: [String], equals: [(field: String, value: Any)] = [], filters: [ListQueryConstraint] = [],
    order: [Order] = [], limit: Int? = nil
  ) {
    self.collection = collection
    self.equals = equals
    self.filters = filters
    self.order = order
    self.limit = limit
  }

  /// Every filter, equality ones first.
  public var allFilters: [ListQueryConstraint] {
    equals.map { ListQueryConstraint(path: $0.field, op: .equal, value: $0.value) } + filters
  }

  public var path: String { collection.joined(separator: "/") }
}

/// A value the server fills in on write.
public enum FirestoreSentinel: Sendable {
  case serverTimestamp
  /// Removes its field in a merge: the web SDK's `deleteField()`.
  case delete
}

/// Writes the console makes straight to Firestore (no route), made the same
/// way under the same security rules, as the signed-in person (the Kotlin
/// kit's `FirestoreWriter`). `merge` is the web SDK's
/// `setDoc(ref, data, { merge: true })`: nested maps merge key by key, every
/// other value replaces its field, a missing document is created, a `Date`
/// writes a timestamp and `FirestoreSentinel.delete` removes its field.
public protocol FirestoreWriter: Sendable {
  func merge(_ path: [String], _ data: [String: Any]) async throws
}

/// The writer over a reader's own merge write.
public struct ReaderMergeWriter: FirestoreWriter {
  let reader: FirestoreReader
  public init(_ reader: FirestoreReader) { self.reader = reader }
  public func merge(_ path: [String], _ data: [String: Any]) async throws {
    try await reader.setDocument(path, data, merge: true)
  }
}

/// A shell with nothing to write through; every write fails with words for the screen.
public struct NoFirestoreWrites: FirestoreWriter {
  public init() {}
  public func merge(_ path: [String], _ data: [String: Any]) async throws {
    throw ConsoleAPIError(status: 0, message: "Saving is not available here.")
  }
}

/// A live listener; `remove()` stops it.
public protocol FirestoreListening: AnyObject {
  func remove()
}

/// How the app reads Firestore: under the same security rules the console
/// runs under, as the signed-in member. An interface rather than the SDK, so
/// a platform without the SDK (or a test) can stand in its own reader.
///
/// Its writes are the ones the console makes straight to Firestore, under the
/// same rules (a plugin reaches them through `FirestoreWriter`); every other
/// write goes through the console API route the console calls.
public protocol FirestoreReader: AnyObject, Sendable {
  @MainActor
  func listen(
    _ query: FirestoreQuery,
    _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void
  ) -> FirestoreListening

  @MainActor
  func listenDocument(
    _ path: [String],
    _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void
  ) -> FirestoreListening

  /// Writes fields (a `FirestoreSentinel` value becomes its server value).
  func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws
  func deleteDocument(_ path: [String]) async throws
}

/// A listener that does nothing, for a query that cannot run yet.
public final class NoListener: FirestoreListening {
  public init() {}
  public func remove() {}
}
