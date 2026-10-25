package com.aglyn.screens

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The front desk's walk-in: priced and checked against the resource's live stays and blocks for the instant answer, then booked
 * through the console's walk-in route, which asks again inside its transaction. The Apple `StaysBookingTests` hold the same cases.
 */
class CommerceWalkInTest : SpecTestBase() {
  private class Desk(
    val resource: Map<String, Any?>? = mapOf("nightlyRateUsd" to 120L, "minNights" to 2L, "blocks" to listOf(mapOf("fromDayMs" to Stays.dayMs("2026-12-24")!!, "toDayMs" to Stays.dayMs("2026-12-27")!!))),
    val stays: List<Map<String, Any?>> = emptyList(),
    val failQuery: Boolean = false,
  ) : FirestoreReader {
    val queries = mutableListOf<FirestoreQuery>()
    override suspend fun get(path: String): FirestoreDoc? = if (path == "hosts/h1/resources/r1") resource?.let { FirestoreDoc("r1", path, it) } else null
    override suspend fun page(query: FirestoreQuery): FirestorePage {
      queries += query
      if (failQuery) error("offline")
      return FirestorePage(stays.mapIndexed { index, data -> FirestoreDoc("s$index", "hosts/h1/reservations/s$index", data) }, null)
    }
    override fun observeDoc(path: String): Flow<Live<FirestoreDoc?>> = emptyFlow()
    override fun observe(query: FirestoreQuery): Flow<Live<List<FirestoreDoc>>> = emptyFlow()
  }

  private fun stay(from: String, to: String, status: String = "confirmed") =
    mapOf("resourceId" to "r1", "checkInDayMs" to Stays.dayMs(from)!!, "checkOutDayMs" to Stays.dayMs(to)!!, "status" to status)

  /** A desk's screen: one model, so a second press of the same walk-in is a retry of it. */
  private inner class Booking(val desk: Desk, vararg responses: Pair<Int, String>) {
    val sent = mutableListOf<HttpRequestData>()
    val writer = RecordingWriter()
    private val queue = ArrayDeque(responses.toList())
    private val client = ConsoleApiClient(
      "http://localhost",
      HttpClient(
        MockEngine { request ->
          sent += request
          val (status, body) = queue.removeFirstOrNull() ?: (200 to """{"reservationId":"x"}""")
          respond(body, HttpStatusCode.fromValue(status), headersOf("Content-Type", "application/json"))
        },
      ) { expectSuccess = false },
      { "t" },
      sleep = {},
    )
    val model: ScreenModel = run {
      val session = ScreenSession(orgName = "Acme", orgRole = "owner", siteName = "Shop", origin = "https://console.test")
      ScreenModel(spec("commerce", "commerce.reservations"), session.context(Site(), emptyMap()), client, desk, writer).also {
        it.seed(Json.parseToJsonElement("""{"resources":{"items":[{"${'$'}id":"r1","name":"Cabin","nightlyRateUsd":120}]},"stays":{"items":[]}}"""))
      }
    }

    fun book(form: String): ActionOutcome = runBlocking { model.run(model.action("add", "walkIn"), ScreenContext.with(model.context, "form", json(form))) }

    val bodies get() = sent.map { Json.parseToJsonElement((it.body as TextContent).text).jsonObject }
  }

  private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.content

  private val form = """{"resourceId":"r1","checkIn":"2026-10-12","checkOut":"2026-10-15","guestName":"Ada"}"""

  @Test
  fun aFreeStayIsBookedThroughTheWalkInRoute() {
    val booking = Booking(Desk())
    val outcome = booking.book(form)
    assertTrue(outcome is ActionOutcome.Done, "$outcome")
    assertEquals("Walk-in reserved — collect payment at POS", outcome.message)
    assertEquals(emptyList(), booking.writer.calls, "the route writes the stay, not the device")
    val request = booking.sent.single()
    assertEquals("/api/commerce/reservations/walk-in", request.url.encodedPath)
    assertEquals("POST", request.method.value)
    val body = booking.bodies.single()
    assertEquals(Site().hostId, body["hostId"].text())
    assertEquals("r1", body["resourceId"].text())
    assertEquals("Ada", body["guestName"].text())
    assertEquals(Stays.dayMs("2026-10-12"), body["checkInDayMs"].text()?.toLong())
    assertEquals(Stays.dayMs("2026-10-15"), body["checkOutDayMs"].text()?.toLong())
    assertTrue(Regex("^[A-Za-z0-9_-]{1,128}$").matches(body["reservationId"].text().orEmpty()), "${body["reservationId"]}")
    // The check asks for this resource's stays that end after the walk-in arrives, the booking door's own query.
    val query = booking.desk.queries.single()
    assertEquals("hosts/${Site().hostId}/reservations", query.collectionPath)
    assertEquals(listOf("resourceId" to FilterOp.EQ, "checkOutDayMs" to FilterOp.GT), query.filters.map { it.field to it.op })
    assertEquals(Stays.dayMs("2026-10-12"), query.filters[1].value)
  }

  @Test
  fun aRetryResendsItsReservationIdAndTheNextWalkInMintsItsOwn() {
    val booking = Booking(Desk(), 500 to """{"error":"Walk-in failed"}""", 200 to """{"reservationId":"x","replayed":true}""", 200 to "{}")
    assertEquals("Walk-in failed", (booking.book(form) as ActionOutcome.Failed).message)
    assertTrue(booking.book(form) is ActionOutcome.Done)
    assertTrue(booking.book(form) is ActionOutcome.Done)
    val ids = booking.bodies.map { it["reservationId"].text() }
    assertEquals(3, ids.size)
    assertEquals(ids[0], ids[1], "a retry of the same walk-in finds its own stay")
    assertTrue(ids[1] != ids[2], "a booked walk-in lets go of its id")
    // A changed walk-in is a new attempt.
    val other = Booking(Desk(), 500 to "{}", 200 to "{}")
    other.book(form)
    other.book("""{"resourceId":"r1","checkIn":"2026-10-12","checkOut":"2026-10-16","guestName":"Ada"}""")
    assertTrue(other.bodies[0]["reservationId"].text() != other.bodies[1]["reservationId"].text())
  }

  @Test
  fun theRoutesRefusalIsWhatThePersonIsTold() {
    for ((status, error) in listOf(409 to "Every unit is taken on at least one of those nights", 403 to "Editing requires the editor role")) {
      val booking = Booking(Desk(), status to """{"error":"$error"}""")
      assertEquals(error, (booking.book(form) as ActionOutcome.Failed).message)
    }
  }

  @Test
  fun datesThatClashWithALiveStayOrABlockAreTakenAndNeverReachTheRoute() {
    for (taken in listOf(stay("2026-10-13", "2026-10-14"), stay("2026-10-10", "2026-10-13", "checked_in"))) {
      val booking = Booking(Desk(stays = listOf(taken)))
      assertEquals("Those dates are taken", (booking.book(form) as ActionOutcome.Failed).message)
      assertEquals(emptyList(), booking.sent)
    }
    val blocked = Booking(Desk())
    assertEquals("Those dates are taken", (blocked.book("""{"resourceId":"r1","checkIn":"2026-12-23","checkOut":"2026-12-26","guestName":""}""") as ActionOutcome.Failed).message)
    assertEquals(emptyList(), blocked.sent)
    // A cancelled stay and back-to-back stays do not stand in the way.
    val free = Booking(Desk(stays = listOf(stay("2026-10-13", "2026-10-14", "cancelled"), stay("2026-10-10", "2026-10-12"), stay("2026-10-15", "2026-10-17"))))
    assertTrue(free.book(form) is ActionOutcome.Done)
  }

  @Test
  fun aSeveralUnitResourceTakesWalkInsUntilEveryUnitOfSomeNightIsTaken() {
    val hookups = mapOf<String, Any?>("nightlyRateUsd" to 60L, "units" to 2L)
    // One of two hookups taken on the 13th: there is still one for every night.
    val open = Booking(Desk(resource = hookups, stays = listOf(stay("2026-10-13", "2026-10-14"))))
    assertTrue(open.book(form) is ActionOutcome.Done)
    assertEquals(1, open.sent.size)
    // Both taken on the 13th (a cancelled stay does not count): refused in the console's words, nothing sent.
    val full = Booking(Desk(resource = hookups, stays = listOf(stay("2026-10-13", "2026-10-14"), stay("2026-10-12", "2026-10-14", "checked_in"), stay("2026-10-12", "2026-10-15", "cancelled"))))
    assertEquals("Every unit is taken on at least one of those nights", (full.book(form) as ActionOutcome.Failed).message)
    assertEquals(emptyList(), full.sent)
    // A block still closes every unit.
    val blocked = Booking(Desk(resource = hookups + ("blocks" to listOf(mapOf("fromDayMs" to Stays.dayMs("2026-10-14")!!, "toDayMs" to Stays.dayMs("2026-10-15")!!)))))
    assertTrue(blocked.book(form) is ActionOutcome.Failed)
  }

  @Test
  fun whatCannotBeBookedIsSaidInWords() {
    fun said(desk: Desk, form: String) = (Booking(desk).book(form) as ActionOutcome.Failed).message
    assertEquals("Minimum stay is 2 nights", said(Desk(), """{"resourceId":"r1","checkIn":"2026-10-12","checkOut":"2026-10-13"}"""))
    assertEquals("Choose at least one night", said(Desk(), """{"resourceId":"r1","checkIn":"2026-10-12","checkOut":"2026-10-12"}"""))
    assertEquals("Choose a resource and both dates.", said(Desk(), """{"resourceId":"r1","checkIn":"2026-10-12","checkOut":""}"""))
    assertEquals("That resource is gone.", said(Desk(resource = null), form))
    assertEquals("Could not check those dates. Try again.", said(Desk(failQuery = true), form))
  }

  @Test
  fun aGuestWithNoNameIsBookedWithoutOne() {
    val booking = Booking(Desk())
    booking.book("""{"resourceId":"r1","checkIn":"2026-10-12","checkOut":"2026-10-14","guestName":""}""")
    assertEquals(null, booking.bodies.single()["guestName"])
  }

  private fun editResource(item: String, typed: String): RecordingWriter {
    val writer = RecordingWriter()
    val model = ScreenModel(spec("commerce", "commerce.reservations"), Json.parseToJsonElement("""{"site":{"id":"h1"}}"""), null, null, writer)
    val edit = model.rowActions("resources").first { it.id == "edit" }
    val scope = ScreenContext.with(ScreenContext.withItem(model.context, Json.parseToJsonElement(item)), "form", Json.parseToJsonElement(typed))
    val outcome = runBlocking { model.run(edit, scope) }
    assertTrue(outcome is ActionOutcome.Done, "$outcome")
    return writer
  }

  @Test
  fun theResourceEditorAsksForUnitsAndSleepsInTheConsolesWords() {
    val model = ScreenModel(spec("commerce", "commerce.reservations"), Json.parseToJsonElement("{}"), null)
    for (action in listOf(model.rowActions("resources").first { it.id == "edit" }, model.action("add", "addResource"))) {
      val units = action.prompt.first { it.key == "units" }
      assertEquals("Spots or units available", units.label)
      assertEquals("How many identical ones you have, like 12 RV hookups", units.help)
      assertEquals(Stays.maxUnits.toDouble(), units.max)
      assertEquals(1.0, units.min)
      assertEquals("A whole number from 1 to ${Stays.maxUnits}", units.mismatch)
      assertTrue(units.refuses(JsonPrimitive("501"), JsonPrimitive("")))
      assertTrue(units.refuses(JsonPrimitive("0"), JsonPrimitive("")))
      assertTrue(units.unmet(JsonPrimitive("twelve"), JsonPrimitive("")))
      assertTrue(!units.refuses(JsonPrimitive("12"), JsonPrimitive("")))
      val sleeps = action.prompt.first { it.key == "capacity" }
      assertEquals("Sleeps", sleeps.label)
      assertEquals("Guests per unit, for display", sleeps.help)
      // Units sit beside Sleeps, right after the name, as the console's dialog has them.
      assertEquals(listOf("name", "units", "capacity"), action.prompt.take(3).map { it.key })
    }
    val item = """{"${'$'}id":"r1","name":"RV hookups","nightlyRateUsd":60,"units":12}"""
    val units = Regex("units=([0-9.]+)")
    fun written(typed: String) = units.find(editResource(item, typed).calls.single())?.groupValues?.get(1)?.toDouble()
    assertEquals(12.0, written("""{"name":"RV hookups","nightlyRateUsd":60,"units":12}"""))
    // A cleared field writes 1, so a merge cannot keep the 12 that was just removed.
    assertEquals(1.0, written("""{"name":"RV hookups","nightlyRateUsd":60,"units":null}"""))
  }

  @Test
  fun theLookAheadCountsEachSeveralUnitResourcesNextNights() {
    val today = Stays.dayMs("2026-10-26")!!
    fun night(n: Long) = today + n * Stays.DAY_MS
    fun stay(resource: String, from: Long, to: Long, status: String = "confirmed") =
      """{"resourceId":"$resource","checkInDayMs":${night(from)},"checkOutDayMs":${night(to)},"status":"$status"}"""
    val resources = Json.parseToJsonElement(
      """{"items":[{"${'$'}id":"rv","name":"RV hookups","units":12,"blocks":[{"fromDayMs":${night(3)},"toDayMs":${night(4)}}]},{"${'$'}id":"cabin","name":"Cabin"}]}""",
    )
    val stays = Json.parseToJsonElement(
      """{"items":[${(List(12) { stay("rv", 0, 1) } + List(10) { stay("rv", 1, 2) } + listOf(stay("rv", 1, 2, "cancelled"), stay("cabin", 0, 3))).joinToString(",")}]}""",
    )
    val ahead = Stays.unitsAhead(resources, stays, today, today).jsonObject
    assertEquals(null, ahead["cabin"], "a one-unit resource has no look-ahead")
    val nights = (ahead["rv"] as kotlinx.serialization.json.JsonArray).map { it.jsonObject }
    assertEquals(Stays.LOOKAHEAD_NIGHTS, nights.size)
    assertEquals("Mon, Oct 26", (nights.first()["label"] as JsonPrimitive).content)
    assertEquals(listOf("0", "2", "12", "0", "12"), nights.take(5).map { (it["unitsLeft"] as JsonPrimitive).content })
    assertEquals(listOf("error", "warning", "neutral", "error"), nights.take(4).map { (it["tone"] as JsonPrimitive).content })
    // The screen's derived load reads the same from its two loads.
    val load = LoadSpec("unitsAhead", Json.parseToJsonElement("""{"derive":"unitsAhead","args":["resources","current"]}"""))
    val model = ScreenModel(spec("commerce", "commerce.reservations"), Json.parseToJsonElement("{}"), null)
    val derived = model.derive(load, kotlinx.serialization.json.JsonObject(mapOf("resources" to resources, "current" to stays))).jsonObject
    assertEquals(Stays.LOOKAHEAD_NIGHTS, (derived["rv"] as kotlinx.serialization.json.JsonArray).size)
  }
}
