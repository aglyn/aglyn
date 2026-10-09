// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynPluginHost
import Foundation

/*
 * The dataset model's pure half (libs/plugins/data/src/lib/model/
 * dataset-model-core.ts), the Kotlin plugin's DatasetModelCore.kt line for
 * line: the v1 shim, a stored value as the records table shows it and as its
 * input reads, and the field-id rules. DataTests replays the console's own
 * answers for every function here.
 *
 * Stored values are what the Firestore reader hands over: String, NSNumber,
 * Bool, NSNull, Date, arrays and dictionaries.
 */

// JavaScript's `\s`, which a `String.trim()` and the slug's dash rule mean.
private let jsSpace = "\t\n\u{0B}\u{0C}\r \u{A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}"
private let jsSpaceSet: CharacterSet = {
  var set = CharacterSet(charactersIn: "\t\n\u{0B}\u{0C}\r \u{A0}\u{1680}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
  set.insert(charactersIn: Unicode.Scalar(0x2000)!...Unicode.Scalar(0x200A)!)
  return set
}()

func jsTrim(_ text: String) -> String { text.trimmingCharacters(in: jsSpaceSet) }

/// "roast_preference" → "Roast preference" (`humanizeDatasetFieldId`).
public func humanizeDatasetFieldId(_ id: String) -> String {
  let words = jsTrim(id.replacingOccurrences(of: "_", with: " "))
  guard let first = words.first else { return id }
  return first.uppercased() + words.dropFirst()
}

/// The v1 shim: every flat column a text field (`deriveModelFromFields`).
public func deriveModelFromFields(_ fields: [String]) -> DatasetModel {
  var definitions: [String: DatasetFieldDefinition] = [:]
  for id in fields { definitions[id] = DatasetFieldDefinition(name: humanizeDatasetFieldId(id), type: .text) }
  return DatasetModel(fields: definitions, order: fields)
}

/// A model from quick-creator entries, every field text (`modelFromFieldEntries`).
public func modelFromFieldEntries(_ entries: [DatasetFieldEntry]) -> DatasetModel {
  var definitions: [String: DatasetFieldDefinition] = [:]
  for entry in entries { definitions[entry.id] = DatasetFieldDefinition(name: entry.name, type: .text) }
  return DatasetModel(fields: definitions, order: entries.map(\.id))
}

/// A plain Firestore value as a contract JSON value; a date as its milliseconds.
func contractJSON(of value: Any?) -> ContractJSON {
  guard let value, !(value is NSNull) else { return .null }
  switch value {
  case let text as String: return .string(text)
  case let number as NSNumber:
    return CFGetTypeID(number) == CFBooleanGetTypeID() ? .bool(number.boolValue) : .number(number.doubleValue)
  case let date as Date: return .number((date.timeIntervalSince1970 * 1000).rounded())
  case let list as [Any]: return .array(list.map { contractJSON(of: $0) })
  case let map as [String: Any]: return .object(map.mapValues { contractJSON(of: $0) })
  default: return .string("\(value)")
  }
}

/// A contract JSON value as plain Foundation values.
func plain(_ json: ContractJSON?) -> Any? {
  switch json {
  case nil, .null?: return nil
  case .bool(let value)?: return value
  case .number(let value)?: return value
  case .string(let value)?: return value
  case .array(let list)?: return list.map { plain($0) ?? NSNull() }
  case .object(let map)?: return map.mapValues { plain($0) ?? NSNull() }
  }
}

/// The stored `model`, decoded; nil when the document holds none (or a shape no model has).
public func decodeDatasetModel(_ raw: Any?) -> DatasetModel? {
  guard let map = raw as? [String: Any], let data = try? JSONEncoder().encode(contractJSON(of: map)) else { return nil }
  return try? JSONDecoder().decode(DatasetModel.self, from: data)
}

/// The dataset's model, deriving one from v1 `fields` when absent (`effectiveDatasetModel`).
public func effectiveDatasetModel(_ data: [String: Any]) -> DatasetModel {
  if let model = decodeDatasetModel(data["model"]), model.fields != nil, !(model.order ?? []).isEmpty { return model }
  return deriveModelFromFields((data["fields"] as? [Any])?.compactMap { $0 as? String } ?? [])
}

extension DatasetModel {
  /// A model's fields in display order, each with its id; a missing definition is skipped.
  public var orderedFields: [(id: String, field: DatasetFieldDefinition)] {
    (order ?? []).compactMap { id in fields?[id].map { (id, $0) } }
  }
}

extension DatasetFieldDefinition {
  /// The name a field is shown under: its name, else its id.
  public func label(_ id: String) -> String {
    if let name, !name.isEmpty { return name }
    return id
  }
}

/// A stored number (a boolean is not one).
func finiteNumber(_ value: Any?) -> Double? {
  guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
  let double = number.doubleValue
  return double.isFinite ? double : nil
}

private func isBool(_ value: Any?) -> Bool? {
  guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
  return number.boolValue
}

/// A stored value as a grid cell (`formatDatasetValue`).
public func formatDatasetValue(_ field: DatasetFieldDefinition, _ value: Any?) -> String {
  guard let value, !(value is NSNull) else { return "" }
  if let text = value as? String, text.isEmpty { return "" }
  switch field.type {
  case .bool:
    switch isBool(value) {
    case true?: return "✓"
    case false?: return "—"
    case nil: return jsString(value)
    }
  case .timestamp:
    if let millis = finiteNumber(value) { return utcMinute(Int64(millis)).replacingOccurrences(of: "T", with: " ") }
    return jsString(value)
  case .coordinates:
    let map = value as? [String: Any]
    if let latitude = finiteNumber(map?["latitude"]), let longitude = finiteNumber(map?["longitude"]) {
      return "\(jsNumber(latitude)), \(jsNumber(longitude))"
    }
    return jsString(value)
  case .sorted:
    if let list = value as? [Any] { return list.map { $0 is NSNull ? "" : jsString($0) }.joined(separator: ", ") }
    return jsString(value)
  case .map: return jsonStringify(value)
  default: return jsString(value)
  }
}

/// A stored value as its input's text (`datasetValueToInput`); timestamps as `YYYY-MM-DDTHH:mm` in UTC.
public func datasetValueToInput(_ field: DatasetFieldDefinition, _ value: Any?) -> String {
  guard let value, !(value is NSNull) else { return "" }
  if field.type == .timestamp, let millis = finiteNumber(value) { return utcMinute(Int64(millis)) }
  if field.type == .bool {
    switch isBool(value) {
    case true?: return "true"
    case false?: return "false"
    case nil: return jsString(value)
    }
  }
  if field.type == .coordinates || field.type == .sorted || field.type == .map { return formatDatasetValue(field, value) }
  return jsString(value)
}

private func isFieldID(_ text: String) -> Bool { text.range(of: "^[A-Za-z][A-Za-z0-9_]*$", options: .regularExpression) != nil }

/// "Roast preference" → "roast_preference"; '' when nothing salvageable (`slugifyDatasetFieldId`).
public func slugifyDatasetFieldId(_ name: String) -> String {
  var slug = jsTrim(name).lowercased()
  slug = slug.replacingOccurrences(of: "[\(jsSpace)-]+", with: "_", options: .regularExpression)
  slug = slug.replacingOccurrences(of: "[^a-z0-9_]", with: "", options: .regularExpression)
  slug = slug.replacingOccurrences(of: "^[0-9_]+", with: "", options: .regularExpression)
  slug = slug.replacingOccurrences(of: "_+$", with: "", options: .regularExpression)
  return isFieldID(slug) ? slug : ""
}

/// A new field's id: the slug, suffixed `_2`, `_3`… to stay unique (`defaultDatasetFieldId`).
public func defaultDatasetFieldId(_ name: String, taken: [String]) -> String {
  let base = slugifyDatasetFieldId(name)
  if base.isEmpty { return "" }
  let used = Set(taken.map { $0.lowercased() })
  var candidate = base
  var suffix = 2
  while used.contains(candidate.lowercased()) {
    candidate = "\(base)_\(suffix)"
    suffix += 1
  }
  return candidate
}

/// A typed reference id's problem, or nil when it is usable (`validateDatasetFieldId`).
public func validateDatasetFieldId(_ id: String, taken: [String]) -> String? {
  let trimmed = jsTrim(id)
  if trimmed.isEmpty { return "A reference ID is required" }
  if !isFieldID(trimmed) { return "Start with a letter; use only letters, numbers, and underscores" }
  if taken.map({ $0.lowercased() }).contains(trimmed.lowercased()) { return "Another field already uses this reference ID" }
  return nil
}

/// Comma- or line-separated human names as `{id, name}` entries (`parseDatasetFieldEntries`).
public func parseDatasetFieldEntries(_ input: String) -> [DatasetFieldEntry] {
  var seen = Set<String>()
  var entries: [DatasetFieldEntry] = []
  for raw in input.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "," || $0 == "\n" }) {
    let trimmed = jsTrim(String(raw))
    if trimmed.isEmpty { continue }
    let id = slugifyDatasetFieldId(trimmed)
    if id.isEmpty || !seen.insert(id).inserted { continue }
    entries.append(DatasetFieldEntry(id: id, name: isFieldID(trimmed) ? humanizeDatasetFieldId(trimmed) : trimmed))
  }
  return entries
}

/// The name a dataset is shown under: `displayName`, then the pre-migration `name` (`datasetDisplayName`).
public func datasetDisplayName(_ data: [String: Any]?) -> String {
  for key in ["displayName", "name"] {
    if let candidate = data?[key] as? String, !jsTrim(candidate).isEmpty { return jsTrim(candidate) }
  }
  return ""
}
