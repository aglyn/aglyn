// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import Observation
import SwiftUI

/// A place in the app a navigation stack can hold.
enum Route: Hashable {
  /// A plugin screen by id, with its params.
  case screen(String, NativeParams)
  /// An area pushed on a phone (a Menu row, or a section with no tab of its own): its screen with its section chips,
  /// as a tab's root shows it (AGL-3993). An app without areas (POS) shows the screen alone.
  case area(String, NativeParams)
  /// A Besigner page in the app's authenticated web view (the only web content).
  case besigner(String)
  /// A console page the app has no native screen for yet.
  case unavailable(String)
  /// Settings, pushed from More where the tab bar has no room for its own tab.
  case settings
  /// The person's notification settings (`/manage/notifications/settings`).
  case notificationSettings
  /// The site's Analytics page.
  case analytics
  /// The notification feed, pushed from a phone's bell.
  case notifications
  /// Theme settings.
  case themeSettings
  /// A detail screen a screen pushed (`AglynPushLink`), on the path so the next push never drops it.
  case view(AglynPushedView)
  /// A plain web page (a live site, a preview, a docs or legal page) in the in-app browser screen.
  case web(AglynWebPage)
  /// Every result for what was typed in the search ("See all results for 'x'").
  case searchResults(String)
}

/// The shell's top-level sections: the sidebar on iPad and Mac, the tab bar on iPhone.
enum ShellSection: Hashable, Identifiable {
  case home
  case notifications
  case settings
  case more
  /// The site's Analytics page (a core page, not a plugin's).
  case analytics
  /// A plugin tab, or a site screen the sidebar lists, by screen id.
  case plugin(String)
  /// A screen opened with params from the sidebar (a Setup section: `site.setup` with `section=seo`).
  case place(String, NativeParams)

  var id: String {
    switch self {
    case .home: "home"
    case .notifications: "notifications"
    case .settings: "settings"
    case .more: "more"
    case .analytics: "analytics"
    case .plugin(let screen): "plugin:\(screen)"
    case .place(let screen, let params):
      "place:\(screen)?\(params.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&"))"
    }
  }

  /// The section a manifest row or section opens: Home and Overview are the shell's own, a screen with params a place.
  static func opening(_ screen: String, _ params: [String: String]?) -> ShellSection {
    switch screen {
    case "shell.home": return .home
    case "shell.analytics": return .analytics
    default: return params?.isEmpty == false ? .place(screen, params ?? [:]) : .plugin(screen)
    }
  }
}

/// What the sidebar shows: the scope's everyday list, one of the two settings modes, or the staff list.
enum ShellMode: String, Hashable {
  case main
  case workspaceSettings
  case siteSettings
  case admin
}

/// The two pickers: workspace, then site.
enum ShellPicker: String, Identifiable, Hashable {
  case workspace
  case site
  var id: String { rawValue }
}

/// One window's navigation: its selected section and each section's stack.
@MainActor
@Observable
final class ShellNavigation {
  var section: ShellSection = .home
  var paths: [ShellSection: [Route]] = [:]
  /// Asks for the site picker (the older single switcher's name, kept for every screen that offers "Choose a site").
  var showSwitcher = false
  /// The picker open in this window, nil for none.
  var picker: ShellPicker?
  /// Whether the window stands inside the picked site, or looks at the whole workspace (One scope at a time).
  var inSite: Bool {
    didSet { UserDefaults.standard.set(inSite, forKey: Self.inSiteKey) }
  }
  /// What the sidebar shows.
  var mode: ShellMode = .main
  /// The phone's account sheet.
  var showAccount = false
  /// The Add account screen.
  var showAddAccount = false
  /// The search (⌘K) open: the title bar's field focused with its dropdown, or the phone's full-screen search.
  var showOneBox = false
  /// What the search holds in this tab.
  let search = OneBoxModel()
  /// The starred shortcut the section was opened through, so the selection shows on that row rather than on its
  /// group's row too (one selection in the sidebar).
  var starKey: String?
  /// Whether this tab is the one in front of its window (always, where the shell has no tabs).
  var front = true
  /// The workspace and site this tab's screens read while another tab is in front, and until its own are back on its
  /// return (P9): the app keeps one workspace store, so without this a hidden tab's screens followed the tab in front
  /// and reloaded, losing their place.
  var frozenContext: NativePluginContext?
  /// The tab's title while it is behind another.
  var frozenTitle: String?
  /// Add workspace (create one, or accept an invitation).
  var showAddWorkspace = false
  /// The notifications popover from the bell.
  var showNotifications = false
  /// Create new as a sheet (the phone's centre tab).
  var showCreate = false
  /// The AI panel, docked on the right (a sheet on a phone).
  var showAssist = false
  /// The in-app Besigner is the screen on show. Its own Assist launcher, which reads and edits the canvas, is then the
  /// one AI there, so the title bar's ✦ steps aside (AGL-4057).
  var besignerOnScreen: Bool {
    if case .besigner? = paths[section]?.last { return true }
    return false
  }
  /// This navigation's identity, for a tab strip that keeps every tab's view alive.
  var tabID: ObjectIdentifier { ObjectIdentifier(self) }
  /// The sidebar folded away (View ▸ Hide Sidebar, ⌥⌘S), so the place in use takes the width.
  var sidebarHidden = false
  /// The workspace rail hidden (the title bar's toggle, ⌃⌘S): remembered on this device.
  var railHidden = UserDefaults.standard.bool(forKey: "aglyn.shell.railHidden") {
    didSet { UserDefaults.standard.set(railHidden, forKey: "aglyn.shell.railHidden") }
  }
  /// The keyboard shortcuts sheet.
  var showShortcuts = false
  /// Bumped when this device's own theme changes (it is not on the account, so nothing else would redraw it).
  var themeNonce = 0
  /// The workspace and site this tab stands in, so it comes back to them in front (a tab of its own on the Mac and iPad).
  var pickedOrgID: String?
  var pickedHostID: String?
  /// Opens a seed as a new tab beside this one; nil where the shell has no tabs (a phone).
  @ObservationIgnored var openTab: ((ShellSeed) -> Void)?
  /// Where the window has been, for Back and Forward beside the search field: each section opened, in order.
  private(set) var history: [ShellSection] = [.home]
  private(set) var historyIndex = 0
  @ObservationIgnored private var travelling = false
  /// A workspace waiting to be pinned while the five pins are full ("Pinned is full. Replace one?").
  var pinFull: PendingPin?
  /// The workspace whose color is being picked.
  var colorFor: ColorPickTarget?
  /// The sidebar groups the person opened, remembered on this device; a group holding the screen in use is open too.
  var openGroups: Set<String> {
    didSet { UserDefaults.standard.set(Array(openGroups), forKey: Self.openGroupsKey) }
  }

  static let inSiteKey = "aglyn.shell.inSite"
  static let openGroupsKey = "aglyn.shell.openGroups"

  init() {
    inSite = UserDefaults.standard.object(forKey: Self.inSiteKey) as? Bool ?? true
    openGroups = Set(UserDefaults.standard.stringArray(forKey: Self.openGroupsKey) ?? [])
  }
  /// An invitation a notification opened, waiting for its accept or decline.
  var pendingInvite: FeedNotification?

  func path(_ section: ShellSection) -> Binding<[Route]> {
    Binding(get: { self.paths[section] ?? [] }, set: { self.paths[section] = $0 })
  }

  func push(_ route: Route) {
    paths[section, default: []].append(route)
  }

  /// The route that opens a section as a pushed area; nil for the shell's own sections.
  static func areaRoute(_ target: ShellSection) -> Route? {
    switch target {
    case .plugin(let screen): .area(screen, [:])
    case .place(let screen, let params): .area(screen, params)
    default: nil
    }
  }

  /// Opens an area on the section on screen, pushed with its section chips (a phone's Menu row, or a section with no
  /// tab of its own), so every section of a sectioned row is one tap from the area (AGL-3993).
  func pushArea(_ target: ShellSection) {
    guard let route = Self.areaRoute(target) else { return select(target) }
    push(route)
  }

  /// A section chip on a phone: the pushed area swaps for the section chosen, so the stack never deepens; from a tab's
  /// root the section is pushed, and the tab's own section returns to its root.
  func swapArea(_ target: ShellSection) {
    guard let route = Self.areaRoute(target) else { return select(target) }
    var stack = paths[section] ?? []
    if case .area? = stack.last { stack.removeLast() }
    if target != section { stack.append(route) }
    paths[section] = stack
  }

  /// A section a phone has no tab for opens in Menu, pushed as an area: an area with its section chips, the shell's own
  /// pages as they are.
  func openInMenu(_ target: ShellSection) {
    section = .more
    switch target {
    case .settings: push(.settings)
    case .notifications: push(.notifications)
    case .analytics: push(.analytics)
    case .plugin, .place: pushArea(target)
    default: break
    }
  }

  /// Opens a plain web page in the in-app browser screen, pushed onto the section on screen: on iPhone over the tab,
  /// on iPad and the Mac in the main area beside the sidebar.
  func openWeb(_ page: AglynWebPage, _ disposition: AglynBrowserDisposition = .push) {
    switch disposition {
    case .push: push(.web(page))
    // A ⌘-click asks for a tab of its own, where the shell has tabs.
    case .newTab:
      if let openTab {
        var seed = ShellSeed(orgID: pickedOrgID, hostID: pickedHostID, inSite: inSite)
        seed.webURL = page.url
        seed.title = page.url.host ?? "Page"
        openTab(seed)
      } else {
        push(.web(page))
      }
    }
  }

  func select(_ next: ShellSection) {
    if section == next { paths[next] = [] }
    starKey = nil
    section = next
    record(next)
  }

  /// Notes a section opened, for Back and Forward: going somewhere new drops what was ahead.
  func record(_ next: ShellSection) {
    guard !travelling, history.indices.contains(historyIndex), history[historyIndex] != next else { return }
    history = Array(history.prefix(historyIndex + 1)) + [next]
    if history.count > 50 { history.removeFirst(history.count - 50) }
    historyIndex = history.count - 1
  }

  var canGoBack: Bool { historyIndex > 0 }
  var canGoForward: Bool { historyIndex < history.count - 1 }

  func goBack() { travel(to: historyIndex - 1) }
  func goForward() { travel(to: historyIndex + 1) }

  private func travel(to index: Int) {
    guard history.indices.contains(index) else { return }
    travelling = true
    historyIndex = index
    section = history[index]
    travelling = false
  }
}

/// A workspace the person asked to pin while five are pinned.
struct PendingPin: Identifiable, Equatable {
  let orgID: String
  let name: String
  var id: String { orgID }
}

/// The workspace whose color is being picked.
struct ColorPickTarget: Identifiable, Equatable {
  let orgID: String
  let name: String
  var id: String { orgID }
}

extension ShellNavigation {
  /// Opens the whole workspace: its own list, from its Home.
  func enterWorkspace() {
    inSite = false
    mode = .main
    // Every screen starts at its root in the scope just opened: a stack pushed in the other one (the workspace's search
    // results under the site's Home) is not this scope's.
    paths = [:]
    select(.home)
  }

  /// Opens the picked site: its own list, from its Home.
  func enterSite() {
    inSite = true
    mode = .main
    paths = [:]
    select(.home)
  }

  /// Opens a settings mode (or the staff list) on its first row; `back` returns to the everyday list.
  func enter(_ next: ShellMode, first: ShellSection?) {
    mode = next
    if let first { select(first) }
  }

  func leaveMode() {
    mode = .main
    select(.home)
  }
}

struct ShellNavigationKey: FocusedValueKey {
  typealias Value = ShellNavigation
}

struct ShellTabsKey: FocusedValueKey {
  typealias Value = TabStrip
}

extension FocusedValues {
  var shellNavigation: ShellNavigation? {
    get { self[ShellNavigationKey.self] }
    set { self[ShellNavigationKey.self] = newValue }
  }

  /// The window's tabs (the tab strip on the Mac and iPad), for ⌘T, ⌘W and ⌘⇧T.
  var shellTabs: TabStrip? {
    get { self[ShellTabsKey.self] }
    set { self[ShellTabsKey.self] = newValue }
  }
}
