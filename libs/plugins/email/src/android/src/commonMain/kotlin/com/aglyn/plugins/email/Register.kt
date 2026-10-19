package com.aglyn.plugins.email

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.screens.ScreenSpec
import com.aglyn.screens.SpecScreens

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
    r.screen(section.screen, title = if (section == EmailSection.MESSAGES) "Emails" else section.label, requiresSite = false, icon = section.icon) { context, params ->
      EmailHubScreen(context, section, params["message"] ?: params["list"] ?: params["id"], params["campaign"], composeNew = params["new"] == "1")
    }
  }
  r.quickAction("email.open", "Emails", "mail", 64, requiresSite = true, screen = EmailSection.MESSAGES.screen)
  r.deepLink("email.page", path = "/emails", screen = EmailSection.MESSAGES.screen)
  for (section in EmailSection.entries) r.deepLink("email.${section.key}-page", path = "/emails/${section.key}", screen = section.screen)
  r.deepLink("email.message-page", path = "/emails/messages/:message", screen = EmailSection.MESSAGES.screen)
  r.deepLink("email.list-page", path = "/emails/audiences/:list", screen = EmailSection.AUDIENCES.screen)
  // The import wizard's steps for a list's members: whether the file may change contacts already held, and the statement of permission.
  SpecScreens.register(EmailScreenJson.files.flatMap { ScreenSpec.parseFile(it) }, r)
}
