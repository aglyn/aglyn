// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI
import UniformTypeIdentifiers

/// What an export covers and how the file is named (the Kotlin kit's
/// `TransferExportDialog` arguments).
public struct TransferExportRequest: Identifiable {
  public let id = UUID()
  public let resource: String
  public let title: String
  public let hostID: String?
  /// Which records: `{kind: 'all'}` or `{kind: 'filter', filter}`.
  public let scope: JSONValue
  public let fileStem: String
  /// Narrows the field list (a form's own questions, say).
  public let filter: JSONValue?

  public init(
    resource: String, title: String, hostID: String?, scope: JSONValue, fileStem: String, filter: JSONValue? = nil
  ) {
    self.resource = resource
    self.title = title
    self.hostID = hostID
    self.scope = scope
    self.fileStem = fileStem
    self.filter = filter
  }
}

/// A file ready to hand to the device: a copy in the temporary folder.
struct ExportedFile: FileDocument {
  static var readableContentTypes: [UTType] { [.data] }
  let data: Data

  init(data: Data) { self.data = data }
  init(configuration: ReadConfiguration) throws {
    data = configuration.file.regularFileContents ?? Data()
  }
  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

/// The export sheet every list uses, as the console's export dialog works:
/// the resource's fields to pick (all of them to start), the format, then the
/// file handed to the device: Save (the Files app, or a Mac save panel) or
/// the share sheet. `onDone` gets what to say in the screen's banner, or nil
/// when the person backed out.
public struct TransferExportSheet: View {
  let context: NativePluginContext
  let request: TransferExportRequest
  let onDone: (String?) -> Void

  @State private var runner = PluginActionRunner()
  @State private var fields: TransferFields?
  @State private var picked: Set<String> = []
  @State private var format: TransferFormat = .csv
  @State private var ready: (url: URL, name: String, contentType: UTType, data: Data, rows: String?)?
  @State private var saving = false

  public init(context: NativePluginContext, request: TransferExportRequest, onDone: @escaping (String?) -> Void) {
    self.context = context
    self.request = request
    self.onDone = onDone
  }

  private var transfer: TransferAPI { TransferAPI(api: context.api, orgID: context.orgID) }

  private var doneMessage: String { ready?.rows.map { "Exported \($0) rows." } ?? "Exported." }

  public var body: some View {
    NavigationStack {
      Form {
        if let error = runner.error {
          Section { AglynNotice(error, tone: .error) }
        }
        if let ready {
          Section {
            AglynNotice(ready.rows.map { "\($0) rows are ready in \(ready.name)." } ?? "\(ready.name) is ready.", tone: .success)
            Button {
              saving = true
            } label: {
              Label(saveLabel, systemImage: "square.and.arrow.down")
            }
            .accessibilityIdentifier("export-save")
            ShareLink(item: ready.url) {
              Label("Share…", systemImage: "square.and.arrow.up")
            }
            .accessibilityIdentifier("export-share")
          }
        } else {
          Section("Format") {
            Picker("Format", selection: $format) {
              ForEach(TransferFormat.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.inline)
            .labelsHidden()
          }
          Section {
            if let fields {
              ForEach(fields.fields) { field in
                Toggle(isOn: binding(for: field.id)) {
                  VStack(alignment: .leading, spacing: 2) {
                    Text(field.label)
                    if let group = groupLabel(field), group != field.label {
                      Text(group).font(AglynFont.caption).foregroundStyle(.secondary)
                    }
                  }
                }
                .accessibilityIdentifier("export-field-\(field.id)")
              }
            } else {
              SkeletonRows(count: 3)
            }
          } header: {
            HStack {
              Text(fields.map { "\(picked.count) of \($0.fields.count) columns" } ?? "Columns")
              Spacer()
              if let fields {
                Button("All") { picked = Set(fields.fields.map(\.id)) }.textCase(nil)
                Button("None") { picked = [] }.textCase(nil)
              }
            }
          } footer: {
            Text("Pick the columns, then where the file goes.")
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle(request.title)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(ready == nil ? "Cancel" : "Done") { onDone(ready == nil ? nil : doneMessage) }
            .disabled(runner.busy)
        }
        if ready == nil {
          ToolbarItem(placement: .confirmationAction) {
            Button {
              export()
            } label: {
              if runner.busy && fields != nil { ProgressView() } else { Text("Export") }
            }
            .disabled(runner.busy || fields == nil || picked.isEmpty)
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("export-confirm")
          }
        }
      }
      .fileExporter(
        isPresented: $saving, document: ready.map { ExportedFile(data: $0.data) }, contentType: ready?.contentType ?? .data,
        defaultFilename: ready?.name
      ) { result in
        if case .success = result { onDone(doneMessage) }
      }
    }
    .frame(minWidth: 420, minHeight: 480)
    .task(id: request.id) { await loadFields() }
    .sensoryFeedback(.success, trigger: ready?.name)
    .accessibilityIdentifier("export-dialog")
  }

  private var saveLabel: String {
    #if os(macOS)
      "Save…"
    #else
      "Save to Files"
    #endif
  }

  private func groupLabel(_ field: TransferFieldInfo) -> String? {
    guard let group = field.group else { return nil }
    return fields?.groups.first { $0.id == group }?.label
  }

  private func binding(for id: String) -> Binding<Bool> {
    Binding(
      get: { picked.contains(id) },
      set: { on in if on { picked.insert(id) } else { picked.remove(id) } })
  }

  private func loadFields() async {
    await runner.perform {
      let loaded = try await transfer.fields(resource: request.resource, hostID: request.hostID, filter: request.filter)
      fields = loaded
      picked = Set(loaded.fields.map(\.id))
    }
  }

  private func export() {
    guard let fields else { return }
    let ids = fields.fields.map(\.id).filter(picked.contains)
    let format = format
    runner.run {
      let file = try await transfer.export(
        resource: request.resource, hostID: request.hostID, fieldIDs: ids, scope: request.scope, format: format)
      let name = file.name ?? "\(request.fileStem).\(format.wire)"
      let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
      try file.data.write(to: url, options: .atomic)
      let type =
        UTType(mimeType: file.contentType.split(separator: ";").first.map(String.init) ?? format.mimeType)
        ?? UTType(filenameExtension: format.wire) ?? .data
      ready = (url, name, type, file.data, file.header("X-Aglyn-Export-Rows"))
      #if os(macOS)
        saving = true
      #endif
    }
  }
}
