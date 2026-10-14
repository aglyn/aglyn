// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/// A console screen as data: what it loads from the console's own API
/// routes, what it shows, and which routes its actions call. Core screens are
/// declared in `libs/native/screens/*.screens.json`; a plugin declares its own
/// beside its native code. The grammar is in docs/mobile/native-architecture.md
/// §13, and the Kotlin renderer reads the same files.
public struct ScreenSpec: Identifiable, Sendable {
  public let id: String
  public let title: String
  /// SF Symbol name (the part before `|` in the spec's `icon`).
  public let icon: String
  /// `org`, `site`, `account` or `staff`.
  public let scope: String
  /// Where the shell lists it: `workspace`, `site`, `account`, `staff`, or nil for a detail screen.
  public let group: String?
  public let order: Int
  public let subtitle: String?
  /// The plain name a sidebar or bar shows: `label`, else a title without templates.
  public let label: String
  /// A `when` condition the session must meet to open the screen.
  public let requires: String?
  public let links: [String]
  /// Core screens' zones this plugin screen contributes to (`orgMember`, `staffOrg`, …).
  public let zones: [String]
  public let loads: [LoadSpec]
  public let blocks: [BlockSpec]
  public let raw: JSONValue

  public var requiresSite: Bool { scope == "site" }

  public init?(_ json: JSONValue) {
    guard let id = json["id"]?.stringValue, let title = json["title"]?.stringValue else { return nil }
    self.id = id
    self.title = title
    self.icon = ScreenSpec.appleIcon(json["icon"]?.stringValue)
    self.scope = json["scope"]?.stringValue ?? "org"
    self.group = json["group"]?.stringValue
    self.order = Int(ScreenValues.number(json["order"]) ?? 100)
    self.subtitle = json["subtitle"]?.stringValue
    self.label = json["label"]?.stringValue ?? (title.contains("{") ? "Details" : title)
    self.requires = json["requires"]?.stringValue
    self.links = json["links"].arrayOfStrings
    self.zones = json["zones"].arrayOfStrings
    self.loads = json["load"].objectEntries.map { LoadSpec(key: $0.key, $0.value) }
    self.blocks = json["blocks"].array.compactMap(BlockSpec.init)
    self.raw = json
  }

  static func appleIcon(_ raw: String?) -> String {
    let name = raw?.split(separator: "|").first.map(String.init) ?? ""
    return name.isEmpty ? "square.grid.2x2" : name
  }
}

/// One GET the screen makes before it draws, saved under `data.<key>`.
public struct LoadSpec: Sendable, Hashable {
  public let key: String
  public let url: String
  public let when: String?
  /// The response field holding the next page's cursor, when the route pages.
  public let cursor: String?
  /// The query parameter the cursor goes back in.
  public let cursorParam: String
  /// The query parameter the route reads search words from (`search` unless the route names it otherwise).
  public let searchParam: String
  /// The response field holding the rows to append page after page.
  public let items: String?
  /// `POST` for a route that answers reads by POST (with `body`); GET otherwise.
  public let method: HTTPMethod
  public let body: JSONValue?
  /// A load whose failure leaves its key null instead of failing the screen.
  public let optional: Bool
  /// A Firestore document path to read instead of a route.
  public let doc: String?
  /// A Firestore collection query to read instead of a route.
  public let query: JSONValue?
  /// `org` or `site`: the plugin switchboard's rows (SwitchboardRows).
  public let switchboard: String?
  /// A plan feature whose gate the screen reads: `{ carried, label }`, where `label` names the plan that includes it.
  public let entitlement: String?
  /// An order id (a template): the order as a widget is handed it, with its lines' units and what is left to ship.
  public let orderZone: String?

  init(key: String, _ json: JSONValue) {
    self.key = key
    if case .string(let url) = json {
      self.url = url
      self.when = nil
      self.cursor = nil
      self.cursorParam = "cursor"
      self.searchParam = "search"
      self.items = nil
      self.doc = nil
      self.query = nil
      self.switchboard = nil
      self.entitlement = nil
      self.orderZone = nil
      self.method = .get
      self.body = nil
      self.optional = false
    } else {
      self.url = json["url"]?.stringValue ?? ""
      self.when = json["when"]?.stringValue
      self.cursor = json["cursor"]?.stringValue
      self.cursorParam = json["cursorParam"]?.stringValue ?? "cursor"
      self.searchParam = json["searchParam"]?.stringValue ?? "search"
      self.items = json["items"]?.stringValue
      self.doc = json["doc"]?.stringValue
      self.query = json["query"]
      self.switchboard = json["switchboard"]?.stringValue
      self.entitlement = json["entitlement"]?.stringValue
      self.orderZone = json["orderZone"]?.stringValue
      self.method = HTTPMethod(rawValue: (json["method"]?.stringValue ?? "GET").uppercased()) ?? .get
      self.body = json["body"]
      self.optional = json["optional"] == .bool(true)
    }
  }
}

/// One part of a screen.
public struct BlockSpec: Sendable, Identifiable {
  public let id: String
  public let type: String
  public let title: String?
  public let footer: String?
  public let when: String?
  public let raw: JSONValue

  init?(_ json: JSONValue) {
    guard let type = json["type"]?.stringValue else { return nil }
    self.type = type
    self.title = json["title"]?.stringValue
    self.footer = json["footer"]?.stringValue
    self.when = json["when"]?.stringValue
    self.raw = json
    self.id = json["id"]?.stringValue ?? "\(type):\(json["title"]?.stringValue ?? "")"
  }

  public subscript(key: String) -> JSONValue? { raw[key] }
}

/// A route call a button, row or form makes.
public struct ActionSpec: Sendable, Identifiable {
  public let id: String
  public let label: String
  public let icon: String?
  public let method: HTTPMethod
  public let url: String?
  public let body: JSONValue?
  /// Request headers, name to template. `{attempt}` is a key that stays the same while the same
  /// action sends the same body (a retry), and changes with the body: `Idempotency-Key` for a
  /// route that provisions something (enterprise billing).
  public let headers: [String: String]
  public let confirm: String?
  /// A confirmation built from segments, `[{ "when": …, "text": … }]`, joined in order, so one
  /// sentence can change with the route's answer (the add-on's price preview).
  public let confirmParts: [JSONValue]
  /// When set, the confirmation is asked only while this condition holds.
  public let confirmWhen: String?
  public let destructive: Bool
  public let reason: Bool
  public let prompt: [FieldSpec]
  let promptRaw: [JSONValue]
  public let success: String?
  /// A response field holding a URL to open in the secure in-app browser (Stripe's pages).
  public let openURL: String?
  public let navigate: NavigateSpec?
  public let back: Bool
  public let reload: Bool
  public let when: String?
  /// A URL template opened directly, with no request (a mailto:, a receipt PDF).
  public let link: String?
  /// A Besigner path (whole, from the console root) opened in the app's web view.
  public let besigner: String?
  /// `copy`: the rendered template goes to the clipboard.
  public let copy: String?
  /// A response field shown once, to be copied (a new API key's secret).
  public let reveal: String?
  /// A Firestore merge the signed-in person makes themselves, where the
  /// console writes the document directly under the rules (their own
  /// `users/{uid}` profile): `{ "doc": "users/{user.uid}", "fields": {...} }`.
  public let write: JSONValue?
  /// The action to run instead when the route answers 404 (add a member, else invite them).
  public let otherwise: ActionSpecBox?
  /// The status of the answer that runs `else` (404 unless the spec names another, such as 409).
  public let elseStatus: Int
  /// A follow-up the action makes once it succeeds (best effort, like the console's).
  public let then: ActionSpecBox?
  /// `{ when, title, text }` (or a list of them, the first that matches wins): when the route's
  /// answer meets `when`, the person is shown `text` (a template over `response`) in place of the
  /// success message, as the console's report dialog shows the documentation that may already
  /// answer a question, and its add-on card the bank-confirmation notice.
  public let instead: JSONValue?
  /// A route call made first, whose answer is `preview` in the confirmation (the console asks
  /// Stripe what an add-on change would charge before it asks the person to confirm).
  public let check: ActionSpecBox?

  public init?(_ json: JSONValue) {
    guard let label = json["label"]?.stringValue else { return nil }
    self.label = label
    self.id = json["id"]?.stringValue ?? label
    self.icon = json["icon"]?.stringValue.map { ScreenSpec.appleIcon($0) }
    self.method = HTTPMethod(rawValue: (json["method"]?.stringValue ?? "POST").uppercased()) ?? .post
    self.url = json["url"]?.stringValue
    self.body = json["body"]
    self.headers = json["headers"].objectEntries.reduce(into: [:]) { $0[$1.key] = $1.value.stringValue ?? ScreenValues.text($1.value) }
    self.confirm = json["confirm"]?.stringValue
    self.confirmParts = json["confirm"].array
    self.confirmWhen = json["confirmWhen"]?.stringValue
    self.destructive = json["destructive"] == .bool(true)
    self.reason = json["reason"] == .bool(true)
    self.prompt = json["prompt"].array.compactMap(FieldSpec.init)
    self.promptRaw = json["prompt"].array
    self.success = json["success"]?.stringValue
    self.openURL = json["open"]?.stringValue
    self.navigate = json["navigate"].flatMap(NavigateSpec.init)
    self.back = json["back"] == .bool(true)
    self.reload = json["reload"] != .bool(false) && (json["url"]?.stringValue != nil || json["write"] != nil)
    self.otherwise = json["else"].flatMap(ActionSpec.init).map(ActionSpecBox.init)
    self.elseStatus = json["elseStatus"].flatMap { value -> Int? in
      if case .number(let number) = value { return Int(number) }
      return value.stringValue.flatMap(Int.init)
    } ?? 404
    self.then = json["then"].flatMap(ActionSpec.init).map(ActionSpecBox.init)
    self.when = json["when"]?.stringValue
    self.link = json["link"]?.stringValue
    self.besigner = json["besigner"]?.stringValue
    self.copy = json["copy"]?.stringValue
    self.reveal = json["reveal"]?.stringValue
    self.write = json["write"]
    self.instead = json["instead"]
    self.check = json["check"].flatMap(ActionSpec.init).map(ActionSpecBox.init)
  }

  /// Whether the action asks the person to confirm before it runs.
  public var asksConfirmation: Bool { confirm != nil || !confirmParts.isEmpty }

  /// The confirmation as the person reads it, over `scope`.
  public func confirmText(in scope: JSONValue) -> String? {
    if !confirmParts.isEmpty {
      return confirmParts.filter { ScreenValues.condition($0["when"]?.stringValue, in: scope) }
        .map { ScreenValues.render($0["text"]?.stringValue ?? "", in: scope) }.joined()
    }
    return confirm.map { ScreenValues.render($0, in: scope) }
  }

  /// The `instead` entry the route's answer meets, if any.
  public func insteadEntry(in scope: JSONValue) -> JSONValue? {
    guard let instead else { return nil }
    let entries: [JSONValue]
    if case .array(let list) = instead { entries = list } else { entries = [instead] }
    return entries.first { ScreenValues.condition($0["when"]?.stringValue, in: scope) }
  }

  /// Every field the action asks for before it runs: its prompt, then a reason.
  public var inputs: [FieldSpec] {
    reason
      ? prompt + [FieldSpec(key: "reason", label: "Reason", kind: "multiline", required: true,
          help: "Recorded in the audit log.")]
      : prompt
  }

  /// Whether the action asks for anything before it runs (a prompt, even one the data fills in, or a reason).
  public var asksInputs: Bool { !promptRaw.isEmpty || reason }

  /// The fields to ask for, with any `fieldsFrom` entry expanded from the data in `context`.
  public func inputs(in context: JSONValue) -> [FieldSpec] {
    let asked = FieldSpec.parseAll(promptRaw, in: context)
    return reason
      ? asked + [FieldSpec(key: "reason", label: "Reason", kind: "multiline", required: true, help: "Recorded in the audit log.")]
      : asked
  }
}

/// A screen to open, with its params as templates.
public struct NavigateSpec: Sendable {
  public let screen: String
  public let params: [String: String]

  init?(_ json: JSONValue) {
    guard let screen = json["screen"]?.stringValue else { return nil }
    self.screen = screen
    self.params = json["params"].objectEntries.reduce(into: [:]) { $0[$1.key] = $1.value.stringValue ?? ScreenValues.text($1.value) }
  }
}

/// An input in a form or an action's prompt.
public struct FieldSpec: Sendable, Identifiable {
  public var id: String { key }
  public let key: String
  public let label: String
  /// `text`, `email`, `url`, `number`, `multiline`, `password`, `toggle`, `select`, `date`.
  public let kind: String
  public let initial: String?
  public let placeholder: String?
  public let help: String?
  public let required: Bool
  public let options: [(value: String, label: String)]
  public let optionsFrom: JSONValue?
  public let when: String?
  /// A template the typed value must equal (type the workspace name to delete it).
  public let mustMatch: String?
  /// The bounds of a number field; one outside them leaves the field unfinished.
  public let min: Double?
  public let max: Double?
  /// A number field that takes whole numbers: what is typed is rounded to one.
  public let integer: Bool
  /// A regular expression a typed value must contain a match of (an https address); an empty value is left to `required`.
  public let pattern: String?

  /// Whether a value leaves this field unfinished: required and empty, or not the text it must match.
  public func unmet(_ value: JSONValue, in context: JSONValue) -> Bool {
    if let mustMatch, ScreenValues.text(value) != ScreenValues.render(mustMatch, in: context) { return true }
    if let pattern {
      let typed = ScreenValues.text(value)
      if !typed.isEmpty, typed.range(of: pattern, options: .regularExpression) == nil { return true }
    }
    if kind == "number", let number = ScreenValues.number(value) {
      if let min, number < min { return true }
      if let max, number > max { return true }
    }
    // A number field is finished by any number, zero too.
    let finished = ScreenValues.truthy(value) || (kind == "number" && ScreenValues.number(value) != nil)
    return required && kind != "toggle" && !finished
  }

  init(
    key: String, label: String, kind: String, initial: String?, help: String?, required: Bool,
    options: [(value: String, label: String)]
  ) {
    self.key = key
    self.label = label
    self.kind = kind
    self.initial = initial
    self.placeholder = nil
    self.help = help
    self.required = required
    self.options = options
    self.optionsFrom = nil
    self.when = nil
    self.mustMatch = nil
    self.min = nil
    self.max = nil
    self.integer = false
    self.pattern = nil
  }

  /// Fields from a spec's array, with each `{ "fieldsFrom": {...} }` entry expanded into one field per row of data
  /// (a service that names its own credential fields): `items` is the path to the rows; `key`, `label` and `help`
  /// are templates over `item`; `kinds` maps a row flag to a field kind (first set flag wins, else text), `yesno`
  /// being a No/Yes pick that sends "" or "true"; `options` names the row field holding `{value,label}` choices,
  /// which make a select; `required` names the row flag.
  static func parseAll(_ items: [JSONValue], in context: JSONValue) -> [FieldSpec] {
    items.flatMap { entry -> [FieldSpec] in
      guard let from = entry["fieldsFrom"] else { return FieldSpec(entry).map { [$0] } ?? [] }
      let rows = ScreenValues.rows(ScreenValues.lookup(from["items"]?.stringValue ?? "", in: context))
      let perRow = from["each"].array
      if !perRow.isEmpty {
        // `each`: a field template per entry, drawn for every row, so one row's fields sit together.
        return rows.enumerated().flatMap { position, row -> [FieldSpec] in
          let scope = ScreenContext.with(ScreenContext.with(context, item: row), "index", .number(Double(position)))
          return perRow.compactMap { template -> FieldSpec? in
            guard case .object(let record) = template else { return nil }
            let rendered = record.mapValues { value -> JSONValue in
              if case .string(let text) = value { return .string(ScreenValues.render(text, in: scope)) }
              return value
            }
            return FieldSpec(.object(rendered))
          }
        }
      }
      return rows.enumerated().compactMap { position, row -> FieldSpec? in
        // `{index}` is the row's place in the list, for a key that names the row by position.
        let scope = ScreenContext.with(ScreenContext.with(context, item: row), "index", .number(Double(position)))
        let key = ScreenValues.render(from["key"]?.stringValue ?? "{item.key}", in: scope)
        if key.isEmpty { return nil }
        let choices = row[from["options"]?.stringValue ?? "options"].array.map {
          (ScreenValues.text($0["value"]), ScreenValues.text($0["label"] ?? $0["value"]))
        }
        let kind = from["kinds"].objectEntries.first { ScreenValues.truthy(ScreenValues.lookup($0.key, in: row)) }?
          .value.stringValue
        let yesno = kind == "yesno"
        let help = from["help"]?.stringValue.map { ScreenValues.render($0, in: scope) }
        return FieldSpec(
          key: key, label: ScreenValues.render(from["label"]?.stringValue ?? "{item.label}", in: scope),
          kind: yesno || !choices.isEmpty ? "select" : (kind ?? from["kind"]?.stringValue ?? "text"),
          initial: yesno ? nil : (choices.first?.0 ?? from["initial"]?.stringValue), help: (help?.isEmpty ?? true) ? nil : help,
          required: from["required"]?.stringValue.map { ScreenValues.truthy(ScreenValues.lookup($0, in: row)) } ?? false,
          options: yesno ? [("", "No"), ("true", "Yes")] : choices)
      }
    }
  }

  init(key: String, label: String, kind: String, required: Bool, help: String?) {
    self.key = key
    self.label = label
    self.kind = kind
    self.initial = nil
    self.placeholder = nil
    self.help = help
    self.required = required
    self.options = []
    self.optionsFrom = nil
    self.when = nil
    self.mustMatch = nil
    self.min = nil
    self.max = nil
    self.integer = false
    self.pattern = nil
  }

  init?(_ json: JSONValue) {
    guard let key = json["key"]?.stringValue else { return nil }
    self.key = key
    self.label = json["label"]?.stringValue ?? key
    self.kind = json["kind"]?.stringValue ?? "text"
    self.initial = json["initial"]?.stringValue
    self.placeholder = json["placeholder"]?.stringValue
    self.help = json["help"]?.stringValue
    self.required = json["required"] == .bool(true)
    self.options = json["options"].array.map { option in
      if case .string(let value) = option { return (value, value.prefix(1).uppercased() + value.dropFirst()) }
      return (ScreenValues.text(option["value"]), ScreenValues.text(option["label"] ?? option["value"]))
    }
    self.optionsFrom = json["optionsFrom"]
    self.when = json["when"]?.stringValue
    self.mustMatch = json["mustMatch"]?.stringValue
    self.min = ScreenValues.number(json["min"])
    self.max = ScreenValues.number(json["max"])
    self.integer = json["integer"] == .bool(true)
    self.pattern = json["pattern"]?.stringValue
  }

  /// The choices for a `select`: the static options, then any read from data.
  public func choices(in context: JSONValue) -> [(value: String, label: String)] {
    guard let from = optionsFrom, let path = from["items"]?.stringValue else { return options }
    let valueTemplate = from["value"]?.stringValue ?? "{item.$id}"
    let labelTemplate = from["label"]?.stringValue ?? valueTemplate
    // A map (the site's screens by id) offers one choice per entry: `{ $id: key, $value: value }`, by value.
    let rows: [JSONValue]
    if case .object(let record)? = ScreenValues.lookup(path, in: context) {
      rows = record.map { JSONValue.object(["$id": .string($0.key), "$value": $0.value]) }
        .sorted { ScreenValues.text($0["$value"]).lowercased() < ScreenValues.text($1["$value"]).lowercased() }
    } else {
      rows = ScreenValues.lookup(path, in: context).array
    }
    // `where`: a condition on the row (`item.classification == bank`) that keeps only the choices it holds for.
    let keep = from["where"]?.stringValue
    return options + rows.map { ScreenContext.with(context, item: $0) }.filter { ScreenValues.condition(keep, in: $0) }.map { scope in
      // A label built from parts that may be empty reads clean: runs of spaces become one, and the ends are trimmed.
      let label = ScreenValues.render(labelTemplate, in: scope).replacingOccurrences(of: " {2,}", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespaces)
      return (ScreenValues.render(valueTemplate, in: scope), label)
    }
  }
}

extension Optional where Wrapped == JSONValue {
  var array: [JSONValue] {
    if case .array(let items)? = self { return items }
    return []
  }

  var arrayOfStrings: [String] { array.compactMap(\.stringValue) }

  var objectEntries: [(key: String, value: JSONValue)] {
    if case .object(let record)? = self { return record.sorted { $0.key < $1.key }.map { ($0.key, $0.value) } }
    return []
  }
}

/// The context a screen's templates read.
public enum ScreenContext {
  /// The context with `item` set to one row (and `parent` to the outer item).
  public static func with(_ context: JSONValue, item: JSONValue) -> JSONValue {
    guard case .object(var record) = context else { return context }
    if let outer = record["item"] { record["parent"] = outer }
    record["item"] = item
    return .object(record)
  }

  /// The context with `key` replaced.
  public static func with(_ context: JSONValue, _ key: String, _ value: JSONValue) -> JSONValue {
    guard case .object(var record) = context else { return context }
    record[key] = value
    return .object(record)
  }
}

/// An action held by reference, so an action can name its fallback.
public final class ActionSpecBox: Sendable {
  public let action: ActionSpec
  init(_ action: ActionSpec) { self.action = action }
}
