// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
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
            // One token (an email, an id, a link) keeps one line, shortened in the middle: wrapped, it broke at a dot
            // and read as two values. Copy still copies the whole value.
            let oneToken = !shown.contains(where: \.isWhitespace)
            Text(shown)
              .foregroundStyle(row["tone"] != nil ? toneFor(row, value: value, in: scope).color : .secondary)
              .multilineTextAlignment(.trailing)
              .lineLimit(oneToken ? 1 : nil)
              .truncationMode(.middle)
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
/// A list row's badge as chips: one, or with `each` (a path to a list) one per row of that list, the row read as `row` (a
/// resource's units left on each of the next nights). `when` is read once, against the list row.
func rowBadges(_ badge: JSONValue, in scope: JSONValue) -> [(String, AglynTone)] {
  guard ScreenValues.condition(badge["when"]?.stringValue, in: scope) else { return [] }
  let scopes = badge["each"]?.stringValue.map { path in
    ScreenValues.rows(ScreenValues.lookup(path, in: scope)).map { ScreenContext.with(scope, "row", $0) }
  } ?? [scope]
  return scopes.compactMap { here in
    let text = ScreenValues.render(badge["text"]?.stringValue ?? "", in: here)
    return text.isEmpty ? nil : (text, toneFor(badge, value: text, in: here))
  }
}

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
          .tint(fraction >= 1 ? AglynColor.error : fraction >= 0.8 ? AglynColor.warning : AglynColor.primary)
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
  /// The choice made in the list's `chips` filter; empty shows every row.
  @State private var chosen = ""
  /// How many more pages of a `page`d list "Show more" has revealed.
  @State private var revealed = 0

  var body: some View {
    let key = ListColumns.key(of: block)
    let columns = ListColumns.columns(of: block)
    let asked = model.order[key]
    let column = asked.flatMap { order in columns.first { $0.id == order.column } }
    // `chips: { field, from, label }`: a picker over the values in `from`, narrowing the rows to
    // those whose `field` equals the choice (the forum's category filter).
    let chips = block["chips"]
    let chipField = chips?["field"]?.stringValue
    let chipValues = chips.map { ScreenValues.lookup($0["from"]?.stringValue ?? "", in: context).array.map { ScreenValues.text($0) } } ?? []
    let rows = rowScopes(chipField: chipField, column: column, asked: asked)
    let picked = model.shownColumns(of: key, in: columns)
    let loadKey = block["load"]?.stringValue
    // `page: N`: the first N rows, then Show more for N more (a list the screen holds whole, such as a diff).
    let page = block["page"]?.numberValue.map { Int($0) } ?? 0
    let shown = page > 0 ? Array(rows.prefix(page * (1 + revealed))) : rows
    Section {
      if !chipValues.isEmpty {
        Picker(chips?["label"]?.stringValue ?? "Filter", selection: $chosen) {
          Text("All").tag("")
          ForEach(chipValues, id: \.self) { Text($0).tag($0) }
        }
        .accessibilityIdentifier("list-chips")
      }
      if rows.isEmpty {
        Text(ScreenValues.render(block["empty"]?.stringValue ?? "Nothing here yet.", in: context))
          .font(AglynFont.subheadline).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.vertical, AglynSpace.one)
      }
      ForEach(Array(shown.enumerated()), id: \.offset) { _, scope in
        ListRow(
          block: block, scope: scope, columnsLine: ListColumns.line(columns, shown: picked, in: scope), selection: selection, open: open,
          trigger: trigger)
      }
      if page > 0, rows.count > shown.count {
        Button("Show more") { revealed += 1 }
          .frame(maxWidth: .infinity)
          .accessibilityIdentifier("show-more")
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
      let sortable = columns.filter(\.sortable)
      let pickable = columns.filter { !$0.always }
      if !(title ?? "").isEmpty || !sortable.isEmpty || !pickable.isEmpty {
        HStack {
          Text(title ?? "")
          Spacer()
          if block["count"] != .bool(false), !rows.isEmpty, title != nil { Text("\(rows.count)").monospacedDigit() }
          if !sortable.isEmpty { sortMenu(key: key, columns: sortable, asked: asked, chosen: column) }
          if !pickable.isEmpty { columnsMenu(key: key, columns: pickable, shown: picked) }
        }
      }
    } footer: {
      if let footer, !footer.isEmpty { Text(footer) }
    }
  }

  /// Each row as the scope it is drawn in (`item`, its `index`, and with `within` the outer row as `parent`): `flatten` walks
  /// rows a level or more down, `filter` and the chosen chip keep some, `sort` orders them, and then a `page` column the person
  /// asked for (a `route` column already came back from the route in its order).
  private func rowScopes(chipField: String?, column: ListColumn?, asked: ListOrder?) -> [JSONValue] {
    let items = block["items"]?.stringValue ?? ""
    var found: [(scope: JSONValue, row: JSONValue)]
    if let through = block["flatten"]?.stringValue {
      found = ScreenValues.flatten(ScreenValues.rows(ScreenValues.lookup(items, in: context)), through: through).enumerated().map {
        (ScreenContext.with(ScreenContext.with(context, item: $0.element), "index", .number(Double($0.offset))), $0.element)
      }.filter { ScreenValues.condition(block["filter"]?.stringValue, in: $0.scope) }
    } else {
      found = ScreenValues.scopes(
        items: items, within: block["within"]?.stringValue, filter: block["filter"]?.stringValue, in: context
      ).map { ($0, $0["item"] ?? .null) }
    }
    if let chipField, !chosen.isEmpty {
      found = found.filter { ScreenValues.text(ScreenValues.lookup("item.\(chipField)", in: $0.scope)) == chosen }
    }
    if let sort = block["sort"]?.stringValue {
      let order = ScreenValues.order(found.map(\.row), by: sort)
      found = order.map { found[$0] }
    }
    if let column, column.page != nil, let asked {
      let order = ListColumns.order(found.map(\.row), by: column, descending: asked.descending, in: context)
      found = order.map { found[$0] }
    }
    return found.map(\.scope)
  }

  /// The header sort: a tap on a column asks for its first order, a second for the other, a third for the default again.
  private func sortMenu(key: String, columns: [ListColumn], asked: ListOrder?, chosen: ListColumn?) -> some View {
    Menu {
      Button {
        Task { await model.ask(nil, of: key, routed: chosen?.route != nil) }
      } label: {
        if asked == nil { Label("Default order", systemImage: "checkmark") } else { Text("Default order") }
      }
      ForEach(columns) { column in
        let active = asked?.column == column.id ? asked : nil
        Button {
          Task { await model.ask(ListColumns.next(after: asked, tapping: column), of: key, routed: column.route != nil || chosen?.route != nil) }
        } label: {
          if let active {
            Label("\(column.label) \(active.descending ? "\u{2193}" : "\u{2191}")", systemImage: "checkmark")
          } else {
            Text(column.label)
          }
        }
      }
    } label: {
      Image(systemName: "arrow.up.arrow.down").foregroundStyle(asked == nil ? Color.secondary : AglynColor.tint)
    }
    .menuStyle(.borderlessButton)
    .fixedSize()
    .accessibilityLabel("Sort")
    .accessibilityIdentifier("sort-\(key)")
  }

  /// The column picker: which facts each row shows.
  private func columnsMenu(key: String, columns: [ListColumn], shown: Set<String>) -> some View {
    Menu {
      ForEach(columns) { column in
        Toggle(
          column.label,
          isOn: Binding(
            get: { shown.contains(column.id) },
            set: { on in model.shown[key] = on ? shown.union([column.id]) : shown.subtracting([column.id]) }))
      }
    } label: {
      Image(systemName: "slider.horizontal.3").foregroundStyle(.secondary)
    }
    .menuStyle(.borderlessButton)
    .fixedSize()
    .accessibilityLabel("Columns")
    .accessibilityIdentifier("columns-\(key)")
  }
}

struct ListRow: View {
  let block: BlockSpec
  let scope: JSONValue
  /// The row's picked columns as one line (`columns`), empty for a list without them.
  var columnsLine: String = ""
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
    // A template, or a list of parts joined with ` · ` as `secondary` takes them (a part shown only while its `when` holds).
    let primary: String = {
      if case .array(_)? = block["primary"] { return rowLine(block["primary"], in: scope) ?? "" }
      return ScreenValues.render(block["primary"]?.stringValue ?? "{item.name|item.$id}", in: scope)
    }()
    let secondary = rowLine(block["secondary"], in: scope)
    let tertiary = rowLine(block["tertiary"], in: scope)
    let trailing = block["trailing"]?.stringValue.map { ScreenValues.render($0, in: scope) }
    let badges = block["badges"].array.flatMap { badge in rowBadges(badge, in: scope) }
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
        if !columnsLine.isEmpty {
          Text(columnsLine).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(3)
        }
        if let tertiary, !tertiary.isEmpty {
          Text(tertiary).font(AglynFont.caption).foregroundStyle(.tertiary).lineLimit(1)
        }
        if !badges.isEmpty {
          AglynWrapRow(spacing: AglynSpace.of(0.75), lineSpacing: AglynSpace.of(0.75)) {
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
        .buttonStyle(.aglynRow)
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
  /// A chosen file: its name, and its text.
  case file(name: String, text: String)

  var json: JSONValue {
    switch self {
    case .text(let text): .string(text)
    case .flag(let flag): .bool(flag)
    case .file(_, let text): .string(text)
    }
  }
}

/// The scope a form or prompt runs its action with: `form` holds only the fields the person could see (their
/// `when` holds), so a field the screen hid is never sent, as a console form that never drew it would not send it.
func visibleOnly(_ filled: JSONValue, _ fields: [FieldSpec]) -> JSONValue {
  guard case .object(let form)? = filled["form"] else { return filled }
  let keep = Set(fields.filter { ScreenValues.condition($0.when, in: filled) }.map(\.key))
  return ScreenContext.with(filled, "form", .object(form.filter { keep.contains($0.key) }))
}

/// The `form` a block hands its action: every field's value, and for a chosen file also `<key>Name`.
func formObject(_ fields: [FieldSpec], _ value: (FieldSpec) -> FieldValue?) -> [String: JSONValue] {
  var form: [String: JSONValue] = [:]
  for field in fields {
    let held = value(field)
    form[field.key] = fieldJSON(field, held)
    if case .file(let name, _)? = held { form[field.key + "Name"] = .string(name) }
  }
  return form
}

func fieldJSON(_ field: FieldSpec, _ value: FieldValue?) -> JSONValue {
  switch (field.kind, value) {
  case ("toggle", .flag(let flag)?): return .bool(flag)
  case ("multiselect", .text(let text)?):
    // The chosen ids, one per line while edited; nothing chosen is null (no restriction).
    let chosen = text.split(separator: "\n").map { String($0) }.filter { !$0.isEmpty }
    return chosen.isEmpty ? .null : .array(chosen.map(JSONValue.string))
  case ("file", .text(let text)?), ("file", .file(_, let text)?):
    if text.isEmpty { return .null }
    return field.parse == "json" ? (JSONValue.decode(Data(text.utf8)) ?? .null) : .string(text)
  case ("upload", .text(let text)?):
    // What the upload step reads out of the chosen file or pasted rows, kept as JSON text while it is edited.
    return JSONValue.decode(Data(text.utf8)) ?? .null
  case ("lines", .text(let text)?):
    // One entry per line while edited; the list is what is sent (nothing typed is an empty list).
    return .array(text.split(separator: "\n").map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map(JSONValue.string))
  case ("number", .text(let text)?):
    let trimmed = text.trimmingCharacters(in: .whitespaces)
    return trimmed.isEmpty ? .null : Double(trimmed).map { .number(field.integer ? $0.rounded() : $0) } ?? .string(trimmed)
  case (_, .text(let text)?):
    return .string(field.kind == "multiline" || field.kind == "password" ? text : text.trimmingCharacters(in: .whitespaces))
  case (_, .flag(let flag)?): return .bool(flag)
  case (_, .file(_, let text)?): return .string(text)
  case (_, nil): return field.kind == "toggle" ? .bool(false) : .null
  }
}

func initialValue(_ field: FieldSpec, in context: JSONValue) -> FieldValue {
  let resolved = field.initial.map { ScreenValues.resolve($0, in: context) } ?? .null
  if field.kind == "toggle" { return .flag(ScreenValues.truthy(resolved)) }
  if field.kind == "multiselect" { return .text(Optional(resolved).array.map { ScreenValues.text($0) }.joined(separator: "\n")) }
  if field.kind == "lines" { return .text(Optional(resolved).array.map { ScreenValues.text($0) }.joined(separator: "\n")) }
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
  @State private var picking: PickSource?

  private var text: Binding<String> {
    Binding(
      get: {
        switch value {
        case .text(let t): t
        case .file(_, let t): t
        case .flag: ""
        }
      }, set: { value = .text($0) })
  }

  private var fileNameShown: String {
    if case .file(let name, _) = value { return name }
    return "File chosen"
  }

  private var flag: Binding<Bool> {
    Binding(get: { if case .flag(let f) = value { f } else { false } }, set: { value = .flag($0) })
  }

  var body: some View {
    // A label can name what the loaded data does (a registration number's name for the jurisdiction in force).
    let label = ScreenValues.render(field.label, in: context)
    VStack(alignment: .leading, spacing: 4) {
      switch field.kind {
      case "toggle":
        Toggle(label, isOn: flag)
      case "select", "country":
        PlainFormRow(label) {
          Picker(label, selection: text) {
            ForEach(field.choices(in: context), id: \.value) { choice in Text(choice.label).tag(choice.value) }
          }
        }
      case "hours":
        HoursInput(field: field, text: text)
      case "multiselect":
        // Each choice a switch; the chosen ids are kept one per line.
        let chosen = Set(text.wrappedValue.split(separator: "\n").map(String.init))
        VStack(alignment: .leading, spacing: 4) {
          Text(field.label).font(AglynFont.subheadline)
          ForEach(field.choices(in: context), id: \.value) { choice in
            Toggle(
              isOn: Binding(
                get: { chosen.contains(choice.value) },
                set: { on in
                  var next = field.choices(in: context).map(\.value).filter { $0 == choice.value ? on : chosen.contains($0) }
                  // Keep ids the list no longer offers rather than silently dropping them.
                  next += chosen.filter { id in !field.choices(in: context).contains { $0.value == id } }
                  text.wrappedValue = next.joined(separator: "\n")
                })
            ) {
              // A choice may say what agreeing to it means (a publisher's attestation), under its label.
              VStack(alignment: .leading, spacing: 2) {
                Text(choice.label)
                if let detail = field.detail(for: choice.value, in: context) {
                  Text(detail).font(AglynFont.caption).foregroundStyle(.secondary)
                }
              }
            }
          }
        }
      case "file":
        // The field says what file it wants (a bundle, a manifest), as the Kotlin renderer's title does.
        Text(label).font(AglynFont.subheadline)
        HStack {
          Button(text.wrappedValue.isEmpty ? "Choose a file" : "Choose a different file") { picking = .files }
          if !text.wrappedValue.isEmpty {
            Text(fileNameShown).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1)
          }
        }
        .aglynMediaPicker($picking, multiple: false) { files in
          guard let file = files.first else { return }
          // `base64` keeps the file's bytes as they are (a plugin bundle sent whole); otherwise it is read as text.
          value = .file(name: file.name, text: field.parse == "base64" ? file.data.base64EncodedString() : ScreenValues.decodeFileText(file.data))
        }
      case "upload":
        UploadFieldView(field: field, context: context, value: $value)
      case "media":
        MediaFieldView(field: field, value: $value)
      case "multiline", "lines":
        PlainFormRow(label) {
          TextField(label, text: text, prompt: field.placeholder.map { Text($0) }, axis: .vertical)
            .lineLimit(3...8)
        }
      case "password":
        PlainFormRow(label) {
          SecureField(label, text: text, prompt: field.placeholder.map { Text($0) })
            .textContentType(.password)
        }
      default:
        PlainFormRow(label) {
          TextField(label, text: text, prompt: Text(field.placeholder ?? label))
            #if os(iOS)
              .keyboardType(keyboard)
              .textInputAutocapitalization(field.kind == "text" ? .sentences : .never)
            #endif
            .autocorrectionDisabled(field.kind != "text")
        }
      }
      if field.generate != nil {
        Button("Generate") { text.wrappedValue = field.generatedValue(in: context) ?? "" }
          .buttonStyle(.borderless)
          .accessibilityIdentifier("generate-\(field.key)")
      }
      if let mismatch = field.mismatch, !text.wrappedValue.isEmpty, field.refuses(.string(text.wrappedValue), in: context) {
        Text(ScreenValues.render(mismatch, in: context)).font(AglynFont.caption).foregroundStyle(AglynColor.error)
      } else if let help = field.help {
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
      case "number": field.integer ? .numberPad : .decimalPad
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
    FieldSpec.parseAll(block["fields"].array, in: scope)
  }

  private var scope: JSONValue {
    let base = block["object"]?.stringValue.flatMap { ScreenValues.lookup($0, in: context) }
    return base.map { ScreenContext.with(context, item: $0) } ?? context
  }

  private var filled: JSONValue {
    ScreenContext.with(scope, "form", .object(formObject(fields) { values[$0.key] }))
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
        // One Save per form at the standard control size, trailing (spec 8): never a full-width bar per form.
        HStack(spacing: AglynSpace.one) {
          Spacer(minLength: 0)
          if busy { ProgressView().controlSize(.small) }
          Button(action.label) {
            submit(action, visibleOnly(filled, fields))
          }
          .buttonStyle(.aglynProminent)
          .controlSize(.regular)
          .disabled(busy || missing)
          .accessibilityIdentifier("submit-\(block.id)")
        }
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
  /// Finds the records a `lookup` field offers for the words typed.
  var search: (LookupGroup, String) async throws -> [JSONValue] = { _, _ in [] }
  let run: (JSONValue) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var values: [String: FieldValue] = [:]
  /// What each `lookup` field last picked, as the person reads it.
  @State private var picked: [String: String] = [:]

  private var inputs: [FieldSpec] { pending.action.inputs(in: pending.scope) }

  private var filled: JSONValue {
    ScreenContext.with(
      pending.scope, "form", .object(formObject(inputs) { values[$0.key] ?? initialValue($0, in: pending.scope) }))
  }

  /// A field the person cannot see (its `when` fails) never holds up the action.
  private var missing: Bool {
    let context = filled
    return inputs.contains { field in
      ScreenValues.condition(field.when, in: context)
        && field.unmet(fieldJSON(field, values[field.key] ?? initialValue(field, in: pending.scope)), in: pending.scope)
    }
  }

  var body: some View {
    NavigationStack {
      Form {
        if let confirm = pending.action.confirmText(in: pending.scope) {
          Section { Text(confirm).font(AglynFont.subheadline) }
        }
        Section {
          ForEach(inputs.filter { ScreenValues.condition($0.when, in: filled) }) { field in
            if field.kind == "lookup" {
              LookupRow(field: field, context: pending.scope, picked: picked[field.key], search: search) { group, row in
                picked[field.key] = group.heading(for: row, in: pending.scope)
                // Only the fields this form has are filled, and what the person typed elsewhere is left alone.
                for fill in group.fills(for: row, in: pending.scope, among: Set(inputs.map(\.key))) {
                  values[fill.key] = .text(fill.value)
                }
              }
            } else {
              FieldInput(
                field: field, context: pending.scope,
                value: Binding(
                  get: { values[field.key] ?? initialValue(field, in: pending.scope) }, set: { values[field.key] = $0 }))
            }
          }
        }
      }
      .formStyle(.grouped)
      .navigationTitle(ScreenValues.render(pending.action.promptTitle ?? pending.action.label, in: pending.scope))
      .aglynScreenTitle(ScreenValues.render(pending.action.promptTitle ?? pending.action.label, in: pending.scope))
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(ScreenValues.render(pending.action.submitLabel ?? pending.action.label, in: pending.scope), role: pending.action.destructive ? .destructive : nil) {
            run(visibleOnly(filled, inputs))
          }
          .disabled(missing)
          .accessibilityIdentifier("prompt-submit")
        }
      }
    }
    .aglynSheetMinimumSize(width: 360, height: 280)
    .presentationDetents([.medium, .large])
  }
}

/// A `lookup` field: a row that opens a search over the kinds of record its groups name. Picking one fills the form's other
/// fields (the system email test's "Populate from").
struct LookupRow: View {
  let field: FieldSpec
  let context: JSONValue
  let picked: String?
  let search: (LookupGroup, String) async throws -> [JSONValue]
  let pick: (LookupGroup, JSONValue) -> Void
  @State private var open = false

  var body: some View {
    let label = ScreenValues.render(field.label, in: context)
    VStack(alignment: .leading, spacing: 4) {
      Button {
        open = true
      } label: {
        LabeledContent(label) { Text(picked ?? "Choose").foregroundStyle(picked == nil ? .secondary : .primary) }
      }
      .accessibilityIdentifier("lookup-\(field.key)")
      if let help = field.help {
        Text(ScreenValues.render(help, in: context)).font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
    .sheet(isPresented: $open) {
      LookupSheet(field: field, context: context, search: search) { group, row in
        pick(group, row)
        open = false
      }
    }
  }
}

/// The search behind a `lookup` field: one section per kind of record, filled as words are typed.
struct LookupSheet: View {
  let field: FieldSpec
  let context: JSONValue
  let search: (LookupGroup, String) async throws -> [JSONValue]
  let pick: (LookupGroup, JSONValue) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var words = ""
  @State private var found: [String: [JSONValue]] = [:]
  @State private var failed: [String] = []
  @State private var loading = false

  var body: some View {
    NavigationStack {
      List {
        ForEach(field.groups) { group in
          let rows = found[group.id] ?? []
          Section(group.label) {
            if rows.isEmpty && !loading {
              Text(words.isEmpty ? "Nothing yet." : "Nothing found.").foregroundStyle(.secondary)
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
              Button {
                pick(group, row)
              } label: {
                VStack(alignment: .leading, spacing: 2) {
                  Text(group.heading(for: row, in: context)).foregroundStyle(.primary)
                  if let detail = group.detail(for: row, in: context) {
                    Text(detail).font(AglynFont.caption).foregroundStyle(.secondary)
                  }
                }
              }
            }
          }
        }
        if !failed.isEmpty {
          Section { AglynNotice("Could not search \(failed.joined(separator: ", ")). Try again.", tone: .warning) }
        }
      }
      .aglynSearchable(text: $words, prompt: "Search by name or email")
      .navigationTitle(ScreenValues.render(field.label, in: context))
      .aglynScreenTitle(ScreenValues.render(field.label, in: context))
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
      // A short wait after the last key, so a name typed quickly is one search and not one per letter.
      .task(id: words) {
        if !words.isEmpty { try? await Task.sleep(nanoseconds: 300_000_000) }
        guard !Task.isCancelled else { return }
        await load()
      }
    }
    .aglynSheetMinimumSize(width: 360, height: 360)
  }

  private func load() async {
    loading = true
    var next: [String: [JSONValue]] = [:]
    var missed: [String] = []
    for group in field.groups {
      do { next[group.id] = try await search(group, words) } catch { missed.append(group.label.lowercased()) }
      if Task.isCancelled { return }
    }
    found = next
    failed = missed
    loading = false
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
      .aglynScreenTitle("Confirm it is you")
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
    .aglynSheetMinimumSize(width: 360, height: 260)
  }
}

/// A week of hours chosen by touch: the plugin host's picker (the console's weekly hours picker) over the stored text lines
/// (`Mo-Fr 09:00-17:00`), so nobody types them. The field's `hours` object sets the noun, the opening and closing time of a
/// day switched on, and `sameDay`.
struct HoursInput: View {
  let field: FieldSpec
  @Binding var text: String

  var body: some View {
    OpeningHoursPicker(
      text: $text, label: field.label,
      defaultInterval: WeeklyHoursInterval(
        start: field.hours.flatMap { ScreenValues.number($0["start"]) }.map { Int($0) } ?? 9 * 60,
        end: field.hours.flatMap { ScreenValues.number($0["end"]) }.map { Int($0) } ?? 17 * 60),
      intervalNoun: field.hours?["noun"]?.stringValue ?? "hours", sameDay: field.hours?["sameDay"] == .bool(true))
  }
}

/// A list row's line: a template, or a list of parts (a template, or `{ text, when }` shown while its condition holds) joined
/// with ` · `, a part that holds nothing left out, so a row never ends on a dangling `set by `.
func rowLine(_ spec: JSONValue?, in scope: JSONValue) -> String? {
  let line: String?
  switch spec {
  case .array(let parts)?:
    line = parts.compactMap { part -> String? in
      let template: String?
      if case .string(let text) = part {
        template = text
      } else if ScreenValues.condition(part["when"]?.stringValue, in: scope) {
        template = part["text"]?.stringValue
      } else {
        template = nil
      }
      guard let shown = template.map({ ScreenValues.render($0, in: scope).trimmingCharacters(in: .whitespaces) }), !shown.isEmpty else { return nil }
      return shown
    }.joined(separator: " \u{00B7} ")
  case .string(let text)?:
    line = ScreenValues.render(text, in: scope)
  default:
    line = nil
  }
  return line.flatMap { $0.isEmpty ? nil : $0 }
}

/// A field as a form row draws it inside the Mac's own grouped form (`aglynPlainForm`): its label on the leading edge,
/// the control after it, filling the row; anywhere else the control as it is, which a `Form` labels itself.
struct PlainFormRow<Control: View>: View {
  @Environment(\.aglynPlainForm) private var plain
  let label: String
  let control: Control

  init(_ label: String, @ViewBuilder control: () -> Control) {
    self.label = label
    self.control = control()
  }

  var body: some View {
    if plain {
      HStack(alignment: .firstTextBaseline, spacing: 12) {
        Text(label).foregroundStyle(AglynColor.textPrimary)
        Spacer(minLength: 8)
        control.labelsHidden().textFieldStyle(.roundedBorder).frame(maxWidth: 420, alignment: .trailing)
      }
    } else {
      control
    }
  }
}
