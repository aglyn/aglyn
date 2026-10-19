package com.aglyn.shell

import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The sidebar's plan card (AGL-3946): the console's own usage notice, for the workspace on screen, until dismissed. */
class NavPlanCardTest {
  private val now = 1_800_000_000_000L
  private fun notice(id: String, orgId: String, daysAgo: Long, type: String = PLAN_USAGE_TYPE) = FeedNotification(
    id = id, title = "You're above 80% of your sites quota", body = null, link = "/acme/billing", read = false, level = "warning",
    type = type, createdAt = FirestoreTimestamp((now - daysAgo * 86_400_000) / 1000), orgId = orgId,
  )

  @Test
  fun aCloseLimitShowsForItsOwnWorkspaceUntilDismissed() {
    val prefs = InMemoryKeyValueStore()
    val feed = listOf(notice("n0", "o1", 0, type = "content.order"), notice("n1", "o1", 2), notice("n2", "o2", 1))
    assertEquals("n1", planNoticeFor(feed, "o1", "u1", prefs, now)?.id)
    assertEquals("n2", planNoticeFor(feed, "o2", "u1", prefs, now)?.id)
    prefs.set(planCardDismissedKey("u1", "n1"), "1")
    assertNull(planNoticeFor(feed, "o1", "u1", prefs, now))
  }

  @Test
  fun aMonthOldNoticeIsThePast() {
    assertNull(planNoticeFor(listOf(notice("n1", "o1", 31)), "o1", "u1", InMemoryKeyValueStore(), now))
    assertNull(planNoticeFor(listOf(notice("n1", "o1", 1)), null, "u1", InMemoryKeyValueStore(), now))
  }
}
