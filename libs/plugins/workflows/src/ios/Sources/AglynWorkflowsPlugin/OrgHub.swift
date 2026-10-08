// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The organization's automations: written once, placed on the sites it chooses,
/// switched on and off, paused per site, deleted — through the manage and pause routes.
struct OrgAutomationsSection: View {
  let context: NativePluginContext
  let orgID: String
  let sites: OrgSites
  let entitlements: AutomationEntitlements?
  @State private var live = LiveQuery()
  @State private var confirm: PendingConfirm?

  private var api: AutomationAPI { context.automationAPI }

  var body: some View {
    let docs = live.docs ?? []
    let rows = sortedOrgAutomations(docs)
    let canEdit = sites.canEdit
    List {
      Section {
        Text(
          "Write an automation once and run it on every site you choose. Each run is that site’s own: its email goes from that site, it counts on that site’s action runs, and the site can pause it for itself. Pro plans and up."
        )
        .font(AglynFont.subheadline).foregroundStyle(.secondary)
        if live.docs == nil {
          SkeletonRows(count: 2)
        } else if live.failed && rows.isEmpty {
          AglynNotice("Could not load the organization’s automations.", tone: .error)
        } else if rows.isEmpty {
          Text("No org automations yet.").foregroundStyle(.secondary).accessibilityIdentifier("org-automations-empty")
        }
        ForEach(rows) { row in
          OrgAutomationRowView(
            row: row, sites: sites.sites, canEdit: canEdit,
            onToggle: { on in report(nil) { try await api.setOrgAutomationEnabled(orgID: orgID, id: row.id, enabled: on) } },
            onResume: { hostID in report(nil) { try await api.pause(hostID: hostID, automationID: row.id, paused: false) } },
            onPause: { hostID in report(nil) { try await api.pause(hostID: hostID, automationID: row.id, paused: true) } },
            onEdit: { context.navigate(orgAutomationScreen, ["id": row.id]) },
            onDelete: { delete(row) })
        }
      } header: {
        Text("Org automations")
      } footer: {
        if docs.count > AutomationCeilings.orgAutomations {
          Text("Showing \(AutomationCeilings.orgAutomations) org automations, the most an organization holds.")
        }
      }
      if canEdit {
        Section {
          Button {
            add()
          } label: {
            Label("Add org automation", systemImage: "plus")
          }
          .accessibilityIdentifier("add-org-automation")
        }
      }
    }
    .aglynListBackground()
    .accessibilityIdentifier("org-automations-list")
    .automationConfirm($confirm)
    .task(id: orgID) { live.start(context.firestore, AutomationQueries.orgAutomations(orgID)) }
    .onDisappear { live.stop() }
  }

  private func add() {
    guard let entitlements else { return }
    guard entitlements.has("actions") else {
      return AutomationToasts.shared.show(
        "Org automations are built from the actions builder, which requires a Pro plan — see Billing to upgrade", .warning)
    }
    context.navigate(orgAutomationScreen, ["id": "new"])
  }

  private func delete(_ row: OrgAutomationRow) {
    confirm = PendingConfirm(
      title: "Delete this org automation?",
      message: "\"\(row.name)\" stops running on every site it is placed on, and anyone waiting inside it stops too.",
      action: "Delete"
    ) {
      report(nil) { try await api.deleteOrgAutomation(orgID: orgID, id: row.id) }
    }
  }
}

/// One org automation: its switch, what it does, where it runs, where it is paused, and its controls.
struct OrgAutomationRowView: View {
  let row: OrgAutomationRow
  let sites: [WorkspaceSite]
  let canEdit: Bool
  let onToggle: (Bool) -> Void
  let onResume: (String) -> Void
  let onPause: (String) -> Void
  let onEdit: () -> Void
  let onDelete: () -> Void

  var body: some View {
    let paused = row.pausedHostIDs
    let pausable = placedSites(row, sites: sites).filter { !paused.contains($0) }
    HStack(alignment: .top, spacing: AglynSpace.oneAndHalf) {
      Toggle("Switched on", isOn: Binding(get: { row.enabled }, set: onToggle))
        .labelsHidden()
        .disabled(!canEdit)
        .accessibilityLabel("Switch \(row.name) on or off")
        .accessibilityIdentifier("org-\(row.id)-switch")
      VStack(alignment: .leading, spacing: AglynSpace.half) {
        AutomationRowLabel(title: row.name, caption: row.caption, detail: placementLine(row, sites: sites))
        if !paused.isEmpty {
          FlowChips(paused) { hostID in
            if canEdit {
              Button {
                onResume(hostID)
              } label: {
                HStack(spacing: 4) {
                  Text("Paused on \(siteName(hostID, sites))")
                  Image(systemName: "xmark.circle.fill").imageScale(.small)
                }
                .font(AglynFont.caption.weight(.semibold))
                .padding(.horizontal, 8).padding(.vertical, 3)
                .foregroundStyle(AglynColor.warning)
                .background(AglynColor.warning.opacity(0.14), in: Capsule())
              }
              .buttonStyle(.plain)
              .accessibilityLabel("Paused on \(siteName(hostID, sites)). Resume there")
            } else {
              StatusChip("Paused on \(siteName(hostID, sites))", tone: .warning)
            }
          }
        }
      }
      if canEdit {
        Menu {
          Button(action: onEdit) { Label("Edit", systemImage: "pencil") }
          Menu {
            ForEach(pausable, id: \.self) { hostID in
              Button("Pause on \(siteName(hostID, sites))") { onPause(hostID) }
            }
          } label: {
            Label("Pause on…", systemImage: "pause")
          }
          .disabled(pausable.isEmpty)
          Button(role: .destructive, action: onDelete) { Label("Delete", systemImage: "trash") }
        } label: {
          Image(systemName: "ellipsis.circle").imageScale(.large).foregroundStyle(AglynColor.tint)
            .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Actions for \(row.name)")
        .accessibilityIdentifier("org-\(row.id)-menu")
      }
    }
    .accessibilityIdentifier("org-\(row.id)")
  }
}

/// Chips that wrap onto as many lines as they need.
struct FlowChips<Content: View>: View {
  let items: [String]
  let chip: (String) -> Content

  init(_ items: [String], @ViewBuilder chip: @escaping (String) -> Content) {
    self.items = items
    self.chip = chip
  }

  var body: some View {
    FlowLayout(spacing: AglynSpace.half) {
      ForEach(items, id: \.self) { chip($0) }
    }
  }
}

/// A left-to-right layout that wraps.
struct FlowLayout: Layout {
  var spacing: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0
    var y: CGFloat = 0
    var line: CGFloat = 0
    var widest: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > 0 && x + size.width > width {
        y += line + spacing
        x = 0
        line = 0
      }
      x += size.width + spacing
      line = max(line, size.height)
      widest = max(widest, x - spacing)
    }
    return CGSize(width: proposal.width ?? widest, height: y + line)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX
    var y = bounds.minY
    var line: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > bounds.minX && x + size.width > bounds.maxX {
        y += line + spacing
        x = bounds.minX
        line = 0
      }
      subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      line = max(line, size.height)
    }
  }
}

// MARK: - Every site's own

/// "Workflows / Actions / Webhooks on every site": each site's own, side by side; a row opens that site's Automation.
struct OrgSiteListSection: View {
  let context: NativePluginContext
  let kind: OrgSiteKind
  let sites: OrgSites
  let entitlements: AutomationEntitlements?
  @State private var showAll = false
  @State private var loaders: [String: LiveQuery] = [:]

  private var canRead: Bool { kind != .webhooks || sites.canEdit }

  var body: some View {
    let reachable = Array(sites.sites.prefix(AutomationCeilings.orgSitesMax))
    let shown = showAll ? reachable : Array(reachable.prefix(AutomationCeilings.orgSitesOpen))
    let folded = reachable.count - shown.count
    List {
      Section {
        Text(kind.intro).font(AglynFont.subheadline).foregroundStyle(.secondary)
        if !canRead {
          AglynNotice("Each site’s \(kind.rawValue) are listed for its admins and editors.", tone: .info)
        } else if !sites.ready {
          SkeletonRows(count: 2)
        } else if sites.sites.isEmpty {
          Text("This organization has no sites yet.").foregroundStyle(.secondary)
        }
      } header: {
        HubSectionHeader(title: kind.header) {
          if kind != .webhooks {
            RunQuotaLineView(
              context: context, counter: kind == .workflows ? .workflowRuns : .actionRuns, orgID: context.orgID,
              hostID: nil, entitlements: entitlements)
          }
        }
      }
      if canRead {
        ForEach(shown) { site in
          OrgSiteRowsSection(context: context, site: site, kind: kind, live: loaders[site.id])
        }
        if folded > 0 || sites.sites.count > AutomationCeilings.orgSitesMax || !sites.sites.isEmpty {
          Section {
            if folded > 0 {
              Button("Show \(folded) more \(folded == 1 ? "site" : "sites")") { showAll = true }
                .accessibilityIdentifier("org-sites-more")
            }
            if !sites.sites.isEmpty {
              Menu {
                ForEach(sites.sites) { site in
                  Button(siteName(site.id, sites.sites)) { open(site.id) }
                }
              } label: {
                Label("Add \(kind.noun) on a site", systemImage: "plus")
              }
              .accessibilityIdentifier("org-add-on-site")
            }
          } footer: {
            if sites.sites.count > AutomationCeilings.orgSitesMax {
              Text("Listing the first \(AutomationCeilings.orgSitesMax) sites. Open a site’s own Automation for the \(kind.rawValue) of the rest.")
            }
          }
        }
      }
    }
    .aglynListBackground()
    .accessibilityIdentifier("org-\(kind.rawValue)-list")
    .task(id: canRead ? shown.map(\.id) : []) {
      guard canRead else { return }
      for site in shown where loaders[site.id] == nil {
        let live = LiveQuery()
        live.start(context.firestore, AutomationQueries.orgSiteRows(site.id, kind: kind))
        loaders[site.id] = live
      }
    }
    .onDisappear {
      loaders.values.forEach { $0.stop() }
      loaders = [:]
    }
  }

  private func open(_ hostID: String) {
    context.navigate(automationScreen, ["hostId": hostID, "section": kind.rawValue])
  }
}

/// One site's rows in an org hub list, read ten at a time.
struct OrgSiteRowsSection: View {
  let context: NativePluginContext
  let site: WorkspaceSite
  let kind: OrgSiteKind
  let live: LiveQuery?

  var body: some View {
    let name = site.name.isEmpty ? (site.subdomain.isEmpty ? site.id : site.subdomain) : site.name
    let (rows, truncated) = orgSiteRows(live?.docs ?? [], kind: kind)
    Section {
      if live?.docs == nil {
        SkeletonRows(count: 1)
      } else if live?.failed == true {
        Text("Could not read this site’s \(kind.rawValue).").font(AglynFont.caption).foregroundStyle(.secondary)
      } else if rows.isEmpty {
        Text("None yet.").font(AglynFont.caption).foregroundStyle(.secondary)
      }
      ForEach(rows) { row in
        Button {
          open()
        } label: {
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text(row.name).font(AglynFont.body).foregroundStyle(.primary)
              Text(row.trigger).font(AglynFont.caption).foregroundStyle(.secondary)
            }
            Spacer()
            StatusChip(row.status, tone: row.status == "Off" ? .neutral : .success)
          }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("org-site-\(site.id)-\(row.id)")
      }
      if truncated {
        Button("\(name) has more than \(AutomationCeilings.orgSiteRows) — open the site to see them all") { open() }
          .font(AglynFont.caption)
      }
    } header: {
      HStack {
        Text(name)
        Spacer()
        Button("Open") { open() }.font(AglynFont.caption).buttonStyle(.borderless)
      }
    }
  }

  private func open() {
    context.navigate(automationScreen, ["hostId": site.id, "section": kind.rawValue])
  }
}
