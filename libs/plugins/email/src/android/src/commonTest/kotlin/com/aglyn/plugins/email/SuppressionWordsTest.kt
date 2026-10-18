package com.aglyn.plugins.email

import kotlin.test.Test
import kotlin.test.assertEquals

/** A suppression's reason reads as the console says it, never the stored key. */
class SuppressionWordsTest {
  @Test
  fun aSuppressionReasonReadsAsTheConsoleSaysIt() {
    assertEquals("Bounced", suppressionReasonLabel("bounce"))
    assertEquals("Bounced (temporary)", suppressionReasonLabel("soft_bounce"))
    assertEquals("Marked as spam", suppressionReasonLabel("complaint"))
    assertEquals("Unsubscribed", suppressionReasonLabel("unsubscribe"))
    assertEquals("Something new", suppressionReasonLabel("something_new"))
  }
}
