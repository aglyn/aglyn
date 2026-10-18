// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/// The sidebar for the scope a window stands in (AGL-3945, Figma Sidebar 12:703): the brand bar, the scope's header
/// (the workspace and its menu, or the way back to it and the site picker, or a settings mode's back and title), then the
/// manifest's groups, folded except the one in use and any the person opened. A Starred group lists what the person
/// starred here.
struct ShellSidebar: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @State private var filter = ""

  var body: some View {
    let scope = ShellScope(model: model, navigation: navigation)
    VStack(spacing: 0) {
      SidebarBrandHeader(name: model.brandName)
      ScopeHeader(scope: scope)
      if navigation.mode == .workspaceSettings || navigation.mode == .siteSettings {
        SettingsFilterField(text: $filter)
      }
      SidebarList(scope: scope, filter: filter)
        .safeAreaInset(edge: .bottom, spacing: 0) {
          if navigation.mode == .main { PlanCard() }
        }
    }
    .background(AglynColor.sidebar)
    .onChange(of: navigation.mode) { filter = "" }
  }
}

/// The search field atop a settings mode: settings get their own search (Calm rules).
private struct SettingsFilterField: View {
  @Binding var text: String

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
      TextField("Search settings", text: $text)
        .textFieldStyle(.plain)
        .accessibilityIdentifier("sidebar-settings-search")
    }
    .font(AglynFont.subheadline)
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).fill(AglynColor.page))
    .padding(.horizontal, 12)
    .padding(.bottom, 8)
  }
}

/// The head of the sidebar under the lockup.
struct ScopeHeader: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let scope: ShellScope

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      switch navigation.mode {
      case .main:
        if let site = scope.site {
          backButton(scope.org?.name ?? "Workspace", identifier: "sidebar-back-workspace") { navigation.enterWorkspace() }
          SiteButton(site: site)
        } else {
          WorkspaceButton()
        }
      case .workspaceSettings, .siteSettings, .admin:
        backButton(
          navigation.mode == .siteSettings ? (scope.site?.name ?? "Site") : navigation.mode == .admin ? "Back" : (scope.org?.name ?? "Workspace"),
          identifier: "sidebar-back-mode"
        ) { navigation.leaveMode() }
        Text(navigation.mode == .siteSettings ? "Site settings" : navigation.mode == .admin ? "Admin" : "Workspace settings")
          .font(AglynFont.title2)
          .accessibilityAddTraits(.isHeader)
          .accessibilityIdentifier("sidebar-mode-title")
      }
    }
    .padding(.horizontal, 12)
    .padding(.top, 12)
    .padding(.bottom, 8)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func backButton(_ title: String, identifier: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Label(title, systemImage: "chevron.left").font(AglynFont.subheadline).lineLimit(1)
        .foregroundStyle(AglynColor.secondaryText)
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier(identifier)
  }
}

/// The workspace's name and plan, opening the workspace menu.
private struct WorkspaceButton: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    let org = model.workspace?.org
    let logo = org.flatMap { model.workspace?.orgLogos[$0.id] }
    Menu {
      WorkspaceMenuItems()
    } label: {
      HStack(spacing: 10) {
        AglynWorkspaceTile(
          name: org?.name ?? "Workspace", logoURL: model.mediaURL(logo?.light, hostID: nil),
          darkLogoURL: model.mediaURL(logo?.dark, hostID: nil), colorHex: model.workspaceColor(org?.id).color,
          selected: false, size: 32)
        VStack(alignment: .leading, spacing: 3) {
          Text(org?.name ?? (model.workspace?.ready == true ? "No workspace" : "Loading…"))
            .font(AglynFont.headline).lineLimit(1)
            .foregroundStyle(.primary)
          if let plan = logo?.planLabel {
            Text(plan).font(AglynFont.caption).foregroundStyle(AglynColor.tint)
              .padding(.horizontal, 6).padding(.vertical, 1)
              .background(Capsule().fill(AglynColor.primary.opacity(0.14)))
          }
        }
        Spacer(minLength: 4)
        Image(systemName: "chevron.down").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
      }
      .contentShape(Rectangle())
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .accessibilityLabel("\(org?.name ?? "Workspace") menu")
    .accessibilityIdentifier("sidebar-workspace-menu")
  }
}

/// The site in use, opening the site picker.
private struct SiteButton: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let site: WorkspaceSite

  var body: some View {
    Button {
      navigation.picker = .site
    } label: {
      HStack(spacing: 8) {
        AglynBrandPicture(model.mediaURL(site.favicon, hostID: site.id), size: 22, cornerRadius: AglynRadius.control) {
          AglynWorkspaceTile(name: site.name, logoURL: nil, colorHex: model.workspaceColor(model.workspace?.org?.id).color, selected: false, size: 22)
        }
        Text(site.name).font(AglynFont.strongSubheadline).lineLimit(1).foregroundStyle(.primary)
        Spacer(minLength: 4)
        Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.secondary)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .background(
        RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).fill(AglynColor.page))
      .overlay(RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous).strokeBorder(AglynColor.divider))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help("Switch site")
    .accessibilityLabel("Site, \(site.name)")
    .accessibilityHint("Switches site")
    .accessibilityIdentifier("sidebar-site-picker")
  }
}

/// The list itself: groups and rows, starred items, folding, and each row's star.
struct SidebarList: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let scope: ShellScope
  var filter = ""
  /// The phone's Menu: rows push onto the stack instead of selecting a sidebar section.
  var push = false

  var body: some View {
    let list = scope.currentList
    let holding = ShellScope.group(holding: navigation.section, in: list)
    List {
      ForEach(list.groups, id: \.id) { group in
        groupView(group, open: isOpen(group, holding: holding))
      }
    }
    .listStyle(.sidebar)
    .scrollContentBackground(.hidden)
    .environment(\.defaultMinListRowHeight, 1)
    .accessibilityIdentifier("sidebar-list")
  }

  private func isOpen(_ group: NativeNavGroup, holding: String?) -> Bool {
    !group.foldable || !filter.isEmpty || group.id == holding || navigation.openGroups.contains(groupKey(group))
  }

  /// The fold state is remembered per scope kind and group (`site.sell`), on this device.
  private func groupKey(_ group: NativeNavGroup) -> String { "\(scope.currentList.id.rawValue).\(group.id)" }

  @ViewBuilder
  private func groupView(_ group: NativeNavGroup, open: Bool) -> some View {
    let rows = filtered(group.rows)
    let starred = group.dynamic == "starred" ? starredHere : []
    if group.dynamic == "starred" {
      if !starred.isEmpty && filter.isEmpty {
        header(group, open: open, hidden: starred.count)
        if open { ForEach(starred, id: \.key) { starredRow($0) } }
      }
    } else if !rows.isEmpty {
      if let label = group.label {
        if group.foldable {
          header(group, open: open, hidden: rows.count)
        } else {
          Text(label).font(AglynFont.caption).foregroundStyle(AglynColor.secondaryText)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 2, trailing: 12))
            .accessibilityAddTraits(.isHeader)
        }
      } else if group.id != list.groups.first?.id {
        Divider().listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 12))
      }
      if open { ForEach(rows, id: \.id) { rowView($0) } }
    }
  }

  private var list: ResolvedNavList { scope.currentList }

  private func header(_ group: NativeNavGroup, open: Bool, hidden: Int) -> some View {
    AglynSidebarGroupHeader(group.label ?? "", foldable: group.foldable, open: open, hiddenCount: hidden) {
      let key = groupKey(group)
      if navigation.openGroups.contains(key) { navigation.openGroups.remove(key) } else { navigation.openGroups.insert(key) }
    }
    .listRowBackground(Color.clear)
    .listRowInsets(EdgeInsets(top: 10, leading: 14, bottom: 2, trailing: 12))
    .accessibilityIdentifier("sidebar-group-\(group.id)")
  }

  private func filtered(_ rows: [NativeNavRow]) -> [NativeNavRow] {
    let text = filter.trimmingCharacters(in: .whitespaces)
    guard !text.isEmpty else { return rows }
    return rows.filter { scoreMatch(name: $0.label, extra: ($0.keywords ?? []) + [$0.description], query: text) != nil }
  }

  /// The starred items that belong where the window stands: this workspace, and this site when inside one.
  private var starredHere: [StarredItem] {
    (model.preferences?.starred ?? []).filter { item in
      item.orgId == scope.org?.id && (scope.site == nil ? item.hostId == nil : item.hostId == scope.site?.id)
    }
  }

  private func rowView(_ row: NativeNavRow) -> some View {
    let target = ShellScope.target(of: row)
    let selected = !push && ShellScope.row(row, holds: navigation.section)
    return label(row.label, icon: row.appleIcon, detail: row.description)
      .aglynSelectableRow(selected: selected, density: .sidebar) { activate(target) }
      .contextMenu { starMenu(row) }
      .accessibilityIdentifier("sidebar-\(row.id)")
  }

  private func starredRow(_ item: StarredItem) -> some View {
    let section = ShellScope.section(for: item)
    return HStack(spacing: 10) {
      Circle().fill(item.color.map(starColor) ?? AglynColor.tint).frame(width: 8, height: 8).frame(width: 20)
      Text(item.label).font(AglynFont.body).lineLimit(1)
    }
    .aglynSelectableRow(selected: !push && navigation.section == section, density: .sidebar) { activate(.section(section)) }
    .contextMenu {
      Button("Unstar", systemImage: "star.slash") { model.preferences?.toggleStar(item.ref) }
      Menu("Color") {
        ForEach(StarColor.allCases.filter { $0 != .unknown }, id: \.self) { color in
          Button(color.rawValue.capitalized) { model.preferences?.setColor(color, forStar: item.key) }
        }
        Button("None") { model.preferences?.setColor(nil, forStar: item.key) }
      }
    }
    .accessibilityIdentifier("sidebar-starred-\(item.id)")
  }

  @ViewBuilder
  private func starMenu(_ row: NativeNavRow) -> some View {
    if let item = model.itemRef(for: row, navigation: navigation), row.screen != NativeNav.home {
      let starred = model.preferences?.isStarred(item) == true
      Button(starred ? "Unstar" : "Star", systemImage: starred ? "star.slash" : "star") {
        model.preferences?.toggleStar(item)
      }
    }
  }

  private func label(_ title: String, icon: String, detail: String?) -> some View {
    Label {
      Text(title).font(AglynFont.body).lineLimit(1)
    } icon: {
      Image(systemName: icon).foregroundStyle(AglynColor.tint)
    }
    .help(detail ?? title)
  }

  private func activate(_ target: ShellTarget) {
    switch target {
    case .mode(let mode):
      // The phone's Menu swaps its list for the settings list; a wide window opens the mode on its first row too.
      if push { navigation.mode = mode } else { navigation.enter(mode, first: scope.firstSection(of: mode)) }
    case .section(let section):
      if push {
        switch section {
        case .home: navigation.select(.home)
        case .analytics: navigation.push(.analytics)
        case .plugin(let screen): navigation.push(.screen(screen, [:]))
        case .place(let screen, let params): navigation.push(.screen(screen, params))
        default: navigation.select(section)
        }
      } else {
        navigation.select(section)
      }
    }
  }
}

/// A star's color dot, from the theme's intents (StarColor is named so each platform draws it from its theme).
func starColor(_ color: StarColor) -> Color {
  switch color {
  case .blue: AglynColor.primary
  case .purple: AglynColor.secondary
  case .pink: AglynColor.badge
  case .red: AglynColor.error
  case .orange: AglynColor.intent({ $0.warning }, \.main)
  case .yellow: AglynColor.intent({ $0.warning }, \.pressed)
  case .green: AglynColor.success
  case .grey, .unknown: AglynColor.secondaryText
  }
}

/// The brand lockup pinned at the head of the sidebar, in a bar of its own: the logo kit's art (dark appearance
/// included), never re-typed, with the mark's height of clear space on every side.
struct SidebarBrandHeader: View {
  let name: String
  #if os(macOS)
    private let height: CGFloat = 20
  #else
    private let height: CGFloat = 24
  #endif

  var body: some View {
    VStack(spacing: 0) {
      AglynArtwork.logo.resizable().scaledToFit().frame(height: height)
        .padding(.vertical, height)
        .padding(.horizontal, height)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(name)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("sidebar-brand")
      Divider()
    }
  }
}
