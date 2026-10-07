package com.aglyn.plugins.bookings

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.US)

actual fun deviceUtcOffsetMinutes(atMs: Long): Int =
  -ZoneId.systemDefault().rules.getOffset(Instant.ofEpochMilli(atMs)).totalSeconds / 60

actual fun formatBookingTime(atMs: Long): String = TIME.format(Instant.ofEpochMilli(atMs).atZone(ZoneId.systemDefault()))
