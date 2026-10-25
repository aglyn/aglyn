// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/// The sidebar for the scope a window stands in (AGL-3945, Figma Sidebar 12:703): the brand bar, the scope's header
/// (the workspace and its menu, or the way back to it and the site picker, or a settings mode's back and title), then the
/// manifest's groups, each open or folded as the person left it (opening a place opens its own group). A Starred group
/// lists what the person starred here.
struct ShellSidebar: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var filter = ""
  /// How deep the last scope was, so a drill slides the right way.
  @State private var lastDepth = 0
  /// The last workspace shown, so another one cross-fades instead of sliding.
  @State private var lastOrg: String?

  /// How deep a scope sits: the workspace, then a site or the workspace's settings, then a site's settings.
  private var depth: Int {
    switch navigation.mode {
    case .main: navigation.inSite ? 1 : 0
    case .workspaceSettings, .admin: 1
    case .siteSettings: 2
    }
  }

  /// One scope's sidebar: a drill in or out swaps it (Figma Motion 121:6163).
  private var scopeKey: String { "\(navigation.mode)|\(navigation.inSite)|\(model.workspace?.org?.id ?? "")" }

  var body: some View {
    let scope = ShellScope(model: model, navigation: navigation)
    let forward = depth >= lastDepth
    // A drill slides with a fade; another workspace (same depth) cross-fades; Reduce Motion cross-fades only.
    let slides = !reduceMotion && depth != lastDepth
    ZStack(alignment: .top) {
      VStack(spacing: 0) {
        ScopeHeader(scope: scope, filter: $filter)
        SidebarList(scope: scope, filter: filter)
          .safeAreaInset(edge: .bottom, spacing: 0) {
            if navigation.mode == .main { PlanCard() }
          }
      }
      .id(scopeKey)
      .transition(
        slides
          ? .asymmetric(
            insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
            removal: .move(edge: forward ? .leading : .trailing).combined(with: .opacity))
          : .opacity)
    }
    .clipped()
    .animation(slides ? AglynShellMotion.drill : AglynShellMotion.crossFade, value: scopeKey)
    .background(AglynColor.sidebar)
    .onChange(of: depth) { _, next in lastDepth = next }
    .onChange(of: navigation.mode) { filter = "" }
  }
}

/// The search field atop a settings mode (Figma Sidebar, Scope=Settings: "Search settings", 28 points).
private struct SettingsFilterField: View {
  @Binding var text: String

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "magnifyingglass").font(.system(size: AglynShellMetrics.rowText - 2))
        .foregroundStyle(AglynColor.textTertiary).accessibilityHidden(true)
      TextField("Search settings", text: $text)
        .textFieldStyle(.plain)
        .font(.system(size: AglynShellMetrics.rowText))
        .accessibilityIdentifier("sidebar-settings-search")
    }
    .padding(.horizontal, 8)
    .frame(height: AglynShellMetrics.rowHeight)
    .background(RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).fill(AglynColor.sunken))
    .overlay(
      RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).strokeBorder(AglynColor.divider))
  }
}

/// The head of the sidebar (Figma Sidebar/Scope header 98:1023 and 6:112): the workspace with its menu; in a site, the
/// way back to the workspace and the site's title row; in a settings mode, the way back, its title and its search.
struct ScopeHeader: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let scope: ShellScope
  var filter: Binding<String>? = nil

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      switch navigation.mode {
      case .main:
        // A site is drilled into (Figma Sidebar 12:703): the way back to its workspace, then the site's own title row,
        // whose ▾ switches to another site of the workspace.
        if let site = scope.site {
          backButton(scope.org?.name ?? "Workspace", identifier: "sidebar-back-workspace") { navigation.enterWorkspace() }
          SiteTitleRow(site: site)
        } else {
          WorkspaceButton()
        }
      case .workspaceSettings, .siteSettings, .admin:
        backButton(
          navigation.mode == .siteSettings
            ? (scope.site?.name ?? "Site") : navigation.mode == .admin ? "Back" : (scope.org?.name ?? "Workspace"),
          identifier: "sidebar-back-mode"
        ) { navigation.leaveMode() }
        Text(navigation.mode == .siteSettings ? "Site settings" : navigation.mode == .admin ? "Admin" : "Workspace settings")
          .font(.system(size: AglynShellMetrics.modeTitle, weight: .semibold))
          .foregroundStyle(AglynColor.textPrimary)
          .accessibilityAddTraits(.isHeader)
          .accessibilityIdentifier("sidebar-mode-title")
        if let filter, navigation.mode != .admin { SettingsFilterField(text: filter) }
      }
    }
    .padding(AglynShellMetrics.scopeHeadPadding)
    .padding(AglynShellMetrics.headerPadding)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func backButton(_ title: String, identifier: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      HStack(spacing: 4) {
        Image(systemName: "chevron.left").font(.system(size: AglynShellMetrics.backText - 2, weight: .semibold))
          .frame(width: 14, height: 14)
        Text(title).font(.system(size: AglynShellMetrics.backText)).lineLimit(1)
      }
      .foregroundStyle(AglynColor.secondaryText)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help("Back to \(title)")
    .accessibilityLabel("Back to \(title)")
    .accessibilityIdentifier(identifier)
  }
}

/// The workspace's header (Figma Sidebar/Scope header, workspace): its logo, its name with ▾, and its plan; the whole
/// header opens the workspace menu. The phone's Menu leads with it too, so Workspace settings is one way in everywhere.
struct WorkspaceButton: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @State private var hovered = false

  var body: some View {
    let org = model.workspace?.org
    let logo = org.flatMap { model.workspace?.orgLogos[$0.id] }
    Menu {
      WorkspaceMenuItems()
    } label: {
      HStack(alignment: .center, spacing: 10) {
        // The workspace's tile, as the rail draws it (a picture covers it, a mark sits on the plate), so the header and
        // the rail show one workspace the same way on both platforms.
        AglynWorkspaceTile(
          name: org?.name ?? "Workspace", logoURL: model.mediaURL(logo?.light, hostID: nil),
          darkLogoURL: model.mediaURL(logo?.dark, hostID: nil), colorHex: model.workspaceColor(org?.id).color,
          selected: false, size: AglynShellMetrics.workspaceLogo, initials: workspaceInitial(org?.name ?? "Workspace"),
          cornerRadius: AglynShellMetrics.workspaceLogoRadius)
          .padding(-3)
        // Figma Sidebar/Scope header 98:1023: an 18-point name row with ▾ at the header's trailing edge, 2 points, and
        // an 18-point plan badge.
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 4) {
            Text(org?.name ?? (model.workspace?.ready == true ? "No workspace" : "Loading…"))
              .font(.system(size: AglynShellMetrics.workspaceName, weight: .semibold)).lineLimit(1)
              .foregroundStyle(AglynColor.textPrimary)
            Spacer(minLength: 0)
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
              .foregroundStyle(AglynColor.secondaryText)
              .frame(width: 14, height: 14)
          }
          .frame(minHeight: 18)
          if let plan = logo?.planLabel {
            Text(plan).font(.system(size: 12, weight: .semibold)).foregroundStyle(AglynColor.tint)
              .padding(.horizontal, 7)
              .frame(minHeight: 18)
              .background(Capsule().fill(AglynColor.accentSoft))
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .contentShape(Rectangle())
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .menuIndicator(.hidden)
    .help(org?.name ?? "Workspace")
    .accessibilityLabel("\(org?.name ?? "Workspace") menu")
    .accessibilityIdentifier("sidebar-workspace-menu")
  }
}

/// The site's title row in its own sidebar: its favicon, its name, and ▾ for the workspace's other sites (a searchable
/// popover, recent first; Figma "Mac / Popover / Site switcher" 16:425).
private struct SiteTitleRow: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let site: WorkspaceSite
  @State private var switching = false

  /// Where the switcher's arrow points under the title row so the popover's 344 points start 8 in from the sidebar's
  /// edge: the row starts after the header's two insets and spans the sidebar less both sides of them.
  static var switcherAnchor: UnitPoint {
    let lead = AglynShellMetrics.headerPadding.leading + AglynShellMetrics.scopeHeadPadding.leading
    let width = AglynShellMetrics.sidebarWidth - lead - AglynShellMetrics.headerPadding.trailing
      - AglynShellMetrics.scopeHeadPadding.trailing
    return UnitPoint(x: (8 - lead + 344 / 2) / width, y: 1)
  }

  var body: some View {
    Button {
      switching = true
    } label: {
      HStack(spacing: 8) {
        AglynBrandPicture(
          model.mediaURL(site.favicon, hostID: site.id), size: AglynShellMetrics.headerLogo,
          cornerRadius: AglynShellMetrics.headerLogoRadius
        ) {
          AglynWorkspaceTile(
            name: site.name, logoURL: nil, colorHex: model.workspaceColor(model.workspace?.org?.id).color, selected: false,
            size: AglynShellMetrics.headerLogo
          )
          .padding(-3)
        }
        HStack(spacing: 4) {
          Text(site.name).font(.system(size: AglynShellMetrics.siteName, weight: .semibold)).lineLimit(1)
            .foregroundStyle(AglynColor.textPrimary)
          Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
            .foregroundStyle(AglynColor.secondaryText)
            .frame(width: 14, height: 14)
        }
        Spacer(minLength: 0)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .help("Switch site")
    .accessibilityLabel("Site, \(site.name)")
    .accessibilityHint("Switches to another site of the workspace")
    .accessibilityIdentifier("sidebar-site-picker")
    // Anchored so the 344-point popover starts 8 points in from the sidebar's edge, under the title row, as Figma 121:6735
    // draws it, rather than centred on the row and over the rail.
    .popover(isPresented: $switching, attachmentAnchor: .point(Self.switcherAnchor), arrowEdge: .bottom) {
      SiteSwitcherPopover { switching = false }
        .environment(model)
        .environment(navigation)
    }
  }
}

/// The site switcher under the site's title row (Figma 121:7014, in context 121:6735): "Find a site", the sites with
/// the recent ones first and a check on the open one, then View all sites and Create site, as the console's switcher
/// offers them. Its way back to the whole workspace is the sidebar's "‹ Workspace" line, not a row here.
struct SiteSwitcherPopover: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let done: () -> Void
  @State private var query = ""
  @State private var shown = pickerPage
  @FocusState private var focused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(AglynColor.textTertiary)
          .accessibilityHidden(true)
        TextField("Find a site", text: $query).textFieldStyle(.plain).font(.system(size: 13)).focused($focused)
          .accessibilityIdentifier("switcher-find-site")
      }
      .padding(.horizontal, 10)
      .frame(height: 32)
      .background(
        RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).fill(AglynColor.sunken))
      Color.clear.frame(height: 6)
      if let workspace = model.workspace {
        ScrollView(.vertical) {
          VStack(alignment: .leading, spacing: 0) { rows(workspace) }
        }
        .frame(maxHeight: 300)
        .fixedSize(horizontal: false, vertical: true)
      } else {
        ProgressView().frame(maxWidth: .infinity, minHeight: 88)
      }
      Rectangle().fill(AglynColor.divider).frame(height: 1).padding(.vertical, 4).accessibilityHidden(true)
      action("View all sites", systemImage: "square.grid.2x2", identifier: "switcher-view-all-sites") {
        navigation.enterWorkspace()
        navigation.select(.plugin("site.sites"))
      }
      // The console's Create site: the Sites screen's create flow, which says first when the plan or the role stops it.
      action("Create site", systemImage: "plus", identifier: "switcher-create-site") {
        navigation.enterWorkspace()
        navigation.select(ShellSection.opening("site.sites", ["new": "1"]))
      }
    }
    .padding(6)
    .frame(width: 344)
    .onAppear { focused = true }
  }

  @ViewBuilder
  private func rows(_ workspace: WorkspaceStore) -> some View {
    let text = query.trimmingCharacters(in: .whitespaces)
    if !workspace.ready {
      ProgressView().frame(maxWidth: .infinity, minHeight: 88)
    } else if !text.isEmpty {
      let matches = workspace.sites.compactMap { site in
        scoreMatch(name: site.name, extra: [site.subdomain], query: text).map { (site, $0) }
      }.sorted { scoredFirst(($0.1, $0.0.name), ($1.1, $1.0.name)) }.map(\.0)
      if matches.isEmpty { note("No sites match.") }
      ForEach(matches) { row($0) }
    } else if workspace.sites.isEmpty {
      note("No sites yet.")
    } else {
      let recentIDs = model.recentSiteIDs(in: workspace)
      let recent = recentIDs.compactMap { id in workspace.sites.first { $0.id == id } }
      let rest = workspace.sites.filter { !recentIDs.contains($0.id) }
      if !recent.isEmpty {
        Text("Recent").font(.system(size: 12, weight: .semibold)).foregroundStyle(AglynColor.secondaryText)
          .padding(EdgeInsets(top: 8, leading: 10, bottom: 4, trailing: 10))
          .accessibilityAddTraits(.isHeader)
      }
      ForEach(recent) { row($0) }
      ForEach(Array(rest.prefix(shown))) { row($0) }
      if rest.count > shown {
        action("Show more", systemImage: "ellipsis", identifier: "switcher-show-more", closes: false) { shown += pickerPage }
      }
    }
  }

  private func note(_ text: String) -> some View {
    Text(text).font(.system(size: 13)).foregroundStyle(AglynColor.secondaryText)
      .padding(.horizontal, 10).padding(.vertical, 12)
  }

  /// A site (Figma Picker/Site row in the switcher): its favicon 24, its name and address, a check on the open one.
  private func row(_ site: WorkspaceSite) -> some View {
    let current = site.id == model.scopedSite(navigation)?.id
    return SwitcherRow(identifier: "switcher-site-\(site.id)", height: 44) {
      model.workspace?.selectSite(site.id)
      navigation.enterSite()
      done()
    } content: {
      AglynBrandPicture(model.mediaURL(site.favicon, hostID: site.id), size: 24, cornerRadius: 6) {
        AglynWorkspaceTile(
          name: site.name, logoURL: nil, colorHex: model.workspaceColor(model.workspace?.org?.id).color, selected: false,
          size: 24
        )
        .padding(-3)
      }
      VStack(alignment: .leading, spacing: 0) {
        Text(site.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(AglynColor.textPrimary).lineLimit(1)
        Text(site.shownAddress).font(.system(size: 12))
          .foregroundStyle(AglynColor.secondaryText).lineLimit(1)
      }
      Spacer(minLength: 0)
      if current {
        Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(AglynColor.tint)
          .frame(width: 14, height: 14).accessibilityHidden(true)
      }
    }
    .accessibilityAddTraits(current ? .isSelected : [])
  }

  /// A plain menu row (Figma Menu/Row): a 16-point line icon and its label, 30 points tall.
  private func action(
    _ title: String, systemImage: String, identifier: String, closes: Bool = true, run: @escaping () -> Void
  ) -> some View {
    SwitcherRow(identifier: identifier, height: 30) {
      run()
      if closes { done() }
    } content: {
      Image(systemName: systemImage).font(.system(size: 13)).foregroundStyle(AglynColor.textPrimary)
        .frame(width: 16, height: 16).accessibilityHidden(true)
      Text(title).font(.system(size: 13)).foregroundStyle(AglynColor.textPrimary)
      Spacer(minLength: 0)
    }
  }
}

/// One row of the switcher: its content in a 10-point inset, the hover ground with a 6-point radius.
private struct SwitcherRow<Content: View>: View {
  let identifier: String
  let height: CGFloat
  let action: () -> Void
  @ViewBuilder let content: () -> Content
  @State private var hovered = false

  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) { content() }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, minHeight: height, alignment: .leading)
        .background(
          RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous)
            .fill(hovered ? AglynColor.hover : Color.clear))
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 }
    .accessibilityIdentifier(identifier)
  }
}

/// The list itself: groups and rows, starred items, folding, and each row's star.
struct SidebarList: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let scope: ShellScope
  var filter = ""
  /// The phone's Menu: rows push onto the stack instead of selecting a sidebar section, drawn as the phone's list
  /// (Figma iPhone / Site / Menu 22:176).
  var push = false
  /// The selection pill moves from row to row (Figma Motion).
  @Namespace private var pill

  var body: some View {
    let list = scope.currentList
    // Drawn rows, not a sidebar List: the platform's list adds its own insets, selection and type (Figma Sidebar/Row).
    ScrollView(.vertical) {
      VStack(alignment: .leading, spacing: push ? 0 : 2) {
        // The workspace's head has a hairline under it (Figma Sidebar 12:703, workspace scope).
        if !push && list.id == .workspace && filter.isEmpty { AglynSidebarDivider() }
        ForEach(Array(list.groups.enumerated()), id: \.element.id) { index, group in
          if !push && needsDivider(before: group, at: index, in: list) { AglynSidebarDivider() }
          groupView(group, open: isOpen(group))
        }
      }
      .padding(.top, push ? 0 : 4)
      .padding(.bottom, push ? 16 : 12)
      .animation(AglynShellMotion.pill, value: navigation.section)
    }
    .scrollIndicators(.never)
    .accessibilityIdentifier("sidebar-list")
  }

  /// Where Figma draws a divider (P7): in the workspace, after its header and after Home; in a site, after the top block
  /// (Home, Overview, Starred), between the groups and More, and above Site settings. Settings lists have none.
  private func needsDivider(before group: NativeNavGroup, at index: Int, in list: ResolvedNavList) -> Bool {
    guard index > 0, filter.isEmpty else { return false }
    switch list.id {
    case .workspace:
      return index == 1
    case .site:
      if group.id == "more" || group.id == "settings" { return true }
      let topBlock: Set<String> = ["top", "starred"]
      guard !topBlock.contains(group.id) else { return false }
      return list.groups[..<index].allSatisfy { topBlock.contains($0.id) }
    default:
      return false
    }
  }

  /// Open as the person left it (AGL-3996); a search shows every match, and a group that cannot fold is always open.
  private func isOpen(_ group: NativeNavGroup) -> Bool {
    !group.foldable || !filter.isEmpty
      || navigation.groups.isOpen(groupKey(group), openAtRest: ShellScope.openAtRest(group))
  }

  /// The fold state is remembered per scope kind and group (`site.sell`), on this device.
  private func groupKey(_ group: NativeNavGroup) -> String { ShellScope.groupKey(group.id, in: scope.currentList) }

  @ViewBuilder
  private func groupView(_ group: NativeNavGroup, open: Bool) -> some View {
    // The phone's Home is its own tab, so Menu starts at Overview (Figma 22:176).
    let rows = filtered(group.rows).filter { !push || $0.screen != NativeNav.home }
    let starred = group.dynamic == "starred" ? starredHere : []
    if group.dynamic == "starred" {
      if !starred.isEmpty && filter.isEmpty {
        if push {
          PhoneMenuSectionHead(title: group.label ?? "Starred")
        } else {
          header(group, open: open, hidden: starred.count)
        }
        if open || push {
          ForEach(starred, id: \.key) { starredRow($0) }
            .transition(.opacity.combined(with: .move(edge: .top)))
        }
      }
    } else if !rows.isEmpty {
      if push && group.id == "more" && group.foldable && filter.isEmpty {
        // More is a row of its own on the phone too (Figma 22:176, "··· More ›"), opening its rows under it.
        PhoneMenuRow(title: "More", action: { toggle(group) }) { AglynPhoneRowIcon(systemName: "ellipsis") }
        .accessibilityValue(open ? "Open" : "Folded")
        .accessibilityIdentifier("sidebar-group-more")
      } else if push {
        if let label = group.label {
          PhoneMenuSectionHead(
            title: label, foldable: group.foldable, open: open, count: rows.count,
            toggle: group.foldable ? { toggle(group) } : nil
          )
          .accessibilityIdentifier("sidebar-group-\(group.id)")
        }
      } else if group.id == "more" && group.foldable && filter.isEmpty {
        // More is a row of its own (Figma "··· More"), opening its rows under it.
        // A plain row in Figma (Sidebar 12:703, "··· More"): no trailing mark; its rows opening under it say it opened.
        AglynSidebarRow("More", selected: false, action: { toggle(group) }) {
          AglynSidebarIcon("ellipsis")
        } trailing: {
          EmptyView()
        }
        .accessibilityValue(open ? "Open" : "Folded")
        .accessibilityIdentifier("sidebar-group-more")
      } else if let label = group.label {
        if group.foldable {
          header(group, open: open, hidden: rows.count)
        } else {
          Text(label).font(.system(size: AglynShellMetrics.groupText, weight: .semibold))
            .foregroundStyle(AglynColor.secondaryText)
            .padding(.horizontal, AglynShellMetrics.rowPadding)
            .frame(maxWidth: .infinity, minHeight: AglynShellMetrics.groupHeight, alignment: .leading)
            .padding(.horizontal, AglynShellMetrics.rowInset)
            .accessibilityAddTraits(.isHeader)
        }
      }
      if open {
        // A group's rows sit one level in (12 points) under its label (Figma: 20 = 8 + 12 on the Mac, 22 on iPad).
        ForEach(rows, id: \.id) { rowView($0, indent: group.label != nil ? 1 : 0) }
          .transition(.opacity.combined(with: .move(edge: .top)))
      }
    }
  }

  private var list: ResolvedNavList { scope.currentList }

  private func header(_ group: NativeNavGroup, open: Bool, hidden: Int) -> some View {
    AglynSidebarGroupHeader(group.label ?? "", foldable: group.foldable, open: open, hiddenCount: hidden) {
      toggle(group)
    }
    .accessibilityIdentifier("sidebar-group-\(group.id)")
  }

  /// Folds or opens a group, remembered for the scope kind (Figma Motion: about 200 ms).
  private func toggle(_ group: NativeNavGroup) {
    withAnimation(AglynShellMotion.fold) {
      navigation.groups.toggle(groupKey(group), openAtRest: ShellScope.openAtRest(group))
    }
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

  @ViewBuilder
  private func rowView(_ row: NativeNavRow, indent: Int = 0) -> some View {
    if push {
      PhoneMenuRow(title: row.label, action: { activate(ShellScope.target(of: row)) }) {
        AglynPhoneRowIcon(systemName: row.appleIcon)
      }
      .contextMenu { starMenu(row) }
      .accessibilityIdentifier("sidebar-\(row.id)")
    } else {
      sidebarRow(row, indent: indent)
    }
  }

  private func sidebarRow(_ row: NativeNavRow, indent: Int) -> some View {
    let target = ShellScope.target(of: row)
    let selected = !push && navigation.starKey == nil && ShellScope.row(row, holds: navigation.section)
    return AglynSidebarRow(row.label, selected: selected, indent: indent, pill: pill, action: { activate(target) }) {
      AglynSidebarIcon(row.appleIcon)
    } trailing: {
      // A plugin's count for its row (slot `sidebarCount.<row>`), e.g. Inbox's unread.
      if let context = model.context(for: navigation) {
        ForEach(model.registry.widgets(for: model.app, slot: "sidebarCount.\(row.id)")) { widget in
          widget.make(context).id("\(widget.id):\(context.orgID ?? ""):\(context.hostID ?? "")")
        }
      }
    }
    .help(row.description ?? row.label)
    .contextMenu { starMenu(row) }
    .accessibilityIdentifier("sidebar-\(row.id)")
  }

  @ViewBuilder
  private func starredRow(_ item: StarredItem) -> some View {
    let section = ShellScope.section(for: item)
    let dot = Circle().fill(item.color.map(starColor) ?? AglynColor.primary).frame(width: 8, height: 8)
    Group {
      if push {
        PhoneMenuRow(title: item.label, action: { activate(.section(section)) }) { dot }
      } else {
        // One row is selected: the one the place was opened through (a starred shortcut, or its group's row).
        AglynSidebarRow(
          item.label, selected: navigation.section == section && navigation.starKey == item.key, indent: 1, pill: pill,
          action: {
            activate(.section(section))
            navigation.starKey = item.key
          }
        ) { dot }
      }
    }
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
        // An area opens with its section chips, as a tab's root shows it (AGL-3993).
        case .plugin, .place: navigation.pushArea(section)
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
  /// The lockup's height in its 64-point bar (Figma Sidebar/Brand bar).
  private let height: CGFloat = 20

  var body: some View {
    VStack(spacing: 0) {
      AglynArtwork.logo.resizable().scaledToFit().frame(height: height)
        .padding(.horizontal, height)
        .frame(maxWidth: .infinity, minHeight: 63, alignment: .leading)
        .accessibilityLabel(name)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("sidebar-brand")
      Divider()
    }
  }
}

/// A row of the phone's Menu (Figma Phone/List row): a 22-point line icon (in the bold look a 30-point accent tile,
/// `AglynPhoneRowIcon`), the label at 17 points and a chevron, 52 points tall across the screen.
struct PhoneMenuRow<Leading: View>: View {
  let title: String
  let action: () -> Void
  @ViewBuilder let leading: () -> Leading

  var body: some View {
    Button(action: action) {
      HStack(spacing: AglynThemeRuntime.shared.phoneBold ? 12 : 14) {
        leading().frame(minWidth: AglynThemeRuntime.shared.phoneBold ? 30 : 22, minHeight: 22)
        Text(title).font(.system(size: 17)).foregroundStyle(AglynColor.textPrimary).lineLimit(1)
        Spacer(minLength: 8)
        Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold))
          .foregroundStyle(AglynColor.textTertiary)
          .frame(width: 16, height: 16)
      }
      .padding(.horizontal, 16)
      .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.aglynRow)
    // A hairline under each row, across the screen (Figma Phone/List row).
    .overlay(alignment: .bottom) {
      Rectangle().fill(AglynColor.divider).frame(height: 1).accessibilityHidden(true)
    }
  }
}

/// A heading in the phone's Menu (Figma Phone/Section head): the label at 13 points in the secondary color, with the
/// fold chevron before it and the hidden rows' count after it when the group folds.
struct PhoneMenuSectionHead: View {
  let title: String
  var foldable = false
  var open = true
  var count = 0
  var toggle: (() -> Void)? = nil

  var body: some View {
    Button {
      toggle?()
    } label: {
      HStack(spacing: 6) {
        if foldable {
          Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold))
            .frame(width: 14, height: 14)
            .rotationEffect(.degrees(open ? 90 : 0))
        }
        Text(title).font(.system(size: 13))
        Spacer(minLength: 8)
        if foldable && !open && count > 0 { Text("\(count)").font(.system(size: 13)).monospacedDigit() }
      }
      .foregroundStyle(AglynColor.secondaryText)
      .padding(EdgeInsets(top: 20, leading: 16, bottom: 6, trailing: 16))
      .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(toggle == nil)
    .accessibilityAddTraits(.isHeader)
    .accessibilityValue(foldable ? (open ? "Open" : "Folded") : "")
  }
}
