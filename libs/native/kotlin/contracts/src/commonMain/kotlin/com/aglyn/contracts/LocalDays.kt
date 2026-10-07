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
