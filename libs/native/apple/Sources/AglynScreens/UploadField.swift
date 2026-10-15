// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// The import's Upload step as one field (`kind: "upload"`), as the console's step reads a file: a chosen file or pasted rows,
/// read here to show how they read, the format, encoding, separator and header row guessed and changeable, the first rows
/// as a preview, and the file refused before anything is sent when it is larger, or longer, than the import takes. Its value
/// is what the upload sends (`{ fileName, text, bytes, format, delimiter?, headerRow? }`), empty until nothing blocks it.
struct UploadFieldView: View {
  let field: FieldSpec
  let context: JSONValue
  @Binding var value: FieldValue

  @State private var draft: TransferUploadDraft?
  @State private var paste = ""
  @State private var picking: PickSource?
  @State private var reading = false
  @State private var readError: String?

  private var limits: TransferUploadLimits { field.uploadLimits(in: context) }

  var body: some View {
    let limits = self.limits
    VStack(alignment: .leading, spacing: 12) {
      Text(field.label).font(AglynFont.subheadline)
      HStack {
        Button(draft == nil || draft?.fileName == TransferUploadDraft.pastedName ? "Choose a file" : "Choose a different file") { picking = .files }
          .accessibilityIdentifier("upload-choose")
        Text("At most \(TransferFileReader.formatBytes(limits.maxBytes))\(limits.maxRows.map { " and \($0.formatted()) rows" } ?? "").")
          .font(AglynFont.caption).foregroundStyle(.secondary)
      }
      TextField("Or paste rows", text: $paste, axis: .vertical)
        .lineLimit(3...8)
        .accessibilityIdentifier("upload-paste")
      Button("Read pasted rows") {
        let text = paste
        adopt(draft: { TransferUploadDraft.pasted(text) }, limits: limits)
      }
        .disabled(paste.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        .accessibilityIdentifier("upload-read")
      if reading { ProgressView().controlSize(.small) }
      if let readError { AglynNotice(readError, tone: .error) }
      if let draft { details(draft, limits) }
    }
    .aglynMediaPicker($picking, multiple: false) { files in
      guard let file = files.first else { return }
      readError = nil
      adopt(draft: { TransferUploadDraft.file(name: file.name, data: file.data, maxBytes: limits.maxBytes) }, limits: limits)
    }
    // A form that is read again (after a save) starts its fields over; what was chosen stays chosen.
    .onChange(of: value) { _, now in
      if case .text(let text) = now, text.isEmpty, let draft { publish(draft, limits) }
    }
  }

  @ViewBuilder
  private func details(_ draft: TransferUploadDraft, _ limits: TransferUploadLimits) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(draft.summary).font(AglynFont.subheadline).accessibilityIdentifier("upload-summary")
      if !draft.unread {
        Picker(
          "Format",
          selection: Binding(get: { draft.settings.format }, set: { next in adopt(draft: { draft.changing(format: next) }, limits: limits) })
        ) {
          ForEach(TransferFormat.allCases) { format in
            Text(TransferUploadDraft.formatName(format) + (limits.formats.contains(format) ? "" : " (not taken here)")).tag(format)
          }
        }
        if draft.raw != nil {
          Picker(
            "Encoding",
            selection: Binding(get: { draft.settings.encoding }, set: { next in adopt(draft: { draft.changing(encoding: next) }, limits: limits) })
          ) {
            ForEach(TransferEncoding.allCases) { Text($0.label).tag($0) }
          }
        }
        if draft.settings.format == .csv {
          Picker(
            "Separator",
            selection: Binding(
              get: { draft.settings.delimiter }, set: { next in adopt(draft: { draft.changing(delimiter: next) }, limits: limits) })
          ) {
            ForEach(transferDelimiters, id: \.value) { Text($0.label).tag($0.value) }
          }
          Toggle(
            "The first row names the columns",
            isOn: Binding(get: { draft.settings.headerRow }, set: { next in adopt(draft: { draft.changing(headerRow: next) }, limits: limits) })
          )
        }
        if let parsed = draft.parsed, parsed.error == nil, !parsed.headers.isEmpty { preview(parsed) }
      }
      ForEach(draft.blockers(limits), id: \.self) { AglynNotice($0, tone: .warning) }
    }
  }

  /// The first rows as the file reads, a cell as one line.
  private func preview(_ parsed: TransferParsedFile) -> some View {
    ScrollView(.horizontal) {
      Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 4) {
        GridRow {
          ForEach(Array(parsed.headers.enumerated()), id: \.offset) { _, header in
            Text(header).font(AglynFont.caption.weight(.semibold))
          }
        }
        Divider()
        ForEach(Array(parsed.shown.enumerated()), id: \.offset) { _, row in
          GridRow {
            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in Text(cell).font(AglynFont.caption).lineLimit(1) }
          }
        }
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Preview of the file")
    .accessibilityIdentifier("upload-preview")
  }

  /// Reads off the main thread (a file may be megabytes), then shows it and publishes what the upload would send.
  private func adopt(draft make: @escaping @Sendable () -> TransferUploadDraft, limits: TransferUploadLimits) {
    reading = true
    Task {
      let next = await Task.detached(priority: .userInitiated) { make() }.value
      draft = next
      reading = false
      publish(next, limits)
    }
  }

  private func publish(_ draft: TransferUploadDraft, _ limits: TransferUploadLimits) {
    if let sent = draft.value(limits), let data = try? sent.encoded(), let text = String(data: data, encoding: .utf8) {
      value = .text(text)
    } else {
      value = .text("")
    }
  }
}

extension FieldSpec {
  /// What the import takes, from an `upload` field's `maxBytes`, `maxRows` and `formats` templates over the loaded resource: the
  /// resource's own limits, else the console's ceiling and a CSV.
  func uploadLimits(in context: JSONValue) -> TransferUploadLimits {
    func resolved(_ key: String) -> JSONValue? { config?[key]?.stringValue.map { ScreenValues.resolve($0, in: context) } }
    let maxBytes = resolved("maxBytes")?.numberValue.map { Int($0) } ?? TransferUploadLimits.defaultMaxBytes
    let maxRows = resolved("maxRows")?.numberValue.map { Int($0) }
    let formats = resolved("formats")?.arrayValue?.compactMap { $0.stringValue.flatMap(TransferFormat.init(rawValue:)) } ?? [.csv]
    return TransferUploadLimits(maxBytes: maxBytes, maxRows: maxRows, formats: formats)
  }
}
