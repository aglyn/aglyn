// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynUI
import SwiftUI

/// "Aglyn": manages the workspace on iPhone, iPad and Mac.
@main
struct AglynApp: App {
  @State private var model = AppModel(app: .aglyn)

  init() {
    AglynFonts.register()
    #if DEBUG && os(macOS)
      DebugSnapshot.scheduleIfAsked()
    #endif
  }

  var body: some Scene {
    WindowGroup {
      RootView { navigation in MainShell(navigation: navigation) }
        .environment(model)
    }
    .defaultSize(width: 1180, height: 780)
    .commands { AglynCommands(model: model) }

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
