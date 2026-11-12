package com.aglyn.contracts

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlin.math.roundToLong

/*
 * Check-in at the window (AGL-4043): who is due on a day, who has checked in, and rain checks, as the console's
 * commerce-check-in.ts and commerce-check-in-product.ts word them. The day helpers replay the console's recorded cases;
 * the row labels are hand-ported from commerce-check-in.ts and held to its spec's answers. The route
 * (`POS_CHECK_IN_ROUTE`) does every write and reads the day. The Apple kit's CheckInRules.swift.
 */

private val DAY_KEY = Regex("^(\\d{4})-(\\d{2})-(\\d{2})$")

private fun dayKeyMs(value: Any?): Long? {
  val match = DAY_KEY.matchEntire(value as? String ?: return null) ?: return null
  val (y, m, d) = match.destructured
  val year = y.toInt()
  val month = m.toInt()
  val day = d.toInt()
  if (month !in 1..12 || day < 1) return null
  val leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
  val days = intArrayOf(31, if (leap) 29 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)[month - 1]
  if (day > days) return null
  return epochDay(year, month, day) * 86_400_000L
}

/** Days since 1970-01-01 for a proleptic Gregorian date. */
private fun epochDay(year: Int, month: Int, day: Int): Long {
  val y = if (month <= 2) year - 1 else year
  val era = (if (y >= 0) y else y - 399) / 400
  val yoe = y - era * 400
  val mp = (month + 9) % 12
  val doy = (153 * mp + 2) / 5 + day - 1
  val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
  return era * 146_097L + doe - 719_468L
}

private fun dayKeyOf(epochMs: Long): String {
  val z = epochMs.floorDiv(86_400_000L) + 719_468L
  val era = (if (z >= 0) z else z - 146_096) / 146_097
  val doe = z - era * 146_097
  val yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
  val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  val mp = (5 * doy + 2) / 153
  val day = doy - (153 * mp + 2) / 5 + 1
  val month = if (mp < 10) mp + 3 else mp - 9
  val year = yoe + era * 400 + if (month <= 2) 1 else 0
  return "${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}"
}

/** Whether a value is a real calendar day written `YYYY-MM-DD` (`isCheckInDayKey`). */
fun isCheckInDayKey(value: Any?): Boolean = dayKeyMs(value) != null

/** The day key `days` after (or before) another (`addCheckInDays`). */
fun addCheckInDays(dayKey: String, days: Double): String {
  val ms = dayKeyMs(dayKey) ?: return dayKey
  return dayKeyOf(ms + kotlin.math.floor(days + 0.5).roundToLong() * 86_400_000L)
}

private val WEEKDAYS = listOf("Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed")
private val MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** A day as the window reads it: "Sat, Nov 1" (`checkInDayLabel`). */
fun checkInDayLabel(dayKey: String?): String {
  val ms = dayKeyMs(dayKey) ?: return ""
  val days = ms / 86_400_000L
  val weekday = WEEKDAYS[days.mod(7)]
  val month = MONTHS[dayKey!!.substring(5, 7).toInt() - 1]
  return "$weekday, $month ${dayKey.substring(8, 10).toInt()}"
}

/**
 * A day key as a date a reader says: "Oct 25, 2026"; "" for a value that is not a day key. The day helpers' month
 * names, so a day reads the same wherever a screen shows one.
 */
fun dayKeyDateLabel(dayKey: String?): String {
  dayKeyMs(dayKey) ?: return ""
  return "${MONTHS[dayKey!!.substring(5, 7).toInt() - 1]} ${dayKey.substring(8, 10).toInt()}, ${dayKey.substring(0, 4).toInt()}"
}

/** Why a chosen use day can't be had, or null (`checkInUseDayProblem`). */
fun checkInUseDayProblem(value: Any?, todayKey: String): String? {
  if (!isCheckInDayKey(value)) return "Choose the day as a date."
  val day = value as String
  if (day < todayKey) return "That day has passed. Choose today or a later day."
  if (day > addCheckInDays(todayKey, Contracts.checkInUseDayMaxAheadDays.toDouble())) return "Choose a day within the next two years."
  return null
}

/** One row of a day's check-ins, as the route lists it: the stored check-in and its id. */
data class CheckInRow(val id: String, val checkIn: HostCheckIn) {
  companion object {
    /** A row off the route's answer; null for one that does not decode. */
    fun from(element: JsonElement?): CheckInRow? {
      val json = element as? JsonObject ?: return null
      val id = (json["id"] as? JsonPrimitive)?.contentOrNull ?: return null
      return runCatching { CheckInRow(id, ContractJsonFormat.decodeFromJsonElement(HostCheckIn.serializer(), json)) }.getOrNull()
    }
  }
}

/** Whether a row is an open rain check still waiting to be used (`checkInRainCheckIsOpen`). */
fun checkInRainCheckIsOpen(row: HostCheckIn): Boolean = row.rainCheckOpen == true && row.status == CheckInStatus.EXPECTED

/** A day's totals (`checkInDayTotals`): open rain checks are not expected on the day. */
fun checkInDayTotals(rows: List<HostCheckIn>): CheckInDayTotals {
  val rainChecks = rows.count(::checkInRainCheckIsOpen)
  return CheckInDayTotals(
    checkedIn = rows.count { it.status == CheckInStatus.CHECKED_IN }.toDouble(),
    expected = (rows.size - rainChecks).toDouble(),
    rainChecks = rainChecks.toDouble(),
  )
}

/** A wristband as the window prints it: "Blue #214" (`describeWristband`). */
fun describeWristband(wristband: CheckInWristband?): String {
  if (wristband == null) return ""
  return listOfNotNull(wristband.color?.ifEmpty { null }, wristband.number?.ifEmpty { null }?.let { "#${it.removePrefix("#")}" }).joinToString(" ")
}

/** The item and which unit it is: "Day pass · Adult (2 of 3)" (`checkInItemLabel`). */
fun checkInItemLabel(row: HostCheckIn): String {
  val item = row.variantLabel?.ifEmpty { null }?.let { "${row.itemName} · $it" } ?: row.itemName
  return if (row.unitCount > 1 && row.unitIndex < row.unitCount) "$item (${row.unitIndex.toInt() + 1} of ${row.unitCount.toInt()})" else item
}

/** "Rain check: moved from … to …", "Rain check from …, used …" or "Rain check from …: good on any later day" (`rainCheckLabel`). */
fun rainCheckLabel(row: HostCheckIn): String {
  val rainCheck = row.rainCheck ?: return ""
  val from = checkInDayLabel(rainCheck.fromDayKey)
  if (rainCheck.kind == CheckInRainCheckKind.DATE) return "Rain check: moved from $from to ${checkInDayLabel(rainCheck.toDayKey)}"
  rainCheck.claimedDayKey?.ifEmpty { null }?.let { return "Rain check from $from, used ${checkInDayLabel(it)}" }
  return "Rain check from $from: good on any later day"
}

/** "Checked in", "Rain check" or "Expected" (`checkInStatusLabel`). */
fun checkInStatusLabel(row: HostCheckIn): String = when {
  row.status == CheckInStatus.CHECKED_IN -> "Checked in"
  checkInRainCheckIsOpen(row) -> "Rain check"
  else -> "Expected"
}

/** Why a rain check can't be given, or null (`rainCheckProblem`). `kind` is `open` or `date`. */
fun rainCheckProblem(row: HostCheckIn, kind: String, dayKey: String?, todayKey: String): String? {
  if (row.source != HostCheckInSource.ORDER) return "Only passes can be rain-checked. Change a stay’s dates on the Reservations card."
  if (row.status != CheckInStatus.EXPECTED) return "They are already checked in. Undo the check-in first."
  if (kind == "open") return null
  if (!isCheckInDayKey(dayKey)) return "Choose the new day as a date."
  if (dayKey!! <= row.dayKey) return "Choose a day after the one the pass is on."
  return checkInUseDayProblem(dayKey, todayKey)
}

/** "Already checked in at 9:05 AM by Sam" (`alreadyCheckedInLabel`); [timeLabel] is the check-in's time in the store's zone. */
fun alreadyCheckedInLabel(timeLabel: String, byName: String?): String =
  "Already checked in" + (if (timeLabel.isNotEmpty()) " at $timeLabel" else "") + (byName?.ifEmpty { null }?.let { " by $it" } ?: "")

/** The stays setting's three choices, in the console's words. */
val STAY_CHECK_IN_MODE_LABELS: List<Pair<String, String>> = listOf(
  "resource" to "As each resource is set",
  "stay" to "One per stay",
  "guest" to "One per guest",
)

/* ---- The product and variant setting (commerce-check-in-product.ts), for the product editor ---- */

/**
 * A whole number of people from 1 to `CHECK_IN_MAX_HEADCOUNT`, from a stored value or what was typed; blank, zero or
 * not a number is 1 (`headcountOf`, and the product editor's `headcountFrom`).
 */
fun checkInHeadcount(value: Any?): Int {
  val rounded = kotlin.math.floor(jsNumber(value) + 0.5)
  if (!rounded.isFinite() || rounded < 1) return 1
  return minOf(rounded, Contracts.checkInMaxHeadcount.toDouble()).toInt()
}

/**
 * A stored check-in setting made safe, or null when it says nothing (`normalizeProductCheckIn`): on carries its people
 * per item and whether the buyer is asked which day; off carries nothing else.
 */
fun normalizeProductCheckIn(value: Any?): ProductCheckIn? {
  val raw = value as? Map<*, *> ?: return null
  val enabled = raw["enabled"] as? Boolean ?: return null
  if (!enabled) return ProductCheckIn(enabled = false)
  return ProductCheckIn(
    askUseDate = if (raw["askUseDate"] == true) true else null,
    enabled = true,
    headcount = checkInHeadcount(raw["headcount"]).toDouble(),
  )
}

/* ---- A stay's guests (commerce-reservations.ts), for the window's Guests dialog ---- */

/** The most guests a stay's resource sleeps, else the platform's ceiling (`resourceGuestCeiling`). */
fun resourceGuestCeiling(capacity: Double?): Int {
  val ceiling = Contracts.maxReservationGuests.toInt()
  val sleeps = capacity?.let { kotlin.math.floor(it) } ?: return ceiling
  return if (sleeps.isFinite() && sleeps >= 1) minOf(sleeps.toInt(), ceiling) else ceiling
}

/** A stay's guests, at least one (`reservationGuests`). */
fun reservationGuests(guests: Double?): Int {
  val count = guests?.let { kotlin.math.floor(it) } ?: return 1
  return if (count.isFinite() && count >= 1) minOf(count.toInt(), Contracts.maxReservationGuests.toInt()) else 1
}

/** Why a guest count can't be stored, or null (`reservationGuestsProblem`); a blank count says nothing. */
fun reservationGuestsProblem(guests: Double?, capacity: Double?): String? {
  if (guests == null) return null
  val ceiling = resourceGuestCeiling(capacity)
  if (guests != kotlin.math.floor(guests) || guests < 1 || guests > ceiling) {
    return if (ceiling == 1) "This stay sleeps 1 guest" else "Guests must be a whole number from 1 to $ceiling"
  }
  return null
}

/** A day key as midnight UTC, for a date picker; null for one that is not a day. */
fun checkInDayKeyMillis(dayKey: String?): Long? = dayKeyMs(dayKey)

/** The day key of an instant in UTC, for a date picker's pick. */
fun checkInDayKeyOfMillis(epochMs: Long): String = dayKeyOf(epochMs)
