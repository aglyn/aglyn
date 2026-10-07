// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost

/// The Redirects plugin's native screen id.
public let redirectsListScreen = "redirects.list"

/// Registers the ids `plugins.config.json` declares under the plugin's
/// `mobile.contributes`: the site's rules as a native list (beside the
/// picked rule on iPad and Mac), a dashboard count, a quick action, and the
/// console's Redirects page opening natively from a link or a notification.
@MainActor
public func registerRedirectsNative(_ r: NativePluginRegistrar) {
  r.screen(redirectsListScreen, title: "Redirects", requiresSite: true, icon: RedirectsSymbols.rule) { ctx, _ in
    RedirectsListScreen(context: ctx)
  }
  r.widget("redirects.summary", title: "Redirects", icon: RedirectsSymbols.rule, order: 900, size: .half, requiresSite: true) {
    RedirectsSummaryWidget(context: $0)
  }
  r.quickAction(
    "redirects.open", title: "Redirects", icon: RedirectsSymbols.rule, order: 900, screen: redirectsListScreen,
    requiresSite: true)
  r.deepLink("redirects.page", path: "/redirects", screen: redirectsListScreen)
}

enum RedirectsSymbols {
  static let rule = "arrow.triangle.turn.up.right.diamond"
  static let paused = "pause.circle"
}
