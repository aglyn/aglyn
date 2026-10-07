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

  /// The document-id pseudo-field (`__name__`).
  public var isDocumentID: Bool { path == ContractValues.shared.listQueryIdPath }
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
private func fieldPath(_ path: String) -> FieldPath {
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
    for constraint in constraints {
      let field = fieldPath(constraint.path)
      let value = constraint.value
      switch constraint.op {
      case .equal: built = built.whereField(field, isEqualTo: value)
      case .notEqual: built = built.whereField(field, isNotEqualTo: value)
      case .lessThan: built = built.whereField(field, isLessThan: value)
      case .lessThanOrEqual: built = built.whereField(field, isLessThanOrEqualTo: value)
      case .greaterThan: built = built.whereField(field, isGreaterThan: value)
      case .greaterThanOrEqual: built = built.whereField(field, isGreaterThanOrEqualTo: value)
      case .arrayContains: built = built.whereField(field, arrayContains: value)
      case .arrayContainsAny: built = built.whereField(field, arrayContainsAny: value as? [Any] ?? [value])
      case .in: built = built.whereField(field, in: value as? [Any] ?? [value])
      case .unknown: continue
      }
    }
    built = built.order(by: fieldPath(orderBy.path), descending: orderBy.direction == .desc)
    if let limit { built = built.limit(to: limit) }
    return built
  }
}
