// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * A SITE'S FORMS, AS THE CONSOLE'S FORMS PAGE LISTS AND CHANGES THEM
 * (`hosts/{hostId}/forms`), the Kotlin plugin's `Forms.kt` line for line:
 * FORM_LIST_QUERY, forms in use as its base unless the status chip asks
 * otherwise, the search on the form's search tokens. A form is created and
 * duplicated through the quota-enforcing resources route, its design is the
 * Besigner's, its published version goes through the promote route, and its
 * details, CRM routing and retirement are the same document updates the
 * form's page makes.
 */

let formsPageSize = 30

/// The plugin's document segment in Besigner URLs (`FORMS_DOCUMENT_SEGMENT`).
let formsDocumentSegment = "forms"
/// The forms plugin's bundle id, which a form's root element names (`BUNDLE_ID`).
let formsBundleID = "forms"
/// The canvas root id (`CANVAS_ROOT_ELEMENT_ID`).
let formCanvasRoot = "_@_"
/// The longest form slug (`FORM_SLUG_MAX_LENGTH`).
let formSlugMaxLength = 64

func formsPath(_ hostID: String) -> [String] { ["hosts", hostID, "forms"] }

/// A declared question of a form (`FormFieldDecl`).
struct FormFieldDecl: Hashable, Identifiable {
  let name: String
  let label: String
  let type: String
  let required: Bool
  let role: String?
  let options: [String]
  var id: String { name }

  /// What the questions list says under the label.
  var summary: String {
    [
      type, role.map { "used as \($0)" }, required ? "required" : nil,
      options.isEmpty ? nil : options.joined(separator: ", "),
    ].compactMap { $0 }.joined(separator: " · ")
  }

  /// A question that can carry marketing consent.
  var canHoldConsent: Bool { ["checkbox", "radio", "select"].contains(type) }
}

private func number(_ value: Any?) -> Double? {
  guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
  return number.doubleValue
}

private func present(_ value: Any?) -> Bool { value != nil && !(value is NSNull) }

private func blankToNil(_ text: String?) -> String? {
  guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
  return text
}

/// A Firestore time: a timestamp, or epoch milliseconds.
func firestoreDate(_ value: Any?) -> Date? {
  if let date = value as? Date { return date }
  return number(value).map { Date(timeIntervalSince1970: $0 / 1000) }
}

/// One form, as the list and its detail read it.
struct FormRow: Identifiable, Hashable {
  let id: String
  let name: String
  let slug: String?
  let fields: [FormFieldDecl]
  let routesLeads: Bool
  let consentFieldName: String?
  let retired: Bool
  let versionID: String?
  let submissions: Int?
  let leads: Int?
  let views: Int?
  let lastSubmissionAt: Date?
  let updatedAt: Date?
  let campaignCount: Int

  init(_ doc: FirestoreDocument) {
    let stats = doc.data["stats"] as? [String: Any]
    func stat(_ key: String) -> Int? { number(stats?[key]).map { Int($0) } }
    id = doc.id
    name = blankToNil(doc.string("displayName")) ?? doc.id
    slug = blankToNil(doc.string("slug"))
    fields = (doc.data["fields"] as? [Any] ?? []).compactMap { entry in
      guard let field = entry as? [String: Any], let name = field["fieldName"] as? String else { return nil }
      return FormFieldDecl(
        name: name, label: blankToNil(field["label"] as? String) ?? name, type: field["fieldType"] as? String ?? "text",
        required: field["required"] as? Bool == true, role: field["role"] as? String,
        options: (field["options"] as? [Any] ?? []).map { "\($0)" })
    }
    routesLeads = (doc.data["routing"] as? [String: Any])?["lead"] as? Bool == true
    consentFieldName = blankToNil(doc.string("consentFieldName"))
    retired = doc.bool("retired") == true || present(doc.data["archivedAt"])
    versionID = blankToNil(doc.string("versionId"))
    submissions = stat("submissions")
    leads = stat("leads")
    views = stat("views")
    lastSubmissionAt = number(stats?["lastSubmissionAtMs"]).map { Date(timeIntervalSince1970: $0 / 1000) }
    updatedAt = firestoreDate(doc.data["updatedAt"])
    campaignCount = (doc.data["campaignIds"] as? [Any])?.count ?? 0
  }

  /// The list's second line.
  func summary(now: Date = Date()) -> String {
    [
      submissions.map { $0 == 1 ? "1 submission" : "\($0) submissions" } ?? "No submissions",
      lastSubmissionAt.map { "last " + relativeTime($0, now: now) },
    ].compactMap { $0 }.joined(separator: " · ")
  }

  func consentLabel(_ name: String?) -> String {
    guard let name else { return "None" }
    return fields.first { $0.name == name }?.label ?? name
  }
}

/// One saved version of a form's design.
struct FormVersionRow: Identifiable, Hashable {
  let id: String
  let name: String?
  let createdAt: Date?

  init(_ doc: FirestoreDocument) {
    id = doc.id
    name = blankToNil(doc.string("displayName"))
    createdAt = firestoreDate(doc.data["createdAt"])
  }
}

/// The chips above the list: forms in use (the console's default), retired ones, or all.
enum FormStatusFilter: String, CaseIterable, Identifiable {
  case inUse, retired, all
  var id: String { rawValue }

  var label: String {
    switch self {
    case .inUse: "In use"
    case .retired: "Retired"
    case .all: "All"
    }
  }
}

func formsRequest(_ status: FormStatusFilter, search: String) -> ListQueryRequest {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return ListQueryRequest(
    base: status == .inUse ? [ContractValues.shared.formInUse] : nil,
    clauses: status == .retired ? [ListFilterRequest(field: "status", op: "equals", value: "true")] : [],
    search: words.isEmpty ? nil : [words])
}

func formsPlan(_ status: FormStatusFilter, search: String) -> ListQueryPlan {
  planListQuery(ContractValues.shared.formListQuery, formsRequest(status, search: search))
}

/// The name keys the console's lists find a record by (`displayNameSearchFields`).
func displayNameSearchFields(_ name: String) -> [String: Any] {
  ["nameLower": nameSearchKey(name), "nameTokens": nameSearchTokens(name), "nameReversed": nameSearchReversed(name)]
}

/// The list keys a form's name and slug are found by (`formListFields`).
func formListFields(id: String, name: String, slug: String?) -> [String: Any] {
  var tokens: [String] = []
  var seen = Set<String>()
  let slugWords = (slug ?? "").replacingOccurrences(of: "-+", with: " ", options: .regularExpression)
  for token in nameSearchTokens(name) + nameSearchTokens(slugWords) + nameSearchTokens(id) where seen.insert(token).inserted {
    tokens.append(token)
  }
  var fields = displayNameSearchFields(name)
  fields["searchTokens"] = tokens
  return fields
}

/// A slug from a name (`normalizeFormSlug`).
func normalizeFormSlug(_ input: String) -> String {
  var slug = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
    .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
  slug = String(slug.prefix(formSlugMaxLength))
  while slug.hasSuffix("-") { slug.removeLast() }
  return slug
}

private let idAlphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")

/// A Firestore-style auto id, as the console mints one before a create.
func newDocumentID() -> String { String((0..<20).map { _ in idAlphabet.randomElement()! }) }

/// The Besigner page for one version of a form, under the picked site.
func formBesignerPath(formID: String, versionID: String) -> String {
  "/\(formsDocumentSegment)/\(formID)/versions/\(versionID)/besigner"
}

/// The site's forms, live: the plan's query, a page at a time plus one probe
/// row, the search debounced as it is typed.
@MainActor
@Observable
final class FormsModel {
  private(set) var rows: [FormRow] = []
  private(set) var ready = false
  private(set) var failed = false
  private(set) var hasMore = false
  private(set) var notice: String?
  var status: FormStatusFilter = .inUse { didSet { if oldValue != status { restart() } } }
  private(set) var search = ""

  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var hostID: String?
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var limit = formsPageSize
  @ObservationIgnored private var debounce: Task<Void, Never>?

  func start(_ reader: FirestoreReader, hostID: String?) {
    self.reader = reader
    self.hostID = hostID
    restart()
  }

  /// A typed search, applied once typing pauses.
  func type(_ text: String) {
    guard text != search else { return }
    debounce?.cancel()
    debounce = Task { [weak self] in
      try? await Task.sleep(nanoseconds: 300_000_000)
      guard !Task.isCancelled, let self else { return }
      self.search = text
      self.restart()
    }
  }

  func loadMore() {
    guard hasMore else { return }
    limit += formsPageSize
    listen()
  }

  func retry() { restart() }

  func stop() {
    debounce?.cancel()
    listener?.remove()
    listener = nil
  }

  private func restart() {
    limit = formsPageSize
    ready = false
    listen()
  }

  private func listen() {
    listener?.remove()
    failed = false
    guard let reader, let hostID else { return }
    let plan = formsPlan(status, search: search)
    notice = plan.refused.isEmpty ? plan.notices.first : "This search cannot run with that filter. Clear one of them."
    let window = limit
    listener = reader.listen(plan.firestoreQuery(formsPath(hostID), limit: window + 1)) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.hasMore = docs.count > window
        self.rows = docs.prefix(window).map(FormRow.init)
      case .failure:
        self.hasMore = false
        self.failed = true
      }
      self.ready = true
    }
  }
}

/// One form, live, with its saved versions.
@MainActor
@Observable
final class FormModel {
  private(set) var form: FormRow?
  private(set) var ready = false
  private(set) var missing = false
  private(set) var failed = false
  private(set) var versions: [FormVersionRow] = []
  private(set) var versionsReady = false
  private(set) var versionsFailed = false
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var versionsListener: FirestoreListening?

  func start(_ reader: FirestoreReader, hostID: String, formID: String) {
    stop()
    ready = false
    versionsReady = false
    listener = reader.listenDocument(formsPath(hostID) + [formID]) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let doc?):
        self.form = FormRow(doc)
        self.missing = false
        self.failed = false
      case .success(nil): self.missing = true
      case .failure: self.failed = true
      }
      self.ready = true
    }
    versionsListener = reader.listen(
      FirestoreQuery(formsPath(hostID) + [formID, "versions"], order: [.init("createdAt", descending: true)], limit: 20)
    ) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.versions = docs.map(FormVersionRow.init)
        self.versionsFailed = false
      case .failure: self.versionsFailed = true
      }
      self.versionsReady = true
    }
  }

  func stop() {
    listener?.remove()
    versionsListener?.remove()
    listener = nil
    versionsListener = nil
  }
}

/// A promote refused by the form's contract: what to go and fix in the Besigner.
struct FormPromoteRefused: Error, LocalizedError {
  let message: String
  let violations: [String]
  var errorDescription: String? { message }
}

/// The violations a promote refusal lists, as text.
func promoteViolations(_ body: JSONValue?) -> [String] {
  guard case .array(let entries)? = body?["violations"] else { return [] }
  return entries.compactMap { $0.stringValue ?? $0["message"]?.stringValue }
}

/// The form writes, through the same routes and document updates as the console.
struct FormsAPI {
  let api: ConsoleAPIClient
  let writer: FirestoreWriter
  let hostID: String

  private func path(_ id: String) -> [String] { formsPath(hostID) + [id] }

  /// The resources-route body that creates a form with the form element its Besigner opens on.
  func createBody(id: String, name: String) -> JSONValue {
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let slug = normalizeFormSlug(name)
    return [
      "hostId": .string(hostID), "resource": "form", "id": .string(id),
      "data": [
        "displayName": .string(name), "slug": .string(slug.isEmpty ? id : slug), "fields": [],
        "rootId": .string(formCanvasRoot),
        "nodes": .object([
          formCanvasRoot: ["$id": .string(formCanvasRoot), "componentId": "div", "nodes": ["formRoot"]],
          "formRoot": [
            "$id": "formRoot", "componentId": "form", "pluginId": .string(formsBundleID),
            "parentId": .string(formCanvasRoot), "props": ["formId": .string(id), "formName": .string(name)],
            "nodes": [],
          ],
        ]),
      ],
    ]
  }

  /// A new form; answers its id.
  func create(name: String) async throws -> String {
    let id = newDocumentID()
    try await api.request("/api/hosts/resources", method: .post, body: createBody(id: id, name: name))
    return id
  }

  func duplicate(sourceID: String, name: String) async throws -> String? {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let answer = try await api.request(
      "/api/hosts/resources", method: .post,
      body: [
        "hostId": .string(hostID), "resource": "form", "action": "duplicate", "sourceId": .string(sourceID),
        "name": trimmed.isEmpty ? .null : .string(trimmed), "attemptKey": .string(newDocumentID()),
      ])
    return answer?["id"]?.stringValue
  }

  func renameFields(_ form: FormRow, name: String) -> [String: Any] {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    var fields = formListFields(id: form.id, name: trimmed, slug: form.slug)
    fields["displayName"] = trimmed
    fields["updatedAt"] = Date()
    return fields
  }

  func rename(_ form: FormRow, name: String) async throws {
    try await writer.merge(path(form.id), renameFields(form, name: name))
  }

  func retireFields(_ retired: Bool, now: Date = Date()) -> [String: Any] {
    var archivedAt: Any = NSNull()
    if retired { archivedAt = Int64((now.timeIntervalSince1970 * 1000).rounded()) }
    return ["archivedAt": archivedAt, "retired": retired, "updatedAt": now]
  }

  /// Retires a form (kept, out of the list) or brings it back, as the list's own switch does.
  func setRetired(_ id: String, retired: Bool) async throws {
    try await writer.merge(path(id), retireFields(retired))
  }

  /// The CRM routing: the lead switch and the consent field together, then the counters recounted.
  func saveRouting(_ form: FormRow, lead: Bool, consentFieldName: String?) async throws {
    try await writer.merge(
      path(form.id),
      [
        "routing": ["lead": lead], "consentFieldName": (consentFieldName ?? "").trimmingCharacters(in: .whitespaces),
        "updatedAt": Date(),
      ])
    if lead != form.routesLeads { await recount(form.id) }
  }

  func recount(_ formID: String) async {
    _ = try? await api.request(
      "/api/forms/stats", method: .post, body: ["hostId": .string(hostID), "formIds": [.string(formID)]])
  }

  /// Makes `versionID` the form's published version, or throws what the contract refused.
  func promote(formID: String, versionID: String) async throws {
    do {
      try await api.request(
        "/api/forms/promote", method: .post,
        body: ["hostId": .string(hostID), "formId": .string(formID), "versionId": .string(versionID)])
    } catch let error as ConsoleAPIError {
      let violations = promoteViolations(error.body)
      if !violations.isEmpty { throw FormPromoteRefused(message: error.message, violations: violations) }
      throw error
    }
  }

  /// The version to open in the Besigner: `preferred`, else the published
  /// one, else a first one minted for a form that has none.
  func versionToOpen(_ form: FormRow, preferred: String? = nil) async throws -> String {
    if let preferred { return preferred }
    if let versionID = form.versionID { return versionID }
    let versionID = newDocumentID()
    try await api.request(
      "/api/hosts/versions", method: .post,
      body: [
        "hostId": .string(hostID), "kind": "form", "parentId": .string(form.id), "id": .string(versionID),
        "data": [
          "formId": .string(form.id), "hostId": .string(hostID), "displayName": "Initial version",
          "rootId": .string(formCanvasRoot),
          "nodes": .object([formCanvasRoot: ["$id": .string(formCanvasRoot), "componentId": "div", "nodes": []]]),
        ],
      ])
    try await writer.merge(path(form.id), ["versionId": versionID, "updatedAt": Date()])
    return versionID
  }
}
