package com.aglyn.shell

import com.aglyn.contracts.recentDayIds
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import kotlin.test.Test
import kotlin.test.assertEquals

/** The Traffic card's read: both windows' day documents, by id from the oldest day on, never a descending id scan. */
class AnalyticsTrafficTest {
  @Test
  fun trafficReadsBothWindowsAscendingFromTheOldestDay() {
    val now = 1_792_108_800_000L // 2026-10-16T00:00:00Z
    val query = trafficQuery("h1", 14, now)
    val days = recentDayIds(now, 28)
    assertEquals("hosts/h1/analytics", query.collectionPath)
    assertEquals(listOf(FirestoreFilter("__name__", FilterOp.GTE, "hosts/h1/analytics/${days.last()}")), query.filters)
    assertEquals(listOf(FirestoreOrder("__name__")), query.orderBy)
    assertEquals(28, query.limit)
    assertEquals("2026-10-16", days.first())
    assertEquals("2026-09-19", days.last())
  }

  @Test
  fun aReferrerReadsAsItsHostAgain() {
    assertEquals("google.com", referrerHostLabel("google_com"))
    assertEquals("m.facebook.com", referrerHostLabel("m_facebook_com"))
    assertEquals("", referrerHostLabel(""))
  }
}
