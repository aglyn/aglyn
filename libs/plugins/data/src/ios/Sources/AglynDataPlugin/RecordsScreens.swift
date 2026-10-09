// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Observation
import SwiftUI

/// The inputs' text for a new record: each field's default, as the editor pre-fills it.
func newRecordInputs(_ model: DatasetModel) -> [String: String] {
  var inputs: [String: String] = [:]
  for (id, field) in model.orderedFields {
    if let value = plain(field.default) { inputs[id] = jsString(value) }
  }
  return inputs
}

/// The inputs' text for an existing record (`datasetValueToInput`).
func recordInputs(_ model: DatasetModel, _ values: [String: Any]) -> [String: String] {
  var inputs: [String: String] = [:]
  for (id, field) in model.orderedFields { inputs[id] = datasetValueToInput(field, values[id]) }
  return inputs
}

/// What an input's text is sent as: a timestamp's `YYYY-MM-DDTHH:mm` gains its zone,
/// since the editor shows UTC, and the route reads it in the server's.
func inputsForWrite(_ model: DatasetModel, _ inputs: [String: String]) -> [String: String] {
  inputs.reduce(into: [:]) { out, entry in
    let (id, text) = entry
    if model.fields?[id]?.type == .timestamp, parseUtcMinute(text) != nil,
      !text.trimmingCharacters(in: .whitespaces).hasSuffix("Z")
    {
      out[id] = text.trimmingCharacters(in: .whitespaces) + "Z"
    } else {
      out[id] = text
    }
  }
}

/// A value as the record view shows it: a reference by its target's label, or its id when that resolves to nothing loaded.
func recordValueText(_ field: DatasetFieldDefinition, _ value: Any?, choices: [FilterChoice]?) -> String? {
  if field.type == .reference {
    var ids: [String] = []
    if let list = value as? [Any] {
      ids = list.compactMap { $0 is NSNull ? nil : jsString($0) }
    } else if let value, !(value is NSNull) {
      ids = [jsString(value)]
    }
    let text = ids.map { id in choices?.first { $0.value == id }?.label ?? "\(id) (not found)" }.joined(separator: ", ")
    return text.isEmpty ? nil : text
  }
  let text = formatDatasetValue(field, value)
  return text.isEmpty ? nil : text
}

/// Each reference field's choices: the target's first 200 records, by its display field (`refOptions`).
@MainActor
@Observable
final class ReferenceChoicesModel {
  private(set) var choices: [String: [FilterChoice]] = [:]
  @ObservationIgnored private var loading: Task<Void, Never>?

  func load(_ reader: FirestoreReader, orgID: String, model: DatasetModel) {
    loading?.cancel()
    loading = Task { [weak self] in
      var loaded: [String: [FilterChoice]] = [:]
      for (id, field) in model.orderedFields {
        guard field.type == .reference, let reference = field.reference else { continue }
        do {
          let target = try await reader.readOnce(datasetsPath(orgID) + [reference.datasetId])
          let display = reference.displayFieldId ?? effectiveDatasetModel(target?.data ?? [:]).order?.first
          let docs = try await reader.readOnce(FirestoreQuery(recordsPath(orgID, reference.datasetId), limit: 200))
          loaded[id] = docs.map { doc in
            let values = doc.data["values"] as? [String: Any]
            return FilterChoice(doc.id, display.flatMap { values?[$0] }.map { jsString($0) } ?? doc.id)
          }
        } catch {}
      }
      guard !Task.isCancelled else { return }
      self?.choices = loaded
    }
  }
}

private enum RecordSheet: Identifiable {
  /// `recordID` nil: a new record. `values` are the inputs' text.
  case edit(recordID: String?, values: [String: String])
  case delete(RecordRow)

  var id: String {
    switch self {
    case .edit(let recordID, _): "edit-\(recordID ?? "new")"
    case .delete(let record): "delete-\(record.id)"
    }
  }
}

/// A dataset's records, the picked one beside the list on wide windows: the quick search and the filters
/// as one query, a page at a time, and each record's values with edit, delete and export of what the list shows.
struct RecordsScreen: View {
  let context: NativePluginContext
  let datasetID: String
  var initialRecordID: String?
  var startNew = false

  @State private var live = LiveDocument()

  var body: some View {
    Group {
      if let orgID = context.orgID {
        switch live.state {
        case .loading:
          List { SkeletonRows(count: 6) }.aglynListBackground()
        case .failed:
          AglynEmptyState(
            "Could not load this dataset", systemImage: "exclamationmark.triangle", message: "It may no longer be shared with you.")
        case .ready(let doc):
          if let doc {
            RecordsBody(
              context: context, orgID: orgID, dataset: DatasetRow(doc), initialRecordID: initialRecordID, startNew: startNew)
          } else {
            AglynEmptyState("This dataset is gone", systemImage: DataSymbols.dataset)
          }
        }
      } else {
        AglynEmptyState("Pick a workspace to see its data", systemImage: DataSymbols.dataset)
      }
    }
    .aglynTask(id: "\(context.orgID ?? "")-\(datasetID)") {
      if let orgID = context.orgID { await live.bind(context.firestore, datasetsPath(orgID) + [datasetID]) }
    }
  }
}

private struct RecordsBody: View {
  let context: NativePluginContext
  let orgID: String
  let dataset: DatasetRow
  var initialRecordID: String?
  var startNew: Bool

  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif
  @State private var model: RecordsModel
  @State private var references = ReferenceChoicesModel()
  @State private var runner = PluginActionRunner(roleHint: "an owner, admin or editor")
  @State private var selection: String?
  @State private var pushed: String?
  @State private var sheet: RecordSheet?
  @State private var exporting: TransferExportRequest?
  @State private var searchText = ""
  @State private var began = false

  init(context: NativePluginContext, orgID: String, dataset: DatasetRow, initialRecordID: String?, startNew: Bool) {
    self.context = context
    self.orgID = orgID
    self.dataset = dataset
    self.initialRecordID = initialRecordID
    self.startNew = startNew
    _model = State(initialValue: RecordsModel(dataset: dataset))
  }

  private var canWrite: Bool { orgWriterRoles.contains(context.orgRole ?? "") }
  private var noun: String { dataset.singular.trimmingCharacters(in: .whitespaces).isEmpty ? "record" : dataset.singular.lowercased() }
  private var api: DataAPI { DataAPI(api: context.api, writer: context.writer, orgID: orgID) }

  private var isWide: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          list(selectable: true).frame(minWidth: 300, idealWidth: 360, maxWidth: 420)
          Divider()
          Group {
            if let selection {
              detail(selection, titled: false).id(selection)
            } else {
              AglynEmptyState("Pick a \(noun) to see it here", systemImage: DataSymbols.record)
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        list(selectable: false)
      }
    }
    .navigationTitle(dataset.plural.trimmingCharacters(in: .whitespaces).isEmpty ? dataset.name : dataset.plural)
    .searchable(text: $searchText, prompt: "Search \(dataset.name)")
    .onChange(of: searchText) { _, text in model.type(text) }
    .toolbar {
      ToolbarItemGroup(placement: .primaryAction) {
        Button {
          exportRecords()
        } label: {
          Label("Export records", systemImage: "square.and.arrow.down")
        }
        .accessibilityIdentifier("export-records")
        Button {
          runner.clear()
          sheet = .edit(recordID: nil, values: newRecordInputs(dataset.model))
        } label: {
          Label("Add \(noun)", systemImage: "plus")
        }
        .disabled(!canWrite)
        .keyboardShortcut("n", modifiers: .command)
        .accessibilityIdentifier("add-record")
      }
    }
    .navigationDestination(item: $pushed) { id in detail(id, titled: true) }
    .safeAreaInset(edge: .bottom) {
      if sheet == nil, exporting == nil, let notice = runner.notice {
        AglynNotice(notice, tone: .success) { runner.clear() }
          .padding(AglynSpace.two)
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .animation(.snappy, value: runner.notice)
    .sheet(item: $sheet) { sheet in sheetView(sheet) }
    .sheet(item: $exporting) { request in
      TransferExportSheet(context: context, request: request) { message in
        exporting = nil
        if let message { runner.notice = message }
      }
    }
    .task(id: dataset.model) {
      model.use(dataset)
      model.start(context.firestore, orgID: orgID)
      references.load(context.firestore, orgID: orgID, model: dataset.model)
      if !began {
        began = true
        if let initialRecordID {
          selection = initialRecordID
          if !isWide { pushed = initialRecordID }
        }
        if startNew && canWrite { sheet = .edit(recordID: nil, values: newRecordInputs(dataset.model)) }
      }
    }
    .onDisappear { model.stop() }
  }

  // MARK: The list

  @ViewBuilder
  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        if sheet == nil, exporting == nil, let error = runner.error {
          AglynNotice(error, tone: .error) { runner.clear() }
        }
        ClauseFilterBar(
          fields: model.plan.filter.fields, headers: model.plan.filter.headers, choices: model.plan.filter.options,
          clauses: model.clauses, refused: model.plan.refused, notices: model.plan.notices
        ) { model.setFilters($0) }
      }
      .padding(.horizontal, AglynSpace.two).padding(.vertical, AglynSpace.one)
      content(selectable: selectable)
    }
    .background(AglynColor.page)
  }

  @ViewBuilder
  private func content(selectable: Bool) -> some View {
    if !model.ready {
      List { SkeletonRows(count: 6) }.aglynListBackground()
    } else if model.failed {
      AglynEmptyState(
        "Could not load records", systemImage: "exclamationmark.triangle",
        message: "Records could not be loaded. Check the connection and try again."
      ) {
        Button("Try again") { model.retry() }
      }
    } else if model.rows.isEmpty {
      AglynEmptyState(
        model.filtering ? "No records match these filters" : "No records yet", systemImage: DataSymbols.records,
        message: model.filtering ? "Try another search or remove a filter." : "Add the first \(noun).")
    } else if selectable {
      List(selection: $selection) { rows(selectable: true) }
        .sensoryFeedback(.selection, trigger: selection)
        .aglynListBackground()
        .refreshable { model.retry() }
        .accessibilityIdentifier("records-list")
    } else {
      List { rows(selectable: false) }
        .aglynListBackground()
        .refreshable { model.retry() }
        .accessibilityIdentifier("records-list")
    }
  }

  @ViewBuilder
  private func rows(selectable: Bool) -> some View {
    ForEach(model.rows) { row in
      Group {
        if selectable {
          recordRow(row).tag(row.id)
        } else {
          Button {
            pushed = row.id
          } label: {
            HStack {
              recordRow(row)
              Image(systemName: "chevron.right").font(AglynFont.caption.weight(.semibold)).foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            }
          }
          .buttonStyle(.plain)
        }
      }
      .aglynListRow()
      .accessibilityIdentifier("record-\(row.id)")
      .onAppear { if row.id == model.rows.last?.id { model.loadMore() } }
    }
    if model.hasMore {
      Button("Show more") { model.loadMore() }
        .frame(maxWidth: .infinity)
        .aglynListRow()
        .accessibilityIdentifier("records-more")
    }
  }

  private func recordRow(_ row: RecordRow) -> some View {
    AglynRow(row.title(dataset.model), subtitle: row.supporting(dataset.model), systemImage: DataSymbols.record)
  }

  private func detail(_ id: String, titled: Bool) -> some View {
    RecordDetailView(
      context: context, orgID: orgID, dataset: dataset, recordID: id, references: references.choices, canWrite: canWrite,
      titled: titled, runner: runner,
      onEdit: { record in
        runner.clear()
        sheet = .edit(recordID: record.id, values: recordInputs(dataset.model, record.values))
      },
      onDelete: { record in
        runner.clear()
        sheet = .delete(record)
      })
  }

  private func exportRecords() {
    // The list's own query, re-planned on the server the way the list plans it.
    var scope: JSONValue = ["kind": "all"]
    if model.filtering {
      scope = [
        "kind": "filter",
        "filter": [
          "clauses": .array(model.clauses.map { ["field": .string($0.field), "op": .string($0.op), "value": .string($0.value)] }),
          "search": .array(searchWords(model.search).map { .string($0) }),
        ],
      ]
    }
    exporting = TransferExportRequest(
      resource: datasetTransferResource(dataset.id), title: "Export \(dataset.name)", hostID: nil, scope: scope,
      fileStem: dataset.name.isEmpty ? dataset.id : dataset.name)
  }

  // MARK: Sheets

  @ViewBuilder
  private func sheetView(_ sheet: RecordSheet) -> some View {
    switch sheet {
    case .edit(let recordID, let values):
      RecordEditorSheet(
        dataset: dataset, recordID: recordID, start: values, references: references.choices, runner: runner
      ) { inputs in
        let written = inputsForWrite(dataset.model, inputs)
        if let recordID {
          try await api.updateRecord(datasetID: dataset.id, recordID: recordID, values: written)
        } else {
          _ = try await api.createRecord(datasetID: dataset.id, values: written)
        }
      } onSaved: {
        self.sheet = nil
        runner.notice = recordID == nil ? "Record added." : "Record saved."
      }
    case .delete(let record):
      AglynActionSheet(
        "Delete this \(noun)?",
        message:
          "It stops showing on every page that repeats over \(dataset.name). Records in other datasets that point at it lose the reference, unless one blocks the delete.",
        confirmLabel: "Delete", destructive: true, busy: runner.busy, error: runner.error,
        onCancel: { self.sheet = nil },
        onConfirm: {
          runner.run(success: "Record deleted.", onDone: {
            self.sheet = nil
            if selection == record.id { selection = nil }
            pushed = nil
          }) {
            try await api.deleteRecord(datasetID: dataset.id, recordID: record.id)
          }
        }
      ) { EmptyView() }
    }
  }
}

/// One record, live: its values (a reference by its target's label), and when it was made and changed.
struct RecordDetailView: View {
  let context: NativePluginContext
  let orgID: String
  let dataset: DatasetRow
  let recordID: String
  let references: [String: [FilterChoice]]
  let canWrite: Bool
  var titled = true
  let runner: PluginActionRunner
  let onEdit: (RecordRow) -> Void
  let onDelete: (RecordRow) -> Void

  @State private var live = LiveDocument()

  var body: some View {
    Group {
      switch live.state {
      case .loading: List { SkeletonRows(count: 6) }.aglynListBackground()
      case .failed:
        AglynEmptyState("Could not load this record", systemImage: "exclamationmark.triangle", message: "Check the connection and try again.")
      case .ready(let doc):
        if let doc { content(RecordRow(doc)) } else { AglynEmptyState("This record is gone", systemImage: DataSymbols.record) }
      }
    }
    .navigationTitle(titled ? "Record" : "Records")
    .aglynTask(id: "\(dataset.id)-\(recordID)") { await live.bind(context.firestore, recordsPath(orgID, dataset.id) + [recordID]) }
  }

  private func content(_ record: RecordRow) -> some View {
    let now = Date()
    return Form {
      if titled, let error = runner.error {
        Section { AglynNotice(error, tone: .error) { runner.clear() } }
      } else if titled, let notice = runner.notice {
        Section { AglynNotice(notice, tone: .success) { runner.clear() } }
      }
      Section {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Text(record.title(dataset.model)).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
            Text(dataset.name).font(AglynFont.subheadline).foregroundStyle(.secondary)
          }
          Spacer(minLength: AglynSpace.one)
          Menu {
            Button(role: .destructive) { onDelete(record) } label: { Label("Delete", systemImage: "trash") }
              .disabled(!canWrite)
          } label: {
            Label("More", systemImage: "ellipsis.circle").labelStyle(.iconOnly).imageScale(.large)
          }
          .menuStyle(.borderlessButton)
          .fixedSize()
          .accessibilityLabel("More actions")
        }
        Button {
          onEdit(record)
        } label: {
          Label("Edit", systemImage: "pencil")
        }
        .buttonStyle(.borderedProminent)
        .disabled(!canWrite)
        .accessibilityIdentifier("record-edit")
      }
      Section("Values") {
        ForEach(dataset.model.orderedFields, id: \.id) { id, field in
          AglynDetailRow(field.label(id), value: recordValueText(field, record.values[id], choices: references[id]))
        }
      }
      Section("Details") {
        AglynDetailRow("Record id", value: record.id)
        AglynDetailRow("Created", value: record.createdAt.map { relativeTime($0, now: now) })
        AglynDetailRow("Updated", value: record.updatedAt.map { relativeTime($0, now: now) })
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .accessibilityIdentifier("record-detail")
  }
}

/// The record editor: one typed input per field, as the console's record dialog draws them.
private struct RecordEditorSheet: View {
  let dataset: DatasetRow
  let recordID: String?
  let start: [String: String]
  let references: [String: [FilterChoice]]
  let runner: PluginActionRunner
  let save: ([String: String]) async throws -> Void
  let onSaved: () -> Void
  @State private var inputs: [String: String]
  @State private var errors: [String: String] = [:]
  @Environment(\.dismiss) private var dismiss

  init(
    dataset: DatasetRow, recordID: String?, start: [String: String], references: [String: [FilterChoice]],
    runner: PluginActionRunner, save: @escaping ([String: String]) async throws -> Void, onSaved: @escaping () -> Void
  ) {
    self.dataset = dataset
    self.recordID = recordID
    self.start = start
    self.references = references
    self.runner = runner
    self.save = save
    self.onSaved = onSaved
    _inputs = State(initialValue: start)
  }

  private var noun: String { dataset.singular.trimmingCharacters(in: .whitespaces).isEmpty ? "record" : dataset.singular.lowercased() }

  var body: some View {
    NavigationStack {
      Form {
        if errors.isEmpty, let error = runner.error {
          Section { AglynNotice(error, tone: .error) }
        } else if !errors.isEmpty {
          Section { AglynNotice("Fix the highlighted fields.", tone: .error) }
        }
        Section {
          ForEach(dataset.model.orderedFields, id: \.id) { id, field in
            RecordInput(
              id: id, field: field, value: Binding(get: { inputs[id] ?? "" }, set: { next in
                inputs[id] = next
                errors[id] = nil
              }), error: errors[id], choices: references[id] ?? [])
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle(recordID == nil ? "New \(noun)" : "Edit \(noun)")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") {
            runner.error = nil
            dismiss()
          }
          .disabled(runner.busy)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button {
            errors = [:]
            let current = inputs
            runner.run(onDone: onSaved) {
              do {
                try await save(current)
              } catch let invalid as RecordInvalid {
                errors = invalid.errors
                throw invalid
              }
            }
          } label: {
            if runner.busy { ProgressView() } else { Text(recordID == nil ? "Add" : "Save") }
          }
          .disabled(runner.busy)
          .accessibilityIdentifier("record-save")
        }
      }
    }
    .frame(minWidth: 420, minHeight: 480)
    .accessibilityIdentifier("record-editor")
  }
}

private struct RecordInput: View {
  let id: String
  let field: DatasetFieldDefinition
  @Binding var value: String
  let error: String?
  let choices: [FilterChoice]

  private var label: String { field.label(id) + (field.required == true ? " *" : "") }
  private var hint: String? { error ?? field.description }

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      input
      if let hint = hintText {
        Text(hint).font(AglynFont.caption).foregroundStyle(error != nil ? AglynColor.error : Color.secondary)
      }
    }
    .accessibilityIdentifier("record-input-\(id)")
  }

  private var hintText: String? {
    if let hint { return field.type == .timestamp && error == nil ? "\(hint) · UTC" : hint }
    switch field.type {
    case .coordinates: return "lat, lon"
    case .sorted: return "Comma-separated list"
    case .map: return "JSON, e.g. {\"key\": \"value\"}"
    case .timestamp: return "UTC"
    default: return nil
    }
  }

  @ViewBuilder
  private var input: some View {
    if field.customType != nil {
      TextField(label, text: $value)
    } else if field.type == .bool {
      Picker(label, selection: $value) {
        Text("—").tag("")
        Text("Yes").tag("true")
        Text("No").tag("false")
      }
    } else if field.type == .text, let options = field.validation?.options, !options.isEmpty {
      Picker(label, selection: $value) {
        Text("—").tag("")
        ForEach(options, id: \.self) { Text($0).tag($0) }
      }
    } else if field.type == .reference, field.reference?.multiple == true {
      DisclosureGroup(label) {
        ForEach(choices, id: \.value) { choice in
          Toggle(choice.label, isOn: Binding(get: { selectedIDs.contains(choice.value) }, set: { on in
            var ids = selectedIDs
            if on { ids.append(choice.value) } else { ids.removeAll { $0 == choice.value } }
            value = ids.joined(separator: ", ")
          }))
        }
      }
    } else if field.type == .reference {
      Picker(label, selection: $value) {
        Text("—").tag("")
        ForEach(choices, id: \.value) { Text($0.label).tag($0.value) }
      }
    } else if field.type == .int32 || field.type == .int64 || field.type == .float {
      TextField(label, text: $value)
        #if os(iOS)
          .keyboardType(field.type == .float ? .decimalPad : .numberPad)
        #endif
    } else if field.type == .timestamp {
      TimestampInput(label: label, text: $value)
    } else if field.type == .sorted || field.type == .map {
      TextField(label, text: $value, axis: .vertical).lineLimit(field.type == .map ? 2...6 : 1...4)
    } else {
      TextField(label, text: $value, axis: .vertical)
    }
  }

  private var selectedIDs: [String] {
    value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
  }
}

/// A date and time shown and kept in UTC, as the console's input holds it (`YYYY-MM-DDTHH:mm`).
private struct TimestampInput: View {
  let label: String
  @Binding var text: String

  private var utc: TimeZone { TimeZone(identifier: "UTC") ?? .gmt }

  var body: some View {
    if let millis = parseUtcMinute(text.hasSuffix("Z") ? String(text.dropLast()) : text) {
      HStack {
        DatePicker(
          label,
          selection: Binding(
            get: { Date(timeIntervalSince1970: Double(millis) / 1000) },
            set: { text = utcMinute(Int64(($0.timeIntervalSince1970 * 1000).rounded())) }),
          displayedComponents: [.date, .hourAndMinute]
        )
        .environment(\.timeZone, utc)
        Button("Clear") { text = "" }.buttonStyle(.borderless)
      }
    } else {
      LabeledContent(label) {
        Button("Set date and time") { text = utcMinute(Int64((Date().timeIntervalSince1970 * 1000).rounded())) }
          .buttonStyle(.borderless)
      }
    }
  }
}
