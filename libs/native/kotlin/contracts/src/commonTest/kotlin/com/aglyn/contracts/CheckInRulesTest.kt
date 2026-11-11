package com.aglyn.contracts

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The check-in day helpers replay the console's recorded cases; the row labels hold commerce-check-in.spec.ts's answers. */
class CheckInRulesTest {
  private val functions =
    ContractJsonFormat.parseToJsonElement(ContractCaseJson.functionCases).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String): List<Pair<JsonArray, JsonElement>> =
    functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
      it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
    }.also { assertTrue(it.isNotEmpty(), "$name has no cases") }

  private fun plain(value: JsonElement): Any? = if (value is JsonNull) null else (value as? JsonPrimitive)?.contentOrNull

  @Test
  fun dayHelpersAsTheConsole() {
    cases("checkInDayLabel").forEach { (args, result) -> assertEquals(result.jsonPrimitive.content, checkInDayLabel(plain(args[0]) as String?), args.toString()) }
    cases("isCheckInDayKey").forEach { (args, result) -> assertEquals(result.jsonPrimitive.boolean, isCheckInDayKey(plain(args[0])), args.toString()) }
    cases("addCheckInDays").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.content, addCheckInDays(args[0].jsonPrimitive.content, args[1].jsonPrimitive.double), args.toString())
    }
    cases("checkInUseDayProblem").forEach { (args, result) ->
      assertEquals(plain(result), checkInUseDayProblem(plain(args[0]), args[1].jsonPrimitive.content), args.toString())
    }
  }

  /** The product editor's setting (AGL-4063): what a stored `checkIn` reads as, replayed from the console's answers. */
  @Test
  fun productSettingAsTheConsole() {
    cases("normalizeProductCheckIn").forEach { (args, result) ->
      val got = normalizeProductCheckIn(plainOf(args[0]))
      val want = plainOf(result) as? Map<*, *>
      if (want == null) {
        assertNull(got, args.toString())
      } else {
        assertEquals(want["enabled"], got?.enabled, args.toString())
        assertEquals((want["headcount"] as? Number)?.toDouble(), got?.headcount, args.toString())
        assertEquals(want["askUseDate"], got?.askUseDate, args.toString())
      }
    }
  }

  /** People per item from what was typed, as the console's field reads it: blank or not a number is 1, capped at 50. */
  @Test
  fun headcountFromTyping() {
    assertEquals(4, checkInHeadcount("4"))
    assertEquals(12, checkInHeadcount(" 12 "))
    assertEquals(1, checkInHeadcount(""))
    assertEquals(1, checkInHeadcount("0"))
    assertEquals(1, checkInHeadcount("abc"))
    assertEquals(3, checkInHeadcount("2.5"))
    assertEquals(Contracts.checkInMaxHeadcount.toInt(), checkInHeadcount("999"))
    assertEquals(1, checkInHeadcount(null))
  }

  private fun number(value: JsonElement?): Double? = (value as? JsonPrimitive)?.contentOrNull?.toDoubleOrNull()

  @Test
  fun guestsAsTheConsole() {
    cases("resourceGuestCeiling").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.double.toInt(), resourceGuestCeiling(number((args[0] as? kotlinx.serialization.json.JsonObject)?.get("capacity"))), args.toString())
    }
    cases("reservationGuests").forEach { (args, result) ->
      assertEquals(result.jsonPrimitive.double.toInt(), reservationGuests(number((args[0] as? kotlinx.serialization.json.JsonObject)?.get("guests"))), args.toString())
    }
    cases("reservationGuestsProblem").forEach { (args, result) ->
      assertEquals(plain(result), reservationGuestsProblem(number(args[0]), number((args[1] as? kotlinx.serialization.json.JsonObject)?.get("capacity"))), args.toString())
    }
  }

  private fun pass(
    status: CheckInStatus = CheckInStatus.EXPECTED,
    rainCheck: CheckInRainCheck? = null,
    rainCheckOpen: Boolean? = null,
    variantLabel: String? = null,
    unitIndex: Double = 0.0,
    unitCount: Double = 1.0,
    source: HostCheckInSource = HostCheckInSource.ORDER,
    dayKey: String = "2027-01-15",
  ) = HostCheckIn(
    channel = HostCheckInChannel.POS, createdAtMs = 1.0, customerKey = "k", dayKey = dayKey, itemName = "Day pass",
    searchTokens = emptyList(), source = source, status = status, unitCount = unitCount, unitIndex = unitIndex, updatedAtMs = 1.0,
    rainCheck = rainCheck, rainCheckOpen = rainCheckOpen, variantLabel = variantLabel,
  )

  @Test
  fun rowLabelsAsTheConsoleSpec() {
    assertEquals("Day pass · Adult (2 of 3)", checkInItemLabel(pass(variantLabel = "Adult", unitIndex = 1.0, unitCount = 3.0)))
    assertEquals("Day pass", checkInItemLabel(pass()))
    assertEquals("Blue #214", describeWristband(CheckInWristband(color = "Blue", number = "214")))
    assertEquals("", describeWristband(null))
    val rainCheck = CheckInRainCheck(atMs = 1.0, byName = "Cal", byUid = "cashier", fromDayKey = "2027-01-15", kind = CheckInRainCheckKind.OPEN)
    assertEquals("Rain check from Fri, Jan 15: good on any later day", rainCheckLabel(pass(rainCheck = rainCheck, rainCheckOpen = true)))
    assertEquals("Rain check from Fri, Jan 15, used Sun, Jan 17", rainCheckLabel(pass(rainCheck = rainCheck.copy(claimedDayKey = "2027-01-17"))))
    assertEquals(
      "Rain check: moved from Fri, Jan 15 to Sat, Jan 16",
      rainCheckLabel(pass(rainCheck = rainCheck.copy(kind = CheckInRainCheckKind.DATE, toDayKey = "2027-01-16"))),
    )
    assertEquals("", rainCheckLabel(pass()))
    assertEquals("Rain check", checkInStatusLabel(pass(rainCheckOpen = true)))
    assertEquals("Checked in", checkInStatusLabel(pass(status = CheckInStatus.CHECKED_IN)))
    assertEquals("Expected", checkInStatusLabel(pass()))
    assertEquals(
      CheckInDayTotals(checkedIn = 1.0, expected = 2.0, rainChecks = 1.0),
      checkInDayTotals(listOf(pass(rainCheckOpen = true), pass(), pass(status = CheckInStatus.CHECKED_IN))),
    )
    assertNull(rainCheckProblem(pass(dayKey = "2027-01-14"), "date", "2027-01-15", "2027-01-15"))
    assertTrue(rainCheckProblem(pass(dayKey = "2027-01-10"), "date", "2027-01-12", "2027-01-15")!!.contains("passed"))
    assertEquals("Choose a day after the one the pass is on.", rainCheckProblem(pass(), "date", "2027-01-15", "2027-01-15"))
    assertEquals("They are already checked in. Undo the check-in first.", rainCheckProblem(pass(status = CheckInStatus.CHECKED_IN), "open", null, "2027-01-15"))
    assertEquals(
      "Only passes can be rain-checked. Change a stay’s dates on the Reservations card.",
      rainCheckProblem(pass(source = HostCheckInSource.RESERVATION), "open", null, "2027-01-15"),
    )
    assertEquals("Already checked in at 9:05 AM by Sam", alreadyCheckedInLabel("9:05 AM", "Sam"))
    assertEquals("Already checked in", alreadyCheckedInLabel("", null))
  }
}
