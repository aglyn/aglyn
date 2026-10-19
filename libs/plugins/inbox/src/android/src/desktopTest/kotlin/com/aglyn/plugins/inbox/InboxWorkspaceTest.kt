package com.aglyn.plugins.inbox

import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The workspace's own Inbox (AGL-3946): every site's submissions through the collection group, narrowed to the workspace. */
class InboxWorkspaceTest {
  @Test
  fun everySitesMessagesComeFromTheCollectionGroup() {
    val query = workspaceSubmissionsQuery("o1", ReadFilter.ALL, "", 25)
    assertTrue(query.collectionGroup)
    assertEquals("formSubmissions", query.collectionPath)
    assertTrue(query.filters.any { it.field == "orgId" && it.op == FilterOp.EQ && it.value == "o1" })
  }

  @Test
  fun aMessageKnowsItsSite() {
    val row = submissionOf(FirestoreDoc("s1", "hosts/h1/formSubmissions/s1", mapOf("fields" to mapOf("email" to "a@b.test"))))
    assertEquals("h1", row.hostId)
  }
}
