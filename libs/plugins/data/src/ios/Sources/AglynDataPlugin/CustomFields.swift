// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynSite
import AglynUI
import SwiftUI

// The named field types a dataset field can ride on a storage type (the
// console's custom field types, AGL-434): the Data plugin's Page address,
// Image and Page (AGL-3616, AGL-3763), and the Marketplace plugin's Rating.
// The field's definition keeps its storage `type` and gains `customType`;
// the records route validates the value, so these helpers only choose and
// show what the route will accept.

/// One named field type, as the console's registry declares it.
struct DatasetCustomType: Hashable {
  let name: String
  let label: String
  let pluginID: String
  let baseType: DatasetFieldType
}

let recordAddressFieldType = "pageAddress"
let datasetImageFieldType = "image"
let datasetPageFieldType = "page"
let datasetRatingFieldType = "rating"

/// The types the console's Type menu lists after the storage types, in its order.
let datasetCustomTypes: [DatasetCustomType] = [
  DatasetCustomType(name: recordAddressFieldType, label: "Page address", pluginID: "data", baseType: .text),
  DatasetCustomType(name: datasetImageFieldType, label: "Image", pluginID: "data", baseType: .text),
  DatasetCustomType(name: datasetPageFieldType, label: "Page", pluginID: "data", baseType: .text),
  DatasetCustomType(name: datasetRatingFieldType, label: "Rating (0–5)", pluginID: "marketplace", baseType: .int32),
]

func datasetCustomType(_ name: String?) -> DatasetCustomType? {
  name.flatMap { name in datasetCustomTypes.first { $0.name == name } }
}

/// The Type menu's row for a definition: `custom:{name}` for a named type, else the storage type.
func datasetTypeSelection(_ definition: DatasetFieldDefinition) -> String {
  if let customType = definition.customType, datasetCustomType(customType) != nil { return "custom:\(customType)" }
  return (definition.type ?? .text).rawValue
}

/// Applies a Type menu pick: a named type rides its storage type and stamps `customType`; a storage type clears it.
func applyDatasetTypeSelection(_ selection: String, to definition: inout DatasetFieldDefinition) {
  if selection.hasPrefix("custom:") {
    guard let custom = datasetCustomType(String(selection.dropFirst("custom:".count))) else { return }
    definition.type = custom.baseType
    definition.customType = custom.name
  } else {
    definition.type = DatasetFieldType(rawValue: selection) ?? .text
    definition.customType = nil
  }
}

/// A record's page address is a lowercase URL segment: letters and digits joined by single hyphens, 64 at most.
func isRecordAddress(_ value: String) -> Bool {
  value.count <= 64 && value.range(of: "^[a-z0-9]+(?:-[a-z0-9]+)*$", options: .regularExpression) != nil
}

private let mediaSegment = "^[A-Za-z0-9_-]{1,64}$"

private func isSegment(_ text: String) -> Bool { text.range(of: mediaSegment, options: .regularExpression) != nil }

/// A media CDN scope: a site id, `org:{orgId}` or `org:{orgId}:{siteId}`.
private func isMediaCdnScope(_ scope: String) -> Bool {
  guard scope.hasPrefix("org:") else { return isSegment(scope) }
  let parts = scope.dropFirst(4).split(separator: ":", omittingEmptySubsequences: false)
  return (1...2).contains(parts.count) && parts.allSatisfy { isSegment(String($0)) }
}

/// A `media:{scope}/{mediaId}[@{hash}]` reference read apart, or nil when it is not a well-formed one.
func parseMediaReference(_ value: String) -> (scope: String, mediaID: String)? {
  guard value.hasPrefix("media:") else { return nil }
  let rest = String(value.dropFirst("media:".count))
  guard let slash = rest.firstIndex(of: "/"), slash != rest.startIndex else { return nil }
  let scope = String(rest[..<slash])
  let tail = String(rest[rest.index(after: slash)...])
  let mediaID = tail.split(separator: "@", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
  guard isMediaCdnScope(scope), isSegment(mediaID) else { return nil }
  return (scope, mediaID)
}

/// Whether a value is a photo address a record may hold (`isDatasetImageValue`): a `media:` reference, a
/// path on the site, or an https address, with no spaces, quotes or angle brackets, at most 2,000 characters.
func isDatasetImageValue(_ value: String) -> Bool {
  guard !value.isEmpty, value.count <= 2_000 else { return false }
  if value.rangeOfCharacter(from: CharacterSet(charactersIn: " \t\n\r\"'<>\\")) != nil { return false }
  if value.hasPrefix("media:") { return parseMediaReference(value) != nil }
  if value.hasPrefix("/") { return !value.hasPrefix("//") }
  return value.range(of: "^https://[^/]+", options: .regularExpression) != nil
}

/// A page value is `screen:{screenId}`, the form the Besigner's page pickers write into a link.
func datasetPageValue(_ screenID: String) -> String { "screen:\(screenID)" }

/// The page a stored value names, or nil when it names none (`datasetPageScreenId`).
func datasetPageScreenID(_ value: String) -> String? {
  guard value.hasPrefix("screen:") else { return nil }
  let key = String(value.dropFirst("screen:".count)).trimmingCharacters(in: .whitespaces)
  guard key.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil else { return nil }
  return key
}

// MARK: Inputs

/// A record's photo: Choose from media opens the library (this site's files and the workspace's), and the
/// pick is stored as a `media:` reference; a photo hosted elsewhere is still possible behind "Use a link instead".
struct DatasetImageInput: View {
  let context: NativePluginContext
  let label: String
  @Binding var value: String
  @State private var choosing = false
  @State private var linkOpen: Bool

  init(context: NativePluginContext, label: String, value: Binding<String>) {
    self.context = context
    self.label = label
    _value = value
    _linkOpen = State(initialValue: value.wrappedValue.hasPrefix("https://"))
  }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text(label).font(AglynFont.caption).foregroundStyle(.secondary)
      HStack(spacing: AglynSpace.two) {
        AglynRemoteImage(mediaPreviewURL(value, origin: context.api.origin, hostID: context.hostID), systemImage: "photo")
          .frame(width: 96, height: 72)
          .clipShape(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          Button(value.isEmpty ? "Choose from media" : "Change photo") { choosing = true }
            .buttonStyle(.aglynSecondary)
            .accessibilityIdentifier("image-choose")
          if !value.isEmpty {
            Button("Remove", role: .destructive) {
              value = ""
              linkOpen = false
            }
            .buttonStyle(.borderless)
          }
        }
      }
      if linkOpen {
        // A picked photo is a reference, not a link: the field stays empty for it rather than showing a value nobody edits by hand.
        TextField(
          "Photo link (https://)",
          text: Binding(
            get: { value.hasPrefix("https://") || value.isEmpty ? value : "" },
            set: { value = $0.trimmingCharacters(in: .whitespaces) })
        )
        .autocorrectionDisabled()
        #if os(iOS)
          .textInputAutocapitalization(.never)
          .keyboardType(.URL)
        #endif
        Text("A photo hosted on another website, starting with https://")
          .font(AglynFont.caption).foregroundStyle(.secondary)
      } else {
        Button("Use a link instead") { linkOpen = true }
          .buttonStyle(.borderless).font(AglynFont.caption)
      }
    }
    .sheet(isPresented: $choosing) {
      MediaChooserSheet(context: context, kind: "image") { chosen in value = chosen.reference }
    }
  }
}

/// A record's page: one of the site's pages, picked by name and stored as `screen:{id}` so a link bound to
/// it follows the page wherever it moves. Datasets belong to the workspace and a page to one site, so
/// the list is the pages of the site whose Data page is open; the workspace's Data page says where to go.
struct DatasetPageInput: View {
  let context: NativePluginContext
  let label: String
  @Binding var value: String
  @State private var screens = LiveQuery()

  private var selected: String { datasetPageScreenID(value) ?? "" }

  private var pages: [(id: String, name: String)] {
    (screens.state.value ?? []).compactMap(PageNode.init).filter { !$0.isGroup }
      .map { (id: $0.id, name: $0.name) }
      .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
  }

  var body: some View {
    if let hostID = context.hostID {
      let known = selected.isEmpty || pages.contains { $0.id == selected }
      Picker(
        label,
        selection: Binding(
          get: { selected },
          set: { value = $0.isEmpty ? "" : datasetPageValue($0) })
      ) {
        Text("No page").tag("")
        ForEach(pages, id: \.id) { Text($0.name).tag($0.id) }
        // A page that was deleted, or is not in this site, is named rather than shown as empty.
        if !known { Text("⚠ A page this site no longer has").tag(selected) }
      }
      .accessibilityIdentifier("page-picker")
      .aglynTask(id: hostID) {
        await screens.bind(context.firestore, FirestoreQuery(["hosts", hostID, "screens"], order: [.init("__name__")], limit: pagesWindow))
      }
    } else {
      LabeledContent(label) { Text(selected.isEmpty ? "No page chosen" : "A page is chosen").foregroundStyle(.secondary) }
      Text("Pages belong to a site. Open this dataset from that site's Data page to choose one.")
        .font(AglynFont.caption).foregroundStyle(.secondary)
    }
  }
}

/// A rating: a whole number from 0 to 5, or none.
struct DatasetRatingInput: View {
  let label: String
  @Binding var value: String

  var body: some View {
    Picker(label, selection: $value) {
      Text("—").tag("")
      ForEach(0...5, id: \.self) { Text("\($0)").tag("\($0)") }
    }
  }
}
