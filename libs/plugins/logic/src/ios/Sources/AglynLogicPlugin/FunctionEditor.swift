// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// One no-code function, as the Functions card's editor builds it: its name, parameters (type, required, and what a
/// visitor sees: label, starting value and choices), working variables, the if/then/otherwise operations of SET rows,
/// the value it returns, and a test run. A new one is created through the quota-enforcing route; an edit is the
/// card's merge, then the site's cache drop. The Kotlin plugin's FunctionEditor.kt.
struct FunctionEditorScreen: View {
  let context: NativePluginContext
  let functionID: String?
  @State private var live = LiveDocument()

  var body: some View {
    Group {
      if context.hostID == nil {
        AglynEmptyState("Pick a site to edit its functions", systemImage: "function")
      } else if let functionID {
        switch live.state {
        case .loading: List { SkeletonRows(count: 6) }.aglynListBackground()
        case .failed:
          AglynEmptyState("Could not load this function", systemImage: "exclamationmark.triangle", message: "Check the connection and try again.")
        case .ready(let doc):
          if let doc, doc.alive {
            // Seeded once from the stored function; Save writes the whole definition, as the card does.
            FunctionEditor(context: context, functionID: functionID, start: FunctionRow(doc).definition).id(doc.id)
          } else {
            AglynEmptyState("This function is gone", systemImage: "function")
          }
        }
      } else {
        FunctionEditor(context: context, functionID: nil, start: emptyFunction())
      }
    }
    .navigationTitle(functionID == nil ? "New function" : "Edit function")
    .aglynScreenTitle(functionID == nil ? "New function" : "Edit function")
    .task(id: "\(context.hostID ?? "")-\(functionID ?? "")") {
      if let hostID = context.hostID, let functionID { await live.bind(context.firestore, functionsPath(hostID) + [functionID]) }
    }
  }
}

private let valueTypes: [FunctionValueType] = [.number, .text, .boolean]

/// The console's input filter for a parameter's or variable's name.
private func nameInput(_ text: String) -> String { text.filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") } }

private struct FunctionEditor: View {
  let context: NativePluginContext
  let functionID: String?
  @State private var draft: HostFunction
  @State private var runner = PluginActionRunner()
  @State private var others = LiveQuery()
  // The site's variables, for the formula builder's value picker: read the first time a builder opens, so an author
  // who never builds a formula costs nothing.
  @State private var siteVariables: [SiteVariableName]?
  @State private var testArgs: [String: String] = [:]
  @State private var testResult: String?

  init(context: NativePluginContext, functionID: String?, start: HostFunction) {
    self.context = context
    self.functionID = functionID
    _draft = State(initialValue: start)
  }

  private var canEdit: Bool { logicWriteRoles.contains(context.siteRole ?? "") }

  private var taken: [String] {
    (others.state.value ?? []).filter { $0.id != functionID && $0.alive }.compactMap { $0.string("name")?.lowercased() }
  }

  private var nameTaken: Bool { taken.contains((draft.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) }
  private var parameters: [HostFunctionParameter] { draft.parameters ?? [] }
  private var locals: [HostFunctionVariable] { draft.variables ?? [] }
  private var operations: [FunctionConditionalOperation] { draft.operations ?? [] }

  private var formulaNameOptions: [FormulaName] {
    formulaNames(parameters: parameters.compactMap(\.name), locals: locals.compactMap(\.name), siteVariables: siteVariables ?? [])
  }

  private var assignable: [String] { draft.assignableNames }

  private func loadSiteVariables() {
    guard siteVariables == nil, let hostID = context.hostID else { return }
    siteVariables = []
    Task {
      if let page = try? await context.firestore.readOnce(ceilingQuery(variablesPath(hostID), limit: logicCeiling)) {
        siteVariables = page.filter { $0.alive && !($0.string("name") ?? "").isEmpty }.map {
          SiteVariableName(name: $0.string("name"), type: $0.string("type"), value: $0.string("value"))
        }
      }
    }
  }

  var body: some View {
    Form {
      if let error = runner.error { Section { AglynNotice(error, tone: .error) } }
      if !canEdit { Section { AglynNotice("Changing a function needs the editor or admin role on this site.", tone: .warning) } }
      Section {
        TextField("Name", text: Binding(get: { draft.name ?? "" }, set: { draft.name = $0 }))
          .accessibilityIdentifier("function-name")
      } footer: {
        Text(nameTaken ? "A function with this name already exists" : "Used to identify the function")
      }
      parametersSection
      variablesSection
      operationsSection
      Section {
        Picker("Return value", selection: Binding(get: { draft.returnValue ?? "" }, set: { draft.returnValue = $0 })) {
          Text("Nothing").tag("")
          ForEach(assignable, id: \.self) { Text($0).tag($0) }
        }
      } footer: {
        Text("The parameter or variable whose final value the function returns")
      }
      testRunSection
    }
    .formStyle(.grouped)
    .aglynEditorActions(
      id: "function-save", save: runner.busy ? "Saving…" : "Done",
      enabled: canEdit && !runner.busy && !(draft.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !nameTaken,
      cancel: { context.back() }
    ) {
      guard let hostID = context.hostID else { return }
      let api = LogicAPI(api: context.api, writer: context.writer, reader: context.firestore, hostID: hostID)
      let current = draft
      runner.run(success: functionID == nil ? "Function added." : "Function saved.", onDone: { context.back() }) {
        try await api.saveFunction(id: functionID, definition: current)
      }
    }
    .task(id: context.hostID) {
      if let hostID = context.hostID { await others.bind(context.firestore, ceilingQuery(functionsPath(hostID))) }
    }
    .accessibilityIdentifier("function-editor")
  }

  // MARK: Parameters

  private var parametersSection: some View {
    Section {
      if parameters.isEmpty { Text("No parameters: the function takes nothing in.").foregroundStyle(.secondary) }
      ForEach(Array(parameters.enumerated()), id: \.offset) { index, parameter in
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          HStack {
            TextField("Name", text: Binding(get: { parameter.name ?? "" }, set: { typed in putParameter(index) { $0.name = nameInput(typed) } }))
            Picker("Type", selection: Binding(get: { parameter.type ?? .number }, set: { type in putParameter(index) { $0.type = type } })) {
              ForEach(valueTypes, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .labelsHidden()
            Button(role: .destructive) {
              draft.parameters = parameters.enumerated().filter { $0.offset != index }.map(\.element)
            } label: {
              Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Remove parameter \(parameter.name ?? "")")
          }
          Toggle("Required", isOn: Binding(get: { parameter.required == true }, set: { on in putParameter(index) { $0.required = on } }))
          // What a visitor sees for this parameter: empty fields are left off the definition.
          ParameterAudience(parameter: parameter) { next in putParameter(index) { $0 = next } }
            .id("\(index)-\(parameter.type?.rawValue ?? "")")
        }
        .padding(.vertical, AglynSpace.half)
      }
      Button("Add parameter") {
        draft.parameters = parameters + [HostFunctionParameter(name: "P\(parameters.count + locals.count + 1)", required: false, type: .number)]
      }
    } header: {
      Text("Parameters")
    }
  }

  private func putParameter(_ index: Int, _ change: (inout HostFunctionParameter) -> Void) {
    var list = parameters
    guard list.indices.contains(index) else { return }
    change(&list[index])
    draft.parameters = list
  }

  // MARK: Variables

  private var variablesSection: some View {
    Section {
      if locals.isEmpty { Text("No working variables.").foregroundStyle(.secondary) }
      ForEach(Array(locals.enumerated()), id: \.offset) { index, variable in
        HStack {
          TextField("Name", text: Binding(get: { variable.name ?? "" }, set: { typed in putLocal(index) { $0.name = nameInput(typed) } }))
          Picker("Type", selection: Binding(get: { variable.type ?? .number }, set: { type in putLocal(index) { $0.type = type } })) {
            ForEach(valueTypes, id: \.self) { Text($0.rawValue).tag($0) }
          }
          .labelsHidden()
          Button(role: .destructive) {
            draft.variables = locals.enumerated().filter { $0.offset != index }.map(\.element)
          } label: {
            Image(systemName: "trash")
          }
          .buttonStyle(.borderless)
          .accessibilityLabel("Remove variable \(variable.name ?? "")")
        }
      }
      Button("Add variable") {
        draft.variables = locals + [HostFunctionVariable(name: "V\(locals.count + 1)", type: .number)]
      }
    } header: {
      Text("Variables")
    }
  }

  private func putLocal(_ index: Int, _ change: (inout HostFunctionVariable) -> Void) {
    var list = locals
    guard list.indices.contains(index) else { return }
    change(&list[index])
    draft.variables = list
  }

  // MARK: Operations

  private var operationsSection: some View {
    Section {
      ForEach(Array(operations.enumerated()), id: \.offset) { index, operation in
        OperationEditor(
          index: index, operation: operation, names: assignable, formulaNames: formulaNameOptions, loadSiteVariables: loadSiteVariables,
          onRemove: { draft.operations = operations.enumerated().filter { $0.offset != index }.map(\.element) },
          onChange: { next in
            var list = operations
            guard list.indices.contains(index) else { return }
            list[index] = next
            draft.operations = list
          })
      }
      Button("Add operation") { draft.operations = operations + [newOperation()] }
    } header: {
      Text("Operations")
    } footer: {
      Text("Press ƒx beside a box to build its formula by picking values. A box also takes a formula written out.")
    }
  }

  // MARK: Test run

  private var testRunSection: some View {
    Section {
      if parameters.isEmpty { Text("This function takes nothing in.").foregroundStyle(.secondary) }
      ForEach(Array(parameters.enumerated()), id: \.offset) { _, parameter in
        let name = parameter.name ?? ""
        TextField(name, text: Binding(get: { testArgs[name] ?? "" }, set: { testArgs[name] = $0 }))
          .accessibilityIdentifier("test-arg-\(name)")
      }
      Button("Run") { runTest() }.accessibilityIdentifier("test-run")
      if let testResult {
        AglynNotice(testResult, tone: testResult.hasPrefix("Error") ? .warning : .success).accessibilityIdentifier("test-result")
      }
    } header: {
      Text("Test run")
    }
  }

  /// A test run sees what a published page sees: the site variables the draft names, read on the click and only when the
  /// draft names something outside itself.
  private func runTest() {
    let definition = draft
    let args = testArgs
    let hostID = context.hostID
    Task {
      var globals: SiteScope = [:]
      if !functionReferencedNames(definition).isEmpty, let hostID,
        let docs = try? await context.firestore.readOnce(ceilingQuery(variablesPath(hostID), limit: logicCeiling))
      {
        let rows = docs.filter { $0.alive && !($0.string("name") ?? "").isEmpty }.map {
          SiteVariableName(name: $0.string("name"), type: $0.string("type"), value: $0.string("value"))
        }
        globals = functionGlobals(definition, rows)
      }
      let provided = Dictionary(uniqueKeysWithValues: (definition.parameters ?? []).map { ($0.name ?? "", SiteValue.text(args[$0.name ?? ""] ?? "")) })
      switch evaluateHostFunction(runnableFunction(definition), provided, globals: globals) {
      case .failed(let message): testResult = "Error: \(message)"
      case .ok(let value, _): testResult = "Result: \(value)"
      }
    }
  }
}

/// What a VISITOR meets for one parameter: the label above the input, what it starts with, and, for a question with fixed
/// answers, the choices, one row each (AGL-3768). Empty fields are dropped from the definition rather than stored as
/// empty strings. "Starts as" is picked wherever there is a list to pick from: the choices when there are any, On or Off
/// for a true/false.
private struct ParameterAudience: View {
  let parameter: HostFunctionParameter
  let onChange: (HostFunctionParameter) -> Void

  private var startsAs: [(value: String, label: String)]? {
    if parameter.type == .boolean { return [("true", "On"), ("false", "Off")] }
    let options = parameter.options ?? []
    return options.isEmpty ? nil : options.map { ($0.value, $0.label ?? $0.value) }
  }

  private func put(_ change: (inout HostFunctionParameter) -> Void) {
    var next = parameter
    change(&next)
    onChange(next)
  }

  var body: some View {
    TextField(
      "Label", text: Binding(get: { parameter.label ?? "" }, set: { typed in put { $0.label = typed.isEmpty ? nil : String(typed.prefix(80)) } }),
      prompt: Text(parameter.name ?? ""))
    if let startsAs {
      Picker(
        "Starts as",
        selection: Binding(get: { parameter.defaultValue.flatMap { start in startsAs.contains { $0.value == start } ? start : nil } ?? "" }, set: { value in
          put { $0.defaultValue = value.isEmpty ? nil : value }
        })
      ) {
        Text("Nothing chosen").tag("")
        ForEach(startsAs, id: \.value) { Text($0.label).tag($0.value) }
      }
    } else {
      TextField(
        "Starts as",
        text: Binding(get: { parameter.defaultValue ?? "" }, set: { typed in
          let cleaned = parameter.type == .number ? typed.filter { $0.isNumber || ".-".contains($0) } : String(typed.prefix(120))
          put { $0.defaultValue = cleaned.isEmpty ? nil : cleaned }
        })
      )
      #if os(iOS)
        .keyboardType(parameter.type == .number ? .decimalPad : .default)
      #endif
    }
    if parameter.type != .boolean {
      ParameterChoicesEditor(parameterName: parameter.name ?? "", type: parameter.type ?? .number, options: parameter.options) { options in
        put { updated in
          updated.options = options.isEmpty ? nil : options
          // A start that is no longer a choice would preselect nothing.
          if !options.isEmpty, let start = updated.defaultValue, !options.contains(where: { $0.value == start }) { updated.defaultValue = nil }
        }
      }
    }
  }
}

private struct OperationEditor: View {
  let index: Int
  let operation: FunctionConditionalOperation
  let names: [String]
  let formulaNames: [FormulaName]
  let loadSiteVariables: () -> Void
  let onRemove: () -> Void
  let onChange: (FunctionConditionalOperation) -> Void

  private var condition: FunctionConditionalOperationIf {
    operation.if ?? FunctionConditionalOperationIf(comparator: .lessThanOrEqual, left: "", right: "")
  }

  private let comparators = FunctionComparator.allCases.filter { $0 != .unknown }

  private func put(_ change: (inout FunctionConditionalOperationIf) -> Void) {
    var next = operation
    var condition = condition
    change(&condition)
    next.if = condition
    onChange(next)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      HStack {
        Text("If").font(AglynFont.subheadline.weight(.semibold))
        Spacer()
        Button(role: .destructive, action: onRemove) { Image(systemName: "trash") }
          .buttonStyle(.borderless).accessibilityLabel("Remove operation \(index + 1)")
      }
      HStack {
        TextField("P1", text: Binding(get: { condition.left }, set: { typed in put { $0.left = typed } }))
        FormulaBuilderButton(current: condition.left, names: formulaNames, onUse: { expression in put { $0.left = expression } }, onOpen: loadSiteVariables)
      }
      Picker("Is", selection: Binding(get: { condition.comparator }, set: { comparator in put { $0.comparator = comparator } })) {
        ForEach(comparators, id: \.self) { Text($0.rawValue).tag($0) }
      }
      HStack {
        TextField("P2", text: Binding(get: { condition.right }, set: { typed in put { $0.right = typed } }))
        FormulaBuilderButton(current: condition.right, names: formulaNames, onUse: { expression in put { $0.right = expression } }, onOpen: loadSiteVariables)
      }
      SetRows(title: "Then do this", rows: operation.then ?? [], names: names, formulaNames: formulaNames, loadSiteVariables: loadSiteVariables) { rows in
        var next = operation
        next.then = rows
        onChange(next)
      }
      SetRows(title: "Otherwise do this", rows: operation.otherwise ?? [], names: names, formulaNames: formulaNames, loadSiteVariables: loadSiteVariables) { rows in
        var next = operation
        next.otherwise = rows
        onChange(next)
      }
    }
    .padding(.vertical, AglynSpace.half)
    .accessibilityIdentifier("operation-\(index)")
  }
}

/// A branch's SET rows: SET [name] equal to [expression].
private struct SetRows: View {
  let title: String
  let rows: [FunctionSetOperation]
  let names: [String]
  let formulaNames: [FormulaName]
  let loadSiteVariables: () -> Void
  let onChange: ([FunctionSetOperation]) -> Void

  private func put(_ index: Int, _ change: (inout FunctionSetOperation) -> Void) {
    var list = rows
    guard list.indices.contains(index) else { return }
    change(&list[index])
    onChange(list)
  }

  var body: some View {
    Text(title).font(AglynFont.caption).foregroundStyle(.secondary)
    ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
      HStack {
        Picker("Set", selection: Binding(get: { row.set ?? "" }, set: { name in put(index) { $0.set = name } })) {
          Text("—").tag("")
          ForEach(names, id: \.self) { Text($0).tag($0) }
        }
        Text("=")
        TextField("P1 + P2", text: Binding(get: { row.expression ?? "" }, set: { typed in put(index) { $0.expression = typed } }))
        FormulaBuilderButton(current: row.expression ?? "", names: formulaNames, onUse: { expression in put(index) { $0.expression = expression } }, onOpen: loadSiteVariables)
        Button {
          onChange(rows.enumerated().filter { $0.offset != index }.map(\.element))
        } label: {
          Image(systemName: "xmark.circle.fill")
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Remove this row")
      }
    }
    Button("Add set") { onChange(rows + [FunctionSetOperation(expression: "", set: "")]) }
  }
}
