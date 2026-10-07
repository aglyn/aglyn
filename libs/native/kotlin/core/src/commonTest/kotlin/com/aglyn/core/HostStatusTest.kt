package com.aglyn.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class HostStatusTest {
  private val now = 1_000_000_000L

  @Test
  fun aSiteWithPublishedPagesIsLive() {
    val status = HostStatus.describe(mapOf("screens" to mapOf("home" to emptyMap<String, Any>(), "about" to emptyMap<String, Any>())), now)
    assertEquals(HostStatusKind.LIVE, status.kind)
    assertEquals("2 published pages.", status.detail)
    assertEquals("1 published page.", HostStatus.describe(mapOf("screens" to mapOf("home" to 1)), now).detail)
  }

  @Test
  fun nothingPublishedIsADraft() {
    assertEquals(HostStatusKind.DRAFT, HostStatus.describe(mapOf(), now).kind)
    assertEquals(HostStatusKind.DRAFT, HostStatus.describe(null, now).kind)
  }

  @Test
  fun suspensionAndMaintenanceWinOverPublishedPages() {
    val live = mapOf<String, Any?>("screens" to mapOf("home" to 1))
    assertEquals(HostStatusKind.SUSPENDED, HostStatus.describe(live + ("suspendedAt" to 5L), now).kind)
    assertEquals(HostStatusKind.SUSPENDED, HostStatus.describe(live + mapOf("suspendedAt" to 5L, "suspendedUntilMs" to now + 1), now).kind)
    // A timed suspension that has elapsed is over.
    assertEquals(HostStatusKind.LIVE, HostStatus.describe(live + mapOf("suspendedAt" to 5L, "suspendedUntilMs" to now - 1), now).kind)
    assertEquals(HostStatusKind.MAINTENANCE, HostStatus.describe(live + ("maintenance" to true), now).kind)
  }

  @Test
  fun aSiteAddressIsOnThePlatformDomain() {
    assertEquals("shop.aglyn.app", siteAddress("shop"))
    assertNull(siteAddress(""))
  }
}

class RelativeTimeTest {
  private val now = 10_000_000_000L
  private fun ago(minutes: Long) = relativeTime(now - minutes * 60_000, now)

  @Test
  fun readsInShortWords() {
    assertEquals("Just now", ago(0))
    assertEquals("Just now", relativeTime(now + 5_000, now))
    assertEquals("12 min ago", ago(12))
    assertEquals("3 hr ago", ago(180))
    assertEquals("Yesterday", ago(60 * 30))
    assertEquals("4 days ago", ago(60 * 24 * 4))
    assertEquals("2 wk ago", ago(60 * 24 * 15))
    assertEquals("5 mo ago", ago(60 * 24 * 150))
    assertEquals("2 yr ago", ago(60 * 24 * 800))
  }
}
