// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import SwiftUI

public let inboxSubmissionsScreen = "inbox.submissions"
public let inboxSubmissionScreen = "inbox.submission"

/// The Inbox plugin's native registration: the same ids its
/// `mobile.contributes` declares in plugins.config.json (the Kotlin registrar
/// names the same ones). A site's form submissions, or one form's (the
/// `formId` param, which the Forms screens open), the opened one beside the
/// list on wide windows; the console's submissions page and a submission
/// link (`?submission=`) open natively.
@MainActor
public func registerInboxNative(_ r: NativePluginRegistrar) {
  r.screen(inboxSubmissionsScreen, title: "Submissions", requiresSite: true, icon: InboxSymbols.inbox) {
    context, params in
    SubmissionsScreen(
      context: context, formID: params["formId"], formName: params["formName"],
      initialSubmissionID: params["submission"])
  }
  r.screen(inboxSubmissionScreen, title: "Submission", requiresSite: true, icon: InboxSymbols.inbox) {
    context, params in
    SubmissionsScreen(
      context: context, formID: params["formId"], formName: params["formName"],
      initialSubmissionID: params["submission"] ?? params["submissionId"])
  }
  r.deepLink("inbox.submissions-page", path: "/inbox/submissions", screen: inboxSubmissionsScreen)
}

enum InboxSymbols {
  static let inbox = "tray.full"
  static let unread = "envelope.badge"
  static let read = "envelope.open"
  static let reply = "arrowshape.turn.up.left"
}
