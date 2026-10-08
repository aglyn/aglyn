// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost

public let inboxScreen = "inbox.submissions"
public let inboxPeopleScreen = "inbox.people"

/// Registers the ids `plugins.config.json` declares under the plugin's
/// `mobile.contributes`: the site's form submissions (read, unread, delete,
/// reply, add to a marketing list; beside the picked message on iPad and
/// Mac), its members and leads, a Home card of unread messages, quick
/// actions, and the console's Inbox links opening the same screens.
@MainActor
public func registerInboxNative(_ r: NativePluginRegistrar) {
  r.screen(inboxScreen, title: "Inbox", requiresSite: true, icon: "tray") { ctx, params in
    SubmissionsScreen(context: ctx, initialSubmission: params["submission"] ?? params["submissionId"])
  }
  r.screen(inboxPeopleScreen, title: "Members & leads", requiresSite: true, icon: "person.2") { ctx, _ in
    PeopleScreen(context: ctx)
  }
  r.widget("inbox.glance", title: "Inbox", icon: "tray", order: 60, size: .half, requiresSite: true) {
    InboxGlanceWidget(context: $0)
  }
  r.quickAction("inbox.open", title: "Inbox", icon: "tray", order: 60, screen: inboxScreen, requiresSite: true)
  r.quickAction("inbox.people", title: "Members & leads", icon: "person.2", order: 62, screen: inboxPeopleScreen, requiresSite: true)
  r.deepLink("inbox.page", path: "/inbox", screen: inboxScreen)
  r.deepLink("inbox.submissions-page", path: "/inbox/submissions", screen: inboxScreen)
  r.deepLink("inbox.people-page", path: "/inbox/contacts", screen: inboxPeopleScreen)
}
