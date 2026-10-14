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
      // `rows.*.field`: that field of every row, as a list (rows without it are left out; a field
      // that is itself a list adds its members, so `resources.*.items` is every resource's items).
      if raw == "*", case .array(let items)? = current {
        let rest = parts[(position + 1)...].joined(separator: ".")
        return .array(items.compactMap { rest.isEmpty ? $0 : lookup(rest, root: root, from: $0) }.flatMap { value -> [JSONValue] in
          if case .array(let members) = value { return members }
          return [value]
        })
      }
      // `name[group][group]…`: each group is `[field=other.path]` (the first row whose field reads as the text
      // at other.path, or as a quoted literal), `[@path]` (the key is the text at path) or `[some.key]` (a key
      // that itself holds dots).
      var name = raw
      var groups: [String] = []
      if raw.hasSuffix("]"), let open = raw.firstIndex(of: "[") {
        name = String(raw[..<open])
        groups = bracketGroups(raw[open...])
      }
      if !name.isEmpty { current = step(current, name) }
      for inner in groups {
        if inner.hasPrefix("@") {
          current = step(current, text(lookup(String(inner.dropFirst()), root: root, from: root)))
        } else if let equals = inner.firstIndex(of: "=") {
          let field = String(inner[..<equals])
          let right = inner[inner.index(after: equals)...].trimmingCharacters(in: .whitespaces)
          let wanted =
            right.count >= 2 && right.hasPrefix("'") && right.hasSuffix("'")
            ? String(right.dropFirst().dropLast()) : text(lookup(right, root: root, from: root))
          current = current.array.first { text(lookup(field, root: $0, from: $0)) == wanted }
        } else {
          current = step(current, inner)
        }
      }
    }
    return current
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

  /// The scopes a list or an option source walks: one per row of `items` that meets `filter`, with
  /// the row as `item`; or, given `within` (a path read from each row), one per row of that inner
  /// list, the outer row as `parent` (every resource's items, labeled by their resource).
  public static func scopes(items path: String, within: String? = nil, filter: String? = nil, in context: JSONValue) -> [JSONValue] {
    var found: [JSONValue] = []
    for row in rows(lookup(path, in: context)) {
      let outer = ScreenContext.with(context, item: row)
      if let within, !within.isEmpty {
        for inner in rows(lookup(within, in: row)) { found.append(ScreenContext.with(outer, item: inner)) }
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
    case .object(let record) where record.count == 1 && record["$split"] != nil:
      // `{"$split": "{form.pcts}"}`: the comma-separated text as a list; a part that is a number stays one.
      let joined = Self.text(resolveBody(record["$split"] ?? .null, in: context))
      return .array(
        joined.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { part in
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
    // `a > b`, `a >= b`, `a < b`, `a <= b`: numbers, each side a literal or a path.
    if !clause.contains("=="), !clause.contains("!=") {
      for op in [">=", "<=", ">", "<"] {
        guard let range = clause.range(of: op) else { continue }
        func side(_ text: Substring) -> Double? {
          let trimmed = text.trimmingCharacters(in: .whitespaces)
          return Double(trimmed) ?? number(lookup(trimmed, in: context))
        }
        guard let left = side(clause[..<range.lowerBound]), let right = side(clause[range.upperBound...]) else { return false }
        switch op {
        case ">=": return left >= right
        case "<=": return left <= right
        case ">": return left > right
        default: return left < right
        }
      }
    }
    for op in ["!=", "=="] {
      if let range = clause.range(of: op) {
        let left = text(lookup(String(clause[..<range.lowerBound]), in: context))
        var right = clause[range.upperBound...].trimmingCharacters(in: .whitespaces)
        if right.count >= 2, right.hasPrefix("'"), right.hasSuffix("'") { right = String(right.dropFirst().dropLast()) }
        // `a == @path`: the other side is read from the context (the plan a row stands for against the current one).
        let options = right.hasPrefix("@")
          ? [text(lookup(String(right.dropFirst()), in: context))]
          : right.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        return op == "==" ? options.contains(left) : !options.contains(left)
      }
    }
    if clause.hasPrefix("!") { return !truthy(lookup(String(clause.dropFirst()), in: context)) }
    return truthy(lookup(clause, in: context))
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
  /// console's monthly counters and daily documents are named by.
  public static func nowObject() -> JSONValue {
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
