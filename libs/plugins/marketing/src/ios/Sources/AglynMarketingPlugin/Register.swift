// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost

/// Registers the ids `plugins.config.json` declares under the plugin's
/// `mobile.contributes`: each section of the console's Marketing page
/// (overview, campaigns, conversions, overlays, A/B testing) as a screen, a
/// quick action, and the console's Marketing links, including the Inbox's
/// Campaigns section.
@MainActor
public func registerMarketingNative(_ r: NativePluginRegistrar) {
  for section in MarketingSection.allCases {
    r.screen(section.screen, title: section == .overview ? "Marketing" : section.label, requiresSite: true, icon: section.symbol) { ctx, params in
      if section == .conversions, let campaign = params["campaign"], let orgID = ctx.orgID, let hostID = ctx.hostID {
        ConversionsSection(context: ctx, actions: MarketingActions(context: ctx, orgID: orgID, hostID: hostID), campaignID: campaign)
          .navigationTitle("Conversions")
      } else {
        MarketingHubScreen(context: ctx, section: section, initial: params["campaign"] ?? params["id"])
      }
    }
  }
  r.quickAction("marketing.open", title: "Marketing", icon: "megaphone", order: 66, screen: MarketingSection.overview.screen, requiresSite: true)
  r.deepLink("marketing.page", path: "/marketing", screen: MarketingSection.overview.screen)
  for section in MarketingSection.allCases {
    r.deepLink("marketing.\(section.rawValue)-page", path: "/marketing/\(section.rawValue)", screen: section.screen)
  }
  r.deepLink("marketing.campaign-page", path: "/marketing/campaigns/:campaign", screen: MarketingSection.campaigns.screen)
  r.deepLink("marketing.inbox-campaigns-page", path: "/inbox/campaigns", screen: MarketingSection.campaigns.screen)
}
