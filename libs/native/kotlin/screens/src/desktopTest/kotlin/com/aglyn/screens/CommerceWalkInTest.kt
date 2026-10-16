package com.aglyn.screens

import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestorePage
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The front desk's walk-in: priced and checked against the resource's live stays and blocks, then booked as the console's card books it. */
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

  private fun book(desk: Desk, form: String, writer: RecordingWriter = RecordingWriter()): Pair<ActionOutcome, RecordingWriter> {
    val spec = spec("commerce", "commerce.reservations")
    val session = ScreenSession(orgName = "Acme", orgRole = "owner", siteName = "Shop", origin = "https://console.test")
    val model = ScreenModel(spec, session.context(Site(), emptyMap()), null, desk, writer)
    model.seed(Json.parseToJsonElement("""{"resources":{"items":[{"${'$'}id":"r1","name":"Cabin","nightlyRateUsd":120}]},"stays":{"items":[]}}"""))
    val walkIn = model.action("add", "walkIn")
    val outcome = runBlocking { model.run(walkIn, ScreenContext.with(model.context, "form", json(form))) }
    return outcome to writer
  }

  private val form = """{"resourceId":"r1","checkIn":"2026-10-12","checkOut":"2026-10-15","guestName":"Ada"}"""

  @Test
  fun aFreeStayIsPricedAndBookedConfirmedWithNothingPaid() {
    val desk = Desk()
    val (outcome, writer) = book(desk, form)
    assertTrue(outcome is ActionOutcome.Done)
    assertEquals("Walk-in reserved — collect payment at POS", outcome.message)
    assertEquals(
      listOf("add hosts/h1/reservations {checkInDayMs=${Stays.dayMs("2026-10-12")},checkOutDayMs=${Stays.dayMs("2026-10-15")},createdAtMs=${writer.calls.single().substringAfter("createdAtMs=").substringBefore(",")},depositCents=0,guestEmail=null,guestName=Ada,nights=3,paidCents=0,resourceId=r1,status=confirmed,totalCents=36000}"),
      writer.calls,
    )
    // The check asks for this resource's stays that end after the walk-in arrives, the booking door's own query.
    val query = desk.queries.single()
    assertEquals("hosts/h1/reservations", query.collectionPath)
    assertEquals(listOf("resourceId" to FilterOp.EQ, "checkOutDayMs" to FilterOp.GT), query.filters.map { it.field to it.op })
    assertEquals(Stays.dayMs("2026-10-12"), query.filters[1].value)
  }

  @Test
  fun datesThatClashWithALiveStayOrABlockAreTakenAndNothingIsWritten() {
    for (taken in listOf(stay("2026-10-13", "2026-10-14"), stay("2026-10-10", "2026-10-13", "checked_in"))) {
      val (outcome, writer) = book(Desk(stays = listOf(taken)), form)
      assertEquals("Those dates are taken", (outcome as ActionOutcome.Failed).message)
      assertEquals(emptyList(), writer.calls)
    }
    val (blocked, written) = book(Desk(), """{"resourceId":"r1","checkIn":"2026-12-23","checkOut":"2026-12-26","guestName":""}""")
    assertEquals("Those dates are taken", (blocked as ActionOutcome.Failed).message)
    assertEquals(emptyList(), written.calls)
    // A cancelled stay, a no-show, and back-to-back stays do not stand in the way.
    val free = Desk(stays = listOf(stay("2026-10-13", "2026-10-14", "cancelled"), stay("2026-10-10", "2026-10-12"), stay("2026-10-15", "2026-10-17")))
    assertTrue(book(free, form).first is ActionOutcome.Done)
  }

  @Test
  fun whatCannotBeBookedIsSaidInWords() {
    fun said(desk: Desk, form: String) = (book(desk, form).first as ActionOutcome.Failed).message
    assertEquals("Minimum stay is 2 nights", said(Desk(), """{"resourceId":"r1","checkIn":"2026-10-12","checkOut":"2026-10-13"}"""))
    assertEquals("Choose at least one night", said(Desk(), """{"resourceId":"r1","checkIn":"2026-10-12","checkOut":"2026-10-12"}"""))
    assertEquals("Choose a resource and both dates.", said(Desk(), """{"resourceId":"r1","checkIn":"2026-10-12","checkOut":""}"""))
    assertEquals("That resource is gone.", said(Desk(resource = null), form))
    assertEquals("Could not check those dates. Try again.", said(Desk(failQuery = true), form))
  }

  @Test
  fun aGuestWithNoNameIsBookedWithoutOne() {
    val (_, writer) = book(Desk(), """{"resourceId":"r1","checkIn":"2026-10-12","checkOut":"2026-10-14","guestName":""}""")
    assertTrue("guestName=null" in writer.calls.single())
  }
}
