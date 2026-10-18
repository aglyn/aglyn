// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Observation
import SwiftUI

/// A place in the app a navigation stack can hold.
enum Route: Hashable {
  /// A plugin screen by id, with its params.
  case screen(String, NativeParams)
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
  /// A plain web page (a live site, a preview, a docs or legal page) in the in-app browser screen.
  case web(AglynWebPage)
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

  /// Opens a plain web page in the in-app browser screen, pushed onto the section on screen: on iPhone over the tab,
  /// on iPad and the Mac in the main area beside the sidebar.
  func openWeb(_ page: AglynWebPage, _ disposition: AglynBrowserDisposition = .push) {
    switch disposition {
    // A ⌘-click asks for a tab of its own; until the shell has tabs it opens like any other click.
    case .push, .newTab: push(.web(page))
    }
  }

  func select(_ next: ShellSection) {
    if section == next { paths[next] = [] }
    section = next
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
    select(.home)
  }

  /// Opens the picked site: its own list, from its Home.
  func enterSite() {
    inSite = true
    mode = .main
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

extension FocusedValues {
  var shellNavigation: ShellNavigation? {
    get { self[ShellNavigationKey.self] }
    set { self[ShellNavigationKey.self] = newValue }
  }
}
