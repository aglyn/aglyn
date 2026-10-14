// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import Foundation

/*
 * A site's variables and no-code functions (`hosts/{hostId}/variables`,
 * `hosts/{hostId}/functions`) as the console's Functions & Variables page
 * reads and changes them: the first 100 of each by document id, the deleted
 * ones hidden; a new one through the quota-enforcing resources route, an
 * edit as the same merge the cards make and a delete as their soft delete,
 * each followed by the site's cache drop. Where a variable or function is
 * used is the console's own scan (`/api/hosts/where-used`). The Kotlin
 * plugin's Logic.kt.
 */

let logicPageScreen = "logic.page"
let logicFunctionScreen = "logic.function"

/// Roles the rules let change a site's logic: the publishing roles.
let logicWriteRoles: Set<String> = ["admin", "editor"]

/// The cards' window: at most this many rows are read, and a fuller collection says so.
let logicCeiling = 100

func variablesPath(_ hostID: String) -> [String] { ["hosts", hostID, "variables"] }
func functionsPath(_ hostID: String) -> [String] { ["hosts", hostID, "functions"] }

/// The cards' read: the first rows by document id, one past the ceiling to know it was cut.
func ceilingQuery(_ path: [String], filters: [ListQueryConstraint] = [], limit: Int = logicCeiling) -> FirestoreQuery {
  FirestoreQuery(path, filters: filters, order: [.init("__name__")], limit: limit + 1)
}

/// A variable as its card lists it.
struct VariableRow: Identifiable, Equatable {
  let id: String
  let name: String
  let type: HostVariableType
  let value: String
  let workflowID: String
  let workflowName: String

  init(_ doc: FirestoreDocument) {
    id = doc.id
    name = doc.string("name") ?? ""
    type = HostVariableType(rawValue: doc.string("type") ?? "") ?? .text
    value = doc.string("value") ?? ""
    workflowID = doc.string("workflowId") ?? ""
    workflowName = doc.string("workflowName") ?? ""
  }
}

/// A function as its card lists it, with the definition its editor opens.
struct FunctionRow: Identifiable, Equatable {
  let id: String
  let definition: HostFunction

  var name: String { definition.name ?? "" }

  /// "P1, P2 → result", as the card's caption reads.
  var signature: String {
    let names = (definition.parameters ?? []).compactMap(\.name).joined(separator: ", ")
    let result = definition.returnValue.flatMap { $0.isEmpty ? nil : $0 } ?? "—"
    return (names.isEmpty ? "no parameters" : names) + " → " + result
  }

  init(_ doc: FirestoreDocument) {
    id = doc.id
    definition = (try? doc.decode(HostFunction.self)) ?? HostFunction(name: doc.string("name"))
  }
}

/// The live rows of a card's window: deleted ones hidden, the rest by name; and whether the window was cut.
func liveWindow<T>(_ docs: [FirestoreDocument], read: (FirestoreDocument) -> T, name: (T) -> String) -> (rows: [T], truncated: Bool) {
  let truncated = docs.count > logicCeiling
  let rows = docs.prefix(logicCeiling).filter { $0.data["deletedAt"] == nil || $0.data["deletedAt"] is NSNull }.map(read)
    .sorted { name($0).lowercased() < name($1).lowercased() }
  return (rows, truncated)
}

// MARK: Ports of the console's pure helpers (LogicTests replays their answers)

/// Whether a name may name a variable or a parameter (`isVariableName`).
func isVariableName(_ name: String) -> Bool {
  name.range(of: "^[a-zA-Z_][a-zA-Z0-9_]{0,39}$", options: .regularExpression) != nil
}

private let months = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
]

/// `String(value)` for a parsed JSON value, as `[...].map(String)` and a template literal print it.
func jsText(_ value: OrderedJSON) -> String {
  switch value {
  case .null: return "null"
  case .bool(let flag): return flag ? "true" : "false"
  case .number(let number): return jsNumberString(number)
  case .string(let text): return text
  case .array(let items): return items.map { item in if case .null = item { return "" } else { return jsText(item) } }.joined(separator: ",")
  case .object: return "[object Object]"
  }
}

/// A variable's value as text binding renders it (`formatVariableValue`); a date in UTC, as `March 1, 2026`.
func formatVariableValue(_ type: HostVariableType, _ raw: String) -> String {
  switch type {
  case .boolean: return raw == "true" ? "true" : "false"
  case .number:
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let number = trimmed.isEmpty ? 0.0 : jsParseNumber(trimmed)
    return number.map { $0.isFinite ? jsNumberString($0) : "" } ?? ""
  case .date:
    let pattern = #"^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$"#
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let regex = try? NSRegularExpression(pattern: pattern), let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
      let year = Range(match.range(at: 1), in: text).flatMap({ Int(text[$0]) }),
      let month = Range(match.range(at: 2), in: text).flatMap({ Int(text[$0]) }),
      let day = Range(match.range(at: 3), in: text).flatMap({ Int(text[$0]) }),
      (1...12).contains(month), (1...31).contains(day)
    else { return raw }
    return "\(months[month - 1]) \(day), \(year)"
  case .dictionary, .collection:
    guard let parsed = OrderedJSON.parse(raw) else { return raw }
    switch parsed {
    case .array(let items): return items.map { jsTextOfItem($0) }.joined(separator: ", ")
    case .object(let entries): return entries.map { "\($0.key): \(jsText($0.value))" }.joined(separator: ", ")
    default: return raw
    }
  default: return raw
  }
}

/// `String(item)` for an array element mapped with `map(String)`: a null is "null".
private func jsTextOfItem(_ value: OrderedJSON) -> String { jsText(value) }

/// JavaScript's `Number(text)` for a trimmed, non-empty text; nil where it would be NaN.
func jsParseNumber(_ text: String) -> Double? {
  if text.hasPrefix("0x") || text.hasPrefix("0X") { return UInt64(text.dropFirst(2), radix: 16).map(Double.init) }
  if text == "Infinity" || text == "+Infinity" { return .infinity }
  if text == "-Infinity" { return -.infinity }
  if text.contains(where: { $0.isLetter && $0 != "e" && $0 != "E" }) { return nil }
  if text.contains("_") || text.contains(" ") { return nil }
  return Double(text)
}

/// "value: Label, value" → the options, duplicates dropped (`parseFunctionParameterOptions`).
func parseFunctionParameterOptions(_ text: String?) -> [HostFunctionParameterOption] {
  var options: [HostFunctionParameterOption] = []
  var seen = Set<String>()
  for part in (text ?? "").split(separator: ",", omittingEmptySubsequences: false) {
    let piece = String(part)
    let colon = piece.firstIndex(of: ":")
    let value = (colon.map { String(piece[..<$0]) } ?? piece).trimmingCharacters(in: .whitespacesAndNewlines)
    if value.isEmpty || !seen.insert(value).inserted { continue }
    let label = colon.map { String(piece[piece.index(after: $0)...]).trimmingCharacters(in: .whitespacesAndNewlines) } ?? ""
    options.append(!label.isEmpty && label != value ? HostFunctionParameterOption(label: label, value: value) : HostFunctionParameterOption(value: value))
  }
  return options
}

/// The options as their one line of text (`formatFunctionParameterOptions`).
func formatFunctionParameterOptions(_ options: [HostFunctionParameterOption]?) -> String {
  (options ?? []).map { option in
    if let label = option.label, !label.isEmpty, label != option.value { return "\(option.value): \(label)" }
    return option.value
  }.joined(separator: ", ")
}

/// `2 pages, 1 workflow` (`summarizeDependents`).
func summarizeDependents(_ result: WhereUsedResult) -> String {
  var order: [String] = []
  var counts: [String: Int] = [:]
  for dependent in result.dependents ?? [] {
    let label = dependent.type == "screen" ? "page" : (dependent.type ?? "")
    if counts[label] == nil { order.append(label) }
    counts[label, default: 0] += 1
  }
  return order.map { "\(counts[$0] ?? 0) \($0)\(counts[$0] == 1 ? "" : "s")" }.joined(separator: ", ")
}

// MARK: The function editor's starting points (`emptyDraft`)

func newOperation() -> FunctionConditionalOperation {
  FunctionConditionalOperation(
    if: FunctionConditionalOperationIf(comparator: .lessThanOrEqual, left: "", right: ""),
    otherwise: [], then: [FunctionSetOperation(expression: "", set: "")])
}

func emptyFunction() -> HostFunction {
  HostFunction(
    name: "", operations: [newOperation()], parameters: [HostFunctionParameter(name: "P1", required: true, type: .number)],
    returnValue: "", variables: [HostFunctionVariable(name: "P3", type: .number)])
}

extension HostFunction {
  /// The names a SET row and the return value may pick: the parameters' and variables' valid names.
  var assignableNames: [String] {
    ((parameters ?? []).compactMap(\.name) + (variables ?? []).compactMap(\.name)).filter(isVariableName)
  }
}

/// The definition a save writes: the name trimmed and cut to 60, every list present.
func functionSaveFields(_ definition: HostFunction) -> [String: Any] {
  var clean = definition
  clean.name = String((definition.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
  clean.parameters = definition.parameters ?? []
  clean.variables = definition.variables ?? []
  clean.operations = definition.operations ?? []
  clean.returnValue = definition.returnValue ?? ""
  guard let data = try? JSONEncoder().encode(clean), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
  return object
}

/// A function's stored definition as the evaluator runs it.
func runnableFunction(_ definition: HostFunction) -> HostFunctionDefinition { HostFunctionDefinition(functionSaveFields(definition)) }

// MARK: Writes

struct LogicAPI {
  let api: ConsoleAPIClient
  let writer: FirestoreWriter
  let reader: FirestoreReader
  let hostID: String

  /// A new variable or function through the quota-enforcing resources route.
  func create(_ resource: String, _ data: [String: Any]) async throws {
    try await api.request(
      "/api/hosts/resources", method: .post, body: JSONValue.from(["hostId": hostID, "resource": resource, "data": data]))
  }

  func saveVariable(id: String?, name: String, type: HostVariableType, value: String, workflowID: String, workflowName: String) async throws {
    let fields: [String: Any] = [
      "name": name, "type": type.rawValue, "value": value, "workflowId": workflowID.trimmingCharacters(in: .whitespaces),
      "workflowName": workflowName.trimmingCharacters(in: .whitespaces),
    ]
    if let id {
      try await change(variablesPath(hostID) + [id], fields.merging(["updatedAt": FirestoreSentinel.serverTimestamp]) { $1 })
    } else {
      try await create("variable", fields)
    }
  }

  func saveFunction(id: String?, definition: HostFunction) async throws {
    let fields = functionSaveFields(definition)
    if let id {
      try await change(functionsPath(hostID) + [id], fields.merging(["updatedAt": FirestoreSentinel.serverTimestamp]) { $1 })
    } else {
      try await create("function", fields)
    }
  }

  /// The cards' soft delete: the row stays, marked deleted, and leaves every list.
  func delete(_ path: [String]) async throws {
    try await change(path, ["deletedAt": FirestoreSentinel.serverTimestamp])
  }

  /// Where a variable or function is used, failing open as the console's client does.
  func whereUsed(kind: String, id: String, name: String) async -> WhereUsedResult {
    do {
      let answer = try await api.request(
        "/api/hosts/where-used", method: .post, body: JSONValue.from(["hostId": hostID, "kind": kind, "id": id, "name": name]))
      if let answer, let data = try? JSONEncoder().encode(answer), let result = try? JSONDecoder().decode(WhereUsedResult.self, from: data) {
        return result
      }
    } catch {}
    return WhereUsedResult(dependents: [], legacyCount: 0, total: 0)
  }

  /// A change a published page renders, as `writeSiteWideChange` makes it: the write, then the site's cache dropped.
  private func change(_ path: [String], _ fields: [String: Any]) async throws {
    try await writer.merge(path, fields)
    await publishSiteWideChange(api: api, reader: reader, hostID: hostID)
  }
}

/// A dependent's Besigner page, for a published page or layout the scan names.
func dependentBesignerPath(type: String?, id: String?, versionID: String?) -> String? {
  guard let id, !id.isEmpty, let versionID, !versionID.isEmpty else { return nil }
  switch type {
  case "screen": return "/screens/\(id)/versions/\(versionID)/besigner"
  case "layout": return "/layouts/\(id)/versions/\(versionID)/besigner"
  default: return nil
  }
}
