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
  public var account: AccountOperations

  public init(
    email: String? = nil, displayName: String? = nil, orgName: String? = nil, orgRole: String? = nil,
    siteName: String? = nil, claims: TokenClaims = TokenClaims(), origin: String = "",
    reauthenticate: @escaping @Sendable (String) async throws -> Void = { _ in },
    refreshClaims: @escaping @Sendable () async -> Void = {},
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
    return [
      "month": .string(String(format: "%04d-%02d", year, month)),
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
    self.context = spec.raw["constants"].map { ScreenContext.with(context, "const", $0) } ?? context
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

  func url(for load: LoadSpec, cursor: String? = nil) -> String {
    var url = ScreenValues.renderURL(load.url, in: context)
    if let words = search[load.key], !words.trimmingCharacters(in: .whitespaces).isEmpty {
      url += (url.contains("?") ? "&" : "?") + load.searchParam + "=" + ScreenValues.encodeComponent(words)
    }
    if let cursor {
      url += (url.contains("?") ? "&" : "?") + load.cursorParam + "=" + ScreenValues.encodeComponent(cursor)
    }
    return url
  }

  /// Every load the screen's conditions allow, in parallel. A failed load
  /// fails the screen with the route's own words.
  public func load() async {
    if case .object(let record) = data, record.isEmpty { phase = .loading }
    guard let api else {
      phase = .failed("Sign in to continue.")
      return
    }
    let loads = spec.loads.filter { ScreenValues.condition($0.when, in: context) }
    var results: [String: JSONValue] = [:]
    var nextCursors: [String: String] = [:]
    do {
      try await withThrowingTaskGroup(of: (String, JSONValue, String?).self) { group in
        let reader = reader
        let context = context
        let limits = queryLimits
        for load in loads {
          let path = url(for: load)
          group.addTask {
            do {
              return try await Self.fetch(load, path: path, api: api, reader: reader, context: context, limit: limits[load.key])
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
    } catch is CancellationError {
      return
    } catch {
      phase = .failed((error as? ConsoleAPIError)?.message ?? error.localizedDescription)
      return
    }
    context = ScreenContext.with(context, "data", .object(results))
    cursors = nextCursors
    phase = .ready
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
    let value = try await api.request(path, method: load.method, body: body) ?? .null
    let cursor = load.cursor.flatMap { ScreenValues.lookup($0, in: value)?.stringValue }
    return (load.key, value, cursor)
  }

  /// The next page of a paged load, appended to its rows.
  public func loadMore(_ key: String) async {
    // A Firestore query has no cursor to continue from here: it reads a bigger window (the page size again) and replaces its rows.
    if let api, let load = spec.loads.first(where: { $0.key == key }), let query = load.query, let cursor = cursors[key],
      !loadingMore.contains(key)
    {
      loadingMore.insert(key)
      defer { loadingMore.remove(key) }
      let step = FirestoreLoads.queryLimit(query)
      queryLimits[key] = (Int(cursor) ?? step) + step
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
    } catch {}
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
    if case .done(_, let response) = outcome, let then = (performed ?? action).then?.action {
      let next = ScreenContext.with(
        ScreenContext.with(scope, "response", response ?? .null), "previous", scope["form"] ?? .null)
      if then.asksInputs { followUp = FollowUp(action: then, scope: next) } else { _ = await perform(then, in: next) }
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
    let path = ScreenValues.renderURL(urlTemplate, in: scope)
    let body = action.method == .get ? nil : action.body.map { ScreenValues.resolveBody($0, in: scope) }
    do {
      let sentBody = body ?? (action.method == .get ? nil : [:])
      let headers = headers(for: action, path: path, body: sentBody, in: scope)
      let response = try await api.request(path, method: action.method, body: sentBody, headers: headers)
      let message = action.success.map { ScreenValues.render($0, in: ScreenContext.with(scope, "response", response ?? .null)) }
      performed = action
      return .done(message: message, response: response)
    } catch let error as ConsoleAPIError {
      if Self.wantsReauth(error) { return .needsReauth(error.message) }
      if error.status == action.elseStatus, let otherwise = action.otherwise?.action { return await perform(otherwise, in: scope) }
      return .failed(error.message)
    } catch {
      return .failed(error.localizedDescription)
    }
  }

  /// The action's request headers, rendered; `{attempt}` is the key held for this exact request.
  func headers(for action: ActionSpec, path: String, body: JSONValue?, in scope: JSONValue) -> [String: String] {
    guard !action.headers.isEmpty else { return [:] }
    let signature = "\(action.id)|\(path)|\(String(data: (try? body?.encoded()) ?? Data(), encoding: .utf8) ?? "")"
    let key = attempts[signature] ?? UUID().uuidString.lowercased()
    attempts[signature] = key
    // `{press}`: a key for this one press alone (its own retries share it); a second tap of the same request gets a new one.
    let withAttempt = ScreenContext.with(ScreenContext.with(scope, "attempt", .string(key)), "press", .string(UUID().uuidString.lowercased()))
    return action.headers.mapValues { ScreenValues.render($0, in: withAttempt) }
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
