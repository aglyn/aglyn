// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * What a person has chosen in the export sheet, and how the sheet opens: the logic of the console's
 * `TransferExportDialog` apart from its drawing (the Kotlin kit's `TransferExportChoice` holds the same).
 */

/// One entry of the preset picker.
public struct TransferPresetOption: Identifiable, Hashable, Sendable {
  public let id: String
  public let label: String
  public let description: String

  public init(id: String, label: String, description: String) {
    self.id = id
    self.label = label
    self.description = description
  }
}

public struct TransferExportChoice: Equatable, Sendable {
  /// The preset id the field list came from: a built-in one, the resource's or a saved one, or `custom`.
  public var presetID: String
  /// The fields to export, in file order.
  public var fieldIDs: [String]
  /// Ids of a remembered choice that no longer exist, left out.
  public var unknown: [String]
  public var format: TransferFormat
  /// A CSV starts with a byte-order mark, for Excel.
  public var bom: Bool
  /// `selection`, `filter` or `all`.
  public var scope: String

  /// The preset id of a hand-picked list.
  public static let custom = "custom"

  public init(presetID: String, fieldIDs: [String], unknown: [String] = [], format: TransferFormat, bom: Bool, scope: String) {
    self.presetID = presetID
    self.fieldIDs = fieldIDs
    self.unknown = unknown
    self.format = format
    self.bom = bom
    self.scope = scope
  }

  /// How the sheet opens: on the resource's preset it was asked for, else the person's last choice, else Re-importable
  /// (Everything for a resource nothing is imported into, whose fields are all read-only).
  public static func opening(
    _ info: TransferFields, catalog: TransferFieldCatalog, selectionCount: Int = 0, hasFilter: Bool = false, preset: String? = nil
  ) -> TransferExportChoice {
    let last = info.lastExport
    let format = last.map { info.formats.contains($0.format) ? $0.format : info.formats[0] } ?? info.formats[0]
    let scope = selectionCount > 0 ? "selection" : hasFilter ? (last?.scope == "all" ? "all" : "filter") : "all"
    var choice = TransferExportChoice(
      presetID: TransferPreset.reimportable.rawValue, fieldIDs: [], format: format, bom: last?.bom ?? false, scope: scope)
    if let asked = preset.flatMap({ id in info.resourcePresets.first { $0.id == id } }) {
      choice.presetID = asked.id
      choice.fieldIDs = catalog.resolve(asked).fieldIDs
    } else if let last, !last.fieldIDs.isEmpty {
      let resolved = catalog.resolve(selection: last.fieldIDs)
      choice.presetID = last.presetID ?? custom
      choice.fieldIDs = resolved.fieldIDs
      choice.unknown = resolved.unknown
    } else {
      let first: TransferPreset = info.exportOnly ? .everything : .reimportable
      choice.presetID = first.rawValue
      choice.fieldIDs = catalog.resolve(first, hints: info.presetHints).fieldIDs
    }
    return choice
  }

  /// Picks a preset: the resource's or a saved one resolved against the catalog, or a built-in one; `custom` keeps the fields.
  public mutating func choose(
    preset id: String, catalog: TransferFieldCatalog, info: TransferFields, saved: [TransferSavedPreset]
  ) {
    presetID = id
    guard id != Self.custom else { return }
    let selection: TransferFieldSelection
    if let named = info.resourcePresets.first(where: { $0.id == id }) ?? saved.first(where: { $0.id == id }) {
      selection = catalog.resolve(named)
    } else if let builtIn = TransferPreset(rawValue: id) {
      selection = catalog.resolve(builtIn, hints: info.presetHints)
    } else {
      return
    }
    fieldIDs = selection.fieldIDs
    unknown = selection.unknown
  }

  /// A change to the fields after a preset is a hand-picked list.
  public mutating func pick(_ ids: [String]) {
    fieldIDs = ids
    presetID = Self.custom
    unknown = []
  }

  /// The column names a resource preset writes, while it is chosen as it stands (the moment a field changes, the columns are
  /// the fields' labels); only a CSV carries them.
  public func headers(_ info: TransferFields) -> [String: String] {
    guard format == .csv else { return [:] }
    return info.resourcePresets.first { $0.id == presetID }?.headers ?? [:]
  }

  /// What is remembered for the next export of the resource.
  public var prefs: TransferExportPrefs {
    TransferExportPrefs(presetID: presetID == Self.custom ? nil : presetID, fieldIDs: fieldIDs, format: format, bom: bom, scope: scope)
  }

  /// The preset picker's entries: the built-in ones (Re-importable only where a file can come back in), the resource's own,
  /// the person's saved ones, then a hand-picked list.
  public static func presetOptions(_ info: TransferFields, saved: [TransferSavedPreset], brand: String = AglynBrand.name) -> [TransferPresetOption] {
    func count(_ n: Int) -> String { "\(n.formatted()) \(n == 1 ? "field" : "fields")" }
    // The built-in presets in the console's order (Everything, Re-importable, Minimal), as the enum declares them.
    var options = TransferPreset.allCases.filter { $0 != .reimportable || !info.exportOnly }
      .map { TransferPresetOption(id: $0.rawValue, label: $0.label, description: $0.description(brand: brand)) }
    options += info.resourcePresets.map {
      TransferPresetOption(id: $0.id, label: $0.label, description: $0.description ?? count($0.fieldIDs.count))
    }
    options += saved.map { TransferPresetOption(id: $0.id, label: $0.label, description: count($0.fieldIDs.count)) }
    options.append(TransferPresetOption(id: custom, label: "Hand-picked", description: "The fields as you chose them below."))
    return options
  }

  /// A preset the person saved from the fields as they stand, ready to keep: nil without a name or any field.
  public func saving(as name: String, id: String) -> TransferSavedPreset? {
    let label = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120))
    guard !label.isEmpty, !fieldIDs.isEmpty else { return nil }
    return TransferSavedPreset(id: id, label: label, fieldIDs: fieldIDs)
  }
}

extension TransferExportPrefs {
  /// The document body the person's choice is remembered as, `users/{uid}/transferPrefs/{resource}`.
  public var json: JSONValue {
    [
      "presetId": presetID.map(JSONValue.string) ?? .null, "fieldIds": .array(fieldIDs.prefix(500).map(JSONValue.string)),
      "format": .string(format.wire), "bom": .bool(bom), "scope": .string(scope),
    ]
  }
}

extension JSONValue {
  /// The plain Foundation values a Firestore write takes (a null as `NSNull`).
  public var foundation: Any {
    switch self {
    case .null: NSNull()
    case .bool(let flag): flag
    case .number(let number): number == number.rounded() && abs(number) < 9e15 ? Int(number) as Any : number
    case .string(let text): text
    case .array(let items): items.map(\.foundation)
    case .object(let record): record.mapValues(\.foundation)
    }
  }
}
