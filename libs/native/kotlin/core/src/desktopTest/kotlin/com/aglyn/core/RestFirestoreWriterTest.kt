package com.aglyn.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class RestFirestoreWriterTest {
  @Test
  fun aMergeIsAPatchMaskedToItsLeaves() = runTest {
    var seen: io.ktor.client.request.HttpRequestData? = null
    var body = ""
    val http = HttpClient(MockEngine { request ->
      seen = request
      body = String(request.body.toByteArray())
      respond("{}", HttpStatusCode.OK)
    })
    val rest = RestFirestoreReader(http, "demo-x", "127.0.0.1:8289", { "id-token" })
    rest.merge("users/u1", accountPushWrite("content.order", true))
    val request = seen!!
    assertEquals(HttpMethod.Patch, request.method)
    assertEquals("Bearer id-token", request.headers["Authorization"])
    assertEquals("/v1/projects/demo-x/databases/(default)/documents/users/u1", request.url.encodedPath.replace("%28", "(").replace("%29", ")"))
    assertEquals(listOf("notificationSettings.accountTypes.`content.order`.push"), request.url.parameters.getAll("updateMask.fieldPaths"))
    val fields = Json.parseToJsonElement(body).jsonObject.getValue("fields").jsonObject
    assertEquals(
      """{"mapValue":{"fields":{"accountTypes":{"mapValue":{"fields":{"content.order":{"mapValue":{"fields":{"push":{"booleanValue":true}}}}}}}}}}""",
      fields.getValue("notificationSettings").toString(),
    )
  }

  @Test
  fun aDeletedFieldIsMaskedButNotSentAndATimestampIsATimestamp() = runTest {
    var seen: io.ktor.client.request.HttpRequestData? = null
    var body = ""
    val http = HttpClient(MockEngine { request ->
      seen = request
      body = String(request.body.toByteArray())
      respond("{}", HttpStatusCode.OK)
    })
    val rest = RestFirestoreReader(http, "demo-x", null, { "id-token" })
    rest.merge("hosts/h1/redirects/r1", mapOf("enabled" to false, "externalDestinationApprovedBy" to FirestoreDelete, "updatedAt" to FirestoreTimestamp(1_700_000_000, 5)))
    assertEquals(listOf("enabled", "externalDestinationApprovedBy", "updatedAt"), seen!!.url.parameters.getAll("updateMask.fieldPaths"))
    val fields = Json.parseToJsonElement(body).jsonObject.getValue("fields").jsonObject
    assertEquals(setOf("enabled", "updatedAt"), fields.keys)
    assertEquals("""{"timestampValue":"2023-11-14T22:13:20.000000005Z"}""", fields.getValue("updatedAt").toString())
  }

  /** A polled read re-reads as soon as this reader writes: a screen shows its own save at once (AGL-3971). */
  @Test
  fun aWriteReReadsAPolledObservationAtOnce() = kotlinx.coroutines.runBlocking {
    var reads = 0
    val http = HttpClient(MockEngine { request ->
      if (request.method == HttpMethod.Get) reads += 1
      respond("""{"name":"projects/demo-x/databases/(default)/documents/orgs/o1/contactFields/f1","fields":{}}""", HttpStatusCode.OK)
    })
    // A minute between polls: only the write can bring the second read in time.
    val rest = RestFirestoreReader(http, "demo-x", null, { "id-token" }, refreshMillis = 60_000)
    val seen = kotlinx.coroutines.flow.MutableStateFlow(0)
    val job = launch { rest.observeDoc("orgs/o1/contactFields/f1").collect { if (it is Live.Ready) seen.value += 1 } }
    kotlinx.coroutines.withTimeout(5_000) { seen.first { it >= 1 } }
    rest.merge("orgs/o1/contactFields/f1", mapOf("label" to "Budget"))
    kotlinx.coroutines.withTimeout(5_000) { seen.first { it >= 2 } }
    job.cancel()
    assertEquals(2, reads)
  }

  @Test
  fun aRefusedMergeSaysWhy() = runTest {
    val http = HttpClient(MockEngine { respond("""{"error":{"message":"Missing or insufficient permissions."}}""", HttpStatusCode.Forbidden) })
    val rest = RestFirestoreReader(http, "demo-x", null, { "id-token" })
    val error = assertFailsWith<IllegalStateException> { rest.merge("users/u2", accountPushWrite("content.order", true)) }
    assertEquals("Missing or insufficient permissions.", error.message)
  }
}
