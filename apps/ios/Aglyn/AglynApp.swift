// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynUI
import SwiftUI

/// "Aglyn": manages the workspace on iPhone, iPad and Mac.
@main
struct AglynApp: App {
  #if os(iOS)
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
  #elseif os(macOS)
    @NSApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
  #endif
  @State private var model = AppModel(app: .aglyn)

  init() {
    AglynFonts.register()
    #if os(macOS)
      // The main windows are tabs of one group: ⌘T opens one, the system's tab overview lists them.
      PushAppDelegate.windowTabs = true
    #endif
    #if DEBUG && os(macOS)
      DebugSnapshot.scheduleIfAsked()
    #endif
  }

  var body: some Scene {
    // Each window (a tab on the Mac) opens on its own seed: its workspace, site and place.
    WindowGroup(id: "main", for: ShellSeed.self) { $seed in
      RootView { navigation in MainShell(navigation: navigation, seed: seed) }
        .environment(model)
    }
    .defaultSize(width: 1180, height: 780)
    .commands {
      AglynCommands(model: model)
      #if os(macOS)
        TabCommands(model: model)
      #endif
      HelpCommands(model: model)
    }

    #if os(macOS)
      Settings {
        NavigationStack { SettingsView() }
          .frame(width: 460, height: 420)
          .environment(model)
          .tint(AglynColorTint.value)
      }
    #endif
  }
}
