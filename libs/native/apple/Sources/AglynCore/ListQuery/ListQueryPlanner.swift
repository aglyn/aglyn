// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

// The console's list-query planner (libs/shared/util/tools list-query-plan.ts),
// ported once. It turns a list declaration and a request (filter clauses, a
// search, a sort) into Firestore filters and one order, refusing in words
// whatever Firestore cannot answer. list-query-cases.generated.json holds the
// plans the TypeScript makes, and the tests replay every one.
//
// A date value is `{ "$date": ISO }` in a plan, as the cases write it; a field
// stored as millis compares as epoch milliseconds.

/// The last code point a prefix range reaches up to.
private let prefixHigh = "\u{F8FF}"

private let inequalities: Set<ListQueryOp> = [
  .notEqual, .lessThan, .lessThanOrEqual, .greaterThan, .greaterThanOrEqual,
]

private func emptyOperators(_ field: ListFilterField) -> [String] {
  switch field.presence ?? .sparse {
  case .always: return []
  case .nullable: return ["isEmpty", "isNotEmpty"]
  default: return ["isNotEmpty"]
  }
}

/// The operators a field offers: its declared list, else what its paths can answer.
public func listFilterOperators(_ field: ListFilterField) -> [String] {
  if let operators = field.operators { return operators }
  let empties = emptyOperators(field)
  switch field.kind {
  case .text:
    var operators: [String] = []
    if field.tokensPath != nil { operators.append("contains") }
    if field.lowerPath != nil { operators += ["equals", "startsWith"] }
    if field.reversedPath != nil { operators.append("endsWith") }
    return operators + empties
  case .exact: return ["equals", "isAnyOf"] + empties
  case .id: return ["equals", "startsWith", "isAnyOf"]
  case .boolean: return ["is"]
  case .number: return ["=", "!=", ">", ">=", "<", "<="] + empties
  case .date: return ["is", "after", "onOrAfter", "before", "onOrBefore"] + empties
  default: return []
  }
}

/// How one clause lands on a query, before it is composed with the others.
private struct ClauseShape {
  var filters: [ListQueryFilter]
  /// The inequality path the clause needs to lead the order, if any.
  var inequality: String? = nil
  /// The clause is the query's one array clause.
  var array = false
}

private enum ClauseOutcome {
  case shape(ClauseShape)
  case refused(String)
}

private func filter(_ path: String, _ op: ListQueryOp, _ value: ContractJSON) -> ListQueryFilter {
  ListQueryFilter(op: op, path: path, value: value)
}

private func strings(_ values: [String]) -> ContractJSON { .array(values.map { .string($0) }) }

private func csv(_ raw: String) -> [String] {
  raw.split(separator: ",", omittingEmptySubsequences: false)
    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
}

/// JavaScript's `Number(raw)` for what a person types: a finite number, or nil.
private func jsNumber(_ raw: String) -> Double? {
  let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty { return 0 }
  let lower = text.lowercased()
  for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] where lower.hasPrefix(prefix) {
    return Int64(lower.dropFirst(2), radix: radix).map(Double.init)
  }
  guard text.range(of: #"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$"#, options: .regularExpression) != nil,
    let value = Double(text), value.isFinite
  else { return nil }
  return value
}

private func rangeOrder(_ declaration: ListQueryDeclaration, _ field: ListFilterField?, _ path: String)
  -> ListQuerySort
{
  declaration.sorts.first { $0.path == path }
    ?? ListQuerySort(direction: field?.kind == .date ? .desc : .asc, path: path)
}

private func shapeClause(
  _ field: ListFilterField,
  _ input: ListFilterRequest,
  _ names: ListQueryNormalizers,
  _ timeZone: TimeZone
) -> ClauseOutcome {
  let disjunctionLimit = ContractValues.shared.listQueryDisjunctions
  let idPath = ContractValues.shared.listQueryIdPath
  if field.windowOnly == true { return .refused("this field is not stored where a query can reach it") }
  let op = input.op
  let cannot = ClauseOutcome.refused("\(op) is not something this list can ask of \(field.column)")
  if !listFilterOperators(field).contains(op) { return cannot }
  let raw = input.value.trimmingCharacters(in: .whitespacesAndNewlines)

  if op == "isEmpty" {
    if field.presence != .nullable { return .refused("only a field stored as null can be asked for empty") }
    return .shape(ClauseShape(filters: [filter(field.path, .equal, .null)]))
  }
  if op == "isNotEmpty" {
    if field.presence == .always { return .refused("this field is never empty") }
    return .shape(ClauseShape(filters: [filter(field.path, .notEqual, .null)], inequality: field.path))
  }
  if field.kind == .boolean {
    if raw != "true" && raw != "false" { return .refused("pick true or false") }
    return .shape(ClauseShape(filters: [filter(field.path, .equal, .bool(raw == "true"))]))
  }
  if raw.isEmpty { return .refused("no value yet") }

  if field.keysOf == true {
    let isKey = raw.range(of: "^[A-Za-z0-9_]+$", options: .regularExpression) != nil
    if op != "equals" || !isKey { return .refused("pick one of the choices") }
    return .shape(ClauseShape(filters: [filter("\(field.path).\(raw)", .equal, .bool(true))]))
  }

  let tooMany = ClauseOutcome.refused("at most \(disjunctionLimit) values")
  switch field.kind {
  case .text:
    if op == "contains", let tokens = field.tokensPath {
      let token = field.verbatimTokens == true ? raw : names.token(raw)
      if token.isEmpty { return .refused("no value yet") }
      return .shape(ClauseShape(filters: [filter(tokens, .arrayContains, .string(token))], array: true))
    }
    if op == "equals", let lower = field.lowerPath {
      return .shape(ClauseShape(filters: [filter(lower, .equal, .string(names.key(raw)))]))
    }
    if op == "equals", field.presence == .always {
      return .shape(ClauseShape(filters: [filter(field.path, .equal, .string(raw))]))
    }
    if op == "startsWith", let lower = field.lowerPath {
      let key = names.key(raw)
      return .shape(
        ClauseShape(
          filters: [
            filter(lower, .greaterThanOrEqual, .string(key)),
            filter(lower, .lessThanOrEqual, .string(key + prefixHigh)),
          ], inequality: lower))
    }
    if op == "endsWith", let reversed = field.reversedPath {
      let key = names.reversed(raw)
      return .shape(
        ClauseShape(
          filters: [
            filter(reversed, .greaterThanOrEqual, .string(key)),
            filter(reversed, .lessThanOrEqual, .string(key + prefixHigh)),
          ], inequality: reversed))
    }
    if op == "isAnyOf", let lower = field.lowerPath {
      let values = csv(raw).map(names.key)
      if values.count > disjunctionLimit { return tooMany }
      return .shape(ClauseShape(filters: [filter(lower, .in, strings(values))]))
    }
    return cannot

  case .id:
    if op == "equals" { return .shape(ClauseShape(filters: [filter(idPath, .equal, .string(raw))])) }
    if op == "isAnyOf" {
      let values = csv(raw)
      if values.count > disjunctionLimit { return tooMany }
      return .shape(ClauseShape(filters: [filter(idPath, .in, strings(values))]))
    }
    if op == "startsWith" {
      return .shape(
        ClauseShape(
          filters: [
            filter(idPath, .greaterThanOrEqual, .string(raw)),
            filter(idPath, .lessThanOrEqual, .string(raw + prefixHigh)),
          ], inequality: idPath))
    }
    return cannot

  case .exact:
    if op == "equals" { return .shape(ClauseShape(filters: [filter(field.path, .equal, .string(raw))])) }
    if op == "isAnyOf" {
      let values = csv(raw)
      if values.count > disjunctionLimit { return tooMany }
      // An array field asked "any of these": one array clause.
      if let tokens = field.tokensPath {
        return .shape(ClauseShape(filters: [filter(tokens, .arrayContainsAny, strings(values))], array: true))
      }
      return .shape(ClauseShape(filters: [filter(field.path, .in, strings(values))]))
    }
    if op == "contains", let tokens = field.tokensPath {
      return .shape(ClauseShape(filters: [filter(tokens, .arrayContains, .string(raw))], array: true))
    }
    return cannot

  case .number:
    guard let value = jsNumber(raw) else { return .refused("type a number") }
    if op == "=" { return .shape(ClauseShape(filters: [filter(field.path, .equal, ContractJSON.number(value))])) }
    let comparisons: [String: ListQueryOp] = [
      "!=": .notEqual, ">": .greaterThan, ">=": .greaterThanOrEqual, "<": .lessThan, "<=": .lessThanOrEqual,
    ]
    guard let found = comparisons[op] else { return cannot }
    return .shape(ClauseShape(filters: [filter(field.path, found, ContractJSON.number(value))], inequality: field.path))

  case .date:
    guard let (start, end) = listQueryDayBounds(raw, timeZone: timeZone) else { return .refused("pick a date") }
    // A field stored as millis is compared as the number it is stored as.
    func at(_ ms: Int64) -> ContractJSON {
      field.storedAs == .millis ? .number(Double(ms)) : .object(["$date": .string(isoInstant(ms))])
    }
    if op == "is" {
      return .shape(
        ClauseShape(
          filters: [filter(field.path, .greaterThanOrEqual, at(start)), filter(field.path, .lessThan, at(end))],
          inequality: field.path))
    }
    let bounds: [String: (ListQueryOp, Int64)] = [
      "after": (.greaterThanOrEqual, end), "onOrAfter": (.greaterThanOrEqual, start),
      "before": (.lessThan, start), "onOrBefore": (.lessThan, end),
    ]
    guard let (bound, ms) = bounds[op] else { return cannot }
    return .shape(ClauseShape(filters: [filter(field.path, bound, at(ms))], inequality: field.path))

  default:
    return cannot
  }
}

private func disjunctions(_ filter: ListQueryFilter) -> Int {
  guard filter.op == .in || filter.op == .arrayContainsAny else { return 1 }
  if case .array(let values) = filter.value { return max(1, values.count) }
  return 1
}

private func json(_ clause: ListFilterRequest) -> ContractJSON {
  .object(["field": .string(clause.field), "op": .string(clause.op), "value": .string(clause.value)])
}

private func scopeText(_ value: ContractJSON) -> String {
  switch value {
  case .string(let text): return text
  case .number(let number): return jsNumberText(number)
  case .bool(let flag): return flag ? "true" : "false"
  default: return "null"
  }
}

private func jsNumberText(_ value: Double) -> String {
  if value.isFinite, value == value.rounded(), abs(value) < 9_007_199_254_740_992 { return String(Int64(value)) }
  return String(value)
}

/// The plan for `request` over `declaration`. `timeZone` is the zone a date
/// clause's day is read in: the device's by default, as the console reads it
/// in the browser's.
public func planListQuery(
  _ declaration: ListQueryDeclaration,
  _ request: ListQueryRequest,
  names: ListQueryNormalizers = NameSearchNormalizers(),
  timeZone: TimeZone = .current
) -> ListQueryPlan {
  let disjunctionLimit = ContractValues.shared.listQueryDisjunctions
  var filters = request.base ?? []
  var served: [ListFilterRequest] = []
  var refused: [ListQueryRefusal] = []
  var notices: [String] = []
  var arrayTaken = filters.contains { $0.op == .arrayContains || $0.op == .arrayContainsAny }
  var inequality = filters.first { inequalities.contains($0.op) }?.path
  var product = filters.reduce(1) { $0 * disjunctions($1) }

  // The search.
  var searched: String?
  let words = (request.search ?? []).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter {
    !$0.isEmpty
  }
  if !words.isEmpty {
    let token = names.token(words.joined(separator: " "))
    if let search = declaration.search {
      if !token.isEmpty {
        let scopeAt = filters.firstIndex { $0.op == .arrayContainsAny || $0.op == .arrayContains }
        if let scopeAt {
          if let scoped = search.scoped {
            // Fold the search into the scope: one array clause answers both.
            let scope = filters[scopeAt].value
            var scopes = [scope]
            if case .array(let values) = scope { scopes = values }
            filters[scopeAt] = filter(
              scoped.tokensPath, .arrayContainsAny,
              .array(scopes.map { .string("\(scopeText($0))\(scoped.join)\(token)") }))
            searched = token
          } else {
            refused.append(
              ListQueryRefusal(
                clause: .string("search"),
                reason: "this list is already narrowed to what you can see, which search cannot combine with"))
          }
        } else {
          filters.append(filter(search.tokensPath, .arrayContains, .string(token)))
          arrayTaken = true
          searched = token
        }
        if searched != nil && words.count > 1 {
          notices.append("Search matches one word at a time: showing results for \"\(token)\".")
        }
        if searched != nil && names.key(words[0]).utf16.count > names.maxPrefix {
          notices.append("Search reads the first \(names.maxPrefix) letters of a word.")
        }
      }
    } else {
      refused.append(ListQueryRefusal(clause: .string("search"), reason: "this list has no search"))
    }
  }

  // The clauses.
  for clause in request.clauses {
    guard let field = declaration.fields.first(where: { $0.column == clause.field }) else {
      refused.append(ListQueryRefusal(clause: json(clause), reason: "this list does not filter by that"))
      continue
    }
    let shape: ClauseShape
    switch shapeClause(field, clause, names, timeZone) {
    case .refused(let reason):
      refused.append(ListQueryRefusal(clause: json(clause), reason: reason))
      continue
    case .shape(let found):
      shape = found
    }
    if shape.array && arrayTaken {
      let reason =
        searched != nil
        ? "cannot be combined with the search — clear the search to use it"
        : "cannot be combined with another \"contains\" or \"any of\" filter on a list"
      refused.append(ListQueryRefusal(clause: json(clause), reason: reason))
      continue
    }
    if let wanted = shape.inequality, let held = inequality, wanted != held {
      refused.append(
        ListQueryRefusal(
          clause: json(clause), reason: "only one range (dates, numbers, starts with) can apply at a time"))
      continue
    }
    let next = shape.filters.reduce(product) { $0 * disjunctions($1) }
    if next > disjunctionLimit {
      refused.append(
        ListQueryRefusal(clause: json(clause), reason: "too many values at once (the limit is \(disjunctionLimit))"))
      continue
    }
    filters += shape.filters
    served.append(clause)
    if shape.array { arrayTaken = true }
    if let wanted = shape.inequality { inequality = wanted }
    product = next
  }

  // The order. An `alone` order holds only while nothing narrows the list
  // past its base (AGL-3680); a range leads with the field it ranges over, in
  // the asked direction when the asked order is that field.
  let declared = request.sort.flatMap { sort in
    declaration.sorts.first { $0.path == sort.path && $0.direction == sort.direction }
  }
  var sortFallback: ListQueryPlanSortFallback?
  var asked = declared
  if let declared, declared.alone == true, !served.isEmpty || searched != nil {
    let fallback = defaultHeaderSort(declaration)
    asked = fallback
    sortFallback = ListQueryPlanSortFallback(asked: declared, reason: .alone)
    notices.append(
      "Sorted by \(sortLabel(fallback)): \(sortLabel(declared)) sorts only with no filter or search on.")
  }
  let orderBy: ListQuerySort
  if let range = inequality {
    if let asked, asked.path == range {
      orderBy = asked
    } else {
      let field = declaration.fields.first { $0.path == range || $0.lowerPath == range || $0.reversedPath == range }
      orderBy = rangeOrder(declaration, field, range)
    }
  } else {
    orderBy =
      asked ?? declaration.sorts.first
      ?? ListQuerySort(direction: .asc, path: ContractValues.shared.listQueryIdPath)
  }
  // A range took the order from a header the reader picked: say so.
  if sortFallback == nil, let declared, declared != declaration.sorts.first,
    declared != defaultHeaderSort(declaration), orderBy.path != declared.path
  {
    sortFallback = ListQueryPlanSortFallback(asked: declared, reason: .range)
    let label = sortLabel(orderBy)
    notices.append("Sorted by \(label): a \(label) filter orders the list by it.")
  }

  return ListQueryPlan(
    filters: filters, notices: notices, orderBy: orderBy, refused: refused, searched: searched, served: served,
    sortFallback: sortFallback)
}

private func sortLabel(_ sort: ListQuerySort) -> String { sort.label ?? sort.column ?? sort.path }

/// The order an `alone` sort falls back to: the first header order that is not itself `alone`.
public func defaultHeaderSort(_ declaration: ListQueryDeclaration) -> ListQuerySort {
  declaration.sorts.first { $0.column != nil && $0.alone != true }
    ?? declaration.sorts.first { $0.alone != true }
    ?? ListQuerySort(direction: .asc, path: ContractValues.shared.listQueryIdPath)
}

// MARK: - Days

private let dayOnly = #"^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$"#
private let localDateTime = #"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$"#

private func captures(_ text: String, _ pattern: String) -> [Int]? {
  guard let regex = try? NSRegularExpression(pattern: pattern),
    let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
  else { return nil }
  return (1..<match.numberOfRanges).map { index in
    let range = match.range(at: index)
    guard range.location != NSNotFound, let bounds = Range(range, in: text) else { return 0 }
    return Int(text[bounds]) ?? 0
  }
}

private func instant(_ iso: String) -> Date? {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = formatter.date(from: iso) { return date }
  formatter.formatOptions = [.withInternetDateTime]
  return formatter.date(from: iso)
}

/// A date clause's day as `[start, end)` epoch milliseconds in `timeZone`,
/// or nil when the value names no day. A bare day (or that day at UTC
/// midnight) names the day itself, rolling over as JavaScript's `Date` does;
/// a time without a zone is read in `timeZone`; anything else is an instant
/// and names the day it falls on there.
public func listQueryDayBounds(_ raw: String, timeZone: TimeZone) -> (start: Int64, end: Int64)? {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = timeZone
  let moment: Date?
  if let day = captures(raw, dayOnly) {
    moment = calendar.date(from: DateComponents(year: day[0], month: day[1], day: day[2]))
  } else if let parts = captures(raw, localDateTime) {
    moment = calendar.date(
      from: DateComponents(
        year: parts[0], month: parts[1], day: parts[2], hour: parts[3], minute: parts[4], second: parts[5]))
  } else {
    moment = instant(raw)
  }
  guard let moment else { return nil }
  let start = calendar.startOfDay(for: moment)
  guard let end = calendar.date(byAdding: .day, value: 1, to: start) else { return nil }
  return (epochMillis(start), epochMillis(end))
}

private func epochMillis(_ date: Date) -> Int64 { Int64((date.timeIntervalSince1970 * 1000).rounded()) }

/// Epoch milliseconds as JavaScript's `toISOString` writes them.
func isoInstant(_ epochMillis: Int64) -> String {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  formatter.timeZone = TimeZone(identifier: "UTC")
  return formatter.string(from: Date(timeIntervalSince1970: Double(epochMillis) / 1000))
}
