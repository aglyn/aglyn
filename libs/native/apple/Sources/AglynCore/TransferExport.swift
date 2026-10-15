// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * The platform's export, as every console export dialog makes it (the Kotlin
 * kit's `TransferApi`): the resource's fields (`POST /api/transfer/fields`),
 * then the file (`POST /api/transfer/export`) with the fields the person
 * picked, the records it covers, and the format.
 */

public struct TransferFieldInfo: Identifiable, Hashable, Sendable {
  public let id: String
  public let label: String
  public let group: String?
  public let description: String?
  /// Exported, never written from a file.
  public let readOnly: Bool
  /// Computed from other fields; exported, never written.
  public let derived: Bool
  /// Written by the platform (id, created, updated); exported, never written.
  public let system: Bool
  /// Defined by the organization rather than the resource.
  public let custom: Bool
  /// A new record cannot be created without it.
  public let required: Bool
  /// May be mapped on import to identify an existing record.
  public let matchKey: Bool
  /// Header spellings that mean this field, beside its label and id.
  public let aliases: [String]

  public init(
    id: String, label: String, group: String? = nil, description: String? = nil, readOnly: Bool = false,
    derived: Bool = false, system: Bool = false, custom: Bool = false, required: Bool = false, matchKey: Bool = false,
    aliases: [String] = []
  ) {
    self.id = id
    self.label = label
    self.group = group
    self.description = description
    self.readOnly = readOnly
    self.derived = derived
    self.system = system
    self.custom = custom
    self.required = required
    self.matchKey = matchKey
    self.aliases = aliases
  }

  /// Whether a file's cell may be written to the field (the console's `isTransferFieldWritable`).
  public var writable: Bool { !readOnly && !derived && !system }

  /// What kind of field it is, when it is not a plain one: how the console's picker labels it.
  public var kind: String? {
    if custom { return "Custom" }
    if system { return "System" }
    if derived { return "Computed" }
    if readOnly { return "Read-only" }
    return nil
  }

  /// A field from the fields route's answer (an entry without an id is left out).
  public static func decode(_ entry: JSONValue) -> TransferFieldInfo? {
    guard let id = entry["id"]?.stringValue else { return nil }
    func flag(_ key: String) -> Bool { entry[key]?.boolValue == true }
    return TransferFieldInfo(
      id: id, label: entry["label"]?.stringValue ?? id, group: entry["group"]?.stringValue,
      description: entry["description"]?.stringValue, readOnly: flag("readOnly"), derived: flag("derived"),
      system: flag("system"), custom: flag("custom"), required: flag("required"), matchKey: flag("matchKey"),
      aliases: entry["aliases"]?.arrayValue?.compactMap(\.stringValue) ?? [])
  }
}

public struct TransferFieldGroupInfo: Identifiable, Hashable, Sendable {
  public let id: String
  public let label: String

  public init(id: String, label: String) {
    self.id = id
    self.label = label
  }
}

/// A preset a person saved, or one the resource offers (listed after the built-in ones).
public struct TransferSavedPreset: Identifiable, Hashable, Sendable {
  public let id: String
  public let label: String
  public let fieldIDs: [String]
  /// One sentence beside the preset in the picker (a resource's preset).
  public let description: String?
  /// Field id → the CSV column name written instead of the field's label (a resource's preset for another product).
  public let headers: [String: String]

  public init(id: String, label: String, fieldIDs: [String], description: String? = nil, headers: [String: String] = [:]) {
    self.id = id
    self.label = label
    self.fieldIDs = fieldIDs
    self.description = description
    self.headers = headers
  }

  static func decode(_ entry: JSONValue) -> TransferSavedPreset? {
    guard let id = entry["id"]?.stringValue, !id.isEmpty, let label = entry["label"]?.stringValue else { return nil }
    var headers: [String: String] = [:]
    if case .object(let record)? = entry["headers"] { for (key, value) in record { if let name = value.stringValue { headers[key] = name } } }
    return TransferSavedPreset(
      id: id, label: label, fieldIDs: entry["fieldIds"]?.arrayValue?.compactMap(\.stringValue) ?? [],
      description: entry["description"]?.stringValue, headers: headers)
  }

  public var json: JSONValue { ["id": .string(id), "label": .string(label), "fieldIds": .array(fieldIDs.map(JSONValue.string))] }
}

/// What a resource says about its own presets (the console's `TransferPresetHints`).
public struct TransferPresetHints: Hashable, Sendable {
  /// The fields a re-import matches on (the id is always included).
  public let matchKeyFieldIDs: [String]
  /// Fields the minimal preset adds beyond the id, match keys and required ones.
  public let minimalFieldIDs: [String]

  public init(matchKeyFieldIDs: [String] = [], minimalFieldIDs: [String] = []) {
    self.matchKeyFieldIDs = matchKeyFieldIDs
    self.minimalFieldIDs = minimalFieldIDs
  }
}

/// The export choice a person made last, remembered per person and resource.
public struct TransferExportPrefs: Hashable, Sendable {
  /// A built-in preset id, a saved preset's id, or nil for a hand-picked list.
  public let presetID: String?
  public let fieldIDs: [String]
  public let format: TransferFormat
  public let bom: Bool
  /// `selection`, `filter` or `all`.
  public let scope: String

  public init(presetID: String?, fieldIDs: [String], format: TransferFormat, bom: Bool, scope: String) {
    self.presetID = presetID
    self.fieldIDs = fieldIDs
    self.format = format
    self.bom = bom
    self.scope = scope
  }

  static func decode(_ entry: JSONValue?) -> TransferExportPrefs? {
    guard let entry, let format = entry["format"]?.stringValue.flatMap(TransferFormat.init(rawValue:)) else { return nil }
    let scope = entry["scope"]?.stringValue
    return TransferExportPrefs(
      presetID: entry["presetId"]?.stringValue, fieldIDs: entry["fieldIds"]?.arrayValue?.compactMap(\.stringValue) ?? [],
      format: format, bom: entry["bom"]?.boolValue == true, scope: ["selection", "filter", "all"].contains(scope ?? "") ? scope ?? "all" : "all")
  }
}

public struct TransferFields: Hashable, Sendable {
  public let groups: [TransferFieldGroupInfo]
  public let fields: [TransferFieldInfo]
  /// The resource's label (`Contacts`), for a title and "All contacts".
  public let resourceLabel: String?
  /// The file formats the resource takes; a CSV when it names none.
  public let formats: [TransferFormat]
  /// A resource nothing is imported into: its fields are all read-only, so Re-importable is not offered.
  public let exportOnly: Bool
  public let presetHints: TransferPresetHints
  /// The resource's own presets, after the built-in ones.
  public let resourcePresets: [TransferSavedPreset]
  /// The person's saved presets for the resource, in the order they saved them.
  public let savedPresets: [TransferSavedPreset]
  /// The export choice the person made last.
  public let lastExport: TransferExportPrefs?

  public init(
    groups: [TransferFieldGroupInfo], fields: [TransferFieldInfo], resourceLabel: String? = nil,
    formats: [TransferFormat] = [.csv], exportOnly: Bool = false, presetHints: TransferPresetHints = TransferPresetHints(),
    resourcePresets: [TransferSavedPreset] = [], savedPresets: [TransferSavedPreset] = [], lastExport: TransferExportPrefs? = nil
  ) {
    self.groups = groups
    self.fields = fields
    self.resourceLabel = resourceLabel
    self.formats = formats.isEmpty ? [.csv] : formats
    self.exportOnly = exportOnly
    self.presetHints = presetHints
    self.resourcePresets = resourcePresets
    self.savedPresets = savedPresets
    self.lastExport = lastExport
  }

  /// The route's answer, keeping the entries that carry an id.
  public static func decode(_ answer: JSONValue?) -> TransferFields {
    func text(_ value: JSONValue?, _ key: String) -> String? { value?[key]?.stringValue }
    func list(_ key: String, in value: JSONValue? = answer) -> [JSONValue] {
      if case .array(let values)? = value?[key] { return values }
      return []
    }
    let resource = answer?["resource"]
    let hints = answer?["presetHints"]
    return TransferFields(
      groups: list("groups").compactMap { entry in
        text(entry, "id").map { TransferFieldGroupInfo(id: $0, label: text(entry, "label") ?? $0) }
      },
      fields: list("fields").compactMap(TransferFieldInfo.decode),
      resourceLabel: text(resource, "label"),
      formats: list("formats", in: resource).compactMap { $0.stringValue.flatMap(TransferFormat.init(rawValue:)) },
      exportOnly: resource?["exportOnly"]?.boolValue == true,
      presetHints: TransferPresetHints(
        matchKeyFieldIDs: hints?["matchKeyFieldIds"]?.arrayValue?.compactMap(\.stringValue) ?? [],
        minimalFieldIDs: hints?["minimalFieldIds"]?.arrayValue?.compactMap(\.stringValue) ?? []),
      resourcePresets: list("resourcePresets").compactMap(TransferSavedPreset.decode),
      savedPresets: list("presets", in: answer?["prefs"]).compactMap(TransferSavedPreset.decode),
      lastExport: TransferExportPrefs.decode(answer?["prefs"]?["export"]))
  }
}

/// The export file formats (`TransferFormat`).
public enum TransferFormat: String, CaseIterable, Identifiable, Sendable {
  case csv, json, ndjson

  public var id: String { rawValue }
  public var wire: String { rawValue }

  /// The words beside each format in the console's export dialog.
  public var label: String {
    switch self {
    case .csv: "CSV — opens in a spreadsheet"
    case .json: "JSON — one array of records"
    case .ndjson: "NDJSON — one record per line"
    }
  }

  public var mimeType: String {
    switch self {
    case .csv: "text/csv"
    case .json: "application/json"
    case .ndjson: "application/x-ndjson"
    }
  }
}

public struct TransferAPI: Sendable {
  let api: ConsoleAPIClient
  let orgID: String?

  public init(api: ConsoleAPIClient, orgID: String?) {
    self.api = api
    self.orgID = orgID
  }

  public func fieldsBody(resource: String, hostID: String?, filter: JSONValue?) -> JSONValue {
    .object([
      "orgId": orgID.map(JSONValue.string) ?? .null, "resource": .string(resource),
      "hostId": hostID.map(JSONValue.string) ?? .null, "filter": filter ?? .null,
    ])
  }

  /// The body the export route takes: `fieldIDs` in column order, over
  /// `scope` (`{kind: 'all'}`, `{kind: 'filter', filter}` or `{kind: 'selection', ids}`). `bom` starts a CSV with a
  /// byte-order mark (for Excel); `headers` are a resource preset's column names, sent for a CSV only.
  public func exportBody(
    resource: String, hostID: String?, fieldIDs: [String], scope: JSONValue, format: TransferFormat, bom: Bool = false,
    headers: [String: String] = [:]
  ) -> JSONValue {
    var body: [String: JSONValue] = [
      "orgId": orgID.map(JSONValue.string) ?? .null, "hostId": hostID.map(JSONValue.string) ?? .null,
      "resource": .string(resource), "fieldIds": .array(fieldIDs.map(JSONValue.string)), "scope": scope,
      "format": .string(format.wire), "bom": .bool(format == .csv && bom),
    ]
    if format == .csv, !headers.isEmpty { body["headers"] = .object(headers.mapValues(JSONValue.string)) }
    return .object(body)
  }

  public func fields(resource: String, hostID: String?, filter: JSONValue? = nil) async throws -> TransferFields {
    TransferFields.decode(
      try await api.request(
        "/api/transfer/fields", method: .post, body: fieldsBody(resource: resource, hostID: hostID, filter: filter)))
  }

  public func export(
    resource: String, hostID: String?, fieldIDs: [String], scope: JSONValue, format: TransferFormat, bom: Bool = false,
    headers: [String: String] = [:]
  ) async throws -> DownloadedFile {
    try await api.download(
      "/api/transfer/export",
      body: exportBody(resource: resource, hostID: hostID, fieldIDs: fieldIDs, scope: scope, format: format, bom: bom, headers: headers))
  }
}
