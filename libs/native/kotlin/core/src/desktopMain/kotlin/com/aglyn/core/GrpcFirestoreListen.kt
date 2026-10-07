package com.aglyn.core

import com.google.firestore.v1.Document
import com.google.firestore.v1.ListenRequest
import com.google.firestore.v1.ListenResponse
import com.google.firestore.v1.StructuredQuery
import com.google.firestore.v1.Target
import com.google.firestore.v1.TargetChange
import com.google.firestore.v1.Value
import com.google.protobuf.util.JsonFormat
import io.grpc.CallOptions
import io.grpc.ClientInterceptors
import io.grpc.ManagedChannel
import io.grpc.Metadata
import io.grpc.MethodDescriptor
import io.grpc.Status
import io.grpc.okhttp.OkHttpChannelBuilder
import io.grpc.protobuf.lite.ProtoLiteUtils
import io.grpc.stub.ClientCalls
import io.grpc.stub.MetadataUtils
import io.grpc.stub.StreamObserver
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import java.util.concurrent.TimeUnit

/** A realtime stream of one document or one query, opened with [idToken]; it ends by throwing. */
interface FirestoreListen {
  fun document(path: String, idToken: String): Flow<FirestoreDoc?>
  fun query(query: FirestoreQuery, structuredQueryJson: String, idToken: String): Flow<List<FirestoreDoc>>
}

/**
 * Firestore's realtime `Listen` (google.firestore.v1.Firestore/Listen) over
 * gRPC, as the signed-in person: the stream carries `Authorization: Bearer
 * <Firebase ID token>`, so the console's security rules decide what it may
 * watch, exactly as for the REST reads.
 *
 * One stream per observed document or query. Each emission is the whole
 * current result once the server marks the target CURRENT, then again after
 * every change. The stream ends with an error when the server refuses it, the
 * token expires or the connection drops; the caller re-opens it with a fresh
 * token (see [RestFirestoreReader]).
 */
class GrpcFirestoreListen(
  projectId: String,
  emulatorHost: String?,
) : FirestoreListen {
  private val database = "projects/$projectId/databases/(default)"
  private val documents = "$database/documents"

  private val grpcChannel: ManagedChannel = run {
    val (host, port) = emulatorHost?.let { it.substringBeforeLast(':') to it.substringAfterLast(':').toInt() }
      ?: ("firestore.googleapis.com" to 443)
    OkHttpChannelBuilder.forAddress(host, port)
      .apply { if (emulatorHost != null) usePlaintext() else useTransportSecurity() }
      .keepAliveTime(30, TimeUnit.SECONDS)
      .build()
  }

  /** Watches one document; null while it does not exist. */
  override fun document(path: String, idToken: String): Flow<FirestoreDoc?> =
    listen(Target.newBuilder().setDocuments(Target.DocumentsTarget.newBuilder().addDocuments("$documents/$path")), idToken) { docs ->
      docs.values.firstOrNull()
    }

  /**
   * Watches a query, given as the REST `structuredQuery` JSON [RestFirestoreReader]
   * builds for the same [FirestoreQuery]. The rows come back in [query]'s order.
   */
  override fun query(query: FirestoreQuery, structuredQueryJson: String, idToken: String): Flow<List<FirestoreDoc>> {
    val structured = StructuredQuery.newBuilder().also { JsonFormat.parser().merge(structuredQueryJson, it) }
    val parent = query.collectionPath.substringBeforeLast('/', "").let { if (it.isEmpty()) documents else "$documents/$it" }
    val target = Target.newBuilder().setQuery(Target.QueryTarget.newBuilder().setParent(parent).setStructuredQuery(structured))
    return listen(target, idToken) { docs ->
      val sorted = docs.values.sortedWith(queryOrder(query.orderBy))
      query.limit?.let { sorted.take(it) } ?: sorted
    }
  }

  fun close() {
    grpcChannel.shutdownNow()
  }

  private fun <T> listen(target: Target.Builder, idToken: String, result: (Map<String, FirestoreDoc>) -> T): Flow<T> = callbackFlow {
    val docs = linkedMapOf<String, FirestoreDoc>()
    var current = false
    val headers = Metadata().apply {
      put(AUTHORIZATION, "Bearer $idToken")
      put(RESOURCE_PREFIX, database)
    }
    val requests = ClientCalls.asyncBidiStreamingCall(
      ClientInterceptors.intercept(grpcChannel, MetadataUtils.newAttachHeadersInterceptor(headers)).newCall(LISTEN, CallOptions.DEFAULT),
      object : StreamObserver<ListenResponse> {
        override fun onNext(response: ListenResponse) {
          when (response.responseTypeCase) {
            ListenResponse.ResponseTypeCase.DOCUMENT_CHANGE -> {
              val change = response.documentChange
              if (TARGET_ID in change.targetIdsList) docs[change.document.name] = docOf(change.document)
              else if (TARGET_ID in change.removedTargetIdsList) docs.remove(change.document.name)
            }
            ListenResponse.ResponseTypeCase.DOCUMENT_DELETE -> docs.remove(response.documentDelete.document)
            ListenResponse.ResponseTypeCase.DOCUMENT_REMOVE -> docs.remove(response.documentRemove.document)
            ListenResponse.ResponseTypeCase.TARGET_CHANGE -> {
              val change = response.targetChange
              when (change.targetChangeType) {
                TargetChange.TargetChangeType.REMOVE -> {
                  // The server dropped the target: a rules refusal carries its status.
                  val cause = change.cause
                  close(ListenTargetRemoved(Status.fromCodeValue(cause.code).withDescription(cause.message.trim())))
                  return
                }
                TargetChange.TargetChangeType.CURRENT -> current = true
                TargetChange.TargetChangeType.RESET -> docs.clear()
                else -> Unit
              }
              // CURRENT, and every consistent point after it (a NO_CHANGE naming no target), is a snapshot to show.
              val consistent = change.targetChangeType == TargetChange.TargetChangeType.NO_CHANGE && change.targetIdsCount == 0
              if (change.targetChangeType == TargetChange.TargetChangeType.CURRENT || (current && consistent)) trySend(result(docs))
            }
            else -> Unit
          }
        }

        override fun onError(t: Throwable) {
          close(t)
        }

        override fun onCompleted() {
          close()
        }
      },
    )
    requests.onNext(
      ListenRequest.newBuilder().setDatabase(database).setAddTarget(target.setTargetId(TARGET_ID)).build(),
    )
    awaitClose { runCatching { requests.onError(Status.CANCELLED.asException()) } }
  }

  private fun docOf(document: Document): FirestoreDoc {
    val path = document.name.substringAfter("/documents/")
    return FirestoreDoc(path.substringAfterLast('/'), path, document.fieldsMap.mapValues { plain(it.value) })
  }

  companion object {
    private const val TARGET_ID = 1
    private val AUTHORIZATION: Metadata.Key<String> = Metadata.Key.of("authorization", Metadata.ASCII_STRING_MARSHALLER)
    private val RESOURCE_PREFIX: Metadata.Key<String> = Metadata.Key.of("google-cloud-resource-prefix", Metadata.ASCII_STRING_MARSHALLER)

    /** The one RPC this client calls, described by hand so no generated stub is needed. */
    val LISTEN: MethodDescriptor<ListenRequest, ListenResponse> = MethodDescriptor.newBuilder(
      ProtoLiteUtils.marshaller(ListenRequest.getDefaultInstance()),
      ProtoLiteUtils.marshaller(ListenResponse.getDefaultInstance()),
    )
      .setType(MethodDescriptor.MethodType.BIDI_STREAMING)
      .setFullMethodName("google.firestore.v1.Firestore/Listen")
      .build()

    /** A Firestore value as the plain Kotlin [FirestoreDoc] holds. */
    fun plain(value: Value): Any? = when (value.valueTypeCase) {
      Value.ValueTypeCase.NULL_VALUE -> null
      Value.ValueTypeCase.BOOLEAN_VALUE -> value.booleanValue
      Value.ValueTypeCase.INTEGER_VALUE -> value.integerValue
      Value.ValueTypeCase.DOUBLE_VALUE -> value.doubleValue
      Value.ValueTypeCase.TIMESTAMP_VALUE -> FirestoreTimestamp(value.timestampValue.seconds, value.timestampValue.nanos)
      Value.ValueTypeCase.STRING_VALUE -> value.stringValue
      Value.ValueTypeCase.BYTES_VALUE -> java.util.Base64.getEncoder().encodeToString(value.bytesValue.toByteArray())
      Value.ValueTypeCase.REFERENCE_VALUE -> value.referenceValue
      Value.ValueTypeCase.GEO_POINT_VALUE -> mapOf("latitude" to value.geoPointValue.latitude, "longitude" to value.geoPointValue.longitude)
      Value.ValueTypeCase.ARRAY_VALUE -> value.arrayValue.valuesList.map(::plain)
      Value.ValueTypeCase.MAP_VALUE -> value.mapValue.fieldsMap.mapValues { plain(it.value) }
      else -> null
    }

    /** Firestore's order over [orderBy], then the document path, for a query's rows. */
    fun queryOrder(orderBy: List<FirestoreOrder>): Comparator<FirestoreDoc> = Comparator { a, b ->
      for (order in orderBy) {
        val compared = if (order.field == "__name__") a.path.compareTo(b.path)
        else compareValues(fieldOf(a, order.field), fieldOf(b, order.field))
        if (compared != 0) return@Comparator if (order.descending) -compared else compared
      }
      val last = orderBy.lastOrNull()
      val byName = a.path.compareTo(b.path)
      if (last?.descending == true && last.field != "__name__") -byName else byName
    }

    private fun fieldOf(doc: FirestoreDoc, field: String): Any? =
      field.split('.').fold(doc.data as Any?) { value, key -> (value as? Map<*, *>)?.get(key) }

    /** Firestore's cross-type order: null, booleans, numbers, timestamps, strings, then anything else. */
    private fun compareValues(a: Any?, b: Any?): Int {
      val rank = rankOf(a).compareTo(rankOf(b))
      if (rank != 0) return rank
      return when (a) {
        is Boolean -> a.compareTo(b as Boolean)
        is Number -> a.toDouble().compareTo((b as Number).toDouble())
        is FirestoreTimestamp -> a.compareTo(b as FirestoreTimestamp)
        is String -> a.compareTo(b as String)
        else -> 0
      }
    }

    private fun rankOf(value: Any?): Int = when (value) {
      null -> 0
      is Boolean -> 1
      is Number -> 2
      is FirestoreTimestamp -> 3
      is String -> 4
      else -> 5
    }
  }
}

/**
 * The server removed the watched target, most often because the security
 * rules refuse it (`PERMISSION_DENIED`). Unlike a failed call, the stream
 * itself worked, so REST would be refused the same way.
 */
class ListenTargetRemoved(val status: Status) : Exception(status.description ?: status.code.name)
