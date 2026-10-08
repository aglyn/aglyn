package com.aglyn.plugins.inbox

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.ScreenLayout
import com.aglyn.pluginhost.WidgetSize

/**
 * The Inbox plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json.
 *
 * The site's form submissions (search, Unread / Read and form picks, the
 * message beside the list on wide windows; read, unread, delete, reply and
 * add to a marketing list) and its members and leads; the Home card of
 * unread messages and the quick action that opens the Inbox. A link to the
 * console's Inbox, or a submission notification, opens the same screens.
 */
fun registerInboxNative(r: NativePluginRegistrar) {
  r.screen(INBOX_SCREEN, title = "Inbox", requiresSite = true, icon = "inbox", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    SubmissionsScreen(
      context,
      initialSubmission = params["submission"] ?: params["submissionId"],
      scopedForm = params["formId"] ?: params["form"],
    )
  }
  r.screen(INBOX_SUBMISSION_SCREEN, title = "Message", requiresSite = true, icon = "drafts") { context, params ->
    SubmissionScreen(context, params["submission"] ?: params["submissionId"] ?: params["id"])
  }
  r.screen(INBOX_PEOPLE_SCREEN, title = "Members & leads", requiresSite = true, icon = "group") { context, _ -> PeopleScreen(context) }
  r.widget("inbox.glance", title = "Inbox", order = 60, size = WidgetSize.HALF, requiresSite = true) { context -> InboxGlanceWidget(context) }
  r.quickAction("inbox.open", "Inbox", "inbox", 60, requiresSite = true, screen = INBOX_SCREEN)
  r.quickAction("inbox.people", "Members & leads", "group", 62, requiresSite = true, screen = INBOX_PEOPLE_SCREEN)
  r.deepLink("inbox.page", path = "/inbox", screen = INBOX_SCREEN)
  r.deepLink("inbox.submissions-page", path = "/inbox/submissions", screen = INBOX_SCREEN)
  r.deepLink("inbox.people-page", path = "/inbox/contacts", screen = INBOX_PEOPLE_SCREEN)
}
