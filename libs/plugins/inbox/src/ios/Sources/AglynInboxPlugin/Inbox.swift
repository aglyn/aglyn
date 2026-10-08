// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * THE REST OF A SITE'S INBOX, AS THE CONSOLE READS AND WRITES IT (the Kotlin
 * plugin's `Inbox.kt`, rule for rule). The submissions themselves (their
 * list, one message, read or unread, reply, delete, export) are
 * `Submissions.swift`; this file holds what surrounds them: the form pick,
 * who wrote in and what the site did with it, the marketing-list add, and the
 * site's members and leads.
 */

let inboxListOptionsRoute = "/api/inbox/list-options"
let inboxAssignListRoute = "/api/inbox/assign-list"
let memberRemoveRoute = "/api/membership/admin-remove"

func repliesPath(_ hostID: String, _ submissionID: String) -> [String] { submissionsPath(hostID) + [submissionID, "replies"] }

/// The site's forms for the Form pick, by document id as the console reads them (an `orderBy` on a name
/// would drop a form saved without one), named by `displayName`, then `name`.
func formsQuery(_ hostID: String) -> FirestoreQuery {
  FirestoreQuery(["hosts", hostID, "forms"], order: [.init("__name__")], limit: 51)
}

func inboxFormName(_ doc: FirestoreDocument) -> String {
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

// MARK: Who wrote in: `submissionSender`, replayed from the console's cases

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
  let sender = messageSender(fields.map { (key: $0.0, value: $0.1) })
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

func date(_ value: Any?) -> Date? {
  epochMillis(value).map { Date(timeIntervalSince1970: Double($0) / 1000) }
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

/// What the site role may do in the Inbox: write (read state, delete) is the console's content roles,
/// reply and the list add are owner, admin and editor.
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
