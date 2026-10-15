package com.aglyn.site

import com.aglyn.core.ConsoleApiClient
import com.aglyn.site.media.MEDIA_QUARANTINE_PROBE_MAX
import com.aglyn.site.media.MediaApi
import com.aglyn.site.media.MediaQuarantineNotice
import com.aglyn.site.media.MediaScope
import com.aglyn.site.media.parseMediaQuarantine
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The Disabled notice on a library file (AGL-1612): what `/api/media/quarantine` answers, and what is asked. */
class MediaQuarantineTest {
  @Test
  fun readsTheNoticeTheRouteAnswersAndNothingFromAHealthyPlatform() {
    val answer = Json.parseToJsonElement(
      """{"quarantined":{"m1":{"reason":"dmca","title":"Taken down","body":"This file was disabled after a notice.","contact":"support@aglyn.com"},"m2":{"reason":"abuse","body":"Disabled.","contact":null}},"readAtMs":1}""",
    )
    val notices = parseMediaQuarantine(answer)
    assertEquals(setOf("m1", "m2"), notices.keys)
    assertEquals(MediaQuarantineNotice("dmca", "Taken down", "This file was disabled after a notice.", "support@aglyn.com"), notices["m1"])
    assertEquals("This file was disabled after a notice. (support@aglyn.com)", notices["m1"]?.message)
    // A missing title reads "Disabled" and no contact leaves the body alone, as the console's chip and tooltip do.
    assertEquals("Disabled", notices["m2"]?.title)
    assertEquals("Disabled.", notices["m2"]?.message)
    assertTrue(parseMediaQuarantine(Json.parseToJsonElement("""{"quarantined":{},"readAtMs":1}""")).isEmpty())
    assertTrue(parseMediaQuarantine(null).isEmpty())
  }

  @Test
  fun asksInBatchesOfTheRoutesLimitWithTheScopeInTheBodyAndStaysSilentWhenItFails() = runTest {
    val bodies = mutableListOf<kotlinx.serialization.json.JsonObject>()
    var failNext = false
    val engine = MockEngine { request ->
      val text = (request.body as? io.ktor.http.content.OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
      bodies += Json.parseToJsonElement(text).jsonObject
      if (failNext) return@MockEngine respond("{}", HttpStatusCode.InternalServerError, headersOf(HttpHeaders.ContentType, "application/json"))
      val ids = bodies.last()["mediaIds"]!!.jsonArray.map { it.jsonPrimitive.content }
      val first = ids.first()
      respond(
        """{"quarantined":{"$first":{"reason":"dmca","title":"Taken down","body":"Disabled.","contact":null}}}""",
        HttpStatusCode.OK,
        headersOf(HttpHeaders.ContentType, "application/json"),
      )
    }
    val api = MediaApi(ConsoleApiClient(origin = "https://console.test/", http = HttpClient(engine), getIdToken = { "t" }, sleep = {}, maxAttempts = 1), MediaScope.Org("o1", "h1"))
    val ids = (1..MEDIA_QUARANTINE_PROBE_MAX + 5).map { "m" + it.toString().padStart(3, '0') } + listOf("m001", " ")
    val found = api.quarantine(ids)
    // 105 distinct ids go in two calls, the first at the route's limit; a repeat or a blank id is not asked.
    assertEquals(listOf(MEDIA_QUARANTINE_PROBE_MAX, 5), bodies.map { it["mediaIds"]!!.jsonArray.size })
    assertEquals("o1", bodies[0]["orgId"]?.jsonPrimitive?.content)
    assertEquals("h1", bodies[0]["forHostId"]?.jsonPrimitive?.content)
    assertEquals(setOf("m001", "m101"), found.keys)
    failNext = true
    assertTrue(api.quarantine(listOf("m001")).isEmpty())
  }
}
