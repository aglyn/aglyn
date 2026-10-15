package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.net.URI
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The console hand-off (AGL-3816), as the app makes it: the page it opens, the code it reads back, the trade. */
class ConsoleHandoffTest {
  private val json = headersOf(HttpHeaders.ContentType, "application/json")

  @Test
  fun thePageCarriesAChallengeOnlyThisAppCanAnswer() {
    val pending = ConsoleHandoff.begin("https://app.aglyn.com/", ConsoleHandoff.appRedirectUri(AglynAppId.AGLYN), ConsoleHandoff.Start.SINGLE_SIGN_ON)
    val query = queryParams(pending.url.substringAfter('?'))
    assertTrue(pending.url.startsWith("https://app.aglyn.com/auth/native?"))
    assertEquals("sso", query["start"])
    assertEquals("aglyn://auth/handoff", query["redirect_uri"])
    assertEquals(ConsoleHandoff.challenge(pending.verifier), query["challenge"])
    assertEquals(43, pending.verifier.length)
    assertEquals(pending.state, query["state"])
    assertEquals("aglyn-pos://auth/handoff", ConsoleHandoff.appRedirectUri(AglynAppId.POS))
    // RFC 7636 Appendix B.
    assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", ConsoleHandoff.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
  }

  @Test
  fun theCodeIsReadOnlyFromThisSignInsReturn() {
    val pending = ConsoleHandoff.begin("https://app.aglyn.com", "aglyn://auth/handoff", ConsoleHandoff.Start.SIGN_IN)
    assertEquals("abc", ConsoleHandoff.code("aglyn://auth/handoff?code=abc&state=${pending.state}", pending))
    assertFailsWith<AuthError> { ConsoleHandoff.code("aglyn://auth/handoff?code=abc&state=other", pending) }
    assertTrue(ConsoleHandoff.isReturn("aglyn://auth/handoff?code=abc", "aglyn://auth/handoff"))
    assertTrue(!ConsoleHandoff.isReturn("aglyn://signup?plan=pro", "aglyn://auth/handoff"))
  }

  @Test
  fun theCodeAndVerifierAreTradedForATokenInTheAccountsPool() = runTest {
    val bodies = mutableListOf<String>()
    val http = HttpClient(MockEngine { request ->
      bodies += String(request.body.toByteArray())
      assertNull(request.headers["Authorization"])
      respond("""{"ok":true,"token":"custom","tenantId":"aglyn-org-1"}""", HttpStatusCode.OK, json)
    })
    val api = ConsoleApiClient("https://console.test", http, { null }, sleep = {})
    val pending = ConsoleHandoff.begin("https://console.test", "http://127.0.0.1:5000/handoff", ConsoleHandoff.Start.SIGN_IN)
    assertEquals(ConsoleHandoff.Grant("custom", "aglyn-org-1"), ConsoleHandoff.redeem(api, "abc", pending))
    assertEquals(
      Json.parseToJsonElement("""{"code":"abc","verifier":"${pending.verifier}","redirectUri":"http://127.0.0.1:5000/handoff"}"""),
      Json.parseToJsonElement(bodies[0]),
    )
  }

  @Test
  fun aSpentCodeSaysSo() = runTest {
    val http = HttpClient(MockEngine { respond("""{"error":"That sign-in has expired or was already used. Sign in again."}""", HttpStatusCode.Gone, json) })
    val api = ConsoleApiClient("https://console.test", http, { null }, sleep = {})
    val pending = ConsoleHandoff.begin("https://console.test", "aglyn://auth/handoff", ConsoleHandoff.Start.SIGN_IN)
    val refused = assertFailsWith<AuthError> { ConsoleHandoff.redeem(api, "abc", pending) }
    assertEquals("That sign-in has expired or was already used. Sign in again.", refused.message)
  }

  /** The desktop listens on the loopback address, opens the page with that return, and answers what came back. */
  @Test
  fun theDesktopHearsTheCodeOnItsLoopbackListener() = runBlocking {
    var opened: String? = null
    val loopback = ConsoleLoopback(openBrowser = { url ->
      opened = url
      // The console page's last step: the browser goes to the return address.
      Thread {
        java.net.http.HttpClient.newHttpClient()
          .send(HttpRequest.newBuilder(URI("$url?code=abc&state=s1")).GET().build(), HttpResponse.BodyHandlers.ofString())
      }.start()
    })
    val callback = withContext(Dispatchers.IO) { loopback.run { redirectUri -> redirectUri } }
    assertTrue(opened!!.matches(Regex("http://127\\.0\\.0\\.1:\\d+/handoff")))
    assertEquals("$opened?code=abc&state=s1", callback)
  }

  @OptIn(ExperimentalEncodingApi::class)
  private fun jwt(claims: String) = "h." + Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT).encode(claims.encodeToByteArray()) + ".s"

  /** The desktop exchanges the hand-off's custom token in the pool it was minted in. */
  @Test
  fun theDesktopSignsInWithTheCustomTokenInItsPool() = runTest {
    val bodies = mutableListOf<JsonObject>()
    val token = jwt("""{"user_id":"s1","email":"sso@acme.test","email_verified":true}""")
    val http = HttpClient(MockEngine { request ->
      bodies += Json.parseToJsonElement(String(request.body.toByteArray())) as JsonObject
      respond("""{"idToken":"$token","refreshToken":"good-s","expiresIn":"3600"}""", HttpStatusCode.OK, json)
    })
    val session = IdentityToolkitAuthSession(http, "key", "127.0.0.1:9299", credentials = InMemoryCredentialStore(), credentialKey = "k")
    session.signInWithCustomToken("custom", "aglyn-org-1")
    assertEquals(AuthState.SignedIn(AuthUser("s1", "sso@acme.test", null, emailVerified = true)), session.state.value)
    assertEquals(JsonPrimitive("aglyn-org-1"), bodies[0]["tenantId"])
    assertEquals(JsonPrimitive("custom"), bodies[0]["token"])
  }

  /** The desktop's redemption carries its first App Check token, which the custom-token exchange needs. */
  @Test
  fun theDesktopsRedemptionCarriesItsFirstAppCheckToken() = runTest {
    val http = HttpClient(MockEngine {
      respond("""{"ok":true,"token":"custom","tenantId":null,"appCheckToken":"ac-1","appCheckExpiresAtMs":4200}""", HttpStatusCode.OK, json)
    })
    val api = ConsoleApiClient("https://console.test", http, { null }, sleep = {})
    val pending = ConsoleHandoff.begin("https://console.test", "http://127.0.0.1:5000/handoff", ConsoleHandoff.Start.SIGN_IN)
    assertEquals(ConsoleHandoff.Grant("custom", null, "ac-1", 4200), ConsoleHandoff.redeem(api, "abc", pending))
  }
}
