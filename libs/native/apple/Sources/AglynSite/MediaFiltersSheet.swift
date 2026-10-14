// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynUI
import SwiftUI

/// The library's other filters, the console's Filters panel in a sheet:
/// orientation, alt text, a tag (not for a reader limited to some sites,
/// whose scope holds the query's one array clause) and a size range in
/// megabytes.
struct MediaFiltersSheet: View {
  let scoped: Bool
  let onApply: (MediaFilters) -> Void
  let close: () -> Void
  @State private var draft: MediaFilters

  init(filters: MediaFilters, scoped: Bool, onApply: @escaping (MediaFilters) -> Void, close: @escaping () -> Void) {
    self.scoped = scoped
    self.onApply = onApply
    self.close = close
    _draft = State(initialValue: filters)
  }

  var body: some View {
    AglynActionSheet(
      "Filters", confirmLabel: "Apply", busy: false, error: nil, onCancel: close
    ) {
      onApply(draft)
      close()
    } fields: {
      Picker(ContractValues.shared.mediaFilterHeaders["orientation"] ?? "Orientation", selection: $draft.orientation) {
        Text("Any").tag(String?.none)
        ForEach(ContractValues.shared.mediaOrientationOptions, id: \.value) { option in
          Text(option.label).tag(String?.some(option.value))
        }
      }
      .accessibilityIdentifier("media-filter-orientation")
      Picker(ContractValues.shared.mediaFilterHeaders["alt"] ?? "Alt text", selection: $draft.alt) {
        Text("Any").tag(String?.none)
        ForEach(ContractValues.shared.mediaAltOptions, id: \.value) { option in
          Text(option.label).tag(String?.some(option.value))
        }
      }
      .accessibilityIdentifier("media-filter-alt")
      if !scoped {
        AglynCountedField(
          "Tag", text: $draft.tag, max: ContractValues.shared.mediaTagMaxLength, supporting: "Files with this tag.")
      }
      AglynCountedField(
        "At least (MB)", text: megabytes($draft.minMegabytes), keyboard: .number
      )
      AglynCountedField(
        "At most (MB)", text: megabytes($draft.maxMegabytes), keyboard: .number
      )
      Button("Clear all", role: .destructive) { draft = MediaFilters() }
        .disabled(draft.count == 0)
    }
  }

  /// A size box takes digits and one decimal point.
  private func megabytes(_ text: Binding<String>) -> Binding<String> {
    Binding(get: { text.wrappedValue }, set: { text.wrappedValue = megabytesInput($0) })
  }
}
