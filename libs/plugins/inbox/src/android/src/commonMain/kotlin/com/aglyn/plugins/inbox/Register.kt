package com.aglyn.plugins.inbox

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.ScreenLayout

/**
 * The Inbox plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. A site's form
 * submissions, or one form's (the `formId` param, which the Forms screens
 * open), the opened one beside the list on wide windows; the console's
 * submissions pages and a submission link (`?submission=`) open natively.
 */
fun registerInboxNative(r: NativePluginRegistrar) {
  r.screen(INBOX_SUBMISSIONS_SCREEN, title = "Submissions", requiresSite = true, icon = "inbox", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    SubmissionsScreen(context, params["formId"], params["formName"], params["submission"])
  }
  r.screen(INBOX_SUBMISSION_SCREEN, title = "Submission", requiresSite = true, icon = "inbox", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    SubmissionsScreen(context, params["formId"], params["formName"], params["submission"] ?: params["submissionId"])
  }
  r.deepLink("inbox.submissions-page", path = "/inbox/submissions", screen = INBOX_SUBMISSIONS_SCREEN)
}
