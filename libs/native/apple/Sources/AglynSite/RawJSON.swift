// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

// The stored document as JSON (the console's "Raw JSON" card on a page's view and an entry, AGL-2486): every field it
// holds, exactly as saved — the names a template page's entry tokens read from. Closed until asked for, and the
// document is not even read until then on a page. Read-only. The Kotlin kit's RawJson.kt.

/// A document as the console's `JSON.stringify(doc, null, 2)` shows it: `$id` beside its fields, a timestamp as
/// `{seconds, nanoseconds}` (Firestore's own `toJSON`), keys in a stable order.
public func firestoreRawJSON(id: String, data: [String: Any]) -> String {
  var all = data.mapValues(rawJSONValue)
  all["$id"] = id
  guard
    let bytes = try? JSONSerialization.data(
      withJSONObject: all, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed]),
    let text = String(data: bytes, encoding: .utf8)
  else { return "{}" }
  // Foundation indents by two spaces and writes " : "; the console writes ": ".
  return text.replacingOccurrences(of: "\" : ", with: "\": ")
}

private func rawJSONValue(_ value: Any) -> Any {
  switch value {
  case let date as Date:
    let seconds = date.timeIntervalSince1970.rounded(.down)
    return ["seconds": Int(seconds), "nanoseconds": Int(((date.timeIntervalSince1970 - seconds) * 1e9).rounded())]
  case let map as [String: Any]: return map.mapValues(rawJSONValue)
  case let list as [Any]: return list.map(rawJSONValue)
  case let number as NSNumber:
    if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue }
    return number.doubleValue.isFinite ? number : NSNull()
  case is String, is NSNull: return value
  default: return String(describing: value)
  }
}

/// "Raw JSON", closed until opened: the document pretty-printed, scrolling past 360 points.
struct RawJSONSection: View {
  /// Nil until the caller has the document (a page's is read only once the card is opened).
  let json: String?
  @Binding var open: Bool

  var body: some View {
    Section {
      if open {
        if let json {
          ScrollView([.vertical, .horizontal]) {
            Text(json).font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .frame(maxHeight: 360)
          .accessibilityIdentifier("raw-json")
        } else {
          SkeletonRows(count: 2)
        }
      }
    } header: {
      Button {
        open.toggle()
      } label: {
        HStack {
          Text("Raw JSON")
          Spacer()
          Image(systemName: open ? "chevron.up" : "chevron.down")
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel(open ? "Hide raw JSON" : "Show raw JSON")
      .accessibilityIdentifier("raw-json-toggle")
    }
  }
}

/// A page's "Raw JSON": the screen document is read only while the card is open.
struct PageRawJSONSection: View {
  let reader: FirestoreReader
  let path: [String]
  @State private var open = false
  @State private var live = LiveDocument()

  var body: some View {
    RawJSONSection(json: open ? live.state.value.flatMap { $0.map { firestoreRawJSON(id: $0.id, data: $0.data) } } : nil, open: $open)
      .task(id: open) {
        guard open else { return }
        await live.bind(reader, path)
      }
  }
}
