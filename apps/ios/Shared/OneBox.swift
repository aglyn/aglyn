// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import Observation
import SwiftUI

// The one box (⌘K, Zach 2026-10-18; Figma ⌘K box 67:13177): switching and search in one place. Before you type it is the
// switcher (Pinned, Recent, everyone else A to Z); typing finds workspaces and sites, the app's own screens and settings
// (`searchNavScreens`, on the device), and every record the server matches (`/api/search`), grouped by kind.

/// What a row of the box does when opened.
enum OneBoxAction: Hashable {
  case workspace(String)
  case site(String)
  case screen(String, [String: String])
  /// A server row: its console link, through the app's deep-link resolver, in its own workspace and site.
  case link(String, orgID: String?, hostID: String?)
  case recent(RecentItem)
  case loadMoreWorkspaces
  case addWorkspace
}

/// One row as the box draws it.
struct OneBoxItem: Identifiable, Hashable {
  let id: String
  let label: String
  var detail: String? = nil
  var icon: String = "magnifyingglass"
  /// A workspace's tile instead of the icon.
  var orgID: String? = nil
  /// A site's favicon instead of the icon.
  var hostID: String? = nil
  /// The keyboard shortcut or state shown at the end ("⌘1", "Pinned").
  var trailing: String? = nil
  let action: OneBoxAction
}

struct OneBoxSection: Identifiable, Hashable {
  let id: String
  let heading: String
  var items: [OneBoxItem]
}

/// The box's state: what was typed, the server's groups for it, and the row the keyboard is on.
@MainActor
@Observable
final class OneBoxModel {
  var query = ""
  private(set) var remote: [OneBoxGroup] = []
  private(set) var searching = false
  private(set) var failed = false
  var selected: String?
  @ObservationIgnored private var task: Task<Void, Never>?

  /// Asks the server once typing pauses; a query too short to run clears the server's rows.
  func search(_ client: OneBoxClient?, orgID: String?, hostID: String?) {
    task?.cancel()
    let text = query
    guard let client, oneBoxQuery(text) != nil else {
      remote = []
      searching = false
      return
    }
    searching = true
    task = Task { [weak self] in
      try? await Task.sleep(nanoseconds: 220_000_000)
      guard !Task.isCancelled else { return }
      do {
        let response = try await client.search(text, orgID: orgID, hostID: hostID)
        guard !Task.isCancelled, self?.query == text else { return }
        // The app's own screens are matched on the device; a server that still sends them is not doubled.
        self?.remote = response.groups.filter { $0.group != ContractValues.shared.oneBoxScreensGroup }
        self?.failed = false
      } catch {
        guard !Task.isCancelled else { return }
        // A server without the route yet (404) or a failed read: the device's own matches still show.
        self?.remote = []
        self?.failed = (error as? ConsoleAPIError)?.status != 404
      }
      self?.searching = false
    }
  }
}

/// The box itself.
struct OneBoxView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.dismiss) private var dismiss
  @State private var box = OneBoxModel()
  @State private var shownWorkspaces = 50
  @FocusState private var focused: Bool

  private var scope: ShellScope { ShellScope(model: model, navigation: navigation) }

  var body: some View {
    let sections = self.sections
    let flat = sections.flatMap(\.items)
    VStack(spacing: 0) {
      HStack(spacing: 10) {
        Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
        TextField(placeholder, text: $box.query)
          .textFieldStyle(.plain)
          .font(AglynFont.body)
          .focused($focused)
          .onSubmit { if let item = flat.first(where: { $0.id == box.selected }) ?? flat.first { open(item) } }
          .accessibilityIdentifier("onebox-field")
        if box.searching { ProgressView().controlSize(.small) }
        Button("esc") { dismiss() }
          .font(AglynFont.caption)
          .buttonStyle(.bordered)
          .controlSize(.small)
          .keyboardShortcut(.cancelAction)
          .accessibilityLabel("Close")
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      Divider()
      ScrollViewReader { proxy in
        List {
          ForEach(sections) { section in
            Section(section.heading) {
              ForEach(section.items) { item in
                row(item, selected: item.id == box.selected)
                  .id(item.id)
              }
            }
          }
          if sections.isEmpty {
            Text(box.searching ? "Searching…" : "Nothing matches “\(box.query)”.")
              .foregroundStyle(.secondary)
              .accessibilityIdentifier("onebox-empty")
          }
          if box.failed {
            Text("Records could not be searched just now. Workspaces, sites and settings still show.")
              .font(AglynFont.caption).foregroundStyle(.secondary)
          }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .onChange(of: box.selected) { _, id in if let id { proxy.scrollTo(id) } }
      }
      Divider()
      footer
    }
    .background(AglynColor.paper)
    .frame(minWidth: 0, idealWidth: 640, minHeight: 0, idealHeight: 560)
    #if os(macOS)
      .frame(width: 640, height: 560)
    #endif
    .onAppear { focused = true }
    .onChange(of: box.query) {
      box.selected = nil
      box.search(model.api.map(OneBoxClient.init), orgID: scope.org?.id, hostID: scope.site?.id)
    }
    .onKeyPress(.downArrow) {
      box.selected = AglynSelectionKeys.step(flat.map(\.id), from: box.selected, down: true) ?? box.selected
      return .handled
    }
    .onKeyPress(.upArrow) {
      box.selected = AglynSelectionKeys.step(flat.map(\.id), from: box.selected, down: false) ?? box.selected
      return .handled
    }
    .task(id: model.preferences?.pinned ?? []) {
      model.workspace?.loadOrgs((model.preferences?.pinned ?? []) + (model.preferences?.recentOrgs ?? []))
      model.workspace?.loadLogos(model.workspace?.orgs.map(\.id) ?? [])
    }
  }

  private var placeholder: String {
    if let site = scope.site { return "Search \(site.name), or jump to a workspace" }
    if let org = scope.org { return "Search \(org.name), or jump to a workspace" }
    return "Find a workspace, site, page or order"
  }

  private var footer: some View {
    HStack(spacing: 14) {
      hint("↑↓", "to move")
      hint("↵", "to open")
      hint("⌘1–⌘5", "pins")
      Spacer()
      Text(scope.site != nil ? "Searching this site and its workspace" : "Searching this workspace")
        .font(AglynFont.caption).foregroundStyle(.secondary)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
  }

  private func hint(_ keys: String, _ words: String) -> some View {
    HStack(spacing: 4) {
      Text(keys).font(AglynFont.caption).padding(.horizontal, 5).padding(.vertical, 1)
        .background(RoundedRectangle(cornerRadius: 4).strokeBorder(AglynColor.divider))
      Text(words).font(AglynFont.caption).foregroundStyle(.secondary)
    }
  }

  // MARK: Rows

  private func row(_ item: OneBoxItem, selected: Bool) -> some View {
    Button {
      open(item)
    } label: {
      HStack(spacing: 10) {
        picture(item)
        VStack(alignment: .leading, spacing: 1) {
          Text(item.label).font(AglynFont.body).lineLimit(1)
          if let detail = item.detail, !detail.isEmpty {
            Text(detail).font(AglynFont.caption).foregroundStyle(.secondary).lineLimit(1)
          }
        }
        Spacer(minLength: 6)
        if let trailing = item.trailing {
          Text(trailing).font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(AglynSelectableRowStyle(selected: selected, density: .list))
    .listRowInsets(EdgeInsets(top: 1, leading: 8, bottom: 1, trailing: 8))
    .listRowBackground(Color.clear)
    .listRowSeparator(.hidden)
    .accessibilityIdentifier("onebox-\(item.id)")
  }

  @ViewBuilder
  private func picture(_ item: OneBoxItem) -> some View {
    if let orgID = item.orgID {
      PinTile(orgID: orgID, size: 26)
    } else if let hostID = item.hostID, let site = model.workspace?.sites.first(where: { $0.id == hostID }) {
      AglynBrandPicture(model.mediaURL(site.favicon, hostID: site.id), size: 26, cornerRadius: AglynRadius.control) {
        IconBadge("globe", tone: .info, size: 26)
      }
    } else {
      IconBadge(item.icon, tone: .neutral, size: 26)
    }
  }

  // MARK: What the box lists

  private var sections: [OneBoxSection] {
    let text = box.query.trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? switcherSections : searchSections(text)
  }

  /// Before typing: the switcher — Pinned (n of 5), Recent, then every workspace A to Z, 50 at a time.
  private var switcherSections: [OneBoxSection] {
    guard let workspace = model.workspace else { return [] }
    let pins = model.preferences?.pinned ?? []
    let pinned = pins.compactMap { id in workspace.orgs.first { $0.id == id } }
    let pinnedIDs = Set(pinned.map(\.id))
    let recent = (model.preferences?.recentOrgs ?? []).filter { !pinnedIDs.contains($0) }
      .compactMap { id in workspace.orgs.first { $0.id == id } }.prefix(ContractValues.shared.railRecentOrgs)
    let listed = pinnedIDs.union(recent.map(\.id))
    let rest = workspace.orgs.filter { !listed.contains($0.id) }
    let total = workspace.orgCount ?? workspace.orgs.count
    var out: [OneBoxSection] = []
    if !pinned.isEmpty {
      out.append(
        OneBoxSection(
          id: "pinned", heading: "Pinned \(pinned.count) of \(ContractValues.shared.pinnedOrgsMax)",
          items: pinned.enumerated().map { index, org in orgItem(org, trailing: "⌘\(index + 1)") }))
    }
    let recentItems = (model.preferences?.recents ?? []).filter { $0.orgId == workspace.org?.id }.prefix(4)
    if !recent.isEmpty || !recentItems.isEmpty {
      out.append(
        OneBoxSection(
          id: "recent", heading: "Recent",
          items: recent.map { orgItem($0, trailing: nil) } + recentItems.map(recentItem)))
    }
    if !rest.isEmpty {
      var items = rest.prefix(shownWorkspaces).map { orgItem($0, trailing: nil) }
      if rest.count > shownWorkspaces || workspace.hasMoreOrgs {
        items.append(
          OneBoxItem(
            id: "more-workspaces", label: "Show more · \(min(shownWorkspaces, rest.count) + listed.count) of \(total)",
            icon: "ellipsis", action: .loadMoreWorkspaces))
      }
      out.append(OneBoxSection(id: "all", heading: "All workspaces \(total)", items: items))
    }
    out.append(
      OneBoxSection(
        id: "add", heading: "",
        items: [OneBoxItem(id: "add-workspace", label: "Add workspace", icon: "plus", action: .addWorkspace)]))
    return out
  }

  /// Typing: workspaces and sites, the server's records by kind, then the app's own screens and settings.
  private func searchSections(_ text: String) -> [OneBoxSection] {
    var out: [OneBoxSection] = []
    let orgs = (model.workspace?.orgs ?? []).compactMap { org in
      scoreMatch(name: org.name, extra: [org.slug], query: text).map { (org, $0) }
    }.sorted { scoredFirst(($0.1, $0.0.name), ($1.1, $1.0.name)) }.prefix(5).map(\.0)
    if !orgs.isEmpty {
      out.append(OneBoxSection(id: "workspaces", heading: "Workspaces", items: orgs.map { orgItem($0, trailing: nil) }))
    }
    let sites = (model.workspace?.sites ?? []).compactMap { site in
      scoreMatch(name: site.name, extra: [site.subdomain], query: text).map { (site, $0) }
    }.sorted { scoredFirst(($0.1, $0.0.name), ($1.1, $1.0.name)) }.prefix(5).map(\.0)
    if !sites.isEmpty {
      out.append(
        OneBoxSection(
          id: "sites", heading: "Sites",
          items: sites.map { site in
            OneBoxItem(
              id: "site:\(site.id)", label: site.name,
              detail: "Site in \(model.workspace?.org?.name ?? "this workspace")", hostID: site.id, action: .site(site.id))
          }))
    }
    for group in box.remote where !group.rows.isEmpty {
      out.append(
        OneBoxSection(
          id: "remote:\(group.group)", heading: group.heading,
          items: group.rows.map { row in
            OneBoxItem(
              id: "\(group.group):\(row.id)", label: row.label, detail: row.detail, icon: Self.icon(group.group),
              action: row.link.map { .link($0, orgID: row.orgId, hostID: row.hostId) }
                ?? row.screen.map { .screen($0, row.params ?? [:]) } ?? .screen("", [:]))
          }))
    }
    let screens = rankOneBox(
      searchNavScreens(
        text, scope: scope.inSite ? "site" : "workspace",
        enabledPluginIds: scope.inSite ? scope.sitePlugins : scope.workspacePlugins, hostAdmin: scope.hostAdmin)
    ).filter { $0.screen.map { $0.hasPrefix("shell.") || model.registry.screen($0) != nil } ?? false }
    if !screens.isEmpty {
      out.append(
        OneBoxSection(
          id: "screens", heading: "Screens & settings",
          items: screens.prefix(6).map { row in
            OneBoxItem(
              id: "screen:\(row.id)", label: row.label, detail: row.detail, icon: screenIcon(row),
              action: .screen(row.screen ?? "", row.params ?? [:]))
          }))
    }
    return out
  }

  private func orgItem(_ org: WorkspaceOrg, trailing: String?) -> OneBoxItem {
    let plan = model.workspace?.orgLogos[org.id]?.planLabel
    return OneBoxItem(
      id: "org:\(org.id)", label: org.name,
      detail: ["Workspace", org.role.capitalized, plan].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "),
      orgID: org.id, trailing: trailing, action: .workspace(org.id))
  }

  private func recentItem(_ item: RecentItem) -> OneBoxItem {
    let site = item.hostId.flatMap { id in model.workspace?.sites.first { $0.id == id }?.name }
    return OneBoxItem(
      id: "recent:\(item.key)", label: item.label, detail: [site, relativeTime(Date(timeIntervalSince1970: Double(item.openedAtMs) / 1000))]
        .compactMap { $0 }.joined(separator: " · "),
      icon: "clock", action: .recent(item))
  }

  private func screenIcon(_ row: OneBoxRow) -> String {
    let all = NativeNav.manifest.lists.flatMap(\.groups).flatMap(\.rows)
    return all.first { $0.screen == row.screen }?.icon.apple ?? "gearshape"
  }

  /// One icon per kind of record.
  static func icon(_ group: String) -> String {
    switch group {
    case "pages": "doc.text"
    case "orders": "bag"
    case "products": "tag"
    case "contacts", "leads": "person.text.rectangle"
    case "emails": "envelope"
    case "components": "square.on.square"
    case "layouts": "rectangle.3.group"
    case "templates": "doc.on.doc"
    case "bookings": "calendar.badge.clock"
    case "events": "calendar"
    case "forms": "list.bullet.rectangle"
    default: "magnifyingglass"
    }
  }

  // MARK: Opening

  private func open(_ item: OneBoxItem) {
    switch item.action {
    case .workspace(let orgID):
      model.workspace?.open(orgID: orgID)
      navigation.enterWorkspace()
    case .site(let hostID):
      model.workspace?.selectSite(hostID)
      navigation.enterSite()
    case .screen(let screen, let params):
      guard !screen.isEmpty else { return }
      navigation.mode = .main
      navigation.select(ShellSection.opening(screen, params))
    case .link(let link, let orgID, let hostID):
      model.follow(link, orgID: orgID, hostID: hostID, in: navigation)
    case .recent(let recent):
      if recent.orgId != model.workspace?.org?.id { model.workspace?.open(orgID: recent.orgId, hostID: recent.hostId) }
      if let hostID = recent.hostId {
        model.workspace?.selectSite(hostID)
        navigation.inSite = true
      } else {
        navigation.inSite = false
      }
      navigation.mode = .main
      navigation.select(ShellSection.opening(recent.screen, recent.params))
    case .loadMoreWorkspaces:
      let rest = (model.workspace?.orgs.count ?? 0)
      if rest > shownWorkspaces { shownWorkspaces += 50 } else { model.workspace?.loadMoreOrgs() }
      return
    case .addWorkspace:
      navigation.showAddWorkspace = true
    }
    dismiss()
  }
}
