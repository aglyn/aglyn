// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import FirebaseFirestore
import Foundation

/// One plan filter as the Firebase SDK takes it: a plain value (`NSNull`,
/// Bool, Int64, Double, String, Date or an array of them).
public struct ListQueryConstraint: @unchecked Sendable {
  public let path: String
  public let op: ListQueryOp
  public let value: Any

  public init(path: String, op: ListQueryOp, value: Any) {
    self.path = path
    self.op = op
    self.value = value
  }

  /// The document-id pseudo-field (`__name__`).
  public var isDocumentID: Bool { path == ContractValues.shared.listQueryIdPath }

  /// `query` narrowed by this one filter.
  func apply(to query: Query) -> Query {
    let field = fieldPath(path)
    switch op {
    case .equal: return query.whereField(field, isEqualTo: value)
    case .notEqual: return query.whereField(field, isNotEqualTo: value)
    case .lessThan: return query.whereField(field, isLessThan: value)
    case .lessThanOrEqual: return query.whereField(field, isLessThanOrEqualTo: value)
    case .greaterThan: return query.whereField(field, isGreaterThan: value)
    case .greaterThanOrEqual: return query.whereField(field, isGreaterThanOrEqualTo: value)
    case .arrayContains: return query.whereField(field, arrayContains: value)
    case .arrayContainsAny: return query.whereField(field, arrayContainsAny: value as? [Any] ?? [value])
    case .in: return query.whereField(field, in: value as? [Any] ?? [value])
    case .unknown: return query
    }
  }
}

private func plainValue(_ value: ContractJSON) -> Any {
  switch value {
  case .null: return NSNull()
  case .bool(let flag): return flag
  case .string(let text): return text
  case .number(let number):
    if number == number.rounded(), abs(number) < 9_007_199_254_740_992 { return Int64(number) }
    return number
  case .array(let values): return values.map(plainValue)
  case .object(let fields):
    if case .string(let iso)? = fields["$date"], let date = parseISOInstant(iso) { return date }
    return fields.mapValues(plainValue)
  }
}

private func parseISOInstant(_ iso: String) -> Date? {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = formatter.date(from: iso) { return date }
  formatter.formatOptions = [.withInternetDateTime]
  return formatter.date(from: iso)
}

/// A dotted plan path as a field path; `__name__` is the document id.
func fieldPath(_ path: String) -> FieldPath {
  path == ContractValues.shared.listQueryIdPath
    ? FieldPath.documentID() : FieldPath(path.split(separator: ".").map(String.init))
}

extension ListQueryPlan {
  /// The plan's filters as the SDK takes them, a `{ "$date": ISO }` value as a `Date`.
  public var constraints: [ListQueryConstraint] {
    filters.map { ListQueryConstraint(path: $0.path, op: $0.op, value: plainValue($0.value)) }
  }

  /// `query` narrowed by the plan's filters, in its order, at most `limit` rows.
  public func apply(to query: Query, limit: Int? = nil) -> Query {
    var built = query
    for constraint in constraints { built = constraint.apply(to: built) }
    built = built.order(by: fieldPath(orderBy.path), descending: orderBy.direction == .desc)
    if let limit { built = built.limit(to: limit) }
    return built
  }

  /// The plan as a reader query over `collection`: its filters, its order,
  /// at most `limit` rows. The same plan runs on the SDK reader and on REST.
  public func firestoreQuery(_ collection: [String], limit: Int? = nil) -> FirestoreQuery {
    FirestoreQuery(
      collection, filters: constraints, order: [.init(orderBy.path, descending: orderBy.direction == .desc)],
      limit: limit)
  }
}
