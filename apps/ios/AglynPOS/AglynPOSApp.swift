// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynHardware
import AglynUI
import SwiftUI

/// "Aglyn POS": the register, on iPhone, iPad and Mac.
@main
struct AglynPOSApp: App {
  #if os(iOS)
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
  #elseif os(macOS)
    @NSApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
  #endif
  @State private var model = AppModel(app: .pos)

  init() {
    AglynFonts.register()
    // This device's card reader (Tap to Pay on iPhone, Bluetooth readers), on iPhone and iPad only:
    // the register, the readers screen and any plugin's counter payment take cards through it.
    #if os(iOS) && canImport(StripeTerminal)
      DeviceCardReaders.shared = StripeTerminalCollector.shared
    #endif
    #if DEBUG && os(macOS)
      DebugSnapshot.scheduleIfAsked()
    #endif
  }

  var body: some Scene {
    WindowGroup {
      RootView { navigation in POSShell(navigation: navigation) }
        .environment(model)
    }
    .defaultSize(width: 1180, height: 780)
    .commands {
      CommandGroup(after: .toolbar) {
        Button("Refresh") { model.refresh() }.keyboardShortcut("r", modifiers: .command)
      }
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
