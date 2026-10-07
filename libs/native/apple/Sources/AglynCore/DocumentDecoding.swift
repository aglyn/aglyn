// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * A DOCUMENT AS A GENERATED CONTRACT.
 *
 * The contracts (`AglynContracts`) are `Codable` structs generated from the
 * console's TypeScript types. A document's fields are plain values, so it
 * decodes through JSON: a timestamp becomes its epoch milliseconds (the
 * `…AtMs` the contracts carry) and anything JSON cannot hold is left out.
 */

extension FirestoreDocument {
  /// The fields as JSON-safe values.
  public var jsonFields: [String: Any] { jsonSafeObject(data) }

  /// The document decoded as `type`; throws when a required field is missing or mistyped.
  public func decode<T: Decodable>(_ type: T.Type) throws -> T {
    try decodeJSONFields(type, jsonFields)
  }
}

/// `fields` (already JSON-safe) decoded as `type`.
public func decodeJSONFields<T: Decodable>(_ type: T.Type, _ fields: Any) throws -> T {
  let data = try JSONSerialization.data(withJSONObject: fields, options: [.fragmentsAllowed])
  return try JSONDecoder().decode(type, from: data)
}

/// Keeps the elements of `array` that decode as `type`, so one malformed
/// line or payment does not hide the whole record.
public func keepDecodable<T: Decodable>(_ array: Any?, as type: T.Type) -> [Any]? {
  guard let array = array as? [Any] else { return nil }
  return array.filter { (try? decodeJSONFields(type, $0)) != nil }
}

func jsonSafeObject(_ object: [String: Any]) -> [String: Any] {
  object.compactMapValues(jsonSafe)
}

func jsonSafe(_ value: Any) -> Any? {
  switch value {
  case is NSNull: return NSNull()
  case let text as String: return text
  case let number as NSNumber:
    if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
    return number.doubleValue.isFinite ? number : nil
  case let date as Date: return (date.timeIntervalSince1970 * 1000).rounded()
  case let array as [Any]: return array.compactMap(jsonSafe)
  case let object as [String: Any]: return jsonSafeObject(object)
  default: return nil
  }
}
