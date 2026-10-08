// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/*
 * A SITE'S EMAILS (the Kotlin plugin's `EmailSends.kt`): the console's site
 * declaration over `orgs/{orgId}/campaigns`, each send's state and report
 * from the console's own model (ported, replayed against its answers), and
 * every act through `POST /api/campaigns/send`.
 */

let emailsPageSize = 25
let campaignSendRoute = "/api/campaigns/send"

func campaignSendsPath(_ orgID: String) -> [String] { ["orgs", orgID, "campaigns"] }

var sendStatusFilters: [(String, String)] {
  [("all", "All")] + ContractValues.shared.nativeCampaignSendStatuses.map { ($0.value, $0.label) }
}

func emailsQuery(orgID: String, hostID: String, status: String, search: String, limit: Int) -> FirestoreQuery {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return planListQuery(
    ContractValues.shared.nativeSiteEmailsQuery,
    ListQueryRequest(
      base: [ListQueryFilter(op: .equal, path: "hostId", value: .string(hostID))],
      clauses: status == "all" ? [] : [ListFilterRequest(field: "status", op: "equals", value: status)],
      search: words.isEmpty ? nil : [words])
  ).firestoreQuery(campaignSendsPath(orgID), limit: limit)
}

// MARK: campaignSendProgress / campaignSendDisplay

struct SendProgress: Equatable {
  var state: String
  var reached: Int
  var audience: Int?
  var remaining: Int
  var batch: Int
  var nextAtMs: Int64
  var label: String
}

struct SendDisplay: Equatable {
  var state: String
  var label: String
  var progress: SendProgress
}

private func count(_ raw: Any?) -> Int {
  guard let value = (raw as? NSNumber)?.doubleValue, value.isFinite else { return 0 }
  let floored = value.rounded(.down)
  return floored > 0 ? Int(floored) : 0
}

/// A whole number as `toLocaleString` writes it in English: `1,200`.
func grouped(_ value: Int) -> String {
  let formatter = NumberFormatter()
  formatter.numberStyle = .decimal
  formatter.locale = Locale(identifier: "en_US")
  return formatter.string(from: NSNumber(value: value)) ?? String(value)
}

func campaignSendProgress(_ send: [String: Any]?) -> SendProgress {
  let status = send?["status"] as? String ?? "sent"
  let stats = send?["stats"] as? [String: Any]
  let reached = count(stats?["sent"])
  let rawAudience = stats?["audienceSize"]
  let audience: Int? = (rawAudience == nil || rawAudience is NSNull) ? nil : count(rawAudience)
  let resume = send?["resume"] as? [String: Any]
  let remaining = count(resume?["remaining"])
  let batch = count(resume?["batch"])
  let nextAtMs = Int64(count(resume?["nextAtMs"]))
  let of = audience.map { " of \(grouped($0))" } ?? ""
  if remaining > 0 && nextAtMs > 0 && (status == "scheduled" || status == "sending") {
    return SendProgress(
      state: "sending", reached: reached, audience: audience, remaining: remaining, batch: batch, nextAtMs: nextAtMs,
      label: "Sending — reached \(grouped(reached))\(of)")
  }
  if (status == "scheduled" || status == "sending") && reached == 0 {
    return SendProgress(
      state: "pending", reached: 0, audience: audience, remaining: remaining, batch: batch, nextAtMs: 0,
      label: status == "sending" ? "Sending" : "Scheduled")
  }
  if remaining > 0 {
    let why = status == "canceled" ? "canceled" : status == "failed" ? "stopped by an error" : "stopped"
    return SendProgress(
      state: "stopped", reached: reached, audience: audience, remaining: remaining, batch: batch, nextAtMs: 0,
      label: "Reached \(grouped(reached))\(of) — \(why) with \(grouped(remaining)) not addressed")
  }
  return SendProgress(
    state: "sent", reached: reached, audience: audience, remaining: 0, batch: batch, nextAtMs: 0,
    label: batch > 1 ? "Sent to \(grouped(reached))\(of) over \(batch) runs" : "Sent to \(grouped(reached))\(of)")
}

func campaignSendHeld(_ send: [String: Any]?) -> Bool {
  let status = send?["status"] as? String ?? ""
  return (send?["staffReview"] as? [String: Any])?["state"] as? String == "held" && (status == "scheduled" || status == "draft")
}

func campaignSendDisplay(_ send: [String: Any]?) -> SendDisplay {
  let progress = campaignSendProgress(send)
  if campaignSendHeld(send) { return SendDisplay(state: "held", label: "Held for review", progress: progress) }
  if send?["status"] as? String == "draft" { return SendDisplay(state: "draft", label: "Draft", progress: progress) }
  return SendDisplay(state: progress.state, label: progress.label, progress: progress)
}

// MARK: campaignReport / sendRate / sendLinkReport

struct SendRate: Equatable {
  let value: Double
  let numerator: Double
  let denominator: Double
  let denominatorLabel: String
}

func sendRate(_ numerator: Double?, _ denominator: Double?, _ label: String) -> SendRate? {
  let top = numerator ?? 0
  let bottom = denominator ?? 0
  guard top.isFinite, bottom.isFinite, bottom > 0 else { return nil }
  return SendRate(value: top / bottom, numerator: top, denominator: bottom, denominatorLabel: label)
}

struct Population: Equatable {
  let id: String
  let label: String
  let count: Int
  let ofLabel: String
  let of: Int
}

struct Caveat: Equatable {
  let id: String
  let message: String
}

struct CampaignReport {
  var sent = 0
  var recipients = 0
  var delivered: Int?
  var opens = 0
  var clicks = 0
  var uniqueOpens: Int?
  var uniqueClicks: Int?
  var bounced = 0
  var complained = 0
  var unsubscribes = 0
  var rates: [String: SendRate?] = [:]
  var populations: [Population] = []
  var caveats: [Caveat] = []
}

func campaignReport(_ stats: [String: Any]?) -> CampaignReport {
  let s = stats ?? [:]
  func n(_ key: String) -> Int { (s[key] as? NSNumber)?.intValue ?? 0 }
  func opt(_ key: String) -> Int? { s[key] == nil || s[key] is NSNull ? nil : n(key) }
  var report = CampaignReport()
  report.sent = n("sent")
  report.recipients = n("recipients")
  report.delivered = opt("delivered")
  report.opens = n("opens")
  report.clicks = n("clicks")
  report.uniqueOpens = opt("uniqueOpens")
  report.uniqueClicks = opt("uniqueClicks")
  report.bounced = n("bounced")
  report.complained = n("complained")
  report.unsubscribes = n("unsubscribes")
  let clickTrackable = s["clickTracked"] as? Bool == true
  let delivered = report.delivered.map(Double.init)
  report.rates = [
    "delivery": report.delivered.flatMap { sendRate(Double($0), Double(report.sent), "sent") },
    "open": sendRate(report.uniqueOpens.map(Double.init), delivered, "delivered"),
    "click": clickTrackable ? sendRate(report.uniqueClicks.map(Double.init), delivered, "delivered") : nil,
    "clickToOpen": clickTrackable ? sendRate(report.uniqueClicks.map(Double.init), report.uniqueOpens.map(Double.init), "unique openers") : nil,
    "bounce": sendRate(Double(report.bounced), Double(report.sent), "sent"),
    "complaint": sendRate(Double(report.complained), delivered, "delivered"),
    "unsubscribe": sendRate(Double(report.unsubscribes), delivered, "delivered"),
  ]
  let audienceSize = n("audienceSize")
  let rows: [(String, String, String)] = [
    ("consented", "Had a consent basis", "audience"),
    ("consentedByOperator", "Consent asserted by an operator", "audience"),
    ("grandfathered", "Reachable only because consent is not enforced retroactively", "audience"),
    ("consentWithheld", "Withheld by the consent rule", "audience"),
    ("suppressed", "Already suppressed", "addressed"),
    ("cadenceHeld", "Asked for mail less often than this", "addressed"),
    ("noMailServer", "Excluded: no mail server", "addressed"),
    ("gatewayHeld", "Excluded: behind a gateway that refused this sender", "addressed"),
  ]
  report.populations = rows.compactMap { id, label, of in
    opt(id).map { Population(id: id, label: label, count: $0, ofLabel: of, of: of == "audience" ? audienceSize : report.recipients) }
  }
  if report.delivered == nil {
    report.caveats.append(
      Caveat(
        id: "delivery-unrecorded",
        message:
          "No delivery events have been recorded for this campaign, so open, click, complaint and unsubscribe rates cannot be computed — every one of them is taken over delivered. Counts below are still real."
      ))
  }
  if !clickTrackable {
    report.caveats.append(
      Caveat(
        id: "click-tracking-unrecorded",
        message:
          "This send did not record carrying an HTML part. Click tracking rewrites links in the HTML, so a send without one reports zero clicks whatever recipients did. The click count is shown; no click rate is computed from it."
      ))
  }
  if s["audienceSizeTruncated"] as? Bool == true {
    report.caveats.append(
      Caveat(
        id: "audience-truncated",
        message:
          "Audience resolution stopped at its read ceiling, so the audience size is a floor — the real audience is at least this large, and every share taken over it is at most the figure shown."
      ))
  }
  if n("deferred") > 0 {
    report.caveats.append(
      Caveat(
        id: "send-deferred",
        message:
          "\(n("deferred")) recipients were held back by the hourly send governor and never received this campaign. They are counted in addressed, not in sent."
      ))
  }
  return report
}

struct LinkRow: Equatable {
  let url: String
  let clicks: Int
  let share: SendRate?
}

struct LinkReport: Equatable {
  var rows: [LinkRow] = []
  var attributedClicks = 0
  var overflowClicks = 0
  var unattributedClicks = 0
  var truncated = false
}

func sendLinkReport(_ rollup: [String: Any]?) -> LinkReport {
  let entries = (rollup?["links"] as? [String: Any] ?? [:]).values.compactMap { raw -> (String, Int)? in
    guard let entry = raw as? [String: Any], let url = entry["url"] as? String, !url.isEmpty else { return nil }
    return (url, (entry["clicks"] as? NSNumber)?.intValue ?? 0)
  }
  let attributed = entries.reduce(0) { $0 + $1.1 }
  let rows = entries.sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0 < $1.0 }
    .map { LinkRow(url: $0.0, clicks: $0.1, share: sendRate(Double($0.1), Double(attributed), "link clicks counted")) }
  let overflow = (rollup?["overflowClicks"] as? NSNumber)?.intValue ?? 0
  return LinkReport(
    rows: rows, attributedClicks: attributed, overflowClicks: overflow,
    unattributedClicks: (rollup?["unattributedClicks"] as? NSNumber)?.intValue ?? 0, truncated: entries.count >= 50 || overflow > 0)
}

func percent(_ rate: SendRate?) -> String {
  guard let rate else { return "—" }
  return String(format: "%.1f%%", rate.value * 100)
}

// MARK: Rows

struct EmailSend: Identifiable {
  let id: String
  let subject: String
  let display: SendDisplay
  let status: String
  let audience: String?
  let listName: String?
  let createdAt: Date?
  let sendAt: Date?
  let data: [String: Any]

  var held: Bool { display.state == "held" }
  var midFlight: Bool { display.state == "sending" }
  var canSendNow: Bool { !held && (status == "draft" || status == "scheduled") && !midFlight }
  var canStop: Bool { !held && midFlight }
  var canFollowUp: Bool { !held && status == "sent" }
  var canCancel: Bool { status == "scheduled" && !midFlight }
  var canCompose: Bool { (status == "draft" || status == "scheduled") && !midFlight && !held }

  var audienceLabel: String {
    switch audience {
    case "leads": "Leads"
    case "members": "Site members"
    case "manual": "Typed addresses"
    case "segment": "A segment"
    case "list": listName.map { "List: \($0)" } ?? "A list"
    default: audience ?? "—"
    }
  }
}

func emailSend(_ doc: FirestoreDocument) -> EmailSend {
  let subject = doc.string("subject").flatMap { $0.isEmpty ? nil : $0 } ?? doc.string("displayName") ?? "(No subject)"
  return EmailSend(
    id: doc.id, subject: subject, display: campaignSendDisplay(doc.data), status: doc.string("status") ?? "sent",
    audience: doc.string("audience"), listName: doc.string("listName"),
    createdAt: epochMillis(doc.data["createdAtMs"]).map { Date(timeIntervalSince1970: Double($0) / 1000) },
    sendAt: epochMillis(doc.data["sendAtMs"]).map { Date(timeIntervalSince1970: Double($0) / 1000) }, data: doc.data)
}

/// The message a test sends, from the stored send.
func testMessage(_ send: EmailSend) -> [String: Any?] {
  func text(_ key: String) -> String { (send.data[key] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
  let template = text("templateScreenId")
  var message: [String: Any?] = [
    "subject": text("subject").isEmpty ? "Test send" : text("subject"),
    "body": template.isEmpty ? (send.data["body"] as? String ?? "") : "",
    "fromName": text("fromName"), "replyTo": text("replyTo"), "preheader": text("preheader"),
  ]
  if !text("senderId").isEmpty { message["senderId"] = text("senderId") }
  if !template.isEmpty {
    message["templateScreenId"] = template
    if let plain = send.data["plainText"] as? String, !plain.isEmpty { message["plainText"] = plain }
  }
  if !text("emailCampaignId").isEmpty { message["emailCampaignId"] = text("emailCampaignId") }
  return message
}

struct Proofs {
  var recipients: [String] = []
  var personas: [(email: String, name: String)] = []
}

/// Every act on a send, as the composer posts it.
struct CampaignSendAPI {
  let api: ConsoleAPIClient
  let hostID: String

  @discardableResult
  private func post(_ fields: [String: Any?]) async throws -> JSONValue? {
    var all = fields
    all["hostId"] = hostID
    return try await api.request(campaignSendRoute, method: .post, body: jsonBody(all))
  }

  func sendNowCount(_ id: String) async throws -> Int {
    let answer = try await post(["action": "sendNow", "campaignId": id, "dryRun": true])
    return Int(answer?["sendable"]?.numberValue ?? answer?["sent"]?.numberValue ?? 0)
  }

  func sendNow(_ id: String) async throws { try await post(["action": "sendNow", "campaignId": id]) }

  func followUpCount(_ id: String) async throws -> Int {
    let answer = try await post(["action": "followUp", "campaignId": id, "dryRun": true])
    return Int(answer?["sendable"]?.numberValue ?? answer?["sent"]?.numberValue ?? 0)
  }

  func followUp(_ id: String) async throws { try await post(["action": "followUp", "campaignId": id]) }
  func cancel(_ id: String) async throws { try await post(["action": "cancel", "campaignId": id]) }
  func rename(_ id: String, _ name: String) async throws { try await post(["action": "update", "campaignId": id, "displayName": name]) }

  func proofOptions() async throws -> Proofs {
    let answer = try await post(["action": "proofOptions"])
    return Proofs(
      recipients: (answer?["recipients"]?.arrayValue ?? []).compactMap { $0.stringValue ?? $0["email"]?.stringValue },
      personas: (answer?["personas"]?.arrayValue ?? []).compactMap { entry in
        guard let email = entry["email"]?.stringValue else { return nil }
        return (email, entry["name"]?.stringValue ?? email)
      })
  }

  func test(_ message: [String: Any?], to: String, persona: String?) async throws {
    var all = message
    all["action"] = "test"
    all["to"] = to
    all["personaEmail"] = persona
    try await post(all)
  }

  @discardableResult
  func compose(_ action: String, _ message: [String: Any?]) async throws -> String? {
    var all = message
    all["action"] = action
    return try await post(all)?["campaignId"]?.stringValue
  }
}
