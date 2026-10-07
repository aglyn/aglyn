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
    return [
      "month": .string(String(format: "%04d-%02d", year, month)),
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
  @ObservationIgnored private let api: ConsoleAPIClient?
  @ObservationIgnored private let reader: FirestoreReader?

  public init(spec: ScreenSpec, context: JSONValue, api: ConsoleAPIClient?, reader: FirestoreReader? = nil) {
    self.spec = spec
    // A spec's fixed rows (`constants`) read as `const`.
    self.context = spec.raw["constants"].map { ScreenContext.with(context, "const", $0) } ?? context
    self.api = api
    self.reader = reader
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
      url += (url.contains("?") ? "&" : "?") + "search=" + ScreenValues.encodeComponent(words)
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
        for load in loads {
          let path = url(for: load)
          group.addTask {
            do {
              return try await Self.fetch(load, path: path, api: api, reader: reader, context: context)
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
    _ load: LoadSpec, path: String, api: ConsoleAPIClient, reader: FirestoreReader?, context: JSONValue
  ) async throws -> (String, JSONValue, String?) {
    if let doc = load.doc {
      guard let reader else { return (load.key, .null, nil) }
      let value = try await FirestoreLoads.document(reader, ScreenValues.render(doc, in: context))
      return (load.key, value, nil)
    }
    if let query = load.query {
      guard let reader else { return (load.key, .null, nil) }
      return (load.key, try await FirestoreLoads.query(reader, query, in: context), nil)
    }
    let body = load.body.map { ScreenValues.resolveBody($0, in: context) }
    let value = try await api.request(path, method: load.method, body: body) ?? .null
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
    let outcome = await perform(action, in: scope)
    if case .done(_, let response) = outcome, let then = action.then?.action {
      _ = await perform(then, in: ScreenContext.with(scope, "response", response ?? .null))
    }
    return outcome
  }

  func perform(_ action: ActionSpec, in scope: JSONValue) async -> ActionOutcome {
    if let write = action.write {
      guard let reader, let doc = write["doc"]?.stringValue else { return .failed("Saving is not available here.") }
      do {
        let fields = ScreenValues.resolveBody(write["fields"] ?? [:], in: scope)
        try await reader.setDocument(
          FirestoreLoads.segments(ScreenValues.render(doc, in: scope)), FirestoreLoads.plain(fields) as? [String: Any] ?? [:],
          merge: true)
        return .done(message: action.success.map { ScreenValues.render($0, in: scope) }, response: nil)
      } catch {
        return .failed(error.localizedDescription)
      }
    }
    guard let urlTemplate = action.url else { return .done(message: nil, response: nil) }
    guard let api else { return .failed("Sign in to continue.") }
    let path = ScreenValues.renderURL(urlTemplate, in: scope)
    let body = action.method == .get ? nil : action.body.map { ScreenValues.resolveBody($0, in: scope) }
    do {
      let response = try await api.request(path, method: action.method, body: body ?? (action.method == .get ? nil : [:]))
      let message = action.success.map { ScreenValues.render($0, in: ScreenContext.with(scope, "response", response ?? .null)) }
      return .done(message: message, response: response)
    } catch let error as ConsoleAPIError {
      if Self.wantsReauth(error) { return .needsReauth(error.message) }
      if error.status == 404, let otherwise = action.otherwise?.action { return await perform(otherwise, in: scope) }
      return .failed(error.message)
    } catch {
      return .failed(error.localizedDescription)
    }
  }

  /// A route's "sign in again first" answer, in any of the shapes the routes use.
  static func wantsReauth(_ error: ConsoleAPIError) -> Bool {
    let words = [error.body?["error"], error.body?["code"], error.body?["reason"]].compactMap { $0?.stringValue }
    return words.contains { ["reauth-required", "recent-login-required", "requires-recent-login"].contains($0) }
  }
}
