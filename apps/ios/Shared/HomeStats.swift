// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynSite
import AglynUI
import SwiftUI

// Home as an overview with its numbers (AGL-4011, Figma "Mac / Site / Home · Stats" and "Mac / Workspace / Home"): a
// site's Home is the console's dashboard (Traffic with View details, the cards the plugins draw, Recent activity); the
// workspace's Home is the console's organization row (the plan its team proposed, the cards that total every site). The
// cards themselves are AglynSite's and the plugins'; this file only places them.

/// The console's `orgDashboard` slot: the workspace Home's cards.
let orgDashboardSlot = "orgDashboard"

/// "At a glance": the cards the plugins draw on a site's Home (the console's `commerceGlance` and `hostDashboard`), two
/// to a row, a wide one on a row of its own. Every glance a plugin registers lands here, which is the seam a new one
/// slots into.
struct HomeGlanceGrid: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let title: String?
  /// The person's arrangement (Customize dashboard): hidden cards leave, the rest keep its order.
  var dashboard: DashboardPrefsStore? = nil

  /// The glance cards the plugins on for the scope draw, in their registered order.
  @MainActor
  static func widgets(_ model: AppModel, _ navigation: ShellNavigation) -> [NativeWidget] {
    let hasSite = model.scopedSite(navigation) != nil
    // Only the cards of plugins on for the scope, as the console's slot gates them (a site's set inside a site).
    let scope = ShellScope(model: model, navigation: navigation)
    let enabled = Set(hasSite ? scope.sitePlugins : scope.workspacePlugins)
    return model.registry.widgets(for: .aglyn)
      .filter { (hasSite || !$0.requiresSite) && ($0.pluginID == "core" || enabled.contains($0.pluginID)) }
  }

  /// The cards to draw: the scope's glance cards, less the ones the person switched off, in the person's order.
  private var shown: [NativeWidget] {
    let widgets = Self.widgets(model, navigation)
    guard let dashboard else { return widgets }
    return DashboardWidgets.ordered(
      widgets.filter { !dashboard.isHidden(DashboardWidgets.storedID($0.id)) }, order: dashboard.prefs.order
    ) { DashboardWidgets.storedID($0.id) }
  }

  var body: some View {
    let widgets = shown
    if !widgets.isEmpty, let context = model.context(for: navigation) {
      VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
        if let title { AglynSectionHeader(title) }
        AglynCardGrid(minimum: AglynSpace.of(32), maxColumns: 2, spacing: AglynSpace.two) {
          ForEach(widgets) { widget in
            widget.make(context)
              .aglynGridFullWidth(widget.size == .full)
              .id("\(widget.id):\(context.hostID ?? ""):\(model.refreshToken)")
          }
        }
      }
      .accessibilityIdentifier("home-glance")
    }
  }
}

/// A site's Home numbers, between Needs you and Pick up.
struct HomeSiteStats: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let site: WorkspaceSite
  /// Customize dashboard: the cards the person switched off are not drawn, and none is until the arrangement is read
  /// (the console's slots withhold theirs the same way, rather than drawing a card and taking it away).
  let dashboard: DashboardPrefsStore

  var body: some View {
    if let reader = model.reader, dashboard.ready {
      if !dashboard.isHidden(DashboardWidgets.trafficID) {
        SiteTrafficCard(reader: reader, api: model.api, hostID: site.id, refresh: model.refreshToken) {
          navigation.select(.analytics)
        }
      }
      HomeGlanceGrid(title: "At a glance", dashboard: dashboard)
      if !dashboard.isHidden(DashboardWidgets.activityID) {
        SiteActivityCard(reader: reader, api: model.api, hostID: site.id, limit: 5, refresh: model.refreshToken) {
          navigation.select(.plugin("core.site.activity"))
        }
      }
    }
  }

  /// Customize dashboard's rows: Traffic (it stays first, as on the console), the glance cards in the person's order
  /// (they move among themselves), and Recent activity.
  @MainActor
  static func customizeRows(_ model: AppModel, _ navigation: ShellNavigation, _ dashboard: DashboardPrefsStore)
    -> [DashboardCustomizeRow]
  {
    let glance = DashboardWidgets.ordered(HomeGlanceGrid.widgets(model, navigation), order: dashboard.prefs.order) {
      DashboardWidgets.storedID($0.id)
    }
    let group = glance.map { DashboardWidgets.storedID($0.id) }
    return [DashboardCustomizeRow(id: DashboardWidgets.trafficID, title: "Traffic")]
      + glance.map { DashboardCustomizeRow(id: DashboardWidgets.storedID($0.id), title: $0.title, groupIDs: group) }
      + [DashboardCustomizeRow(id: DashboardWidgets.activityID, title: "Recent activity", groupIDs: [DashboardWidgets.activityID])]
  }
}

/// The workspace's Home: the plan its team proposed (`.proposal`, under the workspace line), or the cards that total
/// every site (`.glance`, after Needs you).
struct HomeWorkspaceStats: View {
  enum Part { case proposal, glance }

  let part: Part
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @State private var org = ObservedDocument()
  @State private var member = ObservedDocument()

  private var orgID: String? { model.workspace?.org?.id }

  var body: some View {
    Group {
      switch part {
      case .proposal: proposal
      case .glance: orgRow
      }
    }
    .task(id: "\(orgID ?? ""):\(model.refreshToken)") {
      guard let orgID, let reader = model.reader, let uid = model.context(for: navigation)?.uid else { return }
      org.start(reader, ["orgs", orgID])
      member.start(reader, ["orgs", orgID, "members", uid])
    }
    .onDisappear {
      org.stop()
      member.stop()
    }
  }

  /// The console's `OrgUpgradeProposalCard`: only for the people who may buy it (`billing.manage`, custom roles
  /// included), only while the proposal stands.
  @ViewBuilder
  private var proposal: some View {
    if model.orgAccess.permissions(["billing.manage"])["billing.manage"] == true,
      let standing = UpgradeProposal.standing(org.document?.data),
      let slug = model.workspace?.org?.slug
    {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        ViewThatFits(in: .horizontal) {
          HStack(alignment: .center, spacing: AglynSpace.two) {
            title(standing)
            Spacer(minLength: AglynSpace.one)
            review(standing, slug: slug)
          }
          VStack(alignment: .leading, spacing: AglynSpace.one) {
            title(standing)
            review(standing, slug: slug)
          }
        }
        // The bundle proposed with the plan, named so the owner knows what Billing will have chosen (AGL-3956).
        if standing.bundled { Text(standing.summary).font(AglynFont.strongSubheadline) }
        Text(standing.body).font(AglynFont.subheadline).foregroundStyle(.secondary)
        if let note = standing.note { Text(note).font(AglynFont.subheadline) }
      }
      .padding(AglynSpace.two)
      .frame(maxWidth: .infinity, alignment: .leading)
      .aglynCardSurface()
      .accessibilityIdentifier("home-upgrade-proposal")
    }
  }

  private func title(_ standing: UpgradeProposal) -> some View {
    Text(standing.headline(orgName: model.workspace?.org?.name, productName: ContractValues.shared.platformBrandName))
      .font(AglynFont.headline)
  }

  private func review(_ standing: UpgradeProposal, slug: String) -> some View {
    Button("Review the plan") {
      _ = model.context(for: navigation)?.openLink(standing.destination(orgSlug: slug))
    }
    .buttonStyle(.aglynProminent)
    .accessibilityIdentifier("home-upgrade-review")
  }

  /// The console's `OrgDashboardWidgets`: the cards total the whole workspace, so only an org-wide member who may open
  /// the workspace's CRM (`data.manage`) sees the row.
  @ViewBuilder
  private var orgRow: some View {
    let reach = member.ready && AglynCore.OrgAccess.isOrgWideMember(member.document?.data)
    let enabled = Set(ShellScope(model: model, navigation: navigation).workspacePlugins)
    let widgets = model.registry.widgets(for: .aglyn, slot: orgDashboardSlot).filter { enabled.contains($0.pluginID) }
    if reach, model.orgAccess.permissions(["data.manage"])["data.manage"] == true, !widgets.isEmpty, let context = model.context(for: navigation) {
      VStack(alignment: .leading, spacing: AglynSpace.oneAndHalf) {
        AglynSectionHeader("At a glance")
        AglynCardGrid(minimum: AglynSpace.of(32), maxColumns: 2, spacing: AglynSpace.two) {
          ForEach(widgets) { widget in
            widget.make(context)
              .aglynGridFullWidth(widget.size == .full)
              .id("\(widget.id):\(model.refreshToken)")
          }
        }
      }
      .accessibilityIdentifier("home-org-glance")
    }
  }
}
