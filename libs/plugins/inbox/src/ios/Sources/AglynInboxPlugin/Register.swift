// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import SwiftUI

public let inboxSubmissionsScreen = "inbox.submissions"
public let inboxPeopleScreen = "inbox.people"
public let inboxSubmissionScreen = "inbox.submission"

/// The Inbox plugin's native registration: the same ids its
/// `mobile.contributes` declares in plugins.config.json (the Kotlin registrar
/// names the same ones). A site's form submissions, or one form's (the
/// `formId` param, which the Forms screens open), the opened one beside the
/// list on wide windows; one message (`submission` param, or a console
/// submission link); the site's members and leads; a Home card of unread
/// messages; and the console's Inbox links opening the same screens.
@MainActor
public func registerInboxNative(_ r: NativePluginRegistrar) {
  r.screen(inboxSubmissionsScreen, title: "Submissions", requiresSite: true, icon: InboxSymbols.inbox) {
    context, params in
    SubmissionsScreen(
      context: context, formID: params["formId"] ?? params["form"], formName: params["formName"],
      initialSubmissionID: params["submission"] ?? params["submissionId"])
  }
  r.screen(inboxSubmissionScreen, title: "Submission", requiresSite: true, icon: InboxSymbols.inbox) {
    context, params in
    SubmissionsScreen(
      context: context, formID: params["formId"] ?? params["form"], formName: params["formName"],
      initialSubmissionID: params["submission"] ?? params["submissionId"] ?? params["id"])
  }
  r.screen(inboxPeopleScreen, title: "Members & leads", requiresSite: true, icon: "person.2") { ctx, _ in
    PeopleScreen(context: ctx)
  }
  r.widget("inbox.glance", title: "Inbox", icon: "tray", order: 60, size: .half, requiresSite: true) {
    InboxGlanceWidget(context: $0)
  }
  r.quickAction("inbox.open", title: "Inbox", icon: "tray", order: 60, screen: inboxSubmissionsScreen, requiresSite: true)
  r.quickAction("inbox.people", title: "Members & leads", icon: "person.2", order: 62, screen: inboxPeopleScreen, requiresSite: true)
  r.deepLink("inbox.page", path: "/inbox", screen: inboxSubmissionsScreen)
  r.deepLink("inbox.submissions-page", path: "/inbox/submissions", screen: inboxSubmissionsScreen)
  r.deepLink("inbox.people-page", path: "/inbox/contacts", screen: inboxPeopleScreen)
}

enum InboxSymbols {
  static let inbox = "tray.full"
  static let unread = "envelope.badge"
  static let read = "envelope.open"
  static let reply = "arrowshape.turn.up.left"
}
