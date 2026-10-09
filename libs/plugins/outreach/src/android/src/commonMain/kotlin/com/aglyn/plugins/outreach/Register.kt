package com.aglyn.plugins.outreach

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.WidgetSize

/**
 * The Outreach plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. Sequences (internal
 * only), Mailboxes and Compliance, a Home card that draws itself only where
 * the console shows the Outreach tab, and the console's Outreach links.
 * There is no quick action: an always-on tile would show Sequences where the
 * console does not.
 */
fun registerOutreachNative(r: NativePluginRegistrar) {
  for (section in OutreachSection.entries) {
    r.screen(section.screen, title = section.label, requiresSite = false, icon = section.icon) { context, params ->
      OutreachHubScreen(context, section, params["sequence"] ?: params["id"])
    }
  }
  r.widget("outreach.glance", title = "Sequences", order = 76, size = WidgetSize.HALF) { context -> OutreachGlanceWidget(context) }
  r.deepLink("outreach.page", path = "/outreach", screen = OUTREACH_SEQUENCES_SCREEN)
  for (section in OutreachSection.entries) r.deepLink("outreach.${section.key}-page", path = "/outreach/${section.key}", screen = section.screen)
  r.deepLink("outreach.sequence-page", path = "/outreach/sequences/:sequence", screen = OUTREACH_SEQUENCES_SCREEN)
}
