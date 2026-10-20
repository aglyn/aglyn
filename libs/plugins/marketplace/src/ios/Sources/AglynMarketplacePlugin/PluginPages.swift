// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynScreens
import AglynUI
import Foundation
import Observation
import SwiftUI

/*
 * What the workspace's plugin pages (the console's `[orgSlug]/plugins` and `[orgSlug]/plugins/[pluginRef]`) show of
 * the marketplace, in the slots those pages hand to the plugin that installs: the plugins installed from the
 * marketplace (every site's pins, with a chip where a newer version is on offer), and, on one plugin's page, whether it
 * is current, where it runs (the whole workspace or named sites, each with its version) and the update, install and
 * remove controls the console's `PluginSiteSet` has, then what it may do (capabilities and network). The Kotlin
 * plugin's PluginPages.kt draws the same.
 */

/// The site list the pages name: the workspace's sites the person belongs to, by the name the console shows.
func siteChoices(_ docs: [FirestoreDocument]) -> [SiteChoice] {
  docs.map { doc in
    let name = (doc.string("displayName") ?? "").trimmingCharacters(in: .whitespaces)
    let subdomain = (doc.string("subdomain") ?? "").trimmingCharacters(in: .whitespaces)
    return SiteChoice(id: doc.id, label: !name.isEmpty ? name : (!subdomain.isEmpty ? subdomain : doc.id))
  }
}

private func sitesQuery(uid: String, orgID: String) -> FirestoreQuery {
  FirestoreQuery(["users", uid, "hostMemberships"], equals: [(field: "orgId", value: orgID)], limit: 100)
}

/// A pin as the pages read it: its version and what comes with it.
private extension FirestoreDocument {
  var pinVersion: PinVersion { PinVersion(version: versionText(data["version"])) }
  var manifest: [String: Any]? { data["manifest"] as? [String: Any] }
}

// MARK: The plugins installed from the marketplace

/// One listing installed in the workspace: at the workspace level, on some sites, or both (`Installation`).
struct PluginInstallation: Identifiable, Equatable {
  let id: String
  let name: String
  let version: String?
  let siteLabels: [String]
  let orgWide: Bool
  let status: UpdateStatus

  var caption: String { installedPluginCaption(version: version, orgWide: orgWide, siteLabels: siteLabels) }
}

/// The installations the workspace holds, read the way the console's installs card reads them.
@MainActor
@Observable
final class PluginInstallationsModel {
  private(set) var installations: [PluginInstallation]?
  private(set) var failed = false
  @ObservationIgnored private var orgListener: FirestoreListening?
  @ObservationIgnored private var siteListener: FirestoreListening?
  @ObservationIgnored private var orgDocs: [FirestoreDocument]?
  @ObservationIgnored private var sites: [SiteChoice]?
  @ObservationIgnored private var generation = 0

  func start(_ context: NativePluginContext) {
    stop()
    guard let orgID = context.orgID else {
      installations = []
      return
    }
    orgListener = context.firestore.listen(FirestoreQuery(["orgs", orgID, "installs"], limit: 100)) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs): self.orgDocs = docs
      case .failure: self.failed = true
      }
      self.refresh(context)
    }
    siteListener = context.firestore.listen(sitesQuery(uid: context.uid, orgID: orgID)) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs): self.sites = siteChoices(docs)
      case .failure: self.sites = []
      }
      self.refresh(context)
    }
  }

  func stop() {
    orgListener?.remove()
    siteListener?.remove()
    orgListener = nil
    siteListener = nil
  }

  private func refresh(_ context: NativePluginContext) {
    guard let orgDocs, let sites else { return }
    generation += 1
    let mine = generation
    Task { @MainActor in
      var byListing: [String: (doc: FirestoreDocument, labels: [String], orgWide: Bool)] = [:]
      var order: [String] = []
      for doc in orgDocs {
        byListing[doc.id] = (doc, [], true)
        order.append(doc.id)
      }
      for site in sites {
        let pins = (try? await context.firestore.readOnce(FirestoreQuery(["hosts", site.id, "installs"], limit: 100))) ?? []
        for pin in pins {
          if var existing = byListing[pin.id] {
            existing.labels.append(site.label)
            byListing[pin.id] = existing
          } else {
            byListing[pin.id] = (pin, [site.label], false)
            order.append(pin.id)
          }
        }
      }
      var rows: [PluginInstallation] = []
      for id in order {
        guard let entry = byListing[id] else { continue }
        let listing = try? await context.firestore.readOnce([listingsCollection, id])
        let revocation = try? await context.firestore.readOnce(["revocations", id])
        let offered = pluginOfferedVersion(
          latestApprovedVersion: versionText(listing?.data["latestApprovedVersion"]), revoked: Revoked(revocation?.data))
        let name = (entry.doc.string("displayName") ?? entry.doc.string("pluginId") ?? id)
        rows.append(
          PluginInstallation(
            id: id, name: name, version: versionText(entry.doc.data["version"]), siteLabels: entry.labels, orgWide: entry.orgWide,
            status: pluginUpdateStatus(pin: UpdateComparablePin(entry.doc.data), offered: offered)))
      }
      guard mine == generation else { return }
      installations = rows
    }
  }
}

/// "Installed from the marketplace": the plugins this workspace runs that came from it (the console's `OrgPluginInstallsCard`).
struct OrgPluginInstallsCard: View {
  let context: NativePluginContext
  @State private var model = PluginInstallationsModel()

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text("Installed from the marketplace").font(AglynFont.headline).accessibilityAddTraits(.isHeader)
      if let rows = model.installations {
        if rows.isEmpty {
          AglynNotice("Nothing installed from the marketplace yet — browse it to add one.", tone: .info)
        } else {
          ForEach(rows) { row in
            Button {
              context.navigate("core.plugin", ["pluginId": row.id])
            } label: {
              AglynRow(row.name, subtitle: row.caption, systemImage: "puzzlepiece.extension") {
                switch row.status.state {
                case .updateAvailable: StatusChip("v\(row.status.availableVersion ?? "") available", tone: .info)
                case .unknown: StatusChip("Unknown", tone: .neutral)
                default: EmptyView()
                }
              }
            }
            .buttonStyle(.aglynRow)
            .accessibilityIdentifier("installed-\(row.id)")
          }
        }
      } else if model.failed {
        AglynNotice("The installed plugins could not be loaded.", tone: .error)
      } else {
        SkeletonRows(count: 2)
      }
    }
    .task(id: "\(context.orgID ?? "")") { model.start(context) }
    .onDisappear { model.stop() }
  }
}

// MARK: One plugin's installs

/// One listing's pins across the workspace and what the page needs of them (`PluginSiteSetPanel`).
@MainActor
@Observable
final class ListingInstallsModel {
  private(set) var sites: [SiteChoice] = []
  private(set) var orgPin: FirestoreDocument?
  private(set) var hostPins: [String: FirestoreDocument] = [:]
  private(set) var listing: FirestoreDocument?
  private(set) var revocation: FirestoreDocument?
  private(set) var loaded = false
  @ObservationIgnored private var listeners: [FirestoreListening] = []
  @ObservationIgnored private var sitesKey = ""

  func start(_ context: NativePluginContext, listingID: String) {
    stop()
    loaded = false
    guard let orgID = context.orgID, !listingID.isEmpty else {
      loaded = true
      return
    }
    listeners.append(
      context.firestore.listenDocument(["orgs", orgID, "installs", listingID]) { [weak self] result in
        self?.orgPin = try? result.get()
      })
    listeners.append(
      context.firestore.listenDocument([listingsCollection, listingID]) { [weak self] result in self?.listing = try? result.get() })
    listeners.append(
      context.firestore.listenDocument(["revocations", listingID]) { [weak self] result in self?.revocation = try? result.get() })
    listeners.append(
      context.firestore.listen(sitesQuery(uid: context.uid, orgID: orgID)) { [weak self] result in
        guard let self else { return }
        self.sites = (try? result.get()).map(siteChoices) ?? []
        let key = self.sites.map(\.id).joined(separator: "|")
        if key != self.sitesKey || !self.loaded {
          self.sitesKey = key
          Task { @MainActor in await self.reloadPins(context, listingID: listingID) }
        }
      })
  }

  func stop() {
    listeners.forEach { $0.remove() }
    listeners = []
  }

  /// Reads each site's own pin of the listing again (after an install, an update or a removal).
  func reloadPins(_ context: NativePluginContext, listingID: String) async {
    var found: [String: FirestoreDocument] = [:]
    for site in sites {
      if let doc = try? await context.firestore.readOnce(["hosts", site.id, "installs", listingID]) { found[site.id] = doc }
    }
    hostPins = found
    loaded = true
  }

  var summary: OrgInstallSummary {
    resolveOrgInstallSummary(hosts: sites, hostPins: hostPins.mapValues(\.pinVersion), orgPin: orgPin?.pinVersion)
  }

  var offered: String? {
    pluginOfferedVersion(latestApprovedVersion: versionText(listing?.data["latestApprovedVersion"]), revoked: Revoked(revocation?.data))
  }

  /// The pin the page reads its manifest and provenance off: the workspace's, else the first site's.
  var pin: FirestoreDocument? { orgPin ?? sites.compactMap { hostPins[$0.id] }.first }

  var status: UpdateStatus { pluginUpdateStatus(pin: pin.map { UpdateComparablePin($0.data) }, offered: offered) }

  var name: String { pin?.string("displayName") ?? listing?.string("displayName") ?? "This plugin" }

  /// The plugin id the impact check asks about: the listing's, else the pin's, else its manifest's.
  var pluginID: String {
    listing?.string("pluginId") ?? pin?.string("pluginId") ?? (pin?.manifest?["id"] as? String) ?? ""
  }
}

private struct PendingUpdate: Identifiable {
  let id = UUID()
  /// nil is the one workspace-wide pin.
  let hostIDs: [String]?
  let label: String
}

private struct PendingRemoval: Identifiable {
  let id = UUID()
  let scope: InstallTarget
  let hostID: String?
  let targets: [UninstallTarget]
}

/// A plugin's installation: whether it is current, where it runs and how to change that, and what it may do.
struct PluginInstallationCard: View {
  let context: NativePluginContext
  @Environment(\.aglynSlotParams) private var slot
  @State private var model = ListingInstallsModel()
  @State private var runner = PluginActionRunner(roleHint: "an owner, admin or editor")
  @State private var addHostIDs: Set<String> = []
  @State private var updating: PendingUpdate?
  @State private var removing: PendingRemoval?

  private var listingID: String { slot["pluginId"] ?? "" }
  private var api: MarketplaceAPI { MarketplaceAPI(api: context.api) }
  private var canChange: Bool { installRoles.contains(context.orgRole ?? "") }
  /// The site an org-scope route is asked through: the console passes the first site.
  private var actingHostID: String { model.sites.first?.id ?? "" }

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.two) {
      if let error = runner.error { AglynNotice(error, tone: .error) { runner.clear() } }
      if let notice = runner.notice { AglynNotice(notice, tone: .success) { runner.clear() } }
      if !model.loaded {
        SkeletonRows(count: 3)
      } else if !model.summary.installedAnywhere {
        AglynNotice(
          "This plugin is not installed in this organization. Install it from its marketplace listing.", tone: .info,
          actionTitle: "View listing", action: viewListing)
        Text("Not installed on any site in this organization.").font(AglynFont.caption).foregroundStyle(.secondary)
      } else {
        status
        whereItRuns
        settings
        permissions
      }
    }
    .task(id: listingID) { model.start(context, listingID: listingID) }
    .onDisappear { model.stop() }
    .sheet(item: $updating) { pending in updateSheet(pending) }
    .sheet(item: $removing) { pending in
      UninstallImpactSheet(
        context: context, name: model.name, pluginID: model.pluginID, scope: pending.scope, targets: pending.targets, runner: runner
      ) {
        let removal = pending
        removing = nil
        run {
          try await api.uninstall(listingID: listingID, hostID: removal.hostID ?? actingHostID, scope: removal.scope)
          runner.notice = "Removed \"\(model.name)\""
        }
      } onCancel: {
        removing = nil
      }
    }
  }

  private func viewListing() { context.navigate(marketplaceListingScreen, ["listing": listingID]) }

  // MARK: Status

  @ViewBuilder
  private var status: some View {
    let status = model.status
    let tone: AglynTone = status.state == .current ? .success : (status.state == .updateAvailable ? .info : .warning)
    if status.state == .updateAvailable {
      AglynNotice(updateStateLabel(status), tone: tone, actionTitle: "View listing", action: viewListing)
    } else {
      AglynNotice(updateStateLabel(status), tone: tone)
    }
  }

  // MARK: Where it runs

  @ViewBuilder
  private var whereItRuns: some View {
    let summary = model.summary
    let latest = model.offered
    let stale = latest.map { staleSites(summary.sites, latestVersion: $0) } ?? []
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text("Where it runs").font(AglynFont.headline).accessibilityAddTraits(.isHeader)
      Label(pluginSiteSetSummary(summary, siteCount: model.sites.count), systemImage: "checkmark.circle.fill")
        .font(AglynFont.subheadline).foregroundStyle(AglynColor.success)
      ForEach(summary.sites) { site in
        HStack(spacing: AglynSpace.one) {
          Text(site.label).font(AglynFont.subheadline).lineLimit(1)
          Spacer(minLength: 0)
          Text("v\(site.version ?? "—")").font(AglynFont.caption).foregroundStyle(.secondary)
          if site.shadowed { StatusChip("Overrides org", tone: .neutral) }
        }
        if site.pinnedBy == .host {
          HStack(spacing: AglynSpace.two) {
            if let latest, stale.contains(where: { $0.hostID == site.hostID }) {
              Button("Update to v\(latest)") { updating = PendingUpdate(hostIDs: [site.hostID], label: site.label) }
                .accessibilityIdentifier("update-\(site.hostID)")
            }
            Button("Remove", role: .destructive) {
              removing = PendingRemoval(
                scope: .host, hostID: site.hostID, targets: resolveUninstallTargets(summary, scope: .host, hostID: site.hostID))
            }
            .accessibilityIdentifier("remove-\(site.hostID)")
          }
          .buttonStyle(.borderless).disabled(!canChange || runner.busy)
        }
      }
      if let latest, !stale.isEmpty {
        let all = pluginUpdateAll(summary, stale: stale, latestVersion: latest)
        if summary.orgWide { AglynNotice(pluginOrgWideUpdateNote, tone: .info) }
        Button(all.label) { updating = PendingUpdate(hostIDs: all.hostIDs, label: all.target) }
          .buttonStyle(.aglynSecondary).disabled(!canChange || runner.busy)
          .accessibilityIdentifier("update-all")
      }
      if !summary.orgWide, !summary.availableHostIDs.isEmpty { addToSites(summary) }
      Divider()
      if summary.orgWide {
        Button("Split into per-site installs") { split(summary) }
          .buttonStyle(.aglynSecondary).disabled(!canChange || runner.busy || model.sites.isEmpty)
        Text("Pins each site separately so you can update them one at a time. Sites you add later will not get this plugin automatically.")
          .font(AglynFont.caption).foregroundStyle(.secondary)
        Button("Uninstall org-wide", role: .destructive) {
          removing = PendingRemoval(scope: .org, hostID: nil, targets: resolveUninstallTargets(summary, scope: .org))
        }
        .buttonStyle(.borderless).disabled(!canChange || runner.busy)
        .accessibilityIdentifier("uninstall-org")
      } else {
        Button("Install for the whole organization") { promote(summary) }
          .buttonStyle(.aglynSecondary).disabled(!canChange || runner.busy)
          .accessibilityIdentifier("install-org")
      }
      if !canChange {
        Text("Installing needs the owner, admin or editor role in the workspace.").font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
  }

  @ViewBuilder
  private func addToSites(_ summary: OrgInstallSummary) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("Add to more sites").font(AglynFont.caption).foregroundStyle(.secondary)
      ForEach(summary.availableHostIDs, id: \.self) { hostID in
        Toggle(
          model.sites.first { $0.id == hostID }?.label ?? hostID,
          isOn: Binding(
            get: { addHostIDs.contains(hostID) },
            set: { on in if on { addHostIDs.insert(hostID) } else { addHostIDs.remove(hostID) } })
        )
        .font(AglynFont.subheadline)
      }
      Button("Add to selected") {
        let chosen = summary.availableHostIDs.filter { addHostIDs.contains($0) }
        install(steps: chosen.map { (InstallTarget.host, $0 as String?) }, updating: false, version: nil)
      }
      .buttonStyle(.aglynSecondary).disabled(!canChange || runner.busy || addHostIDs.isEmpty)
      .accessibilityIdentifier("add-selected")
    }
  }

  // MARK: Settings

  /// The plugin's own settings, where its manifest declares any (`PluginConfigCards` for a pin's manifest).
  @ViewBuilder
  private var settings: some View {
    if let manifest = model.pin?.manifest.map({ manifestJSON($0) }), manifestSettingsFields(manifest) != nil {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        Text("Settings").font(AglynFont.headline).accessibilityAddTraits(.isHeader)
        Button {
          context.navigate(marketplacePluginSettingsScreen, ["listing": listingID])
        } label: {
          AglynRow("\(model.name) settings", subtitle: "How it behaves for this workspace", systemImage: "gearshape") {
            Image(systemName: "chevron.forward").font(.caption).foregroundStyle(.tertiary)
          }
        }
        .buttonStyle(.aglynRow)
        .accessibilityIdentifier("plugin-settings")
      }
    }
  }

  // MARK: Permissions & data

  @ViewBuilder
  private var permissions: some View {
    let manifest = model.pin?.manifest
    let capabilities = (manifest?["capabilities"] as? [Any])?.compactMap { $0 as? String } ?? []
    let network =
      (manifest?["network"] as? [Any])?.compactMap { $0 as? String } ?? (manifest?["networkHosts"] as? [Any])?.compactMap { $0 as? String }
      ?? []
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      Text("Permissions & data").font(AglynFont.headline).accessibilityAddTraits(.isHeader)
      Text("Capabilities").font(AglynFont.subheadline)
      Text(capabilities.isEmpty ? "None declared — it cannot reach host data directly." : capabilities.joined(separator: ", "))
        .font(AglynFont.caption).foregroundStyle(.secondary)
      Text("Network allowlist").font(AglynFont.subheadline)
      Text(network.isEmpty ? "No network origins declared; its CSP blocks outbound requests." : network.joined(separator: ", "))
        .font(AglynFont.caption).foregroundStyle(.secondary)
    }
  }

  // MARK: Changing it

  private func run(_ block: @escaping @MainActor () async throws -> Void) {
    runner.run {
      try await block()
      await model.reloadPins(context, listingID: listingID)
      addHostIDs = []
    }
  }

  /// Installs (or moves) the pin at each step, one after another, and says how it went (`installPlan`).
  private func install(steps: [(InstallTarget, String?)], updating: Bool, version: String?) {
    guard !steps.isEmpty else { return }
    run {
      var installed = 0
      var errors: [String] = []
      var warnings: [String] = []
      for (scope, hostID) in steps {
        do {
          let outcome = try await api.installPlugin(listingID: listingID, hostID: scope == .host ? (hostID ?? "") : actingHostID, scope: scope)
          installed += 1
          if let warning = outcome.warning { warnings.append(warning) }
        } catch {
          errors.append(runner.describe(error))
        }
      }
      let outcome = installPlanOutcome(
        name: model.name, installed: installed, errors: errors, orgWide: steps.contains { $0.0 == .org }, updating: updating, version: version)
      if outcome.tone == "error" { runner.error = outcome.text } else { runner.notice = ([outcome.text] + warnings).joined(separator: " ") }
    }
  }

  /// "Install for the whole organization": the workspace pin, then the sites' own pins go (`promote`).
  private func promote(_ summary: OrgInstallSummary) {
    run {
      let outcome = try await api.installPlugin(listingID: listingID, hostID: actingHostID, scope: .org)
      for hostID in summary.hostPinnedIDs { try await api.uninstall(listingID: listingID, hostID: hostID, scope: .host) }
      runner.notice = "Installed \"\(model.name)\" for the whole organization" + (outcome.warning.map { " \($0)" } ?? "")
    }
  }

  /// "Split into per-site installs": a pin on each site, then the workspace's goes.
  private func split(_ summary: OrgInstallSummary) {
    let hostIDs = model.sites.map(\.id)
    run {
      for hostID in hostIDs { _ = try await api.installPlugin(listingID: listingID, hostID: hostID, scope: .host) }
      try await api.uninstall(listingID: listingID, hostID: actingHostID, scope: .org)
      runner.notice = "Installed \"\(model.name)\" on \(hostIDs.count) site\(hostIDs.count == 1 ? "" : "s")"
    }
  }

  // MARK: The update confirmation

  @ViewBuilder
  private func updateSheet(_ pending: PendingUpdate) -> some View {
    UpdateSheet(
      listingID: listingID, name: model.name, latestVersion: model.offered ?? "", label: pending.label, singleSite: pending.hostIDs?.count == 1,
      api: api, runner: runner,
      onConfirm: {
        updating = nil
        install(
          steps: pending.hostIDs.map { $0.map { (InstallTarget.host, $0 as String?) } } ?? [(InstallTarget.org, nil)], updating: true,
          version: model.offered)
      },
      onCancel: { updating = nil })
  }
}

/// "Update to vX?": the version pair, the publisher's changelog and which sites take it.
private struct UpdateSheet: View {
  let listingID: String
  let name: String
  let latestVersion: String
  let label: String
  let singleSite: Bool
  let api: MarketplaceAPI
  let runner: PluginActionRunner
  let onConfirm: () -> Void
  let onCancel: () -> Void
  @State private var changelog: String??

  var body: some View {
    let prompt = pluginUpdatePrompt(name: name, latestVersion: latestVersion, label: label, singleSite: singleSite)
    AglynActionSheet(
      prompt.title, message: prompt.note, confirmLabel: "Update", busy: runner.busy, error: nil, onCancel: onCancel, onConfirm: onConfirm
    ) {
      Text(prompt.body)
      if let others = prompt.others { Text(others).font(AglynFont.caption).foregroundStyle(.secondary) }
      VStack(alignment: .leading, spacing: 4) {
        Text("What's new").font(AglynFont.subheadline)
        switch changelog {
        case .none: Text("Loading the changelog…").foregroundStyle(.secondary)
        case .some(.none): Text("The publisher did not describe this version.").foregroundStyle(.secondary)
        case .some(.some(let text)): Text(text)
        }
      }
    }
    .task {
      let versions = await api.versions(listingID: listingID)
      changelog = .some(versions.first { $0.version == latestVersion }?.changelog)
    }
  }
}

/// What removing the plugin would break, before it happens (`UninstallImpactDialog`).
private struct UninstallImpactSheet: View {
  let context: NativePluginContext
  let name: String
  let pluginID: String
  let scope: InstallTarget
  let targets: [UninstallTarget]
  let runner: PluginActionRunner
  let onConfirm: () -> Void
  let onCancel: () -> Void
  @State private var impact: UninstallImpact?
  @State private var failed = false
  @State private var typed = ""

  private var view: UninstallImpactView {
    uninstallImpactView(name: name, scope: scope, pluginID: pluginID, targets: targets, impact: impact, failed: failed)
  }

  var body: some View {
    let view = view
    AglynActionSheet(
      view.title, message: view.note, confirmLabel: view.confirmLabel,
      confirmEnabled: !view.scanning && (!view.needsAcknowledgement || typed.trimmingCharacters(in: .whitespaces).uppercased() == uninstallAcknowledgement),
      destructive: true, busy: runner.busy, error: nil, onCancel: onCancel, onConfirm: onConfirm
    ) {
      if view.scanning {
        HStack(spacing: AglynSpace.one) {
          ProgressView().controlSize(.small)
          Text("Checking what this would break…").foregroundStyle(.secondary)
        }
      }
      ForEach(view.alerts, id: \.text) { alert in
        AglynNotice(alert.text, tone: alert.tone == "error" ? .error : (alert.tone == "warning" ? .warning : .info))
      }
      ForEach(view.sites, id: \.label) { site in
        VStack(alignment: .leading, spacing: 2) {
          Text(site.label).font(AglynFont.subheadline)
          Text(site.pages).font(AglynFont.caption).foregroundStyle(.secondary)
          Text(site.chips.joined(separator: " · ")).font(AglynFont.caption)
        }
      }
      if view.needsAcknowledgement {
        TextField("Type \(uninstallAcknowledgement) to confirm", text: $typed)
          #if os(iOS)
            .textInputAutocapitalization(.characters)
          #endif
          .autocorrectionDisabled()
          .accessibilityIdentifier("uninstall-acknowledgement")
      }
    }
    .task(id: targets.map(\.hostID).joined(separator: ",")) {
      impact = nil
      failed = false
      guard !pluginID.isEmpty, targets.contains(where: { !$0.stillCovered }) else { return }
      let body: [String: Any] = [
        "pluginId": pluginID, "hostIds": targets.map(\.hostID), "stillCoveredHostIds": targets.filter(\.stillCovered).map(\.hostID),
      ]
      do {
        let answer = try await context.api.request("/api/hosts/plugin-impact", method: .post, body: JSONValue.from(body))
        if let parsed = UninstallImpact(answer) { impact = parsed } else { failed = true }
      } catch {
        failed = true
      }
    }
  }
}

// MARK: A marketplace plugin's settings

/// The pin the page reads a plugin's manifest off: the workspace's own, else the first site's that holds one.
@MainActor
func findListingPin(_ context: NativePluginContext, listingID: String) async -> FirestoreDocument? {
  guard let orgID = context.orgID, !listingID.isEmpty else { return nil }
  if let pin = try? await context.firestore.readOnce(["orgs", orgID, "installs", listingID]) { return pin }
  let sites = ((try? await context.firestore.readOnce(sitesQuery(uid: context.uid, orgID: orgID))) ?? []).map(\.id)
  for site in sites {
    if let pin = try? await context.firestore.readOnce(["hosts", site, "installs", listingID]) { return pin }
  }
  return nil
}

/// A marketplace plugin's workspace settings, drawn from the fields its manifest declares as the built-in plugins' are
/// (`manifestSettingsScreen`): a form saved to `orgs/{org}/pluginSettings/{plugin}`.
struct PluginSettingsScreen: View {
  let context: NativePluginContext
  let listingID: String
  @State private var spec: ScreenSpec??

  var body: some View {
    Group {
      switch spec {
      case .none: List { SkeletonRows(count: 4) }.aglynListBackground()
      case .some(.none):
        AglynEmptyState("No settings", systemImage: "gearshape", message: "This plugin does not declare any settings.")
      case .some(.some(let spec)): SpecScreenView(spec: spec, context: context)
      }
    }
    .task(id: listingID) {
      spec = nil
      let pin = await findListingPin(context, listingID: listingID)
      let name = pin?.string("displayName") ?? pin?.string("pluginId") ?? listingID
      let pluginID = pin?.string("pluginId") ?? (pin?.manifest?["id"] as? String) ?? listingID
      let manifest = pin?.manifest.map { manifestJSON($0) }
      spec = .some(manifestSettingsScreen(pluginID: pluginID, label: name, manifest: manifest).flatMap(ScreenSpec.init))
    }
  }
}
