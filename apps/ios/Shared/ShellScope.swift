// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynScreens
import AglynUI
import SwiftUI

/// Where one window stands and what its sidebar lists (AGL-3945): the workspace, the site when it is inside one, the
/// plugins each has on, and the nav manifest's lists for that scope (`resolveNavList`), the same lists the Kotlin
/// apps draw. A row whose screen this build does not have is left out, never shown as a dead end.
@MainActor
struct ShellScope {
  let model: AppModel
  let navigation: ShellNavigation

  var org: WorkspaceOrg? { model.workspace?.org }
  var site: WorkspaceSite? { model.scopedSite(navigation) }
  var inSite: Bool { site != nil }

  /// The workspace's plugins on (`resolveEnabledPlugins`), less those the platform has not released to it.
  var workspacePlugins: [String] { released(resolveEnabledPlugins(model.workspace?.orgLogo?.enabledPlugins)) }

  /// The site's plugins on: the workspace's, less the site's own off list, plus the default-off ones it opted into.
  var sitePlugins: [String] {
    let choices = model.workspace?.sitePlugins
    return released(
      resolveHostEnabledPlugins(
        orgEnabled: model.workspace?.orgLogo?.enabledPlugins, hostDisabled: choices?.disabled, hostEnabled: choices?.enabled))
  }

  /// Drops a plugin whose release flag is off for this workspace (Accounting until a deployment has its ledger
  /// credentials, Outreach until staff open it). The console's shell hides such a plugin's tab and its routes answer
  /// 404, so a row for it would only open "This did not load"; a gate only the platform lifts stays hidden.
  private func released(_ pluginIDs: [String]) -> [String] {
    let logo = model.workspace?.orgLogo
    let staff = model.auth?.staff != nil
    return pluginIDs.filter { id in
      guard let flag = PluginCatalog.plugin(id)?.releaseFlag, !staff else { return true }
      let value = ReleaseFlagDefaults.byKey[flag] ?? ReleaseFlagValue(enabled: false, rolloutPercent: 0, plans: [])
      return isReleaseFlagOn(flag, value: value, orgID: org?.id, plan: logo?.plan, overrides: logo?.releaseFlags)
    }
  }

  /// Whether the person sees the site's Admin rows, as the console shows its Admin tab: a site admin, or a workspace
  /// owner or admin.
  var hostAdmin: Bool {
    let admins: Set<String> = ["owner", "admin"]
    return admins.contains(site?.role ?? "") || admins.contains(org?.role ?? "")
  }

  /// One list as this scope shows it, its rows trimmed to the screens this build has.
  func list(_ id: NativeNavListId) -> ResolvedNavList {
    let plugins = id == .site || id == .siteSettings ? sitePlugins : workspacePlugins
    var resolved = resolveNavList(id, enabledPluginIds: plugins, hostAdmin: hostAdmin)
    let wholeWorkspace = id == .workspace || id == .workspaceSettings
    resolved.groups = resolved.groups.compactMap { group in
      var next = group
      next.rows = group.rows.filter { row in
        if row.screen.hasPrefix("shell.") { return true }
        guard let screen = model.registry.screen(row.screen) else { return false }
        // A whole-workspace row whose screen reads one site at a time waits for that screen's workspace view (navcore
        // 2026-10-18): it is left out rather than asking for a site.
        return !(wholeWorkspace && screen.needsSite)
      }
      return next.rows.isEmpty && next.dynamic == nil ? nil : next
    }
    return resolved
  }

  /// The everyday list for where the window stands.
  var mainList: ResolvedNavList { list(inSite ? .site : .workspace) }

  /// The list the sidebar shows now.
  var currentList: ResolvedNavList {
    switch navigation.mode {
    case .main: mainList
    case .workspaceSettings: list(.workspaceSettings)
    case .siteSettings: list(.siteSettings)
    case .admin: ResolvedNavList(groups: staffGroups, id: .unknown)
    }
  }

  /// The staff list, as its own mode: the console's staff pages, for staff only.
  var staffGroups: [NativeNavGroup] {
    guard model.claims.isStaff else { return [] }
    let screens = ScreenCatalog.shared.group("staff")
    let rows = screens.map { spec in
      NativeNavRow(
        console: NativeNavConsoleRef(id: spec.id, surface: .nativeOnly), icon: NativeNavIcon(android: "", apple: spec.icon),
        id: spec.id, label: spec.label, screen: spec.id)
    }
    return rows.isEmpty ? [] : [NativeNavGroup(foldable: false, id: "staff", rows: rows)]
  }

  /// The settings mode's title: "Juniper Street Co. settings", "Juniper Street Bakery settings".
  var modeTitle: String? {
    switch navigation.mode {
    case .main: nil
    case .workspaceSettings: "\(org?.name ?? "Workspace") settings"
    case .siteSettings: "\(site?.name ?? "Site") settings"
    case .admin: "Admin"
    }
  }

  /// The first row of a mode's list, which the mode opens on.
  func firstSection(of mode: ShellMode) -> ShellSection? {
    let list: ResolvedNavList =
      switch mode {
      case .main: mainList
      case .workspaceSettings: self.list(.workspaceSettings)
      case .siteSettings: self.list(.siteSettings)
      case .admin: ResolvedNavList(groups: staffGroups, id: .unknown)
      }
    return list.groups.flatMap(\.rows).first.map { ShellSection.opening($0.screen, $0.params) }
  }

  /// The section a row stands for, or the mode it opens (`shell.workspaceSettings`, `shell.siteSettings`).
  static func target(of row: NativeNavRow) -> ShellTarget {
    switch row.screen {
    case NativeNav.workspaceSettings: .mode(.workspaceSettings)
    case NativeNav.siteSettings: .mode(.siteSettings)
    default: .section(ShellSection.opening(row.screen, row.params))
    }
  }

  /// Whether the section on screen belongs to this row: its own screen, or one of its sections'.
  static func row(_ row: NativeNavRow, holds section: ShellSection) -> Bool {
    if case .section(let own) = target(of: row), own == section { return true }
    return (row.sections ?? []).contains { ShellSection.opening($0.screen, $0.params) == section }
  }

  /// The group a section lives in, so it opens while it holds the screen in use.
  static func group(holding section: ShellSection, in list: ResolvedNavList) -> String? {
    list.groups.first { $0.rows.contains { row($0, holds: section) } }?.id
  }

  /// A sidebar group's key in the remembered fold state: its scope kind and id (`site.sell`).
  static func groupKey(_ groupID: String, in list: ResolvedNavList) -> String { "\(list.id.rawValue).\(groupID)" }

  /// Whether a group is open before the person has folded or opened it: Starred is (Figma 12:703); the rest fold.
  static func openAtRest(_ group: NativeNavGroup) -> Bool { group.dynamic == "starred" }

  /// Opens the group holding `section` when it is folded, and nothing else (AGL-3996: no accordion).
  static func reveal(_ section: ShellSection, in list: ResolvedNavList, groups: inout AglynSidebarGroups) {
    guard let id = group(holding: section, in: list), let group = list.groups.first(where: { $0.id == id }),
      group.foldable
    else { return }
    groups.reveal(groupKey(id, in: list), openAtRest: openAtRest(group))
  }

  /// The row a section belongs to, for its area's sections and actions.
  func row(for section: ShellSection) -> NativeNavRow? {
    currentList.groups.flatMap(\.rows).first { Self.row($0, holds: section) }
  }

  /// A starred item's place: the section it opens.
  static func section(for item: StarredItem) -> ShellSection { ShellSection.opening(item.screen, item.params) }
}

/// What a sidebar row does: open a section, or swap the sidebar for a settings mode.
enum ShellTarget: Equatable {
  case section(ShellSection)
  case mode(ShellMode)
}

extension NativeNavRow {
  /// The row's SF Symbol.
  var appleIcon: String { icon.apple.isEmpty ? "square.grid.2x2" : icon.apple }
}

extension AppModel {
  /// The color a workspace shows on the rail and tints the app with (`resolveWorkspaceColor`): the person's pick, its
  /// brand color, a color taken from its logo, else its stable color from its id (`workspaceStableColor`), which colors
  /// its tile only.
  func workspaceColor(_ orgID: String?) -> WorkspaceColor {
    guard let orgID else { return resolveWorkspaceColor(picked: nil, brandColor: nil, logoColor: nil, useWorkspaceBrand: false) }
    let logo = workspace?.orgLogos[orgID]
    let picked = preferences?.workspaceColors[orgID]
    let brand = logo?.brandColor
    // The logo is only read when nothing before it gives a color.
    let logoColor = picked == nil && brand == nil ? AglynLogoColors.shared.color(for: mediaURL(logo?.light, hostID: nil)) : nil
    return resolveWorkspaceColor(
      picked: picked, brandColor: brand, logoColor: logoColor, useWorkspaceBrand: preferences?.appTheme.useWorkspaceBrand ?? true,
      orgID: orgID)
  }

  /// The account item for a sidebar row in the window's scope, to star or record as recent.
  func itemRef(for row: NativeNavRow, navigation: ShellNavigation) -> AccountItemRef? {
    guard let orgID = workspace?.org?.id else { return nil }
    return AccountItemRef(
      hostId: scopedSite(navigation)?.id, id: row.id, kind: "screen", label: row.label, orgId: orgID, params: row.params,
      screen: row.screen)
  }
}
