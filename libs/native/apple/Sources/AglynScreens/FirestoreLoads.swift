// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/// The reads a spec makes straight from Firestore, under the same rules the
/// console's own reads run under (the console reads these documents with the
/// client SDK too): one document (`doc`) or one collection query (`query`).
enum FirestoreLoads {
  /// A Firestore value as JSON: a date becomes epoch milliseconds.
  static func json(_ value: Any?) -> JSONValue {
    switch value {
    case nil: return .null
    case let text as String: return .string(text)
    case let flag as Bool: return .bool(flag)
    case let number as NSNumber:
      if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
      return .number(number.doubleValue)
    case let number as Int: return .number(Double(number))
    case let number as Double: return .number(number)
    case let date as Date: return .number((date.timeIntervalSince1970 * 1000).rounded())
    case let items as [Any]: return .array(items.map { json($0) })
    case let record as [String: Any]: return .object(record.mapValues { json($0) })
    default: return .string(String(describing: value!))
    }
  }

  /// JSON as the plain values a Firestore write takes.
  static func plain(_ value: JSONValue) -> Any {
    switch value {
    case .null: return NSNull()
    case .bool(let flag): return flag
    case .number(let number): return number == number.rounded() && abs(number) < 9e15 ? Int(number) as Any : number
    case .string(let text): return text
    case .array(let items): return items.map(plain)
    case .object(let record): return record.mapValues(plain)
    }
  }

  static func json(_ doc: FirestoreDocument) -> JSONValue {
    var record = doc.data.mapValues { json($0) }
    record["$id"] = .string(doc.id)
    return .object(record)
  }

  static func segments(_ path: String) -> [String] {
    path.split(separator: "/").map(String.init)
  }

  /// One document, read once.
  @MainActor
  static func document(_ reader: FirestoreReader, _ path: String) async throws -> JSONValue {
    let doc: FirestoreDocument? = try await withCheckedThrowingContinuation { continuation in
      var listener: FirestoreListening?
      var finished = false
      listener = reader.listenDocument(segments(path)) { result in
        guard !finished else { return }
        finished = true
        listener?.remove()
        continuation.resume(with: result)
      }
      if finished { listener?.remove() }
    }
    return doc.map(json) ?? .null
  }

  /// A where value as the readers take it: a number, bool or string, or a `{ "$date": ISO }` as a Date.
  static func plainValue(_ value: JSONValue) -> Any {
    switch value {
    case .bool(let flag): return flag
    case .number(let number): return number == number.rounded() && abs(number) < 9_007_199_254_740_992 ? Int64(number) : number
    case .object(let record):
      if let iso = record["$date"]?.stringValue {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: iso) { return date }
      }
      return ScreenValues.text(value)
    default: return ScreenValues.text(value)
    }
  }

  /// A collection query, read once: `{ "items": [...] }`.
  /// `spec` is `{ collection, where: [[field, "==", value]], orderBy: "field desc", limit }`.
  @MainActor
  static func query(_ reader: FirestoreReader, _ spec: JSONValue, in context: JSONValue) async throws -> JSONValue {
    let collection = ScreenValues.render(spec["collection"]?.stringValue ?? "", in: context)
    // `[field, op, value]`: equality, or any list-query operator (`>`, `in`, …); a value may be
    // `{ "$date": ISO }` for a timestamp.
    var equals: [(field: String, value: Any)] = []
    var filters: [ListQueryConstraint] = []
    for clause in spec["where"].array {
      guard case .array(let parts) = clause, parts.count == 3, let field = parts[0].stringValue else { continue }
      let resolved = ScreenValues.resolve(parts[2].stringValue ?? ScreenValues.text(parts[2]), in: context)
      let value: Any = plainValue(parts[2].stringValue == nil ? parts[2] : resolved)
      let op = parts[1].stringValue ?? "=="
      if op == "==" {
        equals.append((field, value))
      } else {
        filters.append(ListQueryConstraint(path: field, op: ListQueryOp(rawValue: op) ?? .unknown, value: value))
      }
    }
    var order: [FirestoreQuery.Order] = []
    if let raw = spec["orderBy"]?.stringValue {
      let parts = raw.split(separator: " ")
      order = [FirestoreQuery.Order(String(parts[0]), descending: parts.count > 1 && parts[1] == "desc")]
    }
    let counting = spec["count"] == .bool(true)
    // `count: true` answers `{ "count": N }`: the server's count where the reader has one (the web
    // SDK's getCountFromServer), else the rows up to a ceiling.
    if counting, let counted = try await reader.count(FirestoreQuery(segments(collection), equals: equals, filters: filters)) {
      return ["count": .number(Double(counted))]
    }
    let limit = ScreenValues.number(spec["limit"]).map { Int($0) } ?? (counting ? 1000 : 50)
    let query = FirestoreQuery(segments(collection), equals: equals, filters: filters, order: order, limit: limit)
    let docs: [FirestoreDocument] = try await withCheckedThrowingContinuation { continuation in
      var listener: FirestoreListening?
      var finished = false
      listener = reader.listen(query) { result in
        guard !finished else { return }
        finished = true
        listener?.remove()
        continuation.resume(with: result)
      }
      if finished { listener?.remove() }
    }
    if counting { return ["count": .number(Double(docs.count))] }
    return ["items": .array(docs.map(json))]
  }
}
