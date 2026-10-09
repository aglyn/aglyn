package com.aglyn.contracts

/**
 * The starts (epoch ms) of [days] local calendar days ending with the day
 * holding [nowMs], oldest first, stepping by calendar day so a daylight-saving
 * change never skews a bucket. [timeZone] is an IANA zone; null is the
 * device's, as the console reads days in the browser's.
 */
expect fun localDayStarts(nowMs: Long, days: Int, timeZone: String? = null): List<Long>

/** The start of the local day holding [atMs]. */
fun startOfLocalDay(atMs: Long, timeZone: String? = null): Long = localDayStarts(atMs, 1, timeZone).single()

/** [atMs] as a local date in a `java.time` pattern (`EEE` a short weekday, `MMM d` a date), in the device's language. */
expect fun formatLocalDay(atMs: Long, pattern: String, timeZone: String? = null): String

/** [text] in Unicode compatibility decomposition (NFKD), as `String.normalize('NFKD')`. */
expect fun normalizeNfkd(text: String): String

/** A moment's wall-clock reading in a zone: month 1–12, weekday 0 (Sunday) – 6, as JavaScript counts them. */
data class LocalParts(val year: Int, val month: Int, val day: Int, val weekday: Int, val hour: Int, val minute: Int) {
  /** Minutes since local midnight. */
  val minutes: Int get() = hour * 60 + minute
  /** `YYYY-MM-DD`, a calendar day's key. */
  val dayKey: String get() = "$year-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}"
}

/** [atMs] read on the wall clock of [timeZone] (an IANA zone; null is the device's). */
expect fun localParts(atMs: Long, timeZone: String? = null): LocalParts

/** The start of a local calendar day; a day past a month's end rolls over, as `Date` does. */
expect fun localDayStart(year: Int, month: Int, day: Int, timeZone: String? = null): Long

/** The device's IANA zone. */
expect fun deviceTimeZone(): String

/** Every IANA zone this platform knows, sorted. */
expect fun knownTimeZones(): List<String>

/** The start of the local day [days] calendar days from the one holding [atMs], daylight-saving safe. */
fun shiftLocalDays(atMs: Long, days: Int, timeZone: String? = null): Long {
  val parts = localParts(atMs, timeZone)
  return localDayStart(parts.year, parts.month, parts.day + days, timeZone)
}

/** The start of the first day of the month [months] months from the one holding [atMs]. */
fun shiftLocalMonths(atMs: Long, months: Int, timeZone: String? = null): Long {
  val parts = localParts(atMs, timeZone)
  val index = parts.year * 12 + (parts.month - 1) + months
  return localDayStart(index.floorDiv(12), index.mod(12) + 1, 1, timeZone)
}

/** The start of the week (Sunday, as the console's weekday keys count) holding [atMs]. */
fun startOfLocalWeek(atMs: Long, timeZone: String? = null): Long =
  shiftLocalDays(atMs, -localParts(atMs, timeZone).weekday, timeZone)
