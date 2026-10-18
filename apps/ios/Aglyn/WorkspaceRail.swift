// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI
import UniformTypeIdentifiers

/// The workspace rail on the Mac and iPad (AGL-3945, Figma Rail 12:338): up to five pinned workspaces in the order the
/// person drags them, a divider, up to three recent, then "All workspaces" with the total; an account with eight or
/// fewer sees them all. At the foot: Admin for staff, Create new, and the person's photo.
struct WorkspaceRail: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  /// Unread notifications, by workspace.
  let unread: [String: Int]

  static let width: CGFloat = 68

  var body: some View {
    let rail = railModel
    VStack(spacing: 0) {
      ScrollView(.vertical, showsIndicators: false) {
        VStack(spacing: 10) {
          if !rail.pinned.isEmpty {
            caption("Pinned")
            ForEach(rail.pinned, id: \.self) { tile($0, pinned: true) }
          }
          if !rail.recent.isEmpty || !rail.rest.isEmpty {
            if !rail.pinned.isEmpty { railDivider }
            if !rail.recent.isEmpty { caption("Recent") }
            ForEach(rail.recent + rail.rest, id: \.self) { tile($0, pinned: false) }
          }
          if rail.allTile {
            railDivider
            Button {
              navigation.picker = .workspace
            } label: {
              AglynRailButton(systemImage: "square.grid.2x2", caption: "\(rail.total)")
            }
            .buttonStyle(.plain)
            .help("All workspaces")
            .accessibilityLabel("All workspaces, \(rail.total)")
            .accessibilityIdentifier("rail-all-workspaces")
          }
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
      }
      VStack(spacing: 12) {
        if model.claims.isStaff {
          Button {
            navigation.enter(.admin, first: ShellScope(model: model, navigation: navigation).firstSection(of: .admin))
          } label: {
            AglynRailButton(systemImage: "shield.lefthalf.filled")
          }
          .buttonStyle(.plain)
          .help("Admin")
          .accessibilityLabel("Admin")
          .accessibilityIdentifier("rail-admin")
        }
        CreateNewButton()
        AccountMenuButton()
      }
      .padding(.vertical, 12)
    }
    .frame(width: Self.width)
    .frame(maxHeight: .infinity)
    .background(AglynColor.rail)
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
      .font(.system(size: 9, weight: .semibold))
      .kerning(0.6)
      .foregroundStyle(AglynColor.railText)
      .accessibilityHidden(true)
  }

  private var railDivider: some View {
    Rectangle().fill(AglynColor.divider).frame(width: 28, height: 1).padding(.vertical, 2)
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
          selected: selected, unread: unread[orgID] ?? 0)
      }
      .buttonStyle(.plain)
      .help(pinned ? "\(org.name) (⌘\((pins.firstIndex(of: orgID) ?? 0) + 1))" : org.name)
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

/// Right-click a rail tile: Pin or Unpin, Move up, Move down, Workspace color, Workspace settings.
struct RailTileMenu: View {
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
      AglynRailButton(systemImage: "plus", filled: true)
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .fixedSize()
    .help("Create new")
    .accessibilityLabel("Create new")
    .accessibilityIdentifier("rail-create")
  }
}
