package com.aglyn.core

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

actual fun localDateTimeMillis(day: String, time: String): Long? = runCatching {
  LocalDateTime.of(LocalDate.parse(day.trim()), LocalTime.parse(time.trim().padStart(5, '0')))
    .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
}.getOrNull()

actual fun localDayAndTime(millis: Long): Pair<String, String> {
  val local = Instant.ofEpochMilli(millis).atZone(ZoneId.systemDefault()).toLocalDateTime()
  return local.toLocalDate().toString() to local.format(DateTimeFormatter.ofPattern("HH:mm"))
}
