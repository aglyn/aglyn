// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import Foundation
import Observation
import SwiftUI

/// What a spec's `account` actions do to the signed-in person's own sign-in
/// (the console does these with the Firebase client SDK, not a route).
public struct AccountOperations: Sendable {
  /// Proves the current password, then sets the new one.
  public var changePassword: @Sendable (_ current: String, _ new: String) async throws -> Void
  /// Keeps the account's display name in step with the profile.
  public var updateDisplayName: @Sendable (_ name: String) async throws -> Void
  /// The words a refusal from either shows.
  public var message: @Sendable (_ error: Error) -> String

  public init(
    changePassword: @escaping @Sendable (String, String) async throws -> Void = { _, _ in
      throw ConsoleAPIError(status: 0, message: "Changing the password is not available here.")
    },
    updateDisplayName: @escaping @Sendable (String) async throws -> Void = { _ in },
    message: @escaping @Sendable (Error) -> String = { $0.localizedDescription }
  ) {
    self.changePassword = changePassword
    self.updateDisplayName = updateDisplayName
    self.message = message
  }
}

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
  /// Signs in as a customer with the custom token a staff route minted (`/api/admin/impersonate`), in the identity
  /// pool it was minted in; the staff session is set aside and returns when the support session ends.
  public var impersonate: @Sendable (_ token: String, _ tenantId: String?) async throws -> Void
  public var account: AccountOperations

  public init(
    email: String? = nil, displayName: String? = nil, orgName: String? = nil, orgRole: String? = nil,
    siteName: String? = nil, claims: TokenClaims = TokenClaims(), origin: String = "",
    reauthenticate: @escaping @Sendable (String) async throws -> Void = { _ in },
    refreshClaims: @escaping @Sendable () async -> Void = {},
    impersonate: @escaping @Sendable (String, String?) async throws -> Void = { _, _ in },
    account: AccountOperations = AccountOperations()
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
    self.impersonate = impersonate
    self.account = account
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
        "providers": .array(claims.signInMethods.map(JSONValue.string)),
        "emailVerified": .bool(claims.emailVerified),
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
      // The last twelve months, newest first, as a report picks them: `{ from, to, label }` with ISO instants in UTC.
      "months": .array(recentMonths(year: year, month: month)),
    ]
  }

  static let monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

  static func recentMonths(year: Int, month: Int, count: Int = 12) -> [JSONValue] {
    (0..<count).map { back in
      let total = year * 12 + (month - 1) - back
      let next = total + 1
      func iso(_ y: Int, _ m: Int) -> String { String(format: "%04d-%02d-01T00:00:00.000Z", y, m) }
      return [
        "from": .string(iso(total / 12, total % 12 + 1)),
        "to": .string(iso(next / 12, next % 12 + 1)),
        "label": .string("\(monthNames[total % 12]) \(total / 12)"),
      ]
    }
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
  /// How many rows each grown Firestore query load reads now: a list that was asked for more asks for its page size again.
  @ObservationIgnored private var queryLimits: [String: Int] = [:]
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
  @ObservationIgnored private let account: AccountOperations?

  public init(
    spec: ScreenSpec, context: JSONValue, api: ConsoleAPIClient?, reader: FirestoreReader? = nil,
    writer: FirestoreWriter? = nil, account: AccountOperations? = nil
  ) {
    self.spec = spec
    // A spec's fixed rows (`constants`) read as `const`.
    self.context = ScreenContext.with(
      spec.raw["constants"].map { ScreenContext.with(context, "const", $0) } ?? context, "session",
      Self.sessionValue(journal: [], armed: []))
    self.api = api
    self.reader = reader
    self.writer = writer
    self.account = account
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
      url += (url.contains("?") ? "&" : "?") + load.searchParam + "=" + ScreenValues.encodeComponent(words)
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
          let limits = queryLimits
          for load in wave {
            let path = url(for: load, in: scope)
            group.addTask {
              do {
                return try await Self.fetch(load, path: path, api: api, reader: reader, context: scope, limit: limits[load.key])
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
    _ load: LoadSpec, path: String, api: ConsoleAPIClient, reader: FirestoreReader?, context: JSONValue, limit: Int? = nil
  ) async throws -> (String, JSONValue, String?) {
    if let doc = load.doc {
      guard let reader else { return (load.key, .null, nil) }
      let value = try await FirestoreLoads.document(reader, ScreenValues.render(doc, in: context))
      return (load.key, value, nil)
    }
    if let id = load.orderZone {
      guard let reader else { return (load.key, .null, nil) }
      let hostID = ScreenValues.render("{site.id}", in: context)
      return (load.key, try await FirestoreLoads.orderZone(reader, hostID: hostID, orderID: ScreenValues.render(id, in: context)), nil)
    }
    if let feature = load.entitlement {
      guard let reader else { return (load.key, .null, nil) }
      return (load.key, try await FirestoreLoads.entitlement(reader, feature: feature, orgID: ScreenValues.render("{org.id}", in: context)), nil)
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
      let rows = limit ?? FirestoreLoads.queryLimit(query)
      let answer = try await FirestoreLoads.query(reader, query, in: context, limit: rows)
      // A window that came back full may have more behind it; the list offers "Load more" with this as its cursor.
      let full = query["aggregate"] == nil && ScreenValues.lookup("items", in: answer).array.count >= rows
      return (load.key, answer, full ? String(rows) : nil)
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
    // A Firestore query has no cursor to continue from here: it reads a bigger window (the load's `more`, else the page
    // size again) and replaces its rows.
    if let api, let load = spec.loads.first(where: { $0.key == key }), let query = load.query, let cursor = cursors[key],
      !loadingMore.contains(key)
    {
      loadingMore.insert(key)
      defer { loadingMore.remove(key) }
      let page = FirestoreLoads.queryLimit(query)
      queryLimits[key] = (Int(cursor) ?? page) + (load.more ?? page)
      guard let (_, grown, next) = try? await Self.fetch(
        load, path: "", api: api, reader: reader, context: context, limit: queryLimits[key])
      else { return }
      guard case .object(var record) = data else { return }
      record[key] = grown
      context = ScreenContext.with(context, "data", .object(record))
      cursors[key] = next?.isEmpty == false ? next : nil
      return
    }
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
    performed = nil
    let outcome = await perform(action, in: scope)
    switch outcome {
    case .done(_, let response):
      remember(performed ?? action, response: response, in: scope)
      if let then = (performed ?? action).then?.action {
        let next = ScreenContext.with(
          ScreenContext.with(scope, "response", response ?? .null), "previous", scope["form"] ?? .null)
        if then.asksInputs(in: next) { followUp = FollowUp(action: then, scope: next) } else { _ = await perform(then, in: next) }
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

  /// A step the person is asked to finish next: the previous step's answer is its `response`, its form its `previous`.
  public struct FollowUp {
    public let action: ActionSpec
    public let scope: JSONValue
  }

  /// Set by `run` when the action that ran has a `then` that asks for inputs (a chained prompt); the screen takes it.
  public var followUp: FollowUp?

  /// The action that actually made the request last, which may be the `else` of the one that was pressed.
  private var performed: ActionSpec?

  /// A write the person makes themselves, as the console does: `{ doc, fields }` merges a document, `{ add, fields }`
  /// adds one to a collection, `{ delete }` removes one, and `{ steps: [...] }` does several in order. Any step may
  /// carry `each: { items, filter }` to repeat for every row of a list (`item` is the row, `parent` the outer item).
  private func runWrite(_ write: JSONValue, _ scope: JSONValue, _ writer: FirestoreWriter) async throws {
    let steps = write["steps"].array
    if !steps.isEmpty {
      for step in steps { try await runWrite(step, scope, writer) }
      return
    }
    if let each = write["each"] {
      let rows = ScreenValues.rows(ScreenValues.lookup(each["items"]?.stringValue ?? "", in: scope)).filter {
        ScreenValues.condition(each["filter"]?.stringValue, in: ScreenContext.with(scope, item: $0))
      }
      for row in rows { try await writeOne(write, ScreenContext.with(scope, item: row), writer) }
      return
    }
    try await writeOne(write, scope, writer)
  }

  /// A walk-in at the front desk, as the console's reservations card books one: `{ stay: { resource, checkIn, checkOut,
  /// guestName } }` prices the stay, checks the dates against every live stay of that resource and its blocks, and only then
  /// adds the confirmed reservation. Anything it cannot book is said in words, and nothing is written.
  private func bookStay(_ stay: JSONValue, _ scope: JSONValue, _ writer: FirestoreWriter) async throws {
    func text(_ key: String) -> String {
      ScreenValues.render(stay[key]?.stringValue ?? "", in: scope).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    guard let reader else { throw ConsoleAPIError(status: 0, message: "Those dates could not be checked. Try again.") }
    let hostID = ScreenValues.render("{site.id}", in: scope)
    let resourceID = text("resource")
    guard !resourceID.isEmpty, let checkIn = Stays.day(text("checkIn")), let checkOut = Stays.day(text("checkOut")) else {
      throw ConsoleAPIError(status: 0, message: "Choose a resource and both dates.")
    }
    let stored = try await FirestoreLoads.rawDocument(reader, "hosts/\(hostID)/resources/\(resourceID)")
    guard let resource = Stays.resource(stored?.data) else { throw ConsoleAPIError(status: 0, message: "That resource is gone.") }
    let quote = Stays.quote(resource, checkIn: checkIn, checkOut: checkOut)
    if let problem = quote.problem { throw ConsoleAPIError(status: 0, message: problem) }
    // The same query the booking door checks against: every stay of this resource that ends after the walk-in arrives.
    let query = FirestoreQuery(
      ["hosts", hostID, "reservations"], equals: [("resourceId", resourceID)],
      filters: [ListQueryConstraint(path: "checkOutDayMs", op: .greaterThan, value: Double(checkIn))],
      order: [.init("checkOutDayMs")], limit: 500)
    let overlapping: [FirestoreDocument]
    do { overlapping = try await FirestoreLoads.documents(reader, query) } catch {
      throw ConsoleAPIError(status: 0, message: "Could not check those dates. Try again.")
    }
    let now = Int64((Date().timeIntervalSince1970 * 1000).rounded())
    guard Stays.isRangeAvailable(resource, booked: overlapping.compactMap { Stays.booked($0.data) }, checkIn: checkIn, checkOut: checkOut, now: now) else {
      throw ConsoleAPIError(status: 0, message: "Those dates are taken")
    }
    let guest = text("guestName")
    try await writer.merge(
      ["hosts", hostID, "reservations", newResourceID()],
      [
        "resourceId": resourceID, "status": "confirmed", "checkInDayMs": Double(checkIn), "checkOutDayMs": Double(checkOut),
        "guestName": guest.isEmpty ? NSNull() : guest, "guestEmail": NSNull(), "nights": quote.nights,
        "totalCents": Double(quote.totalCents), "depositCents": 0, "paidCents": 0, "createdAtMs": Double(now),
      ])
  }

  private func writeOne(_ write: JSONValue, _ scope: JSONValue, _ writer: FirestoreWriter) async throws {
    if let stay = write["stay"] {
      try await bookStay(stay, scope, writer)
      return
    }
    if let path = write["delete"]?.stringValue {
      try await writer.delete(FirestoreLoads.segments(ScreenValues.render(path, in: scope)))
      return
    }
    let fields = ScreenValues.resolveBody(write["fields"] ?? [:], in: scope)
    let data = FirestoreLoads.plain(fields) as? [String: Any] ?? [:]
    if let collection = write["add"]?.stringValue {
      let path = FirestoreLoads.segments(ScreenValues.render(collection, in: scope)) + [newResourceID()]
      try await writer.merge(path, data)
      return
    }
    if let doc = write["doc"]?.stringValue {
      try await writer.merge(FirestoreLoads.segments(ScreenValues.render(doc, in: scope)), data)
    }
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

  /// The records a `lookup` field's group finds for the words typed.
  public func lookup(_ group: LookupGroup, words: String) async throws -> [JSONValue] {
    guard let api else { return [] }
    return group.rows(in: try await api.request(group.request(words: words)))
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
    if let operation = action.account {
      guard let account else { return .failed("That is not available here.") }
      do {
        let form = ScreenValues.resolveBody(action.body ?? [:], in: scope)
        switch operation {
        case "changePassword":
          let current = ScreenValues.text(form["current"]), new = ScreenValues.text(form["new"])
          guard !current.isEmpty else { return .failed("Enter your current password.") }
          guard new == ScreenValues.text(form["confirm"]) else { return .failed("The two new passwords do not match.") }
          guard new.count >= 12 else { return .failed("Use at least 12 characters.") }
          try await account.changePassword(current, new)
        case "updateDisplayName":
          // A blank name is not written over the one the account has.
          let name = ScreenValues.text(form["name"]).trimmingCharacters(in: .whitespaces)
          if !name.isEmpty { try await account.updateDisplayName(name) }
        default:
          return .failed("That is not available here.")
        }
        return .done(message: action.success.map { ScreenValues.render($0, in: scope) }, response: nil)
      } catch {
        return .failed(account.message(error))
      }
    }
    if let write = action.write {
      guard let writer else { return .failed("Saving is not available here.") }
      guard write["doc"] != nil || write["add"] != nil || write["delete"] != nil || write["stay"] != nil || !write["steps"].array.isEmpty else {
        return .failed("Saving is not available here.")
      }
      do {
        try await runWrite(write, scope, writer)
        // `siteWide`: the write changes every page of the site, so its cached pages are dropped as the console does.
        if write["siteWide"] == .bool(true), let api {
          await publishSiteWide(api: api, writer: writer, hostID: ScreenValues.render("{site.id}", in: scope))
        }
        return .done(message: action.success.map { ScreenValues.render($0, in: scope) }, response: nil)
      } catch {
        return .failed(error.localizedDescription)
      }
    }
    guard let urlTemplate = action.url else { return .done(message: nil, response: nil) }
    guard let api else { return .failed("Sign in to continue.") }
    var scope = scope
    if let doc = action.overlay {
      let stored = reader == nil ? nil : (try? await FirestoreLoads.rawDocument(reader!, ScreenValues.render(doc, in: scope))) ?? nil
      guard let stored, let overlay = FirestoreLoads.stored(stored.data) else { return .failed("That could not be read. Try again.") }
      scope = ScreenContext.with(scope, "overlay", overlay)
    }
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
      performed = action
      return .done(message: Self.message(for: action, response: response, in: scope), response: response)
    } catch let error as ConsoleAPIError {
      if Self.wantsReauth(error) { return .needsReauth(error.message) }
      if error.status == action.elseStatus, let otherwise = action.otherwise?.action { return await perform(otherwise, in: scope) }
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
    guard !action.headers.isEmpty || bodyText.contains("{attempt") || bodyText.contains("{press") else { return scope }
    let blank = ScreenContext.with(ScreenContext.with(scope, "attempt", .string("")), "press", .string(""))
    let draft = action.method == .get ? nil : action.body.map { ScreenValues.resolveBody($0, in: blank) }
    let signature = "\(action.id)|\(path)|\(String(data: (try? draft?.encoded()) ?? Data(), encoding: .utf8) ?? "")"
    let key = attempts[signature] ?? UUID().uuidString.lowercased()
    attempts[signature] = key
    // `{press}`: a key for this one press alone (its own retries share it); a second tap of the same request gets a new one.
    return ScreenContext.with(ScreenContext.with(scope, "attempt", .string(key)), "press", .string(UUID().uuidString.lowercased()))
  }

  /// A route's "sign in again first" answer, in any of the shapes the routes use.
  static func wantsReauth(_ error: ConsoleAPIError) -> Bool {
    let words = [error.body?["error"], error.body?["code"], error.body?["reason"]].compactMap { $0?.stringValue }
    return words.contains { ["reauth-required", "recent-login-required", "requires-recent-login"].contains($0) }
  }
}

/// The console's `writeSiteWideChange` after a write: a `publishOutbox` entry so the drain re-renders the site if
/// this run cannot, a revalidate request to do it now, and the entry retired when that worked. Like the console, a
/// refused entry is not an error: the revalidate still runs.
func publishSiteWide(api: ConsoleAPIClient, writer: FirestoreWriter, hostID: String) async {
  let path = ["publishOutbox", newResourceID()]
  var staged = false
  do {
    try await writer.merge(
      path, ["hostId": hostID, "paths": ["/"], "createdAt": FirestoreSentinel.serverTimestamp, "attempts": 0, "entireHost": true])
    staged = true
  } catch {}
  let answer = try? await api.request(
    "/api/screens/revalidate", method: .post, body: ["hostId": .string(hostID), "entireHost": .bool(true)])
  if staged, answer?["reason"]?.stringValue == "ok" { try? await writer.delete(path) }
}
