package com.aglyn.site

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.FirestoreWriter
import com.aglyn.site.pages.PageSettings
import com.aglyn.site.pages.PageSettingsApi
import com.aglyn.site.pages.PageVisibility
import com.aglyn.site.pages.defaultScheduleMillis
import com.aglyn.site.pages.isPageInPreview
import com.aglyn.site.pages.isSiteInPreview
import com.aglyn.site.pages.pagePasswordHash
import com.aglyn.site.pages.pagePreviewCaption
import com.aglyn.site.pages.pageScheduleLabel
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
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PageSettingsTest {
  private class Calls {
    val seen = mutableListOf<Pair<String, JsonObject>>()
    val client = ConsoleApiClient(
      origin = "https://console.test/",
      http = HttpClient(
        MockEngine { request ->
          val text = (request.body as? OutgoingContent.ByteArrayContent)?.bytes()?.decodeToString().orEmpty()
          seen += request.url.encodedPath to (if (text.isEmpty()) JsonObject(emptyMap()) else Json.parseToJsonElement(text).jsonObject)
          respond("""{"reason":"ok"}""", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        },
      ),
      getIdToken = { "t" },
      sleep = {},
      maxAttempts = 1,
    )
  }

  private class Writer : FirestoreWriter {
    val merges = mutableListOf<Pair<String, Map<String, Any?>>>()
    val updates = mutableListOf<Pair<String, Map<String, Any?>>>()
    val deleted = mutableListOf<String>()
    override suspend fun merge(path: String, data: Map<String, Any?>) {
      merges += path to data
    }
    override suspend fun update(path: String, data: Map<String, Any?>) {
      updates += path to data
    }
    override suspend fun delete(path: String) {
      deleted += path
    }
  }

  private fun doc(vararg fields: Pair<String, Any?>) = FirestoreDoc("p1", "hosts/h/screens/p1", mapOf(*fields))

  @Test
  fun visibilityValuesAreTheConsolesHostScreenVisibility() {
    // PUBLIC = 1<<1, UNLISTED = PUBLIC | 1<<2, PASSWORD = PRIVATE(1<<3) | 1<<4, AUTHENTICATED = PRIVATE | 1<<5.
    assertEquals(listOf(2L, 6L, 24L, 40L), PageVisibility.entries.map { it.value })
    assertEquals(listOf("Public", "Unlisted", "Password protected", "Members only"), PageVisibility.entries.map { it.label })
  }

  @Test
  fun readsAccessAndScheduleFromTheScreenDocument() {
    val none = PageSettings.from(null)
    assertEquals(PageVisibility.PUBLIC, none.visibility)
    assertFalse(none.hasPassword)
    assertNull(none.pending)

    val settings = PageSettings.from(
      doc(
        "visibility" to 24L,
        "protection" to mapOf("passwordHash" to "abc"),
        "publishSchedule" to mapOf("action" to "publish", "versionId" to "v2", "publishAt" to FirestoreTimestamp(1_800_000_000), "status" to "pending"),
      ),
    )
    assertEquals(PageVisibility.PASSWORD, settings.visibility)
    assertTrue(settings.hasPassword)
    assertEquals("v2", settings.pending?.versionId)
    assertNull(settings.skippedLabel)
    assertEquals("Publishes then", pageScheduleLabel(settings.pending!!) { "then" })
    // A stored value the section does not offer reads as none of its choices.
    assertNull(PageSettings.from(doc("visibility" to 8L)).visibility)
  }

  @Test
  fun aSkippedScheduleIsShownWithTheConsolesWords() {
    val unentitled = PageSettings.from(doc("publishSchedule" to mapOf("action" to "unpublish", "status" to "skipped-unentitled")))
    assertNull(unentitled.pending)
    assertEquals("Did not unpublish — plan does not include scheduling", unentitled.skippedLabel)
    assertTrue(unentitled.skippedHelp!!.startsWith("Scheduled publishing is a Pro feature."))
    assertEquals("Did not publish — no available address", PageSettings.from(doc("publishSchedule" to mapOf("action" to "publish", "status" to "skipped-unroutable"))).skippedLabel)
  }

  @Test
  fun previewReadsOnlyAnExplicitTrue() {
    assertTrue(isPageInPreview(mapOf("previewScreens" to mapOf("p1" to true)), "p1"))
    assertFalse(isPageInPreview(mapOf("previewScreens" to mapOf("p1" to false)), "p1"))
    assertFalse(isPageInPreview(null, "p1"))
    assertTrue(isSiteInPreview(mapOf("preview" to true)))
    assertFalse(isSiteInPreview(mapOf("preview" to "yes")))
    assertEquals("Visitors get your 404 page here until you switch this off.", pagePreviewCaption(siteInPreview = false, pageInPreview = true))
  }

  @Test
  fun thePasswordIsStoredAsItsSha256Hex() {
    assertEquals("2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b", pagePasswordHash("secret"))
  }

  @Test
  fun theScheduleStartsAtTheNextWholeHour() {
    // 1_800_000_000 s is on the hour; twenty minutes past it, the first time offered is the next whole hour.
    assertEquals((1_800_000_000L + 3600) * 1000, defaultScheduleMillis((1_800_000_000L + 1234) * 1000))
  }

  @Test
  fun leavingPasswordModeDropsTheHashAndAnnouncesALivePage() = runTest {
    val calls = Calls()
    val writer = Writer()
    val api = PageSettingsApi(calls.client, writer, "h")
    api.setVisibility("p1", PageVisibility.UNLISTED, hadPassword = true, livePath = "/about")
    assertEquals("hosts/h/screens/p1", writer.updates.first().first)
    assertEquals(6L, writer.updates.first().second["visibility"])
    assertEquals(FirestoreDelete, writer.updates.first().second["protection"])
    assertEquals(listOf("/api/screens/revalidate"), calls.seen.map { it.first })
    assertEquals("p1", calls.seen.first().second["screenId"]?.jsonPrimitive?.content)

    // A page with no address has no cached copy to drop; password mode keeps the hash.
    api.setVisibility("p2", PageVisibility.PASSWORD, hadPassword = true, livePath = null)
    assertFalse("protection" in writer.updates.last().second)
    assertEquals(1, calls.seen.size)
  }

  @Test
  fun savesThePasswordHashOrRemovesProtection() = runTest {
    val writer = Writer()
    val api = PageSettingsApi(Calls().client, writer, "h")
    api.setPassword("p1", "  secret ", livePath = null)
    assertEquals(mapOf("passwordHash" to pagePasswordHash("secret")), writer.updates.first().second["protection"])
    api.setPassword("p1", "   ", livePath = null)
    assertEquals(FirestoreDelete, writer.updates.last().second["protection"])
  }

  @Test
  fun schedulesAndCancels() = runTest {
    val writer = Writer()
    val api = PageSettingsApi(Calls().client, writer, "h")
    api.schedule("p1", unpublish = false, versionId = "v2", atMillis = 1_900_000_000_500L)
    val publish = assertNotNull(writer.updates.first().second["publishSchedule"] as? Map<*, *>)
    assertEquals("publish", publish["action"])
    assertEquals("v2", publish["versionId"])
    assertEquals(FirestoreTimestamp(1_900_000_000, 500_000_000), publish["publishAt"])
    assertEquals("pending", publish["status"])
    assertNotNull(publish["createdAt"] as? FirestoreTimestamp)

    api.schedule("p1", unpublish = true, versionId = "v2", atMillis = 1_900_000_000_000L)
    val unpublish = assertNotNull(writer.updates.last().second["publishSchedule"] as? Map<*, *>)
    assertEquals("unpublish", unpublish["action"])
    assertFalse("versionId" in unpublish)

    api.cancelSchedule("p1")
    assertEquals(FirestoreDelete, writer.updates.last().second["publishSchedule"])
  }

  @Test
  fun thePreviewSwitchWritesTheHostAndAnnouncesTheWholeSite() = runTest {
    val calls = Calls()
    val writer = Writer()
    val api = PageSettingsApi(calls.client, writer, "h")
    api.setPreview("p1", true)
    assertEquals("hosts/h", writer.merges.first().first)
    assertEquals(mapOf("p1" to true), writer.merges.first().second["previewScreens"])
    assertTrue(writer.merges[1].first.startsWith("publishOutbox/"))
    assertEquals("true", calls.seen.first().second["entireHost"]?.jsonPrimitive?.content)
    assertEquals(1, writer.deleted.size)

    api.setPreview("p1", false)
    assertEquals(mapOf("p1" to FirestoreDelete), writer.merges.last { it.first == "hosts/h" }.second["previewScreens"])
  }
}
