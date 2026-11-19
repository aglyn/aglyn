// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Foundation
import SwiftUI

/// A SET OF FIELDS ASKED AGAIN FOR EACH ONE OF SEVERAL (`kind: "group"`): the minors a parent signs for, each with a name and
/// a date of birth, as the console's waiver forms ask (AGL-4042). `fields` are the set's own text-like fields (text, email,
/// a date); `min` sets start on the form (one, where the console starts with one), `max` caps them (a waiver's 10 minors),
/// `itemLabel` heads each set (a template, `item.n` its number from 1), `addLabel` adds one and `removeLabel` removes one
/// while more than `min` are left. Its value is the list of sets, each `{ key: value }`, as the console sends them: what was
/// typed, trimmed, and "" for a field left empty.
enum FieldGroups {
  /// The sets as typed, kept as JSON text while they are edited.
  static func items(_ value: String) -> [[String: String]] {
    guard let parsed = JSONValue.decode(Data(value.utf8))?.arrayValue else { return [] }
    return parsed.map { set in
      Optional(set).objectEntries.reduce(into: [String: String]()) { $0[$1.key] = ScreenValues.text($1.value) }
    }
  }

  static func encode(_ items: [[String: String]]) -> String {
    let value: JSONValue = .array(items.map { set in .object(set.mapValues { .string($0) }) })
    return (try? value.encoded()).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
  }

  /// What the field starts with: the list its `initial` names, else `min` empty sets.
  static func initial(_ field: FieldSpec, _ resolved: JSONValue) -> String {
    if case .array(let sets) = resolved {
      return encode(sets.map { set in Optional(set).objectEntries.reduce(into: [String: String]()) { $0[$1.key] = ScreenValues.text($1.value) } })
    }
    return encode(Array(repeating: [:], count: Swift.max(0, Int(field.min ?? 0))))
  }

  /// The sets' own fields.
  static func fields(_ field: FieldSpec, in context: JSONValue) -> [FieldSpec] {
    FieldSpec.parseAll(field.config?["fields"].array ?? [], in: context)
  }

  /// What the form sends: every set with each of its fields as that field sends it, "" for one left empty.
  static func json(_ field: FieldSpec, _ value: String) -> JSONValue {
    let fields = fields(field, in: .object([:]))
    return .array(
      items(value).map { set in
        .object(
          fields.reduce(into: [String: JSONValue]()) { sent, sub in
            let one = fieldJSON(sub, .text(set[sub.key] ?? ""))
            sent[sub.key] = one == .null ? .string("") : one
          })
      })
  }
}

struct GroupFieldView: View {
  let field: FieldSpec
  let context: JSONValue
  let label: String
  @Binding var value: FieldValue

  private var items: [[String: String]] {
    if case .text(let text) = value { return FieldGroups.items(text) }
    return []
  }

  var body: some View {
    let items = items
    let fields = FieldGroups.fields(field, in: context)
    let low = Int(field.min ?? 0)
    let high = Int(field.max ?? 50)
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      if !label.isEmpty { Text(label).font(AglynFont.subheadline) }
      ForEach(Array(items.enumerated()), id: \.offset) { index, set in
        let scope = ScreenContext.with(context, item: .object(["n": .number(Double(index + 1))]))
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          HStack {
            Text(field.config?["itemLabel"]?.stringValue.map { ScreenValues.render($0, in: scope) } ?? "")
              .font(AglynFont.subheadline)
            Spacer(minLength: AglynSpace.one)
            if items.count > low {
              Button(field.config?["removeLabel"]?.stringValue.map { ScreenValues.render($0, in: scope) } ?? "Remove") {
                var next = items
                next.remove(at: index)
                value = .text(FieldGroups.encode(next))
              }
              .buttonStyle(.borderless)
              .accessibilityIdentifier("group-remove-\(field.key)-\(index)")
            }
          }
          ForEach(fields) { sub in
            FieldInput(
              field: sub, context: scope,
              value: Binding(
                get: { .text(set[sub.key] ?? "") },
                set: { changed in
                  var next = items
                  switch changed {
                  case .text(let text): next[index][sub.key] = text
                  case .file(_, let text): next[index][sub.key] = text
                  case .flag(let flag): next[index][sub.key] = flag ? "true" : "false"
                  }
                  value = .text(FieldGroups.encode(next))
                }))
          }
        }
        .padding(AglynSpace.one)
        .overlay(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).stroke(AglynColor.divider))
        .accessibilityIdentifier("group-\(field.key)-\(index)")
      }
      if items.count < high {
        Button(field.config?["addLabel"]?.stringValue.map { ScreenValues.render($0, in: context) } ?? "Add") {
          value = .text(FieldGroups.encode(items + [[:]]))
        }
        .buttonStyle(.borderless)
        .accessibilityIdentifier("group-add-\(field.key)")
      }
    }
  }
}
