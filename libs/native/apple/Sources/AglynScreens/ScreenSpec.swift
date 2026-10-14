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
  /// The response field holding the rows to append page after page.
  public let items: String?
  /// `POST` for a route that answers reads by POST (with `body`); GET otherwise.
  public let method: HTTPMethod
  public let body: JSONValue?
  /// A load whose failure leaves its key null instead of failing the screen.
  public let optional: Bool
  /// Statuses whose body is the answer, not a failure: a health probe answers 503 when it reports degraded.
  public let accept: [Int]
  /// The staff list routes' `filters`: `{ field, op, value }` clauses, each kept when its value template is not empty.
  public let filters: [JSONValue]
  /// A Firestore document path to read instead of a route.
  public let doc: String?
  /// A Firestore collection query to read instead of a route.
  public let query: JSONValue?
  /// `org` or `site`: the plugin switchboard's rows (SwitchboardRows).
  public let switchboard: String?
  /// Runs once the other loads have answered, with their answers under `data`: a read keyed by
  /// something another read found (a site's workspace id).
  public let late: Bool
  /// The query parameter a staff list route orders by (`sort=<path>:<dir>`), and the order it answers when none was asked.
  /// A list's `route` columns ask for the others.
  public let sortParam: String?
  public let sortDefault: String?
  /// For a Firestore `query` that returned its whole `limit`: how many more rows each "Show more" reads. The query is read
  /// again with the larger limit, so a collection too big for one read can still be gone through to its end.
  public let more: Int?

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
      self.method = .get
      self.body = nil
      self.optional = false
      self.accept = []
      self.filters = []
      self.late = false
      self.sortParam = nil
      self.sortDefault = nil
      self.more = nil
    } else {
      self.url = json["url"]?.stringValue ?? ""
      self.when = json["when"]?.stringValue
      self.cursor = json["cursor"]?.stringValue
      self.cursorParam = json["cursorParam"]?.stringValue ?? "cursor"
      self.items = json["items"]?.stringValue
      self.doc = json["doc"]?.stringValue
      self.query = json["query"]
      self.switchboard = json["switchboard"]?.stringValue
      self.method = HTTPMethod(rawValue: (json["method"]?.stringValue ?? "GET").uppercased()) ?? .get
      self.body = json["body"]
      self.optional = json["optional"] == .bool(true)
      self.accept = json["accept"].array.compactMap { value in value.numberValue.map { Int($0) } }
      self.filters = json["filters"].array
      self.late = json["late"] == .bool(true)
      self.sortParam = json["sortParam"]?.stringValue
      self.sortDefault = json["sortDefault"]?.stringValue
      self.more = ScreenValues.number(json["more"]).map { Int($0) }
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
  /// A staff list route's `filters` for a GET action (the audit log's CSV export): `{ field, op, value }` clauses,
  /// each kept when its value template is not empty, as a load's are.
  public let filters: [JSONValue]
  /// Request headers, name to template. `{attempt}` is a key that stays the same while the same
  /// action sends the same body (a retry), and changes with the body: `Idempotency-Key` for a
  /// route that provisions something (enterprise billing). A route that wants the key in its body
  /// (`idempotencyKey`) writes `{attempt}` there and gets the same key.
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
  /// Lines the result is reported in, after `success`: `{ when, each, text }`, one per line.
  public let report: [ReportLine]
  /// Lines a refusal is explained in, after the route's own words, over the route's answer as `response`
  /// (the workspaces that still need an owner, the addresses another account holds).
  public let failure: [ReportLine]
  /// Lines the screen keeps in its session log (`session.log`, newest first) when the action succeeds, as the console's
  /// "Actions taken in this session" does: a lock or lift that reached the server, stamped with when, and verified or not.
  public let log: [ReportLine]
  /// A key the screen remembers as armed (`session.armed.<key>`) once the action succeeds, and forgets if it fails: a
  /// preview that has been read, which a guarded run waits for.
  public let arm: String?
  /// A key the screen forgets once the action succeeds: the run that spends its preview.
  public let disarm: String?
  /// `{ token, tenantId }`: paths in the route's answer. Once the action succeeds the app signs in as the customer with the
  /// custom token found at `token` (a support session), in the identity pool named at `tenantId`. The token is a credential:
  /// it goes to the session and is shown nowhere.
  public let impersonate: ImpersonateSpec?
  /// Hands text to the device as a file (Save, or the share sheet): the working papers' CSV, the audit log's.
  public let file: FileSpec?
  /// Repeats the request page by page until the route is done, and answers the totals.
  public let loop: LoopSpec?
  /// The action to run instead when the route answers 404 (add a member, else invite them).
  public let otherwise: ActionSpecBox?
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
    self.filters = json["filters"].array
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
    self.reload = json["reload"] != .bool(false) && (json["url"]?.stringValue != nil || json["write"] != nil)
    self.otherwise = json["else"].flatMap(ActionSpec.init).map(ActionSpecBox.init)
    self.then = json["then"].flatMap(ActionSpec.init).map(ActionSpecBox.init)
    self.when = json["when"]?.stringValue
    self.link = json["link"]?.stringValue
    self.besigner = json["besigner"]?.stringValue
    self.copy = json["copy"]?.stringValue
    self.reveal = json["reveal"]?.stringValue
    self.write = json["write"]
    self.report = json["report"].array.compactMap(ReportLine.init)
    self.failure = json["failure"].array.compactMap(ReportLine.init)
    self.log = json["log"].array.compactMap(ReportLine.init)
    self.arm = json["arm"]?.stringValue
    self.disarm = json["disarm"]?.stringValue
    self.impersonate = json["impersonate"].flatMap(ImpersonateSpec.init)
    self.loop = json["loop"].flatMap(LoopSpec.init)
    self.file = json["file"].flatMap(FileSpec.init)
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

  /// Every field the action asks for before it runs: its prompt (a field with `each` becoming one per row), then a reason.
  public func inputs(in scope: JSONValue) -> [FieldSpec] {
    let asked = prompt.flatMap { $0.expanded(in: scope) }
    return reason
      ? asked + [FieldSpec(key: "reason", label: "Reason", kind: "multiline", required: true, help: "Recorded in the audit log.")]
      : asked
  }
}

/// Where in a route's answer a support session's custom token and identity pool are.
public struct ImpersonateSpec: Sendable {
  public let token: String
  public let tenantId: String?

  init?(_ json: JSONValue) {
    guard let token = json["token"]?.stringValue else { return nil }
    self.token = token
    self.tenantId = json["tenantId"]?.stringValue
  }

  /// The token and pool a route answered, or nil when it named no token.
  public func resolve(in response: JSONValue?) -> (token: String, tenantId: String?)? {
    let answer = response ?? .null
    guard let found = ScreenValues.lookup(token, in: answer)?.stringValue, !found.isEmpty else { return nil }
    let pool = tenantId.flatMap { ScreenValues.lookup($0, in: answer)?.stringValue }.flatMap { $0.isEmpty ? nil : $0 }
    return (found, pool)
  }
}

/// `{ name, type, from }`: the file an action hands to the device. `name` is a template, `type` a MIME type, and
/// `from` the path (over the screen's context and the route's `response`) of the text that is the file.
public struct FileSpec: Sendable {
  public let name: String
  public let type: String
  public let from: String

  init?(_ json: JSONValue) {
    guard let name = json["name"]?.stringValue, let from = json["from"]?.stringValue else { return nil }
    self.name = name
    self.type = json["type"]?.stringValue ?? "text/plain"
    self.from = from
  }

  /// The file name and the text, or nil when there is nothing to hand over.
  public func contents(in context: JSONValue) -> (name: String, text: String)? {
    let text = ScreenValues.text(ScreenValues.lookup(from, in: context))
    return text.isEmpty ? nil : (ScreenValues.render(name, in: context), text)
  }
}

/// One line of an action's report. `each` repeats it for every row of a list or entry of a map (`item`); `when` drops it
/// (for a repeated line, row by row). In a `log`, `confirmed` is a condition for the line to read as verified (default: it does).
public struct ReportLine: Sendable {
  public let text: String
  public let when: String?
  public let each: String?
  public let confirmed: String?

  init?(_ json: JSONValue) {
    if let text = json.stringValue {
      self.text = text
      self.when = nil
      self.each = nil
      self.confirmed = nil
      return
    }
    guard let text = json["text"]?.stringValue else { return nil }
    self.text = text
    self.when = json["when"]?.stringValue
    self.each = json["each"]?.stringValue
    self.confirmed = json["confirmed"]?.stringValue
  }
}

/// A route that works in pages: the request repeats, with the cursor it answered, until it says it is done.
public struct LoopSpec: Sendable {
  /// The response field holding the next cursor.
  public let cursor: String
  /// The body field the cursor goes back in.
  public let param: String
  /// The response field that is true on the last page.
  public let until: String?
  /// Pages at most.
  public let max: Int

  init?(_ json: JSONValue) {
    self.cursor = json["cursor"]?.stringValue ?? "nextCursor"
    self.param = json["param"]?.stringValue ?? "cursor"
    self.until = json["until"]?.stringValue
    self.max = json["max"]?.numberValue.map { Int($0) } ?? 40
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
  /// `text`, `email`, `url`, `number`, `multiline`, `password`, `toggle`, `select`, `country`, `date`.
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
  /// A list (a path) this field repeats for, one field per row, with `item` the row: the values a template of an
  /// email is tested with, a field for each. The key, label, help and initial value are rendered per row.
  public let each: String?
  /// `{ length, alphabet }`: the field offers a button that fills it with a random value of that many
  /// characters drawn from the alphabet (a template; the console's password generator).
  public let generate: JSONValue?
  /// A `lookup` field's sources: the kinds of record a person can search, and what picking one fills in.
  public let groups: [LookupGroup]

  /// A fresh value for a field that `generate`s one (`length` and `alphabet` are templates, so a spec can name
  /// the console's own constants); nil for a field that does not.
  public func generatedValue(in context: JSONValue) -> String? {
    guard let generate else { return nil }
    let length = generate["length"].flatMap { raw -> Double? in
      raw.stringValue.map { ScreenValues.number(ScreenValues.resolve($0, in: context)) } ?? ScreenValues.number(raw)
    }
    return ScreenValues.generated(
      length: Int(length ?? 20), alphabet: ScreenValues.render(generate["alphabet"]?.stringValue ?? "", in: context))
  }

  /// Whether a value leaves this field unfinished: required and empty, or not the text it must match.
  public func unmet(_ value: JSONValue, in context: JSONValue) -> Bool {
    if let mustMatch, ScreenValues.text(value) != ScreenValues.render(mustMatch, in: context) { return true }
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
    self.generate = nil
    self.groups = []
    self.each = nil
  }

  /// One field of an `each` field's rows: its templates rendered over the row.
  private init(_ template: FieldSpec, row: JSONValue, in scope: JSONValue) {
    let item = ScreenContext.with(scope, item: row)
    func rendered(_ text: String?) -> String? { text.map { ScreenValues.render($0, in: item) } }
    key = ScreenValues.render(template.key, in: item)
    label = ScreenValues.render(template.label, in: item)
    kind = template.kind
    // The initial value is final here, so a brace in it is text and not a template.
    initial = rendered(template.initial).map { $0.replacingOccurrences(of: "{", with: "{{") }
    placeholder = template.placeholder
    help = rendered(template.help)
    required = template.required
    options = template.options
    optionsFrom = template.optionsFrom
    when = template.when
    mustMatch = template.mustMatch
    generate = template.generate
    groups = template.groups
    each = nil
  }

  /// This field as it is asked: itself, or one per row of its `each` list.
  public func expanded(in scope: JSONValue) -> [FieldSpec] {
    guard let each else { return [self] }
    return ScreenValues.rows(ScreenValues.lookup(each, in: scope)).map { FieldSpec(self, row: $0, in: scope) }
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
    self.generate = json["generate"]
    self.groups = json["groups"].array.compactMap(LookupGroup.init)
    self.each = json["each"]?.stringValue
  }

  /// The choices for a `select`: the static options, then any read from data. A `country` field offers the
  /// platform's regions after them.
  public func choices(in context: JSONValue) -> [(value: String, label: String)] {
    if kind == "country" { return options + ScreenRegions.choices() }
    guard let from = optionsFrom, let path = from["items"]?.stringValue else { return options }
    let valueTemplate = from["value"]?.stringValue ?? "{item.$id}"
    let labelTemplate = from["label"]?.stringValue ?? valueTemplate
    let rows = ScreenValues.lookup(path, in: context).array
    return options + rows.map { row in
      let scope = ScreenContext.with(context, item: row)
      return (ScreenValues.render(valueTemplate, in: scope), ScreenValues.render(labelTemplate, in: scope))
    }
  }
}

/// One kind of record a `lookup` field searches (the system email test's "Populate from": workspaces, sites, people), and
/// the form fields picking one fills in. The route searches by the `search` word, as a list's search does.
public struct LookupGroup: Sendable, Identifiable {
  public let id: String
  public let label: String
  /// The route that lists the records; the words typed go on as `search`.
  public let url: String
  /// The path in the answer of the list of records.
  public let items: String
  public let title: String
  public let subtitle: String?
  /// Form fields set from the picked record, whatever it holds: `key` is the field's key, the value a template over `item`.
  public let fill: [(key: String, value: String)]
  /// The same, but only when the template comes out with something (the person's address, as the recipient).
  public let fillWhenSet: [(key: String, value: String)]

  init?(_ json: JSONValue) {
    guard let id = json["id"]?.stringValue, let url = json["url"]?.stringValue, let items = json["items"]?.stringValue,
      let title = json["title"]?.stringValue
    else { return nil }
    self.id = id
    self.label = json["label"]?.stringValue ?? id
    self.url = url
    self.items = items
    self.title = title
    self.subtitle = json["subtitle"]?.stringValue
    self.fill = json["fill"].objectEntries.compactMap { entry in entry.value.stringValue.map { (entry.key, $0) } }
    self.fillWhenSet = json["fillWhenSet"].objectEntries.compactMap { entry in entry.value.stringValue.map { (entry.key, $0) } }
  }

  /// The route to ask for the words typed (blank lists the first few).
  public func request(words: String) -> String {
    let trimmed = words.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return url }
    return url + (url.contains("?") ? "&" : "?") + "search=" + ScreenValues.encodeComponent(trimmed)
  }

  /// The records an answer holds.
  public func rows(in response: JSONValue?) -> [JSONValue] {
    ScreenValues.rows(response.flatMap { ScreenValues.lookup(items, in: $0) })
  }

  public func heading(for row: JSONValue, in context: JSONValue) -> String {
    ScreenValues.render(title, in: ScreenContext.with(context, item: row))
  }

  public func detail(for row: JSONValue, in context: JSONValue) -> String? {
    subtitle.map { ScreenValues.render($0, in: ScreenContext.with(context, item: row)) }.flatMap { $0.isEmpty ? nil : $0 }
  }

  /// What picking `row` writes into the form: every `fill` entry, then the `fillWhenSet` entries that came out non-blank,
  /// for the fields the form has (`keys`): a template that takes no `org.id` has no field for it.
  public func fills(for row: JSONValue, in context: JSONValue, among keys: Set<String>) -> [(key: String, value: String)] {
    let scope = ScreenContext.with(context, item: row)
    let always = fill.map { ($0.key, ScreenValues.render($0.value, in: scope)) }
    let sometimes = fillWhenSet.map { ($0.key, ScreenValues.render($0.value, in: scope)) }.filter { !$0.1.isEmpty }
    return (always + sometimes).filter { keys.contains($0.0) }
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
