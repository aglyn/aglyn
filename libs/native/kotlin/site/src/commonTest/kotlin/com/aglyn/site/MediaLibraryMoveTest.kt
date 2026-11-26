package com.aglyn.site

import com.aglyn.core.ConsoleApiClient
import com.aglyn.site.media.MEDIA_LIBRARY_MOVE_ROUNDS
import com.aglyn.site.media.MediaApi
import com.aglyn.site.media.MediaLibraryDirection
import com.aglyn.site.media.MediaLibraryMoveOutcome
import com.aglyn.site.media.MediaLibraryNotMoved
import com.aglyn.site.media.MediaLibraryPreview
import com.aglyn.site.media.MediaScope
import com.aglyn.site.media.mediaLibraryDirection
import com.aglyn.site.media.mediaLibraryMoveBody
import com.aglyn.site.media.mediaLibraryMoveReport
import com.aglyn.site.media.mediaLibraryRefusedHeading
import com.aglyn.site.media.mediaLibraryRefusedLine
import com.aglyn.site.media.moveToOtherLibraryConfirm
import com.aglyn.site.media.moveToOtherLibraryIntro
import com.aglyn.site.media.moveToOtherLibraryLabel
import com.aglyn.site.media.movedToOtherLibraryMessage
import com.aglyn.site.media.partialOtherLibraryMessage
import com.aglyn.ui.StatusTone
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
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Moving files between a site's library and the organization library (AGL-4254): the body, the loop and the words. */
class MediaLibraryMoveTest {
  private fun client(answers: MutableList<String>, bodies: MutableList<JsonObject>, paths: MutableList<String> = mutableListOf()) = ConsoleApiClient(
    origin = "https://console.test/",
    http = HttpClient(
      MockEngine { request ->
        paths += request.url.encodedPath
        bodies += Json.parseToJsonElement((request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()).jsonObject
        val next = answers.removeFirstOrNull() ?: "{}"
        if (next == "500") return@MockEngine respond("""{"error":"Move failed"}""", HttpStatusCode.InternalServerError, headersOf(HttpHeaders.ContentType, "application/json"))
        respond(next, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
      },
    ),
    getIdToken = { "t" },
    sleep = {},
    maxAttempts = 1,
  )

  @Test
  fun goesToTheOtherLibraryOnlyWhereASiteIsKnown() {
    assertEquals(MediaLibraryDirection.TO_ORG, mediaLibraryDirection(MediaScope.Site("h1")))
    assertEquals(MediaLibraryDirection.TO_SITE, mediaLibraryDirection(MediaScope.Org("o1", "h1")))
    // The workspace's own library page has no site to move into.
    assertNull(mediaLibraryDirection(MediaScope.Org("o1", null)))
  }

  @Test
  fun namesBothLibrariesTheDirectionAndPreviewOnlyWhenAsking() {
    val asked = mediaLibraryMoveBody("o1", "h1", MediaLibraryDirection.TO_SITE, listOf("m1", "m2"), preview = true).jsonObject
    assertEquals("o1", asked["orgId"]?.jsonPrimitive?.content)
    assertEquals("h1", asked["hostId"]?.jsonPrimitive?.content)
    assertEquals("to-site", asked["direction"]?.jsonPrimitive?.content)
    assertEquals(listOf("m1", "m2"), asked["mediaIds"]!!.jsonArray.map { it.jsonPrimitive.content })
    assertEquals("true", asked["preview"]?.jsonPrimitive?.content)
    val moving = mediaLibraryMoveBody("o1", "h1", MediaLibraryDirection.TO_ORG, listOf("m1")).jsonObject
    assertEquals("to-org", moving["direction"]?.jsonPrimitive?.content)
    assertNull(moving["preview"])
    assertNull(moving["forHostId"])
  }

  @Test
  fun previewReadsWhatCanMoveWhatStaysAndTheUses() = runTest {
    val bodies = mutableListOf<JsonObject>()
    val paths = mutableListOf<String>()
    val answers = mutableListOf(
      """{"ok":true,"movable":["m1","m2"],"refused":[{"mediaId":"m3","name":"logo.png","reason":"Stays in the organization library: the workspace logo uses it"}],"unknownIds":[],"documents":4}""",
    )
    val api = MediaApi(client(answers, bodies, paths), MediaScope.Org("o1", "h1"))
    val preview = api.previewLibraryMove("o1", "h1", MediaLibraryDirection.TO_SITE, listOf("m1", "m2", "m3"))
    assertEquals(listOf("/api/media/move-library"), paths)
    assertEquals("true", bodies.single()["preview"]?.jsonPrimitive?.content)
    assertEquals(listOf("m1", "m2"), preview.movable)
    assertEquals(4, preview.documents)
    assertEquals("logo.png: the workspace logo uses it", mediaLibraryRefusedLine(preview.refused.single()))
  }

  @Test
  fun asksAgainForWhatIsLeftAndSumsTheUses() = runTest {
    val bodies = mutableListOf<JsonObject>()
    val answers = mutableListOf(
      """{"ok":true,"moved":1,"movedIds":["m1"],"failed":[],"refused":[],"remainingIds":["m2","m3"],"done":false,"rewrote":{"uses":3,"documents":2,"failed":0},"republished":true}""",
      """{"ok":true,"moved":1,"movedIds":["m2"],"failed":[{"mediaId":"m3","name":"c.png","reason":"Could not be moved"}],"refused":[],"remainingIds":[],"done":true,"rewrote":{"uses":2,"documents":1,"failed":0},"republished":true}""",
    )
    val api = MediaApi(client(answers, bodies), MediaScope.Site("h1"))
    val seen = mutableListOf<Pair<Int, Int>>()
    val outcome = api.moveLibrary(
      "o1", "h1", MediaLibraryDirection.TO_ORG,
      MediaLibraryPreview(listOf("m1", "m2", "m3"), listOf(MediaLibraryNotMoved("m4", "d.png", "used elsewhere")), 3),
      nameOf = { it },
    ) { done, total -> seen += done to total }
    assertEquals(listOf(listOf("m1", "m2", "m3"), listOf("m2", "m3")), bodies.map { body -> body["mediaIds"]!!.jsonArray.map { it.jsonPrimitive.content } })
    assertTrue(bodies.all { it["preview"] == null && it["direction"]?.jsonPrimitive?.content == "to-org" })
    assertEquals(listOf("m1", "m2"), outcome.movedIds)
    assertEquals(5L, outcome.rewroteUses)
    assertEquals(listOf("m4", "m3"), outcome.notMoved.map { it.mediaId })
    assertNull(outcome.failure)
    assertEquals(listOf(0 to 3, 1 to 3, 2 to 3), seen)
  }

  @Test
  fun stopsWhenARoundMovesNothingAndReportsWhatItNeverReached() = runTest {
    val bodies = mutableListOf<JsonObject>()
    val answers = mutableListOf(
      """{"ok":true,"moved":0,"movedIds":[],"failed":[],"refused":[],"remainingIds":["m1","m2"],"done":false,"rewrote":{"uses":0}}""",
    )
    val api = MediaApi(client(answers, bodies), MediaScope.Site("h1"))
    val outcome = api.moveLibrary("o1", "h1", MediaLibraryDirection.TO_ORG, MediaLibraryPreview(listOf("m1", "m2"), emptyList(), 0), nameOf = { "$it.png" })
    assertEquals(1, bodies.size)
    assertEquals(listOf(MediaLibraryNotMoved("m1", "m1.png", null), MediaLibraryNotMoved("m2", "m2.png", null)), outcome.notMoved)
  }

  @Test
  fun neverAsksMoreThanTheRoundCap() = runTest {
    val bodies = mutableListOf<JsonObject>()
    val ids = (1..30).map { "m$it" }
    // Each round moves one and leaves the rest, so only the cap ends it.
    val answers = ids.indices.map { index ->
      val rest = ids.drop(index + 1).joinToString(",") { "\"$it\"" }
      """{"movedIds":["${ids[index]}"],"failed":[],"refused":[],"remainingIds":[$rest],"rewrote":{"uses":1}}"""
    }.toMutableList()
    val api = MediaApi(client(answers, bodies), MediaScope.Site("h1"))
    val outcome = api.moveLibrary("o1", "h1", MediaLibraryDirection.TO_ORG, MediaLibraryPreview(ids, emptyList(), 0), nameOf = { it })
    assertEquals(MEDIA_LIBRARY_MOVE_ROUNDS, bodies.size)
    assertEquals(MEDIA_LIBRARY_MOVE_ROUNDS, outcome.movedIds.size)
    assertEquals(MEDIA_LIBRARY_MOVE_ROUNDS.toLong(), outcome.rewroteUses)
    assertEquals(30 - MEDIA_LIBRARY_MOVE_ROUNDS, outcome.notMoved.size)
  }

  @Test
  fun aFailedRequestStopsTheLoopAndIsKept() = runTest {
    val bodies = mutableListOf<JsonObject>()
    val answers = mutableListOf(
      """{"movedIds":["m1"],"failed":[],"refused":[],"remainingIds":["m2"],"rewrote":{"uses":1}}""",
      "500",
    )
    val api = MediaApi(client(answers, bodies), MediaScope.Site("h1"))
    val outcome = api.moveLibrary("o1", "h1", MediaLibraryDirection.TO_ORG, MediaLibraryPreview(listOf("m1", "m2"), emptyList(), 0), nameOf = { it })
    assertEquals(2, bodies.size)
    assertEquals(listOf("m1"), outcome.movedIds)
    assertNotNull(outcome.failure)
    assertEquals(listOf("m2"), outcome.notMoved.map { it.mediaId })
    // Something moved, so the report is the partial one, not the request's error.
    val report = mediaLibraryMoveReport(MediaLibraryDirection.TO_ORG, outcome, 2) { "Move failed" }
    assertEquals(StatusTone.WARNING, report.tone)
    assertEquals("Moved 1 of 2 to the organization library and updated 1 use — 1 could not be moved: \"m2\", and is still selected", report.message)
  }

  @Test
  fun saysWhatTheConsoleSays() {
    assertEquals("Move to this site's library", moveToOtherLibraryLabel(MediaLibraryDirection.TO_SITE))
    assertEquals("Move to organization library", moveToOtherLibraryLabel(MediaLibraryDirection.TO_ORG))
    assertEquals(
      "3 files will move to this site's library. Only this site will be able to use them. 5 pages, products or settings that use them will be updated to the new address, and the old address keeps working.",
      moveToOtherLibraryIntro(MediaLibraryDirection.TO_SITE, 3, 5),
    )
    assertEquals(
      "1 file will move to the organization library. Every site in the workspace will be able to use them. 1 page, product or setting that uses them will be updated to the new address, and the old address keeps working.",
      moveToOtherLibraryIntro(MediaLibraryDirection.TO_ORG, 1, 1),
    )
    assertEquals(
      "1 file will move to the organization library. Every site in the workspace will be able to use them. Nothing uses them yet.",
      moveToOtherLibraryIntro(MediaLibraryDirection.TO_ORG, 1, 0),
    )
    assertEquals("Move 1 file", moveToOtherLibraryConfirm(1))
    assertEquals("Move 4 files", moveToOtherLibraryConfirm(4))
    assertEquals("Move", moveToOtherLibraryConfirm(0))
    assertEquals("2 files will stay where they are:", mediaLibraryRefusedHeading(2))
    assertEquals("1 file will stay where it is:", mediaLibraryRefusedHeading(1))
    assertEquals("Moved 12 files to this site's library and updated 31 uses", movedToOtherLibraryMessage(MediaLibraryDirection.TO_SITE, 12, 31))
    assertEquals("Moved 1 file to the organization library and updated 1 use", movedToOtherLibraryMessage(MediaLibraryDirection.TO_ORG, 1, 1))
    val notMoved = listOf(
      MediaLibraryNotMoved("a", "a.png", "another site uses it"),
      MediaLibraryNotMoved("b", "b.png", null),
      MediaLibraryNotMoved("c", "c.png", null),
      MediaLibraryNotMoved("d", "d.png", null),
    )
    assertEquals(
      "Moved 5 of 9 to this site's library and updated 12 uses — 4 could not be moved: \"a.png\" (another site uses it), \"b.png\", \"c.png\" and 1 more, and are still selected",
      partialOtherLibraryMessage(MediaLibraryDirection.TO_SITE, 5, 9, 12, notMoved),
    )
    assertEquals(
      "Could not move 2 files to the organization library — 2 are where they were: \"a.png\" (another site uses it), \"b.png\", and are still selected",
      partialOtherLibraryMessage(MediaLibraryDirection.TO_ORG, 0, 2, 0, notMoved.take(2)),
    )
  }

  @Test
  fun reportsAWholeMoveAsDoneAndNothingMovedWithTheRequestsWords() {
    val whole = mediaLibraryMoveReport(MediaLibraryDirection.TO_SITE, MediaLibraryMoveOutcome(listOf("m1", "m2"), emptyList(), 3, null), 2) { "x" }
    assertEquals(StatusTone.SUCCESS, whole.tone)
    assertEquals("Moved 2 files to this site's library and updated 3 uses", whole.message)
    val failed = mediaLibraryMoveReport(
      MediaLibraryDirection.TO_SITE,
      MediaLibraryMoveOutcome(emptyList(), listOf(MediaLibraryNotMoved("m1", "a.png", null)), 0, IllegalStateException("boom")),
      1,
    ) { "That did not go through." }
    assertEquals(StatusTone.ERROR, failed.tone)
    assertEquals("That did not go through.", failed.message)
  }
}
