// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import Observation

/*
 * EDITING A SITE'S REDIRECTS, AS THE REDIRECTS PAGE DOES.
 *
 * The save checks run on the server (`redirects/check`: the page's own
 * validation, the phishing screen, a path to itself, a duplicate and a loop),
 * so the app never carries a copy of them. A new rule goes through
 * `/api/hosts/resources`, which counts it against the plan and stamps an
 * outside destination's approval; an edit, a switch and a delete are the
 * Firestore writes the page makes, which the rules hold to a publishing role.
 * Every change is announced to the site's cache, as the page announces it.
 * The Kotlin kit's `RedirectsEditing.kt` is the same contract.
 */

let redirectCheckRoute = "/api/redirects/check"
let hostResourcesRoute = "/api/hosts/resources"
let revalidateRoute = "/api/screens/revalidate"

/// The page's status codes, in its order, with what each means to a person.
let redirectStatusChoices: [(code: Int, label: String)] = [
  (301, "301 Permanent"), (302, "302 Temporary"), (307, "307 Temporary, same method"),
  (308, "308 Permanent, same method"),
]

/// The page's match modes.
let redirectKindChoices: [(kind: String, label: String)] = [
  ("exact", "Exact path"), ("prefix", "Path and below"), ("regex", "Pattern"),
]

/// What the editor asks to save.
struct RedirectDraft: Equatable {
  var id: String?
  var kind = "exact"
  var source = ""
  var destination = ""
  var statusCode = 302
  var priority = ""
  var enabled = true

  init() {}

  init(_ row: RedirectRow) {
    id = row.id
    kind = row.rule.kind.map { $0 == .unknown ? "exact" : $0.rawValue } ?? "exact"
    source = row.source
    destination = row.destination
    statusCode = row.statusCode
    priority = row.rule.priority.map { String(Int($0)) } ?? ""
    enabled = row.isOn
  }
}

/// The server's answer: the page's refusal, or the rule as the page stores it.
enum RedirectCheck: Equatable {
  case refused(String)
  case ready(source: String, destination: String, statusCode: Int, kind: String, notice: String?)
}

/// Whether a destination leaves the platform: anything that is not a site path (`/…`, not `//…`).
func isExternalRedirectDestination(_ destination: String) -> Bool {
  let value = destination.trimmingCharacters(in: .whitespacesAndNewlines)
  return !(value.hasPrefix("/") && !value.hasPrefix("//"))
}

/// The page's default when a rule names no priority.
func redirectPriority(_ text: String) -> Int {
  Int(text.trimmingCharacters(in: .whitespacesAndNewlines)) ?? Int(HostRedirects.defaultPriority)
}

/// The fields a save writes, as the page builds them: the checked source,
/// destination, status code and mode, the priority and whether it is on. An
/// edit also stamps an outside destination's approval, or clears it.
func redirectSaveFields(_ draft: RedirectDraft, checked: RedirectCheck, uid: String) -> [String: Any] {
  guard case .ready(let source, let destination, let statusCode, let kind, _) = checked else { return [:] }
  var fields: [String: Any] = [
    "source": source, "destination": destination, "statusCode": statusCode, "kind": kind,
    "priority": redirectPriority(draft.priority), "enabled": draft.enabled,
  ]
  if draft.id != nil {
    fields["externalDestinationApprovedBy"] =
      isExternalRedirectDestination(destination) ? uid : FirestoreSentinel.delete
  }
  return fields
}

/// A rule's writes, behind a seam so the editor is tested without a server.
protocol RedirectsWriteAPI: Sendable {
  func check(_ draft: RedirectDraft) async throws -> RedirectCheck
  func create(_ fields: [String: Any]) async throws
  func update(_ id: String, _ fields: [String: Any]) async throws
  func setEnabled(_ id: String, _ enabled: Bool) async throws
  func delete(_ id: String) async throws
  func announce(_ source: String?) async
}

struct ConsoleRedirectsWriteAPI: RedirectsWriteAPI {
  let api: ConsoleAPIClient
  let writer: FirestoreWriter
  let hostID: String

  private func path(_ id: String) -> [String] { ["hosts", hostID, "redirects", id] }

  func check(_ draft: RedirectDraft) async throws -> RedirectCheck {
    var body: [String: JSONValue] = [
      "hostId": .string(hostID), "kind": .string(draft.kind), "source": .string(draft.source),
      "destination": .string(draft.destination), "statusCode": .number(Double(draft.statusCode)),
    ]
    if let id = draft.id { body["id"] = .string(id) }
    guard case .object(let answer)? = try await api.request(redirectCheckRoute, method: .post, body: .object(body))
    else { throw ConsoleAPIError(status: 0, message: "The redirect could not be checked.") }
    guard answer["ok"] == .bool(true) else {
      return .refused(answer["problem"]?.stringValue ?? "That redirect can't be saved.")
    }
    var code = 302
    if case .number(let value)? = answer["statusCode"] { code = Int(value) }
    return .ready(
      source: answer["source"]?.stringValue ?? "", destination: answer["destination"]?.stringValue ?? "",
      statusCode: code, kind: answer["kind"]?.stringValue ?? draft.kind, notice: answer["notice"]?.stringValue)
  }

  func create(_ fields: [String: Any]) async throws {
    let data = fields.compactMapValues { value -> JSONValue? in
      switch value {
      case let flag as Bool: .bool(flag)
      case let number as Int: .number(Double(number))
      case let text as String: .string(text)
      default: nil
      }
    }
    _ = try await api.request(
      hostResourcesRoute, method: .post,
      body: .object(["hostId": .string(hostID), "resource": "redirect", "data": .object(data)]))
  }

  func update(_ id: String, _ fields: [String: Any]) async throws {
    var fields = fields
    fields["updatedAt"] = Date()
    try await writer.merge(path(id), fields)
  }

  func setEnabled(_ id: String, _ enabled: Bool) async throws {
    try await writer.merge(path(id), ["enabled": enabled, "updatedAt": Date()])
  }

  func delete(_ id: String) async throws {
    try await writer.merge(path(id), ["deletedAt": Date(), "enabled": false])
  }

  func announce(_ source: String?) async {
    let redirectPath = source.flatMap { $0.hasPrefix("/") ? $0 : nil } ?? "/"
    _ = try? await api.request(
      revalidateRoute, method: .post, body: .object(["hostId": .string(hostID), "redirectPath": .string(redirectPath)]))
  }
}

/// The editor sheet's and the row actions' state, for one site.
@MainActor
@Observable
final class RedirectsEditor {
  var draft: RedirectDraft?
  var deleting: RedirectRow?
  private(set) var busy = false
  private(set) var error: String?
  /// What just happened, or a warning that did not stop the save.
  var notice: String?

  @ObservationIgnored private let api: RedirectsWriteAPI
  @ObservationIgnored private let uid: String

  init(api: RedirectsWriteAPI, uid: String) {
    self.api = api
    self.uid = uid
  }

  func add() { open(RedirectDraft()) }
  func edit(_ row: RedirectRow) { open(RedirectDraft(row)) }

  func askDelete(_ row: RedirectRow) {
    error = nil
    deleting = row
  }

  func close() {
    guard !busy else { return }
    draft = nil
    deleting = nil
    error = nil
  }

  private func open(_ next: RedirectDraft) {
    error = nil
    draft = next
  }

  func save() async {
    guard let asked = draft else { return }
    await run {
      let checked = try await self.api.check(asked)
      switch checked {
      case .refused(let problem): self.error = problem
      case .ready(let source, _, _, _, let notice):
        let fields = redirectSaveFields(asked, checked: checked, uid: self.uid)
        if let id = asked.id { try await self.api.update(id, fields) } else { try await self.api.create(fields) }
        await self.api.announce(source)
        if asked.id != nil, asked.source != source { await self.api.announce(asked.source) }
        self.draft = nil
        self.notice = notice ?? "Redirect saved. It is live within about 30 seconds."
      }
    }
  }

  func toggle(_ row: RedirectRow, _ enabled: Bool) async {
    await run {
      try await self.api.setEnabled(row.id, enabled)
      await self.api.announce(row.source)
    }
  }

  func confirmDelete() async {
    guard let row = deleting else { return }
    await run {
      try await self.api.delete(row.id)
      await self.api.announce(row.source)
      self.deleting = nil
      self.notice = "\(row.source) no longer redirects."
    }
  }

  private func run(_ block: @escaping @MainActor () async throws -> Void) async {
    guard !busy else { return }
    busy = true
    error = nil
    defer { busy = false }
    do {
      try await block()
    } catch let failure as ConsoleAPIError where failure.status != 0 {
      error = failure.message
    } catch {
      let text = error.localizedDescription.lowercased()
      self.error =
        text.contains("permission")
        ? "Changing a redirect needs a publishing role. Ask an editor or admin."
        : "That did not go through. Check the connection and try again."
    }
  }
}
