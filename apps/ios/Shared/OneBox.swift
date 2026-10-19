// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import Observation
import SwiftUI

// The one box (⌘K, Zach 2026-10-18; P3 2026-10-19): a real text field in the title bar, its results in a dropdown
// anchored under it (Figma search dropdown 118:16068), never a dialog. Focused and empty it lists Recent places and
// Starred; typing finds workspaces and sites, the app's own screens and settings (`searchNavScreens`, on the device), and
// every record the server matches (`/api/search`), grouped by kind, with "See all results" opening the full screen. On a
// phone the top bar's search button opens the same, full screen.

/// What a row of the box does when opened.
enum OneBoxAction: Hashable {
  case workspace(String)
  case site(String)
  case screen(String, [String: String])
  /// A server row: its console link, through the app's deep-link resolver, in its own workspace and site.
  case link(String, orgID: String?, hostID: String?)
  /// A recent or starred place: its workspace, site and screen.
  case place(orgID: String, hostID: String?, screen: String, params: [String: String])
  /// The full results for what was typed, in the current tab.
  case allResults(String)
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
  /// A figure at the end of the row (an order's total).
  var trailing: String? = nil
  let action: OneBoxAction
}

struct OneBoxSection: Identifiable, Hashable {
  let id: String
  let heading: String
  var items: [OneBoxItem]
  /// A hairline above the section (the "See all results" row).
  var ruled = false
}

/// The box's state: what was typed, the server's groups for it, and the row the keyboard is on. One per tab.
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
  func search(_ client: OneBoxClient?, orgID: String?, hostID: String?, limit: Int? = nil) {
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
        let response = try await client.search(text, orgID: orgID, hostID: hostID, limit: limit)
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

  /// Back to empty, for the next time the box opens.
  func reset() {
    task?.cancel()
    query = ""
    remote = []
    searching = false
    failed = false
    selected = nil
  }
}

/// What the box lists where a window stands.
@MainActor
struct OneBoxCatalog {
  let model: AppModel
  let navigation: ShellNavigation
  let box: OneBoxModel

  private var scope: ShellScope { ShellScope(model: model, navigation: navigation) }

  var sections: [OneBoxSection] {
    let text = box.query.trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? emptySections : searchSections(text, perGroup: 5, seeAll: true)
  }

  /// Focused, nothing typed: the account's recent places and what it starred (Figma "Empty" 118:15883).
  var emptySections: [OneBoxSection] {
    var out: [OneBoxSection] = []
    let recents = (model.preferences?.recents ?? []).prefix(4).map { item in
      OneBoxItem(
        id: "recent:\(item.key)", label: item.label, detail: owner(orgID: item.orgId, hostID: item.hostId),
        icon: Self.icon(forScreen: item.screen, fallback: "clock"),
        action: .place(orgID: item.orgId, hostID: item.hostId, screen: item.screen, params: item.params ?? [:]))
    }
    if !recents.isEmpty { out.append(OneBoxSection(id: "recent", heading: "Recent places", items: recents)) }
    let starred = (model.preferences?.starred ?? []).prefix(5).map { item in
      OneBoxItem(
        id: "starred:\(item.key)", label: item.label, detail: owner(orgID: item.orgId, hostID: item.hostId), icon: "star",
        action: .place(orgID: item.orgId, hostID: item.hostId, screen: item.screen, params: item.params ?? [:]))
    }
    if !starred.isEmpty { out.append(OneBoxSection(id: "starred", heading: "Starred", items: starred)) }
    return out
  }

  /// Typing: workspaces and sites, the server's records by kind, then the app's own screens and settings; the box ends
  /// with "See all results".
  func searchSections(_ text: String, perGroup: Int, seeAll: Bool) -> [OneBoxSection] {
    var out: [OneBoxSection] = []
    let orgs = (model.workspace?.orgs ?? []).compactMap { org in
      scoreMatch(name: org.name, extra: [org.slug], query: text).map { (org, $0) }
    }.sorted { scoredFirst(($0.1, $0.0.name), ($1.1, $1.0.name)) }.prefix(perGroup).map(\.0)
    if !orgs.isEmpty {
      out.append(
        OneBoxSection(
          id: "workspaces", heading: "Workspaces",
          items: orgs.map { org in
            let plan = model.workspace?.orgLogos[org.id]?.planLabel
            let recent = (model.preferences?.recentOrgs ?? []).contains(org.id)
            return OneBoxItem(
              id: "org:\(org.id)", label: org.name,
              detail: ["Workspace", org.role.capitalized, plan, recent ? "Recent" : nil]
                .compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · "),
              orgID: org.id, action: .workspace(org.id))
          }))
    }
    let sites = (model.workspace?.sites ?? []).compactMap { site in
      scoreMatch(name: site.name, extra: [site.subdomain], query: text).map { (site, $0) }
    }.sorted { scoredFirst(($0.1, $0.0.name), ($1.1, $1.0.name)) }.prefix(perGroup).map(\.0)
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
    // The server's workspaces and sites join the ones matched on the device, never as a second group of the same name.
    for group in box.remote where ["sites", "workspaces"].contains(group.group) {
      guard let index = out.firstIndex(where: { $0.id == group.group }) else { continue }
      let known = Set(out[index].items.map { String($0.id.split(separator: ":", maxSplits: 1).last ?? "") })
      out[index].items += group.rows.filter { !known.contains($0.hostId ?? $0.orgId ?? $0.id) && !known.contains($0.id) }
        .prefix(max(0, perGroup - out[index].items.count)).map { row in
          OneBoxItem(
            id: "\(group.group):\(row.id)", label: row.label, detail: row.detail, icon: Self.icon(group.group),
            action: row.link.map { .link($0, orgID: row.orgId, hostID: row.hostId) }
              ?? row.screen.map { .screen($0, row.params ?? [:]) } ?? .screen("", [:]))
        }
    }
    let merged = Set(out.map(\.id))
    for group in box.remote where !group.rows.isEmpty && !merged.contains(group.group) {
      out.append(
        OneBoxSection(
          id: "remote:\(group.group)", heading: group.heading,
          items: group.rows.prefix(perGroup).map { row in
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
          items: screens.prefix(perGroup + 1).map { row in
            OneBoxItem(
              id: "screen:\(row.id)", label: row.label, detail: row.detail,
              icon: Self.icon(forScreen: row.screen ?? "", fallback: "gearshape"),
              action: .screen(row.screen ?? "", row.params ?? [:]))
          }))
    }
    if seeAll {
      out.append(
        OneBoxSection(
          id: "all", heading: "",
          items: [
            OneBoxItem(
              id: "all-results", label: "See all results for “\(text)”", detail: "Opens the full results, grouped, with filters",
              action: .allResults(text))
          ], ruled: true))
    }
    return out
  }

  /// Where a recent or starred place is: its site in this workspace, else its workspace.
  private func owner(orgID: String, hostID: String?) -> String? {
    let site = hostID.flatMap { id in model.workspace?.sites.first { $0.id == id }?.name }
    let org = model.workspace?.orgs.first { $0.id == orgID }?.name
    return site ?? org
  }

  /// A manifest screen's own icon.
  static func icon(forScreen screen: String, fallback: String) -> String {
    let all = NativeNav.manifest.lists.flatMap(\.groups).flatMap(\.rows)
    return all.first { $0.screen == screen }?.icon.apple ?? fallback
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
    case "sites": "globe"
    case "workspaces": "building.2"
    default: "magnifyingglass"
    }
  }

  /// Opens a row where the window stands.
  static func open(_ item: OneBoxItem, model: AppModel, navigation: ShellNavigation) {
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
    case .place(let orgID, let hostID, let screen, let params):
      if orgID != model.workspace?.org?.id { model.workspace?.open(orgID: orgID, hostID: hostID) }
      if let hostID {
        model.workspace?.selectSite(hostID)
        navigation.inSite = true
      } else {
        navigation.inSite = false
      }
      navigation.mode = .main
      navigation.select(ShellSection.opening(screen, params))
    case .allResults(let text):
      navigation.mode = .main
      navigation.push(.searchResults(text))
    }
  }
}

// MARK: Drawing

/// A section heading in the box (Figma "Recent places", 12 points semibold).
struct OneBoxHeading: View {
  let title: String

  var body: some View {
    Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(AglynColor.secondaryText)
      .padding(EdgeInsets(top: 8, leading: 10, bottom: 4, trailing: 10))
      .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
      .accessibilityAddTraits(.isHeader)
  }
}

/// A key cap in the box's hints ("esc", "↵").
struct OneBoxKey: View {
  let keys: String

  init(_ keys: String) { self.keys = keys }

  var body: some View {
    Text(keys).font(.system(size: 11, weight: .medium)).foregroundStyle(AglynColor.secondaryText)
      .padding(.horizontal, 5).padding(.vertical, 1)
      .frame(minHeight: 18)
      .background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(AglynColor.paper))
      .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(AglynColor.divider))
  }
}

/// One row of the box (Figma 118:16068 row, 44 points): its picture on a 28-point tile, title and detail, the ↵ key on
/// the row the keyboard is on.
struct OneBoxRowView: View {
  @Environment(AppModel.self) private var model
  let item: OneBoxItem
  let selected: Bool
  var showsReturn = true
  let open: () -> Void
  @State private var hovered = false

  var body: some View {
    Button(action: open) {
      HStack(spacing: 10) {
        picture
        VStack(alignment: .leading, spacing: 0) {
          Text(item.label).font(.system(size: 13, weight: .semibold)).foregroundStyle(AglynColor.textPrimary).lineLimit(1)
          if let detail = item.detail, !detail.isEmpty {
            Text(detail).font(.system(size: 12)).foregroundStyle(AglynColor.secondaryText).lineLimit(1)
          }
        }
        Spacer(minLength: 6)
        if let trailing = item.trailing {
          Text(trailing).font(.system(size: 12)).foregroundStyle(AglynColor.secondaryText)
        }
        if selected && showsReturn { OneBoxKey("↵") }
      }
      .padding(.horizontal, 10)
      .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 6, style: .continuous)
          .fill(selected ? AglynColor.accentSoft : hovered ? AglynColor.hover : .clear))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 }
    .accessibilityAddTraits(selected ? .isSelected : [])
    .accessibilityIdentifier("onebox-\(item.id)")
  }

  @ViewBuilder
  private var picture: some View {
    if let orgID = item.orgID {
      PinTile(orgID: orgID, size: 28)
    } else if let hostID = item.hostID, let site = model.workspace?.sites.first(where: { $0.id == hostID }) {
      AglynBrandPicture(model.mediaURL(site.favicon, hostID: site.id), size: 28, cornerRadius: 8) {
        AglynWorkspaceTile(
          name: site.name, logoURL: nil, colorHex: model.workspaceColor(model.workspace?.org?.id).color, selected: false,
          size: 28)
        .padding(-3)
      }
    } else {
      Image(systemName: item.icon).font(.system(size: 14)).foregroundStyle(AglynColor.secondaryText)
        .frame(width: 28, height: 28)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(AglynColor.sunken))
    }
  }
}

/// The box's sections as rows, with the keyboard's row kept in view.
struct OneBoxResultsList: View {
  let sections: [OneBoxSection]
  let selected: String?
  var showsReturn = true
  let open: (OneBoxItem) -> Void

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView(.vertical) {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(sections) { section in
            if section.ruled {
              Rectangle().fill(AglynColor.divider).frame(height: 1).padding(.horizontal, 10).padding(.vertical, 4)
            }
            if !section.heading.isEmpty { OneBoxHeading(title: section.heading) }
            ForEach(section.items) { item in
              OneBoxRowView(item: item, selected: item.id == selected, showsReturn: showsReturn) { open(item) }.id(item.id)
            }
          }
        }
        .padding(EdgeInsets(top: 4, leading: 6, bottom: 6, trailing: 6))
      }
      .scrollIndicators(.automatic)
      .onChange(of: selected) { _, id in if let id { proxy.scrollTo(id) } }
    }
  }

  /// The list's natural height, so the dropdown is only as tall as what it lists.
  static func height(_ sections: [OneBoxSection]) -> CGFloat {
    sections.reduce(10) { total, section in
      total + (section.heading.isEmpty ? 0 : 28) + (section.ruled ? 9 : 0) + CGFloat(section.items.count) * 44
    }
  }
}

/// The hints along the box's foot (Figma: "↑↓ to move", "↵ to open", "esc to close", then where it searches).
struct OneBoxFooter: View {
  let typing: Bool
  let scopeLine: String

  var body: some View {
    HStack(spacing: 16) {
      hint("↑↓", "to move")
      hint("↵", "to open")
      hint("esc", "to close")
      Spacer(minLength: 8)
      Text(scopeLine).font(.system(size: 12)).foregroundStyle(AglynColor.secondaryText).lineLimit(1)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .frame(minHeight: 38)
    .background(AglynColor.sunken)
  }

  private func hint(_ keys: String, _ words: String) -> some View {
    HStack(spacing: 6) {
      OneBoxKey(keys)
      Text(words).font(.system(size: 12)).foregroundStyle(AglynColor.secondaryText)
    }
  }
}

extension ShellScope {
  /// Where the box searches, said at its foot.
  func oneBoxScopeLine(typing: Bool) -> String {
    if typing { return site != nil ? "Searching this site and its workspace" : "Searching this workspace" }
    return "Type to search workspaces, sites, pages, orders and contacts"
  }
}

/// The dropdown under the title bar's field (Figma 118:16068: 560 points, radius 12, a hairline and a soft shadow).
struct OneBoxDropdown: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let close: () -> Void

  static let width: CGFloat = 560

  var body: some View {
    let box = navigation.search
    let sections = OneBoxCatalog(model: model, navigation: navigation, box: box).sections
    let typing = !box.query.trimmingCharacters(in: .whitespaces).isEmpty
    let scope = ShellScope(model: model, navigation: navigation)
    VStack(spacing: 0) {
      if sections.isEmpty {
        Text(
          typing
            ? (box.searching ? "Searching…" : "Nothing matches “\(box.query)”.")
            : "Places you open and star show here.")
          .font(.system(size: 13)).foregroundStyle(AglynColor.secondaryText)
          .frame(maxWidth: .infinity, minHeight: 56)
          .accessibilityIdentifier("onebox-empty")
      } else {
        OneBoxResultsList(sections: sections, selected: box.selected ?? sections.first?.items.first?.id) { item in
          OneBoxCatalog.open(item, model: model, navigation: navigation)
          close()
        }
        .frame(height: min(OneBoxResultsList.height(sections), 460))
      }
      if box.failed {
        Text("Records could not be searched just now. Workspaces, sites and settings still show.")
          .font(.system(size: 12)).foregroundStyle(AglynColor.secondaryText)
          .padding(.horizontal, 16).padding(.bottom, 8)
      }
      Rectangle().fill(AglynColor.divider).frame(height: 1)
      OneBoxFooter(typing: typing, scopeLine: scope.oneBoxScopeLine(typing: typing))
    }
    .frame(width: Self.width)
    .background(AglynColor.paper)
    .clipShape(RoundedRectangle(cornerRadius: AglynShellMetrics.sheetRadius, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: AglynShellMetrics.sheetRadius, style: .continuous).strokeBorder(AglynColor.divider))
    .shadow(color: .black.opacity(0.12), radius: 20, y: 12)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("onebox-dropdown")
  }
}

/// The title bar's search (Figma Titlebar/Search field 8:90): a real field, centered; a click or ⌘K puts the caret in it,
/// and the dropdown opens under it. Esc, a click outside or opening a result closes it.
struct TitleBarSearch: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @FocusState private var focused: Bool

  var body: some View {
    @Bindable var box = navigation.search
    let open = navigation.showOneBox
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass").font(.system(size: AglynShellMetrics.rowText - 1))
        .foregroundStyle(AglynColor.textTertiary)
        .accessibilityHidden(true)
      TextField("Search or jump to", text: $box.query)
        .textFieldStyle(.plain)
        .font(.system(size: AglynShellMetrics.rowText))
        .focused($focused)
        .onSubmit { openSelected() }
        .onKeyPress(.downArrow) { move(down: true) }
        .onKeyPress(.upArrow) { move(down: false) }
        .onKeyPress(.escape) {
          close()
          return .handled
        }
        .accessibilityIdentifier("onebox-field")
      if box.searching { ProgressView().controlSize(.mini) }
      OneBoxKey(open ? "esc" : "⌘K")
        .onTapGesture { if open { close() } }
        .accessibilityHidden(true)
    }
    .padding(.horizontal, 10)
    // Centered on the window, 240 to 480 points wide (Figma Mac/Titlebar 12:910).
    .frame(minWidth: 240, maxWidth: 480)
    .frame(height: AglynShellMetrics.barButton)
    .background(
      RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous)
        .fill(open ? AglynColor.paper : AglynColor.sunken))
    .overlay(
      RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous)
        .strokeBorder(open ? AglynColor.accentIcon : AglynColor.divider, lineWidth: open ? 2 : 1))
    .contentShape(Rectangle())
    .onTapGesture { focused = true }
    .anchorPreference(key: OneBoxAnchorKey.self, value: .bounds) { $0 }
    .help("Search or jump to (⌘K)")
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("titlebar-search")
    .onChange(of: focused) { _, now in if now { navigation.showOneBox = true } }
    .onChange(of: navigation.showOneBox, initial: true) { _, now in
      if now != focused { focused = now }
      if !now { navigation.search.reset() }
    }
    .onChange(of: box.query) {
      box.selected = nil
      if !box.query.isEmpty { navigation.showOneBox = true }
      let scope = ShellScope(model: model, navigation: navigation)
      box.search(model.api.map(OneBoxClient.init), orgID: scope.org?.id, hostID: scope.site?.id)
    }
  }

  private var flat: [OneBoxItem] {
    OneBoxCatalog(model: model, navigation: navigation, box: navigation.search).sections.flatMap(\.items)
  }

  private func move(down: Bool) -> KeyPress.Result {
    guard navigation.showOneBox else { return .ignored }
    let ids = flat.map(\.id)
    let box = navigation.search
    let current = box.selected ?? ids.first
    box.selected = AglynSelectionKeys.step(ids, from: current, down: down) ?? current
    return .handled
  }

  private func openSelected() {
    let items = flat
    guard let item = items.first(where: { $0.id == navigation.search.selected }) ?? items.first else { return }
    OneBoxCatalog.open(item, model: model, navigation: navigation)
    close()
  }

  private func close() {
    navigation.showOneBox = false
    focused = false
  }
}

/// Where the title bar's field sits, so the window can draw the dropdown under it, above the content.
struct OneBoxAnchorKey: PreferenceKey {
  static let defaultValue: Anchor<CGRect>? = nil
  static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) { value = value ?? nextValue() }
}

/// The dropdown over the window, under the field, and a click anywhere else closing it (the field itself stays live).
struct OneBoxOverlay: ViewModifier {
  @Environment(AppModel.self) private var model
  let navigation: ShellNavigation

  func body(content: Content) -> some View {
    content.overlayPreferenceValue(OneBoxAnchorKey.self) { anchor in
      GeometryReader { proxy in
        if navigation.showOneBox, let anchor {
          let field = proxy[anchor]
          ZStack(alignment: .topLeading) {
            Rectangle().fill(Color.clear)
              .contentShape(OutsideShape(hole: field), eoFill: true)
              .onTapGesture { navigation.showOneBox = false }
              .accessibilityHidden(true)
            OneBoxDropdown { navigation.showOneBox = false }
              .environment(navigation)
              .offset(
                x: min(max(8, field.midX - OneBoxDropdown.width / 2), proxy.size.width - OneBoxDropdown.width - 8),
                y: field.maxY + 6)
          }
          .transition(.opacity)
        }
      }
    }
    .animation(.easeOut(duration: 0.12), value: navigation.showOneBox)
  }
}

/// Everything but a hole: the dropdown's click-outside catcher leaves the field itself clickable.
private struct OutsideShape: Shape {
  let hole: CGRect
  func path(in rect: CGRect) -> Path {
    var path = Path(rect)
    path.addRect(hole)
    return path
  }
}

// MARK: Phone

/// The phone's search: the same box, full screen, from the top bar's search button (Figma iPhone 69:744 / 118:21130).
struct PhoneSearchView: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.dismiss) private var dismiss
  @FocusState private var focused: Bool

  var body: some View {
    @Bindable var box = navigation.search
    let sections = OneBoxCatalog(model: model, navigation: navigation, box: box).sections
    let typing = !box.query.trimmingCharacters(in: .whitespaces).isEmpty
    VStack(spacing: 0) {
      HStack(spacing: 10) {
        HStack(spacing: 8) {
          Image(systemName: "magnifyingglass").foregroundStyle(AglynColor.textTertiary).accessibilityHidden(true)
          TextField("Search or jump to", text: $box.query)
            .textFieldStyle(.plain)
            .font(.system(size: 17))
            .focused($focused)
            .submitLabel(.search)
            .onSubmit { if let first = sections.first?.items.first { open(first) } }
            .accessibilityIdentifier("onebox-field")
          if box.searching { ProgressView().controlSize(.small) }
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(AglynColor.sunken))
        Button("Cancel") { dismiss() }
          .accessibilityIdentifier("onebox-cancel")
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 10)
      Divider()
      if sections.isEmpty {
        Text(typing ? (box.searching ? "Searching…" : "Nothing matches “\(box.query)”.") : "Places you open and star show here.")
          .font(AglynFont.subheadline).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity).padding(.top, 32)
          .accessibilityIdentifier("onebox-empty")
        Spacer()
      } else {
        OneBoxResultsList(sections: sections, selected: nil, showsReturn: false) { open($0) }
      }
    }
    .background(AglynColor.paper)
    .onAppear { focused = true }
    .onDisappear { box.reset() }
    .onChange(of: box.query) {
      let scope = ShellScope(model: model, navigation: navigation)
      box.search(model.api.map(OneBoxClient.init), orgID: scope.org?.id, hostID: scope.site?.id)
    }
  }

  private func open(_ item: OneBoxItem) {
    dismiss()
    OneBoxCatalog.open(item, model: model, navigation: navigation)
  }
}

// MARK: All results

/// "See all results for 'x'" (Figma Mac All results 118:19276, iPad 118:19323, iPhone 118:21130): every group the
/// search found, a filter per kind, and more of a group on request; in the tab it was asked from.
struct SearchResultsScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let initial: String
  @State private var box = OneBoxModel()
  @State private var filter: String?
  @State private var extra: [String: [OneBoxRow]] = [:]
  @State private var cursors: [String: Int] = [:]

  var body: some View {
    let all = OneBoxCatalog(model: model, navigation: navigation, box: box)
      .searchSections(box.query, perGroup: 50, seeAll: false)
      .map { section -> OneBoxSection in
        var next = section
        let group = String(section.id.dropFirst("remote:".count))
        if section.id.hasPrefix("remote:"), let more = extra[group] {
          next.items += more.map { row in
            OneBoxItem(
              id: "\(group):\(row.id)", label: row.label, detail: row.detail, icon: OneBoxCatalog.icon(group),
              action: row.link.map { .link($0, orgID: row.orgId, hostID: row.hostId) }
                ?? row.screen.map { .screen($0, row.params ?? [:]) } ?? .screen("", [:]))
          }
        }
        return next
      }
    let shown = all.filter { filter == nil || $0.id == filter }
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass").foregroundStyle(AglynColor.textTertiary).accessibilityHidden(true)
        TextField("Search", text: $box.query)
          .textFieldStyle(.plain)
          .font(.system(size: AglynShellMetrics.rowText + 1))
          .accessibilityIdentifier("search-results-field")
      }
      .padding(.horizontal, 10)
      .frame(height: 32)
      .background(RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).fill(AglynColor.sunken))
      .padding(.horizontal, AglynContentInsets.horizontal)
      .padding(.top, 8)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
          AglynChoiceChip("All", selected: filter == nil) { filter = nil }
          ForEach(all) { section in
            AglynChoiceChip("\(section.heading) \(count(section))", selected: filter == section.id) { filter = section.id }
              .accessibilityIdentifier("search-filter-\(section.id)")
          }
        }
        .padding(.horizontal, AglynContentInsets.horizontal)
        .padding(.vertical, 10)
      }
      Divider()
      if shown.isEmpty {
        AglynEmptyState(
          box.searching ? "Searching…" : "Nothing matches “\(box.query)”", systemImage: "magnifyingglass",
          message: "Try another word, or fewer words.")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(shown) { section in
              OneBoxHeading(title: section.heading)
              ForEach(section.items) { item in
                OneBoxRowView(item: item, selected: false, showsReturn: false) {
                  OneBoxCatalog.open(item, model: model, navigation: navigation)
                }
              }
              if let more = moreFor(section) {
                Button("Show more \(section.heading.lowercased())") { loadMore(more) }
                  .buttonStyle(.plain)
                  .font(.system(size: 13, weight: .medium))
                  .foregroundStyle(AglynColor.tint)
                  .padding(.horizontal, 10)
                  .frame(minHeight: 36)
                  .accessibilityIdentifier("search-more-\(section.id)")
              }
            }
          }
          .padding(.horizontal, AglynContentInsets.horizontal - 10)
          .padding(.bottom, 24)
        }
      }
    }
    .background(AglynColor.paper)
    .aglynScreenTitle("Results for “\(box.query)”")
    .navigationTitle("Results")
    .onAppear {
      if box.query.isEmpty {
        box.query = initial
      }
    }
    .onChange(of: box.query, initial: false) {
      extra = [:]
      cursors = [:]
      let scope = ShellScope(model: model, navigation: navigation)
      box.search(model.api.map(OneBoxClient.init), orgID: scope.org?.id, hostID: scope.site?.id, limit: 20)
    }
  }

  private func count(_ section: OneBoxSection) -> String {
    let group = section.id.hasPrefix("remote:") ? box.remote.first { "remote:\($0.group)" == section.id } : nil
    return "\(group.map { max($0.matched, section.items.count) } ?? section.items.count)"
  }

  /// The group's next page, when the server has one.
  private func moreFor(_ section: OneBoxSection) -> (group: String, cursor: Int)? {
    guard section.id.hasPrefix("remote:") else { return nil }
    let group = String(section.id.dropFirst("remote:".count))
    if let cursor = cursors[group] { return cursor >= 0 ? (group, cursor) : nil }
    return box.remote.first { $0.group == group }?.nextCursor.map { (group, $0) }
  }

  private func loadMore(_ more: (group: String, cursor: Int)) {
    let scope = ShellScope(model: model, navigation: navigation)
    guard let api = model.api else { return }
    let text = box.query
    Task {
      guard
        let response = try? await OneBoxClient(api: api).search(
          text, orgID: scope.org?.id, hostID: scope.site?.id, limit: 20, group: more.group, cursor: more.cursor),
        box.query == text, let group = response.groups.first(where: { $0.group == more.group })
      else { return }
      extra[more.group, default: []] += group.rows
      cursors[more.group] = group.nextCursor ?? -1
    }
  }
}
