// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site

import com.aglyn.core.ConsoleApiClient
import com.aglyn.site.media.MediaEmbeddedApi
import com.aglyn.site.media.MediaEmbeddedField
import com.aglyn.site.media.MediaEmbeddedRecord
import com.aglyn.site.media.MediaScope
import com.aglyn.site.media.embeddedFieldDisplay
import com.aglyn.site.media.embeddedMetadataReadable
import com.aglyn.site.media.parseEmbeddedDate
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MediaEmbeddedTest {
  private val stored: Map<String, Any?> = mapOf(
    "version" to 1L, "format" to "jpeg", "writable" to true, "contentSha256" to "abc",
    "fields" to listOf(
      mapOf("key" to "make", "label" to "Camera make", "group" to "capture", "value" to "Canon", "editable" to true),
      mapOf("key" to "gps", "label" to "Location", "group" to "location", "value" to "41.8781,-87.6298", "editable" to true),
      mapOf("key" to "keywords", "label" to "Keywords", "group" to "description", "values" to listOf("cake", "wedding"), "editable" to true),
    ),
  )

  @Test
  fun readsTheStoredRecordAndGroupsItInTheConsolesOrder() {
    val record = assertNotNull(MediaEmbeddedRecord.from(stored))
    assertEquals(listOf("Description", "Location", "Camera"), record.groups.map { it.first })
    assertEquals("41.8781,-87.6298", record.gps?.value)
    assertTrue(record.isCurrent("abc"))
    assertFalse(record.isCurrent("replaced"))
    assertFalse(assertNotNull(MediaEmbeddedRecord.from(stored + ("version" to 0L))).isCurrent("abc"))
    assertNull(MediaEmbeddedRecord.from(mapOf("version" to 1L)))
  }

  @Test
  fun dressesValuesAsTheConsoleDoes() {
    assertEquals("41.87810° N, 87.62980° W", embeddedFieldDisplay(MediaEmbeddedField("gps", "Location", "location", "41.8781,-87.6298")))
    assertEquals("★★★☆☆", embeddedFieldDisplay(MediaEmbeddedField("rating", "Rating", "description", "3")))
    assertEquals("Rejected", embeddedFieldDisplay(MediaEmbeddedField("rating", "Rating", "description", "-1")))
    assertEquals("a, b", embeddedFieldDisplay(MediaEmbeddedField("keywords", "Keywords", "description", values = listOf("a", "b"))))
    assertEquals("May 1, 2026", embeddedFieldDisplay(MediaEmbeddedField("createdAt", "Taken", "capture", "2026-05-01"), "UTC"))
    assertEquals(1777645800000L, parseEmbeddedDate("2026-05-01T14:30:00Z"))
    assertEquals(1777645800000L, parseEmbeddedDate("2026-05-01T14:30:00", "UTC"))
    assertEquals("soon", embeddedFieldDisplay(MediaEmbeddedField("createdAt", "Taken", "capture", "soon")))
  }

  @Test
  fun onlyFormatsWithAReaderAreRead() {
    assertTrue(embeddedMetadataReadable("image/jpeg"))
    assertTrue(embeddedMetadataReadable("IMAGE/PNG; charset=binary"))
    assertFalse(embeddedMetadataReadable("audio/mpeg"))
  }

  @Test
  fun removeLocationWritesANullGpsNamingTheDigestItWasShown() = runTest {
    val sent = mutableListOf<JsonObject>()
    val client = ConsoleApiClient(
      origin = "https://console.test/",
      http = HttpClient(
        MockEngine { request ->
          sent += Json.parseToJsonElement((request.body as? OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()).jsonObject
          respond(
            """{"embeddedMetadata":{"version":1,"format":"jpeg","writable":true,"fields":[]},"contentSha256":"def"}""",
            HttpStatusCode.OK,
            headersOf(HttpHeaders.ContentType, "application/json"),
          )
        },
      ),
      getIdToken = { "t" },
      sleep = {},
      maxAttempts = 1,
    )
    val answer = MediaEmbeddedApi(client, MediaScope.Site("h")).removeLocation("m", "abc")
    assertFalse(answer.unchanged)
    assertEquals(emptyList(), answer.record?.fields)
    val body = sent.single()
    assertEquals("h", body["hostId"]?.jsonPrimitive?.content)
    assertEquals("m", body["mediaId"]?.jsonPrimitive?.content)
    assertEquals("write", body["action"]?.jsonPrimitive?.content)
    assertEquals("abc", body["expectedSha256"]?.jsonPrimitive?.content)
    assertEquals(JsonNull, body["patch"]?.jsonObject?.get("gps"))
  }
}
