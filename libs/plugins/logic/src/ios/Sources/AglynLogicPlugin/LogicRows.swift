// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

/*
 * The Logic page's no-code editors: a dictionary or list variable as rows, a
 * function step's formula built by picking, and a parameter's choices as rows
 * (AGL-3757, AGL-3768). Ports of the console's pure modules
 * (structured-value.ts, formula.ts, formula-names.ts, parameter-choice-rows.ts);
 * LogicTests replays their answers. What they write is the text the console
 * would have taken typed, so a stored value is unchanged. The Kotlin plugin's
 * LogicRows.kt.
 */

// MARK: Dictionary and list variables as rows

enum StructuredShape { case dictionary, collection }

enum StructuredKind: String, CaseIterable { case text, number, boolean, kept }

/// One entry; `kept` is a nested value the rows cannot edit, carried through untouched.
struct StructuredRow: Equatable, Identifiable {
  let id = UUID()
  var key: String
  var kind: StructuredKind
  var value: String
  var kept: OrderedJSON?

  init(key: String, kind: StructuredKind, value: String, kept: OrderedJSON? = nil) {
    self.key = key
    self.kind = kind
    self.value = value
    self.kept = kept
  }

  static func == (a: StructuredRow, b: StructuredRow) -> Bool {
    a.key == b.key && a.kind == b.kind && a.value == b.value && a.kept == b.kept
  }
}

struct ParsedStructuredValue {
  var rows: [StructuredRow]
  var unreadable: Bool
}

private func rowFor(_ key: String, _ value: OrderedJSON) -> StructuredRow {
  switch value {
  case .null: return StructuredRow(key: key, kind: .text, value: "")
  case .string(let text): return StructuredRow(key: key, kind: .text, value: text)
  case .bool(let flag): return StructuredRow(key: key, kind: .boolean, value: flag ? "true" : "false")
  case .number(let number) where number.isFinite: return StructuredRow(key: key, kind: .number, value: jsNumberString(number))
  default: return StructuredRow(key: key, kind: .kept, value: value.text, kept: value)
  }
}

/// The rows a stored dictionary or collection value reads as; `unreadable` when it is not that shape.
func parseStructuredValue(_ raw: String?, _ shape: StructuredShape) -> ParsedStructuredValue {
  let text = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty { return ParsedStructuredValue(rows: [], unreadable: false) }
  guard let parsed = OrderedJSON.parse(text) else { return ParsedStructuredValue(rows: [], unreadable: true) }
  switch (shape, parsed) {
  case (.collection, .array(let items)): return ParsedStructuredValue(rows: items.map { rowFor("", $0) }, unreadable: false)
  case (.dictionary, .object(let entries)): return ParsedStructuredValue(rows: entries.map { rowFor($0.key, $0.value) }, unreadable: false)
  default: return ParsedStructuredValue(rows: [], unreadable: true)
  }
}

/// One row's stored value as JSON text. A number box that does not hold a number stores nothing (null).
private func rowJSON(_ row: StructuredRow) -> String {
  switch row.kind {
  case .number:
    let text = row.value.trimmingCharacters(in: .whitespacesAndNewlines)
    if !text.isEmpty, let number = jsParseNumber(text), number.isFinite { return jsNumberString(number) }
    return "null"
  case .boolean: return row.value == "true" ? "true" : "false"
  case .kept: return (row.kept ?? .null).text
  case .text: return jsonQuoted(row.value)
  }
}

/// The JSON string rows store as. A dictionary drops rows without a key and keeps the LAST row of a repeated key.
func serializeStructuredValue(_ rows: [StructuredRow], _ shape: StructuredShape) -> String {
  if shape == .collection { return "[" + rows.map(rowJSON).joined(separator: ",") + "]" }
  var keys: [String] = []
  var entries: [String: String] = [:]
  for row in rows {
    let key = row.key.trimmingCharacters(in: .whitespacesAndNewlines)
    if key.isEmpty { continue }
    if entries[key] == nil { keys.append(key) }
    entries[key] = rowJSON(row)
  }
  return "{" + jsKeyOrder(keys).map { jsonQuoted($0) + ":" + (entries[$0] ?? "null") }.joined(separator: ",") + "}"
}

/// The dictionary keys used more than once, which the editor flags.
func duplicateStructuredKeys(_ rows: [StructuredRow]) -> Set<String> {
  var seen = Set<String>()
  var duplicates = Set<String>()
  for row in rows {
    let key = row.key.trimmingCharacters(in: .whitespacesAndNewlines)
    if key.isEmpty { continue }
    if !seen.insert(key).inserted { duplicates.insert(key) }
  }
  return duplicates
}

// MARK: A formula built by picking

enum FormulaOperation: String, CaseIterable {
  case value, add, subtract, multiply, divide, min, max, round, roundDown, roundUp, absolute, currency, number, join

  var label: String {
    switch self {
    case .value: "Use a value"
    case .add: "Add"
    case .subtract: "Subtract"
    case .multiply: "Multiply"
    case .divide: "Divide"
    case .min: "Smallest of"
    case .max: "Largest of"
    case .round: "Round"
    case .roundDown: "Round down"
    case .roundUp: "Round up"
    case .absolute: "Without its minus sign"
    case .currency: "Format as money"
    case .number: "Format with thousands separators"
    case .join: "Join text"
    }
  }

  /// How many values it takes at least.
  var minOperands: Int {
    switch self {
    case .value, .round, .roundDown, .roundUp, .absolute, .currency, .number: 1
    default: 2
    }
  }

  var variadic: Bool { [.add, .multiply, .min, .max, .join].contains(self) }

  /// What each value box is called, in order; the last repeats.
  var operandLabels: [String] {
    switch self {
    case .add: ["Value", "Plus"]
    case .subtract: ["Value", "Minus"]
    case .multiply: ["Value", "Times"]
    case .divide: ["Value", "Divided by"]
    case .min, .max: ["Value", "Or"]
    case .currency: ["Amount"]
    case .number: ["Number"]
    case .join: ["Text", "Then"]
    default: ["Value"]
    }
  }

  var hasPlaces: Bool { [.round, .currency, .number].contains(self) }
}

/// One value an operation works on.
enum FormulaOperand: Equatable {
  /// A parameter, a local variable, a site variable or a dictionary member.
  case name(String)
  case number(String)
  case text(String)
  /// Whatever the box holds already, so formulas can be layered.
  case current

  var source: String {
    switch self {
    case .name: "name"
    case .number: "number"
    case .text: "text"
    case .current: "current"
    }
  }
}

struct FormulaDraft: Equatable {
  var operation: FormulaOperation
  var operands: [FormulaOperand]
  /// Decimal places for round, currency and number.
  var places: Int?
  /// The sign written before a currency amount.
  var symbol: String?
  /// What goes between joined texts.
  var separator: String?

  init(operation: FormulaOperation, operands: [FormulaOperand], places: Int? = nil, symbol: String? = nil, separator: String? = nil) {
    self.operation = operation
    self.operands = operands
    self.places = places
    self.symbol = symbol
    self.separator = separator
  }
}

/// The label for a value box at `index` of `operation`; the last label repeats.
func formulaOperandLabel(_ operation: FormulaOperation, _ index: Int) -> String {
  let labels = operation.operandLabels
  return labels[min(index, labels.count - 1)]
}

/// A text as the evaluator reads it. Its strings have no escapes, so the quote the text does not contain is used.
private func quoteText(_ value: String) -> String {
  if !value.contains("'") { return "'\(value)'" }
  if !value.contains("\"") { return "\"\(value)\"" }
  return "'\(value.replacingOccurrences(of: "\"", with: ""))'"
}

private func isSimpleExpression(_ text: String) -> Bool {
  text.range(of: #"^\s*(?:-?[0-9]*\.?[0-9]+|[a-zA-Z_][a-zA-Z0-9_.]*)\s*$"#, options: .regularExpression) != nil
}

/// One operand as expression text, or nil while it is still blank. `bare` is a built-in's argument.
private func operandText(_ operand: FormulaOperand, _ current: String, bare: Bool) -> String? {
  switch operand {
  case .name(let name): return name.isEmpty ? nil : name
  case .number(let value):
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { return nil }
    guard let parsed = jsParseNumber(text), parsed.isFinite else { return nil }
    return jsNumberString(parsed)
  case .text(let value): return quoteText(value)
  case .current:
    let text = current.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { return nil }
    return bare || isSimpleExpression(text) ? text : "(\(text))"
  }
}

private func placesOf(_ draft: FormulaDraft, _ fallback: Int) -> Int {
  if let places = draft.places, (0...6).contains(places) { return places }
  return fallback
}

/// The expression a draft writes, or nil while a value it needs is blank. `current` is what the box held when the builder opened.
func buildFormula(_ draft: FormulaDraft, current: String = "") -> String? {
  let operation = draft.operation
  let operands = Array(draft.operands.prefix(operation.variadic ? draft.operands.count : operation.minOperands))
  if operands.count < operation.minOperands { return nil }
  let arithmetic: [FormulaOperation] = [.add, .subtract, .multiply, .divide, .join]
  var values: [String] = []
  for operand in operands {
    guard let text = operandText(operand, current, bare: !arithmetic.contains(operation) && operation != .value) else { return nil }
    values.append(text)
  }
  let first = values[0]
  switch operation {
  case .value: return first
  case .add: return values.joined(separator: " + ")
  case .subtract: return values.joined(separator: " - ")
  case .multiply: return values.joined(separator: " * ")
  case .divide: return values.joined(separator: " / ")
  case .min: return "min(\(values.joined(separator: ", ")))"
  case .max: return "max(\(values.joined(separator: ", ")))"
  case .round: return "round(\(first), \(placesOf(draft, 0)))"
  case .roundDown: return "floor(\(first))"
  case .roundUp: return "ceil(\(first))"
  case .absolute: return "abs(\(first))"
  case .currency: return "\(quoteText(draft.symbol ?? "$")) + format(\(first), \(placesOf(draft, 2)))"
  case .number: return "format(\(first), \(placesOf(draft, 0)))"
  case .join:
    // A leading '' keeps two numbers joined as text rather than added.
    let separator = draft.separator ?? " "
    return separator.isEmpty ? (["''"] + values).joined(separator: " + ") : values.joined(separator: " + \(quoteText(separator)) + ")
  }
}

/// A fresh draft for `operation`, carrying over the values already chosen.
func formulaDraftFor(_ operation: FormulaOperation, previous: FormulaDraft? = nil, current: String = "") -> FormulaDraft {
  func blank(_ index: Int) -> FormulaOperand {
    if index == 0, !current.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .current }
    return operation == .join ? .text("") : .name("")
  }
  let operands = (0..<operation.minOperands).map { index in
    previous.flatMap { index < $0.operands.count ? $0.operands[index] : nil } ?? blank(index)
  }
  return FormulaDraft(operation: operation, operands: operands, places: previous?.places, symbol: previous?.symbol, separator: previous?.separator)
}

// MARK: The names a formula can read

/// A name a formula can read, grouped the way the picker lists it.
struct FormulaName: Equatable, Hashable {
  let value: String
  let label: String
  let group: String
}

/// A site variable as the picker and a test run read one.
struct SiteVariableName: Equatable {
  var name: String?
  var type: String?
  var value: String?
}

/// `localeCompare` for identifiers: punctuation before digits before letters, letters ignoring case (lower first on a tie).
private func identifierOrder(_ a: String, _ b: String) -> Bool {
  func rank(_ c: Character) -> Int { c == "_" ? 0 : (c.isNumber ? 1 : 2) }
  let x = Array(a)
  let y = Array(b)
  for index in 0..<min(x.count, y.count) where x[index] != y[index] {
    let byClass = rank(x[index]) - rank(y[index])
    if byClass != 0 { return byClass < 0 }
    let l = x[index].lowercased()
    let r = y[index].lowercased()
    if l != r { return l < r }
  }
  if x.count != y.count { return x.count < y.count }
  for index in x.indices where x[index] != y[index] { return x[index].isLowercase }
  return false
}

private func isValidName(_ name: String) -> Bool { isVariableName(name) }

/// Everything a function's formula can read, in the order the evaluator resolves a clash: its parameters, its own
/// variables, then the site's variables, each dictionary's members listed under it as `name.member`.
func formulaNames(parameters: [String], locals: [String], siteVariables: [SiteVariableName]) -> [FormulaName] {
  var names: [FormulaName] = []
  var seen = Set<String>()
  func push(_ value: String, _ label: String, _ group: String) {
    if seen.insert(value).inserted { names.append(FormulaName(value: value, label: label, group: group)) }
  }
  for name in parameters where isValidName(name) { push(name, name, "Parameters") }
  for name in locals where isValidName(name) { push(name, name, "This function’s variables") }
  for variable in siteVariables.enumerated().sorted(by: { l, r in
    let a = l.element.name ?? ""
    let b = r.element.name ?? ""
    return a == b ? l.offset < r.offset : identifierOrder(a, b)
  }).map(\.element) {
    let name = variable.name ?? ""
    guard isValidName(name) else { continue }
    if variable.type == "collection" { continue }
    if variable.type != "dictionary" {
      push(name, name, "Site variables")
      continue
    }
    guard let parsed = OrderedJSON.parse(variable.value ?? ""), case .object(let entries) = parsed else { continue }
    for entry in entries {
      guard isValidName(entry.key) else { continue }
      switch entry.value {
      case .number, .string, .bool: push("\(name).\(entry.key)", "\(name) → \(entry.key)", "Site variables")
      default: continue
      }
    }
  }
  return names
}

// MARK: A parameter's choices as rows

/// One row of the choices editor, blanks and all, as the author sees it.
struct ParameterChoiceRow: Equatable, Identifiable {
  let id = UUID()
  var value: String
  var label: String

  init(value: String, label: String) {
    self.value = value
    self.label = label
  }

  static func == (a: ParameterChoiceRow, b: ParameterChoiceRow) -> Bool { a.value == b.value && a.label == b.label }
}

func choiceRowsFromOptions(_ options: [HostFunctionParameterOption]?) -> [ParameterChoiceRow] {
  (options ?? []).map { ParameterChoiceRow(value: $0.value, label: $0.label ?? "") }
}

/// The choice list rows store as (AGL-3768). A row with no value is not a choice yet; the second row of a value is
/// dropped; a label equal to its value is not stored.
func optionsFromChoiceRows(_ rows: [ParameterChoiceRow]) -> [HostFunctionParameterOption] {
  var options: [HostFunctionParameterOption] = []
  var seen = Set<String>()
  for row in rows {
    let value = row.value.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.isEmpty || !seen.insert(value).inserted { continue }
    let label = row.label.trimmingCharacters(in: .whitespacesAndNewlines)
    options.append(!label.isEmpty && label != value ? HostFunctionParameterOption(label: label, value: value) : HostFunctionParameterOption(value: value))
  }
  return options
}

// MARK: A test run's view of the site

/// The OUTSIDE names a function reads: every identifier in its conditions and expressions that is not its own parameter or local.
func functionReferencedNames(_ definition: HostFunction) -> [String] {
  let own = Set(((definition.parameters ?? []).compactMap(\.name)) + ((definition.variables ?? []).compactMap(\.name)))
  var names: [String] = []
  var seen = Set<String>()
  func read(_ text: String?) {
    for name in expressionIdentifiers(text) where !own.contains(name) && seen.insert(name).inserted { names.append(name) }
  }
  for operation in definition.operations ?? [] {
    read(operation.if?.left)
    read(operation.if?.right)
    for set in (operation.then ?? []) + (operation.otherwise ?? []) { read(set.expression) }
  }
  return names
}

/// The site variables ONE function reads, by name, typed as the evaluator reads them: a number as a number, a true/false as a
/// boolean, anything else as its text (a dictionary stays its JSON, read by `name.member`).
func functionGlobals(_ definition: HostFunction, _ variables: [SiteVariableName]) -> SiteScope {
  var scope: SiteScope = [:]
  for variable in variables {
    guard let name = variable.name, !name.isEmpty else { continue }
    switch variable.type {
    case "number":
      let text = (variable.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      scope[name] = .number(text.isEmpty ? 0 : (jsParseNumber(text) ?? .nan))
    case "boolean": scope[name] = .bool(variable.value == "true")
    default: scope[name] = .text(variable.value ?? "")
    }
  }
  var globals: SiteScope = [:]
  for name in functionReferencedNames(definition) {
    if let value = scope[name] { globals[name] = value }
  }
  return globals
}
