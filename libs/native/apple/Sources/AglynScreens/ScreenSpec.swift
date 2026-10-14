// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
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
  /// A path to rows an earlier load brought (`data.sites.sites`): this load then runs once per row,
  /// with the row as `item`, and its key holds the list of answers (a failed one is null).
  public let each: String?
  /// A pure function to call over data already loaded (`packageJsonDiff`, `packageMergeKeys`), its answer under
  /// this key; `args` are the paths (or numbers) it is given.
  public let compute: String?
  public let args: [String]

  init(key: String, _ json: JSONValue) {
    self.key = key
    if case .string(let url) = json {
      self.url = url
      self.when = nil
      self.cursor = nil
      self.cursorParam = "cursor"
      self.items = nil
      self.doc = nil
      self.query = nil
      self.switchboard = nil
      self.each = nil
      self.compute = nil
      self.args = []
      self.method = .get
      self.body = nil
      self.optional = false
    } else {
      self.url = json["url"]?.stringValue ?? ""
      self.when = json["when"]?.stringValue
      self.cursor = json["cursor"]?.stringValue
      self.cursorParam = json["cursorParam"]?.stringValue ?? "cursor"
      self.items = json["items"]?.stringValue
      self.doc = json["doc"]?.stringValue
      self.query = json["query"]
      self.switchboard = json["switchboard"]?.stringValue
      self.each = json["each"]?.stringValue
      self.compute = json["compute"]?.stringValue
      self.args = json["args"].arrayOfStrings
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
  /// A change to the signed-in person's own sign-in, made through the
  /// session (`changePassword`, `updateDisplayName`); its inputs are the body.
  public let account: String?

  /// `{ key: template }`: values kept for later screens as `stash.<key>` once the action succeeds
  /// (a chosen package, the plan read from it), until the app closes.
  public let stash: JSONValue?

  /// `passkey: { options, verify, origin, errors, otherwise }`: sets up a passkey on this device. The
  /// options route answers a WebAuthn challenge, the platform makes the credential, and the verify route
  /// stores it; `origin` is the `Origin` the routes check the ceremony against (`https://<relying party>`),
  /// `errors` maps a route's reason to the words shown and `otherwise` words any other failure.
  public let passkey: JSONValue?
  /// The action to run instead when the route answers 404 (add a member, else invite them).
  public let otherwise: ActionSpecBox?
  /// A follow-up the action makes once it succeeds (best effort, like the console's).
  public let then: ActionSpecBox?
  /// `download`: the route answers with a file (an export), not JSON; the person saves or shares it.
  /// Its value names the file when the route names none.
  public let download: String?
  /// `export: { resource, title, hostId }`: the platform's export sheet for a records resource (its
  /// fields, the format, then the file saved or shared), as every list opens it.
  public let export: JSONValue?
  /// `chunk: { field, bytes, idFrom, idKey, firstOnly, until }`: the file text in `field` of the body goes in
  /// parts of at most `bytes` (JSON-encoded), each with `part` and `parts`, the job the first answer names
  /// (`idFrom`) sent back as `idKey`; keys in `firstOnly` ride on the first part alone; `until` is the answer
  /// path that must be true when the last part has landed.
  public let chunk: JSONValue?
  /// `repeat: { until, max, stop, stopMessage }`: the action runs again while its answer does not meet
  /// `until` (a condition over `response`), as the console calls apply until the route says it is done; the
  /// stash takes every pass's answer, so a screen can show the progress; `stop` ends it as a failure.
  public let repeating: JSONValue?
  /// A follow-up that must succeed (unlike `then`): it runs once the action and its stash are done, with the
  /// stash and the action's answer in scope, and a failure of its own fails the action.
  public let after: ActionSpecBox?
  /// `downloadAt`: the route answers with JSON, and the file is the value at this path of it
  /// (a workspace package export wraps its file as `{ fileName, package }`). `download` is then a
  /// template over `response`, which names the file.
  public let downloadAt: String?
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
    self.success = json["success"]?.stringValue
    self.openURL = json["open"]?.stringValue
    self.navigate = json["navigate"].flatMap(NavigateSpec.init)
    self.back = json["back"] == .bool(true)
    self.reload = json["reload"] == .bool(true)
      || (json["reload"] != .bool(false)
        && (json["url"]?.stringValue != nil || json["write"] != nil || json["account"] != nil || json["passkey"] != nil))
    self.otherwise = json["else"].flatMap(ActionSpec.init).map(ActionSpecBox.init)
    self.then = json["then"].flatMap(ActionSpec.init).map(ActionSpecBox.init)
    self.when = json["when"]?.stringValue
    self.link = json["link"]?.stringValue
    self.besigner = json["besigner"]?.stringValue
    self.copy = json["copy"]?.stringValue
    self.reveal = json["reveal"]?.stringValue
    self.write = json["write"]
    self.account = json["account"]?.stringValue
    self.stash = json["stash"]
    self.download = json["download"]?.stringValue ?? (json["download"] == .bool(true) ? "download" : nil)
    self.downloadAt = json["downloadAt"]?.stringValue
    self.export = json["export"]
    self.chunk = json["chunk"]
    self.repeating = json["repeat"]
    self.after = json["after"].flatMap(ActionSpec.init).map(ActionSpecBox.init)
    self.passkey = json["passkey"]
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

  /// The export sheet's request, with the action's templates read in `scope`; nil when the action opens none.
  public func exportRequest(in scope: JSONValue) -> TransferExportRequest? {
    guard let export, let resource = export["resource"]?.stringValue else { return nil }
    let key = ScreenValues.render(resource, in: scope)
    guard !key.isEmpty else { return nil }
    let title = ScreenValues.render(export["title"]?.stringValue ?? "Export", in: scope)
    let host = export["hostId"]?.stringValue.map { ScreenValues.render($0, in: scope) }.flatMap { $0.isEmpty ? nil : $0 }
    let stem = key.replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: ".", with: "-")
    return TransferExportRequest(resource: key, title: title, hostID: host, scope: ["kind": "all"], fileStem: stem)
  }

  /// Every field the action asks for before it runs: its prompt, then a reason.
  public var inputs: [FieldSpec] {
    reason
      ? prompt + [FieldSpec(key: "reason", label: "Reason", kind: "multiline", required: true,
          help: "Recorded in the audit log.")]
      : prompt
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
  /// For a `file` field: `json` parses the chosen file and sends the value, else its text is sent.
  public let parse: String?
  /// For a `multiselect`: the field is unfinished until every choice is chosen (the warnings an
  /// import must have acknowledged, each one).
  public let coversAll: Bool

  /// Whether a value leaves this field unfinished: required and empty, or not the text it must match.
  public func unmet(_ value: JSONValue, in context: JSONValue) -> Bool {
    if let mustMatch, ScreenValues.text(value) != ScreenValues.render(mustMatch, in: context) { return true }
    if coversAll, kind == "multiselect" {
      let chosen = Set(Optional(value).array.compactMap { $0.stringValue })
      if choices(in: context).contains(where: { !chosen.contains($0.value) }) { return true }
    }
    return required && kind != "toggle" && !ScreenValues.truthy(value)
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
    self.parse = nil
    self.coversAll = false
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
    self.parse = json["parse"]?.stringValue
    self.coversAll = json["coversAll"] == .bool(true)
  }

  /// The choices for a `select`: the static options, then any read from data.
  public func choices(in context: JSONValue) -> [(value: String, label: String)] {
    guard let from = optionsFrom, let path = from["items"]?.stringValue else { return options }
    let valueTemplate = from["value"]?.stringValue ?? "{item.$id}"
    let labelTemplate = from["label"]?.stringValue ?? valueTemplate
    let scopes = ScreenValues.scopes(
      items: path, within: from["within"]?.stringValue, filter: from["filter"]?.stringValue, in: context)
    return options + scopes.map { scope in
      (ScreenValues.render(valueTemplate, in: scope), ScreenValues.render(labelTemplate, in: scope))
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
