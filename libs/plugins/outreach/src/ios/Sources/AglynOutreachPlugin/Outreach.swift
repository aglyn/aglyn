// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import Foundation

/*
 * SEQUENCES (the Kotlin plugin's `Outreach.kt`). Internal only: shown where
 * the console shows them and nowhere else, which is three gates at once
 * (`OutreachGate`): the `release_outreach` release flag, the workspace's
 * `outreach` feature, and the member's `outreach.use` permission. Reads are
 * the console's own list declarations over `orgs/{orgId}/outreach*`; every
 * write is an `/api/outreach/...` route, each naming its org.
 */

let outreachSequencesScreen = "outreach.sequences"
let outreachMailboxesScreen = "outreach.mailboxes"
let outreachComplianceScreen = "outreach.compliance"

func outreachRoute(_ name: String) -> String { "/api/outreach/\(name)" }

/// `outreach.use`, resolved as the console's `resolveOrgPermissions`: the role's default (owner and admin
/// yes, editor and viewer no), then the member's custom role, then the member's own override.
func outreachPermitted(member: [String: Any]?, role customRole: [String: Any]?) -> Bool {
  let role = member?["role"] as? String ?? "viewer"
  var allowed = role == "owner" || role == "admin"
  if member?["roleId"] as? String != nil, let value = (customRole?["permissions"] as? [String: Any])?["outreach.use"] as? Bool {
    allowed = value
  }
  if let value = (member?["permissions"] as? [String: Any])?["outreach.use"] as? Bool { allowed = value }
  return allowed
}

/// The three gates the console applies before it shows the Outreach tab.
@MainActor
@Observable
final class OutreachGate {
  @ObservationIgnored let org = ObservedDocument()
  @ObservationIgnored let member = ObservedDocument()
  @ObservationIgnored let role = ObservedDocument()
  private(set) var staff = false
  private(set) var claimsRead = false
  private var roleID: String?

  func start(_ context: NativePluginContext) {
    guard let orgID = context.orgID else { return }
    org.start(context.firestore, ["orgs", orgID])
    member.start(context.firestore, ["orgs", orgID, "members", context.uid])
    Task {
      staff = await context.api.claims()["staff"] as? Bool == true
      claimsRead = true
    }
  }

  func follow(_ context: NativePluginContext) {
    guard let orgID = context.orgID, let id = member.document?.string("roleId"), id != roleID else { return }
    roleID = id
    role.start(context.firestore, ["orgs", orgID, "roles", id])
  }

  func stop() {
    org.stop()
    member.stop()
    role.stop()
  }

  var ready: Bool { org.ready && member.ready && claimsRead }

  func open(orgID: String?) -> Bool {
    releaseFlagOn("release_outreach", org: org.document?.data, orgID: orgID, staff: staff)
      && planFeatureCarried(org.document?.data, "outreach")
      && outreachPermitted(member: member.document?.data, role: role.document?.data)
  }
}

func sequencesQuery(_ orgID: String, status: String, search: String, limit: Int) -> FirestoreQuery {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return planListQuery(
    ContractValues.shared.outreachSequenceListQuery,
    ListQueryRequest(
      clauses: status.isEmpty ? [] : [ListFilterRequest(field: "status", op: "equals", value: status)], search: words.isEmpty ? nil : [words])
  ).firestoreQuery(["orgs", orgID, "outreachSequences"], limit: limit)
}

func enrollmentsQuery(_ orgID: String, sequenceID: String, status: String, search: String, limit: Int) -> FirestoreQuery {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return planListQuery(
    ContractValues.shared.outreachEnrollmentListQuery,
    ListQueryRequest(
      base: [ListQueryFilter(op: .equal, path: "sequenceId", value: .string(sequenceID))],
      clauses: status.isEmpty ? [] : [ListFilterRequest(field: "status", op: "equals", value: status)], search: words.isEmpty ? nil : [words])
  ).firestoreQuery(["orgs", orgID, "outreachEnrollments"], limit: limit)
}

func doNotContactDomainsQuery(_ orgID: String, search: String, limit: Int) -> FirestoreQuery {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return planListQuery(ContractValues.shared.outreachDoNotContactDomainListQuery, ListQueryRequest(clauses: [], search: words.isEmpty ? nil : [words]))
    .firestoreQuery(["orgs", orgID, "outreachDoNotContactDomains"], limit: limit)
}

let sequenceStatusLabels: [String: String] = ["draft": "Draft", "active": "Active", "paused": "Paused", "archived": "Archived"]
let enrollmentStatusLabels: [String: String] = [
  "active": "Active", "paused": "Paused", "finished": "Finished", "replied": "Replied", "bounced": "Bounced", "opted_out": "Opted out",
  "stopped": "Stopped", "failed": "Failed",
]
let taskKindLabels: [(String, String)] = [("linkedin", "LinkedIn"), ("call", "Call"), ("todo", "To-do")]

// MARK: Steps

struct SequenceStep: Identifiable, Equatable {
  var id: String
  var kind: String
  var delayBusinessDays: Double
  var subject = ""
  var replyInThread = true
  var body = ""
  var templateID: String?
  var taskKind = "todo"
  var title = ""

  init(_ raw: [String: Any]) {
    id = raw["id"] as? String ?? ""
    kind = raw["kind"] as? String ?? "email"
    delayBusinessDays = (raw["delayBusinessDays"] as? NSNumber)?.doubleValue ?? 0
    subject = raw["subject"] as? String ?? ""
    replyInThread = raw["replyInThread"] as? Bool ?? true
    body = raw["body"] as? String ?? ""
    templateID = raw["templateId"] as? String
    taskKind = raw["taskKind"] as? String ?? "todo"
    title = raw["title"] as? String ?? ""
  }

  /// A new step as the editor adds one: the first email waits 0 days, a later one 3, a task 1.
  static func new(kind: String, after steps: [SequenceStep], taskKind: String = "todo") -> SequenceStep {
    let isFirstEmail = kind == "email" && !steps.contains { $0.kind == "email" }
    var step = SequenceStep([
      "id": "step-\(newResourceID(length: 6).lowercased())", "kind": kind,
      "delayBusinessDays": kind == "email" ? (isFirstEmail ? 0 : 3) : 1,
    ])
    step.taskKind = taskKind
    step.title = taskKind == "linkedin" ? "Connect on LinkedIn" : taskKind == "call" ? "Call" : ""
    return step
  }

  var stored: [String: Any] {
    kind == "email"
      ? [
        "id": id, "kind": "email", "delayBusinessDays": delayBusinessDays, "subject": subject, "replyInThread": replyInThread, "body": body,
        "templateId": templateID.map { $0 as Any } ?? NSNull(),
      ]
      : ["id": id, "kind": "task", "taskKind": taskKind, "title": title, "delayBusinessDays": delayBusinessDays]
  }
}

struct Issue: Equatable {
  let path: String
  let code: String
  let message: String
}

/// The errors of the console's `validateOutreachSequence` a save is held on, before the route checks
/// everything again (its warnings, the send window and the reply prefix are the route's to answer).
func validateSequence(name: String, mailboxID: String, steps: [SequenceStep]) -> [Issue] {
  let values = ContractValues.shared
  var issues: [Issue] = []
  if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    issues.append(Issue(path: "name", code: "name_required", message: "Name the sequence."))
  } else if name.count > values.outreachSequenceNameMax {
    issues.append(Issue(path: "name", code: "name_too_long", message: "Keep the name under \(values.outreachSequenceNameMax) characters."))
  }
  if steps.contains(where: { $0.kind == "email" }) && mailboxID.trimmingCharacters(in: .whitespaces).isEmpty {
    issues.append(Issue(path: "mailboxId", code: "mailbox_required", message: "Choose the mailbox this sequence sends from."))
  }
  if steps.isEmpty {
    issues.append(Issue(path: "steps", code: "steps_required", message: "Add at least one step."))
    return issues
  }
  if steps.count > values.outreachMaxSteps {
    issues.append(Issue(path: "steps", code: "too_many_steps", message: "A sequence holds at most \(values.outreachMaxSteps) steps."))
  }
  if steps.filter({ $0.kind == "email" }).count > values.outreachMaxEmailSteps {
    issues.append(
      Issue(path: "steps", code: "too_many_email_steps", message: "A sequence sends at most \(values.outreachMaxEmailSteps) emails to one person."))
  }
  let firstEmail = steps.firstIndex { $0.kind == "email" } ?? -1
  var seen = Set<String>()
  for (index, step) in steps.enumerated() {
    let path = "steps.\(index)"
    let id = step.id.trimmingCharacters(in: .whitespaces)
    if id.isEmpty {
      issues.append(Issue(path: "\(path).id", code: "step_id_required", message: "Every step needs an id."))
    } else if seen.contains(id) {
      issues.append(Issue(path: "\(path).id", code: "duplicate_step_id", message: "Two steps share an id."))
    }
    seen.insert(id)
    guard step.kind == "email" || step.kind == "task" else {
      issues.append(Issue(path: path, code: "unknown_step_kind", message: "A step is an email or a task."))
      continue
    }
    let followsAnEmail = step.kind == "email" && index > firstEmail
    let minDelay = followsAnEmail ? Double(values.outreachMinEmailFollowUpBusinessDays) : 0
    let maxDelay = Double(values.outreachMaxStepDelayBusinessDays)
    let delay = step.delayBusinessDays
    if !(delay.rounded() == delay && delay >= minDelay && delay <= maxDelay) {
      issues.append(
        Issue(
          path: "\(path).delayBusinessDays", code: "delay_invalid",
          message: minDelay > 0
            ? "Wait \(Int(minDelay))–\(Int(maxDelay)) business days before this email."
            : "Wait 0–\(Int(maxDelay)) business days before this step."))
    }
    if step.kind == "email" {
      let startsThread = !(index > firstEmail && step.replyInThread)
      if startsThread {
        if step.subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          issues.append(
            Issue(
              path: "\(path).subject", code: "subject_required",
              message: index == firstEmail ? "The first email needs a subject." : "An email that starts a new thread needs a subject."))
        }
        if step.subject.count > values.crmEmailSubjectMax {
          issues.append(Issue(path: "\(path).subject", code: "subject_too_long", message: "Keep the subject under \(values.crmEmailSubjectMax) characters."))
        }
      }
      let hasBody = !step.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      let hasTemplate = !(step.templateID ?? "").trimmingCharacters(in: .whitespaces).isEmpty
      if hasBody && hasTemplate {
        issues.append(Issue(path: "\(path).body", code: "body_and_template", message: "Write the email here or pick a template, not both."))
      } else if !hasBody && !hasTemplate {
        issues.append(Issue(path: "\(path).body", code: "body_required", message: "Write the email, or pick a template."))
      }
      if step.body.count > values.crmEmailBodyMax {
        issues.append(Issue(path: "\(path).body", code: "body_too_long", message: "Keep the email under \(enUSGrouped(values.crmEmailBodyMax)) characters."))
      }
    } else {
      if !taskKindLabels.map(\.0).contains(step.taskKind) {
        issues.append(Issue(path: "\(path).taskKind", code: "task_kind_invalid", message: "Pick LinkedIn, Call or To-do."))
      }
      if step.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        issues.append(Issue(path: "\(path).title", code: "task_title_required", message: "Give the task a title."))
      } else if step.title.count > values.outreachTaskTitleMax {
        issues.append(
          Issue(path: "\(path).title", code: "task_title_too_long", message: "Keep the title under \(values.outreachTaskTitleMax) characters."))
      }
    }
  }
  return issues
}

// MARK: Rows

struct SequenceRow: Identifiable {
  let id: String
  let name: String
  let status: String
  let mailboxID: String?
  let hostID: String?
  let steps: [SequenceStep]
  let data: [String: Any]
}

func sequenceRow(_ doc: FirestoreDocument) -> SequenceRow {
  SequenceRow(
    id: doc.id, name: doc.string("name").flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled", status: doc.string("status") ?? "draft",
    mailboxID: doc.string("mailboxId"), hostID: doc.string("hostId"),
    steps: (doc.data["steps"] as? [[String: Any]] ?? []).map(SequenceStep.init), data: doc.data)
}

struct EnrollmentRow: Identifiable {
  let id: String
  let name: String
  let email: String
  let status: String
  let stepIndex: Int
  let nextDueAt: Date?
  let stopReason: String?
}

func enrollmentRow(_ doc: FirestoreDocument) -> EnrollmentRow {
  EnrollmentRow(
    id: doc.id, name: doc.string("contactName") ?? doc.string("email") ?? doc.id, email: doc.string("email") ?? "",
    status: doc.string("status") ?? "active", stepIndex: doc.int("stepIndex") ?? 0,
    nextDueAt: epochMillis(doc.data["nextDueAtMs"]).map { Date(timeIntervalSince1970: Double($0) / 1000) }, stopReason: doc.string("stopReason"))
}

struct MailboxRow: Identifiable {
  let id: String
  let email: String
  let sendAs: String?
  let displayName: String?
  let provider: String
  let status: String
  let dailyCap: Int?
  let sentToday: Int?
  /// The mailbox's zone, which its sequences' times are read in; nil for the reader's own.
  var timeZone: String? = nil
}

func mailboxRow(_ doc: FirestoreDocument) -> MailboxRow {
  MailboxRow(
    id: doc.id, email: doc.string("email") ?? doc.id, sendAs: doc.string("sendAs"), displayName: doc.string("displayName"),
    provider: doc.string("provider") ?? "google", status: doc.string("status") ?? "connected", dailyCap: doc.int("dailyCap"),
    sentToday: ((doc.data["health"] as? [String: Any])?["sentToday"] as? NSNumber)?.intValue, timeZone: doc.string("timezone"))
}

// MARK: Results (`sequence-report.ts`)

/// One sentence saying what a figure is not (`OutreachReportCaveat`).
struct OutreachReportCaveat: Equatable {
  let id: String
  let message: String
}

/// Everything a sequence's Results card shows (`OutreachSequenceReport`); the card adds no arithmetic of its own.
struct OutreachSequenceReport: Equatable {
  var sent = 0.0
  var people: Double?
  var clicks = 0.0
  var uniqueClicks = 0.0
  var machineClicks = 0.0
  var lastClickAtMs: Double?
  var clickTracked = false
  var openTracked = false
  var openPeople: Double?
  var opens = 0.0
  var uniqueOpens = 0.0
  var machineOpens = 0.0
  var proxyOpens = 0.0
  var lastOpenAtMs: Double?
  var opensUnmeasured = false
  var clickRate: SendRate?
  var openRate: SendRate?
  var caveats: [OutreachReportCaveat] = []
}

private let outreachCaveats: [String: String] = [
  "opens-not-measured":
    "Opens aren’t measured. A sequence email is plain text, the way a one-to-one email is, and counting an open needs a tracking image in an HTML email. Clicks are measured instead.",
  "opens-unrecorded":
    "Opens are counted for this sequence, and no email with the tracking image has gone out yet. Emails sent from now on carry it.",
  "opens-counted":
    "Opens are counted from a tracking image in an HTML copy of each email, and the open rate is taken over the people sent one. Gmail readers’ opens count. Fetches made whether or not anyone reads the email — by Apple Mail as it arrives, by Yahoo’s image proxy, and by Google’s, Microsoft’s and other security scanners — are counted separately and left out of the rate.",
  "opens-all-machine":
    "Every fetch of the tracking image so far was made by a machine — a mail provider’s proxy or a security scanner fetching it for the recipient — so whether anyone read these emails can’t be told from opens, and no open rate is shown. That is common when the people emailed are behind company mail security.",
  "opens-stopped":
    "Opens were counted while this sequence’s emails carried a tracking image. It’s turned off now, so the figures cover only the emails sent while it was on.",
  "clicks-not-tracked":
    "Clicks aren’t being counted for this sequence. Turn on link tracking in its settings, and the emails sent after that have their links counted.",
  "clicks-unrecorded":
    "No click has been counted for this sequence yet: either its emails carry no links, or they went out before link tracking was turned on. Emails sent from now on are counted.",
  "machine-clicks-excluded":
    "Some clicks came from security scanners that open every link in an email before the recipient sees it. They’re counted separately and left out of the click rate.",
]

/// JavaScript's `Number(value ?? 0)` kept only when finite and positive.
private func reportCount(_ value: Any?) -> Double {
  let parsed: Double? =
    switch value {
    case nil, is NSNull: 0
    case let number as NSNumber: number.doubleValue
    case let text as String: text.trimmingCharacters(in: .whitespaces).isEmpty ? 0 : Double(text.trimmingCharacters(in: .whitespaces))
    default: nil
    }
  guard let parsed, parsed.isFinite, parsed > 0 else { return 0 }
  return parsed
}

private func finiteMs(_ value: Any?) -> Double? {
  guard let number = value as? NSNumber, !(value is Bool), number.doubleValue.isFinite else { return nil }
  return number.doubleValue
}

/// `outreachSequenceReport`: a sequence's stored counters as its Results card reads them.
func outreachSequenceReport(_ stats: [String: Any]?, trackClicks: Bool, countOpens: Bool = false) -> OutreachSequenceReport {
  let source = stats ?? [:]
  var report = OutreachSequenceReport()
  report.sent = reportCount(source["sent"])
  // Absent, not zero: `people` is the click rate's denominator, and "never counted" is not "nobody emailed".
  report.people = source.keys.contains("people") ? reportCount(source["people"]) : nil
  report.clicks = reportCount(source["clicks"])
  report.uniqueClicks = reportCount(source["uniqueClicks"])
  report.machineClicks = reportCount(source["machineClicks"])
  report.clickTracked = source["clickTracked"] as? Bool == true
  report.openTracked = source["openTracked"] as? Bool == true
  report.openPeople = source.keys.contains("openPeople") ? reportCount(source["openPeople"]) : nil
  report.opens = reportCount(source["opens"])
  report.uniqueOpens = reportCount(source["uniqueOpens"])
  report.machineOpens = reportCount(source["machineOpens"])
  report.proxyOpens = min(reportCount(source["proxyOpens"]), report.machineOpens)
  report.lastClickAtMs = finiteMs(source["lastClickAtMs"])
  report.lastOpenAtMs = finiteMs(source["lastOpenAtMs"])
  report.opensUnmeasured = report.openTracked && report.uniqueOpens == 0 && report.machineOpens > 0
  var ids: [String] = []
  if !report.openTracked { ids.append(countOpens ? "opens-unrecorded" : "opens-not-measured") } else { ids.append(countOpens ? "opens-counted" : "opens-stopped") }
  if report.opensUnmeasured { ids.append("opens-all-machine") }
  if !report.clickTracked {
    if report.sent > 0 { ids.append(trackClicks ? "clicks-unrecorded" : "clicks-not-tracked") } else if !trackClicks { ids.append("clicks-not-tracked") }
  }
  if report.machineClicks > 0 { ids.append("machine-clicks-excluded") }
  report.caveats = ids.map { OutreachReportCaveat(id: $0, message: outreachCaveats[$0] ?? "") }
  report.clickRate = report.clickTracked ? sendRate(report.uniqueClicks, report.people, "people emailed") : nil
  report.openRate =
    report.openTracked && !report.opensUnmeasured ? sendRate(report.uniqueOpens, report.openPeople, "people sent a tracked email") : nil
  return report
}

/// `formatOutreachTime`: a moment as the sequence pages print one, in the mailbox's zone where it has one.
func formatOutreachTime(_ ms: Double?, timeZone: String?) -> String {
  guard let ms, ms.isFinite else { return "—" }
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US")
  formatter.setLocalizedDateFormatFromTemplate("MMMdjmmz")
  if let timeZone, let zone = TimeZone(identifier: timeZone) { formatter.timeZone = zone }
  return formatter.string(from: Date(timeIntervalSince1970: ms / 1000))
}

// MARK: Writes

struct PreviewPerson: Identifiable {
  var id: String { personID }
  let personID: String
  let contactID: String?
  let leadID: String?
  let name: String
  let email: String
  let status: String
  let blocks: [String]
  let needsPersonalLine: Bool
  let attestations: [String]
}

/// Every Outreach write, as the console's routes take it.
struct OutreachAPI {
  let api: ConsoleAPIClient
  let orgID: String

  @discardableResult
  func post(_ name: String, _ fields: [String: Any?]) async throws -> JSONValue? {
    var all = fields
    all["orgId"] = orgID
    return try await api.request(outreachRoute(name), method: .post, body: jsonBody(all))
  }

  func get(_ name: String) async throws -> JSONValue? {
    try await api.request(outreachRoute(name), query: [("orgId", orgID)])
  }

  /// Saves a draft or an edit; the route's refusal carries its issues, which the editor shows.
  func save(sequenceID: String?, name: String, hostID: String, mailboxID: String, steps: [SequenceStep], settings: [String: Any], campaignIDs: [String])
    async throws -> String?
  {
    let answer = try await post(
      "sequences/save",
      [
        "sequenceId": sequenceID,
        "sequence": [
          "name": name, "hostId": hostID, "mailboxId": mailboxID, "steps": steps.map(\.stored), "settings": settings, "campaignIds": campaignIDs,
        ],
      ])
    return answer?["sequence"]?["id"]?.stringValue ?? sequenceID
  }

  func setStatus(_ sequenceID: String, _ action: String) async throws { try await post("sequences/status", ["sequenceId": sequenceID, "action": action]) }
  func delete(_ sequenceID: String) async throws { try await post("sequences/delete", ["sequenceId": sequenceID]) }

  func enrollmentAction(_ enrollmentID: String, _ action: String) async throws {
    try await post("enrollments/action", ["enrollmentId": enrollmentID, "action": action])
  }

  func preview(sequenceID: String, kind: String, ids: [String]) async throws -> [PreviewPerson] {
    let answer = try await post(
      "enroll/preview", ["sequenceId": sequenceID, "source": ["kind": kind, kind == "contacts" ? "contactIds" : "leadIds": ids]])
    return (answer?["people"]?.arrayValue ?? []).compactMap { p in
      guard let personID = p["personId"]?.stringValue else { return nil }
      return PreviewPerson(
        personID: personID, contactID: p["contactId"]?.stringValue, leadID: p["leadId"]?.stringValue, name: p["name"]?.stringValue ?? "",
        email: p["email"]?.stringValue ?? "", status: p["status"]?.stringValue ?? "blocked",
        blocks: (p["blocks"]?.arrayValue ?? []).compactMap { $0["reason"]?.stringValue },
        needsPersonalLine: p["requires"]?["personalLine"]?.boolValue == true,
        attestations: (p["requires"]?["attestations"]?.arrayValue ?? []).compactMap(\.stringValue))
    }
  }

  func enroll(sequenceID: String, people: [[String: Any]]) async throws -> Int {
    let answer = try await post("enroll", ["sequenceId": sequenceID, "people": people])
    return Int(answer?["enrolled"]?.numberValue ?? 0)
  }

  func mailboxStatus(_ id: String, paused: Bool) async throws { try await post("mailboxes/status", ["mailboxId": id, "paused": paused]) }
  func mailboxSettings(_ id: String, _ fields: [String: Any?]) async throws {
    var all = fields
    all["mailboxId"] = id
    try await post("mailboxes/settings", all)
  }
  func mailboxTest(_ id: String) async throws -> String? { try await post("mailboxes/test", ["mailboxId": id])?["sentTo"]?.stringValue }
  func mailboxDisconnect(_ id: String) async throws { try await post("mailboxes/disconnect", ["mailboxId": id]) }
  func connectURL(provider: String) async throws -> URL? {
    try await post("mailboxes/connect", ["provider": provider])?["url"]?.stringValue.flatMap(URL.init(string:))
  }
  func connectComplete(code: String, state: String) async throws {
    try await post("mailboxes/connect/complete", ["code": code, "state": state, "timezone": TimeZone.current.identifier])
  }

  func doNotContactDomain(_ action: String, domain: String, detail: String? = nil) async throws {
    try await post("do-not-contact/domains", ["action": action, "domain": domain, "detail": detail])
  }

  func linkDomain(_ action: String, domain: String) async throws { try await post("link-domains", ["domain": domain, "action": action]) }
}

/// `toLocaleString('en-US')` for a whole number: `10,000`.
func enUSGrouped(_ value: Int) -> String {
  let formatter = NumberFormatter()
  formatter.numberStyle = .decimal
  formatter.locale = Locale(identifier: "en_US")
  return formatter.string(from: NSNumber(value: value)) ?? String(value)
}
