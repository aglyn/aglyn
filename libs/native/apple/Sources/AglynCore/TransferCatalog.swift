// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * A resource's fields in the order a person picks them, and the presets that fill the picker: the port of the
 * console's `field-catalog.ts` (`buildTransferFieldCatalog`, `groupTransferFields`, `searchTransferFields`,
 * `resolveTransferFieldSelection`, `resolveTransferPreset`, `moveTransferField`), replayed from
 * `libs/native/contracts/transfer-catalog-cases.json` (the Kotlin kit holds the same port).
 */

/// The field id every resource uses for the record's Aglyn id.
public let transferIDField = "id"

/// The built-in presets.
public enum TransferPreset: String, CaseIterable, Identifiable, Sendable {
  /// Every field, in catalog order.
  case everything
  /// The default for an export: the Aglyn id, the match keys and every writable field, so the file comes back in.
  case reimportable
  /// The id, the match keys, the required fields and whatever short list the resource names as its minimum.
  case minimal

  public var id: String { rawValue }

  public var label: String {
    switch self {
    case .everything: "Everything"
    case .reimportable: "Re-importable"
    case .minimal: "Minimal"
    }
  }

  public func description(brand: String = AglynBrand.name) -> String {
    switch self {
    case .reimportable: "The \(brand) ID, the match keys and every field an import can write."
    case .everything: "Every field, including computed and system fields."
    case .minimal: "The \(brand) ID, the match keys and the required fields."
    }
  }
}

/// A resolved selection: the ids to export, in order, and the ids that no longer exist.
public struct TransferFieldSelection: Equatable, Sendable {
  public let fieldIDs: [String]
  public let unknown: [String]

  public init(fieldIDs: [String], unknown: [String] = []) {
    self.fieldIDs = fieldIDs
    self.unknown = unknown
  }
}

public struct TransferFieldCatalog: Sendable {
  /// Every field, in picker order: group by group, declaration order within.
  public let fields: [TransferFieldInfo]
  /// The groups that hold at least one field, in order.
  public let groups: [TransferFieldGroupInfo]
  private let index: [String: TransferFieldInfo]

  public func field(_ id: String) -> TransferFieldInfo? { index[id] }

  public func contains(_ id: String) -> Bool { index[id] != nil }

  /// The catalog for a resource's fields (the console's `buildTransferFieldCatalog`): the Aglyn id is added when the
  /// resource does not name it, a field id declared twice keeps its first declaration, and the groups come in the order
  /// they were declared, then any a field names that was not, then the built-in tail (custom, system, other).
  public init(fields declared: [TransferFieldInfo], groups declaredGroups: [TransferFieldGroupInfo], brand: String = AglynBrand.name) {
    var all = declared
    if !all.contains(where: { $0.id == transferIDField }) {
      all.append(
        TransferFieldInfo(
          id: transferIDField, label: "\(brand) ID", group: "system", readOnly: true, system: true, matchKey: true,
          aliases: ["\(brand.lowercased()) id", "aglyn id", "record id", "id"].reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }))
    }
    var seen = Set<String>()
    let unique = all.filter { seen.insert($0.id).inserted }

    var ordered: [TransferFieldGroupInfo] = []
    var known = Set<String>()
    func add(_ group: TransferFieldGroupInfo) {
      if known.insert(group.id).inserted { ordered.append(group) }
    }
    let builtIn = [
      TransferFieldGroupInfo(id: "custom", label: "Custom fields"), TransferFieldGroupInfo(id: "system", label: "System"),
      TransferFieldGroupInfo(id: "other", label: "Other"),
    ]
    for group in declaredGroups { add(group) }
    for field in unique {
      if let id = field.group, !id.isEmpty, !builtIn.contains(where: { $0.id == id }) { add(TransferFieldGroupInfo(id: id, label: id)) }
    }
    for group in builtIn { add(group) }

    func groupOf(_ field: TransferFieldInfo) -> String {
      if let id = field.group, !id.isEmpty, known.contains(id) { return id }
      return "other"
    }
    let ordering = ordered.flatMap { group in unique.filter { groupOf($0) == group.id } }
    self.fields = ordering
    self.groups = ordered.filter { group in ordering.contains { groupOf($0) == group.id } }
    self.index = Dictionary(ordering.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
  }

  /// The fields under each group, in catalog order; `ids` narrows and keeps catalog order.
  public func grouped(_ ids: [String]? = nil) -> [(group: TransferFieldGroupInfo, fields: [TransferFieldInfo])] {
    let wanted = ids.map(Set.init)
    func groupOf(_ field: TransferFieldInfo) -> String {
      if let id = field.group, groups.contains(where: { $0.id == id }) { return id }
      return "other"
    }
    return groups.map { group in
      (group: group, fields: fields.filter { groupOf($0) == group.id && (wanted?.contains($0.id) ?? true) })
    }.filter { !$0.fields.isEmpty }
  }

  /// The fields whose label, id or an alias contains every word of `query`.
  public func search(_ query: String) -> [TransferFieldInfo] {
    let words = query.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
    if words.isEmpty { return fields }
    return fields.filter { field in
      let haystack = ([field.label, field.id] + field.aliases).joined(separator: " ").lowercased()
      return words.allSatisfy { haystack.contains($0) }
    }
  }

  /// A list of field ids against the catalog: unknown ids dropped (and reported), duplicates dropped, the given order kept,
  /// and every id in `ensure` present, added in catalog order at the front when missing.
  public func resolve(selection selected: [String], ensure: [String] = []) -> TransferFieldSelection {
    var seen = Set<String>()
    var ids: [String] = []
    var unknown: [String] = []
    for id in selected where seen.insert(id).inserted {
      if contains(id) { ids.append(id) } else { unknown.append(id) }
    }
    let missing = fields.map(\.id).filter { ensure.contains($0) && !ids.contains($0) }
    return TransferFieldSelection(fieldIDs: missing + ids, unknown: unknown)
  }

  /// The fields a built-in preset exports, in order (the re-importable and minimal ones lead with the id and the match keys).
  public func resolve(_ preset: TransferPreset, hints: TransferPresetHints = TransferPresetHints()) -> TransferFieldSelection {
    var keys: [String] = []
    for id in [transferIDField] + hints.matchKeyFieldIDs where !keys.contains(id) && contains(id) { keys.append(id) }
    func lead(_ ids: [String]) -> [String] {
      let rest = Set(ids).subtracting(keys)
      return keys + fields.map(\.id).filter { rest.contains($0) }
    }
    switch preset {
    case .everything:
      return TransferFieldSelection(fieldIDs: fields.map(\.id))
    case .reimportable:
      return TransferFieldSelection(fieldIDs: lead(fields.filter(\.writable).map(\.id)))
    case .minimal:
      let minimal = Set(hints.minimalFieldIDs)
      return TransferFieldSelection(
        fieldIDs: lead(fields.filter { $0.required || minimal.contains($0.id) }.map(\.id)),
        unknown: hints.minimalFieldIDs.filter { !contains($0) })
    }
  }

  /// A saved or resource preset resolved against the catalog.
  public func resolve(_ preset: TransferSavedPreset) -> TransferFieldSelection { resolve(selection: preset.fieldIDs) }
}

/// `ids` with the entry at `from` moved to `to`: the picker's reorder.
public func moveTransferField(_ ids: [String], from: Int, to: Int) -> [String] {
  var next = ids
  guard from >= 0, from < next.count else { return next }
  let moved = next.remove(at: from)
  next.insert(moved, at: max(0, min(next.count, to)))
  return next
}
