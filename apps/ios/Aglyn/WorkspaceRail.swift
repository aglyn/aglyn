// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI
import UniformTypeIdentifiers

/// The workspace rail on the Mac and iPad (AGL-3945, Figma Rail 12:338 "Many workspaces"): up to five pinned workspaces
/// in the order the person drags them, a divider, up to three recent under "Recent", a divider, then "All workspaces"
/// with the total, which opens the picker where pins are edited. Every account gets this rail, however few workspaces it
/// has (AGL-3996). At the foot: Admin for staff, Create new, and the person's photo.
struct WorkspaceRail: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  /// Unread notifications, by workspace.
  let unread: [String: Int]
  /// The name bubble beside the tile under the pointer (AGL-3996).
  @State private var tooltip = AglynRailTooltipState()

  static var width: CGFloat { AglynShellMetrics.railWidth }

  var body: some View {
    let rail = railModel
    VStack(spacing: 0) {
      ScrollView(.vertical, showsIndicators: false) {
        VStack(spacing: AglynShellMetrics.railGap) {
          if !rail.pinned.isEmpty {
            caption("Pinned")
            ForEach(rail.pinned, id: \.self) { tile($0, pinned: true) }
          }
          if !rail.recent.isEmpty {
            if !rail.pinned.isEmpty { railDivider }
            caption("Recent")
            ForEach(rail.recent, id: \.self) { tile($0, pinned: false) }
          }
          if rail.allTile {
            if !rail.pinned.isEmpty || !rail.recent.isEmpty { railDivider }
            Button {
              navigation.picker = .workspace
            } label: {
              AglynRailButton(systemImage: "square.grid.2x2", caption: "\(rail.total)", size: AglynShellMetrics.tile)
            }
            .buttonStyle(.plain)
            .aglynRailTooltip("All workspaces", id: "rail-all-workspaces", state: tooltip)
            .accessibilityLabel("All workspaces, \(rail.total)")
            .accessibilityIdentifier("rail-all-workspaces")
          }
        }
        // PINNED starts 17 points down, the gap between the rail's sections (Figma Rail 12:338).
        .padding(.top, 17)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity)
      }
      VStack(spacing: AglynShellMetrics.railGap) {
        if model.claims.isStaff {
          Button {
            navigation.enter(.admin, first: ShellScope(model: model, navigation: navigation).firstSection(of: .admin))
          } label: {
            AglynRailButton(systemImage: "shield", size: AglynShellMetrics.utility)
          }
          .buttonStyle(.plain)
          .aglynRailTooltip("Admin", id: "rail-admin", state: tooltip)
          .accessibilityLabel("Admin")
          .accessibilityIdentifier("rail-admin")
        }
        CreateNewButton()
          .aglynRailTooltip("Create new", id: "rail-create", state: tooltip)
        AccountMenuButton(size: AglynShellMetrics.avatar)
          .aglynRailTooltip(AccountIdentity(model: model).name, id: "rail-account", state: tooltip)
      }
      .padding(.vertical, 12)
    }
    // Outside the scroll view, so a bubble is never clipped by it; WideShell raises the rail over the sidebar.
    .aglynRailTooltipHost(tooltip)
    .frame(width: Self.width)
    .frame(maxHeight: .infinity)
    .background(AglynColor.rail)
    .overlay(alignment: .trailing) { Rectangle().fill(AglynColor.divider).frame(width: 1) }
    .task(id: (model.preferences?.pinned ?? []) + (model.preferences?.recentOrgs ?? [])) {
      model.workspace?.loadOrgs((model.preferences?.pinned ?? []) + (model.preferences?.recentOrgs ?? []))
    }
    .task(id: rail.pinned + rail.recent + rail.rest) { model.workspace?.loadLogos(rail.pinned + rail.recent + rail.rest) }
  }

  /// The rail for this account (`railWorkspaces`): every workspace the store knows; the server's count, when it has
  /// answered, is the total under the All tile.
  private var railModel: RailWorkspaces {
    let orgs = model.workspace?.orgs.map(\.id) ?? []
    var rail = railWorkspaces(orgs, pinned: model.preferences?.pinned ?? [], recent: model.preferences?.recentOrgs ?? [])
    if let count = model.workspace?.orgCount, count > rail.total { rail.total = count }
    return rail
  }

  private func caption(_ text: String) -> some View {
    Text(text.uppercased())
      .font(.system(size: AglynShellMetrics.railCaption, weight: .semibold))
      .kerning(AglynShellMetrics.railCaptionTracking)
      .foregroundStyle(AglynColor.railText)
      .accessibilityHidden(true)
  }

  /// Between the rail's sections: a hairline in border/strong, which reads on the rail's tinted ground where the
  /// sidebar's border/subtle vanished (AGL-3996).
  private var railDivider: some View {
    Rectangle().fill(AglynColor.borderStrong).frame(width: AglynShellMetrics.railDivider, height: 1)
      .accessibilityHidden(true)
  }

  @ViewBuilder
  private func tile(_ orgID: String, pinned: Bool) -> some View {
    if let org = model.workspace?.orgs.first(where: { $0.id == orgID }) {
      let logo = model.workspace?.orgLogos[orgID]
      let selected = orgID == model.workspace?.org?.id
      let pins = model.preferences?.pinned ?? []
      let tileView = Button {
        open(orgID)
      } label: {
        AglynWorkspaceTile(
          name: org.name, logoURL: model.mediaURL(logo?.light, hostID: nil),
          darkLogoURL: model.mediaURL(logo?.dark, hostID: nil), colorHex: model.workspaceColor(orgID).color,
          selected: selected, unread: unread[orgID] ?? 0, initials: workspaceInitial(org.name))
          .aglynRailTooltip(org.name, id: orgID, state: tooltip)
      }
      .buttonStyle(.plain)
      // The workspace in use: a 3-point bar at the rail's leading edge beside its ring.
      .frame(maxWidth: .infinity)
      .overlay(alignment: .leading) {
        if selected {
          UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: 0, bottomTrailingRadius: 2, topTrailingRadius: 2)
            .fill(AglynColor.accentIcon).frame(width: AglynShellMetrics.railBar.width, height: AglynShellMetrics.railBar.height)
        }
      }
      .accessibilityIdentifier("rail-org-\(orgID)")
      .contextMenu { RailTileMenu(org: org) }
      if pinned {
        tileView
          .draggable(orgID)
          .dropDestination(for: String.self) { dropped, _ in
            var order = pins
            guard let moved = dropped.first, moved != orgID, let target = order.firstIndex(of: orgID),
              let from = order.firstIndex(of: moved)
            else { return false }
            order.remove(at: from)
            order.insert(moved, at: target)
            model.preferences?.reorderPins(order)
            return true
          }
      } else {
        tileView
      }
    }
  }

  private func open(_ orgID: String) {
    if orgID == model.workspace?.org?.id {
      navigation.enterWorkspace()
    } else {
      model.workspace?.open(orgID: orgID)
      navigation.enterWorkspace()
    }
  }
}

/// Right-click (or, on a touch screen, long-press) a rail tile: the workspace's name as the menu's title, then Pin or
/// Unpin, Move up, Move down, Workspace color, Workspace settings. The title is how a touch screen names a tile, since
/// it has no pointer to show the bubble.
struct RailTileMenu: View {
  let org: WorkspaceOrg

  var body: some View {
    Section(org.name) { RailTileMenuItems(org: org) }
  }
}

private struct RailTileMenuItems: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let org: WorkspaceOrg

  var body: some View {
    let pins = model.preferences?.pinned ?? []
    let index = pins.firstIndex(of: org.id)
    if let index {
      Button("Unpin", systemImage: "pin.slash") { model.preferences?.unpin(org.id) }
      Button("Move up", systemImage: "arrow.up") { model.preferences?.movePin(org.id, by: -1) }.disabled(index == 0)
      Button("Move down", systemImage: "arrow.down") { model.preferences?.movePin(org.id, by: 1) }
        .disabled(index == pins.count - 1)
    } else {
      Button("Pin", systemImage: "pin") {
        if model.preferences?.pin(org.id) == .full { navigation.pinFull = PendingPin(orgID: org.id, name: org.name) }
      }
    }
    Divider()
    Button("Workspace color…", systemImage: "paintpalette") {
      navigation.colorFor = ColorPickTarget(orgID: org.id, name: org.name)
    }
    Button("Workspace settings", systemImage: "gearshape") {
      model.workspace?.open(orgID: org.id)
      navigation.inSite = false
      navigation.enter(.workspaceSettings, first: ShellScope(model: model, navigation: navigation).firstSection(of: .workspaceSettings))
    }
  }
}

/// The filled "+" on the rail: Create new (Phase 2 lists the scope's create actions).
struct CreateNewButton: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation

  var body: some View {
    Menu {
      CreateNewItems()
    } label: {
      AglynRailButton(systemImage: "plus", filled: true, size: AglynShellMetrics.utility)
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .fixedSize()
    .accessibilityLabel("Create new")
    .accessibilityIdentifier("rail-create")
  }
}
