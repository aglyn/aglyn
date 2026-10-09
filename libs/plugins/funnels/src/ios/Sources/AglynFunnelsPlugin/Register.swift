// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost

/// The Funnels plugin's native screen id.
public let funnelsListScreen = "funnels.list"

/// Registers the ids `plugins.config.json` declares under the plugin's
/// `mobile.contributes`. The console shows Funnels as a card on the Analytics
/// page; the app gives it a screen of its own (the funnel beside its results
/// on iPad and Mac), a quick action, and the link that opens it.
@MainActor
public func registerFunnelsNative(_ r: NativePluginRegistrar) {
  r.screen(funnelsListScreen, title: "Funnels", requiresSite: true, icon: FunnelsSymbols.funnel) { ctx, _ in
    FunnelsScreen(context: ctx)
  }
  r.quickAction(
    "funnels.open", title: "Funnels", icon: FunnelsSymbols.funnel, order: 905, screen: funnelsListScreen,
    requiresSite: true)
  r.deepLink("funnels.page", path: "/funnels", screen: funnelsListScreen)
}

enum FunnelsSymbols {
  static let funnel = "line.3.horizontal.decrease.circle"
  static let ai = "sparkles"
}
