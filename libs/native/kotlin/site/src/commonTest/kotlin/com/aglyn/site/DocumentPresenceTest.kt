// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site

import com.aglyn.core.ConsoleApiClient
import com.aglyn.site.pages.PresenceSummary
import com.aglyn.site.pages.PresentPerson
import com.aglyn.site.pages.fetchPresenceSummary
import com.aglyn.site.pages.presenceChipSentence
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

class DocumentPresenceTest {
  private fun client(status: HttpStatusCode, answer: String, seen: MutableList<String> = mutableListOf()) = ConsoleApiClient(
    origin = "https://console.test/",
    http = HttpClient(
      MockEngine { request ->
        val text = (request.body as? OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
        seen += Json.parseToJsonElement(text).jsonObject["hostId"]?.jsonPrimitive?.content.orEmpty()
        respond(answer, status, headersOf(HttpHeaders.ContentType, "application/json"))
      },
    ),
    getIdToken = { "t" },
    sleep = {},
    maxAttempts = 1,
  )

  @Test
  fun readsWhoIsInEachDocument() = runTest {
    val seen = mutableListOf<String>()
    val summary = fetchPresenceSummary(
      client(
        HttpStatusCode.OK,
        """{"summary":{"screen":{"about":[{"uid":"u1","displayName":"Sam Lee"},{"uid":"u2","displayName":"Ana","photoURL":"https://x/p.png"}],"empty":[]},"layout":{"main":[{"uid":"u3","displayName":""}]}}}""",
        seen,
      ),
      "h",
    )
    assertEquals(listOf("h"), seen)
    assertEquals(listOf(PresentPerson("u1", "Sam Lee"), PresentPerson("u2", "Ana", "https://x/p.png")), summary.people("screen", "about"))
    assertEquals(emptyList(), summary.people("screen", "empty"))
    assertEquals(emptyList(), summary.people("layout", "main"), "a row without a name is not a person")
    assertEquals(emptyList(), summary.people("screen", "nobody"))
  }

  @Test
  fun failsToNothing() = runTest {
    assertEquals(PresenceSummary(), fetchPresenceSummary(client(HttpStatusCode.Forbidden, """{"error":"Not a member"}"""), "h"))
  }

  @Test
  fun theSentenceIsHedgedAboutTheVersion() {
    assertEquals("Sam is in this document right now — possibly in a different version.", presenceChipSentence(listOf("Sam")))
    assertEquals(
      "Sam, Ana and Lee are in this document right now — possibly in a different version.",
      presenceChipSentence(listOf("Sam", "Ana", "Lee")),
    )
  }
}
