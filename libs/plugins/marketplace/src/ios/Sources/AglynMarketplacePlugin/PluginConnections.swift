// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import Observation
import SwiftUI

/*
 * A site's connections for one installed marketplace plugin (AGL-4196): the console's `SitePluginConnectionsCard`, in the
 * `sitePluginConnections` slot of the site's plugin page. A plugin's manifest may declare connections (another service the
 * platform signs in to, what the owner picks there, a scheduled sync); the platform runs them, so this screen is the same
 * for every plugin, one section per declared connection, generated from the pinned manifest and the status route. Every
 * prerequisite stays on screen: a plan without connections, a publisher who has not set the connection up, a deployment
 * that cannot run them yet and a person without the site key each keep the section, with its buttons off and the reason
 * said. The Kotlin plugin's PluginConnections.kt draws the same.
 */

let pluginConnectionsSiteKey = "marketplace.siteConnections"
let pluginConnectionsPlanRefusal = "Connecting a plugin to another service comes with the Starter, Pro and Custom plans."
let pluginConnectionsNotConfiguredText = "Connecting plugins to other services is not available here yet."

func pluginConnectionNotSetUpText(_ label: String) -> String {
  "The plugin's publisher has not finished setting up \(label) yet. You can connect once they have."
}

/// The console route the status, connect and sync calls go to (`PLUGIN_CONNECTIONS_API_ROUTES`).
enum PluginConnectionsRoute {
  static let status = "/api/plugin-connections/status"
  static let connectStart = "/api/plugin-connections/connect/start"
  static let resources = "/api/plugin-connections/resources"
  static let choose = "/api/plugin-connections/choose"
  static let sync = "/api/plugin-connections/sync"
  static let disconnect = "/api/plugin-connections/disconnect"
}

struct PluginConnectionChoice: Equatable {
  let id: String
  let label: String
}

/// What the console may see of a site's connection (`PluginConnectionView`).
struct PluginConnectionState: Equatable {
  var status: String
  var choices: [String: PluginConnectionChoice]
  var ready: Bool
  var lastSyncAtMs: Double?
  var nextSyncAtMs: Double?
  var lastError: String?

  init?(_ json: JSONValue?) {
    guard let json, case .object = json, let status = json["status"]?.stringValue else { return nil }
    self.status = status
    var choices: [String: PluginConnectionChoice] = [:]
    if case .object(let record)? = json["choices"] {
      for (key, value) in record {
        if let id = value["id"]?.stringValue { choices[key] = PluginConnectionChoice(id: id, label: value["label"]?.stringValue ?? id) }
      }
    }
    self.choices = choices
    ready = json["ready"]?.boolValue ?? false
    lastSyncAtMs = json["lastSyncAtMs"]?.numberValue
    nextSyncAtMs = json["nextSyncAtMs"]?.numberValue
    lastError = json["lastError"]?.stringValue
  }
}

/// One declared connection with where it stands for the site (`PluginConnectionStatusEntry`).
struct PluginConnectionEntry: Identifiable, Equatable {
  let listingID: String
  let connectionID: String
  let label: String
  let detail: String?
  let resources: [PluginConnectionChoice]
  var connection: PluginConnectionState?
  let credentialsSet: Bool
  let planAllows: Bool
  var id: String { "\(listingID)/\(connectionID)" }

  init?(_ json: JSONValue) {
    guard let listingID = json["listingId"]?.stringValue, let connectionID = json["connectionId"]?.stringValue else { return nil }
    self.listingID = listingID
    self.connectionID = connectionID
    label = json["label"]?.stringValue ?? connectionID
    detail = json["description"]?.stringValue
    resources = (json["resources"]?.arrayValue ?? []).compactMap { one in
      one["id"]?.stringValue.map { PluginConnectionChoice(id: $0, label: one["label"]?.stringValue ?? $0) }
    }
    connection = PluginConnectionState(json["connection"])
    credentialsSet = json["credentialsSet"]?.boolValue ?? false
    planAllows = json["planAllows"]?.boolValue ?? false
  }
}

struct PluginConnectionsStatus: Equatable {
  let configured: Bool
  let planAllows: Bool
  var connections: [PluginConnectionEntry]

  init(_ json: JSONValue?) {
    configured = json?["configured"]?.boolValue ?? false
    planAllows = json?["planAllows"]?.boolValue ?? false
    connections = (json?["connections"]?.arrayValue ?? []).compactMap(PluginConnectionEntry.init)
  }
}

enum PluginConnectionPhase: Equatable {
  case notConfigured, notSetUp, notConnected, choosing, connected, reconnect, error

  var chip: (label: String, tone: AglynTone) {
    switch self {
    case .notConfigured: ("Not available yet", .neutral)
    case .notSetUp: ("Waiting on the publisher", .neutral)
    case .notConnected: ("Not connected", .neutral)
    case .choosing: ("Finish setting up", .info)
    case .connected: ("Connected", .success)
    case .reconnect: ("Reconnect needed", .warning)
    case .error: ("Sync failed", .error)
    }
  }
}

/// Where one declared connection stands (`pluginConnectionPhase`).
func pluginConnectionPhase(_ entry: PluginConnectionEntry, configured: Bool) -> PluginConnectionPhase {
  guard configured else { return .notConfigured }
  guard let connection = entry.connection else { return entry.credentialsSet ? .notConnected : .notSetUp }
  if connection.status == "reconnect_required" { return .reconnect }
  if connection.status == "error" { return .error }
  return connection.ready ? .connected : .choosing
}

/// The first declared resource the site has not chosen yet, in order.
func nextPluginConnectionResource(_ entry: PluginConnectionEntry) -> PluginConnectionChoice? {
  entry.resources.first { entry.connection?.choices[$0.id] == nil }
}

enum PluginConnectionNextSync: Equatable {
  case at(Double)
  case soon
}

/// When the next scheduled sync runs: what the sync recorded, else the last one plus the manifest's interval.
func pluginConnectionNextSync(_ connection: PluginConnectionState?, intervalHours: Double?) -> PluginConnectionNextSync? {
  guard let connection, connection.status != "reconnect_required", connection.ready else { return nil }
  if let next = connection.nextSyncAtMs { return .at(next) }
  guard let intervalHours, intervalHours > 0 else { return nil }
  guard let last = connection.lastSyncAtMs else { return .soon }
  return .at(last + intervalHours * 3_600_000)
}

/// One connection a pinned manifest declares: what the section is called before the status answers, and its sync interval.
struct DeclaredPluginConnection: Equatable {
  let id: String
  let label: String
  let intervalHours: Double?
}

/// The connections a pinned manifest declares, by id and label.
func declaredPluginConnections(_ manifest: [String: Any]?) -> [DeclaredPluginConnection] {
  ((manifest?["connections"] as? [Any]) ?? []).compactMap { one in
    guard let record = one as? [String: Any], let id = record["id"] as? String, let label = record["label"] as? String, !id.isEmpty
    else { return nil }
    let hours = ((record["sync"] as? [String: Any])?["intervalHours"] as? NSNumber)?.doubleValue
    return DeclaredPluginConnection(id: id, label: label, intervalHours: hours)
  }
}

/// The console page a connect comes back to: the site's page for the plugin.
func pluginConnectionReturnTo(origin: String, orgSlug: String?, hostSlug: String?, listingID: String) -> String {
  let trimmed = origin.hasSuffix("/") ? String(origin.dropLast()) : origin
  guard let orgSlug, let hostSlug else { return "\(trimmed)/" }
  return "\(trimmed)/\(orgSlug)/hosts/\(hostSlug)/admin/plugins/\(listingID)"
}

/// Why a route refused, when it says (`reason` in its JSON).
func pluginConnectionRefusalReason(_ error: Error) -> String? {
  (error as? ConsoleAPIError)?.body?["reason"]?.stringValue
}

func pluginConnectionTime(_ ms: Double) -> String {
  Date(timeIntervalSince1970: ms / 1000).formatted(date: .abbreviated, time: .shortened)
}

/// The connection routes for one site.
struct PluginConnectionsAPI {
  let api: ConsoleAPIClient
  let hostID: String

  func status(listingID: String) async throws -> PluginConnectionsStatus {
    PluginConnectionsStatus(try await api.request(PluginConnectionsRoute.status, query: [("hostId", hostID), ("listingId", listingID)]))
  }

  func connectStart(listingID: String, connectionID: String, returnTo: String) async throws -> String? {
    let body: [String: Any] = ["hostId": hostID, "listingId": listingID, "connectionId": connectionID, "returnTo": returnTo]
    return try await api.request(PluginConnectionsRoute.connectStart, method: .post, body: JSONValue.from(body))?["authorizeUrl"]?.stringValue
  }

  func resources(listingID: String, connectionID: String, resource: String) async throws -> [PluginConnectionChoice] {
    let answer = try await api.request(
      PluginConnectionsRoute.resources,
      query: [("hostId", hostID), ("listingId", listingID), ("connectionId", connectionID), ("resource", resource)])
    return (answer?["items"]?.arrayValue ?? []).compactMap { item in
      item["id"]?.stringValue.map { PluginConnectionChoice(id: $0, label: item["label"]?.stringValue ?? $0) }
    }
  }

  func choose(listingID: String, connectionID: String, resource: String, id: String) async throws -> PluginConnectionState? {
    let body: [String: Any] = ["hostId": hostID, "listingId": listingID, "connectionId": connectionID, "resource": resource, "id": id]
    return PluginConnectionState(try await api.request(PluginConnectionsRoute.choose, method: .post, body: JSONValue.from(body))?["connection"])
  }

  func sync(listingID: String, connectionID: String) async throws -> PluginConnectionState? {
    let body: [String: Any] = ["hostId": hostID, "listingId": listingID, "connectionId": connectionID]
    return PluginConnectionState(try await api.request(PluginConnectionsRoute.sync, method: .post, body: JSONValue.from(body))?["connection"])
  }

  func disconnect(listingID: String, connectionID: String) async throws {
    let body: [String: Any] = ["hostId": hostID, "listingId": listingID, "connectionId": connectionID]
    try await api.request(PluginConnectionsRoute.disconnect, method: .post, body: JSONValue.from(body))
  }
}

// MARK: The slot

/// The `sitePluginConnections` slot: one section per connection the site's pinned manifest declares.
struct SitePluginConnectionsCard: View {
  let context: NativePluginContext
  @Environment(\.aglynSlotParams) private var slot
  @Environment(\.scenePhase) private var scenePhase
  @State private var declared: [DeclaredPluginConnection]?
  @State private var pluginName = "this plugin"
  @State private var status: PluginConnectionsStatus?
  @State private var loadError: String?
  @State private var refused = false

  private var listingID: String { slot["pluginId"] ?? "" }
  private var hostID: String { context.hostID ?? "" }
  private var api: PluginConnectionsAPI { PluginConnectionsAPI(api: context.api, hostID: hostID) }
  private var keyRefused: Bool { !context.can(pluginConnectionsSiteKey) }

  var body: some View {
    Group {
      if let declared, !declared.isEmpty {
        VStack(alignment: .leading, spacing: AglynSpace.three) {
          if keyRefused || refused {
            ForEach(declared, id: \.id) { one in
              VStack(alignment: .leading, spacing: AglynSpace.one) {
                header(one.label, chip: nil)
                AglynNotice(context.refusal(pluginConnectionsSiteKey), tone: .info)
                Button("Connect") {}.buttonStyle(.aglynProminent).disabled(true)
              }
            }
          } else if let status {
            ForEach(status.connections) { entry in
              SitePluginConnectionSection(
                context: context, entry: entry, configured: status.configured, planAllows: status.planAllows && entry.planAllows,
                pluginName: pluginName, intervalHours: declared.first { $0.id == entry.connectionID }?.intervalHours, api: api
              ) { updated in
                self.status?.connections = self.status?.connections.map { $0.id == entry.id ? updated : $0 } ?? []
              } onStale: {
                Task { await refresh() }
              }
            }
          } else if let loadError {
            AglynNotice(loadError, tone: .error, actionTitle: "Try again") { Task { await refresh() } }
          } else {
            SkeletonRows(count: 2)
          }
        }
      }
    }
    .task(id: "\(hostID)/\(listingID)") { await load() }
    // Back from the provider's sign-in in the browser: read where it stands again.
    .onChange(of: scenePhase) { _, phase in if phase == .active, declared?.isEmpty == false { Task { await refresh() } } }
  }

  private func header(_ label: String, chip: PluginConnectionPhase?) -> some View {
    HStack(spacing: AglynSpace.one) {
      Text(label).font(AglynFont.headline).accessibilityAddTraits(.isHeader)
      Spacer(minLength: 0)
      if let chip { StatusChip(chip.chip.label, tone: chip.chip.tone) }
    }
  }

  private func load() async {
    guard !listingID.isEmpty, !hostID.isEmpty else {
      declared = []
      return
    }
    var pin = try? await context.firestore.readOnce(["hosts", hostID, "installs", listingID])
    if pin == nil, let orgID = context.orgID { pin = try? await context.firestore.readOnce(["orgs", orgID, "installs", listingID]) }
    pluginName = pin?.string("displayName") ?? "this plugin"
    declared = declaredPluginConnections(pin?.data["manifest"] as? [String: Any])
    if declared?.isEmpty == false { await refresh() }
  }

  private func refresh() async {
    do {
      status = try await api.status(listingID: listingID)
      loadError = nil
      refused = false
    } catch {
      refused = pluginConnectionRefusalReason(error) == "permission"
      loadError = (error as? ConsoleAPIError)?.message ?? "The connections could not be read. Try again."
    }
  }
}

/// One declared connection on the site: its state, what was chosen, and what can be done next.
private struct SitePluginConnectionSection: View {
  let context: NativePluginContext
  let entry: PluginConnectionEntry
  let configured: Bool
  let planAllows: Bool
  let pluginName: String
  let intervalHours: Double?
  let api: PluginConnectionsAPI
  let onChange: (PluginConnectionEntry) -> Void
  let onStale: () -> Void
  @Environment(\.openURL) private var openURL
  @State private var runner = PluginActionRunner()
  @State private var changing: Int?
  @State private var items: [PluginConnectionChoice]?
  @State private var itemsError: String?
  @State private var picked = ""
  @State private var confirmingDisconnect = false

  private var phase: PluginConnectionPhase { pluginConnectionPhase(entry, configured: configured) }
  private var resource: PluginConnectionChoice? {
    if let changing { return entry.resources.indices.contains(changing) ? entry.resources[changing] : nil }
    return phase == .choosing ? nextPluginConnectionResource(entry) : nil
  }
  private var label: String { entry.label }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      HStack(spacing: AglynSpace.one) {
        Text(label).font(AglynFont.headline).accessibilityAddTraits(.isHeader)
        Spacer(minLength: 0)
        StatusChip(phase.chip.label, tone: phase.chip.tone)
      }
      if let detail = entry.detail { Text(detail).font(AglynFont.caption).foregroundStyle(.secondary) }
      if let error = runner.error { AglynNotice(error, tone: .error) { runner.error = nil } }
      if let notice = runner.notice { AglynNotice(notice, tone: .success) { runner.notice = nil } }
      notices
      if let resource { picker(resource) }
      details
      actions
    }
    .task(id: "\(resource?.id ?? "")/\(planAllows)") { await loadItems() }
    .confirmationDialog("Disconnect \(label)?", isPresented: $confirmingDisconnect, titleVisibility: .visible) {
      Button("Disconnect", role: .destructive) { disconnect() }
    } message: {
      Text("\(pluginName) stops receiving updates from \(label) on this site. You can connect again at any time.")
    }
  }

  @ViewBuilder
  private var notices: some View {
    switch phase {
    case .notConfigured: AglynNotice(pluginConnectionsNotConfiguredText, tone: .info)
    case .notSetUp: AglynNotice(pluginConnectionNotSetUpText(label), tone: .info)
    default:
      if !planAllows {
        AglynUpgradeNotice(entry.connection == nil ? pluginConnectionsPlanRefusal : "\(pluginConnectionsPlanRefusal) You can still disconnect it.") {
          context.navigate("core.billing.plans")
        }
      }
    }
    switch phase {
    case .notConnected:
      Text("Connect \(label) so \(pluginName) can use it on this site. You sign in at \(label) and choose what to share; this site never sees your password.")
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
    case .reconnect:
      AglynNotice("\(label) no longer accepts this connection. Nothing syncs until you reconnect.", tone: .warning)
    case .error:
      let reason = entry.connection?.lastError.map { "The last sync did not work: \($0). " } ?? "The last sync did not work. "
      AglynNotice(reason + "It tries again on schedule, or you can sync now.", tone: .error)
    default: EmptyView()
    }
  }

  @ViewBuilder
  private func picker(_ resource: PluginConnectionChoice) -> some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text("Choose the \(resource.label.lowercased()) \(pluginName) should use.\(changing == nil ? " Nothing syncs until you do." : "")")
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
      if let itemsError {
        AglynNotice(itemsError, tone: .error)
      } else if let items {
        if items.isEmpty {
          AglynNotice(
            "The \(label) account you connected has nothing to choose here. Connect a different account, or add one at \(label) first.",
            tone: .info)
        } else {
          Picker(resource.label, selection: $picked) {
            Text("Choose…").tag("")
            ForEach(items, id: \.id) { item in Text(item.label).tag(item.id) }
          }
          .disabled(runner.busy || !planAllows)
          .accessibilityIdentifier("plugin-connection-picker-\(entry.connectionID)")
        }
      } else if planAllows {
        ProgressView("Asking \(label)…").font(AglynFont.caption)
      }
    }
  }

  @ViewBuilder
  private var details: some View {
    if let connection = entry.connection, changing == nil {
      let chosen = entry.resources.compactMap { one in connection.choices[one.id].map { (one.label, $0.label) } }
      ForEach(chosen, id: \.0) { pair in
        LabeledContent(pair.0, value: pair.1).font(AglynFont.subheadline)
      }
      if phase == .connected || phase == .error {
        Text(connection.lastSyncAtMs.map { "Last synced \(pluginConnectionTime($0))" } ?? "Not synced yet")
          .font(AglynFont.caption).foregroundStyle(.secondary)
        switch pluginConnectionNextSync(connection, intervalHours: intervalHours) {
        case .at(let ms)?: Text("Next sync \(pluginConnectionTime(ms))").font(AglynFont.caption).foregroundStyle(.secondary)
        case .soon?: Text("Next sync: within the hour").font(AglynFont.caption).foregroundStyle(.secondary)
        case nil: EmptyView()
        }
      }
    }
  }

  @ViewBuilder
  private var actions: some View {
    let planReason = planAllows ? nil : pluginConnectionsPlanRefusal
    HStack(spacing: AglynSpace.one) {
      if let resource {
        Button(runner.busy ? "Saving…" : "Use this \(resource.label.lowercased())") { choose(resource) }
          .buttonStyle(.aglynProminent).disabled(runner.busy || picked.isEmpty || planReason != nil)
          .accessibilityIdentifier("plugin-connection-use-\(entry.connectionID)")
        if changing != nil { Button("Cancel") { changing = nil }.buttonStyle(.aglynSecondary).disabled(runner.busy) }
        disconnectButton
      } else {
        switch phase {
        case .notConfigured, .notSetUp, .notConnected:
          Button(runner.busy ? "Opening…" : "Connect") { connect() }
            .buttonStyle(.aglynProminent).disabled(runner.busy || phase != .notConnected || planReason != nil)
            .accessibilityIdentifier("plugin-connection-connect-\(entry.connectionID)")
        case .reconnect:
          Button(runner.busy ? "Opening…" : "Reconnect") { connect() }
            .buttonStyle(.aglynProminent).disabled(runner.busy || planReason != nil || !entry.credentialsSet)
            .accessibilityIdentifier("plugin-connection-reconnect-\(entry.connectionID)")
          disconnectButton
        case .connected, .error, .choosing:
          if phase == .error {
            Button(runner.busy ? "Syncing…" : "Sync now") { sync() }
              .buttonStyle(.aglynProminent).disabled(runner.busy || planReason != nil)
              .accessibilityIdentifier("plugin-connection-sync-\(entry.connectionID)")
          } else {
            Button(runner.busy ? "Syncing…" : "Sync now") { sync() }
              .buttonStyle(.aglynSecondary).disabled(runner.busy || planReason != nil)
              .accessibilityIdentifier("plugin-connection-sync-\(entry.connectionID)")
          }
          if !entry.resources.isEmpty {
            Button("Change") { changing = 0 }.buttonStyle(.aglynSecondary).disabled(runner.busy || planReason != nil)
          }
          disconnectButton
        }
      }
    }
  }

  private var disconnectButton: some View {
    Button("Disconnect", role: .destructive) { confirmingDisconnect = true }
      .buttonStyle(.borderless).disabled(runner.busy)
      .accessibilityIdentifier("plugin-connection-disconnect-\(entry.connectionID)")
  }

  private func loadItems() async {
    items = nil
    itemsError = nil
    guard let resource, planAllows else { return }
    picked = entry.connection?.choices[resource.id]?.id ?? ""
    do {
      let listed = try await api.resources(listingID: entry.listingID, connectionID: entry.connectionID, resource: resource.id)
      items = listed
      if picked.isEmpty, listed.count == 1 { picked = listed[0].id }
    } catch {
      itemsError = (error as? ConsoleAPIError)?.message ?? error.localizedDescription
      if pluginConnectionRefusalReason(error) == "reconnect" { onStale() }
    }
  }

  private func updated(_ connection: PluginConnectionState?) -> PluginConnectionEntry {
    var next = entry
    next.connection = connection
    return next
  }

  private func connect() {
    let returnTo = pluginConnectionReturnTo(
      origin: context.api.origin, orgSlug: context.orgSlug, hostSlug: context.hostSlug, listingID: entry.listingID)
    runner.run {
      if let link = try await api.connectStart(listingID: entry.listingID, connectionID: entry.connectionID, returnTo: returnTo),
        let url = URL(string: link)
      {
        openURL(url)
      }
    }
  }

  private func choose(_ resource: PluginConnectionChoice) {
    let id = picked
    runner.run {
      let connection = try await api.choose(listingID: entry.listingID, connectionID: entry.connectionID, resource: resource.id, id: id)
      if let changing { self.changing = changing + 1 < entry.resources.count ? changing + 1 : nil }
      if connection?.ready == true { runner.notice = "\(label) is set up. It syncs on its own from now on." }
      onChange(updated(connection))
    }
  }

  private func sync() {
    runner.run {
      let connection = try await api.sync(listingID: entry.listingID, connectionID: entry.connectionID)
      onChange(updated(connection))
      if connection?.status == "connected" { runner.notice = "\(label) is up to date." } else { runner.error = "\(label) did not sync. See why above." }
    }
  }

  private func disconnect() {
    runner.run {
      try await api.disconnect(listingID: entry.listingID, connectionID: entry.connectionID)
      changing = nil
      runner.notice = "\(label) is disconnected."
      onChange(updated(nil))
    }
  }
}
