// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

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
  public var order: [Order]
  public var limit: Int?

  public init(
    _ collection: [String], equals: [(field: String, value: Any)] = [], order: [Order] = [],
    limit: Int? = nil
  ) {
    self.collection = collection
    self.equals = equals
    self.order = order
    self.limit = limit
  }

  public var path: String { collection.joined(separator: "/") }
}

/// A value the server fills in on write.
public enum FirestoreSentinel: Sendable {
  case serverTimestamp
}

/// A live listener; `remove()` stops it.
public protocol FirestoreListening: AnyObject {
  func remove()
}

/// How the app reads Firestore: under the same security rules the console
/// runs under, as the signed-in member. An interface rather than the SDK, so
/// a platform without the SDK (or a test) can stand in its own reader.
///
/// The writes here are for the member's own rows only (their device
/// registry and notification read marks), which the rules keep owner-only.
/// Every other write goes through a console API route.
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
