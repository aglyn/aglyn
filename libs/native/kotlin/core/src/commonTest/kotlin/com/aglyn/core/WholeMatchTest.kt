package com.aglyn.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** AGL-4011: a server count or sum is of every match, never of the query's window. */
class WholeMatchTest {
  @Test
  fun dropsOnlyTheWindow() {
    val query = FirestoreQuery(
      "orgs/o1/contacts",
      filters = listOf(FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, listOf("org", "host:h1"))),
      orderBy = listOf(FirestoreOrder("createdAt")),
      limit = 1,
      startAfter = listOf(5L),
    )
    val whole = query.wholeMatch
    assertNull(whole.limit)
    assertNull(whole.startAfter)
    assertEquals(query.collectionPath, whole.collectionPath)
    assertEquals(query.filters, whole.filters)
    assertEquals(query.orderBy, whole.orderBy)
  }
}
