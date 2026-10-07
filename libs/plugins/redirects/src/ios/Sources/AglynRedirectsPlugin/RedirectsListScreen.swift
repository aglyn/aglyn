// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The site's redirect rules; in a wide window the list sits beside the
/// selected rule's detail. A member with a publishing role adds, edits,
/// switches and deletes rules here, through the same checks and writes as the
/// console's Redirects page (`RedirectsEditing.swift`).
struct RedirectsListScreen: View {
  let context: NativePluginContext
  @State private var model = HostRedirectsModel()
  @State private var selection: RedirectRow.ID?
  @State private var editor: RedirectsEditor?

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          list(selectable: true).frame(minWidth: 300, idealWidth: 360, maxWidth: 420)
          Divider()
          RedirectDetail(row: model.rows.first { $0.id == selection }, titled: false, editor: editor)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        list(selectable: false)
      }
    }
    .navigationTitle("Redirects")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          editor?.add()
        } label: {
          Label("Add redirect", systemImage: "plus")
        }
        .disabled(editor == nil)
        .accessibilityIdentifier("redirects-add")
      }
    }
    .safeAreaInset(edge: .bottom) {
      if let notice = editor?.notice {
        AglynNotice(notice, tone: .success) { editor?.notice = nil }
          .padding(AglynSpace.two)
      }
    }
    .sheet(isPresented: Binding(get: { editor?.draft != nil }, set: { if !$0 { editor?.close() } })) {
      if let editor { RedirectEditorSheet(editor: editor) }
    }
    .confirmationDialog(
      "Delete this redirect?", isPresented: Binding(get: { editor?.deleting != nil }, set: { if !$0 { editor?.close() } }),
      titleVisibility: .visible
    ) {
      Button("Delete", role: .destructive) { Task { await editor?.confirmDelete() } }
    } message: {
      Text("\(editor?.deleting?.source ?? "This path") stops redirecting.")
    }
    .task(id: context.hostID) {
      editor = context.hostID.map {
        RedirectsEditor(
          api: ConsoleRedirectsWriteAPI(api: context.api, writer: context.writer, hostID: $0), uid: context.uid)
      }
      model.start(context.firestore, hostID: context.hostID)
    }
    .onDisappear { model.stop() }
  }

  @ViewBuilder
  private func list(selectable: Bool) -> some View {
    if !model.ready {
      List { SkeletonRows(count: 4) }.aglynListBackground()
    } else if model.failed {
      AglynEmptyState("Could not load this site's redirects", systemImage: "exclamationmark.triangle")
    } else if model.rows.isEmpty {
      AglynEmptyState(
        "No redirects yet", systemImage: RedirectsSymbols.rule,
        message: "Send an old address to a new one so visitors and search engines find it."
      ) {
        Button("Add redirect") { editor?.add() }.buttonStyle(.borderedProminent)
      }
    } else if selectable {
      List(model.rows, selection: $selection) { row in
        RedirectListRow(row: row).tag(row.id)
          .contextMenu { rowActions(row) }
      }
      // A wide window never shows an empty detail pane while there are rules.
      .onChange(of: model.rows, initial: true) { _, rows in
        if selection == nil || !rows.contains(where: { $0.id == selection }) { selection = rows.first?.id }
      }
      .sensoryFeedback(.selection, trigger: selection)
      .aglynListBackground()
      .accessibilityIdentifier("redirects-list")
    } else {
      List(model.rows) { row in
        NavigationLink {
          RedirectDetail(row: row, editor: editor)
        } label: {
          RedirectListRow(row: row)
        }
        .swipeActions(edge: .trailing) {
          Button(role: .destructive) { editor?.askDelete(row) } label: { Label("Delete", systemImage: "trash") }
          Button { editor?.edit(row) } label: { Label("Edit", systemImage: "pencil") }
        }
        .swipeActions(edge: .leading) {
          Button { Task { await editor?.toggle(row, !row.isOn) } } label: {
            Label(row.isOn ? "Turn off" : "Turn on", systemImage: row.isOn ? "pause" : "play")
          }
          .tint(row.isOn ? .gray : AglynColor.primary)
        }
        .accessibilityIdentifier("redirect-\(row.id)")
        .aglynListRow()
      }
      .aglynListBackground()
      .accessibilityIdentifier("redirects-list")
    }
  }

  @ViewBuilder
  private func rowActions(_ row: RedirectRow) -> some View {
    Button { editor?.edit(row) } label: { Label("Edit", systemImage: "pencil") }
    Button { Task { await editor?.toggle(row, !row.isOn) } } label: {
      Label(row.isOn ? "Turn off" : "Turn on", systemImage: row.isOn ? "pause" : "play")
    }
    Button(role: .destructive) { editor?.askDelete(row) } label: { Label("Delete", systemImage: "trash") }
  }
}

/// Adding or editing one rule: the page's fields, checked by the server on save.
struct RedirectEditorSheet: View {
  @Bindable var editor: RedirectsEditor

  var body: some View {
    NavigationStack {
      Form {
        if let error = editor.error {
          Section { AglynNotice(error, tone: .error) }
        }
        Section {
          Picker("Match", selection: binding(\.kind)) {
            ForEach(redirectKindChoices, id: \.kind) { Text($0.label).tag($0.kind) }
          }
          TextField(binding(\.kind).wrappedValue == "regex" ? "Pattern, like ^/blog/(.*)$" : "From, like /old-page", text: binding(\.source))
            .autocorrectionDisabled()
            #if os(iOS)
              .textInputAutocapitalization(.never)
              .keyboardType(.URL)
            #endif
            .accessibilityIdentifier("redirect-source")
          TextField("To, like /new-page or https://…", text: binding(\.destination))
            .autocorrectionDisabled()
            #if os(iOS)
              .textInputAutocapitalization(.never)
              .keyboardType(.URL)
            #endif
            .accessibilityIdentifier("redirect-destination")
        }
        Section {
          Picker("Status", selection: binding(\.statusCode)) {
            ForEach(redirectStatusChoices, id: \.code) { Text($0.label).tag($0.code) }
          }
          TextField("Priority (lower runs first, \(Int(HostRedirects.defaultPriority)) if empty)", text: binding(\.priority))
            #if os(iOS)
              .keyboardType(.numberPad)
            #endif
          Toggle("On", isOn: binding(\.enabled))
        }
      }
      .formStyle(.grouped)
      .navigationTitle(editor.draft?.id == nil ? "Add redirect" : "Edit redirect")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { editor.close() }.disabled(editor.busy)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button {
            Task { await editor.save() }
          } label: {
            if editor.busy { ProgressView() } else { Text("Save") }
          }
          .disabled(editor.busy || (editor.draft?.source.isEmpty ?? true) || (editor.draft?.destination.isEmpty ?? true))
          .accessibilityIdentifier("redirect-save")
        }
      }
    }
    .frame(minWidth: 420, minHeight: 420)
  }

  private func binding<Value>(_ key: WritableKeyPath<RedirectDraft, Value>) -> Binding<Value> {
    Binding(
      get: { (editor.draft ?? RedirectDraft())[keyPath: key] },
      set: { value in
        guard var draft = editor.draft else { return }
        draft[keyPath: key] = value
        editor.draft = draft
      })
  }
}

struct RedirectListRow: View {
  let row: RedirectRow

  var body: some View {
    AglynRow(
      row.source, subtitle: "\(row.statusCode) → \(row.destination)",
      systemImage: row.isOn ? RedirectsSymbols.rule : RedirectsSymbols.paused,
      tint: row.isOn ? nil : .secondary
    ) {
      if !row.isOn { StatusChip("Off") }
    }
  }
}

struct RedirectDetail: View {
  let row: RedirectRow?
  /// False beside the list, where the screen's own title stays.
  var titled = true
  var editor: RedirectsEditor?

  var body: some View {
    if let row {
      Form {
        Section {
          LabeledContent("From", value: row.source)
          LabeledContent("Sends visitors to", value: row.destination)
        }
        Section {
          LabeledContent("Status", value: "\(row.statusCode) \(row.statusCode == 301 ? "Permanent" : row.statusCode == 302 ? "Temporary" : "")")
          LabeledContent("Match", value: (row.rule.kind ?? .exact).rawValue.capitalized)
          LabeledContent("Priority", value: row.priority.formatted())
          LabeledContent("State") { StatusChip(row.isOn ? "On" : "Off", tone: row.isOn ? .success : .neutral) }
        }
        if let editor {
          Section {
            Button { editor.edit(row) } label: { Label("Edit", systemImage: "pencil") }
              .accessibilityIdentifier("redirect-edit")
            Button { Task { await editor.toggle(row, !row.isOn) } } label: {
              Label(row.isOn ? "Turn off" : "Turn on", systemImage: row.isOn ? "pause.circle" : "play.circle")
            }
            .disabled(editor.busy)
            Button(role: .destructive) { editor.askDelete(row) } label: { Label("Delete", systemImage: "trash") }
          }
          if let error = editor.error, editor.draft == nil {
            Section { AglynNotice(error, tone: .error) }
          }
        }
      }
      .formStyle(.grouped)
      .aglynListBackground()
      .navigationTitle(titled ? row.source : "Redirects")
    } else {
      AglynEmptyState("Pick a redirect to see it here", systemImage: RedirectsSymbols.rule)
    }
  }
}
