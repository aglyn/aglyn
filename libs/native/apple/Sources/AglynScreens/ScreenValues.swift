// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/// The values a console screen spec reads: paths into a JSON context, text
/// templates, display formats and `when` conditions. The Kotlin twin is
/// `com.aglyn.screens.ScreenValues`; both replay
/// `libs/native/screens/template-cases.json`, so a spec reads the same on
/// every platform.
public enum ScreenValues {
  /// The value at a dotted path (`data.members.0.email`), or nil.
  public static func lookup(_ path: String, in context: JSONValue) -> JSONValue? {
    let trimmed = path.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty { return context }
    var current: JSONValue? = context
    for raw in segments(trimmed) {
      // `rows[field=other.path]`: the first row whose field reads as the text at other.path.
      var segment = raw
      var selector: (field: String, path: String)?
      if raw.hasSuffix("]"), let open = raw.firstIndex(of: "[") {
        let inner = raw[raw.index(after: open)..<raw.index(before: raw.endIndex)]
        segment = String(raw[..<open])
        if !segment.isEmpty { current = step(current, segment) }
        if let equals = inner.firstIndex(of: "=") {
          selector = (String(inner[..<equals]), String(inner[inner.index(after: equals)...]))
        } else {
          // `map[some.key]`: a key that itself holds dots; `map[@path]`: the key is the text at path.
          if inner.hasPrefix("@") {
            current = step(current, text(lookup(String(inner.dropFirst()), in: context)))
          } else {
            current = step(current, String(inner))
          }
        }
      } else if !segment.isEmpty {
        current = step(current, segment)
      }
      if let selector {
        let wanted = text(lookup(selector.path, in: context))
        current = current.array.first { text(lookup(selector.field, in: $0)) == wanted }
      }
    }
    return current
  }

  /// The rows a list or meters block walks: an array as it is, or an
  /// object's entries as `{ key, value }` (a map such as `planCounts`).
  public static func rows(_ value: JSONValue?) -> [JSONValue] {
    switch value {
    case .array(let items)?: return items
    case .object(let record)?: return record.keys.sorted().map { ["key": .string($0), "value": record[$0]!] }
    default: return []
    }
  }

  /// A path's segments, split on dots outside brackets.
  static func segments(_ path: String) -> [String] {
    var parts: [String] = []
    var current = ""
    var depth = 0
    for character in path {
      if character == "[" { depth += 1 }
      if character == "]" { depth -= 1 }
      if character == ".", depth == 0 {
        parts.append(current)
        current = ""
      } else {
        current.append(character)
      }
    }
    parts.append(current)
    return parts
  }

  private static func step(_ current: JSONValue?, _ segment: String) -> JSONValue? {
    switch current {
    case .object(let record)?: return record[segment]
    case .array(let items)?:
      if segment == "length" { return .number(Double(items.count)) }
      guard let index = Int(segment), items.indices.contains(index) else { return nil }
      return items[index]
    default: return nil
    }
  }

  /// Whether a value reads as present: not null, false, 0, "", or empty.
  public static func truthy(_ value: JSONValue?) -> Bool {
    switch value {
    case nil, .null?: false
    case .bool(let flag)?: flag
    case .number(let number)?: number != 0 && !number.isNaN
    case .string(let text)?: !text.isEmpty
    case .array(let items)?: !items.isEmpty
    case .object(let record)?: !record.isEmpty
    }
  }

  /// Plain text for a value: whole numbers without a fraction, lists joined.
  public static func text(_ value: JSONValue?) -> String {
    switch value {
    case nil, .null?: ""
    case .bool(let flag)?: flag ? "true" : "false"
    case .number(let number)?: numberText(number)
    case .string(let text)?: text
    case .array(let items)?: items.map { text($0) }.filter { !$0.isEmpty }.joined(separator: ", ")
    case .object?: ""
    }
  }

  static func numberText(_ number: Double) -> String {
    if number.isFinite, number == number.rounded(), abs(number) < 9_007_199_254_740_992 {
      return String(Int64(number))
    }
    return String(number)
  }

  /// One `{…}` expression: `a.b|c.d|'fallback'` with an optional `:format`.
  /// The first alternative that is present wins.
  public static func evaluate(_ expression: String, in context: JSONValue) -> JSONValue? {
    var body = expression
    var format: String?
    // A format follows the last ':' that is outside quotes.
    if let colon = lastUnquotedColon(body) {
      format = String(body[body.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
      body = String(body[..<colon])
    }
    // A truthy alternative or a quoted literal wins where it stands; failing
    // both, the first value that was there at all (0, false, "").
    var picked: JSONValue?
    var firstPresent: JSONValue?
    for alternative in splitUnquoted(body, on: "|") {
      let part = alternative.trimmingCharacters(in: .whitespaces)
      if part.count >= 2, part.hasPrefix("'"), part.hasSuffix("'") {
        picked = .string(String(part.dropFirst().dropLast()))
        break
      }
      let value = lookup(part, in: context)
      if truthy(value) {
        picked = value
        break
      }
      if firstPresent == nil, let value, value != .null { firstPresent = value }
    }
    let result = picked ?? firstPresent
    guard let format, !format.isEmpty else { return result }
    return .string(formatted(result, as: format, in: context))
  }

  /// A template: literal text with `{expression}` holes. `{{` is a literal brace.
  public static func render(_ template: String, in context: JSONValue) -> String {
    var output = ""
    var index = template.startIndex
    while index < template.endIndex {
      let character = template[index]
      if character == "{" {
        let next = template.index(after: index)
        if next < template.endIndex, template[next] == "{" {
          output.append("{")
          index = template.index(after: next)
          continue
        }
        if let close = template[next...].firstIndex(of: "}") {
          output += text(evaluate(String(template[next..<close]), in: context))
          index = template.index(after: close)
          continue
        }
      }
      output.append(character)
      index = template.index(after: index)
    }
    return output
  }

  /// A template that is exactly one `{expression}` keeps the expression's JSON
  /// value (a number stays a number); anything else renders to text.
  public static func resolve(_ template: String, in context: JSONValue) -> JSONValue {
    let trimmed = template.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("{"), trimmed.hasSuffix("}"), !trimmed.hasPrefix("{{"),
      trimmed.dropFirst().firstIndex(of: "{") == nil,
      trimmed.dropLast().dropFirst().firstIndex(of: "}") == nil
    {
      return evaluate(String(trimmed.dropFirst().dropLast()), in: context) ?? .null
    }
    return .string(render(template, in: context))
  }

  /// A request body: every string in it is a template, resolved in place. An
  /// object member whose value resolves to null is dropped, so an optional
  /// field the screen did not fill is not sent.
  public static func resolveBody(_ body: JSONValue, in context: JSONValue) -> JSONValue {
    switch body {
    case .string(let template): return resolve(template, in: context)
    case .array(let items): return .array(items.map { resolveBody($0, in: context) })
    case .object(let record) where record.count == 1 && record["$pick"] != nil:
      // `{"$pick": {"a": "{form.x}", "b": "{form.y}"}}`: the keys whose values are truthy, as a list.
      guard case .object(let options)? = record["$pick"] else { return .array([]) }
      return .array(options.keys.sorted().filter { truthy(resolveBody(options[$0]!, in: context)) }.map(JSONValue.string))
    case .object(let record) where record.count == 1 && record["$put"] != nil:
      // `{"$put": {"map": "{a}", "key": "{b}", "value": "{c}"}}`: the map with the key set, or removed when the value is empty.
      let spec = record["$put"] ?? .null
      var map: [String: JSONValue] = [:]
      if case .object(let current) = resolveBody(spec["map"] ?? .null, in: context) { map = current }
      let key = Self.text(resolveBody(spec["key"] ?? .null, in: context))
      let value = resolveBody(spec["value"] ?? .null, in: context)
      if !key.isEmpty {
        if truthy(value) { map[key] = value } else { map[key] = nil }
      }
      return .object(map)
    case .object(let record) where record.count == 1 && (record["$append"] != nil || record["$without"] != nil):
      // `{"$append": {"list": "{a}", "item": "{b}"}}` / `$without`: the list with the item added (once) or removed.
      let adding = record["$append"] != nil
      let spec = record["$append"] ?? record["$without"] ?? .null
      var list: [JSONValue] = []
      if case .array(let items) = resolveBody(spec["list"] ?? .null, in: context) { list = items }
      let item = resolveBody(spec["item"] ?? .null, in: context)
      if adding {
        if item != .null && item != "" && !list.contains(item) { list.append(item) }
      } else {
        list.removeAll { $0 == item }
      }
      return .array(list)
    case .object(let record):
      var out: [String: JSONValue] = [:]
      for (key, value) in record {
        let resolved = resolveBody(value, in: context)
        // A template that found nothing is left out; a literal null is sent (it clears the field).
        if resolved != .null || value == .null { out[key] = resolved }
      }
      return .object(out)
    default: return body
    }
  }

  /// A URL template: each hole's text is percent-encoded as a query or path component.
  public static func renderURL(_ template: String, in context: JSONValue) -> String {
    var output = ""
    var index = template.startIndex
    while index < template.endIndex {
      let character = template[index]
      if character == "{", let close = template[index...].firstIndex(of: "}") {
        let value = text(evaluate(String(template[template.index(after: index)..<close]), in: context))
        output += encodeComponent(value)
        index = template.index(after: close)
        continue
      }
      output.append(character)
      index = template.index(after: index)
    }
    return output
  }

  private static let componentAllowed: CharacterSet = {
    var set = CharacterSet.alphanumerics.intersection(CharacterSet(charactersIn: Unicode.Scalar(0)..<Unicode.Scalar(128)))
    set.insert(charactersIn: "-_.!~*'()")
    return set
  }()

  static func encodeComponent(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: componentAllowed) ?? value
  }

  /// A `when` condition: clauses joined by `&&` or `||` (no mixing), each
  /// `path`, `!path`, `path == value` or `path != value`. Empty is true.
  public static func condition(_ expression: String?, in context: JSONValue) -> Bool {
    guard let expression = expression?.trimmingCharacters(in: .whitespaces), !expression.isEmpty else { return true }
    if expression.contains("||") {
      return expression.components(separatedBy: "||").contains { condition($0, in: context) }
    }
    return expression.components(separatedBy: "&&").allSatisfy { clause(String($0), in: context) }
  }

  private static func clause(_ raw: String, in context: JSONValue) -> Bool {
    let clause = raw.trimmingCharacters(in: .whitespaces)
    for op in ["!=", "=="] {
      if let range = clause.range(of: op) {
        let left = text(lookup(String(clause[..<range.lowerBound]), in: context))
        var right = clause[range.upperBound...].trimmingCharacters(in: .whitespaces)
        if right.count >= 2, right.hasPrefix("'"), right.hasSuffix("'") { right = String(right.dropFirst().dropLast()) }
        let options = right.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        return op == "==" ? options.contains(left) : !options.contains(left)
      }
    }
    if clause.hasPrefix("!") { return !truthy(lookup(String(clause.dropFirst()), in: context)) }
    return truthy(lookup(clause, in: context))
  }

  private static func lastUnquotedColon(_ text: String) -> String.Index? {
    var quoted = false
    var found: String.Index?
    for index in text.indices {
      if text[index] == "'" { quoted.toggle() }
      if text[index] == ":", !quoted { found = index }
    }
    return found
  }

  private static func splitUnquoted(_ text: String, on separator: Character) -> [String] {
    var parts: [String] = []
    var current = ""
    var quoted = false
    for character in text {
      if character == "'" { quoted.toggle() }
      if character == separator, !quoted {
        parts.append(current)
        current = ""
      } else {
        current.append(character)
      }
    }
    parts.append(current)
    return parts
  }

  // MARK: Formats

  /// Milliseconds since the epoch from a number (seconds below 1e11, else
  /// milliseconds), an ISO-8601 string, or a Firestore timestamp object.
  public static func epochMillis(_ value: JSONValue?) -> Int64? {
    switch value {
    case .number(let number)?:
      guard number.isFinite, number > 0 else { return nil }
      return Int64(number < 1e11 ? number * 1000 : number)
    case .string(let text)?:
      if let number = Double(text) { return epochMillis(.number(number)) }
      let iso = ISO8601DateFormatter()
      iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      if let date = iso.date(from: text) { return Int64(date.timeIntervalSince1970 * 1000) }
      iso.formatOptions = [.withInternetDateTime]
      if let date = iso.date(from: text) { return Int64(date.timeIntervalSince1970 * 1000) }
      iso.formatOptions = [.withFullDate]
      if let date = iso.date(from: text) { return Int64(date.timeIntervalSince1970 * 1000) }
      // An HTTP date, as Firebase Auth prints account times ("Wed, 07 Oct 2026 22:47:05 GMT").
      let http = DateFormatter()
      http.locale = Locale(identifier: "en_US_POSIX")
      http.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
      if let date = http.date(from: text) { return Int64(date.timeIntervalSince1970 * 1000) }
      return nil
    case .object(let record)?:
      let seconds = record["_seconds"] ?? record["seconds"]
      if case .number(let secs)? = seconds { return Int64(secs * 1000) }
      if let millis = record["$date"] { return epochMillis(millis) }
      return nil
    default: return nil
    }
  }

  /// The time zone dates print in; tests pin it to UTC.
  nonisolated(unsafe) public static var timeZone: TimeZone = .current

  private static func dateText(_ millis: Int64, _ pattern: String) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.timeZone = timeZone
    formatter.dateFormat = pattern
    return formatter.string(from: Date(timeIntervalSince1970: Double(millis) / 1000))
  }

  static func number(_ value: JSONValue?) -> Double? {
    switch value {
    case .number(let number)?: number
    case .string(let text)?: Double(text)
    case .bool(let flag)?: flag ? 1 : 0
    default: nil
    }
  }

  /// Groups thousands with commas and keeps up to `fraction` decimals.
  static func grouped(_ value: Double, fraction: Int = 0) -> String {
    let formatter = NumberFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.numberStyle = .decimal
    formatter.usesGroupingSeparator = true
    formatter.groupingSeparator = ","
    formatter.groupingSize = 3
    formatter.minimumFractionDigits = 0
    formatter.maximumFractionDigits = fraction
    formatter.roundingMode = .halfUp
    return formatter.string(from: NSNumber(value: value)) ?? numberText(value)
  }

  /// `bytes`: 1024-based, one decimal from KB up (`1.5 MB`).
  static func bytesText(_ value: Double) -> String {
    let units = ["B", "KB", "MB", "GB", "TB"]
    var amount = value
    var unit = 0
    while abs(amount) >= 1024, unit < units.count - 1 {
      amount /= 1024
      unit += 1
    }
    return unit == 0 ? "\(grouped(amount)) B" : "\(grouped(amount, fraction: 1)) \(units[unit])"
  }

  /// A value in a named format. Unknown formats print the plain text.
  public static func formatted(_ value: JSONValue?, as format: String, in context: JSONValue) -> String {
    // `cents/<currency path>` reads the currency beside the amount.
    let parts = format.split(separator: "/", maxSplits: 1).map(String.init)
    let name = parts.first ?? format
    switch name {
    case "date":
      return epochMillis(value).map { dateText($0, "MMM d, yyyy") } ?? text(value)
    case "datetime":
      return epochMillis(value).map { dateText($0, "MMM d, yyyy, h:mm a") } ?? text(value)
    case "cents":
      guard let amount = number(value) else { return text(value) }
      let currency = parts.count > 1 ? text(lookup(parts[1], in: context)) : "USD"
      return formatOrderMoney(Int(amount.rounded()), currency: currency.isEmpty ? "USD" : currency)
    case "dollars":
      guard let amount = number(value) else { return text(value) }
      return formatOrderMoney(Int((amount * 100).rounded()), currency: "USD")
    case "bytes":
      return number(value).map(bytesText) ?? text(value)
    case "number":
      return number(value).map { grouped($0, fraction: 2) } ?? text(value)
    case "percent":
      return number(value).map { "\(grouped($0 * 100, fraction: 1))%" } ?? text(value)
    case "count":
      switch value {
      case .array(let items)?: return String(items.count)
      case .object(let record)?: return String(record.count)
      default: return number(value).map { grouped($0) } ?? "0"
      }
    case "yesno":
      return truthy(value) ? "Yes" : "No"
    case "title":
      let raw = text(value).replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
      return raw.prefix(1).uppercased() + raw.dropFirst()
    case "upper":
      return text(value).uppercased()
    case "json":
      return (try? value.map { String(data: try $0.encoded(), encoding: .utf8) ?? "" }) ?? ""
    default:
      return text(value)
    }
  }
}
