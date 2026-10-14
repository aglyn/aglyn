// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

/*
 * JavaScript's spellings of plain values, so a native screen prints a stored
 * value exactly as the console's `String(value)` and `JSON.stringify(value)`
 * print it (the Kotlin kit's JsText.kt). The plugins that port a console
 * formatter replay its answers through these.
 */

/// `String(number)`.
public func jsNumber(_ value: Double) -> String { jsNumberString(value) }

private func isBoolean(_ number: NSNumber) -> Bool { CFGetTypeID(number) == CFBooleanGetTypeID() }

/// `String(value)` for the plain shapes a record holds.
public func jsString(_ value: Any?) -> String {
  guard let value, !(value is NSNull) else { return "null" }
  switch value {
  case let text as String: return text
  case let number as NSNumber: return isBoolean(number) ? (number.boolValue ? "true" : "false") : jsNumber(number.doubleValue)
  case let list as [Any]: return list.map { $0 is NSNull ? "" : jsString($0) }.joined(separator: ",")
  case is [String: Any]: return "[object Object]"
  case let date as Date: return ISO8601DateFormatter().string(from: date)
  default: return "\(value)"
  }
}

private func quoted(_ text: String) -> String {
  guard let data = try? JSONSerialization.data(withJSONObject: text, options: [.fragmentsAllowed, .withoutEscapingSlashes]),
    let out = String(data: data, encoding: .utf8)
  else { return "\"\(text)\"" }
  return out
}

/// `JSON.stringify` for the plain shapes a record holds; an object's keys in sorted order.
public func jsonStringify(_ value: Any?) -> String {
  guard let value, !(value is NSNull) else { return "null" }
  switch value {
  case let text as String: return quoted(text)
  case let number as NSNumber:
    if isBoolean(number) { return number.boolValue ? "true" : "false" }
    return number.doubleValue.isFinite ? jsNumber(number.doubleValue) : "null"
  case let list as [Any]: return "[" + list.map { jsonStringify($0) }.joined(separator: ",") + "]"
  case let map as [String: Any]:
    return "{" + map.keys.sorted().map { quoted($0) + ":" + jsonStringify(map[$0]) }.joined(separator: ",") + "}"
  default: return quoted("\(value)")
  }
}
