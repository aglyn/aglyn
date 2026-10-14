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
  /// Which records the list stands for: `{kind: 'all'}` or `{kind: 'filter', filter}`.
  public let scope: JSONValue
  public let fileStem: String
  /// Narrows the field list (a form's own questions, say).
  public let filter: JSONValue?
  /// The records the person selected, when the list has a selection.
  public let selection: [String]
  /// What to call the list's filter in "The current filter: …".
  public let filterLabel: String?
  /// A resource preset to open on, over the person's last choice.
  public let preset: String?

  public init(
    resource: String, title: String, hostID: String?, scope: JSONValue, fileStem: String, filter: JSONValue? = nil,
    selection: [String] = [], filterLabel: String? = nil, preset: String? = nil
  ) {
    self.resource = resource
    self.title = title
    self.hostID = hostID
    self.scope = scope
    self.fileStem = fileStem
    self.filter = filter
    self.selection = selection
    self.filterLabel = filterLabel
    self.preset = preset
  }

  /// Whether the list has a filter applied (its scope names one).
  public var hasFilter: Bool { scope["kind"]?.stringValue == "filter" }
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

/// The export sheet every list uses, as the console's export dialog works: a preset (Everything, Re-importable, Minimal,
/// the resource's own, the ones the person saved, or a hand-picked list), the fields to pick and put in order, which
/// records, the format and a byte-order mark for a CSV, then the file handed to the device: Save (the Files app, or a Mac
/// save panel) or the share sheet. The choice is remembered for the next export of the resource. `onDone` gets what to say
/// in the screen's banner, or nil when the person backed out.
public struct TransferExportSheet: View {
  let context: NativePluginContext
  let request: TransferExportRequest
  let onDone: (String?) -> Void

  @State private var runner = PluginActionRunner()
  @State private var info: TransferFields?
  @State private var catalog: TransferFieldCatalog?
  @State private var choice: TransferExportChoice?
  @State private var saved: [TransferSavedPreset] = []
  @State private var presetName = ""
  @State private var query = ""
  @State private var ready: (url: URL, name: String, contentType: UTType, data: Data, rows: String?)?
  @State private var saving = false

  public init(context: NativePluginContext, request: TransferExportRequest, onDone: @escaping (String?) -> Void) {
    self.context = context
    self.request = request
    self.onDone = onDone
  }

  private var transfer: TransferAPI { TransferAPI(api: context.api, orgID: context.orgID) }

  private var prefsPath: [String] { ["users", context.uid, "transferPrefs", request.resource] }

  private var doneMessage: String { ready?.rows.map { "Exported \($0) rows." } ?? "Exported." }

  private func count(_ n: Int, _ noun: String) -> String { "\(n.formatted()) \(n == 1 ? noun : noun + "s")" }

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
        } else if let info, let catalog, let choice {
          presetSection(info, choice)
          if !choice.unknown.isEmpty {
            Section {
              AglynNotice(
                "\(count(choice.unknown.count, "field")) in this choice no longer \(choice.unknown.count == 1 ? "exists and is" : "exist and are") left out: \(choice.unknown.joined(separator: ", ")).",
                tone: .info)
            }
          }
          pickerSections(catalog, choice)
          recordsSection(info, choice)
          formatSection(info, choice)
        } else {
          Section { SkeletonRows(count: 3) }
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
              if runner.busy && info != nil { ProgressView() } else { Text("Export \(count(choice?.fieldIDs.count ?? 0, "field"))") }
            }
            .disabled(runner.busy || choice?.fieldIDs.isEmpty != false)
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

  // MARK: Preset

  private func presetSection(_ info: TransferFields, _ choice: TransferExportChoice) -> some View {
    let options = TransferExportChoice.presetOptions(info, saved: saved)
    return Section {
      Picker(
        "Preset",
        selection: Binding(
          get: { choice.presetID },
          set: { id in
            guard let catalog else { return }
            self.choice?.choose(preset: id, catalog: catalog, info: info, saved: saved)
          })
      ) {
        ForEach(options) { Text($0.label).tag($0.id) }
      }
      .accessibilityIdentifier("export-preset")
      HStack {
        TextField("Save these fields as", text: $presetName)
          .accessibilityIdentifier("export-preset-name")
        Button("Save preset") { savePreset() }
          .disabled(choice.saving(as: presetName, id: "x") == nil || runner.busy)
          .accessibilityIdentifier("export-preset-save")
      }
    } header: {
      Text("Preset")
    } footer: {
      Text(options.first { $0.id == choice.presetID }?.description ?? "")
    }
  }

  // MARK: Fields

  private func pickerSections(_ catalog: TransferFieldCatalog, _ choice: TransferExportChoice) -> some View {
    let matching = catalog.search(query).map(\.id)
    let chosen = Set(choice.fieldIDs)
    return Group {
      Section {
        TextField("Search fields", text: $query).accessibilityIdentifier("export-search")
        HStack {
          Button(query.isEmpty ? "Select all" : "Select shown") {
            self.choice?.pick(choice.fieldIDs + matching.filter { !chosen.contains($0) })
          }
          Spacer()
          Button(query.isEmpty ? "Select none" : "Clear shown") {
            let shown = Set(matching)
            self.choice?.pick(choice.fieldIDs.filter { !shown.contains($0) })
          }
        }
        .buttonStyle(.borderless)
        let groups = catalog.grouped(matching)
        if groups.isEmpty {
          Text("No field matches “\(query)”.").font(AglynFont.subheadline).foregroundStyle(.secondary)
        }
        ForEach(groups, id: \.group.id) { entry in
          DisclosureGroup(entry.group.label) {
            ForEach(entry.fields) { field in
              Toggle(
                isOn: Binding(
                  get: { chosen.contains(field.id) },
                  set: { on in
                    self.choice?.pick(on ? choice.fieldIDs + [field.id] : choice.fieldIDs.filter { $0 != field.id })
                  })
              ) {
                VStack(alignment: .leading, spacing: 2) {
                  Text(field.label)
                  if let kind = field.kind { Text(kind).font(AglynFont.caption).foregroundStyle(.secondary) }
                }
              }
              .accessibilityIdentifier("export-field-\(field.id)")
            }
          }
        }
      } header: {
        Text("Fields")
      }
      Section {
        if choice.fieldIDs.isEmpty {
          Text("Choose at least one field.").font(AglynFont.subheadline).foregroundStyle(.secondary)
        }
        ForEach(Array(choice.fieldIDs.enumerated()), id: \.element) { index, id in
          HStack {
            Text("\(index + 1). \(catalog.field(id)?.label ?? id)")
            Spacer()
            Button {
              self.choice?.pick(moveTransferField(choice.fieldIDs, from: index, to: index - 1))
            } label: {
              Image(systemName: "arrow.up")
            }
            .disabled(index == 0)
            .accessibilityLabel("Move \(catalog.field(id)?.label ?? id) up")
            Button {
              self.choice?.pick(moveTransferField(choice.fieldIDs, from: index, to: index + 1))
            } label: {
              Image(systemName: "arrow.down")
            }
            .disabled(index == choice.fieldIDs.count - 1)
            .accessibilityLabel("Move \(catalog.field(id)?.label ?? id) down")
          }
          .buttonStyle(.borderless)
        }
      } header: {
        Text("Columns in the file (\(choice.fieldIDs.count))")
      }
    }
  }

  // MARK: Records and format

  @ViewBuilder
  private func recordsSection(_ info: TransferFields, _ choice: TransferExportChoice) -> some View {
    let label = info.resourceLabel?.lowercased() ?? "records"
    let offered: [(String, String)] =
      (request.selection.isEmpty ? [] : [("selection", "The \(count(request.selection.count, "selected record"))")])
      + (request.hasFilter ? [("filter", "The current filter" + (request.filterLabel.map { ": \($0)" } ?? ""))] : [])
      + [("all", "All \(label)")]
    if offered.count > 1 {
      Section("Records") {
        Picker(
          "Records",
          selection: Binding(get: { choice.scope }, set: { self.choice?.scope = $0 })
        ) {
          ForEach(offered, id: \.0) { Text($0.1).tag($0.0) }
        }
        .pickerStyle(.inline)
        .labelsHidden()
        .accessibilityIdentifier("export-scope")
      }
    }
  }

  @ViewBuilder
  private func formatSection(_ info: TransferFields, _ choice: TransferExportChoice) -> some View {
    Section("Format") {
      Picker("Format", selection: Binding(get: { choice.format }, set: { self.choice?.format = $0 })) {
        ForEach(info.formats) { Text($0.label).tag($0) }
      }
      .pickerStyle(.inline)
      .labelsHidden()
      if choice.format == .csv {
        Toggle("Start with a byte-order mark (for Excel)", isOn: Binding(get: { choice.bom }, set: { self.choice?.bom = $0 }))
          .accessibilityIdentifier("export-bom")
      }
    }
  }

  // MARK: Work

  private func loadFields() async {
    await runner.perform {
      let loaded = try await transfer.fields(resource: request.resource, hostID: request.hostID, filter: request.filter)
      let built = TransferFieldCatalog(fields: loaded.fields, groups: loaded.groups)
      info = loaded
      catalog = built
      saved = loaded.savedPresets
      choice = TransferExportChoice.opening(
        loaded, catalog: built, selectionCount: request.selection.count, hasFilter: request.hasFilter, preset: request.preset)
    }
  }

  /// Keeps the fields as they stand under the name given, for the next export of the resource.
  private func savePreset() {
    guard let choice, let preset = choice.saving(as: presetName, id: "preset-\(String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))")
    else { return }
    runner.run {
      let all = Array((saved + [preset]).prefix(50))
      try await context.writer.merge(prefsPath, ["presets": all.map(\.json.foundation)])
      saved = all
      self.choice?.presetID = preset.id
      presetName = ""
    }
  }

  private func scopeJSON(_ choice: TransferExportChoice) -> JSONValue {
    switch choice.scope {
    case "selection": ["kind": "selection", "ids": .array(request.selection.map(JSONValue.string))]
    case "filter": request.scope
    default: ["kind": "all"]
    }
  }

  private func export() {
    guard let choice, let info else { return }
    runner.run {
      let file = try await transfer.export(
        resource: request.resource, hostID: request.hostID, fieldIDs: choice.fieldIDs, scope: scopeJSON(choice), format: choice.format,
        bom: choice.bom, headers: choice.headers(info))
      let name = file.name ?? "\(request.fileStem).\(choice.format.wire)"
      let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
      try file.data.write(to: url, options: .atomic)
      let type =
        UTType(mimeType: file.contentType.split(separator: ";").first.map(String.init) ?? choice.format.mimeType)
        ?? UTType(filenameExtension: choice.format.wire) ?? .data
      ready = (url, name, type, file.data, file.header("X-Aglyn-Export-Rows"))
      // The choice is remembered for next time; a refusal to remember it never spoils the file.
      try? await context.writer.merge(prefsPath, ["export": choice.prefs.json.foundation])
      #if os(macOS)
        saving = true
      #endif
    }
  }
}
