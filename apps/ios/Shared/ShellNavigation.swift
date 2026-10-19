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

  var id: String {
    switch self {
    case .home: "home"
    case .notifications: "notifications"
    case .settings: "settings"
    case .more: "more"
    case .analytics: "analytics"
    case .plugin(let screen): "plugin:\(screen)"
    }
  }
}

/// One window's navigation: its selected section and each section's stack.
@MainActor
@Observable
final class ShellNavigation {
  var section: ShellSection = .home
  var paths: [ShellSection: [Route]] = [:]
  var showSwitcher = false
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

struct ShellNavigationKey: FocusedValueKey {
  typealias Value = ShellNavigation
}

extension FocusedValues {
  var shellNavigation: ShellNavigation? {
    get { self[ShellNavigationKey.self] }
    set { self[ShellNavigationKey.self] = newValue }
  }
}
