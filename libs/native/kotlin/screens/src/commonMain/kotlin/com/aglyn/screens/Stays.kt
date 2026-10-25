package com.aglyn.screens

import com.aglyn.contracts.Contracts
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** A season of a resource's year, by month and day (`06-01` to `08-31`; it may wrap the new year): its nights cost `multiplier` times as much. */
internal data class StaySeason(val from: String, val to: String, val multiplier: Double)

/** Dates the resource is closed for, by the day the block starts and the day it ends. */
internal data class StayBlock(val fromDayMs: Long, val toDayMs: Long)

/** What a stay is priced and checked against: a resource of the store's reservations. */
internal data class StayResource(
  val nightlyRateUsd: Double,
  val weekendMultiplier: Double?,
  val seasons: List<StaySeason>,
  val blocks: List<StayBlock>,
  val minNights: Double?,
  val depositPct: Double?,
  /** How many identical units the resource holds (12 RV hookups): 1 to [Stays.maxUnits], and 1 for one that never set it. */
  val units: Int = 1,
)

/** One night of a resource: how many of its units are still free. */
internal data class StayNight(val dayMs: Long, val unitsLeft: Int, val units: Int)

/** A reservation as an availability check reads it. */
internal data class StayBooked(val checkInDayMs: Long, val checkOutDayMs: Long, val status: String, val createdAtMs: Long?)

internal data class StayQuote(
  val nights: Int,
  val subtotalCents: Long,
  val depositCents: Long,
  val totalCents: Long,
  val nightlyCents: List<Long>,
  val problem: String?,
)

/**
 * The console's reservation pricing and availability (`commerce-reservations.ts`), for the front desk's walk-in: the nightly
 * rate for each night (weekends and seasons), the quote for a stay, and whether a range of dates clashes with a live
 * reservation or a block. `stays-cases.json` was made from the console's functions and both platforms replay it.
 */
internal object Stays {
  const val DAY_MS = 24L * 60 * 60 * 1000

  /** An unpaid `pending` reservation holds its dates only this long. */
  val PENDING_HOLD_MS: Long get() = Contracts.pendingReservationHoldMs.toLong()

  /** The most identical units one resource can hold. */
  val maxUnits: Int get() = Contracts.maxResourceUnits.toInt()

  /** A night with this many units left, or fewer, reads as scarce. */
  val fewUnitsLeft: Int get() = Contracts.fewUnitsLeft.toInt()

  /** How many nights ahead the Reservations screen draws a several-unit resource's units, as the console's card does. */
  const val LOOKAHEAD_NIGHTS = 14

  /**
   * The resource's stored `units` as the console reads it (`resourceUnits`): JavaScript's `Math.floor(Number(units))`, from 1
   * to [maxUnits], and 1 for anything else (absent, zero, negative, not a number).
   */
  fun units(raw: Any?): Int {
    val value = when (raw) {
      null -> Double.NaN
      is Boolean -> if (raw) 1.0 else 0.0
      is Number -> raw.toDouble()
      is String -> raw.trim().let { if (it.isEmpty()) 0.0 else it.toDoubleOrNull() ?: Double.NaN }
      else -> Double.NaN
    }
    val whole = floor(value)
    if (!whole.isFinite() || whole < 1) return 1
    return min(maxUnits.toDouble(), whole).toInt()
  }

  /** JavaScript's `Math.round`: halves go up. */
  private fun round(value: Double): Long = floor(value + 0.5).toLong()

  private fun floorDiv(a: Long, b: Long): Long = a.floorDiv(b)

  /** A date `2026-10-14` as UTC midnight, or null when it is not one. */
  fun dayMs(iso: String): Long? {
    val parts = iso.trim().split('-')
    if (parts.size != 3) return null
    val y = parts[0].toLongOrNull() ?: return null
    val m = parts[1].toLongOrNull() ?: return null
    val d = parts[2].toLongOrNull() ?: return null
    if (m !in 1..12 || d !in 1..31) return null
    // Days from the civil date (proleptic Gregorian), counted from 1970-01-01.
    val year = if (m <= 2) y - 1 else y
    val era = floorDiv(year, 400)
    val yoe = year - era * 400
    val doy = (153 * (if (m > 2) m - 3 else m + 9) + 2) / 5 + d - 1
    val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return (era * 146097 + doe - 719468) * DAY_MS
  }

  private fun monthDay(dayMs: Long): String {
    val z = floorDiv(dayMs, DAY_MS) + 719468
    val era = floorDiv(z, 146097)
    val doe = z - era * 146097
    val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    val mp = (5 * doy + 2) / 153
    val day = doy - (153 * mp + 2) / 5 + 1
    val month = if (mp < 10) mp + 3 else mp - 9
    return "${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}"
  }

  private fun weekday(dayMs: Long): Int = (floorDiv(dayMs, DAY_MS) + 4).mod(7)

  private fun inSeason(dayKey: String, season: StaySeason): Boolean =
    if (season.from <= season.to) dayKey >= season.from && dayKey <= season.to else dayKey >= season.from || dayKey <= season.to

  /** The rate in cents for one night. */
  fun nightlyRateCents(resource: StayResource, dayMs: Long): Long {
    var rate = resource.nightlyRateUsd * 100
    val day = weekday(dayMs)
    val weekend = resource.weekendMultiplier
    if ((day == 5 || day == 6) && weekend != null && weekend != 0.0) rate *= weekend
    val key = monthDay(dayMs)
    resource.seasons.firstOrNull { inSeason(key, it) }?.let { rate *= it.multiplier }
    return round(rate)
  }

  /** Prices a stay; `problem` is set (and the figures are zero) when the range is not one that can be booked. */
  fun quote(resource: StayResource, checkInDayMs: Long, checkOutDayMs: Long): StayQuote {
    val nights = round((checkOutDayMs - checkInDayMs).toDouble() / DAY_MS).toInt()
    val empty = StayQuote(0, 0, 0, 0, emptyList(), null)
    if (nights <= 0) return empty.copy(problem = "Choose at least one night")
    val minNights = resource.minNights
    if (minNights != null && minNights != 0.0 && nights < minNights) {
      return empty.copy(problem = "Minimum stay is ${if (minNights % 1.0 == 0.0) minNights.toLong().toString() else minNights.toString()} nights")
    }
    val nightly = generateSequence(checkInDayMs) { it + DAY_MS }.takeWhile { it < checkOutDayMs }.map { nightlyRateCents(resource, it) }.toList()
    val subtotal = nightly.sum()
    val depositPct = min(100.0, max(0.0, resource.depositPct ?: 100.0))
    return StayQuote(nights, subtotal, round(subtotal * depositPct / 100), subtotal, nightly, null)
  }

  /** Whether a reservation still stands between a guest and its dates: not cancelled or a no-show, and a `pending` one only while it is fresh. */
  fun holdsDates(booked: StayBooked, nowMs: Long): Boolean {
    if (booked.status == "cancelled" || booked.status == "no_show") return false
    if (booked.status != "pending") return true
    val created = booked.createdAtMs ?: 0
    return created > 0 && nowMs - created < PENDING_HOLD_MS
  }

  /**
   * How many units are taken on each night from [fromDayMs] up to (not including) [toDayMs], one entry per night, counting only
   * the stays that still hold their dates. A stay takes a night it overlaps, so one that leaves the morning another arrives does not.
   */
  fun unitsTakenByNight(booked: List<StayBooked>, fromDayMs: Long, toDayMs: Long, nowMs: Long): List<Int> {
    val live = booked.filter { holdsDates(it, nowMs) }
    val taken = mutableListOf<Int>()
    var night = fromDayMs
    while (night < toDayMs) {
      val nightEnd = min(night + DAY_MS, toDayMs)
      taken += live.count { it.checkInDayMs < nightEnd && it.checkOutDayMs > night }
      night += DAY_MS
    }
    return taken
  }

  /** Units left on each of [nights] nights from [fromDayMs]: the units less the stays holding that night, none on a blocked night. */
  fun unitsLeftByNight(resource: StayResource, booked: List<StayBooked>, fromDayMs: Long, nights: Int, nowMs: Long): List<StayNight> {
    val toDayMs = fromDayMs + max(0, nights) * DAY_MS
    return unitsTakenByNight(booked, fromDayMs, toDayMs, nowMs).mapIndexed { index, taken ->
      val night = fromDayMs + index * DAY_MS
      val blocked = resource.blocks.any { night < it.toDayMs && night + DAY_MS > it.fromDayMs }
      StayNight(night, if (blocked) 0 else max(0, resource.units - taken), resource.units)
    }
  }

  /**
   * A range is free when no block touches it and, on EVERY night of it, fewer live stays overlap that night than the resource has
   * units; back-to-back stays touch without clashing. One unit (every resource that never set `units`) clashes with any live stay
   * it overlaps, as a resource always has.
   */
  fun isRangeAvailable(resource: StayResource, booked: List<StayBooked>, checkInDayMs: Long, checkOutDayMs: Long, nowMs: Long): Boolean {
    if (checkOutDayMs <= checkInDayMs) return false
    for (block in resource.blocks) if (checkInDayMs < block.toDayMs && checkOutDayMs > block.fromDayMs) return false
    if (resource.units == 1) {
      for (stay in booked) {
        if (!holdsDates(stay, nowMs)) continue
        if (checkInDayMs < stay.checkOutDayMs && checkOutDayMs > stay.checkInDayMs) return false
      }
      return true
    }
    return unitsTakenByNight(booked, checkInDayMs, checkOutDayMs, nowMs).all { it < resource.units }
  }

  /** What the front desk is told when a walk-in's dates are not free, in the console's words. */
  fun takenMessage(resource: StayResource): String =
    if (resource.units > 1) "Every unit is taken on at least one of those nights" else "Those dates are taken"

  /** Today on the device's calendar (or [zone]'s) as the UTC midnight stays are stored in (the console's `localTodayDayMs`). */
  fun localToday(nowMs: Long, zone: String?): Long {
    val (year, month, day) = localParts(nowMs, zone)
    return dayMs("${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}") ?: 0
  }

  private val weekdayNames = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
  private val monthNames = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

  /** A night as the console's Reservations card names it: `Mon, Oct 26` (US English, in UTC, as the card prints it). */
  fun nightLabel(dayMs: Long): String {
    val (month, day) = monthDay(dayMs).split('-').map { it.toInt() }
    return "${weekdayNames[weekday(dayMs)]}, ${monthNames[month - 1]} $day"
  }

  /**
   * The Reservations screen's look-ahead (`derive: "unitsAhead"`): for each resource with several units, its next
   * [LOOKAHEAD_NIGHTS] nights from [todayDayMs] as `{ dayMs, label, unitsLeft, units, tone }`, keyed by resource id. [resources]
   * and [stays] are query answers (`{ items }`) or plain lists. A resource with one unit is left out, as the console's card leaves it.
   */
  fun unitsAhead(resources: JsonElement?, stays: JsonElement?, todayDayMs: Long, nowMs: Long): JsonElement {
    fun rows(value: JsonElement?): List<JsonElement> = ScreenValues.rows((value as? JsonObject)?.get("items") ?: value)
    @Suppress("UNCHECKED_CAST")
    fun data(row: JsonElement): Map<String, Any?>? = ScreenModel.plain(row) as? Map<String, Any?>
    val booked = rows(stays).mapNotNull { stay ->
      val id = ((stay as? JsonObject)?.get("resourceId") as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
      val held = data(stay)?.let { booked(it) } ?: return@mapNotNull null
      id to held
    }
    val byResource = linkedMapOf<String, JsonElement>()
    for (row in rows(resources)) {
      val id = ((row as? JsonObject)?.get("\$id") as? JsonPrimitive)?.contentOrNull ?: continue
      val stored = data(row) ?: continue
      val units = units(stored["units"])
      if (units <= 1) continue
      val blocks = resource(mapOf("nightlyRateUsd" to 0.0, "blocks" to stored["blocks"]))?.blocks.orEmpty()
      val unit = StayResource(0.0, null, emptyList(), blocks, null, null, units)
      val nights = unitsLeftByNight(unit, booked.filter { it.first == id }.map { it.second }, todayDayMs, LOOKAHEAD_NIGHTS, nowMs)
      byResource[id] = JsonArray(
        nights.map { night ->
          val tone = if (night.unitsLeft == 0) "error" else if (night.unitsLeft <= fewUnitsLeft) "warning" else "neutral"
          JsonObject(
            mapOf(
              "dayMs" to JsonPrimitive(night.dayMs),
              "label" to JsonPrimitive(nightLabel(night.dayMs)),
              "unitsLeft" to JsonPrimitive(night.unitsLeft),
              "units" to JsonPrimitive(night.units),
              "tone" to JsonPrimitive(tone),
            ),
          )
        },
      )
    }
    return JsonObject(byResource)
  }

  private fun number(value: Any?): Double? = (value as? Number)?.toDouble()

  /** A stored resource as the pricing reads it; null when it is not one (no nightly rate). */
  fun resource(data: Map<String, Any?>?): StayResource? {
    val rate = number(data?.get("nightlyRateUsd")) ?: return null
    fun maps(key: String): List<Map<*, *>> = (data?.get(key) as? List<*>).orEmpty().filterIsInstance<Map<*, *>>()
    return StayResource(
      nightlyRateUsd = rate,
      weekendMultiplier = number(data?.get("weekendMultiplier")),
      seasons = maps("seasons").mapNotNull { s ->
        StaySeason(s["from"] as? String ?: return@mapNotNull null, s["to"] as? String ?: return@mapNotNull null, number(s["multiplier"]) ?: return@mapNotNull null)
      },
      blocks = maps("blocks").mapNotNull { b -> StayBlock(number(b["fromDayMs"])?.toLong() ?: return@mapNotNull null, number(b["toDayMs"])?.toLong() ?: return@mapNotNull null) },
      minNights = number(data?.get("minNights")),
      depositPct = number(data?.get("depositPct")),
      units = units(data?.get("units")),
    )
  }

  /** A stored reservation as the availability check reads it. */
  fun booked(data: Map<String, Any?>): StayBooked? = StayBooked(
    number(data["checkInDayMs"])?.toLong() ?: return null,
    number(data["checkOutDayMs"])?.toLong() ?: return null,
    data["status"] as? String ?: "",
    number(data["createdAtMs"])?.toLong(),
  )
}
