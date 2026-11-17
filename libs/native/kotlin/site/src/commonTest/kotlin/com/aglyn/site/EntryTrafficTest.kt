package com.aglyn.site

import com.aglyn.site.analytics.EntryTrafficSummary
import com.aglyn.site.analytics.analyticsPathKey
import com.aglyn.site.analytics.trafficDayOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The Apple `EntryTrafficTests` cases. */
class EntryTrafficTest {
  @Test
  fun foldsAPathTheWayTheBeaconWritesIt() {
    assertEquals("/blog/v1_2", analyticsPathKey("/blog/v1.2"))
    assertEquals("/a_b_c_d_e", analyticsPathKey("/a.b\$c#d[e"))
    assertEquals("/", analyticsPathKey(""))
    assertEquals(200, analyticsPathKey("/" + "x".repeat(300)).length)
  }

  @Test
  fun countsOnlyTheEntrysOwnPath() {
    val days = listOf(
      trafficDayOf("2026-11-14", mapOf("paths" to mapOf("/blog/hello" to 3L, "/" to 40L))),
      trafficDayOf("2026-11-15", null),
      trafficDayOf("2026-11-16", mapOf("paths" to mapOf("/blog/hello" to 5L))),
    )
    val summary = EntryTrafficSummary.of(days, "/blog/hello")
    assertEquals(listOf(3.0, 0.0, 5.0), summary.counts.map { it.second })
    assertEquals(8.0, summary.total)
    assertEquals("2026-11-16" to 5.0, summary.best)
    assertNull(EntryTrafficSummary.of(days, "/blog/other").best)
  }
}
