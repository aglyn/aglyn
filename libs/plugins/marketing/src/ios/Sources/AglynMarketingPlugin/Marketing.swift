// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import Foundation

/*
 * A SITE'S MARKETING, AS THE CONSOLE READS AND WRITES IT (the Kotlin plugin's
 * `Marketing.kt`). Campaigns are `orgs/{orgId}/emailCampaigns`, the site's
 * by the `visibleTo` scope the rules read; their sends are
 * `orgs/{orgId}/campaigns`. Overlays and A/B tests are the site's own
 * `overlays` and `experiments`, and every write to them re-renders the site
 * (`publishSiteWideChange`), as the console's `writeSiteWideChange` does.
 */

enum MarketingSection: String, CaseIterable, Identifiable, Hashable {
  case overview, campaigns, conversions, overlays, experiments
  var id: String { rawValue }
  var screen: String { "marketing.\(rawValue)" }

  var label: String {
    switch self {
    case .experiments: "A/B testing"
    default: rawValue.capitalized
    }
  }

  var symbol: String {
    switch self {
    case .overview: "chart.bar"
    case .campaigns: "megaphone"
    case .conversions: "target"
    case .overlays: "rectangle.on.rectangle"
    case .experiments: "flask"
    }
  }
}

let campaignManageRoute = "/api/campaigns/manage"

func siteScopeTokens(_ hostID: String) -> [String] { ["org", "host:\(hostID)"] }

/// `campaignContainerSearchFields`: the name's key and word prefixes (no reversed key).
func campaignSearchFields(_ name: String) -> [String: Any] {
  ["name": name, "nameLower": nameSearchKey(name), "nameTokens": nameSearchTokens(name)]
}

func campaignsQuery(orgID: String, hostID: String, search: String, limit: Int) -> FirestoreQuery {
  let typed = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return planListQuery(
    ContractValues.shared.nativeSiteCampaignsQuery,
    ListQueryRequest(
      base: [ListQueryFilter(op: .arrayContainsAny, path: "visibleTo", value: .array(siteScopeTokens(hostID).map { .string($0) }))],
      clauses: typed.isEmpty ? [] : [ListFilterRequest(field: "name", op: "startsWith", value: typed)])
  ).firestoreQuery(["orgs", orgID, "emailCampaigns"], limit: limit)
}

func campaignEmailsQuery(orgID: String, hostID: String, campaignID: String, limit: Int) -> FirestoreQuery {
  planListQuery(
    ContractValues.shared.campaignEmailsQuery,
    ListQueryRequest(
      base: [
        ListQueryFilter(op: .equal, path: "emailCampaignId", value: .string(campaignID)),
        ListQueryFilter(op: .equal, path: "hostId", value: .string(hostID)),
      ], clauses: [])
  ).firestoreQuery(["orgs", orgID, "campaigns"], limit: limit)
}

func experimentsQuery(_ hostID: String, search: String, limit: Int) -> FirestoreQuery {
  let words = search.trimmingCharacters(in: .whitespacesAndNewlines)
  return planListQuery(ContractValues.shared.experimentListQuery, ListQueryRequest(clauses: [], search: words.isEmpty ? nil : [words]))
    .firestoreQuery(["hosts", hostID, "experiments"], limit: limit)
}

func millis(_ value: Any?) -> Int64? { epochMillis(value) }
func dateOf(_ value: Any?) -> Date? { epochMillis(value).map { Date(timeIntervalSince1970: Double($0) / 1000) } }
func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

// MARK: Campaigns

enum CampaignWindow: String { case undated, upcoming, running, ended }

/// `campaignWindowState`, the console's rule.
func campaignWindowState(startAtMs: Int64?, endAtMs: Int64?, nowMs: Int64) -> CampaignWindow {
  if startAtMs == nil && endAtMs == nil { return .undated }
  if let start = startAtMs, nowMs < start { return .upcoming }
  if let end = endAtMs, nowMs > end { return .ended }
  return .running
}

extension CampaignWindow {
  var label: String {
    switch self {
    case .undated: "No dates"
    case .upcoming: "Upcoming"
    case .running: "Running"
    case .ended: "Ended"
    }
  }
}

struct CampaignRow: Identifiable, Equatable {
  let id: String
  let name: String
  let startAtMs: Int64?
  let endAtMs: Int64?
  let listIDs: [String]
  let topicID: String?
  let listUnsubscribe: Bool
  var window: CampaignWindow { campaignWindowState(startAtMs: startAtMs, endAtMs: endAtMs, nowMs: nowMs()) }
}

func campaignRow(_ doc: FirestoreDocument) -> CampaignRow {
  CampaignRow(
    id: doc.id, name: doc.string("name").flatMap { $0.isEmpty ? nil : $0 } ?? doc.id, startAtMs: millis(doc.data["startAtMs"]),
    endAtMs: millis(doc.data["endAtMs"]), listIDs: doc.data["listIds"] as? [String] ?? [], topicID: doc.string("topicId"),
    listUnsubscribe: doc.bool("listUnsubscribe") ?? true)
}

/// What a campaign's sends add up to (`campaignRollup`): only sends that went out count.
struct CampaignRollup: Equatable {
  var emails = 0
  var sending = 0
  var scheduled = 0
  var sent = 0
  var opens = 0
  var clicks = 0
}

func campaignRollups(_ sends: [FirestoreDocument]) -> [String: CampaignRollup] {
  var out: [String: CampaignRollup] = [:]
  for send in sends {
    guard let campaign = send.string("emailCampaignId") else { continue }
    var rollup = out[campaign] ?? CampaignRollup()
    rollup.emails += 1
    let status = send.string("status") ?? ""
    if status == "sending" { rollup.sending += 1 }
    if status == "scheduled" { rollup.scheduled += 1 }
    let stats = send.data["stats"] as? [String: Any]
    let sent = (stats?["sent"] as? NSNumber)?.intValue ?? 0
    if sent > 0 {
      rollup.sent += sent
      rollup.opens += (stats?["opens"] as? NSNumber)?.intValue ?? 0
      rollup.clicks += (stats?["clicks"] as? NSNumber)?.intValue ?? 0
    }
    out[campaign] = rollup
  }
  return out
}

// MARK: Overlays

struct OverlayRow: Identifiable, Equatable {
  let id: String
  let kind: String
  let name: String?
  let enabled: Bool
  let order: Int
  let startAtMs: Int64?
  let endAtMs: Int64?
  let impressions: Int
  let clicks: Int
  let data: [String: Any]

  var title: String {
    if let name, !name.isEmpty { return name }
    if kind == "bar" { return (data["bar"] as? [String: Any])?["text"] as? String ?? "Announcement bar" }
    return (data["popup"] as? [String: Any])?["headline"] as? String ?? "Popup"
  }

  static func == (a: OverlayRow, b: OverlayRow) -> Bool {
    a.id == b.id && a.enabled == b.enabled && a.order == b.order && a.title == b.title && a.startAtMs == b.startAtMs && a.endAtMs == b.endAtMs
  }
}

func overlayRow(_ doc: FirestoreDocument) -> OverlayRow {
  let stats = doc.data["stats"] as? [String: Any]
  return OverlayRow(
    id: doc.id, kind: doc.string("kind") ?? "bar", name: doc.string("name"), enabled: doc.bool("enabled") != false,
    order: doc.int("order") ?? 0, startAtMs: millis(doc.data["startAtMs"]), endAtMs: millis(doc.data["endAtMs"]),
    impressions: (stats?["impressions"] as? NSNumber)?.intValue ?? 0, clicks: (stats?["clicks"] as? NSNumber)?.intValue ?? 0,
    data: doc.data)
}

/// `overlayStatus`, the console's rule: off, else live inside its window, else scheduled.
func overlayStatus(enabled: Bool, startAtMs: Int64?, endAtMs: Int64?, nowMs: Int64) -> String {
  if !enabled { return "off" }
  let before = startAtMs.map { nowMs < $0 } ?? false
  let after = endAtMs.map { nowMs > $0 } ?? false
  return !before && !after ? "live" : "scheduled"
}

// MARK: Experiments

struct VariantRow: Identifiable, Equatable {
  let id: String
  let name: String?
  let weight: Double?
}

struct ExperimentRow: Identifiable, Equatable {
  let id: String
  let name: String
  let status: String
  let target: String
  let screenID: String?
  let variants: [VariantRow]
  let winnerVariantID: String?
  let goalEvent: String?
}

func experimentRow(_ doc: FirestoreDocument) -> ExperimentRow {
  ExperimentRow(
    id: doc.id, name: doc.string("name") ?? doc.id, status: doc.string("status") ?? "draft", target: doc.string("target") ?? "screen",
    screenID: doc.string("screenId"),
    variants: (doc.data["variants"] as? [[String: Any]] ?? []).compactMap { v in
      guard let id = v["id"] as? String else { return nil }
      return VariantRow(id: id, name: v["name"] as? String, weight: (v["weight"] as? NSNumber)?.doubleValue)
    },
    winnerVariantID: doc.string("winnerVariantId"), goalEvent: (doc.data["goal"] as? [String: Any])?["event"] as? String)
}

func experimentStatusLabel(_ status: String) -> String {
  switch status {
  case "running": "Running"
  case "paused": "Paused"
  case "done": "Done"
  default: "Draft"
  }
}

/// `validateExperiment`, the console's rule, over the fields the native editor sets.
func validateExperiment(
  name: String, target: String, screenID: String?, nodeID: String?, variantIDs: [String], autoWinner: (minExposures: Double, confidence: Double)? = nil
) -> String? {
  if name.trimmingCharacters(in: .whitespaces).isEmpty { return "Name the experiment" }
  if !["screen", "section", "email"].contains(target) { return "Pick what the experiment tests" }
  if variantIDs.count < 2 { return "Add at least two variants" }
  if variantIDs.count > 4 { return "Experiments are capped at 4 variants" }
  if Set(variantIDs).count != variantIDs.count { return "Variant ids must be unique" }
  if target == "section" && (nodeID ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
    return "Section experiments need the canvas element id"
  }
  if (target == "screen" || target == "section") && (screenID ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
    return "Pick the page under test"
  }
  if let auto = autoWinner {
    if !auto.minExposures.isFinite || auto.minExposures < 1 { return "Auto-winner needs a minimum exposure count of at least 1" }
    if !auto.confidence.isFinite || auto.confidence <= 0.5 || auto.confidence >= 1 { return "Auto-winner confidence must be between 0.5 and 1" }
  }
  return nil
}

struct VariantComparison: Equatable {
  let lift: Double?
  let confidence: Double?
}

struct VariantSummary: Equatable {
  let exposures: Double
  let conversions: Double
  let rate: Double
}

struct ExperimentResult: Equatable {
  let variant: VariantRow
  let summary: VariantSummary
  let comparison: VariantComparison?
  let leader: Bool
  let winner: Bool
}

func summarizeVariantStats(_ stats: [String: Any]?) -> VariantSummary {
  let exposures = max(0, (stats?["exposures"] as? NSNumber)?.doubleValue ?? 0)
  let conversions = max(0, (stats?["conversions"] as? NSNumber)?.doubleValue ?? 0)
  return VariantSummary(exposures: exposures, conversions: conversions, rate: exposures > 0 ? conversions / exposures : 0)
}

/// Abramowitz–Stegun erf, as the console computes it.
private func erf(_ x: Double) -> Double {
  let sign: Double = x < 0 ? -1 : 1
  let t = 1 / (1 + 0.3275911 * abs(x))
  let y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x)
  return sign * y
}

func compareVariants(_ control: [String: Any]?, _ challenger: [String: Any]?) -> VariantComparison {
  let a = summarizeVariantStats(control)
  let b = summarizeVariantStats(challenger)
  let lift: Double? = a.rate > 0 ? (b.rate - a.rate) / a.rate : nil
  if a.exposures < 1 || b.exposures < 1 || a.conversions + b.conversions < 1 { return VariantComparison(lift: lift, confidence: nil) }
  let pooled = (a.conversions + b.conversions) / (a.exposures + b.exposures)
  let standardError = (pooled * (1 - pooled) * (1 / a.exposures + 1 / b.exposures)).squareRoot()
  if !standardError.isFinite || standardError == 0 { return VariantComparison(lift: lift, confidence: nil) }
  let z = (b.rate - a.rate) / standardError
  return VariantComparison(lift: lift, confidence: 0.5 * (1 + erf(z / 2.0.squareRoot())))
}

/// `experimentResultRows`: each variant's figures, its comparison with the control, and whether it leads or won.
func experimentResultRows(variants: [VariantRow], winnerVariantID: String?, stats: [String: [String: Any]]) -> [ExperimentResult] {
  let summaries = variants.map { summarizeVariantStats(stats[$0.id]) }
  let control = variants.first
  return variants.enumerated().map { index, variant in
    let summary = summaries[index]
    return ExperimentResult(
      variant: variant, summary: summary,
      comparison: index > 0 && control != nil ? compareVariants(stats[control!.id], stats[variant.id]) : nil,
      leader: summary.exposures > 0 && summaries.allSatisfy { summary.rate >= $0.rate }, winner: winnerVariantID == variant.id)
  }
}

/// `describeVariantComparison`: `+12% · 97% conf.`, `—` for a lift a zero control cannot express, `needs data`, `control`.
func describeVariantComparison(_ comparison: VariantComparison?) -> String {
  guard let comparison else { return "control" }
  let lift = comparison.lift.map { "\($0 >= 0 ? "+" : "")\(jsFixed0($0 * 100))%" } ?? "—"
  let confidence = comparison.confidence.map { " · \(jsFixed0($0 * 100))% conf." } ?? " · needs data"
  return "\(lift)\(confidence)"
}

/// `Number.prototype.toFixed(0)`: half away from zero.
func jsFixed0(_ value: Double) -> String {
  let rounded = (abs(value) + 0.5).rounded(.down) * (value < 0 ? -1 : 1)
  return rounded == 0 ? "0" : String(Int64(rounded))
}

// MARK: Writes

/// The Marketing writes, as the console makes them.
struct MarketingActions {
  let context: NativePluginContext
  let orgID: String
  let hostID: String

  private func siteWide() async {
    await publishSiteWideChange(api: context.api, reader: context.firestore, hostID: hostID)
  }

  func createCampaign(name: String, startAtMs: Int64?, endAtMs: Int64?, listIDs: [String], topicID: String) async throws {
    var fields = campaignSearchFields(name)
    if let startAtMs { fields["startAtMs"] = startAtMs }
    if let endAtMs { fields["endAtMs"] = endAtMs }
    fields["listIds"] = listIDs
    if !topicID.isEmpty { fields["topicId"] = topicID }
    fields["visibleTo"] = ["host:\(hostID)"]
    fields["createdAtMs"] = nowMs()
    fields["createdBy"] = context.uid
    try await context.writer.merge(["orgs", orgID, "emailCampaigns", newResourceID()], fields)
  }

  func updateCampaign(
    _ id: String, name: String, startAtMs: Int64?, endAtMs: Int64?, listIDs: [String], topicID: String, listUnsubscribe: Bool
  ) async throws {
    var fields = campaignSearchFields(name)
    fields["startAtMs"] = startAtMs.map { $0 as Any } ?? NSNull()
    fields["endAtMs"] = endAtMs.map { $0 as Any } ?? NSNull()
    fields["listIds"] = listIDs
    fields["topicId"] = topicID.isEmpty ? FirestoreSentinel.delete as Any : topicID as Any
    fields["listUnsubscribe"] = listUnsubscribe
    try await context.writer.merge(["orgs", orgID, "emailCampaigns", id], fields)
  }

  func deleteCampaign(_ id: String) async throws {
    _ = try await context.api.request(
      campaignManageRoute, method: .post, body: jsonBody(["action": "deleteCampaign", "campaignId": id, "hostId": hostID]))
  }

  /// A save replaces the overlay whole, as the console's does.
  func saveOverlay(_ id: String?, _ fields: [String: Any]) async throws {
    var all = fields
    all["updatedAt"] = Date()
    if id == nil { all["createdAt"] = Date() }
    try await context.firestore.setDocument(["hosts", hostID, "overlays", id ?? newResourceID()], all, merge: false)
    await siteWide()
  }

  func toggleOverlay(_ row: OverlayRow) async throws {
    try await context.writer.merge(["hosts", hostID, "overlays", row.id], ["enabled": !row.enabled])
    await siteWide()
  }

  func swapOverlays(_ a: OverlayRow, _ b: OverlayRow) async throws {
    try await context.writer.merge(["hosts", hostID, "overlays", a.id], ["order": b.order])
    try await context.writer.merge(["hosts", hostID, "overlays", b.id], ["order": a.order])
    await siteWide()
  }

  func deleteOverlay(_ id: String) async throws {
    try await context.firestore.deleteDocument(["hosts", hostID, "overlays", id])
    await siteWide()
  }

  func saveExperiment(_ id: String?, _ fields: [String: Any]) async throws {
    var all = fields
    let name = fields["name"] as? String ?? ""
    for (key, value) in nameSearchFields(name) { all[key] = value }
    all["updatedAt"] = Date()
    if id == nil { all["createdAt"] = Date() }
    try await context.writer.merge(["hosts", hostID, "experiments", id ?? newResourceID()], all)
    await siteWide()
  }

  /// Starting refuses when another experiment already runs on the same page, as the console checks.
  func setExperimentStatus(_ row: ExperimentRow, _ status: String, winner: String? = nil) async throws {
    if status == "running", row.target != "email", let screen = row.screenID {
      let others = try await firstPage(
        FirestoreQuery(["hosts", hostID, "experiments"], equals: [("status", "running"), ("screenId", screen)], limit: 2))
      if others.contains(where: { $0.id != row.id }) {
        throw ConsoleAPIError(status: 409, message: "Another experiment is already running on this page. Pause it first.")
      }
    }
    var fields: [String: Any] = ["status": status, "updatedAt": Date()]
    if let winner { fields["winnerVariantId"] = winner }
    try await context.writer.merge(["hosts", hostID, "experiments", row.id], fields)
    await siteWide()
  }

  func deleteExperiment(_ id: String) async throws {
    try await context.firestore.deleteDocument(["hosts", hostID, "experiments", id])
    await siteWide()
  }

  /// One read of a query (a listener's first answer).
  @MainActor
  func firstPage(_ query: FirestoreQuery) async throws -> [FirestoreDocument] {
    try await withCheckedThrowingContinuation { continuation in
      var registration: FirestoreListening?
      var done = false
      registration = context.firestore.listen(query) { result in
        guard !done else { return }
        done = true
        registration?.remove()
        continuation.resume(with: result)
      }
      if done { registration?.remove() }
    }
  }
}
