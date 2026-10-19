// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The menu bar on the Mac and the keyboard shortcuts on iPad: the pinned workspaces on ⌘1–⌘5, Home, the workspace
/// and site pickers, the settings modes, and Refresh on ⌘R.
struct AglynCommands: Commands {
  let model: AppModel
  @FocusedValue(\.shellNavigation) private var navigation

  var body: some Commands {
    CommandGroup(after: .toolbar) {
      Button("Refresh") { model.refresh() }
        .keyboardShortcut("r", modifiers: .command)
      Divider()
      Button(navigation?.railHidden == true ? "Show Workspace Switcher" : "Hide Workspace Switcher") {
        withAnimation(.easeOut(duration: 0.2)) { navigation?.railHidden.toggle() }
      }
      .keyboardShortcut("s", modifiers: [.control, .command])
      .disabled(navigation == nil)
      Button(navigation?.sidebarHidden == true ? "Show Sidebar" : "Hide Sidebar") {
        withAnimation(.easeOut(duration: 0.2)) { navigation?.sidebarHidden.toggle() }
      }
      .keyboardShortcut("s", modifiers: [.option, .command])
      .disabled(navigation == nil)
    }
    CommandMenu("Go") {
      Button("Home") { navigation?.select(.home) }
        .keyboardShortcut("h", modifiers: [.command, .shift])
        .disabled(navigation == nil)
      Button("Notifications") { navigation?.select(.notifications) }
        .keyboardShortcut("n", modifiers: [.command, .shift])
        .disabled(navigation == nil)
      Divider()
      // ⌘1–⌘5 jump to the pins, in the person's order.
      ForEach(Array(pins.enumerated()), id: \.element) { index, orgID in
        Button(name(orgID)) { open(orgID) }
          .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
          .disabled(navigation == nil)
      }
      if !pins.isEmpty { Divider() }
      Button("Search or Jump To…") { navigation?.showOneBox = true }
        .keyboardShortcut("k", modifiers: .command)
        .disabled(navigation == nil)
      Button("Back") { navigation?.goBack() }
        .keyboardShortcut("[", modifiers: .command)
        .disabled(navigation?.canGoBack != true)
      Button("Forward") { navigation?.goForward() }
        .keyboardShortcut("]", modifiers: .command)
        .disabled(navigation?.canGoForward != true)
      Button("All Workspaces…") { navigation?.picker = .workspace }
        .disabled(navigation == nil)
      Button("Switch Site…") { navigation?.picker = .site }
        .keyboardShortcut("k", modifiers: [.command, .shift])
        .disabled(navigation == nil || model.workspace?.org == nil)
      Button("Whole Workspace") { navigation?.enterWorkspace() }
        .disabled(navigation == nil || navigation?.inSite == false)
      Divider()
      Button("Workspace Settings") {
        guard let navigation else { return }
        navigation.enter(.workspaceSettings, first: ShellScope(model: model, navigation: navigation).firstSection(of: .workspaceSettings))
      }
      .disabled(navigation == nil)
      Button("Site Settings") {
        guard let navigation else { return }
        navigation.enter(.siteSettings, first: ShellScope(model: model, navigation: navigation).firstSection(of: .siteSettings))
      }
      .disabled(navigation == nil || model.workspace?.site == nil || navigation?.inSite == false)
    }
  }

  private var pins: [String] { Array((model.preferences?.pinned ?? []).prefix(5)) }

  private func name(_ orgID: String) -> String { model.workspace?.orgs.first { $0.id == orgID }?.name ?? "Pinned workspace" }

  private func open(_ orgID: String) {
    model.workspace?.open(orgID: orgID)
    navigation?.enterWorkspace()
  }
}

#if os(macOS)
  /// The Mac's tab commands: New Tab (⌘T) beside the one in front, on its workspace and site; Reopen Closed Tab
  /// (⌘⇧T) and the Recently Closed list. Close Tab is the system's ⌘W, and Show All Tabs its own tab overview.
  /// The tabs in the window's tab strip: ⌘T opens one on the place in front, ⌘W closes the one in front, ⌘⇧T reopens
  /// the last closed; Recently Closed lists them.
  struct TabCommands: Commands {
    let model: AppModel
    @FocusedValue(\.shellNavigation) private var navigation
    @FocusedValue(\.shellTabs) private var tabs

    var body: some Commands {
      CommandGroup(after: .newItem) {
        Button("New Tab") {
          guard let tabs else { return }
          var seed = tabs.current.seed(model: model)
          seed.screen = nil
          seed.params = [:]
          seed.title = "Home"
          tabs.open(seed, model: model)
        }
        .keyboardShortcut("t", modifiers: .command)
        .disabled(tabs == nil)
        Button("Close Tab") {
          guard let tabs else { return }
          tabs.close(tabs.selected, model: model, closedTabs: model.closedTabs)
        }
        .keyboardShortcut("w", modifiers: .command)
        .disabled(tabs == nil || tabs?.selected == 0)
        Button("Reopen Closed Tab") {
          if let seed = model.closedTabs.reopen() { tabs?.open(seed, model: model) }
        }
        .keyboardShortcut("t", modifiers: [.command, .shift])
        .disabled(model.closedTabs.seeds.isEmpty || tabs == nil)
        Menu("Recently Closed") {
          ForEach(model.closedTabs.seeds) { seed in
            Button(seed.title) {
              model.closedTabs.take(seed)
              tabs?.open(seed, model: model)
            }
          }
        }
        .disabled(model.closedTabs.seeds.isEmpty)
      }
    }
  }
#endif
