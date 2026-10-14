package com.aglyn.contracts

/*
 * The model behind the weekly hours picker (weekly-hours.ts): seven days, each
 * a list of open intervals in minutes since midnight. Index 0 is Sunday, as
 * `Date#getDay` counts.
 *
 * Opening hours, pickup hours and delivery windows are STORED as text lines in
 * `schema.org`'s `openingHours` syntax (`Mo-Fr 09:00-17:00`), which the
 * structured-data serializer and checkout read. The picker writes those same
 * lines, so nothing downstream changes; nobody types them.
 */

data class WeeklyHoursInterval(val start: Int, val end: Int)

/** Seven entries, Sunday first; an empty list is a closed day. */
typealias WeeklyHours = List<List<WeeklyHoursInterval>>

/** A day of the week as the picker lists it: Monday first, with the index `weeklyHours` keeps it under. */
data class WeeklyHoursDay(val index: Int, val name: String, val short: String)

val WEEKLY_HOURS_DAYS: List<WeeklyHoursDay> = listOf(
  WeeklyHoursDay(1, "Monday", "Mo"),
  WeeklyHoursDay(2, "Tuesday", "Tu"),
  WeeklyHoursDay(3, "Wednesday", "We"),
  WeeklyHoursDay(4, "Thursday", "Th"),
  WeeklyHoursDay(5, "Friday", "Fr"),
  WeeklyHoursDay(6, "Saturday", "Sa"),
  WeeklyHoursDay(0, "Sunday", "Su"),
)

private val FULL_NAMES = listOf("sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday")

/** An all-closed week. */
fun emptyWeeklyHours(): WeeklyHours = List(7) { emptyList() }

/** `540` -> `09:00`. */
fun formatClockMinutes(minutes: Int): String = "${(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}"

/** `540` -> `9:00 AM`, for a menu. */
fun clockLabel(minutes: Int): String {
  val hours = minutes / 60
  val suffix = if (hours < 12) "AM" else "PM"
  val twelve = if (hours % 12 == 0) 12 else hours % 12
  return "$twelve:${(minutes % 60).toString().padStart(2, '0')} $suffix"
}

/** A day token by its shortest unambiguous prefix (`Mo`, `Mon`, `Monday`). */
private fun dayIndex(token: String): Int {
  val wanted = token.trim().lowercase()
  if (wanted.length < 2) return -1
  return FULL_NAMES.indexOfFirst { it.startsWith(wanted) }
}

private fun clock(hours: String, minutes: String): Int {
  val h = hours.toInt()
  val m = minutes.toInt()
  return if (h > 23 || m > 59) -1 else h * 60 + m
}

private val DASH = Regex("\\s*[-–—]\\s*")
private val LINE = Regex("^(.+?)\\s+(\\d{1,2}):(\\d{2})\\s*[-–—]\\s*(\\d{1,2}):(\\d{2})$")

/** Monday-first position, so a range reads the way a week is written. */
private fun mondayFirst(index: Int) = (index + 6) % 7

private fun parseLine(line: String): Pair<List<Int>, WeeklyHoursInterval>? {
  val match = LINE.find(line.trim()) ?: return null
  val start = clock(match.groupValues[2], match.groupValues[3])
  val end = clock(match.groupValues[4], match.groupValues[5])
  if (start < 0 || end < 0) return null
  val days = mutableListOf<Int>()
  for (part in match.groupValues[1].split(',')) {
    val ends = part.trim().split(DASH)
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
  return if (days.isEmpty()) null else days to WeeklyHoursInterval(start, end)
}

private fun sortIntervals(intervals: List<WeeklyHoursInterval>) = intervals.sortedWith(compareBy({ it.start }, { it.end }))

/** Hours text read into the picker's week; the lines that did not read are returned by 1-based number, never silently dropped. */
data class ParsedWeeklyHours(val hours: WeeklyHours, val unreadLines: List<Int>)

fun weeklyHoursFromText(value: String?): ParsedWeeklyHours {
  val hours = List(7) { mutableListOf<WeeklyHoursInterval>() }
  val unread = mutableListOf<Int>()
  value.orEmpty().split(Regex("\r?\n")).forEachIndexed { index, line ->
    if (line.isBlank()) return@forEachIndexed
    val row = parseLine(line)
    if (row == null) {
      unread += index + 1
      return@forEachIndexed
    }
    for (day in row.first) if (hours[day].none { it == row.second }) hours[day] += row.second
  }
  return ParsedWeeklyHours(hours.map { sortIntervals(it) }, unread)
}

/** Monday-first day indexes -> `Mo-Fr`, `Mo,We,Fr`, `Mo-We,Sa`. */
private fun dayList(days: List<Int>): String {
  val positions = days.map(::mondayFirst).sorted()
  val runs = mutableListOf<MutableList<Int>>()
  for (position in positions) {
    val last = runs.lastOrNull()
    if (last != null && last.last() == position - 1) last += position else runs += mutableListOf(position)
  }
  fun short(position: Int) = WEEKLY_HOURS_DAYS[position].short
  return runs.flatMap { run -> if (run.size >= 3) listOf("${short(run.first())}-${short(run.last())}") else run.map(::short) }.joinToString(",")
}

/** The picker's week as hours text: one line per interval per set of days that share it (`Mo-Fr 09:00-17:00`). */
fun weeklyHoursToText(hours: WeeklyHours): String {
  val groups = LinkedHashMap<String, Pair<MutableList<Int>, WeeklyHoursInterval>>()
  for ((index) in WEEKLY_HOURS_DAYS) {
    for (interval in sortIntervals(hours.getOrNull(index).orEmpty())) {
      val key = "${interval.start}-${interval.end}"
      val group = groups[key]
      if (group != null) group.first += index else groups[key] = mutableListOf(index) to interval
    }
  }
  return groups.values
    .sortedWith(compareBy({ mondayFirst(it.first[0]) }, { it.second.start }))
    .joinToString("\n") { (days, interval) -> "${dayList(days)} ${formatClockMinutes(interval.start)}-${formatClockMinutes(interval.end)}" }
}
