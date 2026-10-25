package com.aglyn.plugins.commerce.pos

import com.aglyn.core.ConsoleApiClient
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun row(id: String, status: String = "expected", extra: String = "") =
  """{"id":"$id","source":"order","orderLabel":"#1042","itemName":"Day pass","variantLabel":"Adult","unitIndex":0,"unitCount":2,"dayKey":"2026-10-25","customerKey":"ana@example.com","customerName":"Ana Ruiz","status":"$status","searchTokens":[],"createdAtMs":1,"updatedAtMs":1$extra}"""

/** Check-in at the window (AGL-4063): the route the register asks and the sheet's state, as the Apple app's `PosCheckInTests`. */
class PosCheckInTest {
  private class Seen(val path: String, val body: JsonObject, val key: String?)

  private fun window(seen: MutableList<Seen>, vararg answers: Pair<Int, String>): ConsolePosCheckInApi {
    val queue = ArrayDeque(answers.toList())
    val engine = MockEngine { request ->
      seen += Seen(request.url.encodedPath, Json.parseToJsonElement(request.body.toByteArray().decodeToString()).jsonObject, request.headers["Idempotency-Key"])
      val (status, body) = queue.removeFirstOrNull() ?: (200 to "{}")
      respond(body, HttpStatusCode.fromValue(status), headersOf(HttpHeaders.ContentType, "application/json"))
    }
    return ConsolePosCheckInApi(ConsoleApiClient("https://console.test", HttpClient(engine) { expectSuccess = false }, { "token" }, maxAttempts = 1), "h1")
  }

  private fun JsonElement?.text() = this?.jsonPrimitive?.content

  /** The route's search answer, on the test's own clock (a real HTTP engine answers on another thread). */
  private class Searches : PosCheckInApi {
    val asked = mutableListOf<String>()
    override suspend fun search(text: String): Pair<PosCheckInDay?, List<com.aglyn.contracts.CheckInCustomer>> {
      asked += text
      return PosCheckInDay("2026-10-25", "America/Chicago") to listOf(
        com.aglyn.contracts.CheckInCustomer(contactId = "c1", customerKey = "ana@example.com", email = "ana@example.com", items = listOf("Day pass", "RV camping"), name = "Ana Ruiz", unitsCheckedIn = 1, unitsDue = 3),
      )
    }
    override suspend fun customer(target: PosCheckInTarget) = error("not asked")
    override suspend fun checkIn(picks: List<PosCheckInPick>, registerId: String?, assertion: String?, attemptKey: String) = error("not asked")
    override suspend fun undo(id: String, registerId: String?, assertion: String?) = error("not asked")
  }

  @Test
  fun typingSearchesAfterAPauseAndListsWhoIsDue() = runTest {
    val api = Searches()
    val model = PosCheckInModel(api, this, { "reg1" }, { "pin-assertion" })
    model.type("a")
    advanceUntilIdle()
    assertTrue(api.asked.isEmpty(), "one letter asks nothing")
    model.type("an")
    model.type("ana")
    advanceUntilIdle()
    assertEquals(listOf("ana"), api.asked, "only the last keystroke asks")
    assertEquals(listOf("ana@example.com"), model.customers.map { it.customerKey })
    assertEquals(PosCheckInDay("2026-10-25", "America/Chicago"), model.day)
    assertEquals("1 of 3 checked in · Day pass, RV camping · ana@example.com", checkInCustomerLine(model.customers[0]))
  }

  @Test
  fun theSearchAsksTheCheckInRouteForTheText() = runTest {
    val seen = mutableListOf<Seen>()
    val api = window(seen, 200 to """{"dayKey":"2026-10-25","timeZone":"UTC","customers":[]}""")
    val (day, found) = api.search("ana")
    assertEquals("/api/commerce/pos-check-in", seen[0].path)
    assertEquals("search", seen[0].body["action"].text())
    assertEquals("ana", seen[0].body["text"].text())
    assertEquals("h1", seen[0].body["hostId"].text())
    assertEquals(PosCheckInDay("2026-10-25", "UTC"), day)
    assertTrue(found.isEmpty())
  }

  @Test
  fun aCustomerOpensOnTheirRowsAndEachIsCheckedInWithItsWristband() = runTest {
    val seen = mutableListOf<Seen>()
    val checked = row("r1", "checked_in", ""","checkedInAtMs":1792940040000,"checkedInByName":"Sam","wristband":{"number":"214","color":"Blue"}""")
    val api = window(
      seen,
      200 to """{"dayKey":"2026-10-25","timeZone":"America/Chicago","customer":{"customerKey":"ana@example.com","name":"Ana Ruiz","unitsDue":2,"unitsCheckedIn":0,"items":["Day pass"]},"checkIns":[${row("r1")},${row("r2")}]}""",
      200 to """{"checkedIn":[$checked],"alreadyCheckedIn":[],"missing":[]}""",
    )
    val model = PosCheckInModel(api, this, { "reg1" }, { "pin-assertion" })
    model.open(PosCheckInTarget(customerKey = "ana@example.com"))
    assertEquals("Ana Ruiz", model.title)
    assertEquals(listOf("r1", "r2"), model.rows.map { it.id })
    assertEquals("#1042", model.detail(model.rows[0]))
    model.drafts["r1"] = PosWristbandDraft("214", "Blue")
    model.checkIn(listOf(model.rows[0]))
    val sent = seen.last()
    assertEquals("check_in", sent.body["action"].text())
    assertEquals("reg1", sent.body["registerId"].text())
    assertEquals("pin-assertion", sent.body["cashierAssertion"].text())
    assertEquals(Json.parseToJsonElement("""[{"id":"r1","wristband":{"number":"214","color":"Blue"}}]"""), sent.body["checkIns"])
    assertNotNull(sent.key, "a retried tap is the same check-in")
    assertTrue(model.rows[0].checkedIn)
    assertEquals("Checked in at 9:54 AM by Sam · Blue #214", model.detail(model.rows[0]))
    assertEquals(listOf("r2"), model.waiting.map { it.id })
    assertEquals(1, model.checkedInCount)
  }

  @Test
  fun aJunkWristbandIsRefusedBeforeAnythingIsSent() = runTest {
    val seen = mutableListOf<Seen>()
    val api = window(seen, 200 to """{"dayKey":"2026-10-25","timeZone":"UTC","customer":null,"checkIns":[${row("r1")}]}""")
    val model = PosCheckInModel(api, this, { "reg1" }, { null })
    model.open(PosCheckInTarget(email = "ana@example.com"))
    model.drafts["r1"] = PosWristbandDraft("12 3", "")
    model.checkIn(model.rows)
    assertEquals("A wristband number is letters, digits and dashes.", model.error)
    assertEquals(1, seen.size)
  }

  @Test
  fun someoneAlreadyCheckedInSaysWhenAndByWhomAndUndoTakesItBack() = runTest {
    val seen = mutableListOf<Seen>()
    val already = row("r1", "checked_in", ""","checkedInAtMs":1792940040000,"checkedInByName":"Sam"""")
    val api = window(
      seen,
      200 to """{"dayKey":"2026-10-25","timeZone":"America/Chicago","checkIns":[${row("r1")}]}""",
      200 to """{"checkedIn":[],"alreadyCheckedIn":[$already],"missing":[]}""",
      200 to """{"checkIn":${row("r1")}}""",
    )
    val model = PosCheckInModel(api, this, { "reg1" }, { null })
    model.open(PosCheckInTarget(email = "ana@example.com"))
    model.checkIn(model.rows)
    assertEquals("Already checked in at 9:54 AM by Sam", model.notice)
    model.undo(model.rows[0])
    assertEquals("undo", seen.last().body["action"].text())
    assertEquals("r1", seen.last().body["id"].text())
    assertFalse(model.rows[0].checkedIn)
  }

  @Test
  fun nothingDueSaysSoAndARefusalIsTheRoutesWords() = runTest {
    val seen = mutableListOf<Seen>()
    val api = window(
      seen,
      200 to """{"dayKey":"2026-10-25","timeZone":"UTC","customer":null,"checkIns":[]}""",
      403 to """{"error":"Check-in needs the POS on your plan."}""",
    )
    val model = PosCheckInModel(api, this, { null }, { null })
    model.open(PosCheckInTarget(email = "ana@example.com"))
    assertEquals("Nothing to check in today for this customer.", model.notice)
    model.open(PosCheckInTarget(email = "ana@example.com"))
    assertEquals("Check-in needs the POS on your plan.", model.error)
  }

  @Test
  fun theAttachedCustomersCountAsksIfUsedAndCountsWhoWaits() = runTest {
    val seen = mutableListOf<Seen>()
    val api = window(seen, 200 to """{"dayKey":"2026-10-25","timeZone":"UTC","checkIns":[${row("r1")},${row("r2", "checked_in")}]}""")
    val due = PosCheckInDue(api)
    due.load(PosCustomer("contact", "c1", "Ana Ruiz", "ana@example.com"))
    assertEquals("if-used", seen[0].body["reconcile"].text())
    assertEquals("ana@example.com", seen[0].body["email"].text())
    assertEquals("2026-10-25", due.dayKey)
    assertEquals(1, due.waiting)
    assertEquals(2, due.total)
    assertNull(checkInTarget(PosCustomer("none")))
    assertEquals("c9", checkInTarget(PosCustomer("contact", "c9", "Lee"))?.contactId)
  }

  @Test
  fun theZoneIsHandedTheConsolesPropsAndNothingElse() {
    assertEquals(
      mapOf("hostId" to "h1", "contactId" to "c1", "email" to "ana@example.com", "dayKey" to "2026-10-25", "name" to "Ana Ruiz", "unitsDue" to "3", "placement" to "check-in-row"),
      posCheckInZoneParams("h1", "c1", "Ana@Example.com", "2026-10-25", "Ana Ruiz", 3, "check-in-row"),
    )
  }
}
