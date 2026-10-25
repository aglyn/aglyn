package com.aglyn.core

import com.google.firebase.Timestamp
import com.google.firebase.firestore.AggregateField
import com.google.firebase.firestore.AggregateSource
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldPath
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/** [FirestoreReader] on the Firebase Android SDK: realtime snapshot listeners. */
class FirebaseFirestoreReader(private val db: FirebaseFirestore) : FirestoreReader {
  override suspend fun get(path: String): FirestoreDoc? =
    recorded("get", path) { db.document(path).get().await().toDoc() }

  override suspend fun page(query: FirestoreQuery): FirestorePage = recorded("page", query.collectionPath) {
    val limit = query.limit
    val probe = if (limit != null) query.copy(limit = limit + 1) else query
    val docs = build(probe).get().await().documents.mapNotNull { it.toDoc() }
    val rows = if (limit != null) docs.take(limit) else docs
    val next = if (limit != null && docs.size > limit) cursorOf(rows.last(), query.orderBy) else null
    FirestorePage(rows, next)
  }

  override suspend fun count(query: FirestoreQuery): Long? = recorded("count", query.collectionPath) {
    build(query.copy(limit = null, startAfter = null)).count().get(AggregateSource.SERVER).await().count
  }

  override suspend fun sum(query: FirestoreQuery, field: String): Double? = recorded("sum", query.collectionPath) {
    val total = AggregateField.sum(field)
    build(query.copy(limit = null, startAfter = null)).aggregate(total).get(AggregateSource.SERVER).await().getDouble(total)
  }

  override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = callbackFlow {
    trySend(Live.Loading)
    val registration = db.document(path).addSnapshotListener { snapshot, error ->
      if (error != null) Telemetry.record(error, Telemetry.firestoreContext("listen_document", path))
      if (error != null) trySend(Live.Failed(error)) else trySend(Live.Ready(snapshot?.toDoc(), snapshot?.metadata?.isFromCache == true))
    }
    awaitClose { registration.remove() }
  }

  override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = callbackFlow {
    trySend(Live.Loading)
    val built = try {
      build(query)
    } catch (error: IllegalArgumentException) {
      // A query the SDK refuses to build (an `in` filter of the wrong kind of values): a fault in the app, not the data.
      Telemetry.record(error, Telemetry.firestoreContext("build", query.collectionPath))
      throw error
    }
    val registration = built.addSnapshotListener { snapshot, error ->
      if (error != null) {
        Telemetry.record(error, Telemetry.firestoreContext("listen", query.collectionPath))
        trySend(Live.Failed(error))
      } else {
        trySend(Live.Ready(snapshot?.documents?.mapNotNull { it.toDoc() } ?: emptyList(), snapshot?.metadata?.isFromCache == true))
      }
    }
    awaitClose { registration.remove() }
  }

  private fun documentIds(value: Any?): Any? = when (value) {
    is String -> value.substringAfterLast('/')
    is List<*> -> value.map { (it as? String)?.substringAfterLast('/') ?: it }
    else -> value
  }

  private fun build(query: FirestoreQuery): Query {
    var q: Query = if (query.collectionGroup) db.collectionGroup(query.collectionPath) else db.collection(query.collectionPath)
    for (filter in query.filters) {
      val field = if (filter.field == "__name__") FieldPath.documentId() else FieldPath.of(*filter.field.split('.').toTypedArray())
      // A timestamp filter (a date range, the tombstones a quota count leaves out) is the SDK's Timestamp. An id filter names
      // documents by path (`hosts/h/analytics/2026-10-01`, as the REST reader sends it), and the SDK takes a collection's
      // document by its plain id.
      val value = if (filter.field == "__name__") documentIds(filter.value) else toSdk(filter.value)
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

/** [FirestoreWriter] on the Firebase Android SDK: `set` with `SetOptions.merge()`, as the web SDK's merge. */
class FirebaseFirestoreWriter(private val db: FirebaseFirestore) : FirestoreWriter {
  override suspend fun merge(path: String, data: Map<String, Any?>) = recorded("set", path) {
    db.document(path).set(toSdkWrite(data), SetOptions.merge()).await()
    Unit
  }

  override suspend fun update(path: String, data: Map<String, Any?>) = recorded("update", path) {
    // FieldPath.of keeps each key one segment, as the shared contract names it.
    val fields = toSdkWrite(data).entries.toList()
    if (fields.isEmpty()) return@recorded
    val first = fields.first()
    val rest = fields.drop(1).flatMap { listOf(com.google.firebase.firestore.FieldPath.of(it.key), it.value) }.toTypedArray()
    db.document(path).update(com.google.firebase.firestore.FieldPath.of(first.key), first.value, *rest).await()
    Unit
  }

  override suspend fun delete(path: String) = recorded("delete", path) {
    db.document(path).delete().await()
    Unit
  }
}

/** Runs a Firestore read or write, telling [Telemetry] when it fails (the caller still shows its own message). */
internal inline fun <T> recorded(operation: String, path: String, body: () -> T): T =
  try {
    body()
  } catch (error: Exception) {
    Telemetry.record(error, Telemetry.firestoreContext(operation, path))
    throw error
  }

internal fun DocumentSnapshot.toDoc(): FirestoreDoc? {
  if (!exists()) return null
  return FirestoreDoc(id, reference.path, (data ?: emptyMap()).mapValues { plain(it.value) })
}

private fun plain(value: Any?): Any? = when (value) {
  is Timestamp -> FirestoreTimestamp(value.seconds, value.nanoseconds)
  // Bytes (a stored node tree) arrive as base64 text, as the desktop readers hand them over.
  is com.google.firebase.firestore.Blob -> android.util.Base64.encodeToString(value.toBytes(), android.util.Base64.NO_WRAP)
  is Map<*, *> -> value.entries.associate { it.key.toString() to plain(it.value) }
  is List<*> -> value.map(::plain)
  is Int -> value.toLong()
  is Float -> value.toDouble()
  else -> value
}

/** A merge's values as the SDK writes them: timestamps as Timestamp, [FirestoreDelete] as FieldValue.delete(). */
@Suppress("UNCHECKED_CAST")
internal fun toSdkWrite(data: Map<String, Any?>): Map<String, Any?> = data.mapValues { (_, value) -> sdkWriteValue(value) }

private fun sdkWriteValue(value: Any?): Any? = when (value) {
  FirestoreDelete -> com.google.firebase.firestore.FieldValue.delete()
  ServerTimestamp -> com.google.firebase.firestore.FieldValue.serverTimestamp()
  is FirestoreTimestamp -> Timestamp(value.seconds, value.nanos)
  is Map<*, *> -> value.entries.associate { it.key.toString() to sdkWriteValue(it.value) }
  is List<*> -> value.map(::sdkWriteValue)
  else -> value
}
