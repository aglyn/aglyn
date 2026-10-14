// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynUI
import SwiftUI

/*
 * The Logic page's no-code editors as screens (AGL-3757, AGL-3768): the rows a
 * dictionary or list variable edits as, the "Build formula" sheet beside an
 * expression box, and a parameter's choices as rows. What each writes is the
 * text the console would have taken typed (LogicRows.swift). The Kotlin
 * plugin's LogicEditors.kt.
 */

/// A dictionary as a name / value table and a collection as a list: each row typed Text, Number or True/false,
/// written back as the JSON string the variable has always stored. The rows are this editor's own state, so a
/// row whose name is still being typed is not dropped mid-edit.
struct StructuredValueEditor: View {
  let shape: StructuredShape
  let onChange: (String) -> Void
  @State private var rows: [StructuredRow]
  private let unreadable: Bool

  init(shape: StructuredShape, value: String, onChange: @escaping (String) -> Void) {
    self.shape = shape
    self.onChange = onChange
    let parsed = parseStructuredValue(value, shape)
    _rows = State(initialValue: parsed.rows)
    unreadable = parsed.unreadable
  }

  private var duplicates: Set<String> { shape == .dictionary ? duplicateStructuredKeys(rows) : [] }
  private var noun: String { shape == .dictionary ? "entry" : "item" }

  private func commit() { onChange(serializeStructuredValue(rows, shape)) }

  var body: some View {
    Group {
      Text(shape == .dictionary ? "Each entry is a name and its value. A function reads one as variable.name." : "Each item is one value in the list, in order.")
        .font(AglynFont.caption).foregroundStyle(.secondary)
      if unreadable {
        AglynNotice("The saved value could not be read as a \(shape == .dictionary ? "set of entries" : "list"). Add its values below; saving replaces it.", tone: .warning)
      }
      ForEach($rows) { $row in
        let index = rows.firstIndex { $0.id == row.id } ?? 0
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          HStack {
            if shape == .dictionary {
              TextField("Entry name", text: $row.key)
                .onChange(of: row.key) { commit() }
                .accessibilityIdentifier("entry-name-\(index)")
            } else {
              Text("\(index + 1)").font(AglynFont.caption).foregroundStyle(.secondary).frame(width: 24, alignment: .leading)
              Spacer()
            }
            Button(role: .destructive) {
              rows.remove(at: index)
              commit()
            } label: {
              Image(systemName: "xmark.circle.fill")
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Remove \(noun) \(index + 1)")
          }
          if shape == .dictionary, duplicates.contains(row.key.trimmingCharacters(in: .whitespacesAndNewlines)) {
            Text("Used twice — the last one wins").font(AglynFont.caption).foregroundStyle(AglynColor.error)
          }
          if row.kind == .kept {
            Text("A nested list or set of entries — kept as it is").font(AglynFont.subheadline).foregroundStyle(.secondary)
          } else {
            Picker("Type", selection: Binding(get: { row.kind }, set: { kind in
              if kind == .boolean {
                row.value = row.value == "true" ? "true" : "false"
              } else if row.kind == .boolean {
                row.value = ""
              }
              row.kind = kind
              commit()
            })) {
              Text("Text").tag(StructuredKind.text)
              Text("Number").tag(StructuredKind.number)
              Text("True/false").tag(StructuredKind.boolean)
            }
            if row.kind == .boolean {
              Toggle("Value", isOn: Binding(get: { row.value == "true" }, set: { row.value = $0 ? "true" : "false"; commit() }))
            } else {
              TextField("Value", text: Binding(get: { row.value }, set: { typed in
                row.value = row.kind == .number ? typed.filter { $0.isNumber || ".eE+-".contains($0) } : typed
                commit()
              }))
              #if os(iOS)
                .keyboardType(row.kind == .number ? .decimalPad : .default)
              #endif
              .accessibilityIdentifier("entry-value-\(index)")
            }
          }
        }
        .padding(.vertical, AglynSpace.half)
      }
      Button(shape == .dictionary ? "Add entry" : "Add item") {
        rows.append(StructuredRow(key: "", kind: .text, value: ""))
        commit()
      }
      .accessibilityIdentifier("entry-add")
    }
  }
}

/// The ƒx "Build formula" button beside an expression box. `onOpen` runs as the sheet opens, where a caller loads names it reads lazily.
struct FormulaBuilderButton: View {
  let current: String
  let names: [FormulaName]
  let onUse: (String) -> Void
  var onOpen: () -> Void = {}
  @State private var open = false

  var body: some View {
    Button {
      onOpen()
      open = true
    } label: {
      Text("ƒx").italic().fontWeight(.semibold)
    }
    .buttonStyle(.borderless)
    .accessibilityLabel("Build formula")
    .accessibilityIdentifier("formula-open")
    .sheet(isPresented: $open) {
      FormulaBuilderSheet(current: current, names: names) { expression in
        onUse(expression)
        open = false
      } onClose: {
        open = false
      }
    }
  }
}

private let formulaSeparators: [(value: String, label: String)] = [(" ", "A space"), (", ", "A comma"), (" - ", "A dash"), ("", "Nothing")]
private let formulaSymbols = ["$", "€", "£", "¥", ""]

/// The "Build formula" sheet: pick what to work out — add, smallest of, format as money — and the values it works
/// on, and the box gets the expression that does it. Nothing is typed but numbers and text.
private struct FormulaBuilderSheet: View {
  let current: String
  let names: [FormulaName]
  let onUse: (String) -> Void
  let onClose: () -> Void
  @State private var draft: FormulaDraft

  init(current: String, names: [FormulaName], onUse: @escaping (String) -> Void, onClose: @escaping () -> Void) {
    self.current = current
    self.names = names
    self.onUse = onUse
    self.onClose = onClose
    _draft = State(initialValue: formulaDraftFor(current.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .value : .add, current: current))
  }

  private var expression: String? { buildFormula(draft, current: current) }
  private var hasCurrent: Bool { !current.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Work out", selection: Binding(get: { draft.operation }, set: { draft = formulaDraftFor($0, previous: draft, current: current) })) {
            ForEach(FormulaOperation.allCases, id: \.self) { Text($0.label).tag($0) }
          }
        }
        Section {
          ForEach(Array(draft.operands.enumerated()), id: \.offset) { index, operand in
            operandRow(index, operand)
          }
          if draft.operation.variadic {
            Button("Add another") {
              draft.operands.append(draft.operation == .join ? .text("") : .name(""))
            }
          }
        }
        if draft.operation == .currency || draft.operation.hasPlaces || draft.operation == .join {
          Section {
            if draft.operation == .currency {
              Picker("Sign", selection: Binding(get: { draft.symbol ?? "$" }, set: { draft.symbol = $0 })) {
                ForEach(formulaSymbols, id: \.self) { Text($0.isEmpty ? "None" : $0).tag($0) }
              }
            }
            if draft.operation.hasPlaces {
              Picker("Decimal places", selection: Binding(get: { draft.places ?? (draft.operation == .currency ? 2 : 0) }, set: { draft.places = $0 })) {
                ForEach(0...4, id: \.self) { Text("\($0)").tag($0) }
              }
            }
            if draft.operation == .join {
              Picker("Between each", selection: Binding(get: { draft.separator ?? " " }, set: { draft.separator = $0 })) {
                ForEach(formulaSeparators, id: \.label) { Text($0.label).tag($0.value) }
              }
            }
          }
        }
        Section {
          Text(expression.map { "The box will read: \($0)" } ?? "Choose every value to finish the formula.")
            .font(AglynFont.caption).foregroundStyle(.secondary)
            .accessibilityIdentifier("formula-preview")
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Build formula")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onClose) }
        ToolbarItem(placement: .confirmationAction) {
          Button("Use formula") { if let expression { onUse(expression) } }.disabled(expression == nil)
            .accessibilityIdentifier("formula-use")
        }
      }
    }
    .frame(minWidth: 420, minHeight: 420)
    .accessibilityIdentifier("formula-builder")
  }

  @ViewBuilder
  private func operandRow(_ index: Int, _ operand: FormulaOperand) -> some View {
    let label = formulaOperandLabel(draft.operation, index)
    Picker(label, selection: Binding(get: { operand.source }, set: { source in
      switch source {
      case "name": draft.operands[index] = .name("")
      case "current": draft.operands[index] = .current
      case "number": draft.operands[index] = .number("")
      default: draft.operands[index] = .text("")
      }
    })) {
      Text("A value").tag("name")
      Text("A number").tag("number")
      Text("Some text").tag("text")
      if hasCurrent { Text("What is there now").tag("current") }
    }
    switch operand {
    case .name(let name):
      Picker("Which", selection: Binding(get: { names.contains { $0.value == name } ? name : "" }, set: { draft.operands[index] = .name($0) })) {
        Text(names.isEmpty ? "Nothing to pick yet" : "—").tag("")
        ForEach(Array(Dictionary(grouping: names, by: \.group).keys).sorted(by: groupOrder), id: \.self) { group in
          Section(group) {
            ForEach(names.filter { $0.group == group }, id: \.value) { Text($0.label).tag($0.value) }
          }
        }
      }
    case .number(let value):
      TextField("Number", text: Binding(get: { value }, set: { draft.operands[index] = .number($0.filter { $0.isNumber || ".-".contains($0) }) }))
        #if os(iOS)
          .keyboardType(.decimalPad)
        #endif
    case .text(let value):
      TextField("Text", text: Binding(get: { value }, set: { draft.operands[index] = .text($0) }))
    case .current:
      Text("The formula already in the box").foregroundStyle(.secondary)
    }
    if draft.operation.variadic, index >= draft.operation.minOperands {
      Button("Remove \(label)", role: .destructive) { draft.operands.remove(at: index) }
    }
  }

  /// The picker's groups in the order the evaluator resolves a clash.
  private func groupOrder(_ a: String, _ b: String) -> Bool {
    let order = ["Parameters", "This function’s variables", "Site variables"]
    return (order.firstIndex(of: a) ?? 99) < (order.firstIndex(of: b) ?? 99)
  }
}

/// A parameter's choices as rows (AGL-3768): what the function receives and what a visitor reads, one choice per row. The
/// rows are this editor's own state, so a choice whose value is still blank is not dropped mid-edit.
struct ParameterChoicesEditor: View {
  let parameterName: String
  let type: FunctionValueType
  let onChange: ([HostFunctionParameterOption]) -> Void
  @State private var rows: [ParameterChoiceRow]

  init(parameterName: String, type: FunctionValueType, options: [HostFunctionParameterOption]?, onChange: @escaping ([HostFunctionParameterOption]) -> Void) {
    self.parameterName = parameterName
    self.type = type
    self.onChange = onChange
    _rows = State(initialValue: choiceRowsFromOptions(options))
  }

  private func commit() { onChange(optionsFromChoiceRows(rows)) }

  private func duplicate(_ index: Int) -> Bool {
    let value = rows[index].value.trimmingCharacters(in: .whitespacesAndNewlines)
    return !value.isEmpty && (rows.firstIndex { $0.value.trimmingCharacters(in: .whitespacesAndNewlines) == value } ?? index) < index
  }

  var body: some View {
    ForEach($rows) { $row in
      let index = rows.firstIndex { $0.id == row.id } ?? 0
      VStack(alignment: .leading, spacing: AglynSpace.half) {
        HStack {
          TextField("Function gets", text: Binding(get: { row.value }, set: { typed in
            row.value = type == .number ? typed.filter { $0.isNumber || ".-".contains($0) } : String(typed.prefix(120))
            commit()
          }))
          #if os(iOS)
            .keyboardType(type == .number ? .decimalPad : .default)
          #endif
          TextField("Visitors see", text: Binding(get: { row.label }, set: { row.label = String($0.prefix(80)); commit() }), prompt: Text(row.value))
          Button(role: .destructive) {
            rows.remove(at: index)
            commit()
          } label: {
            Image(systemName: "xmark.circle.fill")
          }
          .buttonStyle(.borderless)
          .accessibilityLabel("Remove choice \(index + 1) of \(parameterName.isEmpty ? "parameter" : parameterName)")
        }
        if duplicate(index) { Text("Already a choice").font(AglynFont.caption).foregroundStyle(AglynColor.error) }
      }
    }
    HStack {
      Button("Add choice") {
        rows.append(ParameterChoiceRow(value: "", label: ""))
        commit()
      }
      .accessibilityIdentifier("choice-add")
      if rows.isEmpty { Text("Give it choices to ask it as a list.").font(AglynFont.caption).foregroundStyle(.secondary) }
    }
  }
}
