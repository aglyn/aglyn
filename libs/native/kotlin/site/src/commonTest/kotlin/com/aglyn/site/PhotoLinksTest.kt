// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site

import com.aglyn.core.ConsoleApiClient
import com.aglyn.site.media.FreshPhotoLink
import com.aglyn.site.media.PhotoLinkList
import com.aglyn.site.media.PhotoLinkRow
import com.aglyn.site.media.PhotoLinksApi
import com.aglyn.site.media.PhotoLinksModel
import com.aglyn.site.media.photoCount
import com.aglyn.site.media.photoLinkCaption
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
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PhotoLinksTest {
  private class Route(answers: List<Pair<Int, String>>) {
    val sent = mutableListOf<Pair<String, JsonObject>>()
    private val queue = ArrayDeque(answers)
    val api = PhotoLinksApi(
      ConsoleApiClient(
        origin = "https://console.test/",
        http = HttpClient(
          MockEngine { request ->
            val text = (request.body as? OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
            sent += request.url.encodedPath to Json.parseToJsonElement(text).jsonObject
            val (status, body) = queue.removeFirstOrNull() ?: (200 to "{}")
            respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, "application/json"))
          },
        ),
        getIdToken = { "t" },
        sleep = {},
        maxAttempts = 1,
      ),
      "h",
    )
  }

  @Test
  fun listsTheOpenLinksAsTheRouteAnswersThem() = runTest {
    val route = Route(
      listOf(200 to """{"links":[{"linkId":"a","state":"live","createdAt":1763251200000,"expiresAt":1763856000000,"uploads":1,"bytes":9,"remainingUploads":39,"remainingBytes":1}]}"""),
    )
    val rows = route.api.list()
    assertEquals("/api/media/photo-links", route.sent.single().first)
    assertEquals("list", route.sent.single().second["action"]?.jsonPrimitive?.content)
    assertEquals("h", route.sent.single().second["hostId"]?.jsonPrimitive?.content)
    assertEquals(listOf(PhotoLinkRow("a", 1763251200000, 1763856000000, 1, 39)), rows)
    assertTrue(rows.single().title.endsWith("· 1 photo received"))
    assertTrue(rows.single().until.startsWith("Works until "))
  }

  @Test
  fun makesAndRevokesALink() = runTest {
    val route = Route(listOf(200 to """{"linkId":"b","url":"https://app.test/p/b#s","expiresAt":1763856000000,"folderId":"f"}""", 200 to """{"ok":true}"""))
    assertEquals(FreshPhotoLink("b", "https://app.test/p/b#s", 1763856000000), route.api.create())
    route.api.revoke("b")
    assertEquals(listOf("create", "revoke"), route.sent.map { it.second["action"]?.jsonPrimitive?.content })
    assertEquals("b", route.sent.last().second["linkId"]?.jsonPrimitive?.content)
  }

  @Test
  fun captionSaysHowLongAndHowManyOnceTheRowIsIn() {
    val day = 86_400_000L
    val fresh = FreshPhotoLink("b", "u", 7 * day)
    assertEquals("Works for 7 days. Photos land in the folder “From the owner”.", photoLinkCaption(fresh, null, 0))
    assertEquals(
      "Works for 7 days and takes up to 40 photos. Photos land in the folder “From the owner”.",
      photoLinkCaption(fresh, PhotoLinkRow("b", 0, 7 * day, 0, 40), 0),
    )
    assertTrue(photoLinkCaption(FreshPhotoLink("b", "u", 3_600_000), null, 0).startsWith("Works for 1 day."))
    assertEquals("1 photo", photoCount(1))
  }

  @Test
  fun aMemberRefusedOutrightCannotMakeALinkEither() = runTest {
    val locked = PhotoLinksModel(Route(listOf(423 to """{"error":"This site is locked."}""")).api)
    locked.refresh()
    assertEquals(PhotoLinkList.Failed("This site is locked.", blocked = true), locked.list)
    assertTrue(locked.blocked)
    val broken = PhotoLinksModel(Route(listOf(500 to """{"error":"Photo link failed"}""")).api)
    broken.refresh()
    assertEquals(PhotoLinkList.Failed("The photo links could not be loaded.", blocked = false), broken.list)
    assertFalse(broken.blocked)
  }

  @Test
  fun revokingTheFreshLinkHidesItsCode() = runTest {
    val model = PhotoLinksModel(
      Route(
        listOf(
          200 to """{"linkId":"b","url":"https://app.test/p/b#s","expiresAt":1763856000000}""",
          200 to """{"links":[{"linkId":"b","createdAt":1,"expiresAt":1763856000000,"uploads":0,"remainingUploads":40}]}""",
          200 to """{"ok":true}""",
          200 to """{"links":[]}""",
        ),
      ).api,
    )
    model.create()
    assertEquals("b", model.fresh?.id)
    assertEquals(40, model.freshRow?.remainingUploads)
    model.revoke(model.freshRow!!)
    assertNull(model.fresh)
    assertEquals(PhotoLinkList.Ready(emptyList()), model.list)
    assertEquals("Link revoked", model.notice?.first)
  }
}
