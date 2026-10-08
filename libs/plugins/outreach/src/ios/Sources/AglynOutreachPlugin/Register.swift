// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost

/// Registers the ids `plugins.config.json` declares under the plugin's
/// `mobile.contributes`: Sequences (internal only), Mailboxes and
/// Compliance, a Home card that shows itself only where the console shows
/// the Outreach tab, and the console's Outreach links. There is no quick
/// action: an always-on tile would show Sequences where the console does not.
@MainActor
public func registerOutreachNative(_ r: NativePluginRegistrar) {
  for section in OutreachSection.allCases {
    r.screen(section.screen, title: section.label, requiresSite: false, icon: section.symbol) { ctx, params in
      OutreachHubScreen(context: ctx, section: section, initial: params["sequence"] ?? params["id"])
    }
  }
  r.widget("outreach.glance", title: "Sequences", icon: "arrow.triangle.branch", order: 76, size: .half) { OutreachGlanceWidget(context: $0) }
  r.deepLink("outreach.page", path: "/outreach", screen: outreachSequencesScreen)
  for section in OutreachSection.allCases {
    r.deepLink("outreach.\(section.rawValue)-page", path: "/outreach/\(section.rawValue)", screen: section.screen)
  }
  r.deepLink("outreach.sequence-page", path: "/outreach/sequences/:sequence", screen: outreachSequencesScreen)
}
