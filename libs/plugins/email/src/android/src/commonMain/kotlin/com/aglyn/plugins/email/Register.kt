package com.aglyn.plugins.email

import com.aglyn.pluginhost.NativePluginRegistrar

/**
 * The Email plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. Each section of the
 * console's Emails page is a screen (messages and their composer, templates
 * opening the Besigner, audiences and their members, topics, sending and
 * suppressions); a quick action opens Emails, and the console's Emails links
 * open the same screens.
 */
fun registerEmailNative(r: NativePluginRegistrar) {
  for (section in EmailSection.entries) {
    r.screen(section.screen, title = if (section == EmailSection.MESSAGES) "Emails" else section.label, requiresSite = true, icon = section.icon) { context, params ->
      EmailHubScreen(context, section, params["message"] ?: params["list"] ?: params["id"])
    }
  }
  r.quickAction("email.open", "Emails", "mail", 64, requiresSite = true, screen = EmailSection.MESSAGES.screen)
  r.deepLink("email.page", path = "/emails", screen = EmailSection.MESSAGES.screen)
  for (section in EmailSection.entries) r.deepLink("email.${section.key}-page", path = "/emails/${section.key}", screen = section.screen)
  r.deepLink("email.message-page", path = "/emails/messages/:message", screen = EmailSection.MESSAGES.screen)
  r.deepLink("email.list-page", path = "/emails/audiences/:list", screen = EmailSection.AUDIENCES.screen)
}
