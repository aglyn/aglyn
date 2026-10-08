// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import Observation

/// A live list a window at a time: the query is listened to with a limit
/// that grows a page per `loadMore()`, so rows stay current and nothing
/// already shown is read again. One probe row past the window says whether
/// another window exists. The Kotlin kit's `LiveQueryList`.
///
/// `show(_:)` swaps the query (a chip, a search) and starts the window over;
/// a nil query (nothing to read yet) reads as an empty list.
@MainActor
@Observable
public final class LiveQueryList<Row> {
  public private(set) var rows: [Row] = []
  public private(set) var ready = false
  public private(set) var failure: String?
  public private(set) var hasMore = false

  @ObservationIgnored private let pageSize: Int
  @ObservationIgnored private let map: (FirestoreDocument) -> Row
  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var make: ((Int) -> FirestoreQuery?)?
  @ObservationIgnored private var limit: Int
  @ObservationIgnored private var listener: FirestoreListening?

  public init(pageSize: Int = 25, map: @escaping (FirestoreDocument) -> Row) {
    self.pageSize = pageSize
    self.limit = pageSize
    self.map = map
  }

  public func show(_ reader: FirestoreReader, _ query: @escaping (_ limit: Int) -> FirestoreQuery?) {
    self.reader = reader
    make = query
    limit = pageSize
    ready = false
    listen()
  }

  public func loadMore() {
    guard hasMore else { return }
    limit += pageSize
    listen()
  }

  public func retry() {
    ready = false
    listen()
  }

  public func stop() {
    listener?.remove()
    listener = nil
  }

  private func listen() {
    listener?.remove()
    failure = nil
    let window = limit
    guard let reader, let query = make?(window + 1) else {
      rows = []
      hasMore = false
      ready = true
      return
    }
    listener = reader.listen(query) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.hasMore = docs.count > window
        self.rows = docs.prefix(window).map(self.map)
      case .failure(let error):
        self.failure = (error as? LocalizedError)?.errorDescription ?? "Check the connection and try again."
      }
      self.ready = true
    }
  }
}

/// One document, live: `nil` once it is known to be missing.
@MainActor
@Observable
public final class LiveDocument {
  public private(set) var document: FirestoreDocument?
  public private(set) var ready = false
  public private(set) var failed = false
  @ObservationIgnored private var listener: FirestoreListening?

  public init() {}

  public func start(_ reader: FirestoreReader, _ path: [String]) {
    listener?.remove()
    ready = false
    failed = false
    listener = reader.listenDocument(path) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let doc):
        self.document = doc
      case .failure:
        self.failed = true
      }
      self.ready = true
    }
  }

  public func stop() {
    listener?.remove()
    listener = nil
  }
}

/// A Firestore value as epoch milliseconds: a timestamp (`Date`) or a stored `*Ms` number.
public func epochMillis(_ value: Any?) -> Int64? {
  switch value {
  case let date as Date: return Int64((date.timeIntervalSince1970 * 1000).rounded())
  case let number as NSNumber: return number.int64Value
  default: return nil
  }
}

/// A JSON body for a console route, from plain values (strings, numbers, booleans, arrays, maps); nil values are left out.
public func jsonBody(_ fields: [String: Any?]) -> JSONValue {
  .object(fields.compactMapValues { $0.flatMap(jsonValue) })
}

/// A plain value as `JSONValue`; anything else is nil.
public func jsonValue(_ value: Any) -> JSONValue? {
  switch value {
  case let json as JSONValue: return json
  case let string as String: return .string(string)
  case let bool as Bool: return .bool(bool)
  case let int as Int: return .number(Double(int))
  case let int as Int64: return .number(Double(int))
  case let double as Double: return .number(double)
  case let number as NSNumber: return .number(number.doubleValue)
  case let array as [Any]: return .array(array.compactMap(jsonValue))
  case let map as [String: Any]: return .object(map.compactMapValues(jsonValue))
  default: return nil
  }
}
