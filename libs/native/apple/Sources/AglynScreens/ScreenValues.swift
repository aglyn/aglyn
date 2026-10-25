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
    lookup(path, root: context, from: context)
  }

  /// `path` read from `start`, with every `@path` and selector value read from `root`.
  static func lookup(_ path: String, root: JSONValue, from start: JSONValue?) -> JSONValue? {
    let trimmed = path.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty { return start }
    var current: JSONValue? = start
    let parts = segments(trimmed)
    for (position, raw) in parts.enumerated() {
      // `rows.*.field`: that field of every row, as a list (rows without it, or where it is null, are left out; a field
      // that is itself a list adds its members, so `resources.*.items` is every resource's items). Over an object (a map
      // of holds by key) the rows are its values, in key order.
      if raw == "*", let items = wildcardRows(current) {
        let rest = parts[(position + 1)...].joined(separator: ".")
        return .array(
          items.compactMap { rest.isEmpty ? $0 : lookup(rest, root: root, from: $0) }.filter { $0 != .null }
            .flatMap { value -> [JSONValue] in
              if case .array(let members) = value { return members }
              return [value]
            })
      }
      // `name[group][group]…`: each group is `[field=other.path]` (the first row whose field reads as the text
      // at other.path, or as a quoted literal), `[field~=other.path]` (the first row whose list field holds that text),
      // `[?condition]` (every row the condition holds for, as a list), `[@path]` (the key is the text at path) or
      // `[some.key]` (a key that itself holds dots).
      var name = raw
      var groups: [String] = []
      if raw.hasSuffix("]"), let open = raw.firstIndex(of: "[") {
        name = String(raw[..<open])
        groups = bracketGroups(raw[open...])
      }
      if !name.isEmpty { current = step(current, name) }
      for inner in groups {
        func wanted(_ right: String) -> String {
          let right = right.trimmingCharacters(in: .whitespaces)
          return right.count >= 2 && right.hasPrefix("'") && right.hasSuffix("'")
            ? String(right.dropFirst().dropLast()) : text(lookup(right, root: root, from: root))
        }
        if inner.hasPrefix("?") {
          // `rows[?item.rate && !item.own]`: every row the condition holds for (`item` is the row), as a list.
          let keep = String(inner.dropFirst())
          current = .array(current.array.filter { ScreenValues.condition(keep, in: ScreenContext.with(root, item: $0)) })
        } else if inner.hasPrefix("@") {
          current = step(current, text(lookup(String(inner.dropFirst()), root: root, from: root)))
        } else if let tilde = inner.range(of: "~=") {
          let field = String(inner[..<tilde.lowerBound])
          let match = wanted(String(inner[tilde.upperBound...]))
          current = current.array.first { row in lookup(field, root: row, from: row).array.contains { text($0) == match } }
        } else if let equals = inner.firstIndex(of: "=") {
          let field = String(inner[..<equals])
          let match = wanted(String(inner[inner.index(after: equals)...]))
          current = current.array.first { text(lookup(field, root: $0, from: $0)) == match }
        } else {
          current = step(current, inner)
        }
      }
    }
    return current
  }

  /// What `*` walks: an array's rows, or an object's values in key order.
  private static func wildcardRows(_ value: JSONValue?) -> [JSONValue]? {
    switch value {
    case .array(let items)?: return items
    case .object(let record)?: return record.keys.sorted().map { record[$0]! }
    default: return nil
    }
  }

  /// The groups of `[a][b[c]]`: `a` and `b[c]`, matching brackets inside a group.
  private static func bracketGroups(_ text: Substring) -> [String] {
    var groups: [String] = []
    var depth = 0
    var current = ""
    for character in text {
      if character == "[" {
        if depth > 0 { current.append(character) }
        depth += 1
      } else if character == "]" {
        depth -= 1
        if depth == 0 {
          groups.append(current)
          current = ""
        } else {
          current.append(character)
        }
      } else if depth > 0 {
        current.append(character)
      }
    }
    return groups
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

  /// Rows in the order a list's `sort` asks for: `"value desc"` or `"name"` (ascending), a field of each row (`item.` is
  /// not written). Numbers compare as numbers and anything else as text; a row without the field goes last.
  public static func sorted(_ rows: [JSONValue], by sort: String) -> [JSONValue] {
    order(rows, by: sort).map { rows[$0] }
  }

  /// The positions of `rows` in the order `sorted` puts them in.
  public static func order(_ rows: [JSONValue], by sort: String) -> [Int] {
    let words = sort.split(separator: " ").map(String.init)
    guard let field = words.first else { return Array(rows.indices) }
    let descending = words.dropFirst().first == "desc"
    func ordered(_ a: JSONValue, _ b: JSONValue) -> Bool {
      let left = lookup(field, in: a)
      let right = lookup(field, in: b)
      if left == nil || left == .null { return false }
      if right == nil || right == .null { return true }
      if let x = number(left), let y = number(right) { return descending ? x > y : x < y }
      let x = text(left)
      let y = text(right)
      return descending ? x.localizedCaseInsensitiveCompare(y) == .orderedDescending : x.localizedCaseInsensitiveCompare(y) == .orderedAscending
    }
    // Stable: equal rows keep the order they came in.
    return rows.enumerated().sorted { a, b in
      if ordered(a.element, b.element) { return true }
      if ordered(b.element, a.element) { return false }
      return a.offset < b.offset
    }.map(\.offset)
  }

  /// The rows one or more levels down: each segment of `path` names the list (or map) inside every row so far,
  /// and each row found carries `$parent`, the row it came out of (and so on up: `item.$parent.$parent`).
  public static func flatten(_ rows: [JSONValue], through path: String) -> [JSONValue] {
    var current = rows
    for segment in path.split(separator: ".").map(String.init) where !segment.isEmpty {
      current = current.flatMap { container -> [JSONValue] in
        Self.rows(lookup(segment, in: container)).map { child in
          guard case .object(var record) = child else { return ["value": child, "$parent": container] }
          record["$parent"] = container
          return .object(record)
        }
      }
    }
    return current
  }

  /// The scopes a list or an option source walks: one per row of `items` that meets `filter`, with
  /// the row as `item` and its position as `index`; or, given `within` (a path read from each row), one per row of that inner
  /// list, the outer row as `parent` (every resource's items, labeled by their resource).
  public static func scopes(items path: String, within: String? = nil, filter: String? = nil, in context: JSONValue) -> [JSONValue] {
    var found: [JSONValue] = []
    for (at, row) in rows(lookup(path, in: context)).enumerated() {
      let outer = ScreenContext.with(ScreenContext.with(context, item: row), "index", .number(Double(at)))
      if let within, !within.isEmpty {
        for (inside, inner) in rows(lookup(within, in: row)).enumerated() {
          found.append(ScreenContext.with(ScreenContext.with(outer, item: inner), "index", .number(Double(inside))))
        }
      } else {
        found.append(outer)
      }
    }
    return found.filter { condition(filter, in: $0) }
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
  /// `activityActionLabel` and `humanizeActivityCode`: what a stored activity action reads as.
  public static func activityActionLabel(_ stored: String) -> String {
    let action = stored.trimmingCharacters(in: .whitespacesAndNewlines)
    if let label = ContractValues.shared.duplicateActivityActionLabels[action] { return label }
    guard action.range(of: #"^[a-z][\w-]*(\.[\w-]+)+$"#, options: [.regularExpression, .caseInsensitive]) != nil else {
      return action.prefix(1).uppercased() + action.dropFirst()
    }
    func words(_ segment: String) -> String {
      segment.replacingOccurrences(of: #"([a-z0-9])([A-Z])"#, with: "$1 $2", options: .regularExpression)
        .replacingOccurrences(of: #"[-_]+"#, with: " ", options: .regularExpression)
        .lowercased().trimmingCharacters(in: .whitespaces)
    }
    let segments = action.split(separator: ".").map(String.init).filter { !$0.isEmpty }
    let namespaces = ["org": "Organization", "orgs": "Organizations", "user": "Account", "host": "Site"]
    let head = segments[0]
    let lead = namespaces[head] ?? { let w = words(head); return w.prefix(1).uppercased() + w.dropFirst() }()
    return segments.count == 1 ? lead : "\(lead): \(segments.dropFirst().map(words).joined(separator: " "))"
  }

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
    // `(a - b) * c / 1000`, `max(0, a - b)`: arithmetic with products, brackets and a few functions.
    if calculates(body) {
      guard let result = calculate(body, in: context) else { return nil }
      let value = JSONValue.number(result)
      guard let format, !format.isEmpty else { return value }
      return .string(formatted(value, as: format, in: context))
    }
    // `a + b - c`: a sum of numbers (paths or literals), each operator set apart by spaces. A term
    // that is missing makes the whole sum missing, so a read that failed never shows as zero.
    if let terms = arithmeticTerms(body) {
      var total = 0.0
      for (sign, term) in terms {
        // A term ending in `?` is zero where it is missing (an add-on never bought).
        let optional = term.hasSuffix("?")
        let path = optional ? String(term.dropLast()) : term
        let value = Double(path).map { JSONValue.number($0) } ?? lookup(path, in: context)
        if optional, value == nil || value == .null { continue }
        // A list (`rows.*.field`) adds up its numbers.
        if case .array(let items)? = value {
          total += sign * items.compactMap { number($0) }.reduce(0, +)
          continue
        }
        guard let amount = number(value) else { return nil }
        total += sign * amount
      }
      let sum = JSONValue.number(total)
      guard let format, !format.isEmpty else { return sum }
      return .string(formatted(sum, as: format, in: context))
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
    case .object(let record) where record["$if"] != nil && record.keys.allSatisfy({ ["$if", "then", "else"].contains($0) }):
      // `{"$if": "form.override", "then": "{form.x}", "else": {"$delete": true}}`: one of two values by a condition; a missing
      // branch is nothing (the member is left out), and `"$null"` sends null.
      let chosen = condition(record["$if"]?.stringValue, in: context) ? record["then"] : record["else"]
      return resolveBody(chosen ?? .null, in: context)
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
    case .object(let record) where record.count == 1 && record["$overlay"] != nil:
      // `{"$overlay": {"base": "{overlay}", "set": {"slug": "{form.slug}", "supplierId": {"$orNull": "{form.supplier}"}}}}`: the base object with each
      // key of `set` put on top, a key whose value is null taken off. What a route that replaces a document is sent.
      let spec = record["$overlay"] ?? .null
      var merged: [String: JSONValue] = [:]
      if case .object(let base) = resolveBody(spec["base"] ?? .null, in: context) { merged = base }
      if case .object(let set) = resolveBody(spec["set"] ?? .null, in: context) {
        for (key, value) in set { if case .null = value { merged[key] = nil } else { merged[key] = value } }
      }
      return .object(merged)
    case .object(let record) where record.count == 1 && record["$map"] != nil:
      // `{"$map": {"list": "{data.rates.results}", "where": "item.rate", "fields": {"recordId": "{item.recordId}"}}}`: one object of
      // `fields` for each row of the list that meets `where` (all of them with none), each read with `item` set to the row.
      let spec = record["$map"] ?? .null
      var list: [JSONValue] = []
      if case .array(let items) = resolveBody(spec["list"] ?? .null, in: context) { list = items }
      let keep = spec["where"]?.stringValue
      let fields = spec["fields"] ?? .null
      return .array(list.map { ScreenContext.with(context, item: $0) }.filter { condition(keep, in: $0) }.map { resolveBody(fields, in: $0) })
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
      // `{"$cents": "{form.amount}"}`: typed dollars (`12.50`, `$1,200`, and `-5.50` to take money away) as whole cents; null when it is not an amount.
      var typed = Self.text(resolveBody(record["$cents"] ?? .null, in: context)).trimmingCharacters(in: .whitespaces)
        .replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "")
      let negative = typed.hasPrefix("-")
      if negative { typed.removeFirst() }
      guard typed.range(of: #"^(\d+(\.\d{0,2})?|\.\d{1,2})$"#, options: .regularExpression) != nil else { return .null }
      let parts = typed.split(separator: ".", omittingEmptySubsequences: false)
      let whole = Int(parts[0].isEmpty ? "0" : String(parts[0])) ?? 0
      let fraction = parts.count > 1 ? Int(String(parts[1]).padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0 : 0
      return .number(Double((whole * 100 + fraction) * (negative ? -1 : 1)))
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
    case .object(let record) where record.count == 1 && record["$collect"] != nil:
      // `{"$collect": {"prefix": "quota.", "as": "number"}}`: the form's `quota.*` inputs as a map, key without the prefix.
      // `as: number` keeps the filled ones as numbers; `as: flag` reads "true" and "false" and leaves "" (inherit) out.
      let spec = record["$collect"] ?? .null
      let prefix = spec["prefix"]?.stringValue ?? ""
      let kind = spec["as"]?.stringValue ?? "text"
      var map: [String: JSONValue] = [:]
      if case .object(let form)? = lookup("form", in: context) {
        for (key, value) in form where key.hasPrefix(prefix) {
          let name = String(key.dropFirst(prefix.count))
          switch (kind, value) {
          case ("flag", .bool(let flag)): map[name] = .bool(flag)
          case ("flag", .string(let text)): if text == "true" { map[name] = .bool(true) } else if text == "false" { map[name] = .bool(false) }
          case (_, .null): break
          case ("number", .string(let text)):
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            if !trimmed.isEmpty { map[name] = Double(trimmed).map(JSONValue.number) ?? .string(trimmed) }
          case (_, .string(let text)): if !text.isEmpty { map[name] = value }
          case ("flag", _): break
          default: map[name] = value
          }
        }
      }
      return .object(map)
    case .object(let record) where record.count == 1 && record["$afterHours"] != nil:
      // `{"$afterHours": "{form.hours}"}`: the moment that many hours from now, in epoch milliseconds; nothing when blank or not positive.
      guard let hours = number(resolveBody(record["$afterHours"] ?? .null, in: context)), hours > 0, hours.isFinite else { return .null }
      let now = number(lookup("now.ms", in: context)) ?? (Date().timeIntervalSince1970 * 1000).rounded()
      return .number((now + hours * 3_600_000).rounded())
    case .object(let record) where record.count == 1 && record["$index"] != nil:
      // `{"$index": {"rows": "data.picklists", "filter": "…", "key": "{item.fieldId}", "value": "{item.proposals}"}}`:
      // the rows (those meeting `filter`) as a map, each under its key (a row with no key is left out).
      let spec = record["$index"] ?? .null
      var map: [String: JSONValue] = [:]
      for row in rows(lookup(spec["rows"]?.stringValue ?? "", in: context)) {
        let scope = ScreenContext.with(context, item: row)
        // `filter`: only the rows that meet it; the row before (a clicked item) is `parent`.
        if let filter = spec["filter"]?.stringValue, !condition(filter, in: scope) { continue }
        let key = Self.text(resolveBody(spec["key"] ?? .null, in: scope))
        if !key.isEmpty { map[key] = resolveBody(spec["value"] ?? .null, in: scope) }
      }
      return .object(map)
    case .object(let record) where record.count == 1 && record["$merge"] != nil:
      // `{"$merge": [a, b]}`: the maps laid over one another, deeply; a later value wins.
      var merged: [String: JSONValue] = [:]
      for part in (record["$merge"] ?? .null).array {
        if case .object(let one) = resolveBody(part, in: context) { merged = mergeMaps(merged, one) }
      }
      return .object(merged)
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
        // `name?`: sent only when it holds something (not null, "", [] or {}); false and 0 are real answers.
        if key.hasSuffix("?") {
          if !isBlank(resolved) { out[String(key.dropLast())] = resolved }
          continue
        }
        // A template that found nothing is left out; a literal null is sent (it clears the field), and so is `"$null"`
        // where a branch of `$if` has to say null (a comp removed).
        // A key written as a template (`{item.id}`) is the text it renders: a map keyed by the row's own id.
        let name = key.contains("{") ? render(key, in: context) : key
        if resolved == .string("$null") {
          out[name] = .null
        } else if resolved != .null || value == .null || value["$orNull"] != nil {
          out[name] = resolved
        }
      }
      return .object(out)
    default: return body
    }
  }

  /// Nothing to send: null, empty text, an empty list or an empty map.
  static func isBlank(_ value: JSONValue) -> Bool {
    switch value {
    case .null: true
    case .string(let text): text.isEmpty
    case .array(let items): items.isEmpty
    case .object(let record): record.isEmpty
    default: false
    }
  }

  /// `base` with `top` laid over it: maps merge key by key, anything else is replaced.
  static func mergeMaps(_ base: [String: JSONValue], _ top: [String: JSONValue]) -> [String: JSONValue] {
    var out = base
    for (key, value) in top {
      if case .object(let over) = value, case .object(let under)? = out[key] {
        out[key] = .object(mergeMaps(under, over))
      } else {
        out[key] = value
      }
    }
    return out
  }

  /// A total as a person types it (`1250`, `$1,250.00`, `1,250 USD`), in cents; nil for anything else
  /// (the gift card import's `typedDollarsToCents`).
  public static func dollarsToCents(_ typed: String) -> Int? {
    var body = typed.trimmingCharacters(in: .whitespacesAndNewlines)
    if body.hasPrefix("$") {
      body.removeFirst()
    } else if body.lowercased().hasPrefix("usd") {
      body.removeFirst(3)
      body = String(body.drop(while: { $0.isWhitespace }))
    }
    if body.lowercased().hasSuffix("usd") {
      body.removeLast(3)
      while body.last?.isWhitespace == true { body.removeLast() }
    }
    body = body.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard body.range(of: #"^[0-9]+(\.[0-9]{1,2})?$"#, options: .regularExpression) != nil, let amount = Double(body) else {
      return nil
    }
    return Int((amount * 100).rounded())
  }

  /// A chosen file's text: UTF-8 (a byte-order mark dropped), UTF-16 where it carries its mark, else
  /// Windows-1252, the encoding a spreadsheet's "CSV" is saved in. Nothing is dropped silently.
  public static func decodeFileText(_ data: Data) -> String {
    let bytes = [UInt8](data)
    if bytes.starts(with: [0xEF, 0xBB, 0xBF]) { return String(decoding: bytes.dropFirst(3), as: UTF8.self) }
    if bytes.starts(with: [0xFF, 0xFE]) { return String(data: Data(bytes.dropFirst(2)), encoding: .utf16LittleEndian) ?? "" }
    if bytes.starts(with: [0xFE, 0xFF]) { return String(data: Data(bytes.dropFirst(2)), encoding: .utf16BigEndian) ?? "" }
    if let text = String(data: data, encoding: .utf8) { return text }
    return String(data: data, encoding: .windowsCP1252) ?? String(data: data, encoding: .isoLatin1) ?? ""
  }

  /// What one character costs once JSON-encoded, in UTF-8 bytes (the console's `encodedBytes`).
  private static func encodedBytes(_ scalar: Unicode.Scalar) -> Int {
    let code = scalar.value
    if scalar == "\"" || scalar == "\\" { return 2 }
    if code == 0x08 || code == 0x09 || code == 0x0A || code == 0x0C || code == 0x0D { return 2 }
    if code < 0x20 { return 6 }
    if code < 0x80 { return 1 }
    if code < 0x800 { return 2 }
    return code < 0x10000 ? 3 : 4
  }

  /// A file's text cut into parts that each take at most `budget` bytes once JSON-encoded, ending on a
  /// character boundary, so the parts join back into the file.
  public static func splitUpload(_ text: String, budget: Int = 3_000_000) -> [String] {
    var parts: [String] = []
    var current = String.UnicodeScalarView()
    var used = 0
    for scalar in text.unicodeScalars {
      let cost = encodedBytes(scalar)
      if used + cost > budget, !current.isEmpty {
        parts.append(String(current))
        current = String.UnicodeScalarView()
        used = 0
      }
      current.append(scalar)
      used += cost
    }
    parts.append(String(current))
    return parts
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
    // `path ~= x` (or `~= @path`): a list holds x, or a text contains it.
    if !clause.contains("=="), !clause.contains("!="), let range = clause.range(of: "~=") {
      // `path !~= x` is the other way round.
      let negated = clause[..<range.lowerBound].hasSuffix("!")
      let leftPath = String(clause[..<range.lowerBound]).trimmingCharacters(in: CharacterSet(charactersIn: "! "))
      let left = lookup(leftPath, in: context)
      var right = clause[range.upperBound...].trimmingCharacters(in: .whitespaces)
      if right.count >= 2, right.hasPrefix("'"), right.hasSuffix("'") { right = String(right.dropFirst().dropLast()) }
      // `a ~= @path`: what is wanted is read from the context (the kinds a file holds, against a row's own).
      else if right.hasPrefix("@") { right = text(lookup(String(right.dropFirst()), in: context)) }
      let holds: Bool
      if case .array(let items)? = left { holds = items.contains { text($0) == right } } else { holds = text(left).contains(right) }
      return negated ? !holds : holds
    }
    // `a > b`, `a >= b`, `a < b`, `a <= b`: numbers and times. Each side is a literal, a path (a time reads as epoch
    // milliseconds) or arithmetic (`max(0, a - b) > 0`, `a + b >= c`); the right side may be `@path` with an optional offset
    // (`@now.ms+7d`). A projected list on the left (`holds.*.expiresAtMs > @now.ms`) holds when any of its values does. A
    // missing side is false, except two months or other texts (`2026-09 <= now.month`), which are ordered as text.
    if !clause.contains("=="), !clause.contains("!=") {
      for op in [">=", "<=", ">", "<"] {
        guard let range = clause.range(of: op) else { continue }
        let leftText = clause[..<range.lowerBound].trimmingCharacters(in: .whitespaces)
        let rightText = clause[range.upperBound...].trimmingCharacters(in: .whitespaces)
        let timed = rightText.hasPrefix("@")
        func measure(_ value: JSONValue?) -> Double? { timed ? comparable(value) : (number(value) ?? epochMillis(value).map(Double.init)) }
        func side(_ trimmed: String) -> Double? {
          if let literal = Double(trimmed) { return literal }
          if trimmed.hasPrefix("@") { return operand(trimmed, in: context) }
          if calculates(trimmed) { return calculate(trimmed, in: context) }
          if arithmeticTerms(trimmed) != nil { return number(evaluate(trimmed, in: context)) }
          return measure(lookup(trimmed, in: context))
        }
        func holds(_ left: Double, _ right: Double) -> Bool {
          switch op {
          case ">=": return left >= right
          case "<=": return left <= right
          case ">": return left > right
          default: return left < right
          }
        }
        let right = side(rightText)
        if let right, !calculates(leftText), arithmeticTerms(leftText) == nil, case .array(let list)? = lookup(leftText, in: context) {
          return list.compactMap { measure($0) }.contains { holds($0, right) }
        }
        guard let left = side(leftText), let right else {
          func words(_ trimmed: String) -> String {
            let found = text(lookup(trimmed, in: context))
            if !found.isEmpty { return found }
            // A literal month or date (`2026-10`), not a path that found nothing.
            return !trimmed.isEmpty && trimmed.allSatisfy { $0.isNumber || $0 == "-" } ? trimmed : ""
          }
          let a = words(leftText)
          let b = words(rightText)
          guard !a.isEmpty, !b.isEmpty, side(leftText) == nil, !timed else { return false }
          switch op {
          case ">=": return a >= b
          case "<=": return a <= b
          case ">": return a > b
          default: return a < b
          }
        }
        return holds(left, right)
      }
    }
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

  /// Whether `body` is arithmetic beyond a sum: a product or quotient set apart by spaces, or brackets.
  static func calculates(_ body: String) -> Bool {
    !body.contains("'") && (body.contains(" * ") || body.contains(" / ") || body.contains("("))
  }

  /// The tokens of an arithmetic body: operators set apart by spaces, brackets and commas, and paths (which may hold `-`, `.`, `[…]`).
  private static func calcTokens(_ body: String) -> [String] {
    var tokens: [String] = []
    var current = ""
    var depth = 0
    func flush() {
      if !current.isEmpty { tokens.append(current) }
      current = ""
    }
    for character in body {
      if character == "[" { depth += 1 }
      if character == "]" { depth -= 1 }
      if depth <= 0, character == " " {
        flush()
      } else if depth <= 0, character == "(" || character == ")" || character == "," {
        flush()
        tokens.append(String(character))
      } else {
        current.append(character)
      }
    }
    flush()
    return tokens
  }

  /// `(a - b) * c / 1000`: the usual precedence; a path is a number (a list adds up), `x?` is zero where it
  /// is missing, and the functions are `max`, `min`, `round` (half up, as JavaScript's), `floor`, `ceil` and
  /// `abs`. Anything missing, or a division by zero, makes the whole figure missing.
  static func calculate(_ body: String, in context: JSONValue) -> Double? {
    let tokens = calcTokens(body)
    var position = 0
    func peek() -> String? { position < tokens.count ? tokens[position] : nil }
    func take() -> String? {
      defer { position += 1 }
      return peek()
    }
    func expression() -> Double? {
      guard var left = term() else { return nil }
      while let op = peek(), op == "+" || op == "-" {
        position += 1
        guard let right = term() else { return nil }
        left = op == "+" ? left + right : left - right
      }
      return left
    }
    func term() -> Double? {
      guard var left = unary() else { return nil }
      while let op = peek(), op == "*" || op == "/" {
        position += 1
        guard let right = unary() else { return nil }
        if op == "/" {
          if right == 0 { return nil }
          left /= right
        } else {
          left *= right
        }
      }
      return left
    }
    func unary() -> Double? {
      if peek() == "-" {
        position += 1
        return unary().map { -$0 }
      }
      return primary()
    }
    func primary() -> Double? {
      guard let token = take() else { return nil }
      if token == "(" {
        let inner = expression()
        guard take() == ")" else { return nil }
        return inner
      }
      if ["max", "min", "round", "floor", "ceil", "abs"].contains(token), peek() == "(" {
        position += 1
        var arguments: [Double] = []
        while peek() != ")" {
          guard let one = expression() else { return nil }
          arguments.append(one)
          if peek() == "," { position += 1 } else { break }
        }
        guard take() == ")", let first = arguments.first else { return nil }
        switch token {
        case "max": return arguments.max()
        case "min": return arguments.min()
        case "round": return (first + 0.5).rounded(.down)
        case "floor": return first.rounded(.down)
        case "ceil": return first.rounded(.up)
        default: return abs(first)
        }
      }
      if let literal = Double(token) { return literal }
      let optional = token.hasSuffix("?")
      let path = optional ? String(token.dropLast()) : token
      let value = lookup(path, in: context)
      if optional, value == nil || value == .null { return 0 }
      if case .array(let items)? = value { return items.compactMap { number($0) }.reduce(0, +) }
      return number(value)
    }
    guard let result = expression(), position == tokens.count, result.isFinite else { return nil }
    return result
  }

  /// The signed terms of `a + b - c`, or nil where the text is not a sum.
  static func arithmeticTerms(_ body: String) -> [(sign: Double, term: String)]? {
    guard !body.contains("'"), body.contains(" + ") || body.contains(" - ") else { return nil }
    var terms: [(Double, String)] = []
    var sign = 1.0
    var current: [Substring] = []
    for word in body.split(separator: " ", omittingEmptySubsequences: true) {
      if word == "+" || word == "-" {
        guard !current.isEmpty else { return nil }
        terms.append((sign, current.joined(separator: " ")))
        current = []
        sign = word == "+" ? 1 : -1
      } else {
        current.append(word)
      }
    }
    guard !current.isEmpty else { return nil }
    terms.append((sign, current.joined(separator: " ")))
    return terms.count > 1 ? terms : nil
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

  /// The clock `now` reads; tests pin it.
  nonisolated(unsafe) public static var clock: () -> Date = { Date() }

  /// `now.year`, `now.month` (`2026-10`), `now.prevMonth`, `now.quarter`, `now.ms` and `now.day` (`2026-10-13`) in UTC, the keys the
  /// console's monthly counters and daily documents are named by, `now.localDayMs` (today on the device's calendar as the UTC
  /// midnight a stay's nights are stored in), and `now.months`: the last twelve months, newest first, as a
  /// report picks them (`{ from, to, label }` with ISO instants in UTC).
  public static func nowObject(at date: Date? = nil) -> JSONValue {
    let clock = { date ?? Self.clock() }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let parts = calendar.dateComponents([.year, .month, .day], from: clock())
    let year = String(format: "%04d", parts.year ?? 1970), month = String(format: "%02d", parts.month ?? 1)
    let day = String(format: "%02d", parts.day ?? 1)
    let earlier = calendar.date(byAdding: .month, value: -1, to: clock()).map { calendar.dateComponents([.year, .month], from: $0) } ?? parts
    let previous = String(format: "%04d-%02d", earlier.year ?? 1970, earlier.month ?? 1)
    return [
      "year": .string(year), "month": .string("\(year)-\(month)"), "day": .string("\(year)-\(month)-\(day)"),
      "prevMonth": .string(previous), "quarter": .string("\(year)-Q\(((parts.month ?? 1) - 1) / 3 + 1)"),
      "ms": .number((clock().timeIntervalSince1970 * 1000).rounded()),
      "localDayMs": .number(Double(Stays.localToday(clock(), in: timeZone))),
      "months": .array(ScreenSession.recentMonths(year: parts.year ?? 1970, month: parts.month ?? 1)),
    ]
  }

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

  /// Two answers added: numbers sum, objects merge key by key, anything else takes the newer value.
  public static func sum(_ total: JSONValue, _ page: JSONValue) -> JSONValue {
    switch (total, page) {
    case (.number(let left), .number(let right)): return .number(left + right)
    case (.object(var left), .object(let right)):
      for (key, value) in right { left[key] = left[key].map { sum($0, value) } ?? value }
      return .object(left)
    default: return page
    }
  }

  /// An object's plain values as `words: value`, joined by " · ": the readings of a check that
  /// have no screen of their own. Keys are sorted and split from camelCase; `ok`, `ms` and `code`
  /// are shown elsewhere, and nested values are left out.
  /// An object's entries as `key: value`, the keys as they are (ids, which `facts` would split into words).
  static func pairs(_ value: JSONValue?) -> String {
    guard case .object(let record)? = value else { return text(value) }
    return record.keys.sorted().compactMap { key -> String? in
      let shown = text(record[key])
      return shown.isEmpty ? nil : "\(key): \(shown)"
    }.joined(separator: ", ")
  }

  /// A random value of `length` characters from `alphabet`, from the system's secure generator.
  public static func generated(length: Int, alphabet: String) -> String {
    let characters = Array(alphabet)
    guard !characters.isEmpty, length > 0 else { return "" }
    var generator = SystemRandomNumberGenerator()
    return String((0..<length).map { _ in characters.randomElement(using: &generator)! })
  }

  static func facts(_ value: JSONValue?) -> String {
    guard case .object(let record)? = value else { return text(value) }
    return record.keys.sorted().compactMap { key -> String? in
      guard !["ok", "ms", "code"].contains(key), let entry = record[key] else { return nil }
      let shown: String
      switch entry {
      case .string(let text) where !text.isEmpty: shown = text
      case .number: shown = formatted(entry, as: "number", in: .null)
      case .bool(let flag): shown = flag ? "yes" : "no"
      default: return nil
      }
      var words = ""
      for character in key {
        if character.isUppercase { words += " " + character.lowercased() } else { words.append(character) }
      }
      return "\(words): \(shown)"
    }.joined(separator: " · ")
  }

  /// A value in a named format. Unknown formats print the plain text.
  public static func formatted(_ value: JSONValue?, as format: String, in context: JSONValue) -> String {
    // `cents/<currency path>` reads the currency beside the amount.
    let parts = format.split(separator: "/", maxSplits: 1).map(String.init)
    let name = parts.first ?? format
    // `first3`: a list's first three entries, joined.
    if name.hasPrefix("first"), let count = Int(name.dropFirst(5)), case .array(let items)? = value {
      return text(.array(Array(items.prefix(count))))
    }
    switch name {
    case "date":
      return epochMillis(value).map { dateText($0, "MMM d, yyyy") } ?? text(value)
    case "datetime":
      return epochMillis(value).map { dateText($0, "MMM d, yyyy, h:mm a") } ?? text(value)
    case "clock":
      // A time of day alone: `3:05 PM`.
      return epochMillis(value).map { dateText($0, "h:mm a") } ?? text(value)
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
    case "usd":
      // A charge: a real amount under a cent reads `<$0.01`, never `$0.00` beside a non-zero total.
      guard let amount = number(value) else { return text(value) }
      if amount > 0, amount < 0.005 { return "<$0.01" }
      return formatOrderMoney(Int((amount * 100).rounded()), currency: "USD")
    case "bytes":
      return number(value).map(bytesText) ?? text(value)
    case "megabytes":
      // Bytes as megabytes to one decimal, plain so a meter can read it back (the storage band's figure).
      return number(value).map { numberText(($0 / 1_048_576 * 10).rounded() / 10) } ?? text(value)
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
    case "percentof":
      // `percentof/other.path`: this as a percentage of the number at the path, to one decimal (`5`, `2.5`); `0` when there is nothing to divide by.
      guard let top = number(value), parts.count > 1, let bottom = number(lookup(parts[1], in: context)), bottom != 0 else { return "0" }
      return numberText(((top / bottom) * 1000 + 0.5).rounded(.down) / 10)
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
      if value == nil || value == .null { return "" }
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
    case "present":
      // "true" where the value exists at all (a stored false or 0 counts), else empty: an override switch's start.
      return value != nil && value != .null ? "true" : ""
    case "title":
      let raw = text(value).replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
      return raw.prefix(1).uppercased() + raw.dropFirst()
    case "activity":
      // An activity row's action in words (`activityActionLabel`): a duplicate's code is its sentence, a dotted code nobody
      // named reads from its segments (`billing.invoice.paid` is `Billing: invoice paid`), and a stored sentence is itself.
      return activityActionLabel(text(value))
    case "upper":
      // `upper/2` also keeps at most that many characters (a country or state code).
      let upper = text(value).uppercased()
      return parts.count > 1 ? Int(parts[1]).map { String(upper.prefix($0)) } ?? upper : upper
    case "facts":
      return facts(value)
    case "pairs":
      return pairs(value)
    case "shareOf":
      // `shareOf/<path>`: the value as a whole percent of the number at <path> ("40%"; "0%" when there is nothing to share).
      let total = parts.count > 1 ? number(lookup(parts[1], in: context)) ?? 0 : 0
      guard total > 0, let part = number(value) else { return "0%" }
      return "\(Int((part / total * 100).rounded()))%"
    case "before", "after":
      // `before/-` and `after/-`: the text either side of the first separator (a jurisdiction key `US-TX`); no separator, no tail.
      let whole = text(value)
      let separator = parts.count > 1 ? parts[1] : "-"
      guard let found = whole.range(of: separator) else { return name == "before" ? whole : "" }
      return name == "before" ? String(whole[..<found.lowerBound]) : String(whole[found.upperBound...])
    case "labeled":
      // `labeled/<path>`: each id (or the one) through the map at <path>; an id the map lacks stays as it is.
      let map = parts.count > 1 ? lookup(parts[1], in: context) : nil
      let ids: [JSONValue]
      if case .array(let items)? = value { ids = items } else { ids = value.map { [$0] } ?? [] }
      return ids.map { id -> String in
        let key = text(id)
        return map?[key].map { text($0) } ?? key
      }.filter { !$0.isEmpty }.joined(separator: ", ")
    case "duration":
      // The console's `formatAge`: "under a minute", "12 min", "3h 5m", "4 days".
      guard let millis = number(value), millis.isFinite else { return "unknown" }
      let minutes = Int(millis / 60_000)
      if minutes < 1 { return "under a minute" }
      if minutes < 60 { return "\(minutes) min" }
      let hours = minutes / 60
      return hours < 48 ? "\(hours)h \(minutes % 60)m" : "\(hours / 24) days"
    case "phone":
      return normalizedPhone(text(value)) ?? text(value)
    // The two halves of a `kind/id` key.
    case "head":
      return text(value).split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
    case "tail":
      let parts = text(value).split(separator: "/", maxSplits: 1, omittingEmptySubsequences: false)
      return parts.count > 1 ? String(parts[1]) : ""
    // The instance a resource key names (`email.list-members:abc` is the list `abc`); empty for a resource with none.
    case "instance":
      let text = text(value)
      guard let colon = text.firstIndex(of: ":") else { return "" }
      return String(text[text.index(after: colon)...])
    case "json":
      return (try? value.map { String(data: try $0.encoded(), encoding: .utf8) ?? "" }) ?? ""
    default:
      return text(value)
    }
  }

  /// Best-effort E.164, as the console stores a phone number: `+` and 8 to 15
  /// digits, or a US/CA number with or without the leading 1. Anything else
  /// is not guessed at.
  public static func normalizedPhone(_ input: String) -> String? {
    let raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
    if raw.isEmpty { return nil }
    let digits = raw.filter { $0.isASCII && $0.isNumber }
    if raw.hasPrefix("+") { return (8...15).contains(digits.count) ? "+" + digits : nil }
    if digits.count == 10 { return "+1" + digits }
    if digits.count == 11, digits.hasPrefix("1") { return "+" + digits }
    return nil
  }
}
