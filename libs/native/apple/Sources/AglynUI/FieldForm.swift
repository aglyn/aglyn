// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/*
 * A record's fields as a form, and as read-only rows: one description of a
 * field (its key, label, kind and choices) drives both, so an edit sheet and
 * the detail it edits never disagree about what a field is. The Kotlin kit's
 * `FieldForm.kt`, field for field.
 *
 * Values travel as strings: a date is `yyyy-MM-dd`, a switch is `true` /
 * `false`, a choice is its stored value, several choices are joined by `,`.
 */

public enum FieldKind: String, Sendable {
  case text, multiline, email, phone, url, number, money, date, select, multiSelect, toggle
}

public struct FieldOption: Hashable, Sendable, Identifiable {
  public let value: String
  public let label: String
  public var id: String { value }
  public init(_ value: String, _ label: String) {
    self.value = value
    self.label = label
  }
}

public struct FieldSpec: Hashable, Sendable, Identifiable {
  public let key: String
  public let label: String
  public let kind: FieldKind
  public let required: Bool
  public let options: [FieldOption]
  public let help: String?
  /// What an unpicked choice reads as ("No owner"); nil when one is needed.
  public let emptyLabel: String?
  public var id: String { key }

  public init(
    _ key: String, _ label: String, kind: FieldKind = .text, required: Bool = false, options: [FieldOption] = [],
    help: String? = nil, emptyLabel: String? = "None"
  ) {
    self.key = key
    self.label = label
    self.kind = kind
    self.required = required
    self.options = options
    self.help = help
    self.emptyLabel = emptyLabel
  }
}

/// What a filled-in form says is wrong with it, by field key; empty when it can be saved.
public func fieldProblems(_ specs: [FieldSpec], _ values: [String: String]) -> [String: String] {
  var problems: [String: String] = [:]
  func matches(_ value: String, _ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
  for spec in specs {
    let value = (values[spec.key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if value.isEmpty {
      if spec.required { problems[spec.key] = "\(spec.label) is required" }
      continue
    }
    switch spec.kind {
    case .email where !matches(value, #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#): problems[spec.key] = "Enter an email address"
    case .phone where !matches(value, #"^\+?[\d\s().-]{5,}$"#): problems[spec.key] = "Enter a phone number"
    case .url where !matches(value, #"^(https?://)?[^\s.]+\.[^\s]+$"#): problems[spec.key] = "Enter a web address"
    case .number where Double(value) == nil: problems[spec.key] = "Enter a number"
    case .money where Double(value.replacingOccurrences(of: "$", with: "").replacingOccurrences(of: ",", with: "")) == nil:
      problems[spec.key] = "Enter an amount"
    case .date where !matches(value, #"^\d{4}-\d{2}-\d{2}$"#): problems[spec.key] = "Pick a date"
    default: break
    }
  }
  return problems
}

/// How a stored value reads in a detail pane: a choice by its label, a switch as Yes or No.
public func fieldDisplay(_ spec: FieldSpec, _ value: String?) -> String? {
  let raw = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if raw.isEmpty { return nil }
  switch spec.kind {
  case .select: return spec.options.first { $0.value == raw }?.label ?? raw
  case .multiSelect:
    return raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
      .map { part in spec.options.first { $0.value == part }?.label ?? part }.joined(separator: ", ")
  case .toggle: return raw == "true" ? "Yes" : "No"
  case .money:
    guard let amount = Double(raw.replacingOccurrences(of: "$", with: "")) else { return raw }
    return amount.formatted(.currency(code: "USD").precision(.fractionLength(amount.rounded() == amount ? 0 : 2)))
  default: return raw
  }
}

/// `yyyy-MM-dd` as a UTC date (the day a picker shows), or nil.
public func isoDay(_ text: String) -> Date? {
  let formatter = DateFormatter()
  formatter.calendar = Calendar(identifier: .gregorian)
  formatter.timeZone = TimeZone(identifier: "UTC")
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.dateFormat = "yyyy-MM-dd"
  return formatter.date(from: text.trimmingCharacters(in: .whitespaces))
}

/// A UTC date as its `yyyy-MM-dd` day.
public func isoDayString(_ date: Date) -> String {
  let formatter = DateFormatter()
  formatter.calendar = Calendar(identifier: .gregorian)
  formatter.timeZone = TimeZone(identifier: "UTC")
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.dateFormat = "yyyy-MM-dd"
  return formatter.string(from: date)
}

/// Every field of `specs` as rows of a `Form` section. `errors` show under their field.
public struct FieldFormSection: View {
  let title: String?
  let specs: [FieldSpec]
  @Binding var values: [String: String]
  let errors: [String: String]

  public init(_ title: String? = nil, specs: [FieldSpec], values: Binding<[String: String]>, errors: [String: String] = [:]) {
    self.title = title
    self.specs = specs
    self._values = values
    self.errors = errors
  }

  public var body: some View {
    Section {
      ForEach(specs) { spec in
        FieldEditor(spec: spec, value: binding(spec.key), error: errors[spec.key])
      }
    } header: {
      if let title { Text(title) }
    }
  }

  private func binding(_ key: String) -> Binding<String> {
    Binding(get: { values[key] ?? "" }, set: { values[key] = $0 })
  }
}

/// One field, editable, in the control its kind calls for.
public struct FieldEditor: View {
  let spec: FieldSpec
  @Binding var value: String
  let error: String?

  public init(spec: FieldSpec, value: Binding<String>, error: String? = nil) {
    self.spec = spec
    self._value = value
    self.error = error
  }

  private var label: String { spec.required ? "\(spec.label) *" : spec.label }

  public var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      control
      if let note = error ?? spec.help {
        Text(note).font(AglynFont.caption).foregroundStyle(error == nil ? Color.secondary : AglynColor.error)
      }
    }
    .accessibilityIdentifier("field-\(spec.key)")
  }

  @ViewBuilder
  private var control: some View {
    switch spec.kind {
    case .toggle:
      Toggle(spec.label, isOn: Binding(get: { value == "true" }, set: { value = $0 ? "true" : "false" }))
    case .select:
      Picker(label, selection: $value) {
        if !spec.required || value.isEmpty { Text(spec.emptyLabel ?? "Choose").tag("") }
        ForEach(spec.options) { Text($0.label).tag($0.value) }
        // A stored value the choices no longer name stays pickable as itself.
        if !value.isEmpty && !spec.options.contains(where: { $0.value == value }) { Text(value).tag(value) }
      }
    case .multiSelect:
      MultiChoiceField(spec: spec, label: label, value: $value)
    case .date:
      DateFieldRow(spec: spec, label: label, value: $value)
    case .multiline:
      TextField(label, text: $value, axis: .vertical).lineLimit(3...10)
    default:
      TextField(label, text: $value)
        .textContentType(contentType)
        #if os(iOS)
          .keyboardType(keyboard)
          .textInputAutocapitalization(capitalization)
        #endif
        .autocorrectionDisabled(spec.kind != .text)
    }
  }

  private var contentType: TextContentType? {
    switch spec.kind {
    case .email: .emailAddress
    case .phone: .telephoneNumber
    case .url: .URL
    default: nil
    }
  }

  #if os(iOS)
    private var keyboard: UIKeyboardType {
      switch spec.kind {
      case .email: .emailAddress
      case .phone: .phonePad
      case .url: .URL
      case .number: .numberPad
      case .money: .decimalPad
      default: .default
      }
    }

    private var capitalization: TextInputAutocapitalization {
      switch spec.kind {
      case .email, .url: .never
      default: .sentences
      }
    }
  #endif
}

#if os(iOS)
  private typealias TextContentType = UITextContentType
#else
  private typealias TextContentType = NSTextContentType
#endif

private struct DateFieldRow: View {
  let spec: FieldSpec
  let label: String
  @Binding var value: String

  var body: some View {
    if let day = isoDay(value) {
      HStack {
        DatePicker(
          label,
          selection: Binding(get: { day }, set: { value = isoDayString($0) }),
          displayedComponents: .date
        )
        .environment(\.timeZone, TimeZone(identifier: "UTC")!)
        if !spec.required {
          Button {
            value = ""
          } label: {
            Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Clear \(spec.label)")
        }
      }
    } else {
      Button {
        value = isoDayString(Date())
      } label: {
        LabeledContent(label) { Text("Add a date").foregroundStyle(AglynColor.tint) }
      }
      .buttonStyle(.plain)
    }
  }
}

private struct MultiChoiceField: View {
  let spec: FieldSpec
  let label: String
  @Binding var value: String

  private var picked: Set<String> {
    Set(value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty })
  }

  var body: some View {
    Menu {
      ForEach(spec.options) { option in
        Button {
          var next = picked
          if next.contains(option.value) { next.remove(option.value) } else { next.insert(option.value) }
          value = spec.options.map(\.value).filter(next.contains).joined(separator: ",")
        } label: {
          if picked.contains(option.value) { Label(option.label, systemImage: "checkmark") } else { Text(option.label) }
        }
      }
    } label: {
      LabeledContent(label) {
        Text(fieldDisplay(spec, value) ?? (spec.emptyLabel ?? "None")).foregroundStyle(.secondary).lineLimit(2)
      }
    }
  }
}

/// One read-only property in a `Form`: its label and value; an absent value reads as an em dash.
public struct PropertyRow: View {
  let label: String
  let value: String?

  public init(_ label: String, _ value: String?) {
    self.label = label
    self.value = value
  }

  public var body: some View {
    LabeledContent(label) {
      Text(value.flatMap { $0.isEmpty ? nil : $0 } ?? "—").multilineTextAlignment(.trailing).textSelection(.enabled)
    }
  }
}

/// Every field of `specs` as read-only rows, in order.
public struct PropertyList: View {
  let specs: [FieldSpec]
  let values: [String: String]

  public init(specs: [FieldSpec], values: [String: String]) {
    self.specs = specs
    self.values = values
  }

  public var body: some View {
    ForEach(specs) { spec in
      PropertyRow(spec.label, fieldDisplay(spec, values[spec.key])).accessibilityIdentifier("property-\(spec.key)")
    }
  }
}
