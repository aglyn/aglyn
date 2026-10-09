// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * A SITE'S FORM SUBMISSIONS, AS THE CONSOLE'S SUBMISSIONS CARD READS AND
 * CHANGES THEM (`hosts/{hostId}/formSubmissions`), the Kotlin plugin's
 * `Submissions.kt`: the site's list (SUBMISSION_LIST_QUERY) or one form's
 * (FORM_SCOPED_SUBMISSION_LIST_QUERY, the form as its base), newest first,
 * with the read filter and the search as clauses on the one query. A
 * submission is opened (which marks it read), marked read or unread, replied
 * to, deleted and exported, each the way the console does it.
 */

let submissionsPageSize = 30

func submissionsPath(_ hostID: String) -> [String] { ["hosts", hostID, "formSubmissions"] }

/// The sender, found by field name the way the console finds it (`messageSender`).
struct Sender: Hashable {
  var name: String?
  var email: String?
}

private let senderNameKeys = ["name", "fullname", "yourname", "firstname", "contactname"]
private let senderEmailKeys = ["email", "emailaddress"]

/// A field value as text, the way the console prints it.
func submissionText(_ value: Any?) -> String {
  switch value {
  case let text as String: return text
  case let number as NSNumber:
    if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "true" : "false" }
    let double = number.doubleValue
    guard double.isFinite else { return "" }
    if double == double.rounded(), abs(double) < 9_007_199_254_740_992 { return String(Int64(double)) }
    return "\(double)"
  case let flag as Bool: return flag ? "true" : "false"
  case let list as [Any]: return list.map(submissionText).filter { !$0.isEmpty }.joined(separator: " ")
  default: return ""
  }
}

/// The key a field name is matched by: lower case, letters and digits only.
private func senderKey(_ key: String) -> String {
  String(key.lowercased().unicodeScalars.filter { ("a"..."z").contains($0) || ("0"..."9").contains($0) }.map(Character.init))
}

/// Who sent a submission, from its fields in order (`messageSender`).
func messageSender(_ fields: [(key: String, value: Any?)]?) -> Sender {
  var reduced: [String: String] = [:]
  for (key, value) in fields ?? [] {
    let text = submissionText(value).trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { continue }
    let at = senderKey(key)
    if reduced[at] == nil { reduced[at] = text }
  }
  return Sender(
    name: senderNameKeys.lazy.compactMap { reduced[$0] }.first,
    email: senderEmailKeys.lazy.compactMap { reduced[$0] }.first)
}

/// One field the visitor sent.
struct SubmissionField: Hashable, Identifiable {
  let key: String
  let text: String
  var id: String { key }
}

/// One submission, as the list and its detail read it.
struct Submission: Identifiable, Hashable {
  let id: String
  let formID: String?
  let formName: String
  let path: String?
  /// What the visitor sent, by field name (in key order; the detail orders them by the form's questions).
  let fields: [SubmissionField]
  var read: Bool
  let createdAt: Date?
  let repliedAt: Date?
  let sender: Sender
  /// The lead or contact the submission made, when it made one, and its id.
  let capturedKind: String?
  let capturedID: String?
  /// What the site did with it: saved to the Inbox, added to a dataset, or refused by one.
  let chips: [RoutingChip]

  init(_ doc: FirestoreDocument) {
    let raw = (doc.data["fields"] as? [String: Any] ?? [:]).sorted { $0.key < $1.key }
    id = doc.id
    formID = doc.string("formId").flatMap { $0.isEmpty ? nil : $0 }
    formName = doc.string("formName").flatMap { $0.isEmpty ? nil : $0 } ?? "Form"
    path = doc.string("path").flatMap { $0.isEmpty ? nil : $0 }
    fields = raw.map { SubmissionField(key: $0.key, text: submissionText($0.value)) }
    read = doc.bool("read") == true
    createdAt = Self.date(doc.data["createdAt"])
    repliedAt = Self.date(doc.data["repliedAtMs"])
    sender = messageSender(raw.map { (key: $0.key, value: $0.value as Any?) })
    let captured = doc.data["capturedRecord"] as? [String: Any]
    capturedKind = captured?["kind"] as? String
    capturedID = captured?["id"] as? String
    chips = routingChips(doc.data["routing"] as? [String: Any])
  }

  private static func date(_ value: Any?) -> Date? {
    if let date = value as? Date { return date }
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    return Date(timeIntervalSince1970: number.doubleValue / 1000)
  }

  /// Who it is from, as the list's From column names it.
  var from: String { sender.name ?? sender.email ?? "Someone" }

  /// The list's second line: what they wrote, the sender's own name and address left out.
  var preview: String {
    fields.map(\.text).filter { !$0.isEmpty && $0 != sender.name && $0 != sender.email }.joined(separator: " · ")
  }

  /// The fields in the form's question order (`order`), then the rest.
  func orderedFields(_ order: [String]) -> [SubmissionField] {
    let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
    return fields.sorted { (rank[$0.key] ?? Int.max, $0.key) < (rank[$1.key] ?? Int.max, $1.key) }
  }
}

/// The read chips above the list: every submission, then the Read filter's own options.
func readChoices() -> [(value: String?, label: String)] {
  [(nil, "All")] + ContractValues.shared.submissionReadOptions.map { ($0.value, $0.label) }
}

/// `formID` is a form's own list (FORM_SCOPED_SUBMISSION_LIST_QUERY: that form is the list's base, which no
/// clause can widen); `pickedForm` is the Form pick on the site's list, a clause on the one query.
func submissionsRequest(formID: String?, read: String?, search: String, pickedForm: String? = nil) -> ListQueryRequest {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  var clauses = read.map { [ListFilterRequest(field: "read", op: "equals", value: $0)] } ?? []
  if formID == nil, let pickedForm, !pickedForm.isEmpty {
    clauses.append(ListFilterRequest(field: "formId", op: "equals", value: pickedForm))
  }
  return ListQueryRequest(
    base: formID.map { [ListQueryFilter(op: .equal, path: "formId", value: .string($0))] },
    clauses: clauses, search: words.isEmpty ? nil : [words])
}

func submissionsPlan(formID: String?, read: String?, search: String, pickedForm: String? = nil) -> ListQueryPlan {
  planListQuery(
    formID != nil ? ContractValues.shared.formScopedSubmissionListQuery : ContractValues.shared.submissionListQuery,
    submissionsRequest(formID: formID, read: read, search: search, pickedForm: pickedForm))
}

/// What an export of the list covers: one form's, the read filter's, or every submission.
func submissionsExportScope(formID: String?, read: String?) -> JSONValue {
  var filter: [String: JSONValue] = [:]
  if let formID { filter["formId"] = .string(formID) }
  if let read { filter["read"] = .bool(read == "true") }
  return filter.isEmpty ? ["kind": "all"] : ["kind": "filter", "filter": .object(filter)]
}

/// One list of submissions, live: the filter, the search and the rows read
/// so far, a page at a time plus one probe row.
@MainActor
@Observable
final class SubmissionsModel {
  private(set) var rows: [Submission] = []
  private(set) var ready = false
  private(set) var failed = false
  private(set) var hasMore = false
  private(set) var notice: String?
  var read: String? { didSet { if oldValue != read { restart() } } }
  /// The Form pick on the site's list; a form's own list (`formID`) offers none.
  var pickedForm: String? { didSet { if oldValue != pickedForm { restart() } } }
  private(set) var search = ""
  let formID: String?

  @ObservationIgnored private var reader: FirestoreReader?
  @ObservationIgnored private var hostID: String?
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var limit = submissionsPageSize
  @ObservationIgnored private var debounce: Task<Void, Never>?

  init(formID: String?) {
    self.formID = formID
  }

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
    limit += submissionsPageSize
    listen()
  }

  func retry() { restart() }

  func stop() {
    debounce?.cancel()
    listener?.remove()
    listener = nil
  }

  /// Mirrors a read change or a delete on the rows shown, while the write lands.
  func patch(_ id: String, read: Bool? = nil, removed: Bool = false) {
    if removed {
      rows.removeAll { $0.id == id }
    } else if let read, let at = rows.firstIndex(where: { $0.id == id }), rows[at].read != read {
      rows[at] = rows[at].with(read: read)
    }
  }

  private func restart() {
    limit = submissionsPageSize
    ready = false
    listen()
  }

  private func listen() {
    listener?.remove()
    failed = false
    guard let reader, let hostID else { return }
    let plan = submissionsPlan(formID: formID, read: read, search: search, pickedForm: pickedForm)
    notice = plan.refused.isEmpty ? plan.notices.first : "This search cannot run with that filter. Clear one of them."
    let window = limit
    listener = reader.listen(plan.firestoreQuery(submissionsPath(hostID), limit: window + 1)) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.hasMore = docs.count > window
        self.rows = docs.prefix(window).map(Submission.init)
      case .failure:
        self.hasMore = false
        self.failed = true
      }
      self.ready = true
    }
  }
}

extension Submission {
  func with(read: Bool) -> Submission {
    var copy = self
    copy.read = read
    return copy
  }
}

/// One submission, live, with the form's own question labels and order.
@MainActor
@Observable
final class SubmissionModel {
  private(set) var submission: Submission?
  private(set) var ready = false
  private(set) var missing = false
  private(set) var failed = false
  /// Field name to the form's label, where the form still declares it.
  private(set) var labels: [String: String] = [:]
  private(set) var order: [String] = []
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var formListener: FirestoreListening?
  @ObservationIgnored private var formFor: String?

  func start(_ reader: FirestoreReader, hostID: String, id: String) {
    stop()
    ready = false
    listener = reader.listenDocument(submissionsPath(hostID) + [id]) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let doc?):
        let submission = Submission(doc)
        self.submission = submission
        self.missing = false
        self.failed = false
        if let formID = submission.formID, formID != self.formFor { self.listenForm(reader, hostID: hostID, formID: formID) }
      case .success(nil):
        self.submission = nil
        self.missing = true
      case .failure: self.failed = true
      }
      self.ready = true
    }
  }

  private func listenForm(_ reader: FirestoreReader, hostID: String, formID: String) {
    formListener?.remove()
    formFor = formID
    formListener = reader.listenDocument(["hosts", hostID, "forms", formID]) { [weak self] result in
      guard let self, case .success(let doc?) = result else { return }
      var labels: [String: String] = [:]
      var order: [String] = []
      for entry in doc.data["fields"] as? [Any] ?? [] {
        guard let field = entry as? [String: Any], let name = field["fieldName"] as? String else { continue }
        let label = (field["label"] as? String).flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
        labels[name] = label ?? name
        order.append(name)
      }
      self.labels = labels
      self.order = order
    }
  }

  func stop() {
    listener?.remove()
    formListener?.remove()
    listener = nil
    formListener = nil
    formFor = nil
  }
}

/// The submission writes, as the console's card makes them: read state as
/// the one field the rules let change, a delete then the form's recount, a
/// reply through the inbox reply route. The export is the platform's
/// (`TransferExportSheet`, resource `forms.submissions`).
struct SubmissionsAPI {
  let api: ConsoleAPIClient
  let writer: FirestoreWriter
  let firestore: FirestoreReader
  let hostID: String

  func setRead(_ id: String, read: Bool) async throws {
    try await writer.merge(submissionsPath(hostID) + [id], ["read": read])
  }

  func delete(_ submission: Submission) async throws {
    try await firestore.deleteDocument(submissionsPath(hostID) + [submission.id])
    if let formID = submission.formID {
      _ = try? await api.request(
        "/api/forms/stats", method: .post, body: ["hostId": .string(hostID), "formIds": [.string(formID)]])
    }
  }

  func replyBody(_ id: String, subject: String, message: String) -> JSONValue {
    ["hostId": .string(hostID), "submissionId": .string(id), "subject": .string(subject), "message": .string(message)]
  }

  func reply(_ id: String, subject: String, message: String) async throws {
    try await api.request("/api/inbox/reply", method: .post, body: replyBody(id, subject: subject, message: message))
  }
}
