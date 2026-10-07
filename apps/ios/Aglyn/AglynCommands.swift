// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The menu bar on the Mac and the keyboard shortcuts on iPad: sections on
/// ⌘1…, Refresh on ⌘R, and the workspace and site switcher on ⌘K.
struct AglynCommands: Commands {
  let model: AppModel
  @FocusedValue(\.shellNavigation) private var navigation

  var body: some Commands {
    CommandGroup(after: .toolbar) {
      Button("Refresh") { model.refresh() }
        .keyboardShortcut("r", modifiers: .command)
    }
    CommandMenu("Go") {
      Button("Home") { navigation?.select(.home) }
        .keyboardShortcut("1", modifiers: .command)
      Button("Notifications") { navigation?.select(.notifications) }
        .keyboardShortcut("2", modifiers: .command)
      ForEach(Array(sidebarScreens.enumerated()), id: \.element.id) { index, screen in
        if index < 6 {
          Button(screen.title) { navigation?.select(.plugin(screen.screen)) }
            .keyboardShortcut(KeyEquivalent(Character("\(index + 3)")), modifiers: .command)
        } else {
          Button(screen.title) { navigation?.select(.plugin(screen.screen)) }
        }
      }
      Divider()
      Button("Switch Workspace or Site…") { navigation?.showSwitcher = true }
        .keyboardShortcut("k", modifiers: .command)
        .disabled(navigation == nil)
    }
  }

  private var sidebarScreens: [SidebarScreen] { SidebarScreen.all(model) }
}
