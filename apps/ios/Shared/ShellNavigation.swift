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
  /// A settings mode's list on a phone (Site settings, Workspace settings from Home's tiles, AGL-4006): the list of the
  /// mode the navigation is in.
  case modeList
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

/// One place in a window's history (AGL-3996): the section, with the sidebar's mode and scope it was opened in, so Back
/// and Forward put back the list and the scope as well as the screen.
struct ShellPlace: Equatable {
  var section: ShellSection
  var mode: ShellMode
  var inSite: Bool
  /// The site the place was opened in; nil for the whole workspace, or while the site is not known yet.
  var hostID: String?
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
  var section: ShellSection = .home { didSet { reportScreen() } }
  var paths: [ShellSection: [Route]] = [:] {
    didSet {
      reportScreen()
      leaveTheStarredPlace()
    }
  }
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
  /// group's row too (one selection in the sidebar). It holds while the place is on screen: going back over it (Back to
  /// Orders from a starred order) selects the area's own row again, as the console's sidebar does.
  var starKey: String? { didSet { starPath = starKey == nil ? nil : paths[section] ?? [] } }
  /// The section's path when the starred place was opened, to tell when it is left.
  @ObservationIgnored private var starPath: [Route]?
  /// Whether this tab is the one in front of its window (always, where the shell has no tabs).
  var front = true { didSet { reportScreen() } }
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
  /// The phone's area switcher: every area as the same tiles, from an area's title ▾ (AGL-4006).
  var showAreaSwitcher = false
  /// The phone's Tab bar sheet: the person's pinned areas, to remove, reorder and add (AGL-4006).
  var showTabBar = false
  /// This navigation's identity, for a tab strip that keeps every tab's view alive.
  var tabID: ObjectIdentifier { ObjectIdentifier(self) }
  /// The sidebar folded away (View ▸ Hide Sidebar, ⌥⌘S), so the place in use takes the width.
  var sidebarHidden = false
  /// The workspace rail hidden (the title bar's toggle, ⌃⌘S): remembered on this device.
  var railHidden = UserDefaults.standard.bool(forKey: "aglyn.shell.railHidden") {
    // Not while the Besigner's focus mode has it folded (AGL-4056): the next launch keeps the person's own choice.
    didSet { if !besignerFocus.active { UserDefaults.standard.set(railHidden, forKey: "aglyn.shell.railHidden") } }
  }
  /// The in-app Besigner's focus mode (AGL-4056): the rail and sidebar as they were before it opened.
  var besignerFocus = BesignerFocus()
  /// Presses the in-app Besigner's own back control (AGL-4056), set while the Besigner is on screen.
  @ObservationIgnored var besignerBack: (() -> Void)?
  /// The keyboard shortcuts sheet.
  var showShortcuts = false
  /// Bumped when this device's own theme changes (it is not on the account, so nothing else would redraw it).
  var themeNonce = 0
  /// The workspace and site this tab stands in, so it comes back to them in front (a tab of its own on the Mac and iPad).
  var pickedOrgID: String?
  var pickedHostID: String?
  /// Opens a seed as a new tab beside this one; nil where the shell has no tabs (a phone).
  @ObservationIgnored var openTab: ((ShellSeed) -> Void)?
  /// The tab in front of this window, where a link from outside (a universal link, `aglyn://`, a tapped push) opens:
  /// the window's first tab answers the link, so without it the link opened on that tab while another was in front.
  @ObservationIgnored var tabInFront: (() -> ShellNavigation?)?
  /// Where this window opens a link: the tab in front, else this navigation.
  var linkTarget: ShellNavigation { tabInFront?() ?? self }
  /// Whether a phone's shell draws this navigation (the tab bar and Home's tiles): a place opened from a link, a starred
  /// or a recent item then opens its area as a Home tile does (AGL-4059). Set by the shell that draws it.
  @ObservationIgnored var compact = false
  /// On a phone, the tab bar's section for an area row, when the tab bar holds it.
  @ObservationIgnored var tabSection: ((String) -> ShellSection?)?
  /// Where the window has been, for Back and Forward beside the search field: each section opened, in order.
  /// Each place holds the sidebar's mode and scope too (`ShellPlace`).
  private(set) var history = NavHistory(ShellPlace(section: .home, mode: .main, inSite: true))
  @ObservationIgnored private var travelling = false
  /// The site in this window's scope, as the shell in front reads it from the workspace store: a scope switch picks it
  /// just after the place it opens is recorded, so the place on screen takes it.
  @ObservationIgnored var siteInScope: String? {
    didSet {
      guard siteInScope != oldValue, inSite else { return }
      var place = history.current
      place.hostID = siteInScope
      history.replaceCurrent(place)
    }
  }
  /// Picks a site again for Back or Forward; false when the workspace no longer has it.
  @ObservationIgnored var openSite: ((String) -> Bool)?
  /// A workspace waiting to be pinned while the five pins are full ("Pinned is full. Replace one?").
  var pinFull: PendingPin?
  /// The workspace whose color is being picked.
  var colorFor: ColorPickTarget?
  /// The sidebar groups as the person left them, open or folded, remembered on this device (AGL-3996): opening a place
  /// opens only its own group, and only when it is folded.
  var groups: AglynSidebarGroups {
    didSet { UserDefaults.standard.set(groups.stored, forKey: Self.openGroupsKey) }
  }

  static let inSiteKey = "aglyn.shell.inSite"
  static let openGroupsKey = "aglyn.shell.openGroups"

  init() {
    inSite = UserDefaults.standard.object(forKey: Self.inSiteKey) as? Bool ?? true
    groups = AglynSidebarGroups(stored: UserDefaults.standard.stringArray(forKey: Self.openGroupsKey) ?? [])
    history = NavHistory(ShellPlace(section: .home, mode: .main, inSite: inSite))
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

  /// A section a phone has no tab for opens on the Home tab, pushed (AGL-4006: the phone has no Menu tab): an area
  /// with its section chips, the shell's own pages as they are. Home's stack is kept, so Back returns where it was.
  func openOnHome(_ target: ShellSection) {
    section = .home
    switch target {
    case .home: paths[.home] = []
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

  /// Drops the starred row's selection once the section's path no longer reaches the starred place (Back over it); a
  /// screen pushed on top of it keeps it.
  private func leaveTheStarredPlace() {
    guard starKey != nil, let starPath else { return }
    let now = paths[section] ?? []
    if now.count < starPath.count || Array(now.prefix(starPath.count)) != starPath { starKey = nil }
  }

  func select(_ next: ShellSection) {
    if section == next { paths[next] = [] }
    starKey = nil
    section = next
    record(next)
  }

  /// Notes a section opened, for Back and Forward, in the mode and scope the window is in: going somewhere new drops
  /// what was ahead.
  func record(_ next: ShellSection) {
    guard !travelling else { return }
    history.record(place(next))
  }

  /// A section as a place in the mode and scope the window is in now.
  private func place(_ section: ShellSection) -> ShellPlace {
    ShellPlace(section: section, mode: mode, inSite: inSite, hostID: inSite ? siteInScope : nil)
  }

  var canGoBack: Bool { history.canGoBack }
  var canGoForward: Bool { history.canGoForward }

  func goBack() { travel(history.back()) }
  func goForward() { travel(history.forward()) }

  /// Puts a place back whole: its scope (the whole workspace, or its site), the sidebar's mode, then its section.
  private func travel(_ place: ShellPlace?) {
    guard let place else { return }
    travelling = true
    defer { travelling = false }
    var site = siteInScope
    if let hostID = place.hostID, hostID != site, openSite?(hostID) == true { site = hostID }
    // A stack pushed in the other scope is not this one's, as entering a scope starts every screen at its root.
    if place.inSite != inSite || site != siteInScope { paths = [:] }
    inSite = place.inSite
    siteInScope = site
    mode = place.mode
    section = place.section
    // The place as it stands now (a site it was opened in before the site was known), so the section's own record of
    // it is not a new place that drops what is ahead.
    history.replaceCurrent(self.place(place.section))
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

// MARK: Telemetry (AGL-4067)

extension Route {
  /// The screen's KEY for Analytics and crash reports ("site.pages", "besigner"): never a site, page or person name,
  /// never a URL or a search.
  var telemetryKey: String {
    switch self {
    case .screen(let id, _), .area(let id, _): id
    case .besigner: "besigner"
    case .unavailable: "unavailable"
    case .settings: "settings"
    case .notificationSettings: "notification_settings"
    case .analytics: "analytics"
    case .notifications: "notifications"
    case .themeSettings: "theme_settings"
    case .view: "detail"
    case .web: "web"
    case .searchResults: "search_results"
    case .modeList: "settings_list"
    }
  }
}

extension ShellSection {
  /// The section's KEY, as `Route.telemetryKey` names a pushed screen.
  var telemetryKey: String {
    switch self {
    case .home: "home"
    case .notifications: "notifications"
    case .settings: "settings"
    case .more: "more"
    case .analytics: "analytics"
    case .plugin(let screen), .place(let screen, _): screen
    }
  }
}

extension ShellNavigation {
  /// What this tab shows, by key: the top of the section's stack, else the section.
  var screenKey: String { paths[section]?.last?.telemetryKey ?? section.telemetryKey }

  /// Tells Telemetry the screen on show when this tab is the one in front (it ignores a repeat).
  func reportScreen() {
    if front { Telemetry.screen(screenKey) }
  }
}
