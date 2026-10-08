// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The sheets the forms screen opens.
enum FormSheet: Identifiable {
  case create
  case rename(FormRow)
  case duplicate(FormRow)

  var id: String {
    switch self {
    case .create: "create"
    case .rename(let form): "rename-\(form.id)"
    case .duplicate(let form): "duplicate-\(form.id)"
    }
  }
}

/// What a form's detail asks the screen to open.
enum FormDetailAction {
  case rename(FormRow), duplicate(FormRow), retire(FormRow), export(FormRow)
}

/// A site's forms, the picked one beside the list on wide windows (the
/// Kotlin `FormsScreen`): search, in use or retired, create and duplicate,
/// and each form's numbers, CRM routing, questions, versions (open in the
/// Besigner, publish), its submissions and their export, and retire or
/// restore.
struct FormsScreen: View {
  let context: NativePluginContext
  var initialFormID: String?

  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif
  @State private var model = FormsModel()
  @State private var role = SiteRoleModel()
  @State private var runner = PluginActionRunner()
  @State private var selection: String?
  @State private var pushed: String?
  @State private var searchText = ""
  @State private var sheet: FormSheet?
  @State private var retiring: FormRow?
  @State private var exporting: TransferExportRequest?

  private var isWide: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }

  private var api: FormsAPI? {
    context.hostID.map { FormsAPI(api: context.api, writer: context.writer, hostID: $0) }
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
              AglynEmptyState("Pick a form to see it here", systemImage: FormsSymbols.form)
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        list(selectable: false)
      }
    }
    .navigationTitle("Forms")
    .searchable(text: $searchText, prompt: "Search forms")
    .onChange(of: searchText) { _, text in model.type(text) }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          runner.clear()
          sheet = .create
        } label: {
          Label("New form", systemImage: "plus")
        }
        .disabled(!role.canEditContent)
        .keyboardShortcut("n", modifiers: .command)
        .accessibilityIdentifier("add-form")
      }
    }
    .navigationDestination(item: $pushed) { id in detail(id, titled: true) }
    .safeAreaInset(edge: .bottom) {
      if sheet == nil && exporting == nil, let notice = runner.notice {
        AglynNotice(notice, tone: .success) { runner.clear() }
          .padding(AglynSpace.two)
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
    }
    .animation(.snappy, value: runner.notice)
    .sensoryFeedback(.success, trigger: runner.notice) { _, notice in notice != nil }
    .sheet(item: $sheet) { sheet in
      if let api { nameSheet(sheet, api: api) }
    }
    .sheet(item: $exporting) { request in
      TransferExportSheet(context: context, request: request) { message in
        exporting = nil
        if let message { runner.notice = message }
      }
    }
    .confirmationDialog(
      retiring.map { $0.retired ? "Bring \($0.name) back?" : "Retire \($0.name)?" } ?? "",
      isPresented: Binding(get: { retiring != nil }, set: { if !$0 { retiring = nil } }), titleVisibility: .visible,
      presenting: retiring
    ) { form in
      Button(form.retired ? "Bring back" : "Retire", role: form.retired ? nil : .destructive) {
        guard let api else { return }
        runner.run(success: form.retired ? "Form brought back." : "Form retired.") {
          try await api.setRetired(form.id, retired: !form.retired)
        }
      }
    } message: { form in
      Text(
        form.retired
          ? "It joins the forms in use again."
          : "It leaves the forms in use. Its submissions are kept, and you can bring it back.")
    }
    .task(id: context.hostID) {
      role.start(context)
      model.start(context.firestore, hostID: context.hostID)
      if let initialFormID {
        selection = initialFormID
        if !isWide { pushed = initialFormID }
      }
    }
    .onDisappear {
      model.stop()
      role.stop()
    }
  }

  // MARK: The list

  private var chips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        ForEach(FormStatusFilter.allCases) { status in
          AglynChoiceChip(status.label, selected: model.status == status) { model.status = status }
            .accessibilityIdentifier("forms-status-\(status.rawValue)")
        }
      }
      .padding(.horizontal, AglynSpace.two)
      .padding(.vertical, AglynSpace.one)
    }
  }

  @ViewBuilder
  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      chips
      if sheet == nil, exporting == nil, retiring == nil, let error = runner.error {
        AglynNotice(error, tone: .error) { runner.clear() }.padding(.horizontal, AglynSpace.two)
      }
      if let notice = model.notice {
        AglynNotice(notice, tone: .info).padding(.horizontal, AglynSpace.two)
      }
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
        "Could not load forms", systemImage: "exclamationmark.triangle",
        message: "Forms could not be loaded. Check the connection and try again."
      ) {
        Button("Try again") { model.retry() }
      }
    } else if model.rows.isEmpty {
      AglynEmptyState(
        model.search.isEmpty && model.status == .inUse ? "No forms yet" : "No forms match", systemImage: FormsSymbols.form,
        message: model.search.isEmpty ? "Add a form, then place it on a page in the Besigner." : "Try another search."
      ) {
        if model.search.isEmpty && model.status == .inUse && role.canEditContent {
          Button("New form") { sheet = .create }.buttonStyle(.borderedProminent)
        }
      }
    } else if selectable {
      List(selection: $selection) { rows(selectable: true) }
        .onChange(of: model.rows, initial: true) { _, rows in
          if selection == nil { selection = rows.first?.id }
        }
        .sensoryFeedback(.selection, trigger: selection)
        .aglynListBackground()
        .accessibilityIdentifier("forms-list")
    } else {
      List { rows(selectable: false) }
        .aglynListBackground()
        .accessibilityIdentifier("forms-list")
    }
  }

  @ViewBuilder
  private func rows(selectable: Bool) -> some View {
    let now = Date()
    ForEach(model.rows) { row in
      Group {
        if selectable {
          FormListRow(row: row, now: now).tag(row.id)
        } else {
          Button {
            pushed = row.id
          } label: {
            HStack {
              FormListRow(row: row, now: now)
              Image(systemName: "chevron.right").font(AglynFont.caption.weight(.semibold)).foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            }
          }
          .buttonStyle(.plain)
        }
      }
      .contextMenu { rowActions(row) }
      .aglynListRow()
      .accessibilityIdentifier("form-\(row.id)")
      .onAppear { if row.id == model.rows.last?.id { model.loadMore() } }
    }
    if model.hasMore {
      Button("Show more forms") { model.loadMore() }
        .frame(maxWidth: .infinity)
        .aglynListRow()
        .accessibilityIdentifier("forms-more")
    }
  }

  @ViewBuilder
  private func rowActions(_ row: FormRow) -> some View {
    Button { handle(.rename(row)) } label: { Label("Rename", systemImage: "pencil") }
      .disabled(!role.canEditContent)
    Button { handle(.duplicate(row)) } label: { Label("Duplicate", systemImage: "plus.square.on.square") }
      .disabled(!role.canEditContent)
    Button { handle(.export(row)) } label: { Label("Export submissions", systemImage: "square.and.arrow.down") }
    Button(role: row.retired ? nil : .destructive) { handle(.retire(row)) } label: {
      Label(row.retired ? "Bring back" : "Retire", systemImage: row.retired ? "tray.and.arrow.up" : "archivebox")
    }
    .disabled(!role.canEditContent)
  }

  // MARK: The detail

  private func detail(_ id: String, titled: Bool) -> some View {
    FormDetailView(context: context, formID: id, runner: runner, role: role, titled: titled, act: handle)
  }

  private func handle(_ action: FormDetailAction) {
    runner.clear()
    switch action {
    case .rename(let form): sheet = .rename(form)
    case .duplicate(let form): sheet = .duplicate(form)
    case .retire(let form): retiring = form
    case .export(let form):
      exporting = TransferExportRequest(
        resource: "forms.submissions", title: "Export \(form.name) submissions", hostID: context.hostID,
        scope: ["kind": "filter", "filter": ["formId": .string(form.id)]], fileStem: "\(form.slug ?? form.id)-submissions",
        filter: ["formId": .string(form.id)])
    }
  }

  /// Opens a form the screen just made: beside the list, or pushed on a phone.
  private func open(_ id: String) {
    selection = id
    if !isWide { pushed = id }
  }

  @ViewBuilder
  private func nameSheet(_ sheet: FormSheet, api: FormsAPI) -> some View {
    switch sheet {
    case .create:
      FormNameSheet(
        title: "New form", message: "Then design its questions in the Besigner and place it on a page.",
        fieldLabel: "Form name", confirmLabel: "Create form", initial: "", runner: runner
      ) { name in
        runner.run(success: "\(name) was added.", onDone: { self.sheet = nil }) {
          let id = try await api.create(name: name)
          open(id)
        }
      }
    case .rename(let form):
      FormNameSheet(
        title: "Rename form", message: nil, fieldLabel: "Form name", confirmLabel: "Save", initial: form.name,
        unchanged: form.name, runner: runner
      ) { name in
        runner.run(success: "Saved.", onDone: { self.sheet = nil }) { try await api.rename(form, name: name) }
      }
    case .duplicate(let form):
      FormNameSheet(
        title: "Duplicate \(form.name)", message: "The copy starts with no submissions.", fieldLabel: "Name of the copy",
        confirmLabel: "Duplicate", initial: "\(form.name) copy", runner: runner
      ) { name in
        runner.run(success: "Copy added.", onDone: { self.sheet = nil }) {
          if let id = try await api.duplicate(sourceID: form.id, name: name) { open(id) }
        }
      }
    }
  }
}

struct FormListRow: View {
  let row: FormRow
  var now = Date()

  var body: some View {
    AglynRow(row.name, subtitle: row.summary(now: now), systemImage: FormsSymbols.form, tint: row.retired ? .secondary : nil) {
      HStack(spacing: AglynSpace.half) {
        if row.routesLeads { StatusChip("Leads", tone: .info) }
        if row.retired { StatusChip("Retired") }
      }
    }
  }
}

/// A name to give: a new form, a rename, a copy.
struct FormNameSheet: View {
  let title: String
  let message: String?
  let fieldLabel: String
  let confirmLabel: String
  let initial: String
  var unchanged: String?
  let runner: PluginActionRunner
  let confirm: (String) -> Void
  @State private var name = ""
  @Environment(\.dismiss) private var dismiss
  @FocusState private var focused: Bool

  init(
    title: String, message: String?, fieldLabel: String, confirmLabel: String, initial: String, unchanged: String? = nil,
    runner: PluginActionRunner, confirm: @escaping (String) -> Void
  ) {
    self.title = title
    self.message = message
    self.fieldLabel = fieldLabel
    self.confirmLabel = confirmLabel
    self.initial = initial
    self.unchanged = unchanged
    self.runner = runner
    self.confirm = confirm
    _name = State(initialValue: initial)
  }

  private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var canConfirm: Bool { !trimmed.isEmpty && trimmed != unchanged && !runner.busy }

  var body: some View {
    NavigationStack {
      Form {
        if let error = runner.error {
          Section { AglynNotice(error, tone: .error) }
        }
        Section {
          TextField(fieldLabel, text: $name)
            .focused($focused)
            .onChange(of: name) { _, text in if text.count > 80 { name = String(text.prefix(80)) } }
            .onSubmit { if canConfirm { confirm(trimmed) } }
            .accessibilityIdentifier("form-name")
        } footer: {
          if let message { Text(message) }
        }
      }
      .formStyle(.grouped)
      .navigationTitle(title)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(runner.busy)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button {
            confirm(trimmed)
          } label: {
            if runner.busy { ProgressView() } else { Text(confirmLabel) }
          }
          .disabled(!canConfirm)
          .accessibilityIdentifier("form-name-confirm")
        }
      }
      .onAppear { focused = true }
    }
    .frame(minWidth: 380, minHeight: 220)
    .presentationDetents([.medium])
  }
}
