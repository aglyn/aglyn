package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.utils.io.errors.IOException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class ConsoleApiClientTest {
  private val json = headersOf(HttpHeaders.ContentType, "application/json")

  private class Harness(val responses: MutableList<(String) -> Any>) {
    val seen = mutableListOf<Map<String, String?>>()
    val sleeps = mutableListOf<Long>()
    val tokens = mutableListOf<Boolean>()
  }

  private fun client(harness: Harness, maxAttempts: Int = 3): ConsoleApiClient {
    val engine = MockEngine { request ->
      harness.seen += mapOf(
        "url" to request.url.toString(),
        "method" to request.method.value,
        "auth" to request.headers["Authorization"],
        "key" to request.headers["Idempotency-Key"],
      )
      when (val next = harness.responses.removeAt(0)(request.url.encodedPath)) {
        is Throwable -> throw next
        is Pair<*, *> -> respond(next.second as String, HttpStatusCode.fromValue(next.first as Int), json)
        else -> respondError(HttpStatusCode.InternalServerError)
      }
    }
    return ConsoleApiClient(
      origin = "https://app.example.com/",
      http = HttpClient(engine) { expectSuccess = false },
      getIdToken = { force -> harness.tokens += force; if (force) "fresh" else "stale" },
      sleep = { harness.sleeps += it },
      maxAttempts = maxAttempts,
    )
  }

  @Test
  fun sendsTheBearerAndReturnsTheBody() = runTest {
    val harness = Harness(mutableListOf({ _ -> 200 to """{"ok":true}""" }))
    val body = client(harness).request("/api/things", query = mapOf("a b" to "c&d", "skip" to null))
    assertEquals(JsonPrimitive(true), body!!.jsonObject["ok"])
    assertEquals("https://app.example.com/api/things?a%20b=c%26d", harness.seen[0]["url"])
    assertEquals("Bearer stale", harness.seen[0]["auth"])
  }

  @Test
  fun refreshesTheTokenOnceOnA401() = runTest {
    val harness = Harness(mutableListOf({ _ -> 401 to "{}" }, { _ -> 200 to "{}" }))
    client(harness).request("/api/things")
    assertEquals(listOf(false, true), harness.tokens)
    assertEquals("Bearer fresh", harness.seen[1]["auth"])
    assertEquals(emptyList(), harness.sleeps)
  }

  @Test
  fun aSecond401IsAnAnswer() = runTest {
    val harness = Harness(mutableListOf({ _ -> 401 to "{}" }, { _ -> 401 to "{}" }))
    val error = assertFailsWith<ConsoleApiError> { client(harness).request("/api/things") }
    assertEquals(401, error.status)
    assertEquals("Your session ended. Sign in again.", error.message)
  }

  @Test
  fun retriesAGetOn503WithBackoff() = runTest {
    val harness = Harness(mutableListOf({ _ -> 503 to "{}" }, { _ -> 502 to "{}" }, { _ -> 200 to "{}" }))
    client(harness).request("/api/things")
    assertEquals(listOf(400L, 800L), harness.sleeps)
  }

  @Test
  fun neverRetriesAPostWithoutAnIdempotencyKey() = runTest {
    val harness = Harness(mutableListOf({ _ -> 503 to """{"error":"Busy."}""" }))
    val error = assertFailsWith<ConsoleApiError> {
      client(harness).request("/api/things", method = ApiMethod.POST, body = buildJsonObject { put("a", 1) })
    }
    assertEquals("Busy.", error.message)
    assertEquals(1, harness.seen.size)
  }

  @Test
  fun retriesAnIdempotentPostOnANetworkError() = runTest {
    val harness = Harness(mutableListOf({ _ -> IOException("offline") }, { _ -> 200 to "{}" }))
    client(harness).request("/api/things", method = ApiMethod.POST, idempotencyKey = "k1")
    assertEquals("k1", harness.seen[1]["key"])
    assertEquals(listOf(400L), harness.sleeps)
  }

  @Test
  fun reportsAnUnreachableConsole() = runTest {
    val harness = Harness(MutableList(3) { { _: String -> IOException("offline") } })
    val error = assertFailsWith<ConsoleApiError> { client(harness).request("/api/things") }
    assertEquals(0, error.status)
    assertEquals("Aglyn could not be reached. Check the connection and try again.", error.message)
  }

  @Test
  fun anonymousCallsCarryNoBearer() = runTest {
    val harness = Harness(mutableListOf({ _ -> 200 to "" }))
    assertNull(client(harness).request("/api/public", anonymous = true))
    assertNull(harness.seen[0]["auth"])
    assertEquals(emptyList(), harness.tokens)
  }

  @Test
  fun refusesAPathThatIsNotAConsolePath() = runTest {
    assertFailsWith<IllegalArgumentException> { client(Harness(mutableListOf())).urlFor("//evil.example/x") }
  }

  @Test
  fun errorMessagesMatchTheConsole() {
    assertEquals("You do not have permission to do that.", ConsoleApiClient.consoleErrorMessage(403, null))
    assertEquals("That was not found.", ConsoleApiClient.consoleErrorMessage(404, null))
    assertEquals("Aglyn could not be reached. Try again in a moment.", ConsoleApiClient.consoleErrorMessage(500, null))
    assertEquals("That did not work. Try again.", ConsoleApiClient.consoleErrorMessage(409, null))
    assertEquals("Nope", ConsoleApiClient.consoleErrorMessage(409, buildJsonObject { put("message", "Nope") }))
  }
}
