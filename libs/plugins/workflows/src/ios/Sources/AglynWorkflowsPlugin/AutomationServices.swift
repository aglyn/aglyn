// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import Foundation
import Observation

/// The route calls and writes the console makes for one site's automation and its org's.
struct AutomationAPI {
  let api: ConsoleAPIClient
  let writer: FirestoreWriter

  // MARK: Workflows

  /// A new workflow through the quota-checked resources route; the new id.
  @discardableResult
  func createWorkflow(hostID: String, fields: [String: Any]) async throws -> String? {
    let body = try await api.request(
      AutomationRoutes.hostResources, method: .post, body: AutomationBodies.createWorkflow(hostID: hostID, fields: fields))
    return body?["id"]?.stringValue
  }

  /// An edit: the editor's fields as a merge, as the console's dialog writes it.
  func saveWorkflow(hostID: String, id: String, fields: [String: Any]) async throws {
    var merged = fields
    merged["updatedAt"] = Date()
    try await writer.merge(AutomationPaths.workflows(hostID) + [id], merged)
  }

  func duplicateWorkflow(hostID: String, sourceID: String, name: String, attemptKey: String) async throws -> String {
    let body = try await api.request(
      AutomationRoutes.hostResources, method: .post,
      body: AutomationBodies.duplicateWorkflow(hostID: hostID, sourceID: sourceID, name: name, attemptKey: attemptKey))
    return body?["name"]?.stringValue ?? name
  }

  /// The where-used scan; a failed scan reads as nothing found, as the console's does.
  func whereUsed(hostID: String, id: String, name: String) async -> WhereUsedResult {
    let body = try? await api.request(
      AutomationRoutes.whereUsed, method: .post, body: AutomationBodies.whereUsed(hostID: hostID, id: id, name: name))
    return WhereUsedResult(body ?? nil)
  }

  // MARK: Site documents

  /// The console's soft delete.
  func softDelete(_ path: [String]) async throws {
    try await writer.merge(path, ["deletedAt": Date()])
  }

  func setActionEnabled(hostID: String, id: String, enabled: Bool) async throws {
    try await writer.merge(AutomationPaths.actions(hostID) + [id], ["enabled": enabled])
  }

  /// Saves an action: a new one is created through the resources route first (the cap), then
  /// every field is merged as `siteInteractionDocument` writes it.
  func saveAction(hostID: String, id: String?, candidate: [String: Any]) async throws {
    let actionID = id ?? createResourceUID()
    if id == nil {
      do {
        try await api.request(
          AutomationRoutes.hostResources, method: .post,
          body: AutomationBodies.createAction(
            hostID: hostID, id: actionID, name: (candidate["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled action"))
      } catch {
        throw ConsoleAPIError(status: 0, message: routeMessage(error, fallback: "Could not create the interaction"))
      }
    }
    var document = siteInteractionDocument(candidate)
    let now = Date()
    document["updatedAt"] = now
    if id == nil { document["createdAt"] = now }
    try await writer.merge(AutomationPaths.actions(hostID) + [actionID], document)
  }

  func testAction(hostID: String, actionID: String) async throws -> String {
    testRunMessage(try await api.request(
      AutomationRoutes.testRun, method: .post, body: AutomationBodies.testRun(hostID: hostID, actionID: actionID)))
  }

  func createWebhook(hostID: String, name: String, inbound: Bool, target: String, secret: String) async throws {
    try await api.request(
      AutomationRoutes.hostResources, method: .post,
      body: AutomationBodies.createWebhook(
        hostID: hostID, id: createResourceUID(), name: name, inbound: inbound, target: target, secret: secret))
  }

  // MARK: Org automations

  func pause(hostID: String, automationID: String, paused: Bool, orgID: String? = nil) async throws {
    try await api.request(
      AutomationRoutes.pause, method: .post,
      body: AutomationBodies.pause(hostID: hostID, automationID: automationID, paused: paused, orgID: orgID))
  }

  func saveOrgAutomation(orgID: String, id: String?, automation: [String: Any]) async throws {
    try await api.request(
      AutomationRoutes.manage, method: .post,
      body: AutomationBodies.manageSave(orgID: orgID, automationID: id, automation: automation))
  }

  func setOrgAutomationEnabled(orgID: String, id: String, enabled: Bool) async throws {
    try await api.request(
      AutomationRoutes.manage, method: .post,
      body: AutomationBodies.manageEnabled(orgID: orgID, automationID: id, enabled: enabled))
  }

  func deleteOrgAutomation(orgID: String, id: String) async throws {
    try await api.request(
      AutomationRoutes.manage, method: .post, body: AutomationBodies.manageDelete(orgID: orgID, automationID: id))
  }
}

extension NativePluginContext {
  var automationAPI: AutomationAPI { AutomationAPI(api: api, writer: writer) }
}

/// The plan's automation flags and quotas, read once per site (or org) from the entitlements route.
@MainActor
@Observable
final class EntitlementsLoader {
  private(set) var value: AutomationEntitlements?
  private(set) var failed = false
  @ObservationIgnored private var key: String?

  func load(_ api: ConsoleAPIClient, hostID: String?, orgID: String?) async {
    let query: [(String, String?)] = hostID != nil ? [("hostId", hostID)] : [("orgId", orgID)]
    let key = "\(hostID ?? "")|\(orgID ?? "")"
    guard key != self.key else { return }
    self.key = key
    value = nil
    failed = false
    do {
      value = AutomationEntitlements(try await api.request(AutomationRoutes.entitlements, query: query))
    } catch {
      failed = true
      self.key = nil
    }
  }
}

/// A record a step's picker chooses from.
struct PickerOption: Identifiable, Hashable {
  let id: String
  let name: String
}

/// Everything a step can be pointed at, read when an editor opens (each window ceilinged at 100).
@MainActor
@Observable
final class AutomationPickers {
  var workflows: [PickerOption] = []
  var datasets: [PickerOption] = []
  var overlays: [PickerOption] = []
  var lists: [PickerOption] = []
  var campaigns: [PickerOption] = []
  var webhooks: [PickerOption] = []
  var forms: [PickerOption] = []
  var functions: [FirestoreDocument] = []
  var variables: [FirestoreDocument] = []
  /// The windows the ceiling cut short, in the console's words.
  var truncated: [String] = []
  var loaded = false

  private static func options(_ docs: [FirestoreDocument], where keep: (FirestoreDocument) -> Bool = { _ in true })
    -> [PickerOption]
  {
    docs.filter { !isDeleted($0.data) && !(($0.data["name"] as? String) ?? "").isEmpty && keep($0) }
      .map { PickerOption(id: $0.id, name: $0.data["name"] as! String) }.sorted { byName($0.name, $1.name) }
  }

  private func window(_ reader: FirestoreReader, _ query: FirestoreQuery, _ label: String?) async -> [FirestoreDocument] {
    let docs = (try? await reader.readOnce(query)) ?? []
    let (rows, cut) = ceilinged(docs, AutomationCeilings.editorOptions)
    if cut, let label { truncated.append(label) }
    return rows
  }

  /// A site editor's pickers: the site's records and the org's, scoped to the site.
  func loadSite(_ reader: FirestoreReader, hostID: String, orgID: String?, withFunctions: Bool) async {
    guard !loaded else { return }
    loaded = true
    truncated = []
    let ceiling = AutomationCeilings.editorOptions
    if withFunctions {
      functions = await window(reader, AutomationQueries.ceiling(AutomationPaths.functions(hostID), ceiling), "functions")
      variables = await window(reader, AutomationQueries.ceiling(AutomationPaths.variables(hostID), ceiling), "variables")
    }
    workflows = Self.options(
      await window(reader, AutomationQueries.ceiling(AutomationPaths.workflows(hostID), ceiling), "workflows"))
    webhooks = Self.options(
      await window(reader, AutomationQueries.ceiling(AutomationPaths.webhooks(hostID), ceiling), "webhooks")
    ) { $0.data["direction"] as? String == "outbound" }
    overlays = Self.options(
      await window(reader, AutomationQueries.ceiling(AutomationPaths.overlays(hostID), ceiling), "overlays"))
    forms = Self.options(await window(reader, AutomationQueries.ceiling(AutomationPaths.forms(hostID), ceiling), nil))
    if let orgID {
      datasets = Self.options(await window(reader, AutomationQueries.datasets(orgID, hostID: hostID), "datasets"))
      lists = Self.options(
        await window(reader, AutomationQueries.ceiling(AutomationPaths.lists(orgID), ceiling), "audiences"))
      campaigns = Self.options(await window(reader, AutomationQueries.campaigns(orgID, hostID: hostID), "campaigns"))
    }
  }

  @ObservationIgnored private var orgDatasets: [FirestoreDocument] = []
  @ObservationIgnored private var orgCampaigns: [FirestoreDocument] = []

  /// The org editor's pickers: the org's datasets, lists and campaigns, kept to the placement.
  func loadOrg(_ reader: FirestoreReader, orgID: String, placement: [String]) async {
    if !loaded {
      loaded = true
      truncated = []
      let ceiling = AutomationCeilings.editorOptions
      orgDatasets = await window(reader, AutomationQueries.datasets(orgID, hostID: nil), "datasets")
      lists = Self.options(
        await window(reader, AutomationQueries.ceiling(AutomationPaths.lists(orgID), ceiling), "audiences"))
      orgCampaigns = await window(reader, AutomationQueries.campaigns(orgID, hostID: nil), "campaigns")
    }
    place(placement)
  }

  /// Keeps the org's datasets and campaigns to the ones every placed site can see.
  func place(_ placement: [String]) {
    datasets = Self.options(orgDatasets) { scopeCovers($0.data["visibleTo"], placement) }
    campaigns = Self.options(orgCampaigns) { scopeCovers($0.data["visibleTo"], placement) }
  }
}

/// `scopeCovers(target, source)`: an org-wide target covers anything; else it must hold every source token.
func scopeCovers(_ target: Any?, _ source: [String]) -> Bool {
  let targetTokens = (target as? [Any] ?? []).compactMap { $0 as? String }
  if targetTokens.contains("org") { return true }
  if source.contains("org") { return false }
  return source.allSatisfy(targetTokens.contains)
}

/// The org's sites as the signed-in person sees them, and their org-wide role.
@MainActor
@Observable
final class OrgSites {
  private(set) var sites: [WorkspaceSite] = []
  private(set) var ready = false
  /// The org-wide role; nil until read.
  private(set) var role: String?
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored private var orgID: String?

  /// An org viewer gets no controls; every other org role edits.
  var canEdit: Bool { role != nil && role != "viewer" }

  func start(_ context: NativePluginContext) {
    guard let orgID = context.orgID, orgID != self.orgID else { return }
    self.orgID = orgID
    listener?.remove()
    listener = context.firestore.listen(AutomationQueries.memberships(context.uid, orgID: orgID)) { [weak self] result in
      guard let self else { return }
      if case .success(let docs) = result { self.sites = docs.map { WorkspaceStore.site(from: $0) } }
      self.ready = true
    }
    Task {
      let doc = try? await context.firestore.readOnce(AutomationPaths.orgMembership(context.uid, orgID))
      role = (doc?.data["role"] as? String) ?? "viewer"
    }
  }

  func stop() {
    listener?.remove()
    listener = nil
    orgID = nil
  }
}
