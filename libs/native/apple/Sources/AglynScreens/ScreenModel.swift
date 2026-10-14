// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
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
  /// Disconnects a sign-in provider (`google.com`) from the account.
  public var unlinkProvider: @Sendable (_ providerID: String) async throws -> Void
  /// Connects Google: opens the platform's auth sheet through `authenticate` (the URL to open and the
  /// scheme it returns to), and links the credential it earns to the account.
  public var linkGoogle: @Sendable (_ authenticate: @escaping @Sendable (URL, String) async throws -> URL) async throws -> Void
  /// The words a refusal from either shows.
  public var message: @Sendable (_ error: Error) -> String

  public init(
    changePassword: @escaping @Sendable (String, String) async throws -> Void = { _, _ in
      throw ConsoleAPIError(status: 0, message: "Changing the password is not available here.")
    },
    updateDisplayName: @escaping @Sendable (String) async throws -> Void = { _ in },
    unlinkProvider: @escaping @Sendable (String) async throws -> Void = { _ in
      throw ConsoleAPIError(status: 0, message: "Disconnecting a sign-in method is not available here.")
    },
    linkGoogle: @escaping @Sendable (@escaping @Sendable (URL, String) async throws -> URL) async throws -> Void = { _ in
      throw ConsoleAPIError(status: 0, message: "Connecting Google is not set up in this build.")
    },
    message: @escaping @Sendable (Error) -> String = { $0.localizedDescription }
  ) {
    self.changePassword = changePassword
    self.updateDisplayName = updateDisplayName
    self.unlinkProvider = unlinkProvider
    self.linkGoogle = linkGoogle
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
  /// Whether this build can connect Google (its OAuth client is configured).
  public var googleConfigured: Bool
  /// The relying party passkeys are made for (`aglyn.com`): set where this build can make a passkey (it is
  /// configured, linked to that domain, and the device can); nil hides the action.
  public var passkeyRelyingParty: String?

  public init(
    email: String? = nil, displayName: String? = nil, orgName: String? = nil, orgRole: String? = nil,
    siteName: String? = nil, claims: TokenClaims = TokenClaims(), origin: String = "",
    reauthenticate: @escaping @Sendable (String) async throws -> Void = { _ in },
    refreshClaims: @escaping @Sendable () async -> Void = {},
    account: AccountOperations = AccountOperations(), googleConfigured: Bool = false,
    passkeyRelyingParty: String? = nil
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
    self.googleConfigured = googleConfigured
    self.passkeyRelyingParty = passkeyRelyingParty
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
        // Google can be connected where this build has its client, the account is not on a company
        // login (a tenant), and Google is not connected already.
        "canLinkGoogle": .bool(
          googleConfigured && claims.values["firebase"]?["tenant"] == nil && !claims.signInMethods.contains("google.com")),
        // A passkey can be set up where this build can make one, the account is not on a company login
        // (the routes refuse a tenant) and its email is verified (they refuse that too).
        "canAddPasskey": .bool(
          passkeyRelyingParty != nil && claims.values["firebase"]?["tenant"] == nil && claims.emailVerified),
        "emailVerified": .bool(claims.emailVerified),
      ],
      "staff": [
        "is": .bool(claims.isStaff),
        "role": claims.staffRole.map(JSONValue.string) ?? .null,
        "super": .bool(claims.isSuper),
      ],
      "app": ["origin": .string(origin), "passkeyRp": passkeyRelyingParty.map(JSONValue.string) ?? .null],
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
  /// Set on a screen opened by another's `gate`: told when the person finished what the gate asked for.
  @Entry var aglynGateResolve: (() -> Void)?
}

/// What running an action came to.
/// Values an action keeps for later screens (`stash`): a chosen file, the plan read from it, the
/// choices made on the way. In memory only, until the app closes.
@MainActor
public enum ScreenStash {
  public private(set) static var values: [String: JSONValue] = [:]

  public static func set(_ updates: JSONValue) {
    guard case .object(let record) = updates else { return }
    for (key, value) in record {
      if value == .null { values[key] = nil } else { values[key] = value }
    }
  }

  public static func clear() { values = [:] }
}

public enum ActionOutcome: Equatable {
  case done(message: String?, response: JSONValue?)
  /// A route answered with a file to save or share.
  case file(DownloadedFile, name: String, message: String?)
  /// The route wants a recent sign-in (`reauth-required`) before it acts.
  case needsReauth(String)
  /// The route refused for something another screen settles (`gate`): that screen, and the route's words.
  case gated(screen: String, message: String)
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
  /// The `{attempt}` key of each action's last request, by action, path and body: a retry of the
  /// same request reuses it, and a different request gets its own.
  @ObservationIgnored private var attempts: [String: String] = [:]
  @ObservationIgnored private let api: ConsoleAPIClient?
  @ObservationIgnored private let reader: FirestoreReader?
  @ObservationIgnored private let writer: FirestoreWriter?
  @ObservationIgnored private let account: AccountOperations?
  /// Opens a URL in the platform's auth sheet and returns where it came back to; the screen sets it.
  @ObservationIgnored public var authenticate: (@Sendable (URL, String) async throws -> URL)?
  /// Makes a passkey through the platform; the screen sets it (nil where the device cannot).
  @ObservationIgnored public var createPasskey: PasskeyCreator?

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
    applyDerived()
    phase = .ready
  }

  /// The screen's `derive` list (`[{ name, when }]`, in order) as `is.<name>`: conditions worked out once over
  /// the loaded data, so a block can say `is.billed` where the condition itself would need brackets. A later
  /// entry may read an earlier one.
  private func applyDerived() {
    let entries = spec.raw["derive"].array
    guard !entries.isEmpty else { return }
    var flags: [String: JSONValue] = [:]
    for entry in entries {
      guard let name = entry["name"]?.stringValue else { continue }
      let seen = ScreenContext.with(context, "is", .object(flags))
      flags[name] = .bool(ScreenValues.condition(entry["when"]?.stringValue, in: seen))
    }
    context = ScreenContext.with(context, "is", .object(flags))
  }

  public var data: JSONValue { context["data"] ?? [:] }

  func url(for load: LoadSpec, cursor: String? = nil, in scope: JSONValue? = nil) -> String {
    var url = ScreenValues.renderURL(load.url, in: scope ?? context)
    if let words = search[load.key], !words.trimmingCharacters(in: .whitespaces).isEmpty {
      url += (url.contains("?") ? "&" : "?") + "search=" + ScreenValues.encodeComponent(words)
    }
    // A GET route pages through the query string; a POST route reads it from the body (`pageBody`).
    if let cursor, load.method == .get {
      url += (url.contains("?") ? "&" : "?") + load.cursorParam + "=" + ScreenValues.encodeComponent(cursor)
    }
    return url
  }

  /// The most rows a per-row load (`each`) runs for.
  static let eachCeiling = 50

  /// Every load the screen's conditions allow, in parallel; the per-row ones (`each`) follow once
  /// the rows they walk have arrived. A failed load fails the screen with the route's own words.
  public func load() async {
    if case .object(let record) = data, record.isEmpty { phase = .loading }
    guard let api else {
      phase = .failed("Sign in to continue.")
      return
    }
    context = ScreenContext.with(context, "stash", .object(ScreenStash.values))
    context = ScreenContext.with(context, "now", ScreenValues.nowObject())
    let loads = spec.loads.filter { ScreenValues.condition($0.when, in: context) }
    var results: [String: JSONValue] = [:]
    var nextCursors: [String: String] = [:]
    do {
      try await withThrowingTaskGroup(of: (String, JSONValue, String?).self) { group in
        let reader = reader
        let context = context
        for load in loads where load.each == nil && load.compute == nil {
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
      let walking = loads.filter { $0.each != nil }
      if !walking.isEmpty {
        let seen = ScreenContext.with(context, "data", .object(results))
        for load in walking {
          let rows = Array(ScreenValues.lookup(load.each ?? "", in: seen).array.prefix(Self.eachCeiling))
          var answers: [JSONValue] = Array(repeating: .null, count: rows.count)
          try await withThrowingTaskGroup(of: (Int, JSONValue).self) { group in
            let reader = reader
            for (index, row) in rows.enumerated() {
              let scope = ScreenContext.with(seen, item: row)
              let path = url(for: load, in: scope)
              group.addTask {
                do {
                  return (index, try await Self.fetch(load, path: path, api: api, reader: reader, context: scope).1)
                } catch where !(error is CancellationError) {
                  return (index, .null)
                }
              }
            }
            for try await (index, value) in group { answers[index] = value }
          }
          results[load.key] = .array(answers)
        }
      }
      // Pure functions over what has loaded (a diff of two items), in the order they are declared.
      for load in loads where load.compute != nil {
        let seen = ScreenContext.with(context, "data", .object(results))
        let args = load.args.map { Double($0).map(JSONValue.number) ?? ScreenValues.lookup($0, in: seen) }
        results[load.key] = ScreenFunctions.call(load.compute ?? "", args) ?? .null
      }
    } catch is CancellationError {
      return
    } catch {
      phase = .failed((error as? ConsoleAPIError)?.message ?? error.localizedDescription)
      return
    }
    context = ScreenContext.with(context, "data", .object(results))
    applyDerived()
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
    let value = try await api.request(path, method: load.method, body: body) ?? .null
    return (load.key, value, Self.cursor(of: load, in: value))
  }

  /// A paged route's next cursor: the text at `cursor`, or a number (a job's `createdAt`) as text.
  nonisolated static func cursor(of load: LoadSpec, in page: JSONValue) -> String? {
    guard let at = load.cursor, let found = ScreenValues.lookup(at, in: page) else { return nil }
    switch found {
    case .string(let text): return text.isEmpty ? nil : text
    case .number: return ScreenValues.text(found)
    default: return nil
    }
  }

  /// The body of a paged POST load's next page: its own body with the cursor under `cursorParam`
  /// (a number when the cursor reads as one, since the route compares it as one).
  func pageBody(_ load: LoadSpec, cursor: String) -> JSONValue? {
    guard load.method != .get else { return nil }
    var body: [String: JSONValue] = [:]
    if case .object(let record)? = load.body.map({ ScreenValues.resolveBody($0, in: context) }) { body = record }
    body[load.cursorParam] = Double(cursor).map(JSONValue.number) ?? .string(cursor)
    return .object(body)
  }

  /// Takes the session's people and workspace afresh (after the token's claims changed, such as a
  /// sign-in method disconnected), keeping what the screen has loaded.
  public func rebase(_ base: JSONValue) {
    var next = context
    for key in ["org", "site", "user", "staff"] {
      if let value = base[key] { next = ScreenContext.with(next, key, value) }
    }
    context = next
  }

  /// The next page of a paged load, appended to its rows.
  public func loadMore(_ key: String) async {
    guard let api, let load = spec.loads.first(where: { $0.key == key }), let cursor = cursors[key],
      let itemsPath = load.items, !loadingMore.contains(key)
    else { return }
    loadingMore.insert(key)
    defer { loadingMore.remove(key) }
    do {
      let page = try await api.request(url(for: load, cursor: cursor), method: load.method, body: pageBody(load, cursor: cursor)) ?? .null
      let more = ScreenValues.lookup(itemsPath, in: page).array
      guard case .object(var record) = data, var current = record[key] else { return }
      current = Self.appending(more, at: itemsPath, in: current)
      record[key] = current
      context = ScreenContext.with(context, "data", .object(record))
      cursors[key] = Self.cursor(of: load, in: page)
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
    var outcome = await perform(action, in: scope)
    // `repeat`: asked again until the answer meets `until`, the stash taking each pass so a screen shows
    // the progress; `stop` ends it as a failure with the route's own words.
    if let again = action.repeating {
      let ceiling = Int(again["max"]?.numberValue ?? 200)
      var passes = 1
      while case .done(_, let answer) = outcome, passes < ceiling {
        let after = ScreenContext.with(scope, "response", answer ?? .null)
        stashAnswer(of: action, outcome: outcome, scope: scope)
        if let stop = again["stop"]?.stringValue, ScreenValues.condition(stop, in: after) {
          return .failed(
            ScreenValues.render(
              again["stopMessage"]?.stringValue ?? "The action stopped. Run it again to carry on.", in: after))
        }
        if ScreenValues.condition(again["until"]?.stringValue ?? "response.done", in: after) { break }
        outcome = await perform(action, in: scope)
        passes += 1
      }
    }
    stashAnswer(of: action, outcome: outcome, scope: scope)
    if case .done(_, let response) = outcome, let then = action.then?.action {
      _ = await perform(then, in: ScreenContext.with(scope, "response", response ?? .null))
    }
    // A follow-up that must succeed runs with the stash just made and the answer in scope.
    if case .done(_, let response) = outcome, let follow = action.after?.action {
      let seen = ScreenContext.with(ScreenContext.with(scope, "stash", .object(ScreenStash.values)), "response", response ?? .null)
      let next = await run(follow, in: seen)
      switch next {
      case .failed, .needsReauth, .gated: return next
      default: break
      }
    }
    // Plugins that asked to be heard once the action is done (`afterZone`) run their hooks; they never fail the action.
    if case .done(_, let response) = outcome, let after = action.afterZone, let zone = after["zone"]?.stringValue {
      let seen = ScreenContext.with(ScreenContext.with(scope, "stash", .object(ScreenStash.values)), "response", response ?? .null)
      let said = await runHooks(zone: zone, in: seen)
      if let key = after["stash"]?.stringValue {
        ScreenStash.set([key: said.isEmpty ? .null : .string(said.joined(separator: " "))])
        context = ScreenContext.with(context, "stash", .object(ScreenStash.values))
      }
    }
    return outcome
  }

  /// The hook of each screen contributed to `zone` whose `requires` holds: its `load` read into `data`, then its action
  /// run over it. What each says (its success message, or why it failed) is returned; a hook that has nothing to do, or
  /// whose action's `when` does not hold once the data is read, says nothing.
  private func runHooks(zone: String, in scope: JSONValue) async -> [String] {
    var said: [String] = []
    for contributed in ScreenCatalog.shared.zone(zone) where ScreenValues.condition(contributed.requires, in: scope) {
      guard let hook = contributed.hook, ScreenValues.condition(hook["when"]?.stringValue, in: scope),
        let action = hook["action"].flatMap(ActionSpec.init),
        let reading = ScreenSpec(["id": .string("\(contributed.id).hook"), "title": .string(contributed.title), "load": hook["load"] ?? [:]])
      else { continue }
      let sub = ScreenModel(spec: reading, context: scope, api: api, reader: reader, writer: writer, account: account)
      await sub.load()
      guard ScreenValues.condition(action.when, in: sub.context) else { continue }
      switch await sub.run(action, in: sub.context) {
      case .done(let message, _): if let message, !message.isEmpty { said.append(message) }
      case .failed(let message), .gated(_, let message), .needsReauth(let message): said.append(message)
      case .file: break
      }
    }
    return said
  }

  /// Keeps what an action's `stash` asks for from its outcome.
  private func stashAnswer(of action: ActionSpec, outcome: ActionOutcome, scope: JSONValue) {
    guard let stash = action.stash else { return }
    var response: JSONValue?
    switch outcome {
    case .done(_, let answer): response = answer ?? .null
    case .file: response = .null
    default: response = nil
    }
    guard let response else { return }
    ScreenStash.set(ScreenValues.resolveBody(stash, in: ScreenContext.with(scope, "response", response)))
    context = ScreenContext.with(context, "stash", .object(ScreenStash.values))
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
        case "linkGoogle":
          guard let authenticate else { return .failed("Connecting Google is not available here.") }
          try await account.linkGoogle(authenticate)
        case "unlinkProvider":
          let provider = ScreenValues.text(form["providerId"])
          guard !provider.isEmpty else { return .failed("Choose a sign-in method.") }
          try await account.unlinkProvider(provider)
        default:
          return .failed("That is not available here.")
        }
        return .done(message: action.success.map { ScreenValues.render($0, in: scope) }, response: nil)
      } catch {
        return .failed(account.message(error))
      }
    }
    if let passkey = action.passkey { return await registerPasskey(passkey, action: action, in: scope) }
    if let profile = action.businessProfile {
      guard let writer, let doc = profile["doc"]?.stringValue else { return .failed("Saving is not available here.") }
      do {
        let edited = ScreenValues.resolveBody(profile["edited"] ?? [:], in: scope)
        let current = ScreenValues.lookup(profile["current"]?.stringValue ?? "", in: scope)
        // One rule for the owner's save, shared with the site's profile: `businessProfileOwnerWrite` (AglynContracts).
        let next = businessProfileOwnerWrite(
          current.flatMap { FirestoreLoads.plain($0) as? [String: Any] }, FirestoreLoads.plain(edited) as? [String: Any] ?? [:])
        let profileFields = ContractValues.shared.businessProfileFieldOrder
        var fields: [String: JSONValue] = [:]
        for field in profileFields { fields[field] = next[field].flatMap(jsonValue) ?? .null }
        // `sources` replaces the stored map: a field with no source loses its key.
        let written = next["sources"] as? [String: Any] ?? [:]
        var sources: [String: JSONValue] = [:]
        for field in profileFields { sources[field] = (written[field] as? String).map(JSONValue.string) ?? ["$delete": true] }
        fields["sources"] = .object(sources)
        fields["updatedAt"] = ["$serverTimestamp": true]
        fields["updatedBy"] = scope["user"]?["uid"] ?? .null
        try await writer.merge(
          FirestoreLoads.segments(ScreenValues.render(doc, in: scope)), FirestoreLoads.plain(.object(fields)) as? [String: Any] ?? [:])
        return .done(message: action.success.map { ScreenValues.render($0, in: scope) }, response: nil)
      } catch {
        return .failed(error.localizedDescription)
      }
    }
    if let write = action.write {
      guard let writer, let doc = write["doc"]?.stringValue else { return .failed("Saving is not available here.") }
      do {
        let fields = ScreenValues.resolveBody(write["fields"] ?? [:], in: scope)
        try await writer.merge(
          FirestoreLoads.segments(ScreenValues.render(doc, in: scope)), FirestoreLoads.plain(fields) as? [String: Any] ?? [:])
        if action.siteWide, let api, let reader, let hostID = scope["site"]?["id"]?.stringValue {
          await publishSiteWideChange(api: api, reader: reader, hostID: hostID)
        }
        return .done(message: action.success.map { ScreenValues.render($0, in: scope) }, response: nil)
      } catch {
        return .failed(error.localizedDescription)
      }
    }
    guard let urlTemplate = action.url else { return .done(message: nil, response: nil) }
    guard let api else { return .failed("Sign in to continue.") }
    let path = ScreenValues.renderURL(urlTemplate, in: scope)
    let body = action.method == .get ? nil : action.body.map { ScreenValues.resolveBody($0, in: scope) }
    if let at = action.downloadAt, let name = action.download {
      // The route answers with JSON; the file is the value at `at`, named from the answer.
      do {
        let answer = try await api.request(path, method: action.method, body: action.method == .get ? nil : (body ?? [:])) ?? .null
        guard let value = ScreenValues.lookup(at, in: answer), value != .null else { return .failed("The route sent no file.") }
        let named = ScreenValues.render(name, in: ScreenContext.with(scope, "response", answer))
        let file = DownloadedFile(name: named, contentType: "application/json", data: try value.encoded(pretty: true))
        return .file(file, name: named, message: action.success.map { ScreenValues.render($0, in: scope) })
      } catch let error as ConsoleAPIError {
        if Self.wantsReauth(error) { return .needsReauth(error.message) }
        return .failed(error.message)
      } catch {
        return .failed(error.localizedDescription)
      }
    }
    if let fallback = action.download {
      do {
        let file = try await api.download(path, method: action.method, body: action.method == .get ? nil : (body ?? [:]))
        let name = file.name ?? ScreenValues.render(fallback, in: scope)
        return .file(file, name: name, message: action.success.map { ScreenValues.render($0, in: scope) })
      } catch let error as ConsoleAPIError {
        if Self.wantsReauth(error) { return .needsReauth(error.message) }
        return .failed(error.message)
      } catch {
        return .failed(error.localizedDescription)
      }
    }
    do {
      let sentBody = body ?? (action.method == .get ? nil : [:])
      let headers = headers(for: action, path: path, body: sentBody, in: scope)
      let response: JSONValue?
      if let chunk = action.chunk {
        response = try await Self.sendInParts(chunk, path: path, method: action.method, body: body ?? [:], api: api)
      } else {
        response = try await api.request(path, method: action.method, body: sentBody, headers: headers)
      }
      let message = action.success.map { ScreenValues.render($0, in: ScreenContext.with(scope, "response", response ?? .null)) }
      return .done(message: message, response: response)
    } catch let error as ConsoleAPIError {
      if Self.wantsReauth(error) { return .needsReauth(error.message) }
      if error.status == 404, let otherwise = action.otherwise?.action { return await perform(otherwise, in: scope) }
      if let gate = action.gate, let screen = gate["screen"]?.stringValue,
        ScreenValues.condition(gate["when"]?.stringValue, in: ["error": error.body ?? .null])
      {
        return .gated(screen: screen, message: error.message)
      }
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
    let withAttempt = ScreenContext.with(scope, "attempt", .string(key))
    return action.headers.mapValues { ScreenValues.render($0, in: withAttempt) }
  }

  /// A file sent in parts, as the console's upload client sends it: each part's text under `field` with its
  /// `part` and `parts`, the job the first answer names sent back with the rest. The last answer must say the
  /// file is whole (`until`).
  static func sendInParts(_ chunk: JSONValue, path: String, method: HTTPMethod, body: JSONValue, api: ConsoleAPIClient) async throws
    -> JSONValue?
  {
    guard case .object(let record) = body, let field = chunk["field"]?.stringValue else {
      return try await api.request(path, method: method, body: body)
    }
    let parts = ScreenValues.splitUpload(record[field]?.stringValue ?? "", budget: Int(chunk["bytes"]?.numberValue ?? 3_000_000))
    let firstOnly = chunk["firstOnly"].arrayOfStrings
    var jobId: String?
    var last: JSONValue?
    for (at, content) in parts.enumerated() {
      var one = record
      one[field] = .string(content)
      if parts.count > 1 {
        one["part"] = .number(Double(at))
        one["parts"] = .number(Double(parts.count))
      }
      if at > 0 { for key in firstOnly { one[key] = nil } }
      if let jobId, let key = chunk["idKey"]?.stringValue { one[key] = .string(jobId) }
      last = try await api.request(path, method: method, body: .object(one))
      if let from = chunk["idFrom"]?.stringValue, let id = last.flatMap({ ScreenValues.lookup(from, in: $0) })?.stringValue {
        jobId = id
      }
    }
    if let until = chunk["until"]?.stringValue, !ScreenValues.truthy(last.flatMap { ScreenValues.lookup(until, in: $0) }) {
      throw ConsoleAPIError(status: 500, message: "The file did not finish uploading. Try again.")
    }
    return last
  }

  /// Sets up a passkey as the console's `registerPasskey` does: the options route answers a challenge, the
  /// platform makes the credential, the verify route stores it. The routes read the ceremony's `Origin`
  /// (they derive the relying party from it), so the options call sends the relying party's own origin and
  /// the verify call the origin the platform signed into the credential.
  private func registerPasskey(_ passkey: JSONValue, action: ActionSpec, in scope: JSONValue) async -> ActionOutcome {
    guard let api, let createPasskey else { return .failed("Passkeys are not available on this device.") }
    guard let optionsPath = passkey["options"]?.stringValue, let verifyPath = passkey["verify"]?.stringValue,
      let origin = passkey["origin"]?.stringValue.map({ ScreenValues.render($0, in: scope) }), !origin.isEmpty
    else { return .failed("Passkeys are not set up in this build.") }
    do {
      let started = try await api.request(
        ScreenValues.renderURL(optionsPath, in: scope), method: .post, body: [:], headers: ["Origin": origin])
      guard let challengeId = started?["challengeId"]?.stringValue, let options = started?["options"] else {
        return .failed(ScreenPasskeys.message(for: ConsoleAPIError(status: 500, message: ""), in: passkey, scope: scope))
      }
      let credential = try await createPasskey(options)
      var body: [String: JSONValue] = ["challengeId": .string(challengeId), "response": credential]
      let label = ScreenValues.text(ScreenValues.resolveBody(action.body ?? [:], in: scope)["label"]).trimmingCharacters(in: .whitespaces)
      if !label.isEmpty { body["label"] = .string(label) }
      let verified = try await api.request(
        ScreenValues.renderURL(verifyPath, in: scope), method: .post, body: .object(body),
        headers: ["Origin": ScreenPasskeys.clientDataOrigin(of: credential) ?? origin])
      let message = action.success.map { ScreenValues.render($0, in: ScreenContext.with(scope, "response", verified ?? .null)) }
      return .done(message: message, response: verified)
    } catch is PasskeyCancelled {
      // Closing the prompt is the person's answer, not a failure worth alarming them with.
      return .done(message: nil, response: nil)
    } catch let error as ConsoleAPIError {
      if Self.wantsReauth(error) { return .needsReauth(error.message) }
      return .failed(ScreenPasskeys.message(for: error, in: passkey, scope: scope))
    } catch {
      return .failed(ScreenPasskeys.message(for: error, in: passkey, scope: scope))
    }
  }

  /// A route's "sign in again first" answer, in any of the shapes the routes use.
  static func wantsReauth(_ error: ConsoleAPIError) -> Bool {
    let words = [error.body?["error"], error.body?["code"], error.body?["reason"]].compactMap { $0?.stringValue }
    return words.contains { ["reauth-required", "recent-login-required", "requires-recent-login"].contains($0) }
  }
}
