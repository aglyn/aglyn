package com.aglyn.plugins.eventscalendar

import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreTimestamp
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class EventsTest {
  @Test
  fun theListDropsDeletedAndSaysWhenTheWindowIsFull() {
    val docs = (0 until 201).map { FirestoreDoc("e$it", "p/e$it", mapOf("title" to "E$it", "startsAtMs" to it.toLong())) } +
      FirestoreDoc("gone", "p/gone", mapOf("deletedAt" to FirestoreTimestamp(1)))
    val (rows, full) = visibleEvents(docs)
    assertTrue(full)
    assertEquals(200, rows.size)
    assertEquals("e199", rows.first().id)
  }

  @Test
  fun theMergeDeletesWhatTheRuleRemoves() {
    val merge = eventMerge(EventDraft(null, title = " Launch ", startsAtMs = 1_800_000_000_000, coverImageAlt = "orphan"))
    assertEquals("Launch", merge["title"])
    assertEquals(1_800_000_000_000 + 3_600_000L, merge["endsAtMs"])
    assertEquals(FirestoreDelete, merge["coverImageAlt"])
    assertTrue("createdAt" in merge)
    assertTrue("createdAt" !in eventMerge(EventDraft("e1", title = "x", startsAtMs = 5)))
  }
}
