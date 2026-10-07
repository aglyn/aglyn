package com.aglyn.contracts

import java.time.Instant
import java.time.ZoneId

actual fun localDayStarts(nowMs: Long, days: Int, timeZone: String?): List<Long> {
  val zone = timeZone?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()
  val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
  return (days - 1 downTo 0).map { back -> today.minusDays(back.toLong()).atStartOfDay(zone).toInstant().toEpochMilli() }
}

actual fun formatLocalDay(atMs: Long, pattern: String, timeZone: String?): String {
  val zone = timeZone?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()
  return java.time.format.DateTimeFormatter.ofPattern(pattern, java.util.Locale.getDefault()).format(Instant.ofEpochMilli(atMs).atZone(zone))
}
