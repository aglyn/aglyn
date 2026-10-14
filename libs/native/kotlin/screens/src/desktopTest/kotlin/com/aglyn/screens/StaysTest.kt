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
  fun aDateReadsAsUtcMidnightAndAnythingElseIsNoDate() {
    assertEquals(0L, Stays.dayMs("1970-01-01"))
    assertEquals(1_791_936_000_000L, Stays.dayMs("2026-10-14"))
    assertEquals(Stays.dayMs("2024-03-01")!! - Stays.DAY_MS, Stays.dayMs("2024-02-29"), "a leap day")
    assertNull(Stays.dayMs("2026-13-01"))
    assertNull(Stays.dayMs("soon"))
    assertNull(Stays.resource(mapOf("name" to "Room")))
  }
}
