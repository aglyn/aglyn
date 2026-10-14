// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import Foundation

/*
 * The records table is one query (AGL-3321), planned exactly as the console
 * plans it: `datasetRecordFilter` turns a model into a list declaration over
 * the records' `filterValues` and `filterKeys`, and `planDatasetRecordQuery`
 * (libs/plugins/data/src/lib/components/dataset-record-filter.ts) puts the
 * clauses and the search word on it through the shared planner. The Kotlin
 * plugin's RecordQuery.kt, ported once; DataTests replays the console's plans.
 */

private var prefixMax: Int { ContractValues.shared.datasetFilterPrefixMax }
private let valueMax = 64
private let wordsMax = 40
private let tokensPath = "filterKeys"

/// The grid column a field is shown in (`recordColumn`).
public func recordColumn(_ fieldID: String) -> String { "values.\(fieldID)" }

private func fieldID(of column: String) -> String { column.hasPrefix("values.") ? String(column.dropFirst(7)) : column }

private func clip(_ text: String, _ max: Int) -> String {
  String(String.UnicodeScalarView(text.unicodeScalars.prefix(max)))
}

private func scalarCount(_ text: String) -> Int { text.unicodeScalars.count }

/// A text value's words: lower-cased, split on non-letters/digits, the first 40 (`datasetFilterWords`).
public func datasetFilterWords(_ text: String) -> [String] {
  let spaced = text.lowercased().replacingOccurrences(of: "[^\\p{L}\\p{N}]+", with: " ", options: .regularExpression)
  return Array(spaced.split(separator: " ").map(String.init).prefix(wordsMax))
}

/// Plain text as its stored key (`datasetFilterTextKey`).
public func datasetFilterTextKey(_ value: String) -> String { clip(jsTrim(value).lowercased(), valueMax) }

/// The quick-search token for a word, or nil (`datasetSearchToken`).
public func datasetSearchToken(_ word: String) -> String? {
  datasetFilterWords(word).first.map { "s:" + clip($0, prefixMax) }
}

/// The `filterValues.<id>` path, or nil for an id no path can name (`datasetFilterValuePath`).
public func datasetFilterValuePath(_ fieldID: String) -> String? {
  let usable = fieldID.range(of: "^[^.~*/\\[\\]`]+$", options: .regularExpression) != nil
  let dunder = fieldID.range(of: "^__.*__$", options: .regularExpression) != nil
  return usable && !dunder ? "filterValues.\(fieldID)" : nil
}

private func isEnum(_ field: DatasetFieldDefinition) -> Bool { field.type == .text && !(field.validation?.options ?? []).isEmpty }

private func isNumeric(_ field: DatasetFieldDefinition) -> Bool { field.type == .int32 || field.type == .int64 || field.type == .float }

private func numberKey(_ value: String) -> String? {
  let trimmed = jsTrim(value)
  if trimmed.isEmpty { return nil }
  // A JS numeric literal: Swift's `Double` also reads "nan", "inf" and hex floats.
  guard trimmed.range(of: #"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$"#, options: .regularExpression) != nil,
    let number = Double(trimmed), number.isFinite
  else { return nil }
  return jsNumber(number)
}

private func boolKey(_ value: String) -> String? { value == "true" || value == "false" ? value : nil }

/// The `filterKeys` token a word-level clause asks for, or nil (`datasetFilterToken`).
public func datasetFilterToken(_ model: DatasetModel, fieldId: String, op: String, value: String) -> String? {
  guard let field = model.fields?[fieldId], !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
  let equals = op == "equals" || op == "=" || op == "is"
  if field.type == .text && isEnum(field) { return equals ? "f:\(fieldId)=\(value)" : nil }
  if field.type == .text {
    if equals { return "f:\(fieldId)=\(datasetFilterTextKey(value))" }
    if op == "contains" { return datasetFilterWords(value).first.map { "f:\(fieldId)^\(clip($0, prefixMax))" } }
    return nil
  }
  if field.type == .bool { return equals ? boolKey(jsTrim(value)).map { "f:\(fieldId)=\($0)" } : nil }
  if isNumeric(field) { return equals ? numberKey(value).map { "f:\(fieldId)=\($0)" } : nil }
  if field.type == .sorted { return (equals || op == "contains") ? "f:\(fieldId)=\(jsTrim(value))" : nil }
  return nil
}

/// How the records' filter fields were normalized, so the planner asks for what was stored.
public struct DatasetRecordNormalizers: ListQueryNormalizers {
  public init() {}
  public func key(_ value: String) -> String { datasetFilterTextKey(value) }
  public func token(_ value: String) -> String { datasetSearchToken(value) ?? "" }
  public func reversed(_ value: String) -> String { value }
  public var maxPrefix: Int { prefixMax }
}

/// What the records list offers for one model (`DatasetRecordFilter`).
public struct DatasetRecordFilter {
  public let declaration: ListQueryDeclaration
  public let options: [String: [FilterChoice]]
  public let headers: [String: String]
  public let selectFields: [String]
  public var fields: [ListFilterField] { declaration.fields }
}

private let booleanOptions = [FilterChoice("true", "True"), FilterChoice("false", "False")]

/// The model's fields as query fields (`datasetRecordFilter`).
public func datasetRecordFilter(_ model: DatasetModel) -> DatasetRecordFilter {
  var fields: [ListFilterField] = []
  var options: [String: [FilterChoice]] = [:]
  var headers: [String: String] = [:]
  var selectFields: [String] = []
  for id in model.order ?? [] {
    guard let field = model.fields?[id] else { continue }
    let column = recordColumn(id)
    let valuePath = datasetFilterValuePath(id)
    let choices = field.type == .text ? (field.validation?.options ?? []) : []
    var declared: ListFilterField?
    if field.type == .text && !choices.isEmpty {
      if let valuePath {
        options[column] = choices.map { FilterChoice($0, $0) }
        declared = ListFilterField(column: column, kind: .exact, operators: ["equals", "isAnyOf"], path: valuePath)
      }
    } else if field.type == .text {
      declared = ListFilterField(
        column: column, kind: .text, lowerPath: valuePath, operators: valuePath != nil ? ["contains", "equals", "isAnyOf"] : ["contains"],
        path: valuePath ?? column, tokensPath: tokensPath, verbatimTokens: true)
    } else if field.type == .bool {
      if let valuePath {
        options[column] = booleanOptions
        declared = ListFilterField(column: column, kind: .boolean, operators: ["equals"], path: valuePath)
      }
    } else if isNumeric(field) {
      if let valuePath { declared = ListFilterField(column: column, kind: .number, operators: ["="], path: valuePath) }
    } else if field.type == .sorted {
      declared = ListFilterField(
        column: column, kind: .text, operators: ["contains"], path: column, tokensPath: tokensPath, verbatimTokens: true)
    }
    guard let declared else { continue }
    fields.append(declared)
    headers[column] = (field.name.flatMap { $0.isEmpty ? nil : $0 }) ?? id
    if options[column] != nil { selectFields.append(column) }
  }
  return DatasetRecordFilter(
    declaration: ListQueryDeclaration(
      fields: fields, search: ListQueryDeclarationSearch(tokensPath: tokensPath),
      sorts: [ListQuerySort(direction: .asc, path: ContractValues.shared.listQueryIdPath)]),
    options: options, headers: headers, selectFields: selectFields)
}

/// The records query and what it says to the reader (`DatasetRecordPlan`).
public struct DatasetRecordPlan {
  public let plan: ListQueryPlan
  public let refused: [FilterRefusal]
  public let notices: [String]
  public let filter: DatasetRecordFilter
}

private func json(_ clause: ListFilterRequest) -> ContractJSON {
  .object(["field": .string(clause.field), "op": .string(clause.op), "value": .string(clause.value)])
}

/// The clauses and search words as one records query (`planDatasetRecordQuery`).
public func planDatasetRecordQuery(_ model: DatasetModel, clauses: [ListFilterRequest], searchWords: [String]) -> DatasetRecordPlan {
  let filter = datasetRecordFilter(model)
  let queryClauses = clauses.map { clause -> ListFilterRequest in
    guard clause.op == "contains" else { return clause }
    return ListFilterRequest(
      field: clause.field, op: clause.op,
      value: datasetFilterToken(model, fieldId: fieldID(of: clause.field), op: "contains", value: clause.value) ?? "")
  }
  let plan = planListQuery(
    filter.declaration, ListQueryRequest(clauses: queryClauses, search: searchWords), names: DatasetRecordNormalizers())
  let refused = plan.refused.map { entry -> FilterRefusal in
    let at = queryClauses.firstIndex { json($0) == entry.clause }
    return FilterRefusal(clause: at.map { clauses[$0] }, reason: entry.reason)
  }
  var notices: [String] = []
  func oneWord(_ label: String, _ text: String) {
    let words = datasetFilterWords(text)
    if words.count > 1 {
      notices.append("\(label) matches one word at a time: showing records with a word starting \"\(clip(words[0], prefixMax))\".")
    }
    if words.contains(where: { scalarCount($0) > prefixMax }) {
      notices.append("\(label) reads the first \(prefixMax) letters of a word.")
    }
  }
  if plan.searched != nil { oneWord("Search", searchWords.joined(separator: " ")) }
  var used = Set<Int>()
  for served in plan.served {
    guard let at = queryClauses.indices.first(where: { !used.contains($0) && queryClauses[$0] == served }) else { continue }
    used.insert(at)
    let clause = clauses[at]
    if clause.op != "contains" { continue }
    if model.fields?[fieldID(of: clause.field)]?.type != .text { continue }
    oneWord("\(filter.headers[clause.field] ?? clause.field) contains", clause.value)
  }
  return DatasetRecordPlan(plan: plan, refused: refused, notices: notices, filter: filter)
}
