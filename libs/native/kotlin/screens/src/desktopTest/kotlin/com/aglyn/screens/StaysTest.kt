package com.aglyn.screens

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Reservation pricing and availability replayed from libs/native/screens/stays-cases.json, which the console's own functions produced (Apple replays the same file). */
class StaysTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "libs/native/screens").isDirectory }
  private val cases = Json.parseToJsonElement(File(root, "libs/native/screens/stays-cases.json").readText()).jsonObject

  private fun plain(value: JsonElement): Any? = ScreenModel.plain(value)

  @Suppress("UNCHECKED_CAST")
  private fun resource(spec: JsonElement): StayResource = Stays.resource(plain(spec) as Map<String, Any?>)!!

  private fun day(iso: String) = Stays.dayMs(iso)!!

  @Test
  fun everyQuoteIsTheConsoles() {
    for (case in cases["quotes"]!!.jsonArray.map { it.jsonObject }) {
      val label = "${case["resource"]} ${case["checkIn"]} to ${case["checkOut"]}"
      val quote = Stays.quote(resource(case["spec"]!!), day((case["checkIn"] as JsonPrimitive).content), day((case["checkOut"] as JsonPrimitive).content))
      val want = case["quote"]!!.jsonObject
      fun long(key: String) = (want[key] as JsonPrimitive).content.toDouble().toLong()
      assertEquals(long("nights").toInt(), quote.nights, label)
      assertEquals(long("subtotalCents"), quote.subtotalCents, label)
      assertEquals(long("depositCents"), quote.depositCents, label)
      assertEquals(long("totalCents"), quote.totalCents, label)
      assertEquals(want["nightlyCents"]!!.jsonArray.map { (it as JsonPrimitive).content.toDouble().toLong() }, quote.nightlyCents, label)
      assertEquals((want["problem"] as? JsonPrimitive)?.takeIf { it.isString }?.content, quote.problem, label)
    }
  }

  @Test
  fun everyAvailabilityIsTheConsoles() {
    val now = (cases["nowMs"] as JsonPrimitive).content.toDouble().toLong()
    @Suppress("UNCHECKED_CAST")
    val booked = (cases["stays"] as JsonArray).map { Stays.booked(plain(it) as Map<String, Any?>)!! }
    @Suppress("UNCHECKED_CAST")
    val closed = Stays.resource(mapOf("nightlyRateUsd" to 1.0, "blocks" to plain(cases["blocks"]!!)) as Map<String, Any?>)!!
    for (case in cases["availability"]!!.jsonArray.map { it.jsonObject }) {
      val label = "${case["checkIn"]} to ${case["checkOut"]}"
      val got = Stays.isRangeAvailable(closed, booked, day((case["checkIn"] as JsonPrimitive).content), day((case["checkOut"] as JsonPrimitive).content), now)
      assertEquals((case["available"] as JsonPrimitive).content == "true", got, label)
    }
  }

  @Test
  fun everyUnitsValueReadsAsTheConsolesDoes() {
    val items = cases["units"]!!.jsonArray.map { it.jsonObject }
    assertTrue(items.size > 10)
    for (case in items) {
      val want = (case["units"] as JsonPrimitive).content.toInt()
      // A case without `raw` is a resource that never stored `units`.
      val raw = case["raw"]?.let { plain(it) }
      assertEquals(want, Stays.units(raw), "${case["raw"] ?: "absent"}")
      @Suppress("UNCHECKED_CAST")
      val stored = mapOf("nightlyRateUsd" to 1.0) + (if ("raw" in case) mapOf("units" to raw) else emptyMap())
      assertEquals(want, Stays.resource(stored)!!.units)
    }
  }

  @Test
  fun everySeveralUnitNightIsCountedAsTheConsoleCountsIt() {
    val now = (cases["nowMs"] as JsonPrimitive).content.toDouble().toLong()
    val scenarios = cases["multiUnit"]!!.jsonArray.map { it.jsonObject }
    assertTrue(scenarios.any { (it["units"] as? JsonPrimitive)?.content?.toDoubleOrNull()?.let { units -> units > 1 } == true })
    for (scenario in scenarios) {
      val name = (scenario["name"] as JsonPrimitive).content
      val stored = mutableMapOf<String, Any?>("nightlyRateUsd" to 1.0, "blocks" to plain(scenario["blocks"]!!))
      scenario["units"]?.let { stored["units"] = plain(it) }
      val resource = Stays.resource(stored)!!
      @Suppress("UNCHECKED_CAST")
      val booked = (scenario["stays"] as JsonArray).map { Stays.booked(plain(it) as Map<String, Any?>)!! }
      for (case in scenario["availability"]!!.jsonArray.map { it.jsonObject }) {
        val label = "$name: ${case["checkIn"]} to ${case["checkOut"]}"
        val got = Stays.isRangeAvailable(resource, booked, day((case["checkIn"] as JsonPrimitive).content), day((case["checkOut"] as JsonPrimitive).content), now)
        assertEquals((case["available"] as JsonPrimitive).content == "true", got, label)
      }
      val want = scenario["nights"]!!.jsonArray.map { it.jsonObject }
      val nights = Stays.unitsLeftByNight(resource, booked, day((scenario["nightsFrom"] as JsonPrimitive).content), want.size, now)
      assertEquals(
        want.map { listOf(day((it["day"] as JsonPrimitive).content), (it["unitsLeft"] as JsonPrimitive).content.toLong(), (it["units"] as JsonPrimitive).content.toLong()) },
        nights.map { listOf(it.dayMs, it.unitsLeft.toLong(), it.units.toLong()) },
        name,
      )
    }
  }

  @Test
  fun theUnitBoundsAndHoldWindowAreTheContracts() {
    assertEquals(com.aglyn.contracts.Contracts.maxResourceUnits.toInt(), Stays.maxUnits)
    assertEquals(500, Stays.maxUnits)
    assertEquals(30L * 60 * 1000, Stays.PENDING_HOLD_MS)
  }

  @Test
  fun todayIsTheDevicesCalendarDayAsUtcMidnight() {
    // 03:30 UTC on Oct 26 is still the evening of Oct 25 in Chicago.
    val late = day("2026-10-26") + 3L * 3600 * 1000 + 30L * 60 * 1000
    assertEquals(day("2026-10-25"), Stays.localToday(late, "America/Chicago"))
    assertEquals(day("2026-10-26"), Stays.localToday(late, "UTC"))
    assertEquals("Fri, Jan 1", Stays.nightLabel(day("2027-01-01")))
  }

  @Test
  fun aTakenWalkInIsSaidInTheConsolesWords() {
    val one = StayResource(1.0, null, emptyList(), emptyList(), null, null)
    assertEquals("Those dates are taken", Stays.takenMessage(one))
    assertEquals("Every unit is taken on at least one of those nights", Stays.takenMessage(one.copy(units = 12)))
  }

  @Test
  fun aDateReadsAsUtcMidnightAndAnythingElseIsNoDate() {
    assertEquals(0L, Stays.dayMs("1970-01-01"))
    assertEquals(1_791_936_000_000L, Stays.dayMs("2026-10-14"))
    assertEquals(Stays.dayMs("2024-03-01")!! - Stays.DAY_MS, Stays.dayMs("2024-02-29"), "a leap day")
    assertNull(Stays.dayMs("2026-13-01"))
    assertNull(Stays.dayMs("soon"))
    assertNull(Stays.resource(mapOf("name" to "Room")))
  }
}
