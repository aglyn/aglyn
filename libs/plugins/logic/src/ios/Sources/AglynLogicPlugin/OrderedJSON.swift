// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

/*
 * JSON read and written the way JavaScript does (`JSON.parse`,
 * `JSON.stringify`, `Object.keys`), because a dictionary variable's stored
 * text is read back in key order and a value the rows cannot edit is carried
 * through unchanged. Foundation's dictionaries drop the order, so this keeps
 * its own.
 */

enum OrderedJSON: Equatable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([OrderedJSON])
  /// Entries in the order JavaScript walks an object's keys.
  case object([(key: String, value: OrderedJSON)])

  static func == (a: OrderedJSON, b: OrderedJSON) -> Bool {
    switch (a, b) {
    case (.null, .null): return true
    case (.bool(let x), .bool(let y)): return x == y
    case (.number(let x), .number(let y)): return x == y
    case (.string(let x), .string(let y)): return x == y
    case (.array(let x), .array(let y)): return x == y
    case (.object(let x), .object(let y)): return x.count == y.count && zip(x, y).allSatisfy { $0.key == $1.key && $0.value == $1.value }
    default: return false
    }
  }

  /// `JSON.parse`; nil where it would throw.
  static func parse(_ text: String) -> OrderedJSON? {
    var parser = JSONReader(Array(text.unicodeScalars))
    guard let value = parser.value() else { return nil }
    parser.skipSpace()
    return parser.atEnd ? value : nil
  }

  /// `JSON.stringify`, compact.
  var text: String {
    switch self {
    case .null: return "null"
    case .bool(let value): return value ? "true" : "false"
    case .number(let value): return value.isFinite ? jsNumberString(value) : "null"
    case .string(let value): return jsonQuoted(value)
    case .array(let items): return "[" + items.map(\.text).joined(separator: ",") + "]"
    case .object(let entries): return "{" + entries.map { jsonQuoted($0.key) + ":" + $0.value.text }.joined(separator: ",") + "}"
    }
  }
}

/// A string as `JSON.stringify` writes it: quotes, backslashes and control characters escaped, everything else as is.
func jsonQuoted(_ value: String) -> String {
  var out = "\""
  for scalar in value.unicodeScalars {
    switch scalar {
    case "\"": out += "\\\""
    case "\\": out += "\\\\"
    case "\n": out += "\\n"
    case "\r": out += "\\r"
    case "\t": out += "\\t"
    case "\u{08}": out += "\\b"
    case "\u{0C}": out += "\\f"
    default:
      if scalar.value < 0x20 {
        out += String(format: "\\u%04x", scalar.value)
      } else {
        out.unicodeScalars.append(scalar)
      }
    }
  }
  return out + "\""
}

/// The order JavaScript walks an object's keys in: array indexes ascending, then the rest as written.
func jsKeyOrder(_ keys: [String]) -> [String] {
  func index(_ key: String) -> UInt64? {
    guard !key.isEmpty, key.count <= 10, key.allSatisfy(\.isASCII), key.allSatisfy(\.isNumber) else { return nil }
    if key.count > 1, key.hasPrefix("0") { return nil }
    guard let value = UInt64(key), value < 4_294_967_295 else { return nil }
    return value
  }
  let indexed = keys.compactMap { key in index(key).map { (key, $0) } }.sorted { $0.1 < $1.1 }.map(\.0)
  let set = Set(indexed)
  return indexed + keys.filter { !set.contains($0) }
}

private struct JSONReader {
  let scalars: [Unicode.Scalar]
  var position = 0

  init(_ scalars: [Unicode.Scalar]) { self.scalars = scalars }

  var atEnd: Bool { position >= scalars.count }

  mutating func skipSpace() {
    while position < scalars.count, [" ", "\t", "\n", "\r"].contains(scalars[position]) { position += 1 }
  }

  mutating func value() -> OrderedJSON? {
    skipSpace()
    guard position < scalars.count else { return nil }
    switch scalars[position] {
    case "{": return object()
    case "[": return array()
    case "\"": return string().map(OrderedJSON.string)
    case "t": return literal("true", .bool(true))
    case "f": return literal("false", .bool(false))
    case "n": return literal("null", .null)
    default: return number()
    }
  }

  mutating func literal(_ word: String, _ value: OrderedJSON) -> OrderedJSON? {
    let letters = Array(word.unicodeScalars)
    guard position + letters.count <= scalars.count, Array(scalars[position..<position + letters.count]) == letters else { return nil }
    position += letters.count
    return value
  }

  mutating func number() -> OrderedJSON? {
    let start = position
    if position < scalars.count, scalars[position] == "-" { position += 1 }
    guard position < scalars.count, isDigit(scalars[position]) else { return nil }
    if scalars[position] == "0" {
      position += 1
    } else {
      while position < scalars.count, isDigit(scalars[position]) { position += 1 }
    }
    if position < scalars.count, scalars[position] == "." {
      position += 1
      let digits = position
      while position < scalars.count, isDigit(scalars[position]) { position += 1 }
      if position == digits { return nil }
    }
    if position < scalars.count, scalars[position] == "e" || scalars[position] == "E" {
      position += 1
      if position < scalars.count, scalars[position] == "+" || scalars[position] == "-" { position += 1 }
      let digits = position
      while position < scalars.count, isDigit(scalars[position]) { position += 1 }
      if position == digits { return nil }
    }
    let text = String(String.UnicodeScalarView(scalars[start..<position]))
    guard let value = Double(text) else { return nil }
    return .number(value)
  }

  func isDigit(_ scalar: Unicode.Scalar) -> Bool { scalar.value >= 48 && scalar.value <= 57 }

  mutating func string() -> String? {
    guard scalars[position] == "\"" else { return nil }
    position += 1
    var out = String.UnicodeScalarView()
    while position < scalars.count {
      let scalar = scalars[position]
      position += 1
      switch scalar {
      case "\"": return String(out)
      case "\\":
        guard position < scalars.count else { return nil }
        let escaped = scalars[position]
        position += 1
        switch escaped {
        case "\"", "\\", "/": out.append(escaped)
        case "n": out.append("\n")
        case "r": out.append("\r")
        case "t": out.append("\t")
        case "b": out.append("\u{08}")
        case "f": out.append("\u{0C}")
        case "u":
          guard var code = hex4() else { return nil }
          if (0xD800..<0xDC00).contains(code), position + 1 < scalars.count, scalars[position] == "\\", scalars[position + 1] == "u" {
            let saved = position
            position += 2
            if let low = hex4(), (0xDC00..<0xE000).contains(low) {
              code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
            } else {
              position = saved
            }
          }
          out.append(Unicode.Scalar(code) ?? "\u{FFFD}")
        default: return nil
        }
      default:
        if scalar.value < 0x20 { return nil }
        out.append(scalar)
      }
    }
    return nil
  }

  mutating func hex4() -> UInt32? {
    guard position + 4 <= scalars.count else { return nil }
    let text = String(String.UnicodeScalarView(scalars[position..<position + 4]))
    guard text.allSatisfy(\.isHexDigit), let code = UInt32(text, radix: 16) else { return nil }
    position += 4
    return code
  }

  mutating func array() -> OrderedJSON? {
    position += 1
    var items: [OrderedJSON] = []
    skipSpace()
    if position < scalars.count, scalars[position] == "]" {
      position += 1
      return .array(items)
    }
    while true {
      guard let item = value() else { return nil }
      items.append(item)
      skipSpace()
      guard position < scalars.count else { return nil }
      if scalars[position] == "," {
        position += 1
      } else if scalars[position] == "]" {
        position += 1
        return .array(items)
      } else {
        return nil
      }
    }
  }

  mutating func object() -> OrderedJSON? {
    position += 1
    var keys: [String] = []
    var values: [String: OrderedJSON] = [:]
    skipSpace()
    if position < scalars.count, scalars[position] == "}" {
      position += 1
      return .object([])
    }
    while true {
      skipSpace()
      guard position < scalars.count, let key = string() else { return nil }
      skipSpace()
      guard position < scalars.count, scalars[position] == ":" else { return nil }
      position += 1
      guard let item = value() else { return nil }
      if values[key] == nil { keys.append(key) }
      values[key] = item
      skipSpace()
      guard position < scalars.count else { return nil }
      if scalars[position] == "," {
        position += 1
      } else if scalars[position] == "}" {
        position += 1
        return .object(jsKeyOrder(keys).map { ($0, values[$0] ?? .null) })
      } else {
        return nil
      }
    }
  }
}
