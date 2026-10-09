package com.aglyn.pluginhost

/*
 * UTC calendar arithmetic with no platform clock, for the texts a console
 * `datetime-local` or `date` input holds for a stored instant
 * (`toISOString().slice(0, 16)` and `.slice(0, 10)`).
 */

/** Epoch millis as `YYYY-MM-DDTHH:mm`, in UTC. */
fun utcMinute(epochMillis: Long): String {
  val days = epochMillis.floorDiv(86_400_000L)
  val ofDay = epochMillis.mod(86_400_000L)
  val (year, month, day) = civilFromDays(days)
  val hour = ofDay / 3_600_000L
  val minute = (ofDay / 60_000L) % 60
  return "${pad(year, 4)}-${pad(month.toLong(), 2)}-${pad(day.toLong(), 2)}T${pad(hour, 2)}:${pad(minute, 2)}"
}

/** `YYYY-MM-DDTHH:mm` (UTC) back to epoch millis; null when it is not one. */
fun parseUtcMinute(text: String): Long? {
  val match = Regex("^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})").find(text.trim()) ?: return null
  val (y, mo, d, h, mi) = match.destructured
  val month = mo.toInt()
  val day = d.toInt()
  if (month !in 1..12 || day !in 1..31 || h.toInt() > 23 || mi.toInt() > 59) return null
  return daysFromCivil(y.toLong(), month, day) * 86_400_000L + h.toLong() * 3_600_000L + mi.toLong() * 60_000L
}

private fun pad(value: Long, width: Int): String = value.toString().padStart(width, '0')

private fun civilFromDays(daysSinceEpoch: Long): Triple<Long, Int, Int> {
  val z = daysSinceEpoch + 719_468
  val era = z.floorDiv(146_097L)
  val doe = z - era * 146_097
  val yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365
  val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
  val mp = (5 * doy + 2) / 153
  val day = (doy - (153 * mp + 2) / 5 + 1).toInt()
  val month = (if (mp < 10) mp + 3 else mp - 9).toInt()
  val year = yoe + era * 400 + if (month <= 2) 1 else 0
  return Triple(year, month, day)
}

private fun daysFromCivil(year: Long, month: Int, day: Int): Long {
  val y = if (month <= 2) year - 1 else year
  val era = y.floorDiv(400L)
  val yoe = y - era * 400
  val mp = (month + 9) % 12
  val doy = (153 * mp + 2) / 5 + day - 1
  val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
  return era * 146_097 + doe - 719_468
}

/** Epoch millis as `YYYY-MM-DD`, in UTC. */
fun utcDay(epochMillis: Long): String = utcMinute(epochMillis).substring(0, 10)

/** `YYYY-MM-DD` back to its UTC midnight; null when it is not one. */
fun parseUtcDay(text: String): Long? = parseUtcMinute(text.trim().take(10) + "T00:00")
