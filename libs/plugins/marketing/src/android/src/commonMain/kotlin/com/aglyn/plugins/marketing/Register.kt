package com.aglyn.plugins.marketing

import com.aglyn.pluginhost.NativePluginRegistrar

/**
 * The Marketing plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. Each section of the
 * console's Marketing page (overview, campaigns, conversions, overlays, A/B
 * testing) is a screen; a quick action opens Marketing, and the console's
 * Marketing links (and the Inbox's Campaigns section) open the same screens.
 */
fun registerMarketingNative(r: NativePluginRegistrar) {
  for (section in MarketingSection.entries) {
    r.screen(section.screen, title = if (section == MarketingSection.OVERVIEW) "Marketing" else section.label, requiresSite = true, icon = section.icon) { context, params ->
      val campaign = params["campaign"]
      val orgId = context.orgId
      val hostId = context.hostId
      if (section == MarketingSection.CONVERSIONS && campaign != null && orgId != null && hostId != null) {
        ConversionsSection(context, MarketingActions(context, orgId, hostId), campaign)
      } else {
        MarketingHubScreen(context, section, campaign ?: params["id"])
      }
    }
  }
  r.quickAction("marketing.open", "Marketing", "campaign", 66, requiresSite = true, screen = MarketingSection.OVERVIEW.screen)
  r.deepLink("marketing.page", path = "/marketing", screen = MarketingSection.OVERVIEW.screen)
  for (section in MarketingSection.entries) r.deepLink("marketing.${section.key}-page", path = "/marketing/${section.key}", screen = section.screen)
  r.deepLink("marketing.campaign-page", path = "/marketing/campaigns/:campaign", screen = MarketingSection.CAMPAIGNS.screen)
  r.deepLink("marketing.inbox-campaigns-page", path = "/inbox/campaigns", screen = MarketingSection.CAMPAIGNS.screen)
}
