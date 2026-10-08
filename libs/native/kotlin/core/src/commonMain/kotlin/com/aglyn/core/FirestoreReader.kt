package com.aglyn.core

import kotlinx.coroutines.flow.Flow

/**
 * A Firestore document as the app reads it. Values are plain Kotlin:
 * String, Long, Double, Boolean, null, [FirestoreTimestamp], List and Map.
 */
data class FirestoreDoc(
  val id: String,
  val path: String,
  val data: Map<String, Any?>,
) {
  fun string(field: String): String? = data[field] as? String
  fun long(field: String): Long? = (data[field] as? Number)?.toLong()
  fun bool(field: String): Boolean? = data[field] as? Boolean
}

/** A Firestore timestamp, as epoch seconds and nanos. */
data class FirestoreTimestamp(val seconds: Long, val nanos: Int = 0) : Comparable<FirestoreTimestamp> {
  val epochMillis: Long get() = seconds * 1000 + nanos / 1_000_000
  override fun compareTo(other: FirestoreTimestamp): Int =
    compareValuesBy(this, other, { it.seconds }, { it.nanos })
}

enum class FilterOp { EQ, NE, LT, LTE, GT, GTE, IN, NOT_IN, ARRAY_CONTAINS, ARRAY_CONTAINS_ANY }

data class FirestoreFilter(val field: String, val op: FilterOp, val value: Any?)

data class FirestoreOrder(val field: String, val descending: Boolean = false)

/**
 * A collection query: the constraints every platform can express, the SDK as
 * constraints and REST as a `structuredQuery`. [startAfter] holds the order
 * field values of the last row of the previous page.
 */
data class FirestoreQuery(
  val collectionPath: String,
  val filters: List<FirestoreFilter> = emptyList(),
  val orderBy: List<FirestoreOrder> = emptyList(),
  val limit: Int? = null,
  val startAfter: List<Any?>? = null,
)

data class FirestorePage(
  val docs: List<FirestoreDoc>,
  /** Pass as [FirestoreQuery.startAfter] for the next page; null on the last page. */
  val nextCursor: List<Any?>?,
)

sealed interface Live<out T> {
  data object Loading : Live<Nothing>
  /**
   * [fromCache]: the snapshot came from the device's cache and the server has
   * not confirmed it yet (the web SDK's `metadata.fromCache`). An editor that
   * writes back a whole document refuses to save from such a seed.
   */
  data class Ready<T>(val value: T, val fromCache: Boolean = false) : Live<T>
  data class Failed(val error: Throwable) : Live<Nothing>
}

/**
 * Reads under the console's own security rules, as the signed-in person.
 * Android binds the Firebase Android SDK (realtime listeners); desktop binds
 * Firestore REST v1 (refresh on focus, on pull and on a timer).
 */
interface FirestoreReader {
  suspend fun get(path: String): FirestoreDoc?

  /** One page: [FirestoreQuery.limit] rows plus one probe row decide [FirestorePage.nextCursor]. */
  suspend fun page(query: FirestoreQuery): FirestorePage

  fun observeDoc(path: String): Flow<Live<FirestoreDoc?>>

  fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>>
}

/** The order-field values of [doc] for a [FirestoreQuery.startAfter] cursor. */
fun cursorOf(doc: FirestoreDoc, orderBy: List<FirestoreOrder>): List<Any?> =
  orderBy.map { if (it.field == "__name__") doc.path else doc.data[it.field] }
