package com.aglyn.core

/**
 * Writes under the console's own security rules, as the signed-in person.
 * [merge] is the Firebase web SDK's `setDoc(ref, data, { merge: true })`:
 * nested maps merge key by key, every other value replaces its field, and a
 * missing document is created.
 */
interface FirestoreWriter {
  suspend fun merge(path: String, data: Map<String, Any?>)

  /**
   * Deletes the document at [path], as the web SDK's `deleteDoc`: under the
   * same rules, and a missing document is not an error.
   */
  suspend fun delete(path: String): Unit = throw IllegalStateException("Deleting is not available here.")
}

/**
 * A merge value that removes its field: the web SDK's `deleteField()`. A
 * [FirestoreTimestamp] value writes a Firestore timestamp.
 */
data object FirestoreDelete

/** Now, as a Firestore timestamp a merge writes. */
fun firestoreNow(): FirestoreTimestamp = nowMillis().let { FirestoreTimestamp(it.floorDiv(1000L), (it.mod(1000L) * 1_000_000).toInt()) }

/** A shell with nothing to write through; every write fails with words for the screen. */
object NoFirestoreWrites : FirestoreWriter {
  override suspend fun merge(path: String, data: Map<String, Any?>) =
    throw IllegalStateException("Saving is not available here.")

  override suspend fun delete(path: String) = throw IllegalStateException("Deleting is not available here.")
}

/**
 * The leaf field paths a merge of [data] touches, as Firestore field paths:
 * a segment that is not a plain identifier is quoted in backticks, so a key
 * like `content.order` stays one segment. An empty map is a leaf, so the
 * merge writes it as an empty map.
 */
fun mergeFieldPaths(data: Map<String, Any?>, prefix: List<String> = emptyList()): List<String> =
  data.entries.flatMap { (key, value) ->
    val path = prefix + key
    if (value is Map<*, *> && value.isNotEmpty()) {
      @Suppress("UNCHECKED_CAST")
      mergeFieldPaths(value as Map<String, Any?>, path)
    } else {
      listOf(path.joinToString(".") { quoteFieldPathSegment(it) })
    }
  }

private val PLAIN_SEGMENT = Regex("^[A-Za-z_][A-Za-z_0-9]*$")

fun quoteFieldPathSegment(segment: String): String =
  if (PLAIN_SEGMENT.matches(segment)) segment else "`" + segment.replace("\\", "\\\\").replace("`", "\\`") + "`"

/**
 * A merge that leaves the document exactly [next], given what it holds now
 * ([existing]): every field [existing] has that [next] lacks is deleted, at
 * every depth, so a writer with only `merge` makes the console's whole-document
 * `set` (an overlay's save, for one).
 */
@Suppress("UNCHECKED_CAST")
fun replacementMerge(existing: Map<String, Any?>?, next: Map<String, Any?>): Map<String, Any?> = buildMap {
  for ((key, value) in next) {
    val before = existing?.get(key)
    put(key, if (value is Map<*, *> && before is Map<*, *>) replacementMerge(before as Map<String, Any?>, value as Map<String, Any?>) else value)
  }
  existing?.keys?.filter { it !in next }?.forEach { put(it, FirestoreDelete) }
}
