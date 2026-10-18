package com.aglyn.core

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** AGL-3918: a plan allowance counts live documents, every one less the deleted ones. */
class LiveCountTest {
  /** A reader that counts: the total, and the tombstones when the query filters on `deletedAt`. */
  private class CountingReader(private val total: Long?, private val tombstones: Long?) : FirestoreReader {
    val asked = mutableListOf<FirestoreQuery>()
    override suspend fun get(path: String): FirestoreDoc? = null
    override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
    override suspend fun count(query: FirestoreQuery): Long? {
      asked += query
      return if (query.filters.any { it.field == "deletedAt" }) tombstones else total
    }
  }

  @Test
  fun theTombstoneFilterMatchesARealDeletionTime() {
    assertEquals(FirestoreFilter("deletedAt", FilterOp.GT, FirestoreTimestamp(0)), TOMBSTONE_FILTER)
    val (all, deleted) = liveCountQueries("hosts/h/workflows")
    assertTrue(all.filters.isEmpty())
    assertEquals(listOf(TOMBSTONE_FILTER), deleted.filters)
  }

  @Test
  fun countsEveryDocumentLessTheDeletedOnes() = runTest {
    val reader = CountingReader(total = 4, tombstones = 1)
    assertEquals(3L, reader.liveCount("hosts/h/workflows"))
    assertEquals(2, reader.asked.size)
  }

  @Test
  fun neverBelowZeroAndUnknownWhenEitherCountIs() = runTest {
    assertEquals(0L, liveCountOf(1, 2))
    assertNull(CountingReader(total = 4, tombstones = null).liveCount("hosts/h/products"))
  }

  @Test
  fun anArchivedDocumentIsLiveAndADeletedOneIsNot() {
    assertTrue(isLiveDoc(FirestoreDoc("a", "p/a", mapOf("status" to "archived"))))
    assertTrue(isLiveDoc(FirestoreDoc("b", "p/b", mapOf("deletedAt" to null))))
    assertFalse(isLiveDoc(FirestoreDoc("c", "p/c", mapOf("deletedAt" to FirestoreTimestamp(1)))))
  }
}
