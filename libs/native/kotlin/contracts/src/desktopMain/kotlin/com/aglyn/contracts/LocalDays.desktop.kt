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

actual fun normalizeNfkd(text: String): String = java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFKD)

private fun zoneOf(timeZone: String?): ZoneId = timeZone?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()

actual fun localParts(atMs: Long, timeZone: String?): LocalParts {
  val at = Instant.ofEpochMilli(atMs).atZone(zoneOf(timeZone))
  return LocalParts(at.year, at.monthValue, at.dayOfMonth, at.dayOfWeek.value % 7, at.hour, at.minute)
}

actual fun localDayStart(year: Int, month: Int, day: Int, timeZone: String?): Long =
  java.time.LocalDate.of(year, month, 1).plusDays((day - 1).toLong()).atStartOfDay(zoneOf(timeZone)).toInstant().toEpochMilli()

actual fun deviceTimeZone(): String = ZoneId.systemDefault().id

actual fun knownTimeZones(): List<String> = listOf("UTC") + ZoneId.getAvailableZoneIds().filter { '/' in it && !it.startsWith("Etc/") && !it.startsWith("SystemV/") }.sorted()
