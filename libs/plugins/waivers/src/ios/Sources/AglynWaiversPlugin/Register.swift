// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import AglynScreens
import Foundation

/// The Waivers plugin's native registration: a rider's waiver in commerce's check-in zone, as the console registers
/// `waivers-check-in-status`. The id is the one plugins.config.json declares under `waivers.mobile.contributes`.
@MainActor
public func registerWaiversNative(_ registrar: NativePluginRegistrar) {
  // The Waivers page: spec screens drawn by AglynScreens (Resources/waivers.screens.json).
  SpecScreens.register(ScreenCatalog.load(from: .module), into: registrar)
  // Both apps: the register runs in Aglyn POS as well as in Aglyn.
  registrar.widget(waiversCheckInWidget, title: "Waiver", order: 10, apps: [.aglyn, .pos], slot: waiversCheckInSlot) { context in
    WaiverCheckInStatusView(context: context)
  }
}
