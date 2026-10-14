package com.aglyn.screens

/** One open interval of a day, in minutes since midnight; an `end` earlier than `start` runs into the next morning. */
internal data class HoursInterval(val start: Int, val end: Int)

/**
 * A week of opening hours, as the console's weekly hours picker keeps it: seven days, Sunday first (as `Date#getDay`
 * counts), each a list of open intervals. Pickup hours, delivery windows and opening hours are STORED as lines of
 * `schema.org` text (`Mo-Fr 09:00-17:00`), which the storefront reads; the picker writes those same lines so nobody
 * types them. The shared cases in `weekly-hours-cases.json` hold this to the console's own conversion.
 */
internal object WeeklyHours {
  /** The week in display order, Monday first: the day's index (Sunday is 0), its name and its two-letter code. */
  val days: List<Triple<Int, String, String>> = listOf(
    Triple(1, "Monday", "Mo"), Triple(2, "Tuesday", "Tu"), Triple(3, "Wednesday", "We"), Triple(4, "Thursday", "Th"),
    Triple(5, "Friday", "Fr"), Triple(6, "Saturday", "Sa"), Triple(0, "Sunday", "Su"),
  )

  /** The last minute of a day, so a day can run to midnight. */
  const val LAST_MINUTE = 23 * 60 + 59

  /** Every quarter hour, then 11:59 PM. */
  val times: List<Int> = (0 until 96).map { it * 15 } + LAST_MINUTE

  private val fullNames = listOf("sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday")
  private val dash = Regex("""\s*[-–—]\s*""")
  private val line = Regex("""^(.+?)\s+(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$""")

  fun empty(): List<List<HoursInterval>> = List(7) { emptyList() }

  /** `540` as `09:00`. */
  fun clock(minutes: Int): String = "${(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}"

  /** `540` as `9:00 AM`, for a menu. */
  fun label(minutes: Int): String {
    val hours = minutes / 60
    val twelve = if (hours % 12 == 0) 12 else hours % 12
    return "$twelve:${(minutes % 60).toString().padStart(2, '0')} ${if (hours < 12) "AM" else "PM"}"
  }

  private fun dayIndex(token: String): Int {
    val wanted = token.trim().lowercase()
    return if (wanted.length < 2) -1 else fullNames.indexOfFirst { it.startsWith(wanted) }
  }

  private fun minutes(hours: String, minutes: String): Int {
    val h = hours.toInt()
    val m = minutes.toInt()
    return if (h > 23 || m > 59) -1 else h * 60 + m
  }

  /** Monday-first position, so a range reads the way a week is written. */
  private fun mondayFirst(index: Int) = (index + 6) % 7

  private fun parse(text: String): Pair<List<Int>, HoursInterval>? {
    val match = line.matchEntire(text.trim()) ?: return null
    val (names, h1, m1, h2, m2) = match.destructured
    val start = minutes(h1, m1)
    val end = minutes(h2, m2)
    if (start < 0 || end < 0) return null
    val days = mutableListOf<Int>()
    for (part in names.split(',')) {
      val ends = part.trim().split(dash)
      if (ends.size > 2) return null
      val from = dayIndex(ends.first())
      val to = dayIndex(ends.last())
      if (from < 0 || to < 0) return null
      // A range may wrap the weekend: `Fr-Mo` is Friday through Monday.
      val span = (mondayFirst(to) - mondayFirst(from) + 7) % 7
      for (step in 0..span) {
        val day = (from + step) % 7
        if (day !in days) days += day
      }
    }
    return if (days.isEmpty()) null else days to HoursInterval(start, end)
  }

  private fun sorted(intervals: List<HoursInterval>) = intervals.sortedWith(compareBy({ it.start }, { it.end }))

  /** The hours text as a week, and the 1-based numbers of the lines that could not be read (so a saved time is never dropped silently). */
  fun fromText(value: String?): Pair<List<List<HoursInterval>>, List<Int>> {
    val week = List(7) { mutableListOf<HoursInterval>() }
    val unread = mutableListOf<Int>()
    (value ?: "").split(Regex("\r?\n")).forEachIndexed { index, text ->
      if (text.isBlank()) return@forEachIndexed
      val row = parse(text)
      if (row == null) {
        unread += index + 1
        return@forEachIndexed
      }
      for (day in row.first) if (row.second !in week[day]) week[day] += row.second
    }
    return week.map { sorted(it) } to unread
  }

  /** `Mo-Fr`, `Mo,We,Fr`, `Mo-We,Sa`: Monday-first indexes as a day list. */
  private fun dayList(indexes: List<Int>): String {
    val runs = mutableListOf<MutableList<Int>>()
    for (position in indexes.map(::mondayFirst).sorted()) {
      val last = runs.lastOrNull()
      if (last != null && last.last() == position - 1) last += position else runs += mutableListOf(position)
    }
    fun short(position: Int) = days[position].third
    return runs.flatMap { run -> if (run.size >= 3) listOf("${short(run.first())}-${short(run.last())}") else run.map(::short) }.joinToString(",")
  }

  /** The week as hours text: one line per interval per set of days that share it (`Mo-Fr 09:00-17:00`). */
  fun toText(week: List<List<HoursInterval>>): String {
    val groups = LinkedHashMap<String, Pair<MutableList<Int>, HoursInterval>>()
    for ((index, _, _) in days) {
      for (interval in sorted(week.getOrElse(index) { emptyList() })) {
        groups.getOrPut("${interval.start}-${interval.end}") { mutableListOf<Int>() to interval }.first += index
      }
    }
    return groups.values
      .sortedWith(compareBy({ mondayFirst(it.first.first()) }, { it.second.start }))
      .joinToString("\n") { (dayIndexes, interval) -> "${dayList(dayIndexes)} ${clock(interval.start)}-${clock(interval.end)}" }
  }
}
