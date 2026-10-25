// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

// The phone's navigation (AGL-4006; Figma Phone 2:7: Home 22:176, Pin an area, Tab bar sheet, Area
// switcher, First open). Every area of the scope is the same tile on Home; the tab bar is Home and up to four areas the
// person pins, per site and per workspace (`users/{uid}.tabBars`), with Create new in the centre until four areas fill
// the bar. The rules are the shared contract's (`phoneHomeGroups`, `tabBarLayout`, `pinTabArea`, `autoPinTabArea`), so
// the Android phone draws the same.

/// What a phone shows where it stands: Home's tile groups, the areas that may be pinned, and this scope's tab bar.
@MainActor
struct PhoneAreas {
  let model: AppModel
  let navigation: ShellNavigation

  var scope: ShellScope { ShellScope(model: model, navigation: navigation) }

  /// Home's groups: every area of the scope, then the scope's own places (Overview, Site settings, Team, Workspace
  /// settings).
  var groups: [PhoneHomeGroup] {
    let scope = scope
    let team = scope.list(.workspaceSettings).groups.flatMap(\.rows).first { $0.id == "members" }
    return phoneHomeGroups(scope.mainList, team: team, ownerName: scope.org?.name ?? "")
  }

  var rows: [NativeNavRow] { groups.flatMap(\.rows) }

  /// The tiles that may go in the tab bar: every area, never a settings mode.
  var pinnable: [String] { rows.filter { isTabPinnable(screen: $0.screen) }.map(\.id) }

  /// This site's tab bar, or the whole workspace's.
  var tabScope: String? { scope.org.map { tabBarScope(orgID: $0.id, hostID: scope.site?.id) } }

  var pinned: [String] { tabScope.map { model.preferences?.tabAreas(scope: $0) ?? [] } ?? [] }

  var layout: TabBarLayout { tabBarLayout(pinned, available: pinnable) }

  func row(_ id: String) -> NativeNavRow? { rows.first { $0.id == id } }

  func isPinned(_ row: NativeNavRow) -> Bool { layout.slots.contains(row.id) }

  /// The tab a section is the root of, when it is one of the tab bar's areas.
  func tabSection(_ row: NativeNavRow) -> ShellSection? {
    isPinned(row) ? ShellSection.opening(row.screen, row.params) : nil
  }

  /// Opens a tile: a pinned area's own tab, any other area pushed on Home with its section chips, a settings mode's list
  /// pushed on Home. The first areas a person opens take the tab bar's free spots and stay (`autoPinTabArea`).
  func open(_ row: NativeNavRow) {
    switch ShellScope.target(of: row) {
    case .mode(let mode):
      navigation.section = .home
      navigation.mode = mode
      navigation.push(.modeList)
    case .section(let section):
      if let tab = tabSection(row) {
        navigation.select(tab)
      } else {
        navigation.openOnHome(section)
      }
      if isTabPinnable(screen: row.screen), let tabScope { model.preferences?.openedArea(row.id, scope: tabScope) }
    }
  }
}

/// Reads the count each row's plugin gives it (slot `sidebarCount.<row>`, Inbox's unread, …), unseen, for its tile or tab.
struct AreaCountReader: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let rowIDs: [String]
  @Binding var counts: [String: Int]

  var body: some View {
    if let context = model.context(for: navigation) {
      ForEach(rowIDs.filter { !$0.isEmpty }, id: \.self) { rowID in
        ForEach(model.registry.widgets(for: model.app, slot: "sidebarCount.\(rowID)")) { widget in
          widget.make(context).id("\(widget.id):\(context.orgID ?? ""):\(context.hostID ?? "")")
            .onPreferenceChange(AglynCountKey.self) { count in
              MainActor.assumeIsolated { counts[rowID] = count ?? 0 }
            }
        }
      }
      .hidden()
      .accessibilityHidden(true)
    }
  }
}

/// Home's tiles on a phone: every area of the scope, grouped as in the sidebar, four to a row (Figma 22:176).
struct PhoneHomeTiles: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @State private var counts: [String: Int] = [:]
  @State private var fullFor: NativeNavRow?
  /// Only the switcher's grid marks the area on screen; Home has none.
  var current: ShellSection?
  var filter = ""
  var onOpen: (() -> Void)?

  private let columns = Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: 4)

  var body: some View {
    let areas = PhoneAreas(model: model, navigation: navigation)
    let groups = filtered(areas.groups)
    VStack(alignment: .leading, spacing: 4) {
      ForEach(groups, id: \.id) { group in
        if let label = group.label { AglynAreaGroupHeader(label).accessibilityIdentifier("home-group-\(group.id)") }
        LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
          ForEach(group.rows, id: \.id) { row in tile(row, areas: areas) }
        }
      }
      if groups.isEmpty {
        Text("No area matches.").foregroundStyle(.secondary).padding(.top, 12)
          .accessibilityIdentifier("area-switcher-empty")
      }
    }
    .background { AreaCountReader(rowIDs: areas.rows.map(\.id), counts: $counts) }
    .alert(
      "Your tab bar is full", isPresented: Binding(get: { fullFor != nil }, set: { if !$0 { fullFor = nil } }),
      presenting: fullFor
    ) { _ in
      Button("Edit tab bar") { navigation.showTabBar = true }
      Button("Not now", role: .cancel) {}
    } message: { row in
      Text("It holds four areas beside Home. Remove one to add \(row.label).")
    }
  }

  private func tile(_ row: NativeNavRow, areas: PhoneAreas) -> some View {
    AglynAreaTile(
      row.label, systemImage: row.appleIcon, badge: counts[row.id] ?? 0,
      current: current.map { ShellScope.row(row, holds: $0) } ?? false
    ) {
      onOpen?()
      areas.open(row)
    }
    .contextMenu { menu(row, areas: areas) }
    .accessibilityIdentifier("home-tile-\(row.id)")
  }

  /// Long-press a tile (Figma "Pin an area"): Add to tab bar or Remove from tab bar, Star, Edit tab bar….
  @ViewBuilder
  private func menu(_ row: NativeNavRow, areas: PhoneAreas) -> some View {
    if isTabPinnable(screen: row.screen), let scope = areas.tabScope {
      if areas.pinned.contains(row.id) {
        Button("Remove from tab bar", systemImage: "pin.slash") { model.preferences?.unpinTab(row.id, scope: scope) }
          .accessibilityIdentifier("tile-unpin-\(row.id)")
      } else {
        Button("Add to tab bar", systemImage: "pin") {
          if model.preferences?.pinTab(row.id, scope: scope) == .full { fullFor = row }
        }
        .accessibilityIdentifier("tile-pin-\(row.id)")
      }
    }
    if let item = model.itemRef(for: row, navigation: navigation), isTabPinnable(screen: row.screen) {
      let starred = model.preferences?.isStarred(item) == true
      Button(starred ? "Unstar" : "Star", systemImage: starred ? "star.slash" : "star") {
        model.preferences?.toggleStar(item)
      }
    }
    Button("Edit tab bar…", systemImage: "dock.rectangle") { navigation.showTabBar = true }
      .accessibilityIdentifier("tile-edit-tab-bar")
  }

  private func filtered(_ groups: [PhoneHomeGroup]) -> [PhoneHomeGroup] {
    let text = filter.trimmingCharacters(in: .whitespaces)
    guard !text.isEmpty else { return groups }
    return groups.compactMap { group in
      var next = group
      next.rows = group.rows.filter { scoreMatch(name: $0.label, extra: ($0.keywords ?? []) + [$0.description], query: text) != nil }
      return next.rows.isEmpty ? nil : next
    }
  }
}

/// The area switcher (Figma Area switcher): an area's title ▾ opens every area of the scope as the same tiles, with a
/// field to find one; the area on screen wears the ring. Any area to any other in two taps.
struct AreaSwitcherSheet: View {
  @Environment(\.dismiss) private var dismiss
  @Environment(ShellNavigation.self) private var navigation
  @State private var filter = ""

  var body: some View {
    NavigationStack {
      ScrollView {
        PhoneHomeTiles(current: navigation.paths[navigation.section]?.last.flatMap(Self.section) ?? navigation.section,
          filter: filter, onOpen: { dismiss() })
          .padding(.horizontal, 16)
          .padding(.bottom, 24)
      }
      #if os(iOS)
      .searchable(text: $filter, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find an area")
      #else
      .searchable(text: $filter, prompt: "Find an area")
      #endif
      .navigationTitle("Go to")
      #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }.fontWeight(.semibold).accessibilityIdentifier("area-switcher-done")
        }
      }
      .background(AglynColor.paper)
    }
    .presentationDetents([.large])
    .presentationDragIndicator(.visible)
    .accessibilityIdentifier("area-switcher")
  }

  /// The area a pushed route stands for.
  private static func section(_ route: Route) -> ShellSection? {
    switch route {
    case .area(let screen, let params): ShellSection.opening(screen, params)
    case .analytics: .analytics
    default: nil
    }
  }
}

/// The Tab bar sheet (Figma Tab bar sheet): the pinned areas to remove and drag into order, the others to add, and a
/// preview of the bar. Home is always first; four areas at most, and with four Create moves to the top bar.
struct TabBarSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  @Environment(\.dismiss) private var dismiss
  @State private var draft: [String] = []
  @State private var started = false

  var body: some View {
    let areas = PhoneAreas(model: model, navigation: navigation)
    let max = ContractValues.shared.tabBarAreasMax
    NavigationStack {
      List {
        Section {
          preview(areas)
          Text("Home is always first. Pick up to \(max) areas; drag to reorder. With \(max), + Create moves to the top bar.")
            .font(AglynFont.caption)
            .foregroundStyle(.secondary)
            .listRowSeparator(.hidden)
        }
        Section("In your tab bar · \(draft.count) of \(max)") {
          ForEach(draft, id: \.self) { id in
            if let row = areas.row(id) {
              Label { Text(row.label) } icon: { AglynPhoneRowIcon(systemName: row.appleIcon) }
                .accessibilityIdentifier("tab-bar-pinned-\(id)")
            }
          }
          .onMove { draft.move(fromOffsets: $0, toOffset: $1) }
          .onDelete { draft.remove(atOffsets: $0) }
          if draft.isEmpty {
            Text("Nothing pinned yet. The first areas you open take the free spots.").foregroundStyle(.secondary)
          }
        }
        Section("Add an area") {
          ForEach(areas.pinnable.filter { !draft.contains($0) }, id: \.self) { id in
            if let row = areas.row(id) {
              Button {
                draft.append(id)
              } label: {
                HStack(spacing: 12) {
                  Image(systemName: "plus.circle.fill").foregroundStyle(AglynColor.primary).font(.system(size: 20))
                  Label { Text(row.label).foregroundStyle(AglynColor.textPrimary) } icon: {
                    AglynPhoneRowIcon(systemName: row.appleIcon)
                  }
                }
              }
              .disabled(draft.count >= max)
              .accessibilityIdentifier("tab-bar-add-\(id)")
            }
          }
        }
      }
      #if os(iOS)
      .environment(\.editMode, .constant(.active))
      #endif
      .navigationTitle("Tab bar")
      #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") {
            if let scope = areas.tabScope, draft != areas.pinned { model.preferences?.setTabs(draft, scope: scope) }
            dismiss()
          }
          .fontWeight(.semibold)
          .accessibilityIdentifier("tab-bar-done")
        }
      }
    }
    .presentationDetents([.large])
    .presentationDragIndicator(.visible)
    .onAppear {
      guard !started else { return }
      started = true
      draft = areas.pinned
    }
    .accessibilityIdentifier("tab-bar-sheet")
  }

  /// The bar as it will be: Home, the areas, and Create where it will sit.
  private func preview(_ areas: PhoneAreas) -> some View {
    let layout = tabBarLayout(draft, available: areas.pinnable)
    let values = ContractValues.shared
    return HStack(spacing: 0) {
      ForEach(layout.slots, id: \.self) { slot in
        VStack(spacing: 3) {
          if slot == values.tabBarCreate {
            Image(systemName: "plus").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
              .frame(width: 40, height: 28)
              .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(AglynColor.primary))
          } else {
            let row = slot == values.tabBarHome ? nil : areas.row(slot)
            Image(systemName: row?.appleIcon ?? "house").symbolVariant(.none).font(.system(size: 17))
              .foregroundStyle(slot == values.tabBarHome ? AglynColor.primary : AglynColor.textTertiary)
              .frame(height: 28)
            Text(row?.label ?? "Home").font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
          }
        }
        .frame(maxWidth: .infinity)
      }
    }
    .padding(.vertical, 8)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Preview: Home, \(layout.slots.compactMap { areas.row($0)?.label }.joined(separator: ", "))")
    .accessibilityIdentifier("tab-bar-preview")
  }
}

/// The one-time tip on a fresh tab bar (Figma First open): kept on the device, gone once dismissed or once a pin lands.
struct PinAreasTip: View {
  @AppStorage("aglyn.phone.pinTipSeen") private var seen = false
  let shown: Bool

  var body: some View {
    if shown && !seen {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: "pin").font(.system(size: 20)).foregroundStyle(AglynColor.tint)
        VStack(alignment: .leading, spacing: 4) {
          Text("Pin areas to your tab bar").font(AglynFont.strongSubheadline)
          Text(
            "Long-press any tile and choose Add to tab bar, up to \(ContractValues.shared.tabBarAreasMax). The first areas you open take the free spots and stay; remove them anytime in your account → Tab bar."
          )
          .font(AglynFont.caption).foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
        Button {
          seen = true
        } label: {
          Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(AglynColor.textTertiary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Dismiss")
        .accessibilityIdentifier("pin-tip-dismiss")
      }
      .padding(14)
      .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(AglynColor.paper))
      .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(AglynColor.divider))
      .padding(.horizontal, 16)
      .padding(.bottom, 12)
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("pin-tip")
    }
  }
}

/// An area's title ▾ on a phone (AGL-4006): every area of the scope, by group, to switch in place; "All areas" opens them
/// as tiles (Figma Area switcher).
struct PhoneAreaTitleMenu: ViewModifier {
  @Environment(AppModel.self) private var model
  @Environment(ShellNavigation.self) private var navigation
  let enabled: Bool

  func body(content: Content) -> some View {
    #if os(iOS)
      if enabled {
        content.toolbarTitleMenu {
          let areas = PhoneAreas(model: model, navigation: navigation)
          Button("All areas", systemImage: "square.grid.2x2") { navigation.showAreaSwitcher = true }
            .accessibilityIdentifier("area-title-all")
          ForEach(areas.groups, id: \.id) { group in
            Section(group.label ?? "") {
              ForEach(group.rows, id: \.id) { row in
                Button(row.label, systemImage: row.appleIcon) { areas.open(row) }
              }
            }
          }
        }
      } else {
        content
      }
    #else
      content
    #endif
  }
}

/// The bell on a phone (AGL-4006, Figma Activity): what needs you, then the notifications.
struct ActivitySheet: View {
  var body: some View {
    VStack(spacing: 0) {
      NeedsYouSection()
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 8)
      NotificationsPopover()
    }
    .background(AglynColor.paper)
    .accessibilityIdentifier("activity-sheet")
  }
}
