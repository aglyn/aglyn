package com.aglyn.site

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.Live
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import com.aglyn.site.content.ContentApi
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

class EntryPreviewLinkTest {
  @Test
  fun asksTheConsoleToSignAPreviewLinkForTheEntry() = runTest {
    val seen = mutableListOf<Pair<String, JsonObject>>()
    val client = ConsoleApiClient(
      origin = "https://console.test/",
      http = HttpClient(
        MockEngine { request ->
          val text = (request.body as? OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
          seen += request.url.encodedPath to Json.parseToJsonElement(text).jsonObject
          respond("""{"url":"https://shop.aglyn.app/blog/hello?aglyn_preview=sig","expiresAtMs":1}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        },
      ),
      getIdToken = { "t" },
      sleep = {},
      maxAttempts = 1,
    )
    val writer = object : FirestoreWriter {
      override suspend fun merge(path: String, data: Map<String, Any?>) = Unit
    }
    val reader = object : FirestoreReader {
      override suspend fun get(path: String): FirestoreDoc? = null
      override suspend fun page(query: FirestoreQuery) = FirestorePage(emptyList(), null)
      override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = flowOf(Live.Ready(null))
      override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = flowOf(Live.Ready(emptyList()))
    }
    val url = ContentApi(client, writer, reader, "h").previewLink("blog", "hello")
    assertEquals("https://shop.aglyn.app/blog/hello?aglyn_preview=sig", url)
    assertEquals("/api/content/preview-link", seen.single().first)
    assertEquals("blog", seen.single().second["collectionSlug"]?.jsonPrimitive?.content)
    assertEquals("hello", seen.single().second["entrySlug"]?.jsonPrimitive?.content)
    assertEquals("h", seen.single().second["hostId"]?.jsonPrimitive?.content)
  }
}
