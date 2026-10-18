package com.aglyn.plugins.email

import com.aglyn.core.FirestoreDoc
import kotlin.test.Test
import kotlin.test.assertEquals

/** An email's state and a suppression's reason read as words, the same on the list and the detail. */
class EmailWordsTest {
  private fun send(data: Map<String, Any?>) = emailSendOf(FirestoreDoc("s1", "orgs/o1/campaignSends/s1", data))

  @Test
  fun aStoppedSendSaysWhyOnTheListAndTheDetailAlike() {
    val canceled = send(mapOf("subject" to "Hi", "status" to "canceled", "stats" to mapOf("sent" to 0L, "audienceSize" to 0L)))
    assertEquals("Canceled", canceled.statusWord)
    assertEquals("Canceled before it was sent", canceled.display.label)
    assertEquals("Failed", send(mapOf("status" to "failed", "stats" to mapOf("sent" to 0L))).statusWord)
    assertEquals("Sent", send(mapOf("status" to "sent", "stats" to mapOf("sent" to 12L))).statusWord)
    assertEquals("Draft", send(mapOf("status" to "draft")).statusWord)
    assertEquals("Scheduled", send(mapOf("status" to "scheduled")).statusWord)
  }

  @Test
  fun aSuppressionReasonReadsAsTheConsoleSaysIt() {
    assertEquals("Bounced", suppressionReasonLabel("bounce"))
    assertEquals("Bounced (temporary)", suppressionReasonLabel("soft_bounce"))
    assertEquals("Marked as spam", suppressionReasonLabel("complaint"))
    assertEquals("Unsubscribed", suppressionReasonLabel("unsubscribe"))
    assertEquals("Something new", suppressionReasonLabel("something_new"))
  }
}
