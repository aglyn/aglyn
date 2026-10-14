// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynPluginHost
import AglynUI
import SwiftUI

/// The library's other filters, the console's Filters panel in a sheet:
/// orientation, alt text, a tag (not for a reader limited to some sites,
/// whose scope holds the query's one array clause) and a size range in
/// megabytes.
struct MediaFiltersSheet: View {
  let context: NativePluginContext
  let scoped: Bool
  let onApply: (MediaFilters) -> Void
  let close: () -> Void
  @State private var draft: MediaFilters
  @State private var uploaders: [UploaderOption] = []

  init(
    context: NativePluginContext, filters: MediaFilters, scoped: Bool, onApply: @escaping (MediaFilters) -> Void,
    close: @escaping () -> Void
  ) {
    self.context = context
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
      FieldEditor(
        spec: FieldSpec("uploadedAfter", "Uploaded on or after", kind: .date), value: $draft.uploadedAfter)
      FieldEditor(
        spec: FieldSpec("uploadedBefore", "Uploaded on or before", kind: .date), value: $draft.uploadedBefore)
      // Anyone who uploaded something, from the workspace's members; a key's uploads and a former member's are kept as they were asked.
      Picker(ContractValues.shared.mediaFilterHeaders["uploadedBy"] ?? "Uploaded by", selection: $draft.uploadedBy) {
        Text("Anyone").tag(String?.none)
        ForEach(uploaderChoices, id: \.uid) { option in Text(option.label).tag(String?.some(option.uid)) }
      }
      .accessibilityIdentifier("media-filter-uploaded-by")
      Button("Clear all", role: .destructive) { draft = MediaFilters() }
        .disabled(draft.count == 0)
    }
    .task { if let orgID = context.orgID { uploaders = await uploaderOptions(context.api, orgID: orgID) } }
  }

  private var uploaderChoices: [UploaderOption] {
    guard let picked = draft.uploadedBy, !uploaders.contains(where: { $0.uid == picked }) else { return uploaders }
    return uploaders + [UploaderOption(uid: picked, label: picked.hasPrefix("api:") ? "API key" : picked)]
  }

  /// A size box takes digits and one decimal point.
  private func megabytes(_ text: Binding<String>) -> Binding<String> {
    Binding(get: { text.wrappedValue }, set: { text.wrappedValue = megabytesInput($0) })
  }
}
