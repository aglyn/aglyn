package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.get
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** The Windows build's console-minted App Check (AGL-3816). */
class ConsoleMintedAppCheckTest {
  private val json = headersOf(HttpHeaders.ContentType, "application/json")

  private class Clock(var now: Long = 1_000_000)

  private fun provider(
    clock: Clock,
    answers: MutableList<Pair<HttpStatusCode, String>>,
    seen: MutableList<Pair<String?, String?>> = mutableListOf(),
  ) = ConsoleMintedAppCheck(
    HttpClient(MockEngine { request ->
      seen += request.headers["Authorization"] to request.headers["X-Aglyn-Device"]
      delay(10)
      val (status, body) = if (answers.isEmpty()) HttpStatusCode.OK to """{"token":"t-x","expiresAtMs":0}""" else answers.removeAt(0)
      respond(body, status, json)
    }),
    "https://console.test/",
    "install-1",
    now = { clock.now },
  )

  @Test
  fun theHandOffsTokenIsUsedUntilHalfItsLifeThenAFreshOneIsMinted() = runTest {
    val clock = Clock()
    val seen = mutableListOf<Pair<String?, String?>>()
    val appCheck = provider(clock, mutableListOf(HttpStatusCode.OK to """{"ok":true,"token":"t-2","expiresAtMs":${clock.now + 3_600_000}}"""), seen)
    appCheck.idToken = { "id-1" }
    appCheck.seed("t-1", clock.now + 3_600_000)
    assertEquals("t-1", appCheck.token(false))
    clock.now += 1_799_000
    assertEquals("t-1", appCheck.token(false))
    assertEquals(0, seen.size)
    clock.now += 2_000
    assertEquals("t-2", appCheck.token(false))
    assertEquals(listOf<Pair<String?, String?>>("Bearer id-1" to "install-1"), seen)
  }

  @Test
  fun concurrentCallersShareOneMint() = runTest {
    val clock = Clock()
    val seen = mutableListOf<Pair<String?, String?>>()
    val appCheck = provider(clock, mutableListOf(HttpStatusCode.OK to """{"token":"t-1","expiresAtMs":${clock.now + 3_600_000}}"""), seen)
    appCheck.idToken = { "id-1" }
    val tokens = (1..5).map { async { appCheck.token(false) } }.awaitAll()
    assertEquals(List(5) { "t-1" }, tokens)
    assertEquals(1, seen.size)
  }

  @Test
  fun nothingOutlivesSignOutOrARevokedSession() = runTest {
    val clock = Clock()
    val appCheck = provider(clock, mutableListOf(HttpStatusCode.Unauthorized to """{"error":"Sign in again"}"""))
    appCheck.idToken = { "revoked" }
    appCheck.seed("t-1", clock.now + 3_600_000)
    // A forced refresh against a revoked session drops the token rather than keeping it.
    assertNull(appCheck.token(true))
    appCheck.seed("t-1", clock.now + 3_600_000)
    appCheck.clear()
    appCheck.idToken = { null }
    assertNull(appCheck.token(false))
  }

  /** Firebase refusing the token in hand gets one more try with a fresh one. */
  @Test
  fun aRefusedTokenIsReplacedAndTheCallTriedOnce() = runTest {
    val clock = Clock()
    val appCheck = provider(clock, mutableListOf(HttpStatusCode.OK to """{"token":"t-2","expiresAtMs":${clock.now + 3_600_000}}"""))
    appCheck.idToken = { "id-1" }
    appCheck.seed("t-1", clock.now + 3_600_000)
    val sent = mutableListOf<String?>()
    val firebase = HttpClient(MockEngine { request ->
      sent += request.headers[APP_CHECK_HEADER]
      if (request.headers[APP_CHECK_HEADER] == "t-1") {
        respond("""{"error":{"code":401,"message":"Firebase App Check token is invalid."}}""", HttpStatusCode.Unauthorized, json)
      } else {
        respond("{}", HttpStatusCode.OK, json)
      }
    }).withAppCheck(appCheck)
    val response = firebase.get("https://identitytoolkit.googleapis.com/v1/accounts:lookup")
    assertEquals(200, response.status.value)
    assertEquals(listOf<String?>("t-1", "t-2"), sent)
  }
}
