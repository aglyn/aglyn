// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Observation
import SwiftUI

/*
 * Where a built-in plugin runs (AGL-4047), as the console's PluginRunsOnField has it on a plugin's page: every site, or
 * every site except some. The choice is the sites' own `disabledPlugins`, so a site left out can switch it back on for
 * itself, and a new site gets it; Save sends the choice to `/api/orgs/plugin-sites`, which writes those lists. Drawn in
 * the plugin page's `pluginRunsOn` zone, given `pluginId`. The Kotlin kit's PluginRunsOnSection.kt.
 */

public let pluginRunsOnSlot = "pluginRunsOn"
public let pluginRunsOnWidget = "site.plugin-runs-on"

/// The workspace document and each of its sites' documents, live.
@MainActor
@Observable
final class PluginSitesModel {
  private(set) var org: [String: Any]?
  private(set) var hosts: [String: [String: Any]] = [:]
  @ObservationIgnored private var orgListener: FirestoreListening?
  @ObservationIgnored private var hostListeners: [String: FirestoreListening] = [:]
  @ObservationIgnored private var reader: FirestoreReader?

  var hostIDs: [String] {
    ((org?["hosts"] as? [String: Any]) ?? [:]).filter { ($0.value as? Bool) == true }.map(\.key).sorted()
  }

  var ready: Bool { org != nil && hostIDs.allSatisfy { hosts[$0] != nil } }

  func start(_ reader: FirestoreReader, orgID: String) {
    guard orgListener == nil else { return }
    self.reader = reader
    orgListener = reader.listenDocument(["orgs", orgID]) { [weak self] result in
      guard let self, case .success(let doc) = result else { return }
      self.org = doc?.data ?? [:]
      self.follow()
    }
  }

  private func follow() {
    guard let reader else { return }
    for id in hostIDs where hostListeners[id] == nil {
      hostListeners[id] = reader.listenDocument(["hosts", id]) { [weak self] result in
        guard let self, case .success(let doc) = result else { return }
        self.hosts[id] = doc?.data ?? [:]
      }
    }
  }

  func stop() {
    orgListener?.remove()
    hostListeners.values.forEach { $0.remove() }
    orgListener = nil
    hostListeners = [:]
  }
}

struct PluginRunsOnSection: View {
  let context: NativePluginContext
  @Environment(\.aglynSlotParams) private var params
  @State private var model = PluginSitesModel()
  @State private var draft: PluginRunsOn?
  @State private var busy = false
  @State private var refusal: String?
  @State private var notice: String?

  private var pluginID: String { params["pluginId"] ?? "" }
  private var plugin: FirstPartyPlugin? { PluginCatalog.plugin(pluginID) }
  private var label: String { plugin?.label ?? pluginID }
  private var orgEnabled: [String]? { (model.org?["enabledPlugins"] as? [Any])?.compactMap { $0 as? String } }

  private func strings(_ value: Any?) -> [String]? { (value as? [Any])?.compactMap { $0 as? String } }

  private var sites: [PluginSiteEntry] {
    model.hostIDs.compactMap { id in
      model.hosts[id].map {
        PluginSiteEntry(id: id, disabledPlugins: strings($0["disabledPlugins"]), enabledPlugins: strings($0["enabledPlugins"]))
      }
    }
  }

  private func siteName(_ hostID: String) -> String {
    context.sites.first { $0.id == hostID }?.name ?? model.hosts[hostID]?["displayName"] as? String ?? "a site"
  }

  private var stored: PluginRunsOn { pluginRunsOnOf(pluginID, sites: sites) }
  private var choice: PluginRunsOn { draft ?? stored }

  private func same(_ a: PluginRunsOn, _ b: PluginRunsOn) -> Bool {
    switch (a, b) {
    case (.all, .all): return true
    case (.allExcept(let x), .allExcept(let y)): return Set(x) == Set(y)
    default: return false
    }
  }

  private var dirty: Bool { draft.map { !same($0, stored) } ?? false }
  private var plan: PluginRunsOnPlan? {
    model.ready ? planPluginRunsOn(pluginID: pluginID, choice: choice, orgEnabled: orgEnabled, sites: sites, siteName: siteName) : nil
  }
  private var locked: Bool { isLockedOnForSite(pluginID) }
  private var onForWorkspace: Bool? {
    guard model.org != nil else { return nil }
    return resolveEnabledPlugins(orgEnabled).contains(pluginID) || isLockedOnForWorkspace(pluginID)
  }
  private var canChange: Bool { context.canInWorkspace("org.settings") }
  private var readOnlyReason: String? {
    if locked { return "Sites are built out of it, so it runs on every site." }
    if onForWorkspace == false {
      return "It is switched off for this workspace, so it runs on no site. Switch it on to choose where it runs."
    }
    if !canChange { return permissionRefusalText(ContractValues.shared.orgRoleGrants, key: "org.settings") }
    return nil
  }
  private var readOnly: Bool { locked || onForWorkspace != true || !canChange || busy }

  private func count(_ n: Int) -> String { n == 1 ? "1 site" : "\(n) sites" }

  var body: some View {
    // Sites are built out of an always-on plugin, so it has nowhere to choose; the console shows nothing for it either.
    if let plugin, let orgID = context.orgID, !isLockedOnForSite(pluginID) {
      let value: ScopeSharingChoice = {
        if locked { return .all }
        if case .allExcept(let ids) = choice { return .allExcept(exceptHostIDs: ids) }
        return .all
      }()
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        if let notice { AglynNotice(notice, tone: .success) { self.notice = nil } }
        SiteSharingField(
          "Runs on",
          value: Binding(
            get: { value },
            set: { next in
              refusal = nil
              notice = nil
              if case .allExcept(let ids) = next { draft = .allExcept(exceptHostIDs: ids) } else { draft = .all }
            }),
          sites: sites.map { SharingSite(id: $0.id, name: siteName($0.id)) }, sitesReady: model.ready,
          modes: [.all, .allExcept], readOnly: readOnly, readOnlyReason: readOnlyReason,
          problem: !readOnly && dirty ? (plan?.problem ?? refusal) : refusal
        )
        if !locked {
          caption(
            "A site left out can turn it back on for itself: anyone holding “\(orgPermissionLabel(ContractValues.shared.orgRoleGrants, key: "site.manage"))” on that site, which its admins hold by default, can switch it on from the site’s Admin › Plugins page."
          )
          if let note = pluginRunsOnOptInNote(pluginID) { caption(note) }
          if case .allExcept = choice, let stops = plugin.siteOff?.stops { caption("On each site left out: \(stops)") }
        }
        if dirty && !readOnly {
          HStack(spacing: AglynSpace.one) {
            let leftOut = plan?.writes?.filter(\.leftOut).count ?? 0
            let broughtBack = plan?.writes?.filter { !$0.leftOut }.count ?? 0
            Text(
              plan?.problem == nil && (leftOut > 0 || broughtBack > 0)
                ? [
                  leftOut > 0 ? "Takes \(label) off \(count(leftOut))." : nil,
                  broughtBack > 0 ? "Turns it back on for \(count(broughtBack))." : nil,
                ].compactMap { $0 }.joined(separator: " ") : ""
            )
            .font(AglynFont.subheadline).foregroundStyle(AglynColor.secondaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            Button("Cancel") { draft = nil }.disabled(busy)
            Button("Save") { Task { await save(orgID) } }
              .buttonStyle(.borderedProminent)
              .disabled(busy || plan == nil || plan?.problem != nil)
              .accessibilityIdentifier("plugin-runs-on-save")
          }
        }
      }
      .padding(AglynSpace.two)
      .background(AglynColor.paper, in: RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous))
      .accessibilityIdentifier("plugin-runs-on")
      .task(id: orgID) { model.start(context.firestore, orgID: orgID) }
      .onChange(of: model.ready ? "\(pluginRunsOnOf(pluginID, sites: sites))" : "") { _, _ in
        draft = nil
        refusal = nil
      }
    }
  }

  private func caption(_ text: String) -> some View {
    Text(text).font(AglynFont.caption).foregroundStyle(AglynColor.secondaryText).fixedSize(horizontal: false, vertical: true)
  }

  private func save(_ orgID: String) async {
    guard dirty, let plan, plan.problem == nil else { return }
    busy = true
    refusal = nil
    defer { busy = false }
    do {
      _ = try await context.api.request(
        "/api/orgs/plugin-sites", method: .post,
        body: JSONValue.from(["orgId": orgID, "pluginId": pluginID, "choice": choice.wire]))
      notice = "Saved where \(label) runs"
      draft = nil
    } catch let error as ConsoleAPIError {
      refusal = error.body?["error"]?.stringValue ?? "Request failed"
    } catch {
      refusal = "Request failed"
    }
  }
}
