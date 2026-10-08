// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

// A SITE'S AUTOMATION AND ITS ORGANIZATION'S, as the console's Automation page
// reads and writes them (libs/plugins/workflows/src/lib/components). Reads are
// the console's own queries under the same rules; a create goes through
// `/api/hosts/resources` (the quota gate), an org automation through
// `/api/automations/manage`, a site's pause through `/api/automations/pause`,
// a test run through `/api/automations/actions/test-run`; an edit, a switch and
// a delete of a site's own workflow, action or webhook are the console's own
// merge writes. The Kotlin plugin is the same contract.

enum AutomationRoutes {
  static let hostResources = "/api/hosts/resources"
  static let whereUsed = "/api/hosts/where-used"
  static let testRun = "/api/automations/actions/test-run"
  static let manage = "/api/automations/manage"
  static let pause = "/api/automations/pause"
  static let entitlements = "/api/orgs/entitlements"
}

/// The windows the console reads whole (`collectionCeiling`).
enum AutomationCeilings {
  static let workflows = 100
  static let actions = 100
  static let webhooks = 20
  static let editorOptions = 100
  static let orgAutomations = orgAutomationsMax
  /// The org hub's site lists: five sites open, up to 25, ten rows each.
  static let orgSitesOpen = 5
  static let orgSitesMax = 25
  static let orgSiteRows = 10
}

enum AutomationPaths {
  static func workflows(_ hostID: String) -> [String] { ["hosts", hostID, "workflows"] }
  static func actions(_ hostID: String) -> [String] { ["hosts", hostID, "actions"] }
  static func webhooks(_ hostID: String) -> [String] { ["hosts", hostID, "webhooks"] }
  static func activity(_ hostID: String) -> [String] { ["hosts", hostID, "activity"] }
  static func functions(_ hostID: String) -> [String] { ["hosts", hostID, "functions"] }
  static func variables(_ hostID: String) -> [String] { ["hosts", hostID, "variables"] }
  static func forms(_ hostID: String) -> [String] { ["hosts", hostID, "forms"] }
  static func overlays(_ hostID: String) -> [String] { ["hosts", hostID, "overlays"] }
  static func host(_ hostID: String) -> [String] { ["hosts", hostID] }
  static func orgAutomations(_ orgID: String) -> [String] { ["orgs", orgID, "automations"] }
  static func datasets(_ orgID: String) -> [String] { ["orgs", orgID, "datasets"] }
  static func lists(_ orgID: String) -> [String] { ["orgs", orgID, "lists"] }
  static func campaigns(_ orgID: String) -> [String] { ["orgs", orgID, "emailCampaigns"] }
  static func memberships(_ uid: String) -> [String] { ["users", uid, "hostMemberships"] }
  static func orgMembership(_ uid: String, _ orgID: String) -> [String] { ["users", uid, "orgs", orgID] }
  /// The month's run counter: the workspace's, else (no workspace) the site's.
  static func counter(orgID: String?, hostID: String?, _ name: String) -> [String]? {
    if let orgID, !orgID.isEmpty { return ["orgs", orgID, "counters", name] }
    if let hostID { return ["hosts", hostID, "counters", name] }
    return nil
  }
}

/// The scope tokens a site's reads ask for: the org's and the site's own.
func scopeTokens(forHost hostID: String) -> [String] { ["org", "host:\(hostID)"] }

enum AutomationQueries {
  private static let id = ContractValues.shared.listQueryIdPath

  /// A ceilinged window: document-id order, the ceiling plus a probe row.
  static func ceiling(_ collection: [String], _ ceiling: Int, filters: [ListQueryConstraint] = [], metadata: Bool = false)
    -> FirestoreQuery
  {
    FirestoreQuery(collection, filters: filters, order: [.init(id)], limit: ceiling + 1, includeMetadataChanges: metadata)
  }

  static func workflows(_ hostID: String) -> FirestoreQuery {
    ceiling(AutomationPaths.workflows(hostID), AutomationCeilings.workflows, metadata: true)
  }

  static func actions(_ hostID: String) -> FirestoreQuery {
    ceiling(AutomationPaths.actions(hostID), AutomationCeilings.actions, metadata: true)
  }

  static func webhooks(_ hostID: String) -> FirestoreQuery {
    ceiling(AutomationPaths.webhooks(hostID), AutomationCeilings.webhooks)
  }

  /// Every live org automation: `deletedAt == null` by id, the most an org holds plus a probe.
  static func orgAutomations(_ orgID: String) -> FirestoreQuery {
    FirestoreQuery(
      AutomationPaths.orgAutomations(orgID), equals: [("deletedAt", NSNull())], order: [.init(id)],
      limit: AutomationCeilings.orgAutomations + 1)
  }

  /// The org automations placed on a site (`visibleTo` holds the org's token or the site's).
  static func orgAutomationsOnSite(_ orgID: String, hostID: String) -> FirestoreQuery {
    FirestoreQuery(
      AutomationPaths.orgAutomations(orgID), equals: [("deletedAt", NSNull())],
      filters: [ListQueryConstraint(path: "visibleTo", op: .arrayContainsAny, value: scopeTokens(forHost: hostID))],
      limit: AutomationCeilings.orgAutomations + 1)
  }

  /// One site's rows in the org hub's lists.
  static func orgSiteRows(_ hostID: String, kind: OrgSiteKind) -> FirestoreQuery {
    ceiling(["hosts", hostID, kind.rawValue], AutomationCeilings.orgSiteRows)
  }

  static func datasets(_ orgID: String, hostID: String?) -> FirestoreQuery {
    ceiling(
      AutomationPaths.datasets(orgID), AutomationCeilings.editorOptions,
      filters: hostID.map { [ListQueryConstraint(path: "visibleTo", op: .arrayContainsAny, value: scopeTokens(forHost: $0))] }
        ?? [])
  }

  static func campaigns(_ orgID: String, hostID: String?) -> FirestoreQuery {
    ceiling(
      AutomationPaths.campaigns(orgID), AutomationCeilings.editorOptions,
      filters: hostID.map { [ListQueryConstraint(path: "visibleTo", op: .arrayContainsAny, value: scopeTokens(forHost: $0))] }
        ?? [])
  }

  static func memberships(_ uid: String, orgID: String) -> FirestoreQuery {
    FirestoreQuery(
      AutomationPaths.memberships(uid), equals: [("orgId", orgID)], order: [.init("nameLower")],
      limit: WorkspaceStore.siteWindow)
  }
}

/// A ceilinged read: at most `ceiling` rows, and whether the ceiling bit.
func ceilinged(_ docs: [FirestoreDocument]?, _ ceiling: Int) -> (rows: [FirestoreDocument], truncated: Bool) {
  let rows = docs ?? []
  return (Array(rows.prefix(ceiling)), rows.count > ceiling)
}

/// Whether a stored `deletedAt` marks a document deleted (anything but absent or null).
func isDeleted(_ data: [String: Any]) -> Bool {
  guard let value = data["deletedAt"] else { return false }
  return !(value is NSNull)
}

/// `a.name.localeCompare(b.name)`.
func byName(_ a: String, _ b: String) -> Bool { a.localizedCompare(b) == .orderedAscending }

/// Step labels joined as the lists caption them: `Send an email → Wait`.
func stepLabels(_ steps: [Any]?) -> String {
  (steps ?? []).map { step in
    let type = (step as? [String: Any])?["type"] as? String ?? ""
    return hostActionStepLabel(type) ?? type
  }.joined(separator: " → ")
}

// MARK: - Rows

struct WorkflowRow: Identifiable, Equatable {
  let id: String
  let name: String
  let data: [String: Any]

  init(_ doc: FirestoreDocument) {
    id = doc.id
    data = doc.data
    name = doc.data["name"] as? String ?? ""
  }

  var steps: [Any] { data["steps"] as? [Any] ?? [] }
  var triggerEvent: String? { ((data["trigger"] as? [String: Any])?["event"] as? String).flatMap { $0.isEmpty ? nil : $0 } }

  /// `2 steps · on Form submitted · double → quote`.
  var caption: String {
    let count = steps.count
    let names = steps.map { (($0 as? [String: Any])?["functionName"] as? String) ?? "" }.joined(separator: " → ")
    return "\(count) step\(count == 1 ? "" : "s")\(triggerEvent.map { " · on \(hostEventLabel($0))" } ?? "") · \(names)"
  }

  static func == (a: Self, b: Self) -> Bool { a.id == b.id && a.caption == b.caption && a.name == b.name }
}

/// The site's workflows as the console lists them: live ones, by name.
func visibleWorkflows(_ docs: [FirestoreDocument]) -> [WorkflowRow] {
  docs.filter { !isDeleted($0.data) }.map(WorkflowRow.init).sorted { byName($0.name, $1.name) }
}

struct ActionRow: Identifiable {
  let id: String
  let name: String
  let data: [String: Any]

  init(_ doc: FirestoreDocument) {
    id = doc.id
    data = doc.data
    name = doc.data["name"] as? String ?? ""
  }

  var enabled: Bool { !looseIsFalseValue(data["enabled"]) }
  var event: String { ((data["trigger"] as? [String: Any])?["event"] as? String) ?? "" }
  var caption: String { "on \(hostEventLabel(event)) · \(stepLabels(data["steps"] as? [Any]))" }
  var placeholders: [InteractionPlaceholder] { interactionPlaceholders(data) }
  var testable: Bool { isSiteEventType(event) }
}

/// `1 placeholder to fill in` / `3 placeholders to fill in`.
func placeholderLine(_ count: Int) -> String? {
  count == 0 ? nil : count == 1 ? "1 placeholder to fill in" : "\(count) placeholders to fill in"
}

/// The site's actions as the console lists them: live ones, element interactions apart, by name.
func visibleActions(_ docs: [FirestoreDocument]) -> (rows: [ActionRow], elementInteractions: Int) {
  let live = docs.filter { !isDeleted($0.data) }
  let element = live.filter { isElementInteraction($0.data) }
  let rows = live.filter { !isElementInteraction($0.data) }.map(ActionRow.init).sorted { byName($0.name, $1.name) }
  return (rows, element.count)
}

/// The element-interaction sentence under the actions list.
func elementInteractionLine(_ count: Int) -> String? {
  guard count > 0 else { return nil }
  let lead = count == 1 ? "1 interaction is set up on its own element — " : "\(count) interactions are set up on their own elements — "
  return lead
    + "open the element in the besigner to edit it. Interactions belong to the page they are on, so they publish and roll back with it."
}

/// `"Welcome" still has 2 placeholders to fill in: …` — the switch-on confirm.
func placeholderConfirmMessage(name: String, _ missing: [InteractionPlaceholder]) -> String {
  let count = missing.count
  let listed = missing.prefix(3).map(describeInteractionPlaceholder).joined(separator: "; ")
  return "\"\(name)\" still has \(count == 1 ? "a placeholder" : "\(count) placeholders") to fill in: \(listed)"
    + "\(count > 3 ? "; …" : ""). Open it with Edit to fill \(count == 1 ? "it" : "them") in first."
}

struct WebhookRow: Identifiable {
  let id: String
  let name: String
  let inbound: Bool
  let url: String
  let workflowName: String
  let secret: String

  init(_ doc: FirestoreDocument) {
    id = doc.id
    name = doc.data["name"] as? String ?? ""
    inbound = doc.data["direction"] as? String == "inbound"
    url = doc.data["url"] as? String ?? ""
    workflowName = doc.data["workflowName"] as? String ?? ""
    secret = doc.data["secret"] as? String ?? ""
  }

  /// The inbound endpoint a caller posts to.
  func endpoint(siteBase: String, hostID: String) -> String { "\(siteBase)/api/hooks/\(hostID)/\(id)" }

  func caption(siteBase: String, hostID: String) -> String {
    inbound ? "inbound · \(endpoint(siteBase: siteBase, hostID: hostID)) → \(workflowName)" : "outbound · \(url)"
  }
}

func visibleWebhooks(_ docs: [FirestoreDocument]) -> [WebhookRow] {
  docs.filter { !isDeleted($0.data) }.map(WebhookRow.init).sorted { byName($0.name, $1.name) }
}

/// `WEBHOOK_URL_PATTERN`: a public https address.
func isPublicWebhookURL(_ text: String) -> Bool {
  text.range(
    of: #"^https://(?!localhost)(?!127\.)(?!0\.)(?!10\.)(?!172\.(1[6-9]|2\d|3[01])\.)(?!192\.168\.)(?!169\.254\.)[^\s]+$"#,
    options: [.regularExpression, .caseInsensitive]) != nil
}

struct OrgAutomationRow: Identifiable {
  let id: String
  let name: String
  let data: [String: Any]

  init(_ doc: FirestoreDocument) {
    id = doc.id
    data = doc.data
    name = doc.data["name"] as? String ?? ""
  }

  var enabled: Bool { !looseIsFalseValue(data["enabled"]) }
  var event: String { ((data["trigger"] as? [String: Any])?["event"] as? String) ?? "" }
  var caption: String { "on \(hostEventLabel(event)) · \(stepLabels(data["steps"] as? [Any]))" }
  var visibleTo: [String] { (data["visibleTo"] as? [Any] ?? []).compactMap { $0 as? String } }
  var orgWide: Bool { visibleTo.contains("org") }
  var placedHostIDs: [String] { visibleTo.compactMap { $0.hasPrefix("host:") ? String($0.dropFirst(5)) : nil } }
  var pausedHostIDs: [String] { orgAutomationPausedHostIDs(data) }
}

func sortedOrgAutomations(_ docs: [FirestoreDocument]) -> [OrgAutomationRow] {
  docs.prefix(AutomationCeilings.orgAutomations).map(OrgAutomationRow.init).sorted { byName($0.name, $1.name) }
}

/// The sites an org automation runs on: every site of the org, or the ones it names.
func placedSites(_ row: OrgAutomationRow, sites: [WorkspaceSite]) -> [String] {
  row.orgWide ? sites.map(\.id) : row.placedHostIDs
}

func siteName(_ hostID: String, _ sites: [WorkspaceSite]) -> String {
  sites.first { $0.id == hostID }.map { $0.name.isEmpty ? $0.subdomain.isEmpty ? $0.id : $0.subdomain : $0.name } ?? hostID
}

/// `Runs on every site` / `Runs on A, B` / `Runs on no site`.
func placementLine(_ row: OrgAutomationRow, sites: [WorkspaceSite]) -> String {
  if row.orgWide { return "Runs on every site" }
  let names = row.placedHostIDs.map { siteName($0, sites) }
  return names.isEmpty ? "Runs on no site" : "Runs on \(names.joined(separator: ", "))"
}

/// An org automation's chip on a site's panel.
func orgAutomationSiteChip(_ row: OrgAutomationRow, hostID: String) -> (String, AglynToneName) {
  if !row.enabled { return ("Switched off", .neutral) }
  if row.pausedHostIDs.contains(hostID) { return ("Paused here", .warning) }
  return ("Runs here", .success)
}

/// A tone, named in the model so it is testable without the UI kit.
enum AglynToneName: Equatable { case neutral, success, warning, error, info }

/// `value === false`.
func looseIsFalseValue(_ value: Any?) -> Bool {
  guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return false }
  return !number.boolValue
}

// MARK: - Org hub site lists

enum OrgSiteKind: String, CaseIterable {
  case workflows, actions, webhooks

  var header: String {
    switch self {
    case .workflows: "Workflows on every site"
    case .actions: "Actions on every site"
    case .webhooks: "Webhooks on every site"
    }
  }

  var noun: String {
    switch self {
    case .workflows: "workflow"
    case .actions: "action"
    case .webhooks: "webhook"
    }
  }

  var intro: String {
    switch self {
    case .workflows:
      "Every site’s workflows, side by side. A workflow calls its own site’s functions and variables, so it is built and edited in that site’s Automation."
    case .actions:
      "Every site’s own actions, side by side. To run one automation on several sites, make it an org automation instead."
    case .webhooks:
      "Every site’s webhooks, side by side. A webhook holds its site’s address and secret, so it is managed in that site’s Automation."
    }
  }
}

struct OrgSiteRow: Identifiable {
  let id: String
  let name: String
  let trigger: String
  let status: String
}

/// One site's rows in an org hub list: live ones (actions without element interactions).
func orgSiteRows(_ docs: [FirestoreDocument], kind: OrgSiteKind) -> (rows: [OrgSiteRow], truncated: Bool) {
  let (window, truncated) = ceilinged(docs, AutomationCeilings.orgSiteRows)
  let rows = window.filter { !isDeleted($0.data) && !(kind == .actions && isElementInteraction($0.data)) }.map { doc in
    let name = (doc.data["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? doc.id
    let trigger: String
    switch kind {
    case .webhooks: trigger = doc.data["direction"] as? String == "inbound" ? "Inbound" : "Outbound"
    default:
      let event = ((doc.data["trigger"] as? [String: Any])?["event"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      trigger = event.map(hostEventLabel) ?? (kind == .workflows ? "Run by other automations" : "—")
    }
    let status = kind == .workflows ? "Ready" : looseIsFalseValue(doc.data["enabled"]) ? "Off" : "On"
    return OrgSiteRow(id: doc.id, name: name, trigger: trigger, status: status)
  }
  return (rows, truncated)
}

// MARK: - Run history

enum RunResult: String, CaseIterable, Identifiable {
  case succeeded, failed, skipped
  var id: String { rawValue }
  var label: String {
    switch self {
    case .succeeded: "Succeeded"
    case .failed: "Failed"
    case .skipped: "Skipped"
    }
  }
}

struct RunRow: Identifiable {
  let id: String
  let result: RunResult
  let trigger: String
  let triggerLabel: String
  let who: String
  let summary: String
  let durationMs: Int?
  let at: Date?

  init(_ doc: FirestoreDocument, brand: String = AglynBrand.name) {
    id = doc.id
    result = actionRunResult(doc.data).flatMap(RunResult.init(rawValue:)) ?? .succeeded
    trigger = doc.data["trigger"] as? String ?? ""
    triggerLabel = hostEventLabel(doc.data["trigger"] as? String)
    who = runTriggeredByLabel(doc.data, brand: brand)
    summary = actionRunSummary(doc.data)
    durationMs = (doc.data["durationMs"] as? NSNumber).map { Int($0.doubleValue.rounded()) }
    at = doc.data["createdAt"] as? Date
  }

  /// `What happened`, with the duration when it was recorded.
  var detail: String { durationMs.map { "\(summary) · \($0)ms" } ?? summary }
}

/// The run history's filters: a Result, a Trigger, and the search box's first word.
struct RunFilters: Equatable {
  var result: RunResult?
  var trigger: String?
  var search: String = ""

  var filtering: Bool { result != nil || trigger != nil || !search.trimmingCharacters(in: .whitespaces).isEmpty }
}

/// The run history's query: this automation's runs, newest first, a page more than shown.
func runHistoryQuery(hostID: String, targetID: String?, filters: RunFilters, pageSize: Int, page: Int) -> FirestoreQuery {
  var constraints: [ListQueryConstraint] = []
  if let targetID { constraints.append(ListQueryConstraint(path: "target.id", op: .equal, value: targetID)) }
  if let result = filters.result {
    constraints.append(ListQueryConstraint(path: "result", op: .equal, value: result.rawValue))
  } else {
    constraints.append(ListQueryConstraint(path: "result", op: .in, value: RunResult.allCases.map(\.rawValue)))
  }
  if let trigger = filters.trigger {
    constraints.append(ListQueryConstraint(path: "trigger", op: .equal, value: trigger))
  }
  let token = nameSearchToken(filters.search)
  if !token.isEmpty {
    constraints.append(ListQueryConstraint(path: "summaryTokens", op: .arrayContains, value: token))
  }
  return FirestoreQuery(
    AutomationPaths.activity(hostID), filters: constraints, order: [.init("createdAt", descending: true)],
    limit: pageSize * (page + 1) + 1)
}

// MARK: - Run quota line

enum RunCounter: String {
  case workflowRuns, actionRuns

  var label: String { self == .workflowRuns ? "workflow runs" : "action runs" }
  var limitKey: String { self == .workflowRuns ? "workflowRunsPerMonth" : "actionRunsPerMonth" }
}

/// The counter's field for this month, in UTC.
func monthKey(_ now: Date = Date()) -> String {
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone(identifier: "UTC")
  formatter.dateFormat = "yyyy-MM"
  return formatter.string(from: now)
}

func groupedNumber(_ value: Double) -> String {
  let formatter = NumberFormatter()
  formatter.locale = Locale(identifier: "en_US")
  formatter.numberStyle = .decimal
  formatter.maximumFractionDigits = 3
  return formatter.string(from: NSNumber(value: value)) ?? jsNumberString(value)
}

/// `1,284 action runs this month · 500,000 included` / `… · no monthly limit`; nil until both are known.
func runQuotaLine(counter: RunCounter, counterDoc: [String: Any]?, counterRead: Bool, limit: QuotaLimit?, now: Date = Date())
  -> String?
{
  guard counterRead, let limit else { return nil }
  let used = (counterDoc?[monthKey(now)] as? NSNumber)?.doubleValue ?? 0
  let tail: String
  switch limit {
  case .unlimited: tail = "no monthly limit"
  case .capped(let cap): tail = "\(groupedNumber(cap)) included"
  }
  return "\(groupedNumber(used)) \(counter.label) this month · \(tail)"
}

// MARK: - Entitlements

enum QuotaLimit: Equatable {
  case unlimited
  case capped(Double)

  var cap: Double? {
    if case .capped(let value) = self { return value }
    return nil
  }
}

/// What `/api/orgs/entitlements` answered: the plan's features and quotas.
struct AutomationEntitlements: Equatable {
  var orgID: String?
  var features: [String: Bool]
  var quotas: [String: QuotaLimit]

  init(orgID: String? = nil, features: [String: Bool] = [:], quotas: [String: QuotaLimit] = [:]) {
    self.orgID = orgID
    self.features = features
    self.quotas = quotas
  }

  /// A JSON body: `quotas` holds numbers, and `null` for an unlimited one (JSON has no Infinity).
  init(_ body: JSONValue?) {
    orgID = body?["orgId"]?.stringValue
    var features: [String: Bool] = [:]
    if case .object(let map)? = body?["features"] {
      for (key, value) in map { if case .bool(let flag) = value { features[key] = flag } }
    }
    var quotas: [String: QuotaLimit] = [:]
    if case .object(let map)? = body?["quotas"] {
      for (key, value) in map {
        switch value {
        case .number(let number): quotas[key] = number.isFinite ? .capped(number) : .unlimited
        case .null: quotas[key] = .unlimited
        default: break
        }
      }
    }
    self.features = features
    self.quotas = quotas
  }

  func has(_ feature: String) -> Bool { features[feature] == true }
  func quota(_ key: String) -> QuotaLimit? { quotas[key] }

  /// `checkQuota`: whether one more fits under a capped quota.
  func allows(_ key: String, used: Int) -> Bool {
    guard case .capped(let cap)? = quotas[key] else { return true }
    return Double(used) < cap
  }
}

// MARK: - Where used

struct WhereUsedResult: Equatable {
  struct Dependent: Equatable {
    let type: String
    let id: String
    let name: String
  }

  var dependents: [Dependent] = []
  var total = 0

  init(dependents: [Dependent] = [], total: Int = 0) {
    self.dependents = dependents
    self.total = total
  }

  init(_ body: JSONValue?) {
    if case .array(let list)? = body?["dependents"] {
      dependents = list.map {
        Dependent(type: $0["type"]?.stringValue ?? "", id: $0["id"]?.stringValue ?? "", name: $0["name"]?.stringValue ?? "")
      }
    }
    if case .number(let value)? = body?["total"] { total = Int(value) }
  }

  /// `2 pages, 1 variable` — a `screen` reads as a page.
  var summary: String {
    var order: [String] = []
    var counts: [String: Int] = [:]
    for dependent in dependents {
      let label = dependent.type == "screen" ? "page" : dependent.type
      if counts[label] == nil { order.append(label) }
      counts[label, default: 0] += 1
    }
    return order.map { "\(counts[$0]!) \($0)\(counts[$0]! == 1 ? "" : "s")" }.joined(separator: ", ")
  }

  func usageMessage(_ name: String) -> String {
    total > 0 ? "\"\(name)\" computes \(summary)" : "\"\(name)\" is not referenced by anything published"
  }

  func deleteMessage(_ name: String) -> String {
    total > 0
      ? "\"\(name)\" computes \(summary) — those variables will fall back to their stored values."
      : "\"\(name)\" will no longer be runnable."
  }
}

// MARK: - Bodies

enum AutomationBodies {
  static func json(_ value: Any?) -> JSONValue {
    switch value {
    case nil, is NSNull: return .null
    case let text as String: return .string(text)
    case let number as NSNumber:
      return CFGetTypeID(number) == CFBooleanGetTypeID() ? .bool(number.boolValue) : .number(number.doubleValue)
    case let date as Date: return .number(date.timeIntervalSince1970 * 1000)
    case let list as [Any]: return .array(list.map(json))
    case let map as [String: Any]: return .object(map.mapValues(json))
    default: return .null
    }
  }

  static func createWorkflow(hostID: String, fields: [String: Any]) -> JSONValue {
    ["hostId": .string(hostID), "resource": "workflow", "data": json(fields)]
  }

  static func duplicateWorkflow(hostID: String, sourceID: String, name: String, attemptKey: String) -> JSONValue {
    var body: [String: JSONValue] = [
      "hostId": .string(hostID), "resource": "workflow", "action": "duplicate", "sourceId": .string(sourceID),
      "attemptKey": .string(attemptKey),
    ]
    if !name.isEmpty { body["name"] = .string(name) }
    return .object(body)
  }

  static func createAction(hostID: String, id: String, name: String) -> JSONValue {
    ["hostId": .string(hostID), "resource": "action", "id": .string(id), "data": ["name": .string(name)]]
  }

  static func createWebhook(hostID: String, id: String, name: String, inbound: Bool, target: String, secret: String)
    -> JSONValue
  {
    var data: [String: JSONValue] = [
      "name": .string(jsSliceText(name.trimmingCharacters(in: .whitespacesAndNewlines), 60)),
      "direction": .string(inbound ? "inbound" : "outbound"), "secret": .string(secret), "enabled": true,
    ]
    data[inbound ? "workflowName" : "url"] = .string(target.trimmingCharacters(in: .whitespacesAndNewlines))
    return ["hostId": .string(hostID), "resource": "webhook", "id": .string(id), "data": .object(data)]
  }

  static func whereUsed(hostID: String, id: String, name: String) -> JSONValue {
    ["hostId": .string(hostID), "kind": "workflow", "id": .string(id), "name": .string(name)]
  }

  static func testRun(hostID: String, actionID: String) -> JSONValue {
    ["hostId": .string(hostID), "actionId": .string(actionID)]
  }

  static func pause(hostID: String, automationID: String, paused: Bool, orgID: String? = nil) -> JSONValue {
    var body: [String: JSONValue] = [
      "hostId": .string(hostID), "automationId": .string(automationID), "paused": .bool(paused),
    ]
    if let orgID { body["orgId"] = .string(orgID) }
    return .object(body)
  }

  static func manageSave(orgID: String, automationID: String?, automation: [String: Any]) -> JSONValue {
    var body: [String: JSONValue] = [
      "orgId": .string(orgID), "action": .string(automationID == nil ? "create" : "update"),
      "automation": json(automation),
    ]
    if let automationID { body["automationId"] = .string(automationID) }
    return .object(body)
  }

  static func manageEnabled(orgID: String, automationID: String, enabled: Bool) -> JSONValue {
    ["orgId": .string(orgID), "action": "setEnabled", "automationId": .string(automationID), "enabled": .bool(enabled)]
  }

  static func manageDelete(orgID: String, automationID: String) -> JSONValue {
    ["orgId": .string(orgID), "action": "delete", "automationId": .string(automationID)]
  }
}

/// `text.slice(0, n)` in UTF-16 units.
func jsSliceText(_ text: String, _ count: Int) -> String {
  String(decoding: Array(text.utf16.prefix(count)), as: UTF16.self)
}

/// The words a test run's answer reads as: its first alert, or that the server steps ran.
func testRunMessage(_ body: JSONValue?) -> String {
  if case .array(let alerts)? = body?["alerts"], let first = alerts.first {
    return "Test ran — first alert: \(first["message"]?.stringValue ?? "")"
  }
  return "Test ran — server steps executed (see Runs)"
}

/// What a refused test run says: the route's own words, else the console's for its status.
func testRunRefusal(_ error: Error) -> String {
  guard let refused = error as? ConsoleAPIError else { return "Test run failed" }
  if case .string(let text)? = refused.body?["error"], !text.isEmpty { return text }
  switch refused.status {
  case 400: return "Only an action with an in-page trigger can be tested here"
  case 403: return "Only a site admin or editor can test an action"
  case 404: return "That action no longer exists"
  case 409: return "Switch the action on to test it"
  case 429: return "Too many test runs — wait a minute and try again"
  case 500...: return "The test run could not be completed. Try again."
  default: return "Test run failed"
  }
}

/// A route's own refusal words, else the console's fallback.
func routeMessage(_ error: Error, fallback: String = "The request could not be completed") -> String {
  if let refused = error as? ConsoleAPIError, case .string(let text)? = refused.body?["error"], !text.isEmpty {
    return text
  }
  if let refused = error as? ConsoleAPIError, refused.status == 0 { return refused.message }
  return fallback
}
