package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ListenTest {
  private val userDoc = """{"name":"projects/p/databases/(default)/documents/users/u1","fields":{"email":{"stringValue":"rest@example.test"}}}"""
  private fun rest(): HttpClient = HttpClient(MockEngine {
    respond(userDoc, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
  })

  private class FakeListen(private val document: (attempt: Int, token: String) -> Flow<FirestoreDoc?>) : FirestoreListen {
    var attempts = 0
    val tokens = mutableListOf<String>()
    override fun document(path: String, idToken: String): Flow<FirestoreDoc?> {
      tokens += idToken
      return document(attempts++, idToken)
    }
    override fun query(query: FirestoreQuery, structuredQueryJson: String, idToken: String): Flow<List<FirestoreDoc>> = error("unused")
  }

  private val streamed = FirestoreDoc("u1", "users/u1", mapOf("email" to "listen@example.test"))

  @Test
  fun anObservedDocumentStreamsWithAFreshToken() = runTest {
    val listen = FakeListen { _, _ -> flowOf(streamed) }
    var minted = 0
    val reader = RestFirestoreReader(rest(), "p", "127.0.0.1:1", { "cached" }, listen = listen, freshIdToken = { "fresh-${++minted}" })
    val values = reader.observeDoc("users/u1").take(2).toList()
    assertEquals(listOf(Live.Loading, Live.Ready(streamed)), values)
    assertEquals(listOf("fresh-1"), listen.tokens)
  }

  @Test
  fun aStreamIsReopenedWithANewTokenBeforeItsHourIsUp() = runTest {
    val listen = FakeListen { _, _ -> flow { emit(streamed); kotlinx.coroutines.awaitCancellation() } }
    var minted = 0
    val reader = RestFirestoreReader(rest(), "p", null, { "cached" }, listen = listen, freshIdToken = { "fresh-${++minted}" }, reopenMillis = 1_000)
    reader.observeDoc("users/u1").take(4).toList()
    assertEquals(listOf("fresh-1", "fresh-2", "fresh-3"), listen.tokens)
  }

  @Test
  fun aStreamThatCannotBeHeldFallsBackToPolling() = runTest {
    val listen = FakeListen { _, _ -> flow { throw io.grpc.StatusRuntimeException(io.grpc.Status.UNAVAILABLE) } }
    val reader = RestFirestoreReader(rest(), "p", null, { "cached" }, listen = listen, freshIdToken = { "fresh" })
    val values = reader.observeDoc("users/u1").take(2).toList()
    assertEquals(Live.Loading, values[0])
    assertEquals("rest@example.test", (values[1] as Live.Ready).value?.string("email"))
    assertEquals(RestFirestoreReader.LISTEN_ATTEMPTS, listen.attempts)
  }

  @Test
  fun aTargetTheRulesRefuseIsAFailureNotAFallback() = runTest {
    val listen = FakeListen { _, _ -> flow { throw ListenTargetRemoved(io.grpc.Status.PERMISSION_DENIED.withDescription("false for 'get'")) } }
    val reader = RestFirestoreReader(rest(), "p", null, { "cached" }, listen = listen, freshIdToken = { "fresh" })
    val failed = reader.observeDoc("users/u1").take(2).toList()[1]
    assertIs<Live.Failed>(failed)
    assertEquals(1, listen.attempts)
  }

  @Test
  fun queryRowsComeBackInTheQueryOrder() {
    fun doc(id: String, at: Any?) = FirestoreDoc(id, "c/$id", mapOf("at" to at))
    val rows = listOf(doc("b", 2L), doc("a", 2L), doc("c", null), doc("d", 10.5), doc("e", "text"))
    val ascending = rows.sortedWith(GrpcFirestoreListen.queryOrder(listOf(FirestoreOrder("at"))))
    assertEquals(listOf("c", "a", "b", "d", "e"), ascending.map { it.id })
    val descending = rows.sortedWith(GrpcFirestoreListen.queryOrder(listOf(FirestoreOrder("at", descending = true))))
    assertEquals(listOf("e", "d", "b", "a", "c"), descending.map { it.id })
  }

  /**
   * Against a running Firestore emulator only (AGLYN_LISTEN_EMULATOR=host:port,
   * AGLYN_LISTEN_AUTH=host:port, AGLYN_LISTEN_PROJECT=demo-…, seeded by
   * tools/scripts/seed-native-emulator.mjs): the seeded member's own user
   * document streams under their ID token, and another user's is refused.
   */
  @Test
  fun listenAgainstTheEmulator() = runTest {
    val firestoreHost = System.getenv("AGLYN_LISTEN_EMULATOR") ?: return@runTest
    val authHost = System.getenv("AGLYN_LISTEN_AUTH") ?: return@runTest
    val project = System.getenv("AGLYN_LISTEN_PROJECT") ?: return@runTest
    val auth = IdentityToolkitAuthSession(defaultHttpClient(), "emulator", authHost)
    auth.signInWithEmail("mobile-owner@example.test", "seed-$project-mobile")
    val uid = (auth.state.value as AuthState.SignedIn).user.uid
    val grpc = GrpcFirestoreListen(project, firestoreHost)
    try {
      val token = auth.idToken(true)!!
      val own = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { grpc.document("users/$uid", token).first() }
      assertEquals("mobile-owner@example.test", own?.string("email"))
      val refused = runCatching {
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { grpc.document("users/someone-else", token).first() }
      }.exceptionOrNull()
      assertIs<ListenTargetRemoved>(refused)
      assertEquals(io.grpc.Status.Code.PERMISSION_DENIED, refused.status.code)
      val orgs = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        grpc.query(FirestoreQuery("users/$uid/orgs"), """{"from":[{"collectionId":"orgs"}]}""", token).first()
      }
      assertTrue(orgs.isNotEmpty())
    } finally {
      grpc.close()
    }
  }
}
