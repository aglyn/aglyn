// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/// The business profile's write rule, as the console applies it when the owner saves the card
/// (`businessProfileOwnerWrite` in `business-profile-values.ts`): what the owner typed is theirs, so a
/// field they changed is recorded as `owner`, while one they left alone keeps the source it had
/// (`start`, `ai`). The Kotlin twin is `com.aglyn.screens.BusinessProfile`; both replay
/// `businessProfileOwnerWrite` from `libs/native/contracts/function-cases.generated.json`.
enum BusinessProfile {
  static let fields = ["whatYouDo", "services", "serviceArea", "audience", "tone", "toneNotes"]
  private static let maxChars = ["whatYouDo": 200, "services": 60, "serviceArea": 120, "audience": 160, "toneNotes": 200]
  private static let maxServices = 12
  private static let tones = ["friendly", "professional", "playful", "premium", "plain"]
  private static let ranked = ["ai", "start", "owner"]

  /// A string with its runs of whitespace made one space, trimmed and cut to `max`; anything else is "".
  static func text(_ value: JSONValue?, _ max: Int) -> String {
    guard case .string(let raw)? = value else { return "" }
    let collapsed = raw.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    return String(collapsed.prefix(max))
  }

  /// Service names from a list, or from text split on commas and newlines: cleaned, once each (any case), at most 12.
  static func services(_ value: JSONValue?) -> [String] {
    let items: [JSONValue]
    switch value {
    case .array(let list)?: items = list
    case .string(let raw)?: items = raw.split(whereSeparator: { $0 == "," || $0 == "\n" }).map { .string(String($0)) }
    default: items = []
    }
    var seen = Set<String>()
    var kept: [String] = []
    for item in items {
      let name = text(item, maxChars["services"] ?? 60)
      let key = name.lowercased()
      if name.isEmpty || seen.contains(key) { continue }
      seen.insert(key)
      kept.append(name)
      if kept.count >= maxServices { break }
    }
    return kept
  }

  /// One field of a document as the rule reads it: cleaned, with a tone it does not know as null.
  static func value(_ doc: JSONValue?, _ field: String) -> JSONValue {
    let raw = doc?[field]
    switch field {
    case "services": return .array(services(raw).map(JSONValue.string))
    case "tone":
      if case .string(let tone)? = raw, tones.contains(tone) { return .string(tone) }
      return .null
    default: return .string(text(raw, maxChars[field] ?? 0))
    }
  }

  static func isEmpty(_ value: JSONValue) -> Bool {
    switch value {
    case .null: true
    case .string(let text): text.isEmpty
    case .array(let items): items.isEmpty
    default: false
    }
  }

  /// Where a field's value came from: nil when empty, else its recorded source, `owner` where none is recorded.
  static func sourceOf(_ doc: JSONValue?, _ field: String) -> String? {
    if isEmpty(value(doc, field)) { return nil }
    if let source = doc?["sources"]?[field]?.stringValue, ranked.contains(source) { return source }
    return "owner"
  }

  /// The document the owner's save writes: every field cleaned, and `sources` saying whose each now is.
  static func ownerWrite(current: JSONValue?, edited: JSONValue) -> [String: JSONValue] {
    var next: [String: JSONValue] = [:]
    var sources: [String: JSONValue] = [:]
    let editedFields: [String: JSONValue]
    if case .object(let record) = edited { editedFields = record } else { editedFields = [:] }
    for field in fields {
      let before = value(current, field)
      let after = editedFields[field] != nil ? value(edited, field) : before
      next[field] = after
      let same = before == after
      if isEmpty(after) {
        // A suggestion the owner deleted is their decision, recorded so the next prefill does not put it back.
        if !same || current?["sources"]?[field]?.stringValue == "owner" { sources[field] = "owner" }
        continue
      }
      sources[field] = .string(same ? (sourceOf(current, field) ?? "owner") : "owner")
    }
    next["sources"] = .object(sources)
    return next
  }
}
