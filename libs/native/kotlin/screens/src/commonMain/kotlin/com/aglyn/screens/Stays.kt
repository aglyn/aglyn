package com.aglyn.screens

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
)

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
  const val PENDING_HOLD_MS = 30L * 60 * 1000

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

  /** A range clashes with a live reservation, or with a block, when they overlap; back-to-back stays touch without clashing. */
  fun isRangeAvailable(resource: StayResource, booked: List<StayBooked>, checkInDayMs: Long, checkOutDayMs: Long, nowMs: Long): Boolean {
    if (checkOutDayMs <= checkInDayMs) return false
    for (stay in booked) {
      if (!holdsDates(stay, nowMs)) continue
      if (checkInDayMs < stay.checkOutDayMs && checkOutDayMs > stay.checkInDayMs) return false
    }
    for (block in resource.blocks) if (checkInDayMs < block.toDayMs && checkOutDayMs > block.fromDayMs) return false
    return true
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
