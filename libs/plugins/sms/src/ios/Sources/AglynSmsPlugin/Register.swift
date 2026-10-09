// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost

/// The SMS plugin's native screen id.
public let smsTextsScreen = "sms.texts"

/// Registers the ids `plugins.config.json` declares under the plugin's
/// `mobile.contributes`. The plugin is infrastructure (core's
/// `core.messaging.sms` contract, behind Twilio), so the console has no page
/// for it; what a person controls is the "Also send as texts" switch on the
/// Commerce settings' Customer notifications card. The app gives that switch
/// a screen of its own, and a quick action to reach it.
@MainActor
public func registerSmsNative(_ r: NativePluginRegistrar) {
  r.screen(smsTextsScreen, title: "Customer texts", requiresSite: true, icon: "message") { ctx, _ in
    CustomerTextsScreen(context: ctx)
  }
  r.quickAction(
    "sms.open", title: "Customer texts", icon: "message", order: 910, screen: smsTextsScreen, requiresSite: true)
}
