// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * A SITE'S INBOX, AS THE CONSOLE'S INBOX READS AND WRITES IT (the Kotlin
 * plugin's `Inbox.kt`, rule for rule).
 *
 * Submissions are `hosts/{hostId}/formSubmissions`, listed by the console's
 * SUBMISSION_LIST_QUERY through the shared planner. Read / unread is the one
 * field the rules let a site writer change; delete is the console's delete
 * and its form-stats refresh; a reply and a marketing-list add go to the
 * console's own routes.
 */

let submissionsPageSize = 25
let inboxReplyRoute = "/api/inbox/reply"
let inboxListOptionsRoute = "/api/inbox/list-options"
let inboxAssignListRoute = "/api/inbox/assign-list"
let formStatsRoute = "/api/forms/stats"
let memberRemoveRoute = "/api/membership/admin-remove"

func submissionsPath(_ hostID: String) -> [String] { ["hosts", hostID, "formSubmissions"] }
func repliesPath(_ hostID: String, _ submissionID: String) -> [String] { submissionsPath(hostID) + [submissionID, "replies"] }

enum ReadFilter: String, CaseIterable, Identifiable {
  case all, unread, read
  var id: String { rawValue }

  var value: String? {
    switch self {
    case .all: nil
    case .unread: "false"
    case .read: "true"
    }
  }

  var label: String {
    guard let value else { return "All" }
    return ContractValues.shared.submissionReadOptions.first { $0.value == value }?.label ?? rawValue.capitalized
  }
}

func submissionsRequest(_ read: ReadFilter, formID: String?, search: String) -> ListQueryRequest {
  var clauses: [ListFilterRequest] = []
  if let value = read.value { clauses.append(ListFilterRequest(field: "read", op: "equals", value: value)) }
  if let formID, !formID.isEmpty { clauses.append(ListFilterRequest(field: "formId", op: "equals", value: formID)) }
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return ListQueryRequest(clauses: clauses, search: words.isEmpty ? nil : [words])
}

/// A site's submissions. `scopedForm` is a form's own card (FORM_SCOPED_SUBMISSION_LIST_QUERY): that form is the
/// list's base, which no clause can widen; otherwise `formID` is the Form pick.
func submissionsQuery(
  _ hostID: String, read: ReadFilter, formID: String?, search: String, limit: Int, scopedForm: String? = nil
) -> FirestoreQuery {
  if let scopedForm, !scopedForm.isEmpty {
    var request = submissionsRequest(read, formID: nil, search: search)
    request.base = [ListQueryFilter(op: .equal, path: "formId", value: .string(scopedForm))]
    return planListQuery(ContractValues.shared.formScopedSubmissionListQuery, request)
      .firestoreQuery(submissionsPath(hostID), limit: limit)
  }
  return planListQuery(ContractValues.shared.submissionListQuery, submissionsRequest(read, formID: formID, search: search))
    .firestoreQuery(submissionsPath(hostID), limit: limit)
}

/// The site's forms for the Form pick, by document id as the console reads them (an `orderBy` on a name
/// would drop a form saved without one), named by `displayName`, then `name`.
func formsQuery(_ hostID: String) -> FirestoreQuery {
  FirestoreQuery(["hosts", hostID, "forms"], order: [.init("__name__")], limit: 51)
}

func formName(_ doc: FirestoreDocument) -> String {
  [doc.string("displayName"), doc.string("name")].compactMap { $0 }.first { !$0.isEmpty } ?? doc.id
}

func siteMembersQuery(_ hostID: String, search: String, limit: Int) -> FirestoreQuery {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return planListQuery(ContractValues.shared.siteMemberListQuery, ListQueryRequest(clauses: [], search: words.isEmpty ? nil : [words]))
    .firestoreQuery(["hosts", hostID, "siteMembers"], limit: limit)
}

/// The leads this site may see: the console's LEAD_LIST_QUERY with its `visibleTo` scope clause.
func siteLeadsQuery(orgID: String, hostID: String, search: String, limit: Int) -> FirestoreQuery {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  let base = [ListQueryFilter(op: .arrayContainsAny, path: "visibleTo", value: .array([.string("org"), .string("host:\(hostID)")]))]
  return planListQuery(ContractValues.shared.leadListQuery, ListQueryRequest(base: base, clauses: [], search: words.isEmpty ? nil : [words]))
    .firestoreQuery(["orgs", orgID, "leads"], limit: limit)
}

// MARK: Who wrote in: `messageSender` and `submissionSender`, replayed from the console's cases

private let senderNameKeys = ["name", "fullname", "yourname", "firstname", "contactname"]
private let senderEmailKeys = ["email", "emailaddress"]

func messageText(_ value: Any?) -> String {
  switch value {
  case let string as String: return string
  case let number as NSNumber:
    if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "true" : "false" }
    let double = number.doubleValue
    guard double.isFinite else { return "" }
    if double.rounded() == double && abs(double) < 1e15 { return String(Int64(double)) }
    return String(double)
  case let bool as Bool: return bool ? "true" : "false"
  case let array as [Any]: return array.map(messageText).filter { !$0.isEmpty }.joined(separator: " ")
  default: return ""
  }
}

struct MessageSender: Equatable {
  var name: String?
  var email: String?
}

/// Who wrote in, by the field-name convention: the first non-empty name-like and address-like values, in order.
func messageSender(_ fields: [(String, Any?)]) -> MessageSender {
  var reduced: [String: String] = [:]
  for (key, value) in fields {
    let text = messageText(value).trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { continue }
    let at = key.lowercased().filter { ($0 >= "a" && $0 <= "z") || ($0 >= "0" && $0 <= "9") }
    if reduced[at] == nil { reduced[at] = text }
  }
  return MessageSender(
    name: senderNameKeys.lazy.compactMap { reduced[$0] }.first,
    email: senderEmailKeys.lazy.compactMap { reduced[$0] }.first)
}

struct SubmissionSender: Equatable {
  let label: String
  let email: String?
  let initials: String
}

func initialsOf(_ label: String) -> String {
  let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
  let source = trimmed.contains("@") ? String(trimmed.split(separator: "@", omittingEmptySubsequences: false)[0]) : trimmed
  let words = source.split(whereSeparator: { $0.isWhitespace || $0 == "." || $0 == "_" || $0 == "-" }).map(String.init)
  let letters = words.prefix(2).compactMap { $0.first.map(String.init) }.joined()
  let result = letters.isEmpty ? (source.first.map(String.init) ?? "?") : letters
  return result.uppercased()
}

func submissionSender(_ fields: [(String, Any?)], fallback: String = "Someone") -> SubmissionSender {
  let sender = messageSender(fields)
  let label = sender.name ?? sender.email ?? fallback
  return SubmissionSender(label: label, email: sender.email, initials: initialsOf(label))
}

func defaultReplySubject(siteName: String?, formName: String?) -> String {
  let site = (siteName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  let form = (formName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  let topic = !site.isEmpty ? site : !form.isEmpty ? form : "your message"
  return String("Re: your message to \(topic)".prefix(ContractValues.shared.replySubjectMax))
}

enum ChipColor: String { case success, info, warning, `default` }

struct RoutingChip: Hashable {
  let label: String
  let color: ChipColor
}

func routingChips(_ routing: [String: Any]?) -> [RoutingChip] {
  var chips = [RoutingChip(label: "Saved to Inbox", color: .success)]
  let dataset = routing?["dataset"] as? [String: Any]
  let recordID = (dataset?["recordId"] as? String) ?? ""
  if !recordID.isEmpty {
    let name = (dataset?["name"] as? String) ?? ""
    chips.append(RoutingChip(label: name.isEmpty ? "Added to a dataset" : "Added to “\(name)” dataset", color: .info))
  }
  if let refused = routing?["datasetRefused"] as? [String: Any], recordID.isEmpty {
    let errors = refused["errors"] as? [String: Any] ?? [:]
    let reasons = errors.keys.sorted().compactMap { errors[$0] as? String }.filter { !$0.isEmpty }
    let name = (refused["name"] as? String) ?? ""
    let place = name.isEmpty ? "the dataset" : "“\(name)” dataset"
    chips.append(
      RoutingChip(
        label: reasons.isEmpty ? "Not added to \(place)" : "Not added to \(place): \(reasons.joined(separator: "; "))",
        color: .warning))
  }
  return chips
}

// MARK: Rows

struct Submission: Identifiable, Equatable {
  let id: String
  let formID: String?
  let formName: String
  let sender: SubmissionSender
  let fields: [(key: String, value: String)]
  let read: Bool
  let receivedAt: Date?
  let repliedAt: Date?
  let path: String?
  let chips: [RoutingChip]
  let capturedKind: String?
  let capturedID: String?

  var preview: String { fields.map { "\($0.key): \($0.value)" }.joined(separator: " · ") }

  static func == (a: Submission, b: Submission) -> Bool {
    a.id == b.id && a.read == b.read && a.repliedAt == b.repliedAt && a.preview == b.preview
  }
}

/// A stored map's entries in the order the server wrote them where the SDK keeps it, else by key.
func orderedEntries(_ map: [String: Any]) -> [(String, Any?)] {
  map.keys.sorted().map { ($0, map[$0]) }
}

func date(_ value: Any?) -> Date? {
  epochMillis(value).map { Date(timeIntervalSince1970: Double($0) / 1000) }
}

func submission(_ doc: FirestoreDocument) -> Submission {
  let fields = orderedEntries(doc.data["fields"] as? [String: Any] ?? [:])
  let formName = (doc.string("formName")?.isEmpty == false ? doc.string("formName") : nil) ?? "Form"
  let captured = doc.data["capturedRecord"] as? [String: Any]
  return Submission(
    id: doc.id, formID: doc.string("formId"), formName: formName,
    sender: submissionSender(fields, fallback: formName),
    fields: fields.map { (key: $0.0, value: messageText($0.1)) }.filter { !$0.value.trimmingCharacters(in: .whitespaces).isEmpty },
    read: doc.bool("read") == true, receivedAt: date(doc.data["createdAt"]), repliedAt: date(doc.data["repliedAtMs"]),
    path: doc.string("path"), chips: routingChips(doc.data["routing"] as? [String: Any]),
    capturedKind: captured?["kind"] as? String, capturedID: captured?["id"] as? String)
}

struct SentReply: Identifiable {
  let id: String
  let to: String
  let subject: String
  let message: String
  let sentAt: Date?
}

func sentReply(_ doc: FirestoreDocument) -> SentReply {
  SentReply(
    id: doc.id, to: doc.string("to") ?? "", subject: doc.string("subject") ?? "", message: doc.string("message") ?? "",
    sentAt: date(doc.data["sentAtMs"]))
}

struct InboxPermissions: Equatable {
  let canWrite: Bool
  let canReply: Bool

  init(canWrite: Bool, canReply: Bool) {
    self.canWrite = canWrite
    self.canReply = canReply
  }

  init(role: String?) {
    canWrite = ["owner", "admin", "editor", "author"].contains(role ?? "")
    canReply = ["owner", "admin", "editor"].contains(role ?? "")
  }
}

struct SiteMemberRow: Identifiable {
  let id: String
  let name: String
  let email: String
  let joinedAt: Date?
}

func siteMember(_ doc: FirestoreDocument) -> SiteMemberRow {
  let email = doc.string("email") ?? ""
  let name = ["displayName", "name"].compactMap { doc.string($0) }.first { !$0.isEmpty } ?? (email.isEmpty ? "Member" : email)
  return SiteMemberRow(id: doc.id, name: name, email: email, joinedAt: date(doc.data["createdAt"]))
}

struct LeadRow: Identifiable {
  let id: String
  let name: String
  let email: String
  let statusLabel: String?
  let company: String?
}

func leadRow(_ doc: FirestoreDocument) -> LeadRow {
  let email = doc.string("email") ?? ""
  return LeadRow(
    id: doc.id, name: doc.string("name").flatMap { $0.isEmpty ? nil : $0 } ?? email, email: email,
    statusLabel: doc.string("statusLabel"), company: doc.string("company"))
}

// MARK: Writes

struct ListOption: Identifiable, Hashable {
  let id: String
  let name: String
}

struct ListOptions {
  let to: String?
  let lists: [ListOption]
  let truncated: Bool
  let enrollable: Bool
  let requiresAttestation: Bool
  let summary: String?
}

/// The Inbox's writes, as the console makes them.
struct InboxActions {
  let api: ConsoleAPIClient
  let reader: FirestoreReader
  let hostID: String

  private func body(_ fields: [String: Any?]) -> JSONValue {
    var all = fields
    all["hostId"] = hostID
    return jsonBody(all)
  }

  func setRead(_ submissionID: String, _ read: Bool) async throws {
    try await reader.setDocument(submissionsPath(hostID) + [submissionID], ["read": read], merge: true)
  }

  func delete(_ row: Submission) async throws {
    try await reader.deleteDocument(submissionsPath(hostID) + [row.id])
    if let formID = row.formID {
      _ = try? await api.request(formStatsRoute, method: .post, body: body(["formIds": [formID]]))
    }
  }

  func reply(_ submissionID: String, subject: String, message: String) async throws -> String? {
    let answer = try await api.request(
      inboxReplyRoute, method: .post, body: body(["submissionId": submissionID, "subject": subject, "message": message]))
    return answer?["to"]?.stringValue
  }

  func listOptions(_ submissionID: String) async throws -> ListOptions {
    let answer = try await api.request(inboxListOptionsRoute, method: .post, body: body(["submissionId": submissionID]))
    let lists = (answer?["lists"]?.arrayValue ?? []).compactMap { item -> ListOption? in
      guard let id = item["id"]?.stringValue else { return nil }
      return ListOption(id: id, name: item["name"]?.stringValue ?? id)
    }
    return ListOptions(
      to: answer?["to"]?.stringValue, lists: lists, truncated: answer?["listsTruncated"]?.boolValue == true,
      enrollable: answer?["enrollable"]?.boolValue == true,
      requiresAttestation: answer?["requiresAttestation"]?.boolValue == true, summary: answer?["summary"]?.stringValue)
  }

  func assignList(_ submissionID: String, listID: String, attest: Bool) async throws -> String? {
    let answer = try await api.request(
      inboxAssignListRoute, method: .post,
      body: body(["submissionId": submissionID, "listId": listID, "attestConsent": attest]))
    return answer?["listName"]?.stringValue
  }

  func removeMember(_ memberID: String) async throws {
    _ = try await api.request(memberRemoveRoute, method: .post, body: body(["memberId": memberID]))
  }
}
