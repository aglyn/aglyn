package com.aglyn.screens

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

internal actual fun parseIsoMillis(text: String): Long? =
  runCatching { Instant.parse(text).toEpochMilli() }.getOrNull()
    ?: runCatching { java.time.OffsetDateTime.parse(text).toInstant().toEpochMilli() }.getOrNull()
    ?: runCatching { LocalDate.parse(text).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull()
    // An HTTP date, as Firebase Auth prints account times ("Wed, 07 Oct 2026 22:47:05 GMT").
    ?: runCatching { java.time.ZonedDateTime.parse(text, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() }.getOrNull()

internal actual fun localParts(millis: Long, zone: String?): List<Int> {
  val id = zone?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()
  val t = Instant.ofEpochMilli(millis).atZone(id)
  return listOf(t.year, t.monthValue, t.dayOfMonth, t.hour, t.minute)
}

internal actual fun nowParts(): List<Int> {
  val t = java.time.ZonedDateTime.now(ZoneOffset.UTC)
  return listOf(t.year, t.monthValue)
}

internal actual fun nowMillis(): Long = System.currentTimeMillis()
