// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// A site's Functions & Variables: the variables (typed values bound into text with `{{name}}`), the no-code
/// functions and the reference health audit; each variable and function with where it is used, edit and delete;
/// a new one of either. A function opens in its own editor screen. The Kotlin plugin's LogicScreens.kt.
enum LogicTab: String, CaseIterable, Identifiable {
  case variables = "Variables"
  case functions = "Functions"
  case health = "Reference health"

  var id: String { rawValue }
}

/// A variable being edited; `id` nil for a new one.
struct VariableDraft: Identifiable, Equatable {
  let sheetID = UUID()
  var id: String?
  var name = ""
  var type = HostVariableType.text
  var value = ""
  var workflowID = ""
  var workflowName = ""

  init(id: String? = nil) { self.id = id }

  init(_ row: VariableRow) {
    id = row.id
    name = row.name
    type = row.type
    value = row.value
    workflowID = row.workflowID
    workflowName = row.workflowName
  }

  static func == (a: VariableDraft, b: VariableDraft) -> Bool { a.sheetID == b.sheetID }
}

private enum LogicSheet: Identifiable {
  case editVariable(VariableDraft)
  case delete(kind: String, id: String, name: String, scan: WhereUsedResult)
  case usage(name: String, scan: WhereUsedResult)

  var id: String {
    switch self {
    case .editVariable(let draft): "variable-\(draft.sheetID)"
    case .delete(_, let id, _, _): "delete-\(id)"
    case .usage(_, _): "usage"
    }
  }
}

struct LogicScreen: View {
  let context: NativePluginContext
  @State private var tab: LogicTab
  @State private var runner = PluginActionRunner()
  @State private var sheet: LogicSheet?
  @State private var variablesQuery = LiveQuery()
  @State private var functionsQuery = LiveQuery()

  init(context: NativePluginContext, initialTab: String?) {
    self.context = context
    _tab = State(initialValue: initialTab == "functions" ? .functions : (initialTab == "health" ? .health : .variables))
  }

  private var canEdit: Bool { logicWriteRoles.contains(context.siteRole ?? "") }

  private var api: LogicAPI? {
    context.hostID.map { LogicAPI(api: context.api, writer: context.writer, reader: context.firestore, hostID: $0) }
  }

  private var variables: (rows: [VariableRow], truncated: Bool)? {
    variablesQuery.state.value.map { liveWindow($0, read: VariableRow.init) { $0.name } }
  }

  private var functions: (rows: [FunctionRow], truncated: Bool)? {
    functionsQuery.state.value.map { liveWindow($0, read: FunctionRow.init) { $0.name } }
  }

  var body: some View {
    Group {
      if let hostID = context.hostID, let api {
        VStack(spacing: 0) {
          Picker("Show", selection: $tab) {
            ForEach(LogicTab.allCases) { Text($0.rawValue).tag($0) }
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .aglynContentEdges()
          .padding(.vertical, AglynSpace.one)
          .accessibilityIdentifier("logic-tabs")
          if sheet == nil, let error = runner.error {
            AglynNotice(error, tone: .error) { runner.clear() }.aglynContentEdges()
          }
          content(hostID, api)
        }
        .background(AglynGround())
        .task(id: hostID) {
          variablesQuery.start(context.firestore, ceilingQuery(variablesPath(hostID)))
          functionsQuery.start(context.firestore, ceilingQuery(functionsPath(hostID)))
        }
        .onDisappear {
          variablesQuery.stop()
          functionsQuery.stop()
        }
      } else {
        AglynEmptyState("Pick a site to see its logic", systemImage: "function")
      }
    }
    .navigationTitle("Functions & Variables")
    .aglynScreenTitle("Functions & Variables")
    .aglynPrimaryAction(
      tab == .health
        ? nil
        : AglynPrimaryAction(
          id: "logic-add", title: tab == .variables ? "Add variable" : "Add function", systemImage: "plus", enabled: canEdit
        ) {
          runner.clear()
          if tab == .variables { sheet = .editVariable(VariableDraft()) } else { context.navigate(logicFunctionScreen) }
        })
    .safeAreaInset(edge: .bottom) {
      if sheet == nil, let notice = runner.notice {
        AglynNotice(notice, tone: .success) { runner.clear() }.padding(AglynSpace.two)
      }
    }
    .sheet(item: $sheet) { sheet in sheetView(sheet) }
  }

  @ViewBuilder
  private func content(_ hostID: String, _ api: LogicAPI) -> some View {
    switch tab {
    case .variables:
      if let variables {
        if variables.truncated { cutNotice }
        VariableList(rows: variables.rows, canEdit: canEdit, onEdit: { sheet = .editVariable(VariableDraft($0)) }, onUsage: { row in
          scan(api, "variable", row.id, row.name) { .usage(name: row.name, scan: $0) }
        }, onDelete: { row in
          scan(api, "variable", row.id, row.name) { .delete(kind: "variable", id: row.id, name: row.name, scan: $0) }
        })
      } else if case .failed = variablesQuery.state {
        AglynEmptyState("Could not load this list", systemImage: "exclamationmark.triangle", message: "Check the connection and try again.")
      } else {
        List { SkeletonRows(count: 5) }.aglynListBackground()
      }
    case .functions:
      if let functions {
        if functions.truncated { cutNotice }
        FunctionList(rows: functions.rows, canEdit: canEdit, onEdit: { context.navigate(logicFunctionScreen, ["function": $0.id]) }, onUsage: { row in
          scan(api, "function", row.id, row.name) { .usage(name: row.name, scan: $0) }
        }, onDelete: { row in
          scan(api, "function", row.id, row.name) { .delete(kind: "function", id: row.id, name: row.name, scan: $0) }
        })
      } else if case .failed = functionsQuery.state {
        AglynEmptyState("Could not load this list", systemImage: "exclamationmark.triangle", message: "Check the connection and try again.")
      } else {
        List { SkeletonRows(count: 5) }.aglynListBackground()
      }
    case .health:
      ReferenceHealthView(context: context)
    }
  }

  private var cutNotice: some View {
    AglynNotice("Showing the first \(logicCeiling). Delete ones you no longer use to see the rest.", tone: .info)
      .aglynContentEdges()
  }

  private func scan(_ api: LogicAPI, _ kind: String, _ id: String, _ name: String, open: @escaping (WhereUsedResult) -> LogicSheet) {
    runner.run {
      sheet = open(await api.whereUsed(kind: kind, id: id, name: name))
    }
  }

  @ViewBuilder
  private func sheetView(_ sheet: LogicSheet) -> some View {
    switch sheet {
    case .editVariable(let draft):
      VariableEditorSheet(context: context, start: draft, variables: variables?.rows ?? [], runner: runner) { self.sheet = nil }
    case .usage(let name, let scan):
      UsageSheet(context: context, name: name, scan: scan) { self.sheet = nil }
    case .delete(let kind, let id, let name, let scan):
      let used = scan.total ?? 0
      AglynActionSheet(
        kind == "variable" ? "Delete this variable?" : "Delete this function?",
        message: used > 0
          ? "\"\(name)\" is used in \(summarizeDependents(scan))"
            + (kind == "variable" ? ". Those places show nothing in its place after the next publish." : ". Those places stop working after the next publish.")
          : "\"\(name)\" is not referenced by any published page, layout, or workflow.",
        confirmLabel: "Delete", destructive: true, busy: runner.busy, error: runner.error,
        onCancel: { self.sheet = nil },
        onConfirm: {
          guard let hostID = context.hostID, let api else { return }
          let path = (kind == "variable" ? variablesPath(hostID) : functionsPath(hostID)) + [id]
          runner.run(success: kind == "variable" ? "Variable deleted." : "Function deleted.", onDone: { self.sheet = nil }) { try await api.delete(path) }
        }
      ) {
        EmptyView()
      }
    }
  }
}

private struct VariableList: View {
  let rows: [VariableRow]
  let canEdit: Bool
  let onEdit: (VariableRow) -> Void
  let onUsage: (VariableRow) -> Void
  let onDelete: (VariableRow) -> Void

  var body: some View {
    if rows.isEmpty {
      AglynEmptyState(
        "No variables yet", systemImage: "curlybraces",
        message: "A variable is a value you put into any text with Insert data in the Besigner: a phone number, a price, an opening date. Change it once and every page follows.")
    } else {
      List {
        ForEach(rows) { row in
          Button {
            if canEdit { onEdit(row) } else { onUsage(row) }
          } label: {
            AglynRow(
              row.name, subtitle: "\(ContractValues.shared.hostVariableTypeLabels[row.type.rawValue] ?? row.type.rawValue) · \(formatVariableValue(row.type, row.value).isEmpty ? "—" : formatVariableValue(row.type, row.value))",
              systemImage: "curlybraces"
            ) {
              Menu {
                Button { onUsage(row) } label: { Label("Where it's used", systemImage: "scope") }
                Button { onEdit(row) } label: { Label("Edit", systemImage: "pencil") }.disabled(!canEdit)
                Button(role: .destructive) { onDelete(row) } label: { Label("Delete", systemImage: "trash") }.disabled(!canEdit)
              } label: {
                Image(systemName: "ellipsis.circle").accessibilityLabel("More for \(row.name)")
              }
            }
          }
          .buttonStyle(.plain)
          .aglynListRow()
          .accessibilityIdentifier("variable-\(row.id)")
        }
      }
      .aglynListBackground()
      .accessibilityIdentifier("variables-list")
    }
  }
}

private struct FunctionList: View {
  let rows: [FunctionRow]
  let canEdit: Bool
  let onEdit: (FunctionRow) -> Void
  let onUsage: (FunctionRow) -> Void
  let onDelete: (FunctionRow) -> Void

  var body: some View {
    if rows.isEmpty {
      AglynEmptyState(
        "No functions yet", systemImage: "function",
        message: "Build no-code logic: parameters in, conditional operations, a value out. Wire functions into components and workflows as the builder grows.")
    } else {
      List {
        ForEach(rows) { row in
          Button { onEdit(row) } label: {
            AglynRow(row.name.isEmpty ? row.id : row.name, subtitle: row.signature, systemImage: "function") {
              Menu {
                Button { onUsage(row) } label: { Label("Where it's used", systemImage: "scope") }
                Button { onEdit(row) } label: { Label("Edit", systemImage: "pencil") }.disabled(!canEdit)
                Button(role: .destructive) { onDelete(row) } label: { Label("Delete", systemImage: "trash") }.disabled(!canEdit)
              } label: {
                Image(systemName: "ellipsis.circle").accessibilityLabel("More for \(row.name)")
              }
            }
          }
          .buttonStyle(.plain)
          .aglynListRow()
          .accessibilityIdentifier("function-\(row.id)")
        }
      }
      .aglynListBackground()
      .accessibilityIdentifier("functions-list")
    }
  }
}

/// The where-used scan laid out: each page, layout or record that references it, and a page's Besigner.
private struct UsageSheet: View {
  let context: NativePluginContext
  let name: String
  let scan: WhereUsedResult
  let onClose: () -> Void

  var body: some View {
    NavigationStack {
      List {
        let dependents = scan.dependents ?? []
        Section {
          Text(dependents.isEmpty ? "Nothing published references it." : summarizeDependents(scan)).foregroundStyle(.secondary)
          if (scan.legacyCount ?? 0) > 0 {
            AglynNotice("Some places use it by its name; renaming it breaks those.", tone: .warning)
          }
        }
        ForEach(Array(dependents.enumerated()), id: \.offset) { _, dependent in
          let path = dependentBesignerPath(type: dependent.type, id: dependent.id, versionID: dependent.versionId)
          AglynRow(
            dependent.name.flatMap { $0.isEmpty ? nil : $0 } ?? dependent.id ?? "",
            subtitle: (dependent.type == "screen" ? "page" : (dependent.type ?? "")) + ((dependent.via ?? []).contains { $0.rawValue == "name" } ? " · legacy token" : ""),
            systemImage: dependent.type == "screen" ? "doc.text" : (dependent.type == "layout" ? "rectangle.split.3x1" : "bolt")
          ) {
            if let path {
              Button("Open") { context.openBesigner(path, scope: .site) }.buttonStyle(.borderless)
            }
          }
        }
      }
      .navigationTitle("Where \"\(name)\" is used")
      .aglynScreenTitle("Where \"\(name)\" is used")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done", action: onClose) } }
    }
    .aglynSheetMinimumSize(width: 420, height: 360)
  }
}

private struct VariableEditorSheet: View {
  let context: NativePluginContext
  let variables: [VariableRow]
  let runner: PluginActionRunner
  let onClose: () -> Void
  @State private var draft: VariableDraft
  @State private var workflows = LiveQuery()

  init(context: NativePluginContext, start: VariableDraft, variables: [VariableRow], runner: PluginActionRunner, onClose: @escaping () -> Void) {
    self.context = context
    self.variables = variables
    self.runner = runner
    self.onClose = onClose
    _draft = State(initialValue: start)
  }

  private var validName: Bool { isVariableName(draft.name) }
  private var nameTaken: Bool {
    variables.contains { $0.name.lowercased() == draft.name.trimmingCharacters(in: .whitespaces).lowercased() && $0.id != draft.id }
  }

  private var workflowChoices: [(id: String, name: String)] {
    (workflows.state.value ?? []).prefix(logicCeiling)
      .filter { $0.alive && !($0.string("name") ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
      .map { (id: $0.id, name: ($0.string("name") ?? "").trimmingCharacters(in: .whitespaces)) }
      .sorted { $0.name.lowercased() < $1.name.lowercased() }
  }

  var body: some View {
    NavigationStack {
      Form {
        if let error = runner.error { Section { AglynNotice(error, tone: .error) } }
        Section {
          TextField("Name", text: Binding(get: { draft.name }, set: { draft.name = $0.filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") } }))
            .accessibilityIdentifier("variable-name")
        } footer: {
          Text(
            nameTaken
              ? "A variable with this name already exists"
              : (!draft.name.isEmpty && !validName ? "Start with a letter or _; letters, numbers and _ only, up to 40" : "Pick it by this name from Insert data in the Besigner"))
        }
        Section {
          Picker("Type", selection: Binding(get: { draft.type }, set: { type in
            if type != draft.type {
              draft.type = type
              draft.value = ""
            }
          })) {
            ForEach(HostVariableType.allCases.filter { $0 != .unknown }, id: \.self) {
              Text(ContractValues.shared.hostVariableTypeLabels[$0.rawValue] ?? $0.rawValue).tag($0)
            }
          }
          valueInput
        }
        Section {
          Picker("Filled by workflow", selection: Binding(get: { draft.workflowID }, set: { id in
            draft.workflowID = id
            draft.workflowName = workflowChoices.first { $0.id == id }?.name ?? ""
          })) {
            Text("None").tag("")
            ForEach(workflowChoices, id: \.id) { Text($0.name).tag($0.id) }
          }
        } footer: {
          Text("Optional: a workflow that computes the value; the value above is its fallback")
        }
      }
      .formStyle(.aglynGrouped)
      .navigationTitle(draft.id == nil ? "New variable" : "Edit variable")
      .aglynScreenTitle(draft.id == nil ? "New variable" : "Edit variable")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") {
            runner.error = nil
            onClose()
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button {
            guard let hostID = context.hostID else { return }
            let api = LogicAPI(api: context.api, writer: context.writer, reader: context.firestore, hostID: hostID)
            let current = draft
            runner.run(success: "Saved. Put it into any text with Insert data in the Besigner.", onDone: onClose) {
              try await api.saveVariable(id: current.id, name: current.name, type: current.type, value: current.value, workflowID: current.workflowID, workflowName: current.workflowName)
            }
          } label: {
            if runner.busy { ProgressView() } else { Text("Save") }
          }
          .disabled(!validName || nameTaken || runner.busy)
          .accessibilityIdentifier("variable-save")
        }
      }
      .task(id: context.hostID) {
        if let hostID = context.hostID { await workflows.bind(context.firestore, ceilingQuery(["hosts", hostID, "workflows"])) }
      }
    }
    .aglynSheetMinimumSize(width: 420, height: 480)
    .accessibilityIdentifier("variable-editor")
  }

  /// The value input for a variable's type, as the card's editor draws it.
  @ViewBuilder
  private var valueInput: some View {
    switch draft.type {
    case .boolean:
      Toggle("Value", isOn: Binding(get: { draft.value == "true" }, set: { draft.value = $0 ? "true" : "false" }))
    case .date:
      DayInput(label: "Value", text: $draft.value)
    case .time:
      TextField("Value (HH:mm)", text: $draft.value)
    case .number:
      TextField("Value", text: Binding(get: { draft.value }, set: { draft.value = $0.filter { $0.isNumber || ".eE+-".contains($0) } }))
        #if os(iOS)
          .keyboardType(.decimalPad)
        #endif
    // Rows, never typed JSON (AGL-3757). Keyed by the type so switching type reads its value afresh.
    case .dictionary:
      StructuredValueEditor(shape: .dictionary, value: draft.value) { draft.value = $0 }.id(draft.type)
    case .collection:
      StructuredValueEditor(shape: .collection, value: draft.value) { draft.value = $0 }.id(draft.type)
    default:
      TextField("Value", text: $draft.value, axis: .vertical).lineLimit(2...6)
    }
  }
}

/// A day shown and kept in UTC, as the console's date input holds it (`YYYY-MM-DD`).
private struct DayInput: View {
  let label: String
  @Binding var text: String

  var body: some View {
    if let millis = parseUtcDay(text) {
      HStack {
        DatePicker(
          label,
          selection: Binding(
            get: { Date(timeIntervalSince1970: Double(millis) / 1000) },
            set: { text = utcDay(Int64(($0.timeIntervalSince1970 * 1000).rounded())) }),
          displayedComponents: [.date]
        )
        .environment(\.timeZone, TimeZone(identifier: "UTC") ?? .gmt)
        Button("Clear") { text = "" }.buttonStyle(.borderless)
      }
    } else {
      LabeledContent(label) {
        Button("Set a date") { text = utcDay(Int64((Date().timeIntervalSince1970 * 1000).rounded())) }.buttonStyle(.borderless)
      }
    }
  }
}
