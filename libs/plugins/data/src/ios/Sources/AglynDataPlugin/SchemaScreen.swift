// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// A site of the workspace, for naming and picking a dataset's sharing.
private struct SiteChoice: Identifiable, Hashable {
  let id: String
  let name: String
}

/// One field being edited; `fieldID` nil for a new one.
private struct FieldDraft: Identifiable {
  let id = UUID()
  var fieldID: String?
  var definition: DatasetFieldDefinition
  var optionsText: String
  var idDraft: String
  var idTouched: Bool
}

private enum SchemaSheet: Identifiable {
  case field(FieldDraft)
  case remove(String)
  case typeChange(FieldDraft)
  case narrow([String])

  var id: String {
    switch self {
    case .field(let draft): "field-\(draft.id)"
    case .remove(let id): "remove-\(id)"
    case .typeChange(let draft): "type-\(draft.id)"
    case .narrow: "narrow"
    }
  }
}

/// A dataset's schema, as the Schema dialog edits it: its singular and plural names, who it is shared with
/// (an org-wide member only), and its fields: add, edit (type, required, default, description, validation,
/// reference target), reorder and remove. Saving writes the model whole, as the dialog does; stored records
/// are never rewritten.
struct SchemaScreen: View {
  let context: NativePluginContext
  let datasetID: String
  @State private var live = LiveDocument()
  @State private var datasets = DatasetsModel()

  var body: some View {
    Group {
      if let orgID = context.orgID {
        switch live.state {
        case .loading: List { SkeletonRows(count: 6) }.aglynListBackground()
        case .failed:
          AglynEmptyState(
            "Could not load this dataset", systemImage: "exclamationmark.triangle", message: "It may no longer be shared with you.")
        case .ready(let doc):
          if let doc {
            // Seeded once from the stored dataset; the save writes what is edited here.
            SchemaEditor(context: context, orgID: orgID, dataset: DatasetRow(doc), datasets: datasets.rows, access: datasets.access.state)
              .id(doc.id)
          } else {
            AglynEmptyState("This dataset is gone", systemImage: DataSymbols.dataset)
          }
        }
      } else {
        AglynEmptyState("Pick a workspace to see its data", systemImage: DataSymbols.dataset)
      }
    }
    .navigationTitle("Schema")
    .aglynTask(id: "\(context.orgID ?? "")-\(datasetID)") {
      if let orgID = context.orgID { await live.bind(context.firestore, datasetsPath(orgID) + [datasetID]) }
    }
    .task(id: context.orgID) {
      if let orgID = context.orgID { datasets.start(context, orgID: orgID) }
    }
    .onChange(of: datasets.access.state) { _, _ in datasets.refresh() }
    .onDisappear { datasets.stop() }
  }
}

private struct SchemaEditor: View {
  let context: NativePluginContext
  let orgID: String
  let dataset: DatasetRow
  let datasets: [DatasetRow]
  let access: OrgAccessModel.State

  @State private var runner = PluginActionRunner(roleHint: "an owner, admin or editor")
  @State private var model: DatasetModel
  @State private var singular: String
  @State private var plural: String
  @State private var visibleTo: [String]
  @State private var sheet: SchemaSheet?
  @State private var records = 0
  @State private var sites: [SiteChoice] = []
  @State private var sitesQuery = LiveQuery()

  init(context: NativePluginContext, orgID: String, dataset: DatasetRow, datasets: [DatasetRow], access: OrgAccessModel.State) {
    self.context = context
    self.orgID = orgID
    self.dataset = dataset
    self.datasets = datasets
    self.access = access
    _model = State(initialValue: dataset.model)
    _singular = State(initialValue: dataset.singular)
    _plural = State(initialValue: dataset.plural)
    _visibleTo = State(initialValue: dataset.visibleTo ?? [])
  }

  private var canWrite: Bool { orgWriterRoles.contains(context.orgRole ?? "") }
  private var orgWide: Bool { if case .ready(let wide, _) = access { wide } else { false } }
  private var accessKnown: Bool { if case .ready = access { true } else { false } }
  private var previousScope: [String] { dataset.visibleTo ?? [] }
  private var scopeChanged: Bool { previousScope.sorted() != visibleTo.sorted() }
  private var api: DataAPI { DataAPI(api: context.api, writer: context.writer, orgID: orgID) }

  var body: some View {
    Form {
      if sheet == nil, let error = runner.error { Section { AglynNotice(error, tone: .error) } }
      if !canWrite { Section { AglynNotice("Changing a schema needs the editor role.", tone: .warning) } }
      Section("Names") {
        TextField("Singular name (e.g. Product)", text: $singular).accessibilityIdentifier("schema-singular")
        TextField("Plural name (e.g. Products, shown as the title)", text: $plural).accessibilityIdentifier("schema-plural")
      }
      sharing
      Section {
        let fields = model.orderedFields
        if fields.isEmpty { Text("A collection needs at least one field.").foregroundStyle(.secondary) }
        ForEach(Array(fields.enumerated()), id: \.element.id) { index, entry in
          fieldRow(index: index, count: fields.count, id: entry.id, field: entry.field)
        }
      } header: {
        HStack {
          Text("Fields")
          Spacer()
          Button("Add field") {
            sheet = .field(FieldDraft(fieldID: nil, definition: DatasetFieldDefinition(name: "", type: .text), optionsText: "", idDraft: "", idTouched: false))
          }
          .textCase(nil)
          .disabled(!canWrite)
          .accessibilityIdentifier("add-field")
        }
      }
      Section {
        Button {
          saveTapped()
        } label: {
          if runner.busy { ProgressView() } else { Text("Save schema") }
        }
        .disabled(!canWrite || runner.busy)
        .accessibilityIdentifier("schema-save")
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
    .accessibilityIdentifier("schema-editor")
    .sheet(item: $sheet) { sheetView($0) }
    .task(id: dataset.id) {
      records = (try? await context.firestore.count(FirestoreQuery(recordsPath(orgID, dataset.id)))) ?? 0
    }
    .aglynTask(id: "\(orgID)-\(context.uid)") {
      await sitesQuery.bind(
        context.firestore,
        FirestoreQuery(["users", context.uid, "hostMemberships"], equals: [("orgId", orgID)], limit: 200))
    }
    .onChange(of: sitesQuery.state.value?.count) { _, _ in
      sites = (sitesQuery.state.value ?? []).map {
        SiteChoice(id: $0.id, name: $0.string("displayName") ?? $0.string("subdomain") ?? $0.id)
      }
    }
  }

  // MARK: Sharing

  @ViewBuilder
  private var sharing: some View {
    Section("Shared with") {
      if !accessKnown {
        Text("Checking your access…").foregroundStyle(.secondary)
      } else if !orgWide {
        Text(describeScope(dataset.visibleTo, hostNames: Dictionary(uniqueKeysWithValues: sites.map { ($0.id, $0.name) }))
          + ". Only an owner, an admin or a member with every site can change this.")
          .foregroundStyle(.secondary)
      } else {
        let all = visibleTo.contains(OrgAccess.orgScopeToken)
        if dataset.visibleTo == nil {
          AglynNotice("Not shared with any site: no page can show it until you choose.", tone: .warning)
        }
        Picker("Shared with", selection: Binding(get: { all ? "org" : "hosts" }, set: { picked in
          visibleTo = picked == "org" ? [OrgAccess.orgScopeToken] : visibleTo.filter { $0 != OrgAccess.orgScopeToken }
        })) {
          Text("All sites").tag("org")
          Text("Selected sites…").tag("hosts")
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("schema-scope")
        if !all {
          if sites.isEmpty { Text("No sites to pick from.").foregroundStyle(.secondary) }
          ForEach(sites) { site in
            let token = OrgAccess.hostScopeToken(site.id)
            Toggle(site.name, isOn: Binding(get: { visibleTo.contains(token) }, set: { on in
              if on { visibleTo.append(token) } else { visibleTo.removeAll { $0 == token } }
            }))
            .accessibilityIdentifier("scope-\(site.id)")
          }
        }
      }
    }
  }

  // MARK: Fields

  private func fieldRow(index: Int, count: Int, id: String, field: DatasetFieldDefinition) -> some View {
    AglynRow(field.label(id), subtitle: fieldSummary(id, field, datasets), systemImage: fieldSymbol(field)) {
      HStack(spacing: AglynSpace.half) {
        if field.required == true { StatusChip("Required", tone: .info) }
        Menu {
          Button { model = moveField(model, id, -1) } label: { Label("Move up", systemImage: "arrow.up") }
            .disabled(index == 0)
          Button { model = moveField(model, id, 1) } label: { Label("Move down", systemImage: "arrow.down") }
            .disabled(index >= count - 1)
          Button {
            sheet = .field(FieldDraft(fieldID: id, definition: field, optionsText: (field.validation?.options ?? []).joined(separator: ", "), idDraft: id, idTouched: true))
          } label: { Label("Edit", systemImage: "pencil") }
          Divider()
          Button(role: .destructive) { sheet = .remove(id) } label: { Label("Remove", systemImage: "trash") }
        } label: {
          Image(systemName: "ellipsis.circle")
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .disabled(!canWrite)
        .accessibilityLabel("More for \(field.label(id))")
      }
    }
    .accessibilityIdentifier("schema-field-\(id)")
  }

  private func saveTapped() {
    if orgWide && scopeChanged && narrowsScope(previousScope, visibleTo) {
      let names = Dictionary(uniqueKeysWithValues: sites.map { ($0.id, $0.name) })
      let losing = sites.map(\.id).filter { id in
        let token = OrgAccess.hostScopeToken(id)
        return (previousScope.contains(OrgAccess.orgScopeToken) || previousScope.contains(token))
          && !(visibleTo.contains(OrgAccess.orgScopeToken) || visibleTo.contains(token))
      }.map { names[$0] ?? $0 }
      sheet = .narrow(losing)
    } else {
      save()
    }
  }

  private func save() {
    if (model.order ?? []).isEmpty {
      runner.error = "A collection needs at least one field"
      return
    }
    var scopeWrite: [String]?
    if orgWide && scopeChanged {
      let stored = scopeToStore(visibleTo)
      if let problem = stored.problem {
        runner.error = problem
        return
      }
      scopeWrite = stored.scope
    }
    let model = model, singular = singular, plural = plural
    runner.run(success: "Schema saved.", onDone: { context.back() }) {
      try await api.saveSchema(dataset, model: model, singular: singular, plural: plural, visibleTo: scopeWrite)
    }
  }

  // MARK: Sheets

  @ViewBuilder
  private func sheetView(_ sheet: SchemaSheet) -> some View {
    switch sheet {
    case .field(let draft):
      FieldEditorSheet(start: draft, model: model, datasets: datasets) { done in
        let definition = finishDefinition(done)
        let previous = done.fieldID.flatMap { model.fields?[$0] }
        if done.fieldID != nil, records > 0, let previous, previous.type != definition.type {
          self.sheet = .typeChange(done)
        } else {
          model = putField(model, done.fieldID ?? done.idDraft.trimmingCharacters(in: .whitespaces), definition)
          self.sheet = nil
        }
      } onCancel: {
        self.sheet = nil
      }
    case .typeChange(let draft):
      AglynActionSheet(
        "Change field type?",
        message: "\(records) document\(records == 1 ? "" : "s") exist. Stored values are not rewritten — ones that no longer match \"\(typeLabel(finishDefinition(draft)))\" will be flagged when documents are next edited.",
        confirmLabel: "Change type", busy: false, error: nil, onCancel: { self.sheet = .field(draft) },
        onConfirm: {
          if let id = draft.fieldID { model = putField(model, id, finishDefinition(draft)) }
          self.sheet = nil
        }
      ) { EmptyView() }
    case .remove(let id):
      AglynActionSheet(
        "Remove field \"\(model.fields?[id]?.label(id) ?? id)\"?",
        message: "Existing documents keep their stored value until they are next saved (it is stripped then). Bindings using this field stop resolving.",
        confirmLabel: "Remove", destructive: true, busy: false, error: nil, onCancel: { self.sheet = nil },
        onConfirm: {
          var fields = model.fields ?? [:]
          fields[id] = nil
          model = DatasetModel(fields: fields, order: (model.order ?? []).filter { $0 != id })
          self.sheet = nil
        }
      ) { EmptyView() }
    case .narrow(let losing):
      AglynActionSheet(
        "Limit which sites can use this collection?",
        message: losing.isEmpty
          ? "No site loses access, so nothing breaks today."
          : "\(losing.joined(separator: ", ")) will stop seeing this collection. Pages that repeat over it will render nothing. No data is deleted.",
        confirmLabel: "Limit access", busy: false, error: nil, onCancel: { self.sheet = nil },
        onConfirm: {
          self.sheet = nil
          save()
        }
      ) { EmptyView() }
    }
  }
}

private func moveField(_ model: DatasetModel, _ fieldID: String, _ delta: Int) -> DatasetModel {
  var order = model.order ?? []
  guard let index = order.firstIndex(of: fieldID) else { return model }
  let target = index + delta
  guard target >= 0, target < order.count else { return model }
  order.remove(at: index)
  order.insert(fieldID, at: target)
  return DatasetModel(fields: model.fields, order: order)
}

private func putField(_ model: DatasetModel, _ fieldID: String, _ definition: DatasetFieldDefinition) -> DatasetModel {
  var fields = model.fields ?? [:]
  fields[fieldID] = definition
  var order = model.order ?? []
  if !order.contains(fieldID) { order.append(fieldID) }
  return DatasetModel(fields: fields, order: order)
}

/// The definition a draft saves (`handleFieldSave`): trimmed, empty parts dropped, the options from their text.
private func finishDefinition(_ draft: FieldDraft) -> DatasetFieldDefinition {
  var definition = draft.definition
  let options = draft.optionsText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
  var validation = definition.validation ?? DatasetFieldValidation()
  validation.options = options.isEmpty ? nil : options
  let empty = validation.options == nil && validation.regex == nil && validation.min == nil && validation.max == nil
    && validation.required == nil
  definition.name = (definition.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  let description = definition.description?.trimmingCharacters(in: .whitespacesAndNewlines)
  definition.description = description?.isEmpty == true ? nil : description
  definition.validation = empty ? nil : validation
  return definition
}

private struct FieldEditorSheet: View {
  let model: DatasetModel
  let datasets: [DatasetRow]
  let onDone: (FieldDraft) -> Void
  let onCancel: () -> Void
  @State private var draft: FieldDraft

  init(start: FieldDraft, model: DatasetModel, datasets: [DatasetRow], onDone: @escaping (FieldDraft) -> Void, onCancel: @escaping () -> Void) {
    self.model = model
    self.datasets = datasets
    self.onDone = onDone
    self.onCancel = onCancel
    _draft = State(initialValue: start)
  }

  private var isNew: Bool { draft.fieldID == nil }
  private var taken: [String] { model.order ?? [] }
  private var idError: String? { isNew ? validateDatasetFieldId(draft.idDraft, taken: taken) : nil }
  private var authorable: [DatasetFieldType] { ContractValues.shared.datasetAuthorableFieldTypes }
  private var types: [DatasetFieldType] {
    !isNew && !authorable.contains(draft.definition.type ?? .text) ? ContractValues.shared.datasetFieldTypes : authorable
  }
  private var canDone: Bool {
    !(draft.definition.name ?? "").trimmingCharacters(in: .whitespaces).isEmpty && idError == nil
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Display name", text: Binding(get: { draft.definition.name ?? "" }, set: { name in
            draft.definition.name = name
            if isNew && !draft.idTouched { draft.idDraft = defaultDatasetFieldId(name, taken: taken) }
          }))
          .accessibilityIdentifier("field-name")
          TextField("Reference ID", text: Binding(get: { draft.idDraft }, set: { text in
            draft.idDraft = text.filter { $0.isLetter || $0.isNumber || $0 == "_" }
            draft.idTouched = true
          }))
          .disabled(!isNew)
          if isNew, let idError, !draft.idDraft.isEmpty {
            Text(idError).font(AglynFont.caption).foregroundStyle(AglynColor.error)
          } else {
            Text(isNew ? "Bindings use {{item.\(draft.idDraft.isEmpty ? "id" : draft.idDraft)}}; it cannot change later" : "Fixed once a field exists")
              .font(AglynFont.caption).foregroundStyle(.secondary)
          }
          TextField("Description", text: Binding(get: { draft.definition.description ?? "" }, set: { draft.definition.description = $0 }), axis: .vertical)
        } footer: {
          Text("Shown to people editing records and wherever the field appears")
        }
        Section {
          if let customType = draft.definition.customType {
            AglynNotice("A \(customType) field: its type is set by the plugin that declares it.", tone: .neutral)
          } else {
            Picker("Type", selection: Binding(get: { draft.definition.type ?? .text }, set: { draft.definition.type = $0 })) {
              ForEach(types, id: \.rawValue) { Text(ContractValues.shared.datasetFieldTypeLabels[$0.rawValue] ?? $0.rawValue).tag($0) }
            }
          }
          if draft.definition.type == .reference { referenceSection }
          Toggle("Required", isOn: Binding(get: { draft.definition.required == true }, set: { draft.definition.required = $0 ? true : nil }))
          TextField(
            "Default value",
            text: Binding(
              get: { plain(draft.definition.default).map { jsString($0) } ?? "" },
              set: { draft.definition.default = $0.isEmpty ? nil : .string($0) }))
        } footer: {
          Text("Default value is pre-filled when creating documents")
        }
        validationSection
      }
      .formStyle(.grouped)
      .navigationTitle(isNew ? "New field" : "Edit field")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { onDone(draft) }.disabled(!canDone).accessibilityIdentifier("field-done")
        }
      }
    }
    .frame(minWidth: 420, minHeight: 520)
    .accessibilityIdentifier("field-editor")
  }

  @ViewBuilder
  private var referenceSection: some View {
    let reference = draft.definition.reference ?? DatasetFieldDefinitionReference(datasetId: "")
    let target = datasets.first { $0.id == reference.datasetId }
    Picker("Target collection", selection: Binding(get: { reference.datasetId }, set: { id in
      var next = reference
      next.datasetId = id
      next.displayFieldId = nil
      draft.definition.reference = next
    })) {
      Text("Choose…").tag("")
      ForEach(datasets) { Text($0.name).tag($0.id) }
    }
    if let target {
      Picker("Display field", selection: Binding(get: { reference.displayFieldId ?? "" }, set: { id in
        var next = reference
        next.displayFieldId = id.isEmpty ? nil : id
        draft.definition.reference = next
      })) {
        Text("The first field").tag("")
        ForEach(target.model.orderedFields, id: \.id) { Text($0.field.label($0.id)).tag($0.id) }
      }
    }
    Picker("When a referenced document is deleted", selection: Binding(get: { reference.onDelete == .restrict ? "restrict" : "setNull" }, set: { raw in
      var next = reference
      next.onDelete = raw == "restrict" ? .restrict : .setNull
      draft.definition.reference = next
    })) {
      Text("Clear the reference").tag("setNull")
      Text("Block the delete").tag("restrict")
    }
    Toggle("Allow multiple (many-to-many)", isOn: Binding(get: { reference.multiple == true }, set: { on in
      var next = reference
      next.multiple = on
      draft.definition.reference = next
    }))
  }

  @ViewBuilder
  private var validationSection: some View {
    let type = draft.definition.type
    if type == .text || type == .int32 || type == .int64 || type == .float || type == .timestamp {
      Section("Validation") {
        if type == .text {
          TextField("Pattern (regex)", text: Binding(get: { draft.definition.validation?.regex ?? "" }, set: { text in
            var validation = draft.definition.validation ?? DatasetFieldValidation()
            validation.regex = text.isEmpty ? nil : text
            draft.definition.validation = validation
          }))
          TextField("Options (comma-separated, e.g. basic, plus)", text: $draft.optionsText, axis: .vertical)
            .accessibilityIdentifier("field-options")
        }
        let text = type == .text
        boundField(text ? "Min length" : "Min", \.min)
        boundField(text ? "Max length" : "Max", \.max)
      }
    }
  }

  private func boundField(_ label: String, _ key: WritableKeyPath<DatasetFieldValidation, Double?>) -> some View {
    TextField(
      label,
      text: Binding(
        get: { (draft.definition.validation?[keyPath: key]).map(jsNumber) ?? "" },
        set: { typed in
          var validation = draft.definition.validation ?? DatasetFieldValidation()
          validation[keyPath: key] = Double(typed.trimmingCharacters(in: .whitespaces))
          draft.definition.validation = validation
        })
    )
    #if os(iOS)
      .keyboardType(.decimalPad)
    #endif
  }
}
