// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost

/// Registers the ids `plugins.config.json` declares under the plugin's
/// `mobile.contributes`: each section of the console's Emails page as a
/// screen (messages and their composer, templates opening the Besigner,
/// audiences and their members, topics, sending and suppressions), quick
/// actions, and the console's Emails links.
@MainActor
public func registerEmailNative(_ r: NativePluginRegistrar) {
  for section in EmailSection.allCases {
    r.screen(section.screen, title: section == .messages ? "Emails" : section.label, requiresSite: true, icon: section.symbol) { ctx, params in
      EmailHubScreen(context: ctx, section: section, initial: params["message"] ?? params["list"] ?? params["id"])
    }
  }
  r.quickAction("email.open", title: "Emails", icon: "envelope", order: 64, screen: EmailSection.messages.screen, requiresSite: true)
  r.deepLink("email.page", path: "/emails", screen: EmailSection.messages.screen)
  for section in EmailSection.allCases {
    r.deepLink("email.\(section.rawValue)-page", path: "/emails/\(section.rawValue)", screen: section.screen)
  }
  r.deepLink("email.message-page", path: "/emails/messages/:message", screen: EmailSection.messages.screen)
  r.deepLink("email.list-page", path: "/emails/audiences/:list", screen: EmailSection.audiences.screen)
}
