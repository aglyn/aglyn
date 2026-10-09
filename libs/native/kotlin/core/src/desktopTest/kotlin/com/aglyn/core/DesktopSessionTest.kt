package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DesktopSessionTest {
  private val json = headersOf(HttpHeaders.ContentType, "application/json")

  /** The Auth emulator's answers: a refresh token `good-*` refreshes; anything else is refused. */
  private fun http(calls: MutableList<String> = mutableListOf()) = HttpClient(MockEngine { request ->
    val path = request.url.encodedPath
    calls += path.substringAfterLast('/')
    when {
      path.endsWith("/v1/token") -> {
        val form = String(request.body.toByteArray())
        if ("refresh_token=good-" in form) {
          respond("""{"id_token":"id-2","refresh_token":"good-rotated","expires_in":"3600","user_id":"u1"}""", HttpStatusCode.OK, json)
        } else {
          respond("""{"error":{"message":"INVALID_REFRESH_TOKEN"}}""", HttpStatusCode.BadRequest, json)
        }
      }
      path.endsWith("accounts:lookup") ->
        respond("""{"users":[{"localId":"u1","email":"dana@example.test","displayName":"Dana"}]}""", HttpStatusCode.OK, json)
      path.endsWith("accounts:signInWithPassword") ->
        respond("""{"idToken":"id-1","refreshToken":"good-1","expiresIn":"3600","localId":"u1","email":"dana@example.test"}""", HttpStatusCode.OK, json)
      path.endsWith("accounts:update") ->
        respond("""{"idToken":"id-3","refreshToken":"good-3","expiresIn":"3600"}""", HttpStatusCode.OK, json)
      else -> respond("", HttpStatusCode.NotFound)
    }
  })

  @Test
  fun windowsGetsCredentialManagerAndEverythingElseMemory() {
    val windows = InMemoryCredentialStore()
    assertTrue(CredentialStores.forOs("Windows 11") { windows } === windows)
    assertIs<InMemoryCredentialStore>(CredentialStores.forOs("Mac OS X") { error("not on a Mac") })
    assertIs<InMemoryCredentialStore>(CredentialStores.forOs("Linux") { error("not on Linux") })
    // Credential Manager that cannot load leaves the session in memory rather than failing the launch.
    assertIs<InMemoryCredentialStore>(CredentialStores.forOs("Windows Server 2025") { throw UnsatisfiedLinkError("no Advapi32") })
  }

  @Test
  fun signingInKeepsTheRefreshTokenAndSigningOutForgetsIt() = runTest {
    val store = InMemoryCredentialStore()
    val session = IdentityToolkitAuthSession(http(), "key", "127.0.0.1:9299", credentials = store, credentialKey = "k")
    assertEquals(AuthState.SignedOut, session.state.value)
    session.signInWithEmail("dana@example.test", "pw")
    assertEquals("good-1", store.read("k"))
    session.signOut()
    assertNull(store.read("k"))
  }

  @Test
  fun aPasswordChangeProvesTheCurrentOneThenReplacesTheTokens() = runTest {
    val store = InMemoryCredentialStore()
    val calls = mutableListOf<String>()
    val session = IdentityToolkitAuthSession(http(calls), "key", "127.0.0.1:9299", credentials = store, credentialKey = "k")
    session.signInWithEmail("dana@example.test", "old")
    session.changePassword("old", "a-much-longer-new-one")
    assertEquals(listOf("accounts:signInWithPassword", "accounts:signInWithPassword", "accounts:update"), calls)
    assertEquals("good-3", store.read("k"))
    assertEquals("id-3", session.idToken())
  }

  @Test
  fun aDisplayNameChangeIsKeptOnTheSignedInUser() = runTest {
    val session = IdentityToolkitAuthSession(http(), "key", "127.0.0.1:9299", credentials = InMemoryCredentialStore(), credentialKey = "k")
    session.signInWithEmail("dana@example.test", "pw")
    session.updateDisplayName("Dana Scully")
    assertEquals(AuthState.SignedIn(AuthUser("u1", "dana@example.test", "Dana Scully")), session.state.value)
  }

  @Test
  fun aPasswordChangeNeedsASignedInPerson() = runTest {
    val session = IdentityToolkitAuthSession(http(), "key", null, credentials = InMemoryCredentialStore(), credentialKey = "k")
    val error = runCatching { session.changePassword("a", "b") }.exceptionOrNull()
    assertIs<AuthError>(error)
  }

  @Test
  fun aKeptTokenRestoresTheSessionAndARotatedOneIsKept() = runTest {
    val store = InMemoryCredentialStore().apply { write("k", "good-1") }
    val calls = mutableListOf<String>()
    val session = IdentityToolkitAuthSession(http(calls), "key", "127.0.0.1:9299", credentials = store, credentialKey = "k")
    assertEquals(AuthState.Restoring, session.state.value)
    session.restore()
    assertEquals(AuthState.SignedIn(AuthUser("u1", "dana@example.test", "Dana")), session.state.value)
    assertEquals("id-2", session.idToken())
    assertEquals("good-rotated", store.read("k"))
    assertEquals(listOf("token", "accounts:lookup"), calls)
  }

  @Test
  fun aRefusedKeptTokenIsForgotten() = runTest {
    val store = InMemoryCredentialStore().apply { write("k", "revoked") }
    val session = IdentityToolkitAuthSession(http(), "key", "127.0.0.1:9299", credentials = store, credentialKey = "k")
    session.restore()
    assertEquals(AuthState.SignedOut, session.state.value)
    assertNull(store.read("k"))
  }

  @Test
  fun anUncheckableKeptTokenIsKeptForTheNextLaunch() = runTest {
    val store = InMemoryCredentialStore().apply { write("k", "good-1") }
    val offline = HttpClient(MockEngine { throw java.io.IOException("offline") })
    val session = IdentityToolkitAuthSession(offline, "key", null, credentials = store, credentialKey = "k")
    session.restore()
    assertEquals(AuthState.SignedOut, session.state.value)
    assertEquals("good-1", store.read("k"))
  }
}
