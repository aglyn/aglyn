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
    let parts = segments(trimmed)
    for (position, raw) in parts.enumerated() {
      if raw == "*" {
        // `rows.*.field`: that field of every row, as a list (rows without it are left out). Over an object (a map of
        // holds by key) the rows are its values, in key order.
        let rest = parts.dropFirst(position + 1).joined(separator: ".")
        let items: [JSONValue]
        switch current {
        case .array(let list)?: items = list
        case .object(let record)?: items = record.sorted { $0.key < $1.key }.map(\.value)
        default: return nil
        }
        return .array(items.compactMap { row in
          if rest.isEmpty { return row }
          guard let found = lookup(rest, in: row), found != .null else { return nil }
          return found
        })
      }
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
      // A negative number counts from the end: `attempts.-1` is the last one.
      guard let number = Int(segment) else { return nil }
      let index = number < 0 ? items.count + number : number
      return items.indices.contains(index) ? items[index] : nil
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
    // `{?a == b || !c}`: a condition, as true or false.
    if expression.trimmingCharacters(in: .whitespaces).hasPrefix("?") {
      return .bool(condition(String(expression.trimmingCharacters(in: .whitespaces).dropFirst()), in: context))
    }
    var body = expression
    var format: String?
    // A format follows the last ':' that is outside quotes.
    if let colon = lastUnquotedColon(body) {
      format = String(body[body.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
      body = String(body[..<colon])
    }
    // `a ?? b`: the first alternative that is present at all (false and 0 count), else the quoted literal.
    if body.contains("??") {
      var found: JSONValue?
      for alternative in body.components(separatedBy: "??") {
        let part = alternative.trimmingCharacters(in: .whitespaces)
        if part.count >= 2, part.hasPrefix("'"), part.hasSuffix("'") {
          found = .string(String(part.dropFirst().dropLast()))
          break
        }
        if let value = lookup(part, in: context), value != .null {
          found = value
          break
        }
      }
      guard let format, !format.isEmpty else { return found }
      return .string(formatted(found, as: format, in: context))
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
    case .object(let record) where record.count == 1 && record["$timestamp"] != nil:
      // `{"$timestamp": true}`: the server's time, written as a Firestore timestamp (a write's `updatedAt`).
      return ["$timestamp": true]
    case .object(let record) where record.count == 1 && record["$dateMs"] != nil:
      // `{"$dateMs": {"value": "{form.starts}", "time": "23:59:59"}}`: a date and a UTC time of day as epoch milliseconds; null when it is not a date.
      let spec = record["$dateMs"] ?? .null
      let date = Self.text(resolveBody(spec["value"] ?? .null, in: context)).trimmingCharacters(in: .whitespaces)
      let time = spec["time"]?.stringValue ?? "00:00:00"
      guard date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil,
        let millis = epochMillis(.string("\(date)T\(time)Z"))
      else { return .null }
      // With `"local": true` the time of day is the device's own (a browser's `Date.parse` of a zone-less time): the
      // offset is looked up at the guess and again at the corrected instant, so a daylight-saving change lands right.
      if spec["local"]?.boolValue == true {
        func offset(at instant: Int64) -> Int64 { Int64(TimeZone.current.secondsFromGMT(for: Date(timeIntervalSince1970: Double(instant) / 1000))) * 1000 }
        let guess = millis - offset(at: millis)
        return .number(Double(millis - offset(at: guess)))
      }
      return .number(Double(millis))
    case .object(let record) where record.count == 1 && record["$slug"] != nil:
      // `{"$slug": "{form.name}"}`: the console's slug of a name (lower case, letters and digits joined by hyphens).
      return .string(commerceSlug(Self.text(resolveBody(record["$slug"] ?? .null, in: context))))
    case .object(let record) where record.count == 1 && record["$codes"] != nil:
      // `{"$codes": "{form.countries}"}`: comma- or line-separated codes, trimmed and upper case, as a list (empty ones dropped).
      let typed = Self.text(resolveBody(record["$codes"] ?? .null, in: context))
      return .array(typed.split(whereSeparator: { $0 == "," || $0 == "\n" }).map { $0.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }.filter { !$0.isEmpty }.map(JSONValue.string))
    case .object(let record) where record.count == 1 && record["$reject"] != nil:
      // `{"$reject": {"list": "{rates}", "key": "zoneId", "match": "{item.id}"}}`: the list without the rows whose `key` equals `match`.
      let spec = record["$reject"] ?? .null
      var list: [JSONValue] = []
      if case .array(let items) = resolveBody(spec["list"] ?? .null, in: context) { list = items }
      let key = spec["key"]?.stringValue ?? ""
      let match = Self.text(resolveBody(spec["match"] ?? .null, in: context))
      return .array(list.filter { Self.text(lookup(key, in: $0)) != match })
    case .object(let record) where record.count == 1 && record["$number"] != nil:
      // `{"$number": "{form.ready}"}`: a choice or typed text as a number; null when it is not one (a select's "don't say").
      return number(resolveBody(record["$number"] ?? .null, in: context)).map { .number($0) } ?? .null
    case .object(let record) where record.count == 1 && record["$nowMs"] != nil:
      // `{"$nowMs": true}`: the time of the press, as epoch milliseconds (a moderation's `moderatedAtMs`).
      return .number((Date().timeIntervalSince1970 * 1000).rounded())
    case .object(let record) where record.count == 1 && record["$orNull"] != nil:
      // `{"$orNull": "{form.parentId}"}`: the value, or an explicit null when it is empty (a merge write clears the field).
      let value = resolveBody(record["$orNull"] ?? .null, in: context)
      return truthy(value) ? value : .null
    case .object(let record) where record.count == 1 && record["$cents"] != nil:
      // `{"$cents": "{form.amount}"}`: typed dollars (`12.50`, `$1,200`) as whole cents; null when it is not an amount.
      let typed = Self.text(resolveBody(record["$cents"] ?? .null, in: context)).trimmingCharacters(in: .whitespaces)
        .replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "")
      guard typed.range(of: #"^(\d+(\.\d{0,2})?|\.\d{1,2})$"#, options: .regularExpression) != nil else { return .null }
      let parts = typed.split(separator: ".", omittingEmptySubsequences: false)
      let whole = Int(parts[0].isEmpty ? "0" : String(parts[0])) ?? 0
      let fraction = parts.count > 1 ? Int(String(parts[1]).padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0 : 0
      return .number(Double(whole * 100 + fraction))
    case .object(let record) where record.count == 1 && record["$gather"] != nil:
      // `{"$gather": {"from": "{form}", "prefix": "restock_", "key": "lineItemId", "value": "quantity"}}`: the entries of
      // an object whose names start with `prefix`, as `{ key: <rest of the name>, value: <entry> }` rows in name order.
      let spec = record["$gather"] ?? .null
      var source: [String: JSONValue] = [:]
      if case .object(let found) = resolveBody(spec["from"] ?? .null, in: context) { source = found }
      let prefix = spec["prefix"]?.stringValue ?? ""
      let keyName = spec["key"]?.stringValue ?? "key"
      let valueName = spec["value"]?.stringValue ?? "value"
      // `with` adds more columns from other prefixes (`{"reason": "reason_"}`); `skipEmpty` leaves out a row whose value is empty or zero.
      let extra = spec["with"].objectEntries.reduce(into: [String: String]()) { $0[$1.key] = $1.value.stringValue ?? "" }
      let skipEmpty = spec["skipEmpty"] == .bool(true)
      // `keys`: only the names (after the prefix) of the entries that are on, in name order: the checked events of a list of toggles.
      if spec["keys"] == .bool(true) {
        return .array(source.filter { $0.key.hasPrefix(prefix) && truthy($0.value) }.sorted { $0.key < $1.key }.map { .string(String($0.key.dropFirst(prefix.count))) })
      }
      return .array(
        source.filter { $0.key.hasPrefix(prefix) }.sorted { $0.key < $1.key }.compactMap { name, entry in
          if skipEmpty, !truthy(entry) { return nil }
          let rest = String(name.dropFirst(prefix.count))
          var row: [String: JSONValue] = [keyName: Int64(rest).map { .number(Double($0)) } ?? .string(rest), valueName: entry]
          for (column, columnPrefix) in extra { if let more = source[columnPrefix + rest] { row[column] = more } }
          return .object(row)
        })
    case .object(let record) where record.count == 1 && record["$uuid"] != nil:
      // `{"$uuid": "box_"}`: the prefix and eight random hex digits, a fresh id for a row the person is adding.
      return .string(Self.text(resolveBody(record["$uuid"] ?? .null, in: context)) + String(UUID().uuidString.lowercased().prefix(8)))
    case .object(let record) where record.count == 1 && record["$replace"] != nil:
      // `{"$replace": {"list": "{a}", "key": "id", "match": "{b}", "value": {...}}}`: the list with the row whose
      // `key` equals `match` replaced by `value`.
      let spec = record["$replace"] ?? .null
      var list: [JSONValue] = []
      if case .array(let items) = resolveBody(spec["list"] ?? .null, in: context) { list = items }
      let key = spec["key"]?.stringValue ?? ""
      let match = Self.text(resolveBody(spec["match"] ?? .null, in: context))
      let value = resolveBody(spec["value"] ?? .null, in: context)
      // key "*": the row that equals `match` as a whole (a list of rows with no id of their own).
      let whole = key == "*" ? resolveBody(spec["match"] ?? .null, in: context) : nil
      return .array(list.map { row in (key == "*" ? row == whole : Self.text(lookup(key, in: row)) == match) ? value : row })
    case .object(let record) where record.count == 1 && record["$split"] != nil:
      // `{"$split": "{form.pcts}"}`: the comma- or line-separated text as a list; a part that is a number stays one.
      let joined = Self.text(resolveBody(record["$split"] ?? .null, in: context))
      return .array(
        joined.split(whereSeparator: { $0 == "," || $0 == "\n" }).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.map { part in
          if let number = Double(part) { return .number(number) }
          return .string(part)
        })
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
        // A key written as a template (`{item.id}`) is the text it renders: a map keyed by the row's own id.
        if resolved != .null || value == .null || value["$orNull"] != nil { out[key.contains("{") ? render(key, in: context) : key] = resolved }
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
        let leftPath = String(clause[..<range.lowerBound])
        let found = lookup(leftPath, in: context)
        let left = text(found)
        var right = clause[range.upperBound...].trimmingCharacters(in: .whitespaces)
        if right.count >= 2, right.hasPrefix("'"), right.hasSuffix("'") { right = String(right.dropFirst().dropLast()) }
        // `path == @other.path`: compared with the text at another path instead of a literal.
        let options = right.hasPrefix("@")
          ? [text(lookup(String(right.dropFirst()), in: context))]
          : right.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        // A projected list (`zones.*.kind == radius`): `==` holds when any of its values does, `!=` when none does.
        if case .array(let items)? = found, leftPath.contains(".*") {
          let hit = items.contains { options.contains(text($0)) }
          return op == "==" ? hit : !hit
        }
        return op == "==" ? options.contains(left) : !options.contains(left)
      }
    }
    // `path < @now.ms+7d`: numbers and times compared; the right side is a number or `@path` with an optional offset.
    for op in ["<=", ">=", "<", ">"] {
      guard let range = clause.range(of: op) else { continue }
      let found = lookup(String(clause[..<range.lowerBound]), in: context)
      guard let right = operand(clause[range.upperBound...].trimmingCharacters(in: .whitespaces), in: context) else { return false }
      // A projected list (`holds.*.expiresAtMs > @now.ms`) holds when any of its values does.
      let lefts: [Double]
      if case .array(let list)? = found { lefts = list.compactMap { comparable($0) } } else { lefts = comparable(found).map { [$0] } ?? [] }
      return lefts.contains { left in
        switch op {
        case "<=": return left <= right
        case ">=": return left >= right
        case "<": return left < right
        default: return left > right
        }
      }
    }
    if clause.hasPrefix("!") { return !truthy(lookup(String(clause.dropFirst()), in: context)) }
    return truthy(lookup(clause, in: context))
  }

  /// A number as it is, or a time (epoch milliseconds, a Firestore timestamp, an ISO date) as milliseconds.
  private static func comparable(_ value: JSONValue?) -> Double? {
    if case .number(let number)? = value { return number }
    return epochMillis(value).map(Double.init)
  }

  /// The right side of `<`: a number, `@path`, or `@path+7d` / `@path-30m` (units ms, s, m, h, d; none is ms).
  static func operand(_ text: String, in context: JSONValue) -> Double? {
    if let number = Double(text) { return number }
    guard text.hasPrefix("@") else { return nil }
    let body = String(text.dropFirst())
    let pattern = #"^(.+?)\s*([+-])\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$"#
    if let regex = try? NSRegularExpression(pattern: pattern),
      let found = regex.firstMatch(in: body, range: NSRange(body.startIndex..., in: body)),
      let pathRange = Range(found.range(at: 1), in: body), let signRange = Range(found.range(at: 2), in: body),
      let amountRange = Range(found.range(at: 3), in: body), let base = comparable(lookup(String(body[pathRange]), in: context)),
      let amount = Double(body[amountRange])
    {
      let unit = Range(found.range(at: 4), in: body).map { String(body[$0]) } ?? "ms"
      let scale: Double = ["s": 1_000, "m": 60_000, "h": 3_600_000, "d": 86_400_000][unit] ?? 1
      return body[signRange] == "+" ? base + amount * scale : base - amount * scale
    }
    return comparable(lookup(body, in: context))
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
    case "code":
      // A code the way coupons store it: trimmed, upper case, only letters, digits, hyphens and underscores.
      // `code/40` keeps at most that many characters.
      let code = text(value).trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        .replacingOccurrences(of: "[^A-Z0-9_-]", with: "", options: .regularExpression)
      if parts.count > 1, let limit = Int(parts[1]) { return String(code.prefix(limit)) }
      return code
    case "token":
      // The search token of typed words: lower case, the first word, at most twelve characters.
      let word = text(value).trimmingCharacters(in: .whitespacesAndNewlines).lowercased().split(whereSeparator: \.isWhitespace).first
      return String(word.map(String.init) ?? "").prefix(12).description
    case "sum", "sumcents":
      var total = 0.0
      if case .array(let items)? = value { total = items.reduce(0) { $0 + (number($1) ?? 0) } }
      return name == "sum" ? numberText(total) : formatOrderMoney(Int(total.rounded()), currency: "USD")
    case "amount":
      // Whole cents as a plain amount a money field starts with: 1250 -> 12.50 (nothing for no amount).
      guard let cents = number(value) else { return "" }
      let whole = Int(cents.rounded())
      return "\(whole / 100).\(String(format: "%02d", abs(whole) % 100))"
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
    case "ago":
      // A time as how long ago it was: `5m ago`, `3h ago`, `2d ago`; a dash for none.
      guard let at = epochMillis(value) else { return "\u{2014}" }
      let minutes = Int(max(0, ((Date().timeIntervalSince1970 * 1000 - Double(at)) / 60_000).rounded()))
      if minutes < 60 { return "\(minutes)m ago" }
      let hours = Int((Double(minutes) / 60).rounded())
      return hours < 48 ? "\(hours)h ago" : "\(Int((Double(hours) / 24).rounded()))d ago"
    case "minus":
      // `minus/other.path`: this number less the one at the path, never below zero (text that is no number stays as it is).
      guard let amount = number(value) else { return text(value) }
      let other = parts.count > 1 ? number(lookup(parts[1], in: context)) ?? 0 : 0
      return numberText(max(0, amount - other))
    case "lesscents":
      // `lesscents/other.path`: this amount less the one at the path, never below zero, as money.
      let other = parts.count > 1 ? number(lookup(parts[1], in: context)) ?? 0 : 0
      return formatOrderMoney(Int(max(0, (number(value) ?? 0) - other).rounded()), currency: "USD")
    case "slashed":
      // A site path with its leading slash: `about` is `/about`, the home page `/`.
      let path = text(value)
      return path == "/" ? "/" : "/" + (path.hasPrefix("/") ? String(path.dropFirst()) : path)
    case "take":
      // `take/120`: at most that many characters.
      return String(text(value).prefix(parts.count > 1 ? Int(parts[1]) ?? Int.max : Int.max))
    case "plural":
      // `plural/item`: the count (a list of numbers is their total, any other list its length) with its noun, `1 item` or `3 items`.
      var count = number(value) ?? 0
      if case .array(let items)? = value {
        count = !items.isEmpty && items.allSatisfy({ number($0) != nil }) ? items.reduce(0) { $0 + (number($1) ?? 0) } : Double(items.count)
      }
      return "\(numberText(count)) \(parts.count > 1 ? parts[1] : "")\(count == 1 ? "" : "s")"
    case "ordernumber":
      // `ordernumber/item.$id`: an order's number as `#1042`, else the last six characters of its id (`#A1B2C3`).
      if truthy(value) { return "#\(text(value))" }
      let id = parts.count > 1 ? text(lookup(parts[1], in: context)) : ""
      return id.isEmpty ? "#\u{2014}" : "#\(id.suffix(6).uppercased())"
    case "isodate":
      // A UTC day as `2026-10-09`: the day a stay starts on, which a device's zone must not move.
      guard let at = epochMillis(value) else { return "\u{2014}" }
      let formatter = DateFormatter()
      formatter.locale = Locale(identifier: "en_US_POSIX")
      formatter.calendar = Calendar(identifier: .gregorian)
      formatter.timeZone = TimeZone(identifier: "UTC")
      formatter.dateFormat = "yyyy-MM-dd"
      return formatter.string(from: Date(timeIntervalSince1970: Double(at) / 1000))
    case "ahead":
      // How many of a list of times are still ahead (the holds on a promotion that have not lapsed).
      guard case .array(let items)? = value else { return "0" }
      let now = Int64(Date().timeIntervalSince1970 * 1000)
      return String(items.filter { (epochMillis($0) ?? 0) > now }.count)
    case "yesno":
      return truthy(value) ? "Yes" : "No"
    case "title":
      let raw = text(value).replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
      return raw.prefix(1).uppercased() + raw.dropFirst()
    case "upper":
      // `upper/2` also keeps at most that many characters (a country or state code).
      let upper = text(value).uppercased()
      return parts.count > 1 ? Int(parts[1]).map { String(upper.prefix($0)) } ?? upper : upper
    case "json":
      return (try? value.map { String(data: try $0.encoded(), encoding: .utf8) ?? "" }) ?? ""
    default:
      return text(value)
    }
  }
}
