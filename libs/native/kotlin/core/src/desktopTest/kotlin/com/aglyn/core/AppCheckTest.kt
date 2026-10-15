package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.get
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AppCheckTest {
  private val json = headersOf(HttpHeaders.ContentType, "application/json")

  private class Tokens(private val token: String?) : AppCheckTokenProvider {
    var calls = 0
    override suspend fun token(forceRefresh: Boolean): String? = token.also { calls++ }
  }

  @Test
  fun onlyFirebaseApisOverHttpsTakeTheToken() {
    assertTrue(isFirebaseApi("https", "identitytoolkit.googleapis.com"))
    assertTrue(isFirebaseApi("https", "securetoken.googleapis.com"))
    assertTrue(isFirebaseApi("https", "firestore.googleapis.com"))
    assertTrue(isFirebaseApi("https", "us-central1-p.cloudfunctions.net"))
    assertFalse(isFirebaseApi("https", "app.aglyn.com"))
    assertFalse(isFirebaseApi("https", "oauth2.googleapis.com"))
    assertFalse(isFirebaseApi("http", "identitytoolkit.googleapis.com"))
  }

  @Test
  fun theHeaderRidesFirebaseCallsAndNothingElse() = runTest {
    val seen = mutableMapOf<String, String?>()
    val http = HttpClient(MockEngine { request ->
      seen[request.url.host] = request.headers[APP_CHECK_HEADER]
      respond("{}", HttpStatusCode.OK, json)
    }).withAppCheck(Tokens("t1"))
    http.get("https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/a/b")
    http.get("https://app.aglyn.com/api/me")
    assertEquals("t1", seen["firestore.googleapis.com"])
    assertNull(seen["app.aglyn.com"])
  }

  @Test
  fun noProviderLeavesTheClientAsItIs() {
    val http = HttpClient(MockEngine { respond("{}") })
    assertTrue(http.withAppCheck(NoAppCheck) === http)
  }

  @Test
  fun aRefusalForTheTokenSaysSoPlainly() = runTest {
    val http = HttpClient(MockEngine {
      respond(
        """{"error":{"code":401,"message":"Firebase App Check token is invalid.","status":"UNAUTHENTICATED"}}""",
        HttpStatusCode.Unauthorized, json,
      )
    })
    val session = IdentityToolkitAuthSession(http, "key", null, credentials = InMemoryCredentialStore(), credentialKey = "k")
    val error = assertFailsWith<AuthError> { session.signInWithEmail("dana@example.test", "pw") }
    assertEquals(APP_CHECK_REFUSAL_MESSAGE, error.message)
    assertEquals(APP_CHECK_REFUSED, appCheckRefusalCode(RuntimeException("wrapped", Exception("Firebase App Check token is invalid."))))
    assertNull(appCheckRefusalCode(RuntimeException("INVALID_LOGIN_CREDENTIALS")))
  }
}
