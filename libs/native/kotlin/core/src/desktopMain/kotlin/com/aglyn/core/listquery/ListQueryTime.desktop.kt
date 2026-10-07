package com.aglyn.core.listquery

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val DAY_ONLY = Regex("^(\\d{4})-(\\d{2})-(\\d{2})(?:T00:00:00(?:\\.000)?Z)?$")

internal actual fun listQueryDayBounds(raw: String, timeZone: String?): Pair<Long, Long>? {
  val zone = timeZone?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()
  // A bare day (or that day at UTC midnight) names the day itself; anything
  // else is an instant, and names the day it falls on here.
  val day: LocalDate = DAY_ONLY.matchEntire(raw)?.let { match ->
    runCatching { LocalDate.of(match.groupValues[1].toInt(), match.groupValues[2].toInt(), match.groupValues[3].toInt()) }.getOrNull()
  } ?: runCatching { OffsetDateTime.parse(raw).atZoneSameInstant(zone).toLocalDate() }.getOrNull()
    ?: runCatching { LocalDateTime.parse(raw).toLocalDate() }.getOrNull()
    ?: return null
  val start = day.atStartOfDay(zone).toInstant().toEpochMilli()
  val end = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
  return start to end
}

private val ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneId.of("UTC"))

internal actual fun isoInstant(epochMillis: Long): String = ISO.format(Instant.ofEpochMilli(epochMillis))

internal actual fun parseIsoInstant(iso: String): Long? = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
