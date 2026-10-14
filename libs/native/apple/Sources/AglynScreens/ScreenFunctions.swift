// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/// The pure functions a screen's `compute` load may call, ports of the console's, each replayed from the cases
/// `function-cases.generated.json` records (the Kotlin kit holds the same ports).
public enum ScreenFunctions {
  /// The function named, over its arguments (a missing one is nil); nil for a name this build does not know.
  public static func call(_ name: String, _ args: [JSONValue?]) -> JSONValue? {
    switch name {
    case "packageJsonDiff":
      let limit = args.count > 2 ? args[2]?.numberValue.map { Int($0) } : nil
      return jsonDiff(args.first ?? nil, args.count > 1 ? args[1] : nil, limit: limit ?? 200)
    case "packageMergeKeys":
      return mergeKeys(args.first ?? nil, args.count > 1 ? args[1] : nil)
    case "packageItemChanges":
      let limit = args.count > 2 ? args[2]?.numberValue.map { Int($0) } : nil
      // A fourth argument lets the records run past the values' limit (the screen pages through them).
      let recordLimit = args.count > 3 ? args[3]?.numberValue.map { Int($0) } : nil
      return itemChanges(args.first ?? nil, args.count > 1 ? args[1] : nil, limit: limit ?? 200, recordLimit: recordLimit)
    case "aiProductsImportJob":
      return aiProductsImportJob(args.first ?? nil)
    case "ssoEnforcementAccounts":
      return ssoEnforcementAccounts(
        args.first ?? nil, args.count > 1 ? args[1]?.stringValue : nil, args.count > 2 ? args[2] : nil)
    default:
      return nil
    }
  }

  private static func plain(_ value: JSONValue?) -> [String: JSONValue]? {
    if case .object(let record)? = value { return record }
    return nil
  }

  /// Every leaf that differs between the site's item and the file's, as before → after rows (the console's
  /// `packageJsonDiff`): objects are walked key by key, a list or a value is compared whole, at most `limit` rows.
  static func jsonDiff(_ before: JSONValue?, _ after: JSONValue?, limit: Int) -> JSONValue {
    var changes: [JSONValue] = []
    var more = 0
    func walk(_ left: JSONValue?, _ right: JSONValue?, _ path: [String]) {
      if left == right { return }
      if let one = plain(left), let two = plain(right) {
        for key in Set(one.keys).union(two.keys).sorted() { walk(one[key], two[key], path + [key]) }
        return
      }
      if changes.count >= limit {
        more += 1
        return
      }
      var change: [String: JSONValue] = [
        "key": .string(path.isEmpty ? "$" : path.joined(separator: "/")),
        "label": .string(path.isEmpty ? "Whole item" : path.joined(separator: " › ")),
      ]
      if let left { change["before"] = left }
      if let right { change["after"] = right }
      changes.append(.object(change))
    }
    walk(before, after, [])
    return ["changes": .array(changes), "more": .number(Double(more))]
  }

  /// The top-level keys of a merged item that differ, each with what a merge would keep (the console's
  /// `packageMergeKeys`): the site's value wins when it has one.
  static func mergeKeys(_ site: JSONValue?, _ file: JSONValue?) -> JSONValue {
    let left = plain(site) ?? [:]
    let right = plain(file) ?? [:]
    let rows: [JSONValue] = right.keys.sorted().compactMap { key in
      guard let incoming = right[key], left[key] != incoming else { return nil }
      var row: [String: JSONValue] = ["key": .string(key), "file": incoming]
      if let held = left[key] { row["site"] = held }
      let blank: Bool
      switch left[key] {
      case nil, .null?: blank = true
      case .string(let text)?: blank = text.isEmpty
      default: blank = false
      }
      row["merged"] = .string(blank ? "package" : "site")
      return .object(row)
    }
    return .array(rows)
  }

  /// A record of an item's list: a document with its own `$id`.
  private static func isRecord(_ value: JSONValue) -> Bool {
    if case .object(let record) = value, case .string(let id)? = record["$id"], !id.isEmpty { return true }
    return false
  }

  /// The key of an item that holds its records (the console's `packageRecordField`), found by shape: the one
  /// list, on either side, whose every element is a document with its own `$id`; the other side holds a list
  /// there too, or nothing. Nil when no key qualifies or more than one does.
  static func recordField(_ contents: [JSONValue?]) -> String? {
    let docs = contents.compactMap { plain($0) }
    var found = Set<String>()
    for doc in docs {
      for (key, value) in doc {
        if case .array(let items) = value, !items.isEmpty, items.allSatisfy(isRecord) { found.insert(key) }
      }
    }
    let fields = found.filter { key in
      docs.allSatisfy { doc in
        switch doc[key] {
        case nil, .null?: return true
        case .array(let items)?: return items.allSatisfy(isRecord)
        default: return false
        }
      }
    }
    return fields.count == 1 ? fields.first : nil
  }

  /// What importing an item changes (the console's `packageItemChanges`): the leaf-by-leaf diff of everything
  /// but its records and, for an item that holds records, a row per value of a record that differs (a whole
  /// record for one only a side holds). At most `limit` rows of each (`recordLimit` for the records, when
  /// it differs); `more` counts the rest.
  static func itemChanges(_ before: JSONValue?, _ incoming: JSONValue?, limit: Int, recordLimit: Int? = nil) -> JSONValue {
    var existing = before
    if existing == nil || existing == .null { existing = .object([:]) }
    let field = recordField([existing, incoming])
    func without(_ content: JSONValue?) -> JSONValue? {
      guard let field, var record = plain(content) else { return content }
      record[field] = nil
      return .object(record)
    }
    guard case .object(var result) = jsonDiff(without(existing), without(incoming), limit: limit) else { return .null }
    guard let field else {
      result["recordField"] = .null
      result["records"] = .null
      return .object(result)
    }
    func recordsOf(_ content: JSONValue?) -> [JSONValue] {
      guard let list = plain(content)?[field], case .array(let items) = list else { return [] }
      return items.filter(isRecord)
    }
    func id(_ record: JSONValue) -> String { record["$id"]?.stringValue ?? "" }
    // Matched by `$id`: the site's records in order (a repeated id keeps its first place and its last copy).
    var theirs: [String: JSONValue] = [:]
    var theirOrder: [String] = []
    for record in recordsOf(existing) {
      if theirs[id(record)] == nil { theirOrder.append(id(record)) }
      theirs[id(record)] = record
    }
    var seen = Set<String>()
    var rows: [(status: String, id: String, site: JSONValue?, file: JSONValue?, changed: [String])] = []
    var counts = ["added": 0, "removed": 0, "changed": 0, "same": 0]
    for record in recordsOf(incoming) {
      if !seen.insert(id(record)).inserted { continue }
      guard let held = theirs[id(record)] else {
        counts["added", default: 0] += 1
        rows.append(("added", id(record), nil, record, []))
        continue
      }
      let left = plain(held) ?? [:]
      let right = plain(record) ?? [:]
      let changed = Set(left.keys).union(right.keys).filter { $0 != "$id" && left[$0] != right[$0] }.sorted()
      if changed.isEmpty {
        counts["same", default: 0] += 1
        continue
      }
      counts["changed", default: 0] += 1
      rows.append(("changed", id(record), held, record, changed))
    }
    for key in theirOrder where !seen.contains(key) {
      counts["removed", default: 0] += 1
      rows.append(("removed", key, theirs[key], nil, []))
    }
    var changes: [JSONValue] = []
    var more = 0
    func add(_ change: [String: JSONValue]) {
      if changes.count >= (recordLimit ?? limit) { more += 1 } else { changes.append(.object(change)) }
    }
    for row in rows {
      if row.status == "changed" {
        for name in row.changed {
          var change: [String: JSONValue] = [
            "key": .string("\(row.id)/\(name)"), "label": .string("\(row.id) › \(name)"), "status": .string("changed"),
          ]
          if let was = plain(row.site)?[name] { change["before"] = was }
          if let now = plain(row.file)?[name] { change["after"] = now }
          add(change)
        }
      } else {
        var change: [String: JSONValue] = ["key": .string(row.id), "label": .string(row.id), "status": .string(row.status)]
        if let site = row.site { change["before"] = site }
        if let file = row.file { change["after"] = file }
        add(change)
      }
    }
    func counted(_ count: Int, _ noun: String) -> String { "\(ScreenValues.grouped(Double(count))) \(count == 1 ? noun : noun + "s")" }
    let summary = [
      counted(counts["added"] ?? 0, "new record"), counted(counts["changed"] ?? 0, "changed record"),
      "\(counted(counts["removed"] ?? 0, "record")) not in the file", "\(ScreenValues.grouped(Double(counts["same"] ?? 0))) unchanged",
    ].joined(separator: " · ")
    result["recordField"] = .string(field)
    result["records"] = ["summary": .string(summary), "changes": .array(changes), "more": .number(Double(more))]
    return .object(result)
  }

  /// The single sign-on rehearsal's rows, one per account (the console's `ssoEnforcementAccounts`): the address, what
  /// enforcing would remove from it, what it keeps, whether it can be designated break-glass (it holds a way in that is
  /// not the identity provider) and whether it is designated now.
  static func ssoEnforcementAccounts(_ accounts: JSONValue?, _ providerID: String?, _ designated: JSONValue?) -> JSONValue {
    let chosen = Set(designated.array.compactMap(\.stringValue))
    let dash = "\u{2014}"
    func methods(_ value: JSONValue?) -> [String] { value.array.compactMap(\.stringValue) }
    return .array(
      accounts.array.compactMap { (account: JSONValue) -> JSONValue? in
        guard let uid = account["uid"]?.stringValue else { return nil }
        let unlinked = methods(account["unlinked"])
        let kept = methods(account["kept"])
        let skipped = account["skipped"]?.stringValue
        let wouldLose: String
        if skipped == "break-glass" {
          wouldLose = "Nothing \(dash) designated break-glass"
        } else if let skipped, !skipped.isEmpty {
          wouldLose = "Nothing \(dash) it would be left with no way in"
        } else {
          wouldLose = unlinked.isEmpty ? dash : unlinked.joined(separator: ", ")
        }
        return [
          "uid": .string(uid),
          "label": .string(account["email"]?.stringValue ?? uid),
          "wouldLose": .string(wouldLose),
          "keeps": .string(kept.isEmpty ? dash : kept.joined(separator: ", ")),
          "eligible": .bool((unlinked + kept).contains { $0 != providerID }),
          "designated": .bool(chosen.contains(uid)),
        ]
      })
  }

  /// The copy job a landed product import starts (the AI plugin's `aiProductsImportJob`): the brief and the `inputs`
  /// the jobs route takes, for the first 50 products the import created; null when it created none.
  static func aiProductsImportJob(_ rows: JSONValue?) -> JSONValue {
    var ids: [String] = []
    for row in rows.array {
      guard row["outcome"]?.stringValue == "created", let id = row["recordId"]?.stringValue, !id.isEmpty, !ids.contains(id) else { continue }
      ids.append(id)
    }
    ids = Array(ids.prefix(50))
    guard !ids.isEmpty else { return .null }
    var seen = Set<String>()
    let readable = ids.filter { id in
      id.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil && seen.insert(id).inserted
    }
    return [
      "brief": .string("Write storefront copy for \(ids.count) \(ids.count == 1 ? "product" : "products")"),
      "inputs": ["target": "bulk", "productIds": .string(readable.joined(separator: ","))],
    ]
  }
}
