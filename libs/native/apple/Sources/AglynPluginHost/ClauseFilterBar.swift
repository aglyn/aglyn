// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/*
 * A list's filter clauses as the console's Filters panel holds them
 * (`{field, op, value}` over a list declaration's fields): one chip per
 * clause, "Add filter" to make one, and what the query did not apply, said
 * as the planner said it (the Kotlin kit's ClauseFilterBar.kt). The clauses
 * go on the list's ONE Firestore query; nothing here matches rows already
 * loaded.
 */

/// How an operator reads on a chip (`listFilterOperatorLabel`, list-filter-sentence.ts).
public func listFilterOperatorLabel(_ op: String) -> String {
  switch op {
  case "contains": "contains"
  case "doesNotContain": "does not contain"
  case "equals", "is", "=": "is"
  case "doesNotEqual", "!=": "is not"
  case "startsWith": "starts with"
  case "endsWith": "ends with"
  case "isAnyOf": "is any of"
  case "isEmpty": "is empty"
  case "isNotEmpty": "is set"
  case "after": "after"
  case "onOrAfter": "on or after"
  case "before": "before"
  case "onOrBefore": "on or before"
  case ">": "over"
  case ">=": "at least"
  case "<": "under"
  case "<=": "at most"
  default: op
  }
}

/// One value a select field offers.
public struct FilterChoice: Hashable, Sendable {
  public let value: String
  public let label: String
  public init(_ value: String, _ label: String) {
    self.value = value
    self.label = label
  }
}

private let valuelessOperators: Set<String> = ["isEmpty", "isNotEmpty"]

/// A clause in words: "Category is any of Bread, Cake".
public func clauseLabel(_ clause: ListFilterRequest, headers: [String: String], choices: [String: [FilterChoice]]) -> String {
  let header = headers[clause.field] ?? clause.field
  if valuelessOperators.contains(clause.op) { return "\(header) \(listFilterOperatorLabel(clause.op))" }
  let named = clause.value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    .map { value in choices[clause.field]?.first { $0.value == value }?.label ?? value }
    .joined(separator: ", ")
  return "\(header) \(listFilterOperatorLabel(clause.op)) \(named)"
}

/// One refusal the planner gave: the clause as typed (nil for the search) and its reason.
public struct FilterRefusal: Equatable, Sendable {
  public let clause: ListFilterRequest?
  public let reason: String
  public init(clause: ListFilterRequest?, reason: String) {
    self.clause = clause
    self.reason = reason
  }
}

/// The clause chips, "Add filter", and the planner's refusals and notices.
/// `fields` are the declaration's filterable fields; `choices` the values a
/// select field offers.
public struct ClauseFilterBar: View {
  let fields: [ListFilterField]
  let headers: [String: String]
  let choices: [String: [FilterChoice]]
  let clauses: [ListFilterRequest]
  let refused: [FilterRefusal]
  let notices: [String]
  let onChange: ([ListFilterRequest]) -> Void
  @State private var adding = false

  public init(
    fields: [ListFilterField], headers: [String: String], choices: [String: [FilterChoice]], clauses: [ListFilterRequest],
    refused: [FilterRefusal] = [], notices: [String] = [], onChange: @escaping ([ListFilterRequest]) -> Void
  ) {
    self.fields = fields
    self.headers = headers
    self.choices = choices
    self.clauses = clauses
    self.refused = refused
    self.notices = notices
    self.onChange = onChange
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      if !fields.isEmpty || !clauses.isEmpty {
        AglynWrapRow(spacing: AglynSpace.one, lineSpacing: AglynSpace.half) {
          ForEach(Array(clauses.enumerated()), id: \.offset) { index, clause in
            let label = clauseLabel(clause, headers: headers, choices: choices)
            Button {
              onChange(clauses.enumerated().filter { $0.offset != index }.map(\.element))
            } label: {
              Label(label, systemImage: "xmark.circle.fill")
                .labelStyle(.titleAndIcon)
                .font(AglynFont.subheadline)
                .padding(.horizontal, AglynSpace.oneAndHalf)
                .padding(.vertical, AglynSpace.one)
                .background(AglynColor.paper, in: Capsule())
                .overlay(Capsule().strokeBorder(AglynColor.divider))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove filter \(label)")
            .accessibilityIdentifier("filter-chip-\(index)")
          }
          if !fields.isEmpty {
            Button {
              adding = true
            } label: {
              Label("Add filter", systemImage: "line.3.horizontal.decrease")
                .font(AglynFont.subheadline)
                .padding(.horizontal, AglynSpace.oneAndHalf)
                .padding(.vertical, AglynSpace.one)
                .overlay(Capsule().strokeBorder(AglynColor.divider))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("add-filter")
          }
        }
      }
      ForEach(Array(refused.enumerated()), id: \.offset) { _, refusal in
        let what = refusal.clause.map { "“\(clauseLabel($0, headers: headers, choices: choices))”" } ?? "The search"
        AglynNotice("\(what) was not applied: \(refusal.reason).", tone: .warning)
      }
      ForEach(notices, id: \.self) { AglynNotice($0, tone: .info) }
    }
    .sheet(isPresented: $adding) {
      AddClauseSheet(fields: fields, headers: headers, choices: choices) { clause in
        onChange(clauses + [clause])
        adding = false
      } onCancel: {
        adding = false
      }
    }
  }
}

private struct AddClauseSheet: View {
  let fields: [ListFilterField]
  let headers: [String: String]
  let choices: [String: [FilterChoice]]
  let onAdd: (ListFilterRequest) -> Void
  let onCancel: () -> Void
  @State private var column = ""
  @State private var op = ""
  @State private var value = ""
  @State private var picked: Set<String> = []

  private var field: ListFilterField? { fields.first { $0.column == column } ?? fields.first }
  private var operators: [String] { field.map(listFilterOperators) ?? [] }
  private var offered: [FilterChoice] { choices[field?.column ?? ""] ?? [] }
  private var valueless: Bool { valuelessOperators.contains(op) }
  private var finalValue: String {
    if valueless { return "" }
    if !offered.isEmpty && op == "isAnyOf" { return offered.map(\.value).filter(picked.contains).joined(separator: ",") }
    return value.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Field", selection: $column) {
            ForEach(fields, id: \.column) { Text(headers[$0.column] ?? $0.column).tag($0.column) }
          }
          Picker("Condition", selection: $op) {
            ForEach(operators, id: \.self) { Text(listFilterOperatorLabel($0)).tag($0) }
          }
          if !valueless {
            if !offered.isEmpty && op == "isAnyOf" {
              ForEach(offered, id: \.value) { choice in
                Toggle(choice.label, isOn: Binding(get: { picked.contains(choice.value) }, set: { on in
                  if on { picked.insert(choice.value) } else { picked.remove(choice.value) }
                }))
              }
            } else if !offered.isEmpty {
              Picker("Value", selection: $value) {
                Text("Choose…").tag("")
                ForEach(offered, id: \.value) { Text($0.label).tag($0.value) }
              }
            } else {
              TextField(op == "isAnyOf" ? "Values, separated by commas" : "Value", text: $value)
                #if os(iOS)
                  .keyboardType(field?.kind == .number ? .decimalPad : .default)
                #endif
                .accessibilityIdentifier("filter-value")
            }
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Add filter")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: onCancel) }
        ToolbarItem(placement: .confirmationAction) {
          Button("Apply") { onAdd(ListFilterRequest(field: column, op: op, value: finalValue)) }
            .disabled(column.isEmpty || op.isEmpty || (!valueless && finalValue.isEmpty))
            .accessibilityIdentifier("add-filter-apply")
        }
      }
      .onAppear {
        if column.isEmpty { column = fields.first?.column ?? "" }
        if op.isEmpty { op = operators.first ?? "equals" }
      }
      .onChange(of: column) { _, _ in
        op = operators.first ?? "equals"
        value = ""
        picked = []
      }
    }
    .frame(minWidth: 380, minHeight: 320)
    .presentationDetents([.medium])
  }
}
