package com.aglyn.core

/*
 * How a plan allowance counts a collection whose delete is a SOFT delete (AGL-3918): a deleted document frees its
 * slot, an archived one keeps it. Deleting stamps `deletedAt` and leaves the document, so the count is every
 * document less the tombstones, the same two aggregates `/api/hosts/resources` counts a create at. The Swift kit's
 * `LiveCount.swift`; the console's `live-document-count.ts`.
 */

/**
 * The filter that matches a deleted document. Every timestamp sorts after the epoch, and neither `null` nor an absent
 * field matches an inequality, so this selects exactly the documents whose `deletedAt` holds a real time.
 */
val TOMBSTONE_FILTER = FirestoreFilter("deletedAt", FilterOp.GT, FirestoreTimestamp(0))

/** The two aggregates a live count reads: every document of [collectionPath], and its tombstones. */
fun liveCountQueries(collectionPath: String): Pair<FirestoreQuery, FirestoreQuery> =
  FirestoreQuery(collectionPath) to FirestoreQuery(collectionPath, filters = listOf(TOMBSTONE_FILTER))

/** The live count, never below zero: the two aggregates are separate reads, and a delete between them can make the second the larger. */
fun liveCountOf(total: Long, tombstones: Long): Long = maxOf(0L, total - tombstones)

/** Whether a stored document is live: no `deletedAt`, or `deletedAt: null`. */
fun isLiveDoc(doc: FirestoreDoc): Boolean = doc.data["deletedAt"] == null

/** The live documents of [collectionPath] as the server counts them, or null where this reader cannot count either aggregate. */
suspend fun FirestoreReader.liveCount(collectionPath: String): Long? {
  val (all, deleted) = liveCountQueries(collectionPath)
  val total = count(all) ?: return null
  val tombstones = count(deleted) ?: return null
  return liveCountOf(total, tombstones)
}
