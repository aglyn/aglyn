// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import Foundation
import Observation
import SwiftUI

/// Who is signed in and where, beyond what a plugin context carries: the
/// shell sets it once in the environment, and every spec screen reads it.
public struct ScreenSession: Sendable {
  public var email: String?
  public var displayName: String?
  public var orgName: String?
  public var orgRole: String?
  public var siteName: String?
  public var claims: TokenClaims
  public var origin: String
  /// Signs in again with the password, so the next token carries a fresh
  /// `auth_time` (routes that guard a dangerous step ask for one).
  public var reauthenticate: @Sendable (_ password: String) async throws -> Void
  /// Re-reads the token's claims (after a reauth, or when a screen asks).
  public var refreshClaims: @Sendable () async -> Void

  public init(
    email: String? = nil, displayName: String? = nil, orgName: String? = nil, orgRole: String? = nil,
    siteName: String? = nil, claims: TokenClaims = TokenClaims(), origin: String = "",
    reauthenticate: @escaping @Sendable (String) async throws -> Void = { _ in },
    refreshClaims: @escaping @Sendable () async -> Void = {}
  ) {
    self.email = email
    self.displayName = displayName
    self.orgName = orgName
    self.orgRole = orgRole
    self.siteName = siteName
    self.claims = claims
    self.origin = origin
    self.reauthenticate = reauthenticate
    self.refreshClaims = refreshClaims
  }

  /// The base context every template reads.
  public func context(_ plugin: NativePluginContext?, params: NativeParams) -> JSONValue {
    let role = orgRole ?? ""
    let manager = role == "owner" || role == "admin"
    var paramRecord: [String: JSONValue] = [:]
    for (key, value) in params { paramRecord[key] = .string(value) }
    return [
      "org": [
        "id": plugin?.orgID.map(JSONValue.string) ?? .null,
        "slug": plugin?.orgSlug.map(JSONValue.string) ?? .null,
        "name": orgName.map(JSONValue.string) ?? .null,
        "role": .string(role),
        "manager": .bool(manager || claims.isStaff),
        "owner": .bool(role == "owner"),
      ],
      "site": [
        "id": plugin?.hostID.map(JSONValue.string) ?? .null,
        "slug": plugin?.hostSlug.map(JSONValue.string) ?? .null,
        "name": siteName.map(JSONValue.string) ?? .null,
      ],
      "user": [
        "uid": plugin.map { JSONValue.string($0.uid) } ?? .null,
        "email": email.map(JSONValue.string) ?? .null,
        "name": displayName.map(JSONValue.string) ?? .null,
      ],
      "staff": [
        "is": .bool(claims.isStaff),
        "role": claims.staffRole.map(JSONValue.string) ?? .null,
        "super": .bool(claims.isSuper),
      ],
      "app": ["origin": .string(origin)],
      "now": ScreenSession.now(),
      "params": .object(paramRecord),
      "data": [:],
      "form": [:],
    ]
  }
}

extension ScreenSession {
  /// Today, for routes that take a period: `month` (YYYY-MM) and `quarter` (YYYY-Qn), in UTC as the routes keep them.
  static func now(_ date: Date = Date()) -> JSONValue {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    let parts = calendar.dateComponents([.year, .month], from: date)
    let year = parts.year ?? 2026
    let month = parts.month ?? 1
    let previousYear = month == 1 ? year - 1 : year
    let previousMonth = month == 1 ? 12 : month - 1
    return [
      "month": .string(String(format: "%04d-%02d", year, month)),
      "previousMonth": .string(String(format: "%04d-%02d", previousYear, previousMonth)),
      "quarter": .string("\(year)-Q\((month - 1) / 3 + 1)"),
      "ms": .number((date.timeIntervalSince1970 * 1000).rounded()),
    ]
  }
}

extension EnvironmentValues {
  @Entry public var aglynScreenSession = ScreenSession()
}

/// What running an action came to.
public enum ActionOutcome: Equatable {
  case done(message: String?, response: JSONValue?)
  /// The route wants a recent sign-in (`reauth-required`) before it acts.
  case needsReauth(String)
  case failed(String)
}

/// One spec screen's state: its loaded data and the actions it runs.
@MainActor
@Observable
public final class ScreenModel {
  public enum Phase: Equatable {
    case loading
    case ready
    case failed(String)
  }

  public let spec: ScreenSpec
  public private(set) var phase: Phase = .loading
  /// The context with `data` filled.
  public private(set) var context: JSONValue
  /// The cursor of each paged load's next page, by load key.
  public private(set) var cursors: [String: String] = [:]
  public private(set) var loadingMore: Set<String> = []
  /// Per-block search words for loads whose route searches (`search` param).
  public var search: [String: String] = [:]
  /// What the person has done on this screen since it opened, newest first: `{ at, text, confirmed }` (`session.log`).
  public private(set) var journal: [JSONValue] = []
  /// Keys an action armed (`arm`) and none has spent (`disarm`): `session.armed.<key>`.
  public private(set) var armed: Set<String> = []
  /// The order each list was asked for (by its load, else its items); absent is the route's own default.
  public var order: [String: ListOrder] = [:]
  /// The columns each list shows, where the person has picked; absent is the list's own defaults.
  public var shown: [String: Set<String>] = [:]
  /// The `{attempt}` key of each action's last request, by action, path and body: a retry of the
  /// same request reuses it, and a different request gets its own.
  @ObservationIgnored private var attempts: [String: String] = [:]
  @ObservationIgnored private let api: ConsoleAPIClient?
  @ObservationIgnored private let reader: FirestoreReader?
  @ObservationIgnored private let writer: FirestoreWriter?

  public init(
    spec: ScreenSpec, context: JSONValue, api: ConsoleAPIClient?, reader: FirestoreReader? = nil,
    writer: FirestoreWriter? = nil
  ) {
    self.spec = spec
    // A spec's fixed rows (`constants`) read as `const`.
    self.context = ScreenContext.with(
      spec.raw["constants"].map { ScreenContext.with(context, "const", $0) } ?? context, "session",
      Self.sessionValue(journal: [], armed: []))
    self.api = api
    self.reader = reader
    self.writer = writer
  }

  /// Seeds data without a network (previews, snapshot tests).
  public func seed(_ data: JSONValue) {
    context = ScreenContext.with(context, "data", data)
    phase = .ready
  }

  public var data: JSONValue { context["data"] ?? [:] }

  func url(for load: LoadSpec, cursor: String? = nil, in scope: JSONValue? = nil) -> String {
    let context = scope ?? self.context
    var url = ScreenValues.renderURL(load.url, in: context)
    if let words = search[load.key], !words.trimmingCharacters(in: .whitespaces).isEmpty {
      url += (url.contains("?") ? "&" : "?") + "search=" + ScreenValues.encodeComponent(words)
    }
    if let filters = Self.filtersParameter(load.filters, in: context) {
      url += (url.contains("?") ? "&" : "?") + filters
    }
    if let param = load.sortParam {
      // A list's `route` columns order the route over every row; nothing asked is the route's own default.
      let columns = spec.blocks.filter { $0.type == "list" && ListColumns.key(of: $0) == load.key }.flatMap { ListColumns.columns(of: $0) }
      if let value = ListColumns.routeValue(order[load.key], columns: columns) ?? load.sortDefault {
        url += (url.contains("?") ? "&" : "?") + param + "=" + ScreenValues.encodeComponent(value)
      }
    }
    if let cursor {
      url += (url.contains("?") ? "&" : "?") + load.cursorParam + "=" + ScreenValues.encodeComponent(cursor)
    }
    return url
  }

  /// Asks a list for an order. A `route` column reads the route again in that order, from the first page; a `page`
  /// column reorders what is on the screen.
  public func ask(_ order: ListOrder?, of key: String, routed: Bool) async {
    self.order[key] = order
    if routed { await load() }
  }

  /// A list's columns with the picks made, or its defaults.
  func shownColumns(of key: String, in columns: [ListColumn]) -> Set<String> {
    shown[key] ?? Set(columns.filter(\.show).map(\.id))
  }

  /// What the person's picks for the columns a plugin contributes to a list read: one request per plugin column for the rows on
  /// the screen (in batches of `max`, as the route allows), answered under `column.<id>`. A column that cannot be read leaves its
  /// cells blank; it never fails the screen.
  func loadPluginColumns() async {
    guard let api else { return }
    var answers: [String: JSONValue] = [:]
    for block in spec.blocks where block.type == "list" {
      guard let zone = block["columnsZone"]?.stringValue else { continue }
      let rows = ScreenValues.rows(ScreenValues.lookup(block["items"]?.stringValue ?? "", in: context))
      for contribution in ScreenCatalog.shared.zone(zone) where ScreenValues.condition(contribution.requires, in: context) {
        guard let column = contribution.raw["column"], let id = column["id"]?.stringValue, let template = column["load"]?["url"]?.stringValue
        else { continue }
        let idTemplate = column["load"]?["ids"]?.stringValue ?? "{item.$id}"
        let ids = rows.map { ScreenValues.render(idTemplate, in: ScreenContext.with(context, item: $0)) }.filter { !$0.isEmpty }
        let batch = max(1, Int(column["load"]?["max"]?.numberValue ?? 100))
        var answer: JSONValue = .object([:])
        for start in stride(from: 0, to: ids.count, by: batch) {
          let chunk = ids[start..<min(start + batch, ids.count)].joined(separator: ",")
          let path = ScreenValues.renderURL(template, in: ScreenContext.with(context, "ids", .string(chunk)))
          if let part = try? await api.request(path) { answer = Self.merged(answer, part) }
        }
        answers[id] = answer
      }
    }
    guard !answers.isEmpty else { return }
    context = ScreenContext.with(context, "column", .object(answers))
  }

  /// `b` laid over `a`: maps join (by key, down through maps), anything else takes `b`.
  static func merged(_ a: JSONValue, _ b: JSONValue) -> JSONValue {
    guard case .object(var left) = a, case .object(let right) = b else { return b }
    for (key, value) in right { left[key] = left[key].map { merged($0, value) } ?? value }
    return .object(left)
  }

  /// A staff list route's `filters=` parameter from `{ field, op, value }` clauses, each kept when its value template is not empty.
  static func filtersParameter(_ filters: [JSONValue], in context: JSONValue) -> String? {
    let clauses: [JSONValue] = filters.compactMap { clause in
      let value = ScreenValues.render(clause["value"]?.stringValue ?? "", in: context)
      guard !value.isEmpty, let field = clause["field"]?.stringValue else { return nil }
      return ["field": .string(field), "op": clause["op"] ?? "equals", "value": .string(value)]
    }
    guard !clauses.isEmpty, let data = try? JSONValue.array(clauses).encoded(), let json = String(data: data, encoding: .utf8) else { return nil }
    return "filters=" + ScreenValues.encodeComponent(json)
  }

  /// Every load the screen's conditions allow, in parallel. A failed load
  /// fails the screen with the route's own words.
  public func load() async {
    if case .object(let record) = data, record.isEmpty { phase = .loading }
    guard let api else {
      phase = .failed("Sign in to continue.")
      return
    }
    var results: [String: JSONValue] = [:]
    var nextCursors: [String: String] = [:]
    do {
      // The loads run in parallel; a `late` one waits for the rest, reads their answers, and its `when` can too.
      for late in [false, true] {
        let scope = results.isEmpty ? context : ScreenContext.with(context, "data", .object(results))
        let wave = spec.loads.filter { $0.late == late && ScreenValues.condition($0.when, in: scope) }
        if wave.isEmpty { continue }
        try await withThrowingTaskGroup(of: (String, JSONValue, String?).self) { group in
          let reader = reader
          for load in wave {
            let path = url(for: load, in: scope)
            group.addTask {
              do {
                return try await Self.fetch(load, path: path, api: api, reader: reader, context: scope)
              } catch where load.optional && !(error is CancellationError) {
                return (load.key, .null, nil)
              }
            }
          }
          for try await (key, value, cursor) in group {
            results[key] = value
            if let cursor, !cursor.isEmpty { nextCursors[key] = cursor }
          }
        }
      }
    } catch is CancellationError {
      return
    } catch {
      phase = .failed((error as? ConsoleAPIError)?.message ?? error.localizedDescription)
      return
    }
    context = ScreenContext.with(context, "data", .object(results))
    cursors = nextCursors
    phase = .ready
    await loadPluginColumns()
  }

  /// One load: a Firestore document or query, or a route.
  nonisolated static func fetch(
    _ load: LoadSpec, path: String, api: ConsoleAPIClient, reader: FirestoreReader?, context: JSONValue
  ) async throws -> (String, JSONValue, String?) {
    if let doc = load.doc {
      guard let reader else { return (load.key, .null, nil) }
      let value = try await FirestoreLoads.document(reader, ScreenValues.render(doc, in: context))
      return (load.key, value, nil)
    }
    if let scope = load.switchboard {
      guard let reader else { return (load.key, .null, nil) }
      let org = try await FirestoreLoads.document(reader, ScreenValues.render("orgs/{org.id}", in: context))
      guard scope == "site" else { return (load.key, SwitchboardRows.org(org), nil) }
      let host = try await FirestoreLoads.document(reader, ScreenValues.render("hosts/{site.id}", in: context))
      return (load.key, SwitchboardRows.site(org, host), nil)
    }
    if let query = load.query {
      guard let reader else { return (load.key, .null, nil) }
      return (load.key, try await FirestoreLoads.query(reader, query, in: context), nil)
    }
    let body = load.body.map { ScreenValues.resolveBody($0, in: context) }
    let value: JSONValue
    do {
      value = try await api.request(path, method: load.method, body: body) ?? .null
    } catch let error as ConsoleAPIError where load.accept.contains(error.status) && error.body != nil {
      // A probe that answers 503 is reporting, and the report is the body.
      value = error.body ?? .null
    }
    let cursor = load.cursor.flatMap { ScreenValues.lookup($0, in: value)?.stringValue }
    return (load.key, value, cursor)
  }

  /// The next page of a paged load, appended to its rows.
  public func loadMore(_ key: String) async {
    guard let api, let load = spec.loads.first(where: { $0.key == key }), let cursor = cursors[key],
      let itemsPath = load.items, !loadingMore.contains(key)
    else { return }
    loadingMore.insert(key)
    defer { loadingMore.remove(key) }
    do {
      let page = try await api.request(url(for: load, cursor: cursor)) ?? .null
      let more = ScreenValues.lookup(itemsPath, in: page).array
      guard case .object(var record) = data, var current = record[key] else { return }
      current = Self.appending(more, at: itemsPath, in: current)
      record[key] = current
      context = ScreenContext.with(context, "data", .object(record))
      cursors[key] = load.cursor.flatMap { ScreenValues.lookup($0, in: page)?.stringValue }
      if cursors[key]?.isEmpty ?? true { cursors[key] = nil }
    } catch {
      return
    }
    await loadPluginColumns()
  }

  static func appending(_ rows: [JSONValue], at path: String, in value: JSONValue) -> JSONValue {
    let segments = path.split(separator: ".").map(String.init)
    guard let first = segments.first else {
      if case .array(let items) = value { return .array(items + rows) }
      return value
    }
    guard case .object(var record) = value else { return value }
    let rest = segments.dropFirst().joined(separator: ".")
    record[first] = appending(rows, at: rest, in: record[first] ?? .array([]))
    return .object(record)
  }

  /// Runs an action against `scope` (the screen's context, maybe with an
  /// item and the filled inputs under `form`).
  public func run(_ action: ActionSpec, in scope: JSONValue) async -> ActionOutcome {
    let outcome = await perform(action, in: scope)
    switch outcome {
    case .done(_, let response):
      remember(action, response: response, in: scope)
      if let then = action.then?.action {
        _ = await perform(then, in: ScreenContext.with(scope, "response", response ?? .null))
      }
    case .failed:
      // A preview that failed read nothing, so nothing is armed by it.
      if let key = action.arm, armed.contains(key) {
        armed.remove(key)
        publishSession()
      }
    case .needsReauth:
      break
    }
    return outcome
  }

  /// The session the templates read: the log, and what is armed.
  static func sessionValue(journal: [JSONValue], armed: Set<String>) -> JSONValue {
    .object([
      "log": .array(journal),
      "armed": .object(Dictionary(uniqueKeysWithValues: armed.map { ($0, JSONValue.bool(true)) })),
    ])
  }

  private func publishSession() {
    context = ScreenContext.with(context, "session", Self.sessionValue(journal: journal, armed: armed))
  }

  /// The most lines the session log keeps, as the console's does.
  static let journalLimit = 25

  /// What a successful action leaves on the screen: its `log` lines (the last listed on top, as the console prepends
  /// the lines of one act in the order they happened), and the key it arms or spends.
  private func remember(_ action: ActionSpec, response: JSONValue?, in scope: JSONValue) {
    let entries = Self.logEntries(action.log, response: response, in: scope, at: Date().timeIntervalSince1970 * 1000)
    if !entries.isEmpty { journal = Array((entries.reversed() + journal).prefix(Self.journalLimit)) }
    if let key = action.arm { armed.insert(key) }
    if let key = action.disarm { armed.remove(key) }
    if !entries.isEmpty || action.arm != nil || action.disarm != nil { publishSession() }
  }

  /// The session-log entries an action's `log` lines make of its answer.
  static func logEntries(_ log: [ReportLine], response: JSONValue?, in scope: JSONValue, at millis: Double) -> [JSONValue] {
    let context = ScreenContext.with(scope, "response", response ?? .null)
    func entry(_ line: ReportLine, in scope: JSONValue) -> JSONValue {
      [
        "at": .number(millis),
        "text": .string(ScreenValues.render(line.text, in: scope)),
        "confirmed": .bool(line.confirmed.map { ScreenValues.condition($0, in: scope) } ?? true),
      ]
    }
    var entries: [JSONValue] = []
    for line in log {
      if let each = line.each {
        for row in ScreenValues.rows(ScreenValues.lookup(each, in: context)) {
          let rowScope = ScreenContext.with(context, item: row)
          if ScreenValues.condition(line.when, in: rowScope) { entries.append(entry(line, in: rowScope)) }
        }
      } else if ScreenValues.condition(line.when, in: context) {
        entries.append(entry(line, in: context))
      }
    }
    return entries
  }

  func perform(_ action: ActionSpec, in scope: JSONValue) async -> ActionOutcome {
    if let write = action.write {
      guard let writer, let doc = write["doc"]?.stringValue else { return .failed("Saving is not available here.") }
      do {
        let fields = ScreenValues.resolveBody(write["fields"] ?? [:], in: scope)
        try await writer.merge(
          FirestoreLoads.segments(ScreenValues.render(doc, in: scope)), FirestoreLoads.plain(fields) as? [String: Any] ?? [:])
        return .done(message: action.success.map { ScreenValues.render($0, in: scope) }, response: nil)
      } catch {
        return .failed(error.localizedDescription)
      }
    }
    guard let urlTemplate = action.url else { return .done(message: nil, response: nil) }
    guard let api else { return .failed("Sign in to continue.") }
    var path = ScreenValues.renderURL(urlTemplate, in: scope)
    if let filters = Self.filtersParameter(action.filters, in: scope) { path += (path.contains("?") ? "&" : "?") + filters }
    let keyed = withAttempt(for: action, path: path, in: scope)
    let body = action.method == .get ? nil : action.body.map { ScreenValues.resolveBody($0, in: keyed) }
    do {
      let sentBody = body ?? (action.method == .get ? nil : [:])
      let headers = action.headers.mapValues { ScreenValues.render($0, in: keyed) }
      let response: JSONValue?
      if let loop = action.loop {
        response = try await Self.paged(loop) { cursor in
          var page = sentBody ?? [:]
          if let cursor, case .object(var record) = page {
            record[loop.param] = .string(cursor)
            page = .object(record)
          }
          return try await api.request(path, method: action.method, body: page, headers: headers)
        }
      } else {
        response = try await api.request(path, method: action.method, body: sentBody, headers: headers)
      }
      return .done(message: Self.message(for: action, response: response, in: scope), response: response)
    } catch let error as ConsoleAPIError {
      if Self.wantsReauth(error) { return .needsReauth(error.message) }
      if error.status == 404, let otherwise = action.otherwise?.action { return await perform(otherwise, in: scope) }
      return .failed(Self.refusal(for: action, error: error, in: scope))
    } catch {
      return .failed(error.localizedDescription)
    }
  }

  /// What an action says when it succeeds: `success`, then its report lines (`each` repeats a line per row).
  static func message(for action: ActionSpec, response: JSONValue?, in scope: JSONValue) -> String? {
    let context = ScreenContext.with(scope, "response", response ?? .null)
    var lines: [String] = []
    if let success = action.success { lines.append(ScreenValues.render(success, in: context)) }
    lines += reportLines(action.report, in: context)
    return lines.isEmpty ? nil : lines.joined(separator: "\n")
  }

  /// What an action says when the route refuses: the route's own words, then its `failure` lines over the answer.
  static func refusal(for action: ActionSpec, error: ConsoleAPIError, in scope: JSONValue) -> String {
    let context = ScreenContext.with(scope, "response", error.body ?? .null)
    return ([error.message] + reportLines(action.failure, in: context)).joined(separator: "\n")
  }

  static func reportLines(_ report: [ReportLine], in context: JSONValue) -> [String] {
    var lines: [String] = []
    for line in report {
      if let each = line.each {
        // A `when` on a repeated line is read for each row, with `item` its row (the give-back's meters that moved nothing).
        for row in ScreenValues.rows(ScreenValues.lookup(each, in: context)) {
          let scope = ScreenContext.with(context, item: row)
          if ScreenValues.condition(line.when, in: scope) { lines.append(ScreenValues.render(line.text, in: scope)) }
        }
      } else if ScreenValues.condition(line.when, in: context) {
        lines.append(ScreenValues.render(line.text, in: context))
      }
    }
    return lines
  }

  /// Sends a page at a time until the route says it is done, and answers the totals: numbers add
  /// up (a map of counts too), anything else keeps the last page's value. `pages` counts the
  /// requests, and `bounded` is true when `max` pages did not reach the end.
  static func paged(_ loop: LoopSpec, send: (_ cursor: String?) async throws -> JSONValue?) async throws -> JSONValue? {
    var totals: JSONValue = .null
    var cursor: String?
    var pages = 0
    var finished = false
    while pages < loop.max {
      let page = try await send(cursor) ?? .null
      pages += 1
      totals = ScreenValues.sum(totals, page)
      cursor = ScreenValues.lookup(loop.cursor, in: page)?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
      let done = loop.until.map { ScreenValues.truthy(ScreenValues.lookup($0, in: page)) } ?? false
      if done || cursor == nil {
        finished = true
        break
      }
    }
    guard case .object(var record) = totals else { return totals }
    record["pages"] = .number(Double(pages))
    record["bounded"] = .bool(!finished)
    return .object(record)
  }

  /// `scope` with `attempt` set when the action's headers or body use `{attempt}`: the key held for this exact
  /// request, found with `{attempt}` blank so a body that carries the key does not change its own signature.
  func withAttempt(for action: ActionSpec, path: String, in scope: JSONValue) -> JSONValue {
    let bodyText = action.body.flatMap { try? $0.encoded() }.flatMap { String(data: $0, encoding: .utf8) } ?? ""
    guard !action.headers.isEmpty || bodyText.contains("{attempt") else { return scope }
    let blank = ScreenContext.with(scope, "attempt", .string(""))
    let draft = action.method == .get ? nil : action.body.map { ScreenValues.resolveBody($0, in: blank) }
    let signature = "\(action.id)|\(path)|\(String(data: (try? draft?.encoded()) ?? Data(), encoding: .utf8) ?? "")"
    let key = attempts[signature] ?? UUID().uuidString.lowercased()
    attempts[signature] = key
    return ScreenContext.with(scope, "attempt", .string(key))
  }

  /// A route's "sign in again first" answer, in any of the shapes the routes use.
  static func wantsReauth(_ error: ConsoleAPIError) -> Bool {
    let words = [error.body?["error"], error.body?["code"], error.body?["reason"]].compactMap { $0?.stringValue }
    return words.contains { ["reauth-required", "recent-login-required", "requires-recent-login"].contains($0) }
  }
}
