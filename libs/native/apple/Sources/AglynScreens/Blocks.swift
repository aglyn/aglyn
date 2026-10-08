// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Label and value rows. A row may copy its value, show it as a status chip,
/// or link out.
struct FieldsBlock: View {
  let block: BlockSpec
  let context: JSONValue
  let copy: (String) -> Void

  var body: some View {
    let base = block["object"]?.stringValue.flatMap { ScreenValues.lookup($0, in: context) }
    let scope = base.map { ScreenContext.with(context, item: $0) } ?? context
    ForEach(Array(block["rows"].array.enumerated()), id: \.offset) { _, row in
      if ScreenValues.condition(row["when"]?.stringValue, in: scope) {
        let label = ScreenValues.render(row["label"]?.stringValue ?? "", in: scope)
        let value = ScreenValues.render(row["value"]?.stringValue ?? "", in: scope)
        let shown = value.isEmpty ? (row["empty"]?.stringValue ?? "—") : value
        LabeledContent(label) {
          if row["chip"] == .bool(true) {
            StatusChip(shown, tone: toneFor(row, value: value, in: scope))
          } else {
            Text(shown)
              .foregroundStyle(row["tone"] != nil ? toneFor(row, value: value, in: scope).color : .secondary)
              .multilineTextAlignment(.trailing)
              .textSelection(.enabled)
          }
        }
        .contextMenu {
          if !value.isEmpty { Button("Copy \(label)") { copy(value) } }
        }
        .accessibilityElement(children: .combine)
      }
    }
  }
}

/// The tone a row or badge takes: a fixed `tone`, or `tones` keyed by its value.
func toneFor(_ spec: JSONValue, value: String, in context: JSONValue) -> AglynTone {
  if case .object(let map)? = spec["tones"] {
    return tone(map[value]?.stringValue ?? map["*"]?.stringValue)
  }
  return tone(spec["tone"]?.stringValue.map { ScreenValues.render($0, in: context) })
}

/// Usage against a limit, as bars.
struct MetersBlock: View {
  let block: BlockSpec
  let context: JSONValue

  var body: some View {
    let rows: [(JSONValue, JSONValue)] = {
      if let path = block["items"]?.stringValue {
        let template = block["meter"] ?? [:]
        return ScreenValues.rows(ScreenValues.lookup(path, in: context)).map { (template, $0) }
      }
      return block["meters"].array.map { ($0, .null) }
    }()
    ForEach(Array(rows.enumerated()), id: \.offset) { _, entry in
      let (meter, item) = entry
      let scope = item == .null ? context : ScreenContext.with(context, item: item)
      if ScreenValues.condition(meter["when"]?.stringValue, in: scope) {
        MeterRow(meter: meter, scope: scope)
      }
    }
  }
}

struct MeterRow: View {
  let meter: JSONValue
  let scope: JSONValue

  var body: some View {
    let label = ScreenValues.render(meter["label"]?.stringValue ?? "", in: scope)
    let format = meter["format"]?.stringValue ?? "number"
    let usedValue = ScreenValues.resolve(meter["used"]?.stringValue ?? "0", in: scope)
    let limitValue = ScreenValues.resolve(meter["limit"]?.stringValue ?? "", in: scope)
    let used = ScreenValues.number(usedValue) ?? 0
    let limit = ScreenValues.number(limitValue)
    let usedText = ScreenValues.formatted(usedValue, as: format, in: scope)
    let unlimited = limit == nil || (limit ?? 0) < 0
    let limitText = unlimited ? "Unlimited" : ScreenValues.formatted(limitValue, as: format, in: scope)
    let fraction = unlimited || (limit ?? 0) <= 0 ? 0 : min(1, used / (limit ?? 1))
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(label).font(AglynFont.body)
        Spacer()
        Text(unlimited ? usedText : "\(usedText) of \(limitText)")
          .font(AglynFont.subheadline).foregroundStyle(.secondary).monospacedDigit()
      }
      if !unlimited {
        ProgressView(value: fraction)
          .tint(fraction >= 1 ? AglynColor.error : fraction >= 0.8 ? AglynColor.warning : AglynColor.tint)
      }
      if let note = meter["note"]?.stringValue {
        Text(ScreenValues.render(note, in: scope)).font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
    .accessibilityValue(unlimited ? usedText : "\(usedText) of \(limitText)")
  }
}

/// Rows from a loaded array. A row opens a screen, and its actions sit in a
/// context menu, swipe actions on iPhone and iPad, and a trailing menu.
struct ListBlock: View {
  let block: BlockSpec
  let title: String?
  let footer: String?
  @Bindable var model: ScreenModel
  let context: JSONValue
  let selection: Binding<ListSelection?>?
  let open: (String, NativeParams) -> Void
  let trigger: (ActionSpec, JSONValue) -> Void

  var body: some View {
    let rows = ScreenValues.rows(ScreenValues.lookup(block["items"]?.stringValue ?? "", in: context))
      .filter { ScreenValues.condition(block["filter"]?.stringValue, in: ScreenContext.with(context, item: $0)) }
    let loadKey = block["load"]?.stringValue
    Section {
      if rows.isEmpty {
        Text(ScreenValues.render(block["empty"]?.stringValue ?? "Nothing here yet.", in: context))
          .font(AglynFont.subheadline).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.vertical, AglynSpace.one)
      }
      ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
        ListRow(block: block, scope: ScreenContext.with(context, item: row), selection: selection, open: open, trigger: trigger)
      }
      if let loadKey, model.cursors[loadKey] != nil {
        Button {
          Task { await model.loadMore(loadKey) }
        } label: {
          HStack {
            Text("Load more")
            Spacer()
            if model.loadingMore.contains(loadKey) { ProgressView().controlSize(.small) }
          }
        }
        .accessibilityIdentifier("load-more-\(loadKey)")
      }
    } header: {
      if let title, !title.isEmpty {
        HStack {
          Text(title)
          Spacer()
          if block["count"] != .bool(false), !rows.isEmpty { Text("\(rows.count)").monospacedDigit() }
        }
      }
    } footer: {
      if let footer, !footer.isEmpty { Text(footer) }
    }
  }
}

struct ListRow: View {
  let block: BlockSpec
  let scope: JSONValue
  let selection: Binding<ListSelection?>?
  let open: (String, NativeParams) -> Void
  let trigger: (ActionSpec, JSONValue) -> Void

  private var actions: [ActionSpec] {
    block["actions"].array.compactMap(ActionSpec.init).filter { ScreenValues.condition($0.when, in: scope) }
  }

  private var target: ListSelection? {
    guard let open = block["open"], ScreenValues.condition(open["when"]?.stringValue, in: scope),
      let screen = open["screen"]?.stringValue
    else { return nil }
    return ListSelection(screen: screen, params: renderParams(open["params"], in: scope))
  }

  var body: some View {
    let primary = ScreenValues.render(block["primary"]?.stringValue ?? "{item.name|item.$id}", in: scope)
    let secondary = block["secondary"]?.stringValue.map { ScreenValues.render($0, in: scope) }
    let tertiary = block["tertiary"]?.stringValue.map { ScreenValues.render($0, in: scope) }
    let trailing = block["trailing"]?.stringValue.map { ScreenValues.render($0, in: scope) }
    let badges = block["badges"].array.compactMap { badge -> (String, AglynTone)? in
      guard ScreenValues.condition(badge["when"]?.stringValue, in: scope) else { return nil }
      let text = ScreenValues.render(badge["text"]?.stringValue ?? "", in: scope)
      return text.isEmpty ? nil : (text, toneFor(badge, value: text, in: scope))
    }
    let row = HStack(alignment: .center, spacing: 12) {
      if let icon = block["icon"]?.stringValue {
        IconBadge(ScreenSpec.appleIcon(ScreenValues.render(icon, in: scope)), tone: .info, size: 30, circle: true)
          .accessibilityHidden(true)
      }
      VStack(alignment: .leading, spacing: 3) {
        Text(primary.isEmpty ? "—" : primary).font(AglynFont.body).lineLimit(2)
        if let secondary, !secondary.isEmpty {
          Text(secondary).font(AglynFont.subheadline).foregroundStyle(.secondary).lineLimit(2)
        }
        if let tertiary, !tertiary.isEmpty {
          Text(tertiary).font(AglynFont.caption).foregroundStyle(.tertiary).lineLimit(1)
        }
        if !badges.isEmpty {
          HStack(spacing: 6) {
            ForEach(Array(badges.enumerated()), id: \.offset) { _, badge in StatusChip(badge.0, tone: badge.1) }
          }
        }
      }
      Spacer(minLength: 8)
      if let trailing, !trailing.isEmpty {
        Text(trailing).font(AglynFont.subheadline).foregroundStyle(.secondary).monospacedDigit()
      }
      if !actions.isEmpty {
        Menu {
          menuItems
        } label: {
          Image(systemName: "ellipsis.circle").imageScale(.large).foregroundStyle(.secondary)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .accessibilityLabel("Actions for \(primary)")
      }
      if target != nil {
        Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary).accessibilityHidden(true)
      }
    }
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)

    HStack(spacing: 12) {
      if let target {
        Button {
          open(target.screen, target.params)
        } label: {
          row
        }
        .buttonStyle(.plain)
      } else {
        row
      }
      if let toggle = rowToggle(primary) { toggle }
    }
    .listRowBackground(target != nil && selection?.wrappedValue == target ? AglynColor.tint.opacity(0.14) : nil)
    .contextMenu { menuItems }
    #if os(iOS)
      .swipeActions(edge: .trailing) {
        ForEach(actions.filter(\.destructive).prefix(1)) { action in
          Button(role: .destructive) { trigger(action, scope) } label: { Label(action.label, systemImage: action.icon ?? "trash") }
        }
      }
    #endif
  }

  /// `toggle: { value, disabled, on, off }`: a switch at the row's end whose
  /// flip runs the `on` or `off` action (with its confirmation) against the
  /// row; the screen's reload then shows what was stored.
  private func rowToggle(_ primary: String) -> AnyView? {
    guard let spec = block["toggle"], ScreenValues.condition(spec["when"]?.stringValue, in: scope) else { return nil }
    let isOn = ScreenValues.truthy(ScreenValues.resolve(spec["value"]?.stringValue ?? "{item.on}", in: scope))
    let disabled = spec["disabled"]?.stringValue.map { ScreenValues.condition($0, in: scope) } ?? false
    let onAction = spec["on"].flatMap(ActionSpec.init)
    let offAction = spec["off"].flatMap(ActionSpec.init)
    let label = ScreenValues.render(spec["label"]?.stringValue ?? "Turn \(primary) on or off", in: scope)
    return AnyView(
      Toggle(
        label,
        isOn: Binding(
          get: { isOn },
          set: { next in
            if let action = next ? onAction : offAction { trigger(action, scope) }
          })
      )
      .labelsHidden()
      .disabled(disabled || (isOn ? offAction == nil : onAction == nil))
      .accessibilityLabel(label)
    )
  }

  @ViewBuilder
  private var menuItems: some View {
    ForEach(actions) { action in
      Button(role: action.destructive ? .destructive : nil) { trigger(action, scope) } label: {
        Label(ScreenValues.render(action.label, in: scope), systemImage: action.icon ?? "circle")
      }
    }
  }
}

/// The value an input holds while it is edited.
enum FieldValue: Equatable {
  case text(String)
  case flag(Bool)

  var json: JSONValue {
    switch self {
    case .text(let text): .string(text)
    case .flag(let flag): .bool(flag)
    }
  }
}

func fieldJSON(_ field: FieldSpec, _ value: FieldValue?) -> JSONValue {
  switch (field.kind, value) {
  case ("toggle", .flag(let flag)?): return .bool(flag)
  case ("number", .text(let text)?):
    let trimmed = text.trimmingCharacters(in: .whitespaces)
    return trimmed.isEmpty ? .null : Double(trimmed).map(JSONValue.number) ?? .string(trimmed)
  case (_, .text(let text)?):
    return .string(field.kind == "multiline" || field.kind == "password" ? text : text.trimmingCharacters(in: .whitespaces))
  case (_, .flag(let flag)?): return .bool(flag)
  case (_, nil): return field.kind == "toggle" ? .bool(false) : .null
  }
}

func initialValue(_ field: FieldSpec, in context: JSONValue) -> FieldValue {
  let resolved = field.initial.map { ScreenValues.resolve($0, in: context) } ?? .null
  if field.kind == "toggle" { return .flag(ScreenValues.truthy(resolved)) }
  if field.kind == "date", let millis = ScreenValues.epochMillis(resolved) {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withFullDate]
    return .text(formatter.string(from: Date(timeIntervalSince1970: Double(millis) / 1000)))
  }
  return .text(ScreenValues.text(resolved))
}

/// One input, drawn the platform's way for its kind.
struct FieldInput: View {
  let field: FieldSpec
  let context: JSONValue
  @Binding var value: FieldValue

  private var text: Binding<String> {
    Binding(get: { if case .text(let t) = value { t } else { "" } }, set: { value = .text($0) })
  }

  private var flag: Binding<Bool> {
    Binding(get: { if case .flag(let f) = value { f } else { false } }, set: { value = .flag($0) })
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      switch field.kind {
      case "toggle":
        Toggle(field.label, isOn: flag)
      case "select":
        Picker(field.label, selection: text) {
          ForEach(field.choices(in: context), id: \.value) { choice in Text(choice.label).tag(choice.value) }
        }
      case "multiline":
        TextField(field.label, text: text, prompt: field.placeholder.map { Text($0) }, axis: .vertical)
          .lineLimit(3...8)
      case "password":
        SecureField(field.label, text: text, prompt: field.placeholder.map { Text($0) })
          .textContentType(.password)
      default:
        TextField(field.label, text: text, prompt: Text(field.placeholder ?? field.label))
          #if os(iOS)
            .keyboardType(keyboard)
            .textInputAutocapitalization(field.kind == "text" ? .sentences : .never)
          #endif
          .autocorrectionDisabled(field.kind != "text")
      }
      if let help = field.help {
        Text(ScreenValues.render(help, in: context)).font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
    .accessibilityIdentifier("field-\(field.key)")
  }

  #if os(iOS)
    private var keyboard: UIKeyboardType {
      switch field.kind {
      case "email": .emailAddress
      case "url": .URL
      case "number": .decimalPad
      default: .default
      }
    }
  #endif
}

/// A form on the screen: its inputs, filled from the loaded data, and the
/// action that saves them.
struct FormBlock: View {
  let block: BlockSpec
  let context: JSONValue
  let busy: Bool
  let submit: (ActionSpec, JSONValue) -> Void
  @State private var values: [String: FieldValue] = [:]
  @State private var seededFrom: JSONValue?

  private var fields: [FieldSpec] {
    block["fields"].array.compactMap(FieldSpec.init)
  }

  private var scope: JSONValue {
    let base = block["object"]?.stringValue.flatMap { ScreenValues.lookup($0, in: context) }
    return base.map { ScreenContext.with(context, item: $0) } ?? context
  }

  private var filled: JSONValue {
    var form: [String: JSONValue] = [:]
    for field in fields { form[field.key] = fieldJSON(field, values[field.key]) }
    return ScreenContext.with(scope, "form", .object(form))
  }

  private var missing: Bool {
    fields.contains { field in
      ScreenValues.condition(field.when, in: filled) && field.unmet(fieldJSON(field, values[field.key] ?? initialValue(field, in: scope)), in: scope)
    }
  }

  var body: some View {
    Group {
      ForEach(fields.filter { ScreenValues.condition($0.when, in: filled) }) { field in
        FieldInput(
          field: field, context: scope,
          value: Binding(get: { values[field.key] ?? initialValue(field, in: scope) }, set: { values[field.key] = $0 }))
      }
      if let action = block["submit"].flatMap(ActionSpec.init), ScreenValues.condition(action.when, in: scope) {
        Button {
          submit(action, filled)
        } label: {
          HStack {
            Spacer()
            if busy { ProgressView().controlSize(.small) }
            Text(action.label).font(AglynFont.button)
            Spacer()
          }
        }
        .buttonStyle(.borderedProminent)
        .disabled(busy || missing)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
        .accessibilityIdentifier("submit-\(block.id)")
      }
    }
    .onAppear(perform: seed)
    .onChange(of: context) { _, _ in seed() }
  }

  /// Fills the inputs from the data once per load, keeping what was typed
  /// when the data did not change.
  private func seed() {
    guard seededFrom != scope else { return }
    seededFrom = scope
    var next: [String: FieldValue] = [:]
    for field in fields { next[field.key] = initialValue(field, in: scope) }
    values = next
  }
}

/// The inputs an action asks for, in a sheet, before it runs.
struct ActionInputSheet: View {
  let pending: PendingAction
  let context: JSONValue
  let run: (JSONValue) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var values: [String: FieldValue] = [:]

  private var inputs: [FieldSpec] { pending.action.inputs }

  private var filled: JSONValue {
    var form: [String: JSONValue] = [:]
    for field in inputs { form[field.key] = fieldJSON(field, values[field.key] ?? initialValue(field, in: pending.scope)) }
    return ScreenContext.with(pending.scope, "form", .object(form))
  }

  private var missing: Bool {
    inputs.contains { field in
      field.unmet(fieldJSON(field, values[field.key] ?? initialValue(field, in: pending.scope)), in: pending.scope)
    }
  }

  var body: some View {
    NavigationStack {
      Form {
        if let confirm = pending.action.confirm {
          Section { Text(ScreenValues.render(confirm, in: pending.scope)).font(AglynFont.subheadline) }
        }
        Section {
          ForEach(inputs.filter { ScreenValues.condition($0.when, in: filled) }) { field in
            FieldInput(
              field: field, context: pending.scope,
              value: Binding(
                get: { values[field.key] ?? initialValue(field, in: pending.scope) }, set: { values[field.key] = $0 }))
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle(ScreenValues.render(pending.action.label, in: pending.scope))
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(ScreenValues.render(pending.action.label, in: pending.scope), role: pending.action.destructive ? .destructive : nil) {
            run(filled)
          }
          .disabled(missing)
          .accessibilityIdentifier("prompt-submit")
        }
      }
    }
    .frame(minWidth: 360, minHeight: 280)
    .presentationDetents([.medium, .large])
  }
}

/// "Confirm it is you": the password again, so the route sees a fresh sign-in.
struct ReauthSheet: View {
  let email: String?
  let message: String?
  let confirm: (String) async throws -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var password = ""
  @State private var error: String?
  @State private var busy = false

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Text(message ?? "Confirm it is you to continue.").font(AglynFont.subheadline)
          if let email { LabeledContent("Account", value: email) }
          SecureField("Password", text: $password).textContentType(.password)
            .accessibilityIdentifier("reauth-password")
        }
        if let error { Section { AglynNotice(error, tone: .error) } }
      }
      .formStyle(.grouped)
      .navigationTitle("Confirm it is you")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Continue") {
            busy = true
            Task {
              do {
                try await confirm(password)
              } catch {
                self.error = signInErrorMessage(error)
              }
              busy = false
            }
          }
          .disabled(password.isEmpty || busy)
        }
      }
    }
    .frame(minWidth: 360, minHeight: 260)
  }
}
