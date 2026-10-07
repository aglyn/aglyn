package com.aglyn.core

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldPath
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/** [FirestoreReader] on the Firebase Android SDK: realtime snapshot listeners. */
class FirebaseFirestoreReader(private val db: FirebaseFirestore) : FirestoreReader {
  override suspend fun get(path: String): FirestoreDoc? =
    db.document(path).get().await().toDoc()

  override suspend fun page(query: FirestoreQuery): FirestorePage {
    val limit = query.limit
    val probe = if (limit != null) query.copy(limit = limit + 1) else query
    val docs = build(probe).get().await().documents.mapNotNull { it.toDoc() }
    val rows = if (limit != null) docs.take(limit) else docs
    val next = if (limit != null && docs.size > limit) cursorOf(rows.last(), query.orderBy) else null
    return FirestorePage(rows, next)
  }

  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = callbackFlow {
    trySend(Live.Loading)
    val registration = db.document(path).addSnapshotListener { snapshot, error ->
      if (error != null) trySend(Live.Failed(error)) else trySend(Live.Ready(snapshot?.toDoc()))
    }
    awaitClose { registration.remove() }
  }

  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = callbackFlow {
    trySend(Live.Loading)
    val registration = build(query).addSnapshotListener { snapshot, error ->
      if (error != null) {
        trySend(Live.Failed(error))
      } else {
        trySend(Live.Ready(snapshot?.documents?.mapNotNull { it.toDoc() } ?: emptyList()))
      }
    }
    awaitClose { registration.remove() }
  }

  private fun build(query: FirestoreQuery): Query {
    var q: Query = db.collection(query.collectionPath)
    for (filter in query.filters) {
      val field = if (filter.field == "__name__") FieldPath.documentId() else FieldPath.of(*filter.field.split('.').toTypedArray())
      val value = filter.value
      q = when (filter.op) {
        FilterOp.EQ -> q.whereEqualTo(field, value)
        FilterOp.NE -> q.whereNotEqualTo(field, value)
        FilterOp.LT -> q.whereLessThan(field, value!!)
        FilterOp.LTE -> q.whereLessThanOrEqualTo(field, value!!)
        FilterOp.GT -> q.whereGreaterThan(field, value!!)
        FilterOp.GTE -> q.whereGreaterThanOrEqualTo(field, value!!)
        FilterOp.IN -> q.whereIn(field, value as List<Any>)
        FilterOp.NOT_IN -> q.whereNotIn(field, value as List<Any>)
        FilterOp.ARRAY_CONTAINS -> q.whereArrayContains(field, value!!)
        FilterOp.ARRAY_CONTAINS_ANY -> q.whereArrayContainsAny(field, value as List<Any>)
      }
    }
    for (order in query.orderBy) {
      val direction = if (order.descending) Query.Direction.DESCENDING else Query.Direction.ASCENDING
      q = if (order.field == "__name__") q.orderBy(FieldPath.documentId(), direction) else q.orderBy(order.field, direction)
    }
    query.startAfter?.let { cursor ->
      val values = cursor.mapIndexed { i, value ->
        // A document-id order carries the full path in the cursor; the SDK wants the id.
        if (query.orderBy.getOrNull(i)?.field == "__name__") value.toString().substringAfterLast('/') else toSdk(value)
      }
      q = q.startAfter(*values.toTypedArray())
    }
    query.limit?.let { q = q.limit(it.toLong()) }
    return q
  }

  private fun toSdk(value: Any?): Any? = when (value) {
    is FirestoreTimestamp -> Timestamp(value.seconds, value.nanos)
    else -> value
  }
}

internal fun DocumentSnapshot.toDoc(): FirestoreDoc? {
  if (!exists()) return null
  return FirestoreDoc(id, reference.path, (data ?: emptyMap()).mapValues { plain(it.value) })
}

private fun plain(value: Any?): Any? = when (value) {
  is Timestamp -> FirestoreTimestamp(value.seconds, value.nanoseconds)
  is Map<*, *> -> value.entries.associate { it.key.toString() to plain(it.value) }
  is List<*> -> value.map(::plain)
  is Int -> value.toLong()
  is Float -> value.toDouble()
  else -> value
}
