// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Observation
import SwiftUI

public let dataDatasetsScreen = "data.datasets"
public let dataRecordsScreen = "data.records"
public let dataSchemaScreen = "data.schema"

enum DataSymbols {
  static let dataset = "cylinder.split.1x2"
  static let records = "tablecells"
  static let record = "doc.text"
  static let link = "link"
}

/// The transfer resource a dataset's records export as (`datasetTransferResourceKey`).
public func datasetTransferResource(_ datasetID: String) -> String { "data.dataset:\(datasetID)" }

/// A field's type as the Schema dialog names it.
func typeLabel(_ field: DatasetFieldDefinition) -> String {
  field.type.flatMap { ContractValues.shared.datasetFieldTypeLabels[$0.rawValue] ?? $0.rawValue } ?? "Text"
}

/// A field's line in the Fields card: its type and what constrains it.
func fieldSummary(_ id: String, _ field: DatasetFieldDefinition, _ all: [DatasetRow]) -> String {
  var parts: [String] = [field.customType.map { "\(typeLabel(field)) (\($0))" } ?? typeLabel(field), "id \(id)"]
  if let options = field.validation?.options, !options.isEmpty { parts.append("one of " + options.joined(separator: ", ")) }
  if let reference = field.reference {
    let target = all.first { $0.id == reference.datasetId }?.name ?? reference.datasetId
    parts.append((reference.multiple == true ? "many in " : "one in ") + target)
  }
  if let description = field.description, !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { parts.append(description) }
  return parts.joined(separator: " · ")
}

func fieldSymbol(_ field: DatasetFieldDefinition) -> String {
  switch field.type {
  case .bool: "checkmark.circle"
  case .int32, .int64, .float: "number"
  case .timestamp: "calendar"
  case .coordinates: "mappin.and.ellipse"
  case .sorted: "tag"
  case .reference: "link"
  case .map: "curlybraces"
  default: "textformat"
  }
}

/// The signed-in person's reach in a workspace, live (`orgs/{orgId}/members/{uid}`): whether they see every
/// site, and the scope tokens a list of org-shared resources must be filtered by, since the rules refuse an
/// unfiltered list to a member scoped to some sites. A refused read is a member with no row, never an org-wide one.
@MainActor
@Observable
final class OrgAccessModel {
  enum State: Equatable {
    case loading
    case ready(orgWide: Bool, tokens: [String])
  }

  private(set) var state: State = .loading
  @ObservationIgnored private var listener: FirestoreListening?

  func start(_ context: NativePluginContext, orgID: String) {
    listener?.remove()
    state = .loading
    listener = context.firestore.listenDocument(["orgs", orgID, "members", context.uid]) { [weak self] result in
      switch result {
      case .success(let doc):
        self?.state = .ready(orgWide: OrgAccess.isOrgWideMember(doc?.data), tokens: OrgAccess.memberScopeTokens(doc?.data))
      case .failure:
        self?.state = .ready(orgWide: false, tokens: OrgAccess.memberScopeTokens(nil))
      }
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
  }

  var orgWide: Bool? { if case .ready(let wide, _) = state { wide } else { nil } }
  /// The scope clause the access needs on an org-shared list: none for an org-wide member, their tokens otherwise.
  var listScopeTokens: [String]? { if case .ready(let wide, let tokens) = state { wide ? nil : tokens } else { nil } }
}

/// The workspace's datasets the member can see, live, sorted by name.
@MainActor
@Observable
final class DatasetsModel {
  private(set) var rows: [DatasetRow] = []
  private(set) var ready = false
  private(set) var failed = false
  let access = OrgAccessModel()
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var context: NativePluginContext?
  @ObservationIgnored private var orgID = ""
  @ObservationIgnored private var listeningTokens: [String]?? = .none

  func start(_ context: NativePluginContext, orgID: String) {
    self.context = context
    self.orgID = orgID
    access.start(context, orgID: orgID)
    refresh()
  }

  /// Re-listens when the member's reach is known or changes.
  func refresh() {
    guard let context, case .ready = access.state else { return }
    let tokens = access.listScopeTokens
    if let listeningTokens, listeningTokens == tokens, listener != nil { return }
    listeningTokens = .some(tokens)
    listener?.remove()
    failed = false
    if let tokens, tokens.isEmpty {
      rows = []
      ready = true
      return
    }
    listener = context.firestore.listen(datasetsQuery(orgID, scopeTokens: tokens)) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs): self.rows = docs.map(DatasetRow.init).sorted { $0.name.lowercased() < $1.name.lowercased() }
      case .failure: self.failed = true
      }
      self.ready = true
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
    access.stop()
    listeningTokens = .none
  }
}

private enum DatasetSheet: Identifiable {
  case create, join
  case delete(DatasetRow, records: Int?)

  var id: String {
    switch self {
    case .create: "create"
    case .join: "join"
    case .delete(let dataset, _): "delete-\(dataset.id)"
    }
  }
}

/// The workspace's datasets, the picked one beside the list on wide windows (the Kotlin `DatasetsScreen`):
/// who a new one is shared with, create (and a join collection between two), and each dataset's records
/// count, fields, sharing and what references it, with its records, schema, export and delete.
struct DatasetsScreen: View {
  let context: NativePluginContext
  var initialDatasetID: String?

  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif
  @State private var model = DatasetsModel()
  @State private var runner = PluginActionRunner(roleHint: "an owner, admin or editor")
  @State private var selection: String?
  @State private var pushed: String?
  @State private var sheet: DatasetSheet?
  @State private var exporting: TransferExportRequest?

  private var canWrite: Bool { orgWriterRoles.contains(context.orgRole ?? "") }

  private var api: DataAPI? {
    context.orgID.map { DataAPI(api: context.api, writer: context.writer, orgID: $0) }
  }

  var body: some View {
    Group {
      if let orgID = context.orgID {
        layout(orgID)
      } else {
        AglynEmptyState("Pick a workspace to see its data", systemImage: DataSymbols.dataset)
      }
    }
    .navigationTitle("Data")
  }

  private func layout(_ orgID: String) -> some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          list(selectable: true).frame(minWidth: 300, idealWidth: 360, maxWidth: 420)
          Divider()
          Group {
            if let selection {
              detail(selection, titled: false).id(selection)
            } else {
              AglynEmptyState("Pick a dataset to see it here", systemImage: DataSymbols.dataset)
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        list(selectable: false)
      }
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          runner.clear()
          sheet = .create
        } label: {
          Label("New dataset", systemImage: "plus")
        }
        .disabled(!canWrite)
        .keyboardShortcut("n", modifiers: .command)
        .accessibilityIdentifier("add-dataset")
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
    .sensoryFeedback(.success, trigger: runner.notice) { _, notice in notice != nil }
    .sheet(item: $sheet) { sheet in sheetView(sheet) }
    .sheet(item: $exporting) { request in
      TransferExportSheet(context: context, request: request) { message in
        exporting = nil
        if let message { runner.notice = message }
      }
    }
    .task(id: orgID) {
      model.start(context, orgID: orgID)
      if let initialDatasetID {
        selection = initialDatasetID
        if !isWide { pushed = initialDatasetID }
      }
    }
    .onChange(of: model.access.state) { _, _ in model.refresh() }
    .onDisappear { model.stop() }
  }

  private var isWide: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }

  // MARK: The list

  @ViewBuilder
  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      if sheet == nil, exporting == nil, let error = runner.error {
        AglynNotice(error, tone: .error) { runner.clear() }.padding(.horizontal, AglynSpace.two)
      }
      // The org Data page's note: a dataset made here names no site, so it starts on All sites.
      AglynNotice(newDatasetSharingNote(siteOnly: false), tone: .neutral)
        .padding(.horizontal, AglynSpace.two).padding(.vertical, AglynSpace.one)
      content(selectable: selectable)
    }
    .background(AglynColor.page)
  }

  @ViewBuilder
  private func content(selectable: Bool) -> some View {
    if !model.ready {
      List { SkeletonRows(count: 5) }.aglynListBackground()
    } else if model.failed {
      AglynEmptyState(
        "Could not load datasets", systemImage: "exclamationmark.triangle",
        message: "Check the connection and try again.")
    } else if model.rows.isEmpty {
      let scoped = model.access.orgWide == false && (model.access.listScopeTokens ?? []).isEmpty
      AglynEmptyState(
        scoped ? "No datasets are shared with you" : "No datasets yet", systemImage: DataSymbols.dataset,
        message: scoped
          ? "Ask an owner or admin to share a dataset with one of your sites."
          : "Create a dataset (e.g. Products) and repeat a component over its records with {{item.field}} bindings."
      ) {
        if !scoped && canWrite { Button("New dataset") { sheet = .create }.buttonStyle(.borderedProminent) }
      }
    } else if selectable {
      List(selection: $selection) { rows(selectable: true) }
        .sensoryFeedback(.selection, trigger: selection)
        .aglynListBackground()
        .accessibilityIdentifier("datasets-list")
    } else {
      List { rows(selectable: false) }
        .aglynListBackground()
        .accessibilityIdentifier("datasets-list")
    }
  }

  @ViewBuilder
  private func rows(selectable: Bool) -> some View {
    ForEach(model.rows) { row in
      Group {
        if selectable {
          DatasetListRow(row: row).tag(row.id)
        } else {
          Button {
            pushed = row.id
          } label: {
            HStack {
              DatasetListRow(row: row)
              Image(systemName: "chevron.right").font(AglynFont.caption.weight(.semibold)).foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            }
          }
          .buttonStyle(.plain)
        }
      }
      .aglynListRow()
      .accessibilityIdentifier("dataset-\(row.id)")
    }
    if model.rows.count >= 2 {
      Button("Add join collection") {
        runner.clear()
        sheet = .join
      }
      .disabled(!canWrite)
      .frame(maxWidth: .infinity)
      .aglynListRow()
      .accessibilityIdentifier("add-join")
    }
  }

  private func detail(_ id: String, titled: Bool) -> some View {
    DatasetDetailView(
      context: context, datasets: model.rows, datasetID: id, titled: titled, canWrite: canWrite, runner: runner,
      onDelete: { dataset, records in
        runner.clear()
        sheet = .delete(dataset, records: records)
      },
      onExport: { dataset in
        exporting = TransferExportRequest(
          resource: datasetTransferResource(dataset.id), title: "Export \(dataset.name)", hostID: nil,
          scope: ["kind": "all"], fileStem: dataset.name.isEmpty ? dataset.id : dataset.name)
      })
  }

  // MARK: Sheets

  @ViewBuilder
  private func sheetView(_ sheet: DatasetSheet) -> some View {
    switch sheet {
    case .create:
      NewDatasetSheet(runner: runner) { name, columns in
        guard let api else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        runner.run(success: "Dataset \"\(trimmed)\" created.", onDone: { self.sheet = nil }) {
          let id = try await api.createDataset(name: name, columns: columns, hostID: nil)
          open(id)
        }
      }
    case .join:
      NewJoinSheet(datasets: model.rows, runner: runner) { first, second in
        guard let api else { return }
        runner.run(success: "Join collection created.", onDone: { self.sheet = nil }) {
          let id = try await api.createJoin(first, second, hostID: nil)
          open(id)
        }
      }
    case .delete(let dataset, let records):
      AglynActionSheet(
        "Delete this collection?",
        message: "\"\(dataset.name)\""
          + ((records ?? 0) > 0 ? " and its \(records ?? 0) document\(records == 1 ? "" : "s")" : "")
          + " stop resolving in repeatable components and bindings that reference it.",
        confirmLabel: "Delete", destructive: true, busy: runner.busy, error: runner.error,
        onCancel: { self.sheet = nil },
        onConfirm: {
          guard let api else { return }
          // The org Data page's delete: it names no site, so it is the workspace-wide one.
          runner.run(success: "Dataset deleted.", onDone: {
            self.sheet = nil
            if selection == dataset.id { selection = nil }
            pushed = nil
          }) {
            try await api.deleteDataset(dataset.id, hostID: nil)
          }
        }
      ) { EmptyView() }
    }
  }

  private func open(_ id: String) {
    selection = id
    if !isWide { pushed = id }
  }
}

struct DatasetListRow: View {
  let row: DatasetRow

  var body: some View {
    let count = (row.model.order ?? []).count
    AglynRow(
      row.name, subtitle: "\(count == 1 ? "1 field" : "\(count) fields") · \(describeScope(row.visibleTo))",
      systemImage: DataSymbols.dataset)
  }
}

private struct NewDatasetSheet: View {
  let runner: PluginActionRunner
  let confirm: (String, String) -> Void
  @State private var name = ""
  @State private var columns = ""
  @Environment(\.dismiss) private var dismiss

  private var entries: [DatasetFieldEntry] { parseDatasetFieldEntries(columns) }

  var body: some View {
    AglynActionSheet(
      "New dataset", message: newDatasetSharingNote(siteOnly: false), confirmLabel: "Create",
      confirmEnabled: !name.trimmingCharacters(in: .whitespaces).isEmpty && !entries.isEmpty, busy: runner.busy,
      error: runner.error, onCancel: { dismiss() }, onConfirm: { confirm(name, columns) }
    ) {
      TextField("Name (e.g. Products, Team, FAQ)", text: $name)
        .onChange(of: name) { _, text in if text.count > 80 { name = String(text.prefix(80)) } }
        .accessibilityIdentifier("dataset-name")
      TextField("Fields", text: $columns, axis: .vertical)
        .accessibilityIdentifier("dataset-fields")
      Text(entries.isEmpty ? "Comma-separated column names, e.g. Title, Unit price" : "Columns: " + entries.map(\.name).joined(separator: ", "))
        .font(AglynFont.caption).foregroundStyle(.secondary)
    }
  }
}

private struct NewJoinSheet: View {
  let datasets: [DatasetRow]
  let runner: PluginActionRunner
  let confirm: (DatasetRow, DatasetRow) -> Void
  @State private var first = ""
  @State private var second = ""
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    AglynActionSheet(
      "New join collection", message: "Links two collections many-to-many; each row pairs one document from each side.",
      confirmLabel: "Create", confirmEnabled: !first.isEmpty && !second.isEmpty && first != second, busy: runner.busy,
      error: runner.error, onCancel: { dismiss() },
      onConfirm: {
        if let a = datasets.first(where: { $0.id == first }), let b = datasets.first(where: { $0.id == second }) { confirm(a, b) }
      }
    ) {
      Picker("First collection", selection: $first) {
        Text("Choose…").tag("")
        ForEach(datasets) { Text($0.name).tag($0.id) }
      }
      Picker("Second collection", selection: $second) {
        Text("Choose…").tag("")
        ForEach(datasets) { Text($0.name).tag($0.id) }
      }
    }
  }
}

/// One dataset, live: its record count, fields, sharing and references, with its records, schema, export and delete.
struct DatasetDetailView: View {
  let context: NativePluginContext
  let datasets: [DatasetRow]
  let datasetID: String
  var titled = true
  let canWrite: Bool
  let runner: PluginActionRunner
  let onDelete: (DatasetRow, Int?) -> Void
  let onExport: (DatasetRow) -> Void

  @State private var records: Int?

  private var dataset: DatasetRow? { datasets.first { $0.id == datasetID } }

  var body: some View {
    Group {
      if let dataset {
        content(dataset)
      } else if datasets.isEmpty {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      } else {
        AglynEmptyState(
          "This dataset is gone", systemImage: DataSymbols.dataset,
          message: "It was deleted, or it is no longer shared with you.")
      }
    }
    .navigationTitle(titled ? (dataset?.name ?? "Dataset") : "Data")
  }

  private func content(_ dataset: DatasetRow) -> some View {
    let now = Date()
    let referencedBy = dataset.referencedBy(datasets.filter { $0.id != dataset.id })
    return Form {
      if titled, let error = runner.error {
        Section { AglynNotice(error, tone: .error) { runner.clear() } }
      } else if titled, let notice = runner.notice {
        Section { AglynNotice(notice, tone: .success) { runner.clear() } }
      }
      Section {
        HStack(alignment: .top) {
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Text(dataset.name).font(AglynFont.title2).accessibilityAddTraits(.isHeader)
            if !dataset.singular.trimmingCharacters(in: .whitespaces).isEmpty {
              Text("One record is a \(dataset.singular)").font(AglynFont.subheadline).foregroundStyle(.secondary)
            }
          }
          Spacer(minLength: AglynSpace.one)
          Menu {
            Button { context.navigate(dataSchemaScreen, ["dataset": dataset.id]) } label: {
              Label("Edit schema", systemImage: "tablecells")
            }
            .disabled(!canWrite)
            Button { onExport(dataset) } label: { Label("Export records", systemImage: "square.and.arrow.down") }
              .disabled((records ?? 1) == 0)
            Divider()
            Button(role: .destructive) { onDelete(dataset, records) } label: { Label("Delete dataset", systemImage: "trash") }
              .disabled(!canWrite)
          } label: {
            Label("More", systemImage: "ellipsis.circle").labelStyle(.iconOnly).imageScale(.large)
          }
          .menuStyle(.borderlessButton)
          .fixedSize()
          .accessibilityLabel("More actions")
          .accessibilityIdentifier("dataset-actions")
        }
        AglynWrapRow(spacing: AglynSpace.one, lineSpacing: AglynSpace.half) {
          StatusChip("Shared with \(describeScope(dataset.visibleTo))", tone: dataset.visibleTo == nil ? .warning : .info)
          if !referencedBy.isEmpty {
            StatusChip(referencedBy.count == 1 ? "Referenced by 1 field" : "Referenced by \(referencedBy.count) fields")
          }
        }
        AglynWrapRow {
          Button {
            context.navigate(dataRecordsScreen, ["dataset": dataset.id])
          } label: {
            Label("Records", systemImage: DataSymbols.records)
          }
          .buttonStyle(.borderedProminent)
          .accessibilityIdentifier("dataset-records")
          Button {
            context.navigate(dataRecordsScreen, ["dataset": dataset.id, "new": "1"])
          } label: {
            Label("Add record", systemImage: "plus")
          }
          .buttonStyle(.bordered)
          .disabled(!canWrite)
          .accessibilityIdentifier("dataset-add-record")
        }
      }
      Section {
        AglynCardGrid(minimum: 140, maxColumns: 2, spacing: AglynSpace.one) {
          AglynFigureTile("Records", value: records.map(String.init) ?? "—", caption: "In the whole dataset")
          AglynFigureTile(
            "Fields", value: "\((dataset.model.order ?? []).count)",
            caption: dataset.updatedAt.map { "Changed " + relativeTime($0, now: now) })
        }
        .listRowInsets(EdgeInsets(top: AglynSpace.one, leading: AglynSpace.one, bottom: AglynSpace.one, trailing: AglynSpace.one))
      }
      Section {
        if dataset.model.orderedFields.isEmpty { Text("This dataset has no fields yet.").foregroundStyle(.secondary) }
        ForEach(dataset.model.orderedFields, id: \.id) { id, field in
          AglynRow(field.label(id), subtitle: fieldSummary(id, field, datasets), systemImage: fieldSymbol(field)) {
            if field.required == true { StatusChip("Required", tone: .info) }
          }
          .accessibilityIdentifier("dataset-field-\(id)")
        }
      } header: {
        HStack {
          Text("Fields")
          Spacer()
          if canWrite {
            Button("Edit") { context.navigate(dataSchemaScreen, ["dataset": dataset.id]) }.textCase(nil)
          }
        }
      }
      if !referencedBy.isEmpty {
        Section("Referenced by") {
          ForEach(referencedBy, id: \.dataset.id) { other, fieldID in
            Button {
              context.navigate(dataDatasetsScreen, ["dataset": other.id])
            } label: {
              AglynRow(
                other.name, subtitle: "Its \(other.model.fields?[fieldID]?.label(fieldID) ?? fieldID) field points here",
                systemImage: DataSymbols.link)
            }
            .buttonStyle(.plain)
          }
        }
      }
      Section("Details") {
        AglynDetailRow("Dataset id", value: dataset.id)
        AglynDetailRow("Plural name", value: dataset.plural.isEmpty ? nil : dataset.plural)
        AglynDetailRow("Singular name", value: dataset.singular.isEmpty ? nil : dataset.singular)
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .accessibilityIdentifier("dataset-detail")
    .task(id: "\(dataset.id)-\(dataset.updatedAt?.timeIntervalSince1970 ?? 0)") {
      guard let orgID = context.orgID else { return }
      records = try? await context.firestore.count(FirestoreQuery(recordsPath(orgID, dataset.id)))
    }
  }
}
