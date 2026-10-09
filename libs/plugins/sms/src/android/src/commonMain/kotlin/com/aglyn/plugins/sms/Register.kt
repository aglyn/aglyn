package com.aglyn.plugins.sms

import com.aglyn.pluginhost.NativePluginRegistrar

const val SMS_TEXTS_SCREEN = "sms.texts"

/**
 * The SMS plugin's native registration: the same ids its `mobile.contributes`
 * declares in plugins.config.json. The plugin is infrastructure (core's
 * `core.messaging.sms` contract, behind Twilio), so the console has no page
 * for it; what a person controls is the "Also send as texts" switch on the
 * Commerce settings' Customer notifications card. The app gives that switch a
 * screen of its own, and a quick action to reach it.
 */
fun registerSmsNative(r: NativePluginRegistrar) {
  r.screen(SMS_TEXTS_SCREEN, title = "Customer texts", requiresSite = true, icon = "sms") { context, _ ->
    CustomerTextsScreen(context)
  }
  r.quickAction("sms.open", title = "Customer texts", icon = "sms", order = 910, requiresSite = true, screen = SMS_TEXTS_SCREEN)
}
