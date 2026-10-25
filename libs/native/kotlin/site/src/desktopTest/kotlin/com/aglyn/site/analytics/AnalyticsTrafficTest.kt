package com.aglyn.site.analytics

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
  fun aPagesTrafficReadsItsOwnDaysById() {
    val now = 1_792_108_800_000L // 2026-10-16T00:00:00Z
    val query = pageTrafficQuery("h1", "s1", now)
    assertEquals("hosts/h1/screenAnalytics", query.collectionPath)
    assertEquals(
      listOf(
        FirestoreFilter("__name__", FilterOp.GTE, "hosts/h1/screenAnalytics/s1:2026-10-03"),
        FirestoreFilter("__name__", FilterOp.LTE, "hosts/h1/screenAnalytics/s1:2026-10-16"),
      ),
      query.filters,
    )
    assertEquals(PAGE_TRAFFIC_DAYS, query.limit)
  }

  @Test
  fun aPagesActivityIsFilteredOnTheServerAndTheSitesIsNewestFirst() {
    assertEquals(listOf(FirestoreFilter("target.id", FilterOp.EQ, "s1")), activityQuery("h1", "s1").filters)
    assertEquals(listOf(FirestoreOrder("createdAt", descending = true)), activityQuery("h1", null).orderBy)
    assertEquals(ACTIVITY_WINDOW + 1, activityQuery("h1", null).limit)
  }

  @Test
  fun anUnaddressedActorIsNamedByTheAddressItHoldsNowElseItsAccount() {
    val doc = com.aglyn.core.FirestoreDoc("a1", "hosts/h1/activity/a1", mapOf("action" to "Saved", "actorId" to "u1"))
    assertEquals("Account u1", siteActivityRows(listOf(doc)).single().actor)
    assertEquals("lee@example.com", siteActivityRows(listOf(doc), mapOf("u1" to "lee@example.com")).single().actor)
    val key = com.aglyn.core.FirestoreDoc("a2", "hosts/h1/activity/a2", mapOf("action" to "Saved", "actorId" to "api"))
    assertEquals(null, unaddressedUid(com.aglyn.contracts.ActivityEntryFields.of(key.data)))
  }
}
